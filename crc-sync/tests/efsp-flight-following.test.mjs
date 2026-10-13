import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// Flight following on a contact with no Strip (H136, docs/wip/LT-VFR.md): "Start flight following" makes flight data,
// a discrete code, an OVERFLIGHT Strip IN_SECTOR and the binding in one Mutation; "Radar service terminated" drops it,
// releases the code, clears the airspace entry and ends the binding. Undo takes either back.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-ff-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, JSON.stringify({ Test: [
  { airspaceId: 'R-FF', name: 'Restricted FF', type: 'RESTRICTED', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 133.0 },
] }));

const { createEfsp } = await import('../src/efsp/index.js');
const facilityConfig = (await import('../src/efsp/facility-config.js')).createFacilityConfig();
const { CorrelationReconciler } = await import('../src/efsp/correlation-reconciler.js');
const { ConformanceMonitor } = await import('../src/efsp/conformance.js');
const { octalCode } = await import('../src/surveillance/transponder.js');
const { freshEfsp, mustAct, activate, steppedWallClock, DEPARTURE_FLIGHT_DATA, airborneDeparture } = await import('./helpers/efsp-scenario.mjs');

const ATC = { OPS: 'INCIRLIK', CD: 'INCIRLIK', GC: 'INCIRLIK', LC: 'INCIRLIK', AP: 'INCIRLIK', CTR: 'CENTER' };

/** One round trip: the ack and the frames it broadcast. */
function send(efsp, member, positionId, op, strip = null, cmid = crypto.randomUUID()) {
  return efsp.handleMessage(member.session, {
    version: 1, type: 'efsp-mutation', clientMutationId: cmid, facilityId: member.facilityId,
    actingPositionId: positionId, stripId: strip ? strip.stripId : undefined, baseRev: strip ? strip.rev : undefined, op,
  });
}

const START = (trackId, callsign = 'N123AB', aircraftData = 'C172') => ({ kind: 'StartFlightFollowing', trackId, flightData: { callsign, aircraftData } });

function correlationFrames(out) { return out.broadcasts.filter(f => f.type === 'efsp-correlation-delta'); }

test('Start flight following: flight data, a discrete code, an OVERFLIGHT Strip IN_SECTOR, bound to the contact, in one Mutation', () => {
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  const out = send(efsp, c.CTR, 'CTR', START('501', 'N123', '2/C172'));
  assert.equal(out.ack.ok, true, JSON.stringify(out.ack));
  const strip = out.ack.strip;
  assert.equal(strip.stripType, 'OVERFLIGHT');
  assert.equal(strip.state, 'IN_SECTOR');
  assert.equal(strip.ownerPositionId, 'CTR');
  assert.equal(strip.bayId, 'ctr-overflight');
  const fd = efsp.flightDataStore.getFlightData(strip.flightDataId);
  assert.equal(fd.identity.callsign, 'N123');
  assert.equal(fd.identity.aircraftType, 'C172');
  assert.equal(fd.identity.flightSize, 2);
  assert.match(fd.identity.beaconAssigned, /^[0-7]{4}$/);
  assert.equal(efsp.flightDataStore.codeAllocator.holderOf(fd.identity.beaconAssigned), fd.flightDataId);
  // VFR the FAA way: no clearance at all (H136 VQ2).
  assert.equal(fd.clearance.altitude.entries.length, 0);
  assert.equal(fd.clearance.heading.entries.length, 0);

  const record = efsp.correlationStore.getCorrelation(strip.flightDataId);
  assert.equal(record.state, 'CORRELATED');
  assert.equal(record.matchedBy, 'BINDING');
  assert.equal(record.trackId, '501');
  assert.equal(record.binding.boundPositionId, 'CTR');

  // The binding rides the same round trip, after the Board delta.
  const frames = correlationFrames(out);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].correlations.updated[0].flightDataId, strip.flightDataId);
  assert.ok(out.broadcasts.findIndex(f => f.type === 'efsp-board-delta') < out.broadcasts.indexOf(frames[0]));
  assert.equal(out.ack.undoable.label, 'Flight following N123');

  // Audited as one action.
  const entry = efsp.mutationLog.readAll().find(e => e.op === 'StartFlightFollowing' && e.stripId === strip.stripId);
  assert.ok(entry, 'one Board entry');
  assert.equal(entry.flightFollowing.trackId, '501');
  assert.equal(entry.correlation.matchedBy, 'BINDING');
  assert.equal(entry.before, null);
});

test('Start flight following at AP lands in its Overflight Bay', () => {
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  const out = send(efsp, c.AP, 'AP', START('601', 'N9'));
  assert.equal(out.ack.ok, true, JSON.stringify(out.ack));
  assert.equal(out.ack.strip.bayId, 'ap-overflight');
});

test('Start flight following is refused, with no side effects, on a correlated contact, at a Position that works no overflights, and on bad input', () => {
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  assert.equal(send(efsp, c.CTR, 'CTR', START('700', 'N1')).ack.ok, true);
  const before = efsp.flightDataStore.getAll().length;

  const again = send(efsp, c.AP, 'AP', START('700', 'N2')).ack;
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'VALIDATION_ERROR');
  assert.match(again.detail, /already correlated to N1/);

  const ops = send(efsp, c.OPS, 'OPS', START('701', 'N3')).ack;
  assert.equal(ops.ok, false);
  assert.equal(ops.reason, 'PERMISSION_DENIED');
  const lc = send(efsp, c.LC, 'LC', START('701', 'N3')).ack;
  assert.equal(lc.ok, false);
  assert.equal(lc.reason, 'PERMISSION_DENIED');

  for (const bad of [START('', 'N4'), START('702', ''), START('702', 'N4', ''), START('702', 'N4', 'X')]) {
    const r = send(efsp, c.CTR, 'CTR', bad).ack;
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.reason, 'VALIDATION_ERROR');
  }
  assert.equal(efsp.flightDataStore.getAll().length, before, 'no flight data, so no code, was spent on a refusal');
});

test('no discrete code free: refused, nothing created', () => {
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  const alloc = efsp.flightDataStore.codeAllocator;
  const real = alloc.allocate.bind(alloc);
  alloc.allocate = () => ({ error: 'POOL_EXHAUSTED' });
  try {
    const r = send(efsp, c.CTR, 'CTR', START('800', 'N8')).ack;
    assert.equal(r.ok, false);
    assert.equal(r.detail, 'no discrete beacon code is free');
    assert.equal(efsp.boardStoreFor('CENTER').getAll().length, 0);
    assert.equal(efsp.correlationStore.holderOfTrack('800'), null);
  } finally { alloc.allocate = real; }
});

test('Undo of Start flight following takes the whole thing back: Strip, flight data, code and binding', () => {
  const wallClock = steppedWallClock();
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test', wallClock });
  const started = send(efsp, c.CTR, 'CTR', START('900', 'N900'));
  const strip = started.ack.strip;
  const code = efsp.flightDataStore.getFlightData(strip.flightDataId).identity.beaconAssigned;

  const undone = send(efsp, c.CTR, 'CTR', { kind: 'Undo', actionId: started.ack.undoable.actionId });
  assert.equal(undone.ack.ok, true, JSON.stringify(undone.ack));
  assert.equal(efsp.boardStoreFor('CENTER').getStrip(strip.stripId), null, 'the Strip is gone');
  assert.equal(efsp.flightDataStore.getFlightData(strip.flightDataId), null, 'its flight data is archived');
  assert.equal(efsp.flightDataStore.codeAllocator.holderOf(code), null, 'its code is released');
  assert.equal(efsp.correlationStore.holderOfTrack('900'), null, 'the contact is untracked again');
  const undoEntry = efsp.mutationLog.readAll().find(e => e.op === 'Undo' && e.undoneActionId === started.ack.undoable.actionId);
  assert.ok(undoEntry, 'the Undo is audited, naming the Strip it removed');
  assert.equal(undoEntry.removed, true);
  assert.equal(undoEntry.stripId, strip.stripId);
  const frames = correlationFrames(undone);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].correlations.updated[0].state, 'UNCORRELATED');
  // The contact can be started again at once.
  assert.equal(send(efsp, c.CTR, 'CTR', START('900', 'N900')).ack.ok, true);
});

test('Approve entry into active airspace on a flight-following Strip, then Radar service terminated: dropped, code released, entry cleared, contact untracked', () => {
  const wallClock = steppedWallClock();
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test', wallClock });
  activate(efsp, c, 'R-FF');
  const strip = send(efsp, c.CTR, 'CTR', START('950', 'N950')).ack.strip;
  const working = mustAct(efsp, c.CTR, 'CTR', strip, { kind: 'ApproveAirspaceEntry', airspaceId: 'R-FF' });
  assert.equal(working.airspaceEntry.airspaceId, 'R-FF');
  const fd = efsp.flightDataStore.getFlightData(strip.flightDataId);
  const code = fd.identity.beaconAssigned;
  assert.equal(fd.comms.workingFrequencyMhz, 133.0);

  const out = send(efsp, c.CTR, 'CTR', { kind: 'TerminateRadarService' }, working);
  assert.equal(out.ack.ok, true, JSON.stringify(out.ack));
  const dropped = efsp.boardStoreFor('CENTER').getStrip(strip.stripId);
  assert.equal(dropped.state, 'DROPPED');
  assert.equal(dropped.airspaceEntry, null);
  assert.equal(efsp.flightDataStore.getFlightData(strip.flightDataId).comms.workingFrequencyMhz, null);
  assert.ok(!efsp.flightDataStore.codeAllocator.holderOf(code), 'the code is released');
  assert.equal(efsp.correlationStore.holderOfTrack('950'), null, 'the contact is untracked at once');
  assert.equal(correlationFrames(out).length, 1);
  assert.equal(out.ack.undoable.label, 'Radar service terminated N950');

  // Undo puts it all back, the binding included.
  const undone = send(efsp, c.CTR, 'CTR', { kind: 'Undo', actionId: out.ack.undoable.actionId });
  assert.equal(undone.ack.ok, true, JSON.stringify(undone.ack));
  const back = efsp.boardStoreFor('CENTER').getStrip(strip.stripId);
  assert.equal(back.state, 'IN_SECTOR');
  assert.equal(back.airspaceEntry.airspaceId, 'R-FF');
  assert.equal(efsp.flightDataStore.codeAllocator.holderOf(code), strip.flightDataId);
  assert.deepEqual(efsp.correlationStore.holderOfTrack('950'), { flightDataId: strip.flightDataId, state: 'CORRELATED' });
  assert.equal(correlationFrames(undone).length, 1);
});

test('Radar service terminated is AP/CTR only and the owner\'s', () => {
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  const dep = airborneDeparture(efsp, c, { ...DEPARTURE_FLIGHT_DATA, callsign: 'TRM1' });
  const lc = send(efsp, c.LC, 'LC', { kind: 'TerminateRadarService' }, dep).ack;
  assert.equal(lc.ok, false);
  assert.equal(lc.reason, 'PERMISSION_DENIED');
  const strip = send(efsp, c.CTR, 'CTR', START('960', 'N960')).ack.strip;
  const ap = efsp.handleMessage(c.AP.session, {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), facilityId: 'CENTER',
    actingPositionId: 'AP', stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'TerminateRadarService' },
  }).ack;
  assert.equal(ap.ok, false);
});

test('the reconciler keeps the binding, and conformance finds nothing to check on a Strip with no clearance', () => {
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  const strip = send(efsp, c.CTR, 'CTR', START('970', 'N970')).ack.strip;
  const track = { id: '970', callsign: '', squawk: null, coalition: 3, type: 'C-172', lat: 37.1, lon: 35.1, alt: 1500, heading: 90, course: 90, groundSpeed: 55, verticalSpeed: 0, category: 1 };
  const reconciler = new CorrelationReconciler({
    beaconOf: (t) => octalCode(t.squawk), trackStore: { getAll: () => [track] },
    flightDataStore: efsp.flightDataStore, correlationStore: efsp.correlationStore,
    boardStoreFor: efsp.boardStoreFor, facilityConfig, onDelta: () => {},
  });
  reconciler.tick();
  assert.equal(efsp.correlationStore.getCorrelation(strip.flightDataId).trackId, '970');
  assert.equal(efsp.correlationStore.getCorrelation(strip.flightDataId).matchedBy, 'BINDING');
  // Conformance: tracked, nothing assigned, so nothing to check and nothing thrown (H136 VQ2), even climbing hard.
  const monitor = new ConformanceMonitor({
    trackStore: { get: (id) => (id === '970' ? { ...track, verticalSpeed: 20 } : null) },
    flightDataStore: efsp.flightDataStore, correlationStore: efsp.correlationStore,
    weather: () => ({ pressurePa: 101325, tempK: 288 }), transitionAltFt: () => 18000, indicatedAltFt: (alt) => alt * 3.28084,
    config: { headingToleranceDeg: 15, headingPersistSec: 0, headingGraceSec: 0, wrongWayFpm: 100, wrongWayPersistSec: 0, levelBustFt: 200, levelBustPersistSec: 0, atAltitudeBandFt: 100, minGroundSpeedKt: 0 },
    gridToMagnetic: (deg) => deg,
  });
  for (let i = 0; i < 3; i++) monitor.tick(Date.now() + i * 1000, Date.now() + i * 1000);
  assert.deepEqual(monitor.getAll(), []);
});

test('Conflict Alert treats a flight-following contact as a tracked aircraft with nothing assigned', async () => {
  const { ConflictAlertMonitor } = await import('../src/conflict-alert.js');
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  send(efsp, c.CTR, 'CTR', START('980', 'N980'));
  const a = { id: '980', lat: 37.0, lon: 35.0, alt: 1500, course: 90, groundSpeed: 60, verticalSpeed: 0, category: 1, firstSeenAt: 0 };
  const b = { id: '981', lat: 37.0, lon: 35.05, alt: 1500, course: 270, groundSpeed: 60, verticalSpeed: 0, category: 1, firstSeenAt: 0 };
  const monitor = new ConflictAlertMonitor({
    trackStore: { getAll: () => [a, b] },
    config: { lookAheadSec: 120, lateralNm: 3, verticalFt: 1000, minGroundSpeedKt: 0, minTrackAgeSec: 0 },
    flightDataForTrack: (id) => efsp.correlationStore.flightDataForTrack(id),
    activeMarsaFor: () => null,
  });
  monitor.tick();
  assert.equal(monitor.getAll().length >= 1, true, 'the pair alerts; no clearance is not a crash');
});
