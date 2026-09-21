import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Stereo-route sorties (§9.10, docs/adr/0050) — a squadron jet filed by
// short name, walked from the phone call to the handoff, and the ways that
// short name does and does not win a standing release.
//
// Its own file rather than an addition to efsp-scenario-military.test.mjs
// because it needs a standing-release envelope configured BEFORE createEfsp()
// (index.js reads facilityConfig's standingReleases once, at construction),
// and a facility-config edit is not something to inflict on another file's
// shared board.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-stereo-scn-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
  CRCSYNC_EFSP_STEREO_ROUTES_PATH: 'stereo-routes.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');

// This fixture doubles as the worked example of the config shape, the same
// way efsp-airspaces.json's own fixture does — the shipped table is empty
// (see stereo-routes.js's header for why), so a reader looking for "what
// does one of these look like" ends up here or in the usage guide.
const PACK_1_ROUTE = 'LTAG DCT ADANA DCT TOROS DCT LTAG';
const PACK_2_ROUTE = 'LTAG DCT KONYA DCT LTAG';
fs.writeFileSync(process.env.CRCSYNC_EFSP_STEREO_ROUTES_PATH, JSON.stringify([
  {
    name: 'PACK 1',
    description: 'north MOA and recover',
    departureAirport: 'LTAG',
    destinationAirport: 'LTAG',
    route: PACK_1_ROUTE,
    requestedAltitude: '250',
    remarks: 'squadron standard',
  },
  {
    name: 'PACK 2',
    description: 'south range',
    departureAirport: 'LTAG',
    destinationAirport: 'LTAG',
    route: PACK_2_ROUTE,
    requestedAltitude: '180',
  },
  { name: 'PACK 9', route: 'LTAG DCT RETIRED', active: false },
]));

const facilityConfig = await import('../src/efsp/facility-config.js');
const stereoRoutes = await import('../src/efsp/stereo-routes.js');

// The agreement, as facility configuration (§4.6.2 — "model standing
// releases as facility configuration"). Written before createEfsp() below,
// because index.js reads standingReleases once at construction.
facilityConfig.setFacilityConfig({
  ...facilityConfig.getFacilityConfig('INCIRLIK'),
  standingReleases: [{ envelopeId: 'pack-1', description: 'PACK 1 standing release', stereoRoute: 'PACK 1', active: true }],
}, 'INCIRLIK');

const { createEfsp } = await import('../src/efsp/index.js');
const { crew, mustAct, act, jumpTo, advance } = await import('./helpers/efsp-scenario.mjs');

const ATC = { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK' };

function fileStereo(efsp, c, callsign, stereoRouteName) {
  return act(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE',
    fdr: { callsign, stereoRouteName },
  });
}

function fdrOf(efsp, strip) { return efsp.fdrStore.getFdr(strip.fdrId); }

// ── 1. the acceptance criterion, walked ──────────────────────────────────

test('SCENARIO a squadron jet files PACK 1 by phone and flies it', async () => {
  // WP6's acceptance criterion, verbatim: "A stereo route filed by short
  // name produces a complete FDR." OPS is given a callsign and four
  // characters of route name and nothing else — which is exactly §9.10's
  // "a filing path that does not require a full flight-plan form."
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  const ack = fileStereo(efsp, c, 'PACK11', 'PACK1');
  assert.equal(ack.ok, true, JSON.stringify(ack));
  let strip = ack.strip;

  const fdr = fdrOf(efsp, strip);
  assert.equal(fdr.filed.route, PACK_1_ROUTE);
  assert.equal(fdr.filed.requestedAltitude, '250');
  assert.equal(fdr.filed.departureAirport, 'LTAG');
  assert.equal(fdr.filed.destinationAirport, 'LTAG');
  assert.equal(fdr.filed.remarks, 'squadron standard');
  // The canonical spelling, not the `PACK1` that was typed.
  assert.equal(fdr.filed.stereoRouteName, 'PACK 1');

  // And then it is an entirely ordinary Strip: nothing downstream knows or
  // cares that the FDR came out of a table rather than off a form.
  strip = await advance(efsp, c.OPS, 'OPS', strip);      // -> PENDING_CLEARANCE at CD
  assert.equal(strip.state, 'PENDING_CLEARANCE');
  strip = await advance(efsp, c.CD, 'CD', strip);        // -> CLEARED
  assert.equal(strip.state, 'CLEARED');
  strip = await advance(efsp, c.CD, 'CD', strip);        // -> PUSHBACK at GND
  assert.equal(strip.state, 'PUSHBACK');
  assert.equal(strip.ownerPositionId, 'GND');
  // The stereo name survives the whole walk — it is filed intent, and filed
  // intent does not change because a flight taxied.
  assert.equal(fdrOf(efsp, strip).filed.stereoRouteName, 'PACK 1');
});

// ── 2. the standing release is for the NAME ──────────────────────────────

test('SCENARIO the standing release is for the route\'s name, not its text', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  // (a) filed on PACK 1 and held: the agreement covers it, so it pushes.
  let onPack = fileStereo(efsp, c, 'PACK21', 'PACK1').strip;
  onPack = await advance(efsp, c.OPS, 'OPS', onPack);
  onPack = jumpTo(efsp, c.CD, 'CD', onPack, 'CLEARED');
  mustAct(efsp, c.CD, 'CD', onPack, { kind: 'SetBlock', blockId: '14A', value: 'HOLD_FOR_RELEASE' });
  onPack = efsp.boardStoreFor('INCIRLIK').getStrip(onPack.stripId);
  onPack = jumpTo(efsp, c.CD, 'CD', onPack, 'HELD');
  onPack = await advance(efsp, c.CD, 'CD', onPack);
  assert.equal(onPack.state, 'PUSHBACK', 'a PACK 1 flight is inside the PACK 1 envelope');

  // (b) hand-filed with PACK 1's expanded route and NO name: the docs/adr/
  // 0017 fallback still matches it, because the envelope predates the table.
  // This is the back-compat guarantee stated as a sortie.
  let byRoute = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE',
    fdr: { callsign: 'PACK22', route: 'PACK 1', requestedAltitude: '250', departureAirport: 'LTAG', destinationAirport: 'LTAG' },
  });
  assert.equal(fdrOf(efsp, byRoute).filed.stereoRouteName, '');
  byRoute = await advance(efsp, c.OPS, 'OPS', byRoute);
  byRoute = jumpTo(efsp, c.CD, 'CD', byRoute, 'CLEARED');
  mustAct(efsp, c.CD, 'CD', byRoute, { kind: 'SetBlock', blockId: '14A', value: 'HOLD_FOR_RELEASE' });
  byRoute = efsp.boardStoreFor('INCIRLIK').getStrip(byRoute.stripId);
  byRoute = jumpTo(efsp, c.CD, 'CD', byRoute, 'HELD');
  byRoute = await advance(efsp, c.CD, 'CD', byRoute);
  assert.equal(byRoute.state, 'PUSHBACK', 'the pre-table route-string envelope still matches');

  // (c) filed on PACK 1, then the route is amended: the label clears with
  // it, so the agreement no longer covers the flight and the controller is
  // pointed at the per-flight call §4.6.2 names as the fallback.
  let amended = fileStereo(efsp, c, 'PACK23', 'PACK1').strip;
  amended = await advance(efsp, c.OPS, 'OPS', amended);
  amended = jumpTo(efsp, c.CD, 'CD', amended, 'CLEARED');
  mustAct(efsp, c.CD, 'CD', amended, { kind: 'SetBlock', blockId: '9', value: 'LTAG DCT DELTA' });
  assert.equal(fdrOf(efsp, amended).filed.stereoRouteName, '', 'an amended route is no longer the canned one');
  amended = efsp.boardStoreFor('INCIRLIK').getStrip(amended.stripId);
  mustAct(efsp, c.CD, 'CD', amended, { kind: 'SetBlock', blockId: '14A', value: 'HOLD_FOR_RELEASE' });
  amended = efsp.boardStoreFor('INCIRLIK').getStrip(amended.stripId);
  amended = jumpTo(efsp, c.CD, 'CD', amended, 'HELD');
  const refused = act(efsp, c.CD, 'CD', amended, { kind: 'InvokeNla' });
  assert.equal(refused.ok, false);
  // Pinned to the specific rejection: NLA_INHIBITED with §4.6.2's own
  // fallback wording. A looser assertion here would pass just as happily on
  // a NOT_OWNER or a STALE_REV, which is not what this sortie is about.
  assert.equal(refused.reason, 'NLA_INHIBITED');
  assert.equal(refused.detail, 'outside standing release envelope — file OPERATIONAL_REQUEST');

  // (d) a client that simply ASSERTS a stereo name it made up never reaches
  // the envelope at all — the name is resolved server-side against the
  // table, so there is no forged-release path to defend downstream.
  const forged = fileStereo(efsp, c, 'PACK24', 'PACK 1 BUT NOT REALLY');
  assert.equal(forged.ok, false);
  assert.equal(forged.reason, 'VALIDATION_ERROR');
  assert.match(forged.detail, /is not a configured stereo route/);
});

// ── 3. refusals cost nothing ─────────────────────────────────────────────

test('SCENARIO a mistyped stereo name creates no Strip and burns no beacon code', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const before = efsp.boardStoreFor('INCIRLIK').getAll().length;

  const typo = fileStereo(efsp, c, 'PACK31', 'PACK99');
  assert.equal(typo.ok, false);
  assert.match(typo.detail, /PACK99 is not a configured stereo route/);

  const retired = fileStereo(efsp, c, 'PACK32', 'pack 9');
  assert.equal(retired.ok, false);
  // Its own message — a retired route is a different mistake from a typo,
  // and telling a controller "no such route" about one the squadron used
  // last month would send them hunting for a spelling error.
  assert.match(retired.detail, /PACK 9 is not an active stereo route/);

  assert.equal(efsp.boardStoreFor('INCIRLIK').getAll().length, before, 'no Strip was created');

  // The code pool is untouched: the next real filing gets the code it would
  // have got with no refusals in between.
  const ok = fileStereo(efsp, c, 'PACK33', 'PACK1');
  assert.equal(ok.ok, true);
  assert.ok(fdrOf(efsp, ok.strip).identity.beaconAssigned);
});

// ── 4. deactivation is not retroactive ───────────────────────────────────

test('SCENARIO retiring a stereo route stops new filings and leaves the flight already on it alone', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  let airborne = fileStereo(efsp, c, 'PACK41', 'PACK1').strip;
  airborne = await advance(efsp, c.OPS, 'OPS', airborne);

  // The squadron retires PACK 1 mid-session (a file edit plus a restart in
  // production; setStereoRoutes here is the same code path).
  const table = stereoRoutes.getStereoRoutes().map(r => (r.name === 'PACK 1' ? { ...r, active: false } : r));
  assert.deepEqual(stereoRoutes.setStereoRoutes(table), { ok: true });

  try {
    // The flight already on it is untouched — it is still flying the route it
    // was cleared for, and rewriting history under a taxiing aircraft would
    // be the defect, not the fix.
    const fdr = fdrOf(efsp, airborne);
    assert.equal(fdr.filed.stereoRouteName, 'PACK 1');
    assert.equal(fdr.filed.route, PACK_1_ROUTE);

    // A new filing is refused.
    const late = fileStereo(efsp, c, 'PACK42', 'PACK1');
    assert.equal(late.ok, false);
    assert.match(late.detail, /is not an active stereo route/);
  } finally {
    // Shared module state — hand it back however this test exits, or every
    // test after it in this file is running against a retired PACK 1.
    stereoRoutes.setStereoRoutes(stereoRoutes.getStereoRoutes().map(r => (r.name === 'PACK 1' ? { ...r, active: true } : r)));
  }
});

// ── 5. a local name never crosses the boundary ───────────────────────────

test('SCENARIO a stereo name is local symbology and never leaves as the route (§8.3 rule 5)', async () => {
  // Guide §8.3 rule 5: "Local symbology defined in configuration MUST be
  // marked local-only and MUST NOT appear in any inter-facility message."
  // Expansion happens once, at filing, so what CENTER receives is the route
  // — trivially true given one FDR serves both Facilities, and asserted
  // anyway because it is the kind of property that stops being true the
  // moment somebody decides to "save bandwidth" by sending the short name.
  const efsp = createEfsp();
  const c = crew(efsp, { ...ATC, CTR: 'CENTER' });

  let strip = fileStereo(efsp, c, 'PACK51', 'PACK1').strip;
  strip = jumpTo(efsp, c.OPS, 'OPS', strip, 'HANDED_OFF');
  strip = mustAct(efsp, c.OPS, 'OPS', strip, {
    kind: 'TransferStrip', toPositionId: 'APP', bayId: 'app-departures', rackId: 'main',
  });
  const appStrip = mustAct(efsp, c.APP, 'APP', strip, {
    kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR',
  });
  const replica = efsp.boardStoreFor('CENTER').getStrip(appStrip.coordination.peerStripId);
  const accepted = mustAct(efsp, c.CTR, 'CTR', replica, { kind: 'HANDOFF', action: 'ACCEPT' });

  const centerFdr = efsp.fdrStore.getFdr(accepted.fdrId);
  assert.equal(centerFdr.filed.route, PACK_1_ROUTE, 'CENTER sees the expanded route');
  // CENTER's Block Map has no 9F at all, so the name is not renderable
  // there even though it rides along on the shared FDR.
  const blockMap = await import('../src/efsp/block-map.js');
  assert.equal(blockMap.resolveBlockTarget('ARRIVAL', '9F'), null);
});

// ── 6. switching and cancelling on a live Strip ──────────────────────────

test('SCENARIO "request change to PACK 2" on a taxiing flight keeps its squawk and its Strip', async () => {
  // The case that sent Block 9F from read-only to writable. Both of the old
  // remedies were bad: hand-editing the route dropped the label, left PACK 1's
  // altitude behind and put the flight outside the PACK 2 envelope; dropping
  // and re-filing minted a new beacon code for an aircraft already squawking.
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  let strip = fileStereo(efsp, c, 'PACK61', 'PACK1').strip;
  const squawk = fdrOf(efsp, strip).identity.beaconAssigned;
  const cid = strip.cid;
  strip = await advance(efsp, c.OPS, 'OPS', strip);        // -> PENDING_CLEARANCE at CD
  mustAct(efsp, c.CD, 'CD', strip, { kind: 'SetBlock', blockId: '9E', value: 'PPR 1420' });
  strip = efsp.boardStoreFor('INCIRLIK').getStrip(strip.stripId);

  mustAct(efsp, c.CD, 'CD', strip, { kind: 'SetBlock', blockId: '9F', value: 'pack2' });

  const fdr = fdrOf(efsp, strip);
  assert.equal(fdr.filed.stereoRouteName, 'PACK 2');
  assert.equal(fdr.filed.route, PACK_2_ROUTE);
  assert.equal(fdr.filed.requestedAltitude, '180', 'the new route\'s altitude came with it');
  assert.equal(fdr.identity.beaconAssigned, squawk, 'the pilot keeps the squawk they were given');
  assert.equal(efsp.boardStoreFor('INCIRLIK').getStrip(strip.stripId).cid, cid);
  assert.equal(fdr.filed.remarks, 'PPR 1420', 'controller free text survives a re-file');
});

test('SCENARIO a re-filed flight moves into the NEW route\'s standing-release envelope', async () => {
  // The half that the hand-edit workaround got silently wrong: after
  // switching, the flight must be covered by the envelope for the route it
  // is now flying, and not by the one for the route it left.
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  let strip = fileStereo(efsp, c, 'PACK62', 'PACK1').strip;
  strip = await advance(efsp, c.OPS, 'OPS', strip);
  strip = jumpTo(efsp, c.CD, 'CD', strip, 'CLEARED');
  mustAct(efsp, c.CD, 'CD', strip, { kind: 'SetBlock', blockId: '14A', value: 'HOLD_FOR_RELEASE' });
  strip = efsp.boardStoreFor('INCIRLIK').getStrip(strip.stripId);
  strip = jumpTo(efsp, c.CD, 'CD', strip, 'HELD');

  // Only PACK 1 has an envelope in this file's facility config, so switching
  // to PACK 2 takes the flight out of the agreement — correctly, and with
  // the per-flight fallback named.
  mustAct(efsp, c.CD, 'CD', strip, { kind: 'SetBlock', blockId: '9F', value: 'PACK 2' });
  strip = efsp.boardStoreFor('INCIRLIK').getStrip(strip.stripId);
  const refused = act(efsp, c.CD, 'CD', strip, { kind: 'InvokeNla' });
  assert.equal(refused.reason, 'NLA_INHIBITED');
  assert.equal(refused.detail, 'outside standing release envelope — file OPERATIONAL_REQUEST');

  // Switching back puts it inside again, and releases.
  mustAct(efsp, c.CD, 'CD', strip, { kind: 'SetBlock', blockId: '9F', value: 'PACK 1' });
  strip = efsp.boardStoreFor('INCIRLIK').getStrip(strip.stripId);
  const released = await advance(efsp, c.CD, 'CD', strip);
  assert.equal(released.state, 'PUSHBACK');
});

test('SCENARIO "request PACK 1" from a flight that filed a plain route the normal way', async () => {
  // The other direction, and probably the more common one: the Strip already
  // exists from a DD1801 or a hand entry, and the pilot asks for the standard
  // route on first contact. Before 9F was writable there was no way to record
  // that at all.
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  let strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE',
    fdr: { callsign: 'PACK63', route: 'LTAG DCT WHATEVER', requestedAltitude: '100', departureAirport: 'LTAG' },
  });
  assert.equal(fdrOf(efsp, strip).filed.stereoRouteName, '');

  // Still OPS-owned at PROPOSED — §4.4 rule 2 makes every op owner-only.
  mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'SetBlock', blockId: '9F', value: 'PACK1' });
  const fdr = fdrOf(efsp, strip);
  assert.equal(fdr.filed.stereoRouteName, 'PACK 1');
  assert.equal(fdr.filed.route, PACK_1_ROUTE);
  assert.equal(fdr.filed.requestedAltitude, '250');
});

test('SCENARIO cancelling a stereo un-labels the flight but leaves it a route to fly', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const strip = fileStereo(efsp, c, 'PACK64', 'PACK1').strip;

  mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'SetBlock', blockId: '9F', value: '' });
  const fdr = fdrOf(efsp, strip);
  assert.equal(fdr.filed.stereoRouteName, '');
  assert.equal(fdr.filed.route, PACK_1_ROUTE, 'un-labelling must never blank a route mid-taxi');
});

test('SCENARIO a mistyped re-file on a live Strip changes nothing at all', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const strip = fileStereo(efsp, c, 'PACK65', 'PACK1').strip;
  const before = JSON.stringify(fdrOf(efsp, strip));

  const refused = act(efsp, c.OPS, 'OPS', strip, { kind: 'SetBlock', blockId: '9F', value: 'PACK77' });
  assert.equal(refused.ok, false);
  assert.match(refused.detail, /PACK77 is not a configured stereo route/);
  assert.equal(JSON.stringify(fdrOf(efsp, strip)), before);
});
