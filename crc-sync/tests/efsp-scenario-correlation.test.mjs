import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

/* Correlation sorties — whole flights walked against a live track picture.
 *
 * Guide §6.6 names identity reconciliation between the flight-data and track
 * domains as a MEASURED defect class (D1), not a join, and §13's WP5
 * acceptance says to test it deliberately:
 *
 *   "A track identity change re-binds on beacon code or raises an
 *    uncorrelated warning — it never silently breaks the binding. This is
 *    the named defect class; test it deliberately."
 *
 * So the first four sorties are the four ways a DCS identity moves under a
 * flight: a mission reload re-IDs everything, a contact goes stale and comes
 * back as somebody else, a pilot changes squawk, and two flights share a
 * callsign. Sortie 5 is the regression test for a defect this pass found in
 * ConvertToArrival, and 7 for the one the fdrId key exists to prevent.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-correlation-scn-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');

const { createEfsp } = await import('../src/efsp/index.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const { CorrelationReconciler } = await import('../src/efsp/correlation-reconciler.js');
const { octalCode } = await import('../src/surveillance/transponder.js');
const {
  crew, mustAct, advance, airborneDeparture, handedToCenter, DEPARTURE_FDR,
} = await import('./helpers/efsp-scenario.mjs');

const ATC = { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER' };

/**
 * A TrackStore stand-in the sortie drives directly — spawn, despawn, re-ID,
 * change squawk. The real store is fed by DCS-gRPC, so a scenario cannot
 * make an aircraft appear any other way.
 */
function picture() {
  const tracks = new Map();
  return {
    getAll: () => [...tracks.values()],
    spawn(id, callsign, squawk = null) {
      tracks.set(String(id), {
        id: String(id), callsign, squawk, coalition: 3, type: 'F-16C_50',
        lat: 37.1, lon: 35.1, alt: 6000, heading: 90, category: 1, player: 'Pilot',
      });
      return this;
    },
    squawk(id, squawk) { tracks.get(String(id)).squawk = squawk; return this; },
    despawn(id) { tracks.delete(String(id)); return this; },
    /** A DCS mission reload: every contact goes, and comes back with a new id. */
    reload() { tracks.clear(); return this; },
  };
}

function reconcilerFor(efsp, trackStore, deltas = []) {
  return new CorrelationReconciler({
    beaconOf: (t) => octalCode(t.squawk),
    trackStore,
    fdrStore: efsp.fdrStore,
    correlationStore: efsp.correlationStore,
    boardStoreFor: efsp.boardStoreFor,
    facilityConfig,
    onDelta: (payload) => deltas.push(payload),
  });
}

/** An airborne flight at APP, correlated to a contact squawking its assigned code. */
function airborneAndCorrelated(efsp, c, sky, { callsign = 'VIPER1', trackId = 101 } = {}) {
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign });
  const fdr = efsp.fdrStore.getFdr(strip.fdrId);
  sky.spawn(trackId, callsign, parseInt(fdr.identity.beaconAssigned, 10));
  return { strip, fdr };
}

function correlationOf(efsp, fdrId) {
  return efsp.correlationStore.getCorrelation(fdrId);
}

function bind(efsp, session, positionId, fdrId, trackId) {
  const current = correlationOf(efsp, fdrId);
  const result = efsp.handleMessage(session, {
    version: 1, type: 'efsp-correlation-mutation', clientMutationId: crypto.randomUUID(),
    fdrId, baseRev: current ? current.rev : 0, actingPositionId: positionId,
    op: { kind: 'BindTrack', trackId: String(trackId) },
  });
  assert.equal(result.ack.ok, true, JSON.stringify(result.ack));
  return result.ack.correlation;
}

// ── 1. a mission reload re-IDs every contact ─────────────────────────────

test('SCENARIO a DCS mission reload re-IDs every contact; the flight warns, then re-binds on its squawk', async () => {
  // The WP5 acceptance criterion, asserted literally. Nothing about the
  // airframe changed and every track id did — defect D1 at its most brutal.
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const sky = picture();
  const deltas = [];
  const reconciler = reconcilerFor(efsp, sky, deltas);

  const { strip, fdr } = airborneAndCorrelated(efsp, c, sky, { callsign: 'RELOAD1', trackId: 101 });
  reconciler.tick();

  let record = correlationOf(efsp, strip.fdrId);
  assert.equal(record.state, 'CORRELATED');
  assert.equal(record.matchedBy, 'BEACON');
  assert.equal(record.trackId, '101');

  // The reload.
  sky.reload();
  deltas.length = 0;
  reconciler.resetPicture('MISSION_RELOAD');

  record = correlationOf(efsp, strip.fdrId);
  assert.equal(record.state, 'UNCORRELATED', 'it never silently keeps the dead id');
  assert.equal(record.warning.kind, 'TRACK_IDENTITY_LOST');
  assert.equal(record.binding, null);
  assert.equal(record.transitions.at(-1).reason, 'MISSION_RELOAD');
  assert.equal(record.transitions.at(-1).fromTrackId, '101');
  assert.equal(deltas.length, 1, 'and every client is told at once');

  // The same aircraft comes back under a new id, squawking the same code.
  sky.spawn(500, 'RELOAD1', parseInt(fdr.identity.beaconAssigned, 10));
  reconciler.tick();

  record = correlationOf(efsp, strip.fdrId);
  assert.equal(record.state, 'CORRELATED');
  assert.equal(record.matchedBy, 'BEACON');
  assert.equal(record.trackId, '500');
  assert.equal(record.warning, null, 'the warning retracts on its own');
  const last = record.transitions.at(-1);
  assert.equal(last.reason, 'REBOUND_ON_BEACON');
  assert.equal(last.fromTrackId, '101', 'and the identity change is legible in one line');
});

test('a flight whose transponder is off keeps the warning after a reload rather than guessing', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const sky = picture();
  const reconciler = reconcilerFor(efsp, sky);

  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'DARK1' });
  sky.spawn(101, 'DARK1', null); // no squawk at all
  reconciler.tick();
  assert.equal(correlationOf(efsp, strip.fdrId).matchedBy, 'CALLSIGN_EXACT');

  sky.reload();
  reconciler.resetPicture('MISSION_RELOAD');
  reconciler.tick();

  const record = correlationOf(efsp, strip.fdrId);
  assert.equal(record.state, 'UNCORRELATED');
  assert.equal(record.warning.kind, 'TRACK_LOST');
});

// ── 2. a contact goes stale and returns as somebody else ─────────────────

test('SCENARIO one contact re-IDing changes exactly one record, and nothing else moves', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const sky = picture();
  const deltas = [];
  const reconciler = reconcilerFor(efsp, sky, deltas);

  const one = airborneAndCorrelated(efsp, c, sky, { callsign: 'STALE1', trackId: 101 });
  const two = airborneAndCorrelated(efsp, c, sky, { callsign: 'STEADY1', trackId: 202 });
  reconciler.tick();
  deltas.length = 0;

  // Only the first goes stale and comes back renumbered.
  sky.despawn(101).spawn(777, 'STALE1', parseInt(one.fdr.identity.beaconAssigned, 10));
  reconciler.tick();

  assert.equal(deltas.length, 1);
  const updated = deltas[0].correlations;
  assert.equal(updated.length, 1, 'the blast radius is one flight');
  assert.equal(updated[0].fdrId, one.strip.fdrId);

  assert.equal(correlationOf(efsp, one.strip.fdrId).trackId, '777');
  assert.equal(correlationOf(efsp, one.strip.fdrId).transitions.at(-1).reason, 'REBOUND_ON_BEACON');
  assert.equal(correlationOf(efsp, two.strip.fdrId).trackId, '202', 'the other flight is untouched');
});

test('a contact that goes and does not come back leaves a warning, not a stale binding', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const sky = picture();
  const reconciler = reconcilerFor(efsp, sky);

  const { strip } = airborneAndCorrelated(efsp, c, sky, { callsign: 'GONE1', trackId: 101 });
  reconciler.tick();
  sky.despawn(101);
  reconciler.tick();

  const record = correlationOf(efsp, strip.fdrId);
  assert.equal(record.state, 'UNCORRELATED');
  assert.equal(record.trackId, null);
  assert.equal(record.warning.kind, 'TRACK_LOST');
  assert.equal(record.warning.lostTrackId, '101');
});

// ── 3. the pilot changes squawk ──────────────────────────────────────────

test('SCENARIO a pilot squawking the wrong code stays on the flight, degraded, with both codes visible', async () => {
  // The correlation must NOT follow the new code to some other flight, and
  // §3.10.2 rule 1's assigned-vs-observed pair gets real data behind it for
  // the first time.
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const sky = picture();
  const reconciler = reconcilerFor(efsp, sky);

  const { strip, fdr } = airborneAndCorrelated(efsp, c, sky, { callsign: 'SQWK1', trackId: 101 });
  const assigned = fdr.identity.beaconAssigned;
  reconciler.tick();
  assert.equal(correlationOf(efsp, strip.fdrId).matchedBy, 'BEACON');

  // Fingers. A different, valid Mode 3/A code.
  sky.squawk(101, 1234);
  reconciler.tick();

  const record = correlationOf(efsp, strip.fdrId);
  assert.equal(record.trackId, '101', 'it survives on the callsign rung');
  assert.equal(record.matchedBy, 'CALLSIGN_EXACT');
  assert.equal(record.state, 'PROVISIONAL', 'the transponder disagrees, so the match is only provisional');
  assert.equal(record.observedBeacon, '1234');

  const after = efsp.fdrStore.getFdr(strip.fdrId);
  assert.equal(after.identity.beaconAssigned, assigned, 'the assignment is untouched');
  assert.equal(after.identity.beaconObserved, '1234');
  assert.notEqual(after.identity.beaconAssigned, after.identity.beaconObserved,
    'two fields, never one — the mismatch is renderable (defect D22)');

  // The controller settles it by binding, and the mismatch stays visible.
  const bound = bind(efsp, c.APP.session, 'APP', strip.fdrId, 101);
  assert.equal(bound.matchedBy, 'BINDING');
  assert.equal(bound.state, 'CORRELATED');
  reconciler.tick();
  assert.equal(efsp.fdrStore.getFdr(strip.fdrId).identity.beaconObserved, '1234',
    'binding settles the identity, it does not paper over the squawk');
});

test('a pilot who corrects their squawk is promoted back to a beacon match', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const sky = picture();
  const reconciler = reconcilerFor(efsp, sky);

  const { strip, fdr } = airborneAndCorrelated(efsp, c, sky, { callsign: 'FIXED1', trackId: 101 });
  sky.squawk(101, 1234);
  reconciler.tick();
  assert.equal(correlationOf(efsp, strip.fdrId).state, 'PROVISIONAL');

  sky.squawk(101, parseInt(fdr.identity.beaconAssigned, 10));
  reconciler.tick();

  const record = correlationOf(efsp, strip.fdrId);
  assert.equal(record.state, 'CORRELATED');
  assert.equal(record.matchedBy, 'BEACON');
  assert.equal(record.transitions.at(-1).reason, 'PROMOTED');
});

// ── 4. two flights, one callsign ─────────────────────────────────────────

test('SCENARIO two flights sharing a callsign with transponders off: both ambiguous, neither guessed', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const sky = picture();
  const reconciler = reconcilerFor(efsp, sky);

  const first = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'TWIN1' });
  const second = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'TWIN1' });
  sky.spawn(101, 'TWIN1', null).spawn(102, 'TWIN1', null);
  reconciler.tick();

  for (const strip of [first, second]) {
    const record = correlationOf(efsp, strip.fdrId);
    assert.equal(record.state, 'UNCORRELATED', 'guessing between two aircraft is worse than saying so');
    assert.equal(record.warning.kind, 'AMBIGUOUS_CALLSIGN');
    assert.deepEqual(record.warning.candidateTrackIds.sort(), ['101', '102']);
  }

  // One of them squawks its assigned code. The beacon rung claims first, so
  // the other resolves on the callsign rung against the single contact left —
  // this is the assertion that pays for sweeping in rung order.
  const firstFdr = efsp.fdrStore.getFdr(first.fdrId);
  sky.squawk(101, parseInt(firstFdr.identity.beaconAssigned, 10));
  reconciler.tick();

  const one = correlationOf(efsp, first.fdrId);
  assert.equal(one.matchedBy, 'BEACON');
  assert.equal(one.trackId, '101');

  const other = correlationOf(efsp, second.fdrId);
  assert.equal(other.matchedBy, 'CALLSIGN_EXACT');
  assert.equal(other.trackId, '102');
  assert.equal(other.warning, null, 'and its ambiguity warning retracts');
});

test('SCENARIO two contacts squawking one code is ambiguous, and one binding resolves it', async () => {
  // Duplicate codes are structural and explicitly accepted (§3.10.2 rule 7).
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const sky = picture();
  const reconciler = reconcilerFor(efsp, sky);

  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'DUPE1' });
  const code = parseInt(efsp.fdrStore.getFdr(strip.fdrId).identity.beaconAssigned, 10);
  sky.spawn(101, 'SOMEONE', code).spawn(102, 'SOMEONEELSE', code);
  reconciler.tick();

  let record = correlationOf(efsp, strip.fdrId);
  assert.equal(record.warning.kind, 'AMBIGUOUS_BEACON');
  assert.match(record.warning.detail, /bind one/);

  bind(efsp, c.APP.session, 'APP', strip.fdrId, 102);
  reconciler.tick();

  record = correlationOf(efsp, strip.fdrId);
  assert.equal(record.matchedBy, 'BINDING');
  assert.equal(record.trackId, '102');
  assert.equal(record.warning, null);
});

// ── 5. the found defect: ConvertToArrival ────────────────────────────────

test('SCENARIO converting a departure to an arrival keeps the correlation — the aircraft did not change legs, the paperwork did', async () => {
  // Under the per-Strip hook this reset to UNCORRELATED on one click, for an
  // aircraft still airborne and still squawking the code docs/adr/0023 went
  // out of its way to keep. §6.6 rule 3's silent break, reached through a
  // role change. This is the regression test (docs/adr/0045).
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const sky = picture();
  const reconciler = reconcilerFor(efsp, sky);

  const { strip } = airborneAndCorrelated(efsp, c, sky, { callsign: 'TURN1', trackId: 101 });
  reconciler.tick();
  const before = correlationOf(efsp, strip.fdrId);
  assert.equal(before.state, 'CORRELATED');

  const converted = mustAct(efsp, c.APP, 'APP', strip, { kind: 'ConvertToArrival' });
  assert.equal(converted.role, 'ARRIVAL');
  assert.equal(converted.fdrId, strip.fdrId, 'the same FDR, throughout');
  assert.equal('correlation' in converted, false, 'and no per-Strip correlation to reset');

  const after = correlationOf(efsp, strip.fdrId);
  assert.equal(after.state, 'CORRELATED');
  assert.equal(after.trackId, '101');
  assert.equal(after.rev, before.rev, 'a role change is not a correlation event at all');
});

// ── 6. the rate ──────────────────────────────────────────────────────────

test('SCENARIO the correlation rate is reported, and a flight still on the ramp does not drag it down', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const sky = picture();
  const reconciler = reconcilerFor(efsp, sky);

  // Three airborne, two of them findable.
  const found1 = airborneAndCorrelated(efsp, c, sky, { callsign: 'RATE1', trackId: 1 });
  const found2 = airborneAndCorrelated(efsp, c, sky, { callsign: 'RATE2', trackId: 2 });
  const missing = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'RATE3' });
  // Plus one still at PROPOSED, which has no contact to find and is therefore
  // not in the denominator.
  mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE',
    fdr: { ...DEPARTURE_FDR, callsign: 'RAMP1' },
  });

  // Board state is durable and shared across the tests in this file (see the
  // harness header), so the absolute counts belong to the whole file rather
  // than to this sortie. What this asserts is the arithmetic and the
  // eligibility rule, both of which are scale-free.
  const { stats } = reconciler.tick();
  assert.ok(stats.eligible >= 3);
  assert.equal(stats.uncorrelated === undefined, true, 'stats reports a rate, not a breakdown');
  assert.ok(stats.rate < 1, 'RATE3 has no contact, so the rate is short of 1');
  assert.ok(stats.rate < stats.target, 'and below the 95% the guide asks for');

  // The ramp-bound flight is not in the denominator at all: it has no
  // correlation record, because there is no aircraft to look for yet.
  const rampFdrId = efsp.boardStore.getAll()
    .map(s => efsp.fdrStore.getFdr(s.fdrId))
    .find(f => f && f.identity.callsign === 'RAMP1').fdrId;
  assert.equal(correlationOf(efsp, rampFdrId), null);

  // A contact appears that nothing matches; the controller binds it, and the
  // rate rises by exactly that one flight.
  sky.spawn(9, 'MYSTERY', null);
  bind(efsp, c.APP.session, 'APP', missing.fdrId, 9);
  const after = reconciler.tick().stats;
  assert.equal(after.eligible, stats.eligible);
  assert.ok(after.rate > stats.rate, 'binding the missing flight moves the rate');
  assert.ok(after.minRateSeen <= stats.rate, 'and the worst seen is remembered');
  assert.ok(after.sessionRate != null, 'the session figure accumulates across ticks');
  assert.equal(correlationOf(efsp, found1.strip.fdrId).state, 'CORRELATED');
  assert.equal(correlationOf(efsp, found2.strip.fdrId).state, 'CORRELATED');
});

// ── 7. a replica does not fork the correlation ───────────────────────────

test('SCENARIO a flight handed to Center has two Strips and one correlation', async () => {
  // The case a stripId key gets wrong: two Facility replicas of one airframe
  // would each carry a private answer to "which contact is this", and two
  // answers to an identity question IS the defect class (docs/adr/0045).
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const sky = picture();
  const deltas = [];
  const reconciler = reconcilerFor(efsp, sky, deltas);

  const { strip } = airborneAndCorrelated(efsp, c, sky, { callsign: 'CROSS1', trackId: 101 });
  reconciler.tick();

  const centerStrip = handedToCenter(efsp, c, strip);
  assert.notEqual(centerStrip.stripId, strip.stripId, 'two Strips, per docs/adr/0013');
  assert.equal(centerStrip.fdrId, strip.fdrId, 'one FDR');

  deltas.length = 0;
  reconciler.tick();

  // One record, reachable from either Strip by its fdrId.
  assert.equal(correlationOf(efsp, strip.fdrId).trackId, '101');
  assert.equal(correlationOf(efsp, centerStrip.fdrId).trackId, '101');
  assert.equal(efsp.correlationStore.getAll().filter(r => r.fdrId === strip.fdrId).length, 1);
  assert.equal(deltas.length, 0, 'and a replica appearing is not a correlation event');
});

// ── persistence and the audit trail ──────────────────────────────────────

test('a binding is in the durable Mutation log, attributed to the Position that made it', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const sky = picture();
  const { strip } = airborneAndCorrelated(efsp, c, sky, { callsign: 'AUDIT1', trackId: 101 });

  bind(efsp, c.APP.session, 'APP', strip.fdrId, 101);

  // The log is append-only and shared across this file's tests, so scope to
  // this flight's own FDR.
  const entries = efsp.mutationLog.readAll()
    .filter(e => e.op === 'BindTrack' && e.fdrId === strip.fdrId);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].actingPositionId, 'APP');
  assert.equal(entries[0].actorId, c.APP.session.controllerId);
  assert.equal(entries[0].stripId, undefined, 'a correlation op targets no Strip');
  assert.equal(entries[0].ok, true);
});

test('a correlation survives a restart as history, never as a live contact', async () => {
  // DCS re-mints ids across a restart, so a persisted trackId is a lie by the
  // time anyone reads it (docs/adr/0045).
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const sky = picture();
  const { strip } = airborneAndCorrelated(efsp, c, sky, { callsign: 'PERSIST', trackId: 101 });
  bind(efsp, c.APP.session, 'APP', strip.fdrId, 101);

  const restarted = createEfsp();
  const record = restarted.correlationStore.getCorrelation(strip.fdrId);
  assert.ok(record, 'the record came back');
  assert.equal(record.state, 'UNCORRELATED');
  assert.equal(record.trackId, null);
  assert.equal(record.binding, null);
  assert.ok(record.transitions.some(t => t.reason === 'EXPLICIT_BIND'), 'but that it happened is preserved');
});

// ── the §10.3 ring fence, walked end to end ──────────────────────────────

test('SCENARIO surveillance never moves a Strip, however much it contradicts the board', async () => {
  // §10.3 is a MUST NOT: "MUST NOT move Strips between Bays based on detected
  // aircraft position." The chip it permits instead is deferred
  // (docs/adr/0047), so the correct behaviour is to leave the Strip alone.
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const sky = picture();
  const reconciler = reconcilerFor(efsp, sky);

  // A flight the board still has at PENDING_CLEARANCE, whose aircraft is
  // airborne and squawking its code.
  let strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE',
    fdr: { ...DEPARTURE_FDR, callsign: 'EARLY1' },
  });
  strip = await advance(efsp, c.OPS, 'OPS', strip);
  const atCd = efsp.boardStore.getStrip(strip.stripId);
  sky.spawn(101, 'EARLY1', parseInt(efsp.fdrStore.getFdr(strip.fdrId).identity.beaconAssigned, 10));

  reconciler.tick();

  const after = efsp.boardStore.getStrip(strip.stripId);
  assert.equal(after.state, atCd.state, 'the state is the controller’s to change');
  assert.equal(after.bayId, atCd.bayId);
  assert.equal(after.rev, atCd.rev, 'the Strip was not written at all');
  // And it is not even eligible yet, so it does not affect the rate either.
  assert.equal(correlationOf(efsp, strip.fdrId), null);
});
