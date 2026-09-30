import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// WP8 acceptance bullet 3 (EFSPImplementationGuide.md WP8, docs/adr/0065):
// "the traffic count reconciles against the Mutation log". A whole flying
// session is walked through the real wire path, then the count is checked
// against the log — and against deliberately broken copies of each, because a
// reconciliation that cannot fail is not a test.
//
// Its own snapshot/log/count paths: scenario boards are durable and shared
// within a file (T11), so every number below is what THIS file did.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-traffic-scn-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
  CRCSYNC_EFSP_TRAFFIC_COUNT_PATH: 'traffic-count.jsonl',
  CRCSYNC_EFSP_METRICS_PATH: 'metrics.json',
  CRCSYNC_EFSP_INSTRUMENTATION_CONFIG_PATH: 'instrumentation.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, JSON.stringify([
  { airspaceId: 'MOA-SORTIE', name: 'Sortie MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 134.25 },
]));

const { createEfsp } = await import('../src/efsp/index.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const { TrafficCount, reconcileTrafficCount } = await import('../src/efsp/traffic-count.js');
const { crew, act, mustAct, advance, DEPARTURE_FDR, airborneDeparture, handedToCenter, activate } = await import('./helpers/efsp-scenario.mjs');

const efsp = createEfsp();
const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER', TAC_C2: 'TACTICAL' });
const counter = new TrafficCount({
  mutationLog: efsp.mutationLog,
  fdrStore: efsp.fdrStore,
  boardStoreFor: efsp.boardStoreFor,
  facilityIds: facilityConfig.getFacilityIds(),
  config: { retentionDays: 400, homeAirports: { INCIRLIK: ['LTAG'] } },
});

const incirlik = (id) => efsp.boardStoreFor('INCIRLIK').getStrip(id);
const center = (id) => efsp.boardStoreFor('CENTER').getStrip(id);

/** Presses NLA as whoever owns the Strip, until it is DROPPED. */
async function flyOut(strip, facilityId) {
  const board = efsp.boardStoreFor(facilityId);
  for (let i = 0; i < 12 && strip.state !== 'DROPPED'; i++) {
    const owner = strip.ownerPositionId;
    strip = await advance(efsp, c[owner], owner, board.getStrip(strip.stripId));
  }
  assert.equal(strip.state, 'DROPPED', `${strip.stripId} did not reach DROPPED`);
  return strip;
}

function countFileEntries() {
  return fs.readFileSync(process.env.CRCSYNC_EFSP_TRAFFIC_COUNT_PATH, 'utf8').trim().split('\n').map(l => JSON.parse(l));
}

test('SCENARIO a flying session: the traffic count reconciles against the Mutation log', async () => {
  // 1-2. Two local sorties, LTAG to LTAG, one of them a 2-ship.
  await flyOut(airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'LOCAL1', aircraftType: 'F-16C' }), 'INCIRLIK');
  await flyOut(airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'LOCAL2', aircraftType: 'F-16C', flightSize: 2 }), 'INCIRLIK');

  // 3. A transient, LTAG to LTAC, handed to Center and dropped at BOTH Facilities.
  const transient = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'TRANS1', aircraftType: 'C-130', destinationAirport: 'LTAC' });
  const transientCtr = handedToCenter(efsp, c, transient);
  mustAct(efsp, c.APP, 'APP', incirlik(transient.stripId), { kind: 'DropStrip' });
  mustAct(efsp, c.CTR, 'CTR', center(transientCtr.stripId), { kind: 'DropStrip' });

  // 4. An arrival from LTAC, flown down and off the runway.
  const arrival = mustAct(efsp, c.APP, 'APP', null, {
    kind: 'CreateStrip', bayId: 'app-inbound', rackId: 'main', role: 'ARRIVAL',
    fdr: { callsign: 'ARR1', aircraftType: 'KC-135', wakeCategory: 'H', originAirport: 'LTAC' },
  });
  await flyOut(arrival, 'INCIRLIK');

  // 5. A departure converted in place for its return, and landed: one Strip, two legs.
  const outAndBack = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'RTN1', aircraftType: 'F-16C' });
  const returning = mustAct(efsp, c.APP, 'APP', outAndBack, { kind: 'ConvertToArrival' });
  await flyOut(returning, 'INCIRLIK');

  // 6. A proposal OPS throws away — not traffic.
  const proposal = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, callsign: 'OOPS1' },
  });
  mustAct(efsp, c.OPS, 'OPS', proposal, { kind: 'DropStrip' });

  // 7. A terminal Drop undone, then done again.
  let undone = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'UNDO1' });
  undone = await advance(efsp, c.APP, 'APP', undone);
  undone = mustAct(efsp, c.APP, 'APP', undone, { kind: 'Undo' });
  await advance(efsp, c.APP, 'APP', undone);

  // 8. A flight approved into a MOA by Center, out again, then finished at both ends.
  activate(efsp, c, 'MOA-SORTIE');
  const moa = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'MOA1', destinationAirport: 'LTAC' });
  let moaCtr = handedToCenter(efsp, c, moa);
  moaCtr = mustAct(efsp, c.CTR, 'CTR', moaCtr, { kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-SORTIE' });
  moaCtr = mustAct(efsp, c.CTR, 'CTR', moaCtr, { kind: 'ClearAirspaceEntry' });
  mustAct(efsp, c.CTR, 'CTR', moaCtr, { kind: 'DropStrip' });
  mustAct(efsp, c.APP, 'APP', incirlik(moa.stripId), { kind: 'DropStrip' });

  // 9. A handoff Center declines: the replica is dropped (not traffic), the
  // sender's own Strip is a real flight that carries on.
  const declined = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'DECL1' });
  const proposed = mustAct(efsp, c.APP, 'APP', declined, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' });
  const replica = mustAct(efsp, c.CTR, 'CTR', center(proposed.coordination.peerStripId), { kind: 'HANDOFF', action: 'REJECT' });
  mustAct(efsp, c.CTR, 'CTR', center(replica.stripId), { kind: 'DropStrip' });
  mustAct(efsp, c.APP, 'APP', incirlik(declined.stripId), { kind: 'DropStrip' });

  // 10. A TOFI the MRU refuses: the MISSION Strip it minted is retired.
  const tofiFlight = mustAct(efsp, c.CTR, 'CTR', null, {
    kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', role: 'ARRIVAL',
    fdr: { callsign: 'TOFI1', aircraftType: 'F-15E', wakeCategory: 'D', originAirport: 'LTAC' },
  });
  const offered = mustAct(efsp, c.CTR, 'CTR', tofiFlight, {
    kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2',
  });
  const mission = efsp.boardStoreFor('TACTICAL').getStrip(offered.tofiCoordination.peerStripId);
  const refused = mustAct(efsp, c.TAC_C2, 'TAC_C2', mission, { kind: 'TOFI', action: 'REJECT' });
  assert.equal(refused.state, 'DROPPED');

  // ── the reconciliation ──
  const result = reconcileTrafficCount(efsp.mutationLog.readAll(), countFileEntries(), {});
  assert.deepEqual({ missing: result.missing, extra: result.extra, mismatched: result.mismatched }, { missing: [], extra: [], mismatched: [] });
  assert.equal(result.ok, true);
  assert.equal(result.expected, 13, '10 counted drops (8 INCIRLIK, 2 CENTER) + the proposal, the replica and the MISSION line');
  assert.equal(result.actual, 13);
  assert.equal(counter.reconcile().ok, true, 'on demand, too (decisions.md S-Q65)');

  // ── the count, by hand ──
  const body = counter.report({});
  const inc = body.facilities.INCIRLIK.totals;
  assert.deepEqual(inc, {
    flights: 8, aircraft: 9, local: 5, transient: 3, unknown: 0,
    formation: 1, formationAircraft: 2, suaTraversal: 0, alertScramble: 0,
    excluded: 1, excludedByReason: { NEVER_DEPARTED: 1 },
  });
  assert.equal(inc.local + inc.transient + inc.unknown, inc.flights, 'locality is a partition');
  assert.deepEqual(body.facilities.INCIRLIK.byRole, { DEPARTURE: 6, ARRIVAL: 2 }, 'the converted sortie is one ARRIVAL record');
  assert.deepEqual(body.facilities.INCIRLIK.byAircraftType['F-16C'], {
    flights: 3, aircraft: 4, local: 3, transient: 0, unknown: 0, formation: 1, suaTraversal: 0, alertScramble: 0,
  });

  const ctr = body.facilities.CENTER.totals;
  assert.deepEqual(ctr, {
    flights: 2, aircraft: 2, local: 0, transient: 0, unknown: 2,
    formation: 0, formationAircraft: 0, suaTraversal: 1, alertScramble: 0,
    excluded: 1, excludedByReason: { REJECTED_REPLICA: 1 },
  });
  assert.deepEqual(body.facilities.TACTICAL.totals.excludedByReason, { MISSION_LINE: 1 });
  assert.equal(body.facilities.TACTICAL.totals.flights, 0);

  const converted = counter.records().find(r => r.stripId === outAndBack.stripId);
  assert.equal(converted.legs, 2);
  assert.equal(converted.localityBasis, 'CONVERTED_ARRIVAL');
  assert.equal(body.reconciliation.ok, true);
});

// ── negative controls: each would pass vacuously if the check did nothing ──

test('NEGATIVE a drop in the log with no count record is reported missing', () => {
  const log = efsp.mutationLog.readAll();
  const template = log.find(e => e.after && e.after.state === 'DROPPED');
  const fabricated = { ...template, clientMutationId: 'fabricated-drop', stripId: 'strip-nobody-counted', at: template.at + 1 };
  const result = reconcileTrafficCount([...log, fabricated], countFileEntries(), {});
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing.map(m => m.stripId), ['strip-nobody-counted']);
});

test('NEGATIVE a COUNT line removed from the count file is reported missing', () => {
  const entries = countFileEntries();
  const idx = entries.findIndex(e => e.type === 'COUNT' && e.counted);
  const removed = entries[idx];
  const result = reconcileTrafficCount(efsp.mutationLog.readAll(), entries.filter((_, i) => i !== idx), {});
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing.map(m => m.countId), [removed.countId]);
});

test('NEGATIVE a record whose suaTraversal disagrees with the log is reported mismatched', () => {
  const entries = countFileEntries();
  const sua = entries.find(e => e.type === 'COUNT' && e.suaTraversal.length > 0);
  const tampered = entries.map(e => (e === sua ? { ...e, suaTraversal: [] } : e));
  const result = reconcileTrafficCount(efsp.mutationLog.readAll(), tampered, {});
  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatched, [{ countId: sua.countId, field: 'suaTraversal', log: ['MOA-SORTIE'], count: [] }]);
});

test('NEGATIVE a count record with no drop in the log is reported extra', () => {
  const entries = countFileEntries();
  const phantom = { ...entries.find(e => e.type === 'COUNT'), countId: 'phantom:1', stripId: 'phantom' };
  const result = reconcileTrafficCount(efsp.mutationLog.readAll(), [...entries, phantom], {});
  assert.equal(result.ok, false);
  assert.deepEqual(result.extra.map(x => x.countId), ['phantom:1']);
});

test('NEGATIVE an undo the count never voided is reported extra', () => {
  // Strip the VOID line: the undone drop now looks live on the count side.
  const entries = countFileEntries().filter(e => e.type !== 'VOID');
  const result = reconcileTrafficCount(efsp.mutationLog.readAll(), entries, {});
  assert.equal(result.ok, false);
  assert.equal(result.extra.length, 1);
});

test('a window cuts both sides to the same drops', () => {
  const log = efsp.mutationLog.readAll();
  const live = counter.records();
  const mid = live[Math.floor(live.length / 2)].droppedAt;
  const result = reconcileTrafficCount(log, countFileEntries(), { from: mid, to: mid + 1 });
  assert.equal(result.ok, true);
  assert.ok(result.expected >= 1);
  assert.equal(result.expected, result.actual);
});
