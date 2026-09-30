import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

/* MTR sorties — guide §9.4, docs/adr/0062.
 *
 * A flight on a Military Training Route, walked by hand from the OPS desk to
 * Center and back to APP: who posts what, where it shows up, and — the case
 * the lifecycle never poses because a request is not a state — what happens
 * when the pilot asks for a different exit fix.
 *
 * Its own durable board, like every scenario file.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-mtr-scn-'));
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
const { computeDueObligations } = await import('../src/efsp/forwarding-obligations.js');
const {
  crew, act, mustAct, mustMarsaAct, jumpTo, DEPARTURE_FDR, handedToCenter,
} = await import('./helpers/efsp-scenario.mjs');

// The mission clock (H11): a date nothing else uses, advancing at real rate,
// so a time dated by the wall clock would land visibly on the wrong day.
const MISSION_START = Date.UTC(2016, 5, 21, 13, 50);
const WALL_START = Date.now();
const clock = { now: () => MISSION_START + (Date.now() - WALL_START), source: 'MISSION' };
const zulu = (hh, mm) => Date.UTC(2016, 5, 21, hh, mm);

const ATC = { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER' };
const efsp = createEfsp({ clock });
const c = crew(efsp, ATC);

const fdrOf = (strip) => efsp.fdrStore.getFdr(strip.fdrId);
const mtrOf = (strip) => fdrOf(strip).military.mtr;
const incirlik = (strip) => efsp.boardStoreFor('INCIRLIK').getStrip(strip.stripId);
const center = (strip) => efsp.boardStoreFor('CENTER').getStrip(strip.stripId);

/** A DEPARTURE filed at OPS, not yet moved. */
function filed(callsign, extra = {}) {
  return mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE',
    fdr: { ...DEPARTURE_FDR, callsign, ...extra },
  });
}

/** The rest of airborneDeparture(): handed off and parked at APP's terminus. */
function toApp(strip) {
  strip = jumpTo(efsp, c.OPS, 'OPS', strip, 'HANDED_OFF');
  return mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'TransferStrip', toPositionId: 'APP', bayId: 'app-departures', rackId: 'main' });
}

/** OPS files VIPER-something on IR107 and posts the entry; the flight ends up with CTR. */
function onTheRoute(callsign) {
  let ops = filed(callsign);
  ops = mustAct(efsp, c.OPS, 'OPS', ops, { kind: 'SetBlock', blockId: '9G-MTR', value: 'IR107' });
  ops = mustAct(efsp, c.OPS, 'OPS', ops, { kind: 'SetBlock', blockId: '9G-ENTRY', value: 'A' });
  ops = mustAct(efsp, c.OPS, 'OPS', ops, { kind: 'SetBlock', blockId: '9G-TIME', value: '1405' });
  const app = toApp(ops);
  const ctr = handedToCenter(efsp, c, app);
  return { app: incirlik(app), ctr };
}

// ── 1. posted on departure, read on arrival ─────────────────────────────────

test('sortie 1: OPS posts the entry, CTR posts the exit on its replica, and it is one flight\'s data everywhere', () => {
  let { app, ctr } = onTheRoute('VIPER11');
  assert.equal(ctr.fdrId, app.fdrId, 'one FDR behind both Facilities\' Strips');

  // "VIPER11, IR107, exit F at 32, request FL190."
  ctr = mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'SetBlock', blockId: '9H-EXIT', value: 'f' });
  ctr = mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'SetBlock', blockId: '9H-TIME', value: '1432' });
  ctr = mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'SetBlock', blockId: '9H-ALT', value: 'FL190' });

  assert.deepEqual(mtrOf(incirlik(app)), {
    designator: 'IR107', entryFix: 'A', entryTimeUtc: zulu(14, 5),
    exitFix: 'F', exitEstimateUtc: zulu(14, 32), requestedAltitudeAfterExit: 'FL190',
  }, 'the INCIRLIK Strip reads what CTR posted — dated on the MISSION day');

  // APP converts its Strip for the recovery. ConvertToArrival archives the
  // Strip's own annotations; the MTR data lives on the flight and must all
  // survive.
  const converted = mustAct(efsp, c.APP, 'APP', incirlik(app), { kind: 'ConvertToArrival' });
  assert.equal(converted.role, 'ARRIVAL');
  assert.equal(mtrOf(converted).exitFix, 'F');
  assert.equal(mtrOf(converted).designator, 'IR107');
  assert.equal(mtrOf(converted).entryTimeUtc, zulu(14, 5));
});

// ── 2. "request a different exit fix" ───────────────────────────────────────

test('sortie 2: "request exit at E instead, estimating 40, request FL210" — a request posts, only the approval voids MARSA', () => {
  let { app, ctr } = onTheRoute('VIPER12');
  ctr = mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'SetBlock', blockId: '9H-EXIT', value: 'F' });
  ctr = mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'SetBlock', blockId: '9H-TIME', value: '1432' });
  ctr = mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'SetBlock', blockId: '9H-ALT', value: 'FL190' });

  // A tanker join is in progress: MARSA declared, not yet at rendezvous, so
  // any ATC assignment to a participant would void it (§9.2 rule 2).
  const tanker = toApp(filed('SHELL12'));
  const relation = mustMarsaAct(efsp, c.APP, 'APP', null, {
    kind: 'DeclareMarsa', participants: [tanker.fdrId, ctr.fdrId],
    startEvent: 'TANKER_ACCEPTED', endCondition: 'VERTICALLY_POSITIONED', declaringCallsign: 'SHELL12',
  });

  const rev = fdrOf(ctr).rev;
  ctr = mustAct(efsp, c.CTR, 'CTR', center(ctr), { kind: 'SetBlock', blockId: '9H-EXIT', value: 'E' });
  ctr = mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'SetBlock', blockId: '9H-TIME', value: '1440' });
  ctr = mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'SetBlock', blockId: '9H-ALT', value: 'FL210' });

  const mtr = mtrOf(ctr);
  assert.equal(mtr.exitFix, 'E');
  assert.equal(mtr.exitEstimateUtc, zulu(14, 40));
  assert.equal(mtr.requestedAltitudeAfterExit, 'FL210');
  assert.equal(fdrOf(ctr).rev, rev + 3, 'three writes, three revs — and nothing else touched');
  assert.equal(mtrOf(incirlik(app)).exitFix, 'E', 'APP\'s Strip reads the new exit fix');
  assert.equal(efsp.marsaStore.getRelation(relation.marsaId).state, 'ACTIVE',
    'posting the pilot\'s REQUEST issues nothing, so it must not void the join');

  // "…approved FL210": the controller writes the clearance. That IS an
  // assignment, and voids MARSA before rendezvous.
  mustAct(efsp, c.CTR, 'CTR', center(ctr), { kind: 'SetBlock', blockId: '21', value: 'FL210' });
  const voided = efsp.marsaStore.getRelation(relation.marsaId);
  assert.equal(voided.state, 'VOIDED');
  assert.equal(voided.voidedBy, 'CONTROLLER_ALTITUDE_CHANGE');
});

// ── 3. refusals ─────────────────────────────────────────────────────────────

test('sortie 3: a bad time or altitude is refused legibly, and the flight is untouched', () => {
  const { ctr } = onTheRoute('VIPER13');
  const rev = fdrOf(ctr).rev;

  const time = act(efsp, c.CTR, 'CTR', ctr, { kind: 'SetBlock', blockId: '9H-TIME', value: '2460' });
  assert.equal(time.ok, false);
  assert.equal(time.reason, 'VALIDATION_ERROR');
  assert.match(time.detail, /HHMM/);

  const alt = act(efsp, c.CTR, 'CTR', ctr, { kind: 'SetBlock', blockId: '9H-ALT', value: 'high' });
  assert.equal(alt.ok, false);
  assert.match(alt.detail, /altitude/);

  assert.equal(fdrOf(ctr).rev, rev);
  assert.equal(mtrOf(ctr).exitEstimateUtc, null);
});

// ── 4. cancel the MTR ───────────────────────────────────────────────────────

test('sortie 4: "cancel IR107, direct home" clears the designator only — no hidden writes', () => {
  let { ctr } = onTheRoute('VIPER14');
  ctr = mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'SetBlock', blockId: '9H-EXIT', value: 'F' });
  ctr = mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'SetBlock', blockId: '9G-MTR', value: '' });
  assert.equal(mtrOf(ctr).designator, null);
  assert.equal(mtrOf(ctr).exitFix, 'F', 'clearing the designator does not clear the exit (Q5)');
  assert.equal(mtrOf(ctr).entryFix, 'A');

  for (const blockId of ['9G-ENTRY', '9G-TIME', '9H-EXIT', '9H-TIME', '9H-ALT']) {
    ctr = mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'SetBlock', blockId, value: '' });
  }
  assert.ok(Object.values(mtrOf(ctr)).every(v => v === null), 'all six clear to null');
});

// ── 5. an amendment is an amendment ─────────────────────────────────────────

test('sortie 5: posting MTR data inside 30 min of departure is a filed-plan amendment; on an airborne flight it is not', () => {
  const now = clock.now();
  let soon = filed('VIPER15', { proposedDepartureTimeUtc: now + 20 * 60 * 1000 });
  efsp.fdrStore.getFdr(soon.fdrId).updatedAt = now - 5 * 60 * 1000; // filed a while ago
  const due = (s) => computeDueObligations(s, fdrOf(s), clock.now()).map(o => o.obligationType);
  assert.equal(due(soon).includes('AMENDMENT_INSIDE_30MIN'), false, 'precondition: nothing amended yet');

  soon = mustAct(efsp, c.OPS, 'OPS', soon, { kind: 'SetBlock', blockId: '9G-MTR', value: 'IR107' });
  assert.ok(due(soon).includes('AMENDMENT_INSIDE_30MIN'), 'the MTR is part of the filed plan (updatedAt, not clearanceUpdatedAt)');

  let gone = toApp(filed('VIPER16', { proposedDepartureTimeUtc: now - 30 * 60 * 1000 }));
  gone = mustAct(efsp, c.APP, 'APP', gone, { kind: 'SetBlock', blockId: '9H-EXIT', value: 'F' });
  assert.equal(due(gone).includes('AMENDMENT_INSIDE_30MIN'), false, 'an airborne flight cannot have one');
});

// ── 6. per-Block narrowing ──────────────────────────────────────────────────

test('sortie 6: a Facility can hide one MTR Block without the others — the reason for the 9A-style split', () => {
  const before = facilityConfig.getFacilityConfig('INCIRLIK');
  const hidden = { ...before, hiddenBlocks: { ...before.hiddenBlocks, DEPARTURE: ['9G-ENTRY'] } };
  try {
    assert.equal(facilityConfig.setFacilityConfig(hidden, 'INCIRLIK'), true);
    const strip = filed('VIPER17');
    assert.equal(act(efsp, c.OPS, 'OPS', strip, { kind: 'SetBlock', blockId: '9G-ENTRY', value: 'A' }).ok, false);
    assert.equal(act(efsp, c.OPS, 'OPS', strip, { kind: 'SetBlock', blockId: '9G-MTR', value: 'IR107' }).ok, true);
  } finally {
    facilityConfig.setFacilityConfig(before, 'INCIRLIK');
  }
});

// ── 7. restart ──────────────────────────────────────────────────────────────

test('sortie 7: the six values survive a crc-sync restart', () => {
  let { ctr } = onTheRoute('VIPER18');
  ctr = mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'SetBlock', blockId: '9H-EXIT', value: 'F' });
  ctr = mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'SetBlock', blockId: '9H-TIME', value: '1432' });
  ctr = mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'SetBlock', blockId: '9H-ALT', value: '080' });
  efsp.persist();

  const reborn = createEfsp({ clock });
  assert.deepEqual(reborn.fdrStore.getFdr(ctr.fdrId).military.mtr, {
    designator: 'IR107', entryFix: 'A', entryTimeUtc: zulu(14, 5),
    exitFix: 'F', exitEstimateUtc: zulu(14, 32), requestedAltitudeAfterExit: '080',
  });
});
