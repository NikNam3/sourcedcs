import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// The minimal VFR strip (docs/adr/0146, H174, H175): a controller tags a track at any Position (StartFlightFollowing:
// flight data, a VFR strip TRACKED in the Position's VFR Bay, the binding, no code unless asked), hands it off the STARS
// way (VfrHandoff: initiate, the receiver accepts), assigns HDG/SPD/ALT on its clearance cells, changes it to IFR and
// back in place (ChangeFlightRules), and ends it with "Radar service terminated".

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-vfr-'));
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
const { freshEfsp, mustAct, act, activate, steppedWallClock, DEPARTURE_FLIGHT_DATA, airborneDeparture } = await import('./helpers/efsp-scenario.mjs');

const ATC = { OPS: 'INCIRLIK', CD: 'INCIRLIK', GC: 'INCIRLIK', LC: 'INCIRLIK', AP: 'INCIRLIK', CTR: 'CENTER' };

/** One round trip: the ack and the frames it broadcast. */
function send(efsp, member, positionId, op, strip = null, cmid = crypto.randomUUID()) {
  return efsp.handleMessage(member.session, {
    version: 1, type: 'efsp-mutation', clientMutationId: cmid, facilityId: member.facilityId,
    actingPositionId: positionId, stripId: strip ? strip.stripId : undefined, baseRev: strip ? strip.rev : undefined, op,
  });
}

const TAG = (trackId, callsign = 'N123AB', aircraftData = 'C172', extra = {}) => ({ kind: 'StartFlightFollowing', trackId, flightData: { callsign, aircraftData }, ...extra });
const board = (efsp, facilityId = 'INCIRLIK') => efsp.boardStoreFor(facilityId);
const live = (efsp, strip, facilityId = 'INCIRLIK') => board(efsp, facilityId).getStrip(strip.stripId);
const fdOf = (efsp, strip) => efsp.flightDataStore.getFlightData(strip.flightDataId);
function correlationFrames(out) { return out.broadcasts.filter(f => f.type === 'efsp-correlation-delta'); }

test('tagging a track: flight data, a VFR strip TRACKED in the Position\'s VFR Bay, the binding, and no code, in one Mutation', () => {
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  const out = send(efsp, c.CTR, 'CTR', TAG('501', 'N123', '2/C172'));
  assert.equal(out.ack.ok, true, JSON.stringify(out.ack));
  const strip = out.ack.strip;
  assert.equal(strip.stripType, 'VFR');
  assert.equal(strip.state, 'TRACKED');
  assert.equal(strip.ownerPositionId, 'CTR');
  assert.equal(strip.bayId, 'ctr-overflight', 'the Bay the facility file marks vfr');
  const fd = efsp.flightDataStore.getFlightData(strip.flightDataId);
  assert.equal(fd.identity.callsign, 'N123');
  assert.equal(fd.identity.aircraftType, 'C172');
  assert.equal(fd.identity.flightSize, 2);
  assert.equal(fd.identity.beaconAssigned, null, 'a primary target needs no code (H175 VR-Q4)');
  assert.equal(fd.filed.directionOfFlight, undefined, 'Block 9K is gone');

  const record = efsp.correlationStore.getCorrelation(strip.flightDataId);
  assert.equal(record.state, 'CORRELATED');
  assert.equal(record.matchedBy, 'BINDING');
  assert.equal(record.trackId, '501');
  assert.equal(record.binding.boundPositionId, 'CTR');
  const frames = correlationFrames(out);
  assert.equal(frames.length, 1);
  assert.ok(out.broadcasts.findIndex(f => f.type === 'efsp-board-delta') < out.broadcasts.indexOf(frames[0]));
  assert.equal(out.ack.undoable.label, 'VFR N123');
  const entry = efsp.mutationLog.readAll().find(e => e.op === 'StartFlightFollowing' && e.stripId === strip.stripId);
  assert.ok(entry, 'one Board entry');
  assert.equal(entry.flightFollowing.trackId, '501');
  assert.equal(entry.correlation.matchedBy, 'BINDING');
});

test('any Position that works traffic tags, on the ground or in the air, in its own VFR Bay; the type is optional; `code: true` gives a discrete code', () => {
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  const bays = { CD: 'cd-cleared', GC: 'gc-taxi-out', LC: 'lc-runway-queue', AP: 'ap-overflight' };
  let n = 600;
  for (const [pos, bayId] of Object.entries(bays)) {
    const out = send(efsp, c[pos], pos, TAG(String(++n), `N${n}`, '')).ack;
    assert.equal(out.ok, true, `${pos}: ${JSON.stringify(out)}`);
    assert.equal(out.strip.bayId, bayId, pos);
    assert.equal(efsp.flightDataStore.getFlightData(out.strip.flightDataId).identity.aircraftType, '', `${pos}: no type typed`);
  }
  const coded = send(efsp, c.AP, 'AP', TAG('699', 'N699', 'C172', { code: true })).ack;
  assert.match(efsp.flightDataStore.getFlightData(coded.strip.flightDataId).identity.beaconAssigned, /^[0-7]{4}$/);
  // A named Bay of the acting Position, never one with a view of its own.
  assert.equal(send(efsp, c.LC, 'LC', TAG('698', 'N698', '', { bayId: 'lc-pattern' })).ack.strip.bayId, 'lc-pattern');
  assert.equal(send(efsp, c.LC, 'LC', TAG('697', 'N697', '', { bayId: 'ap-overflight' })).ack.reason, 'VALIDATION_ERROR');
});

test('tagging is refused, with no side effects, on a tagged track, at OPS (works no traffic), and on bad input', () => {
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  assert.equal(send(efsp, c.CTR, 'CTR', TAG('700', 'N1')).ack.ok, true);
  const before = efsp.flightDataStore.getAll().length;
  const again = send(efsp, c.AP, 'AP', TAG('700', 'N2')).ack;
  assert.equal(again.reason, 'VALIDATION_ERROR');
  assert.match(again.detail, /already tagged as N1/, 'two controllers tag the same track: the second is told who has it');
  assert.equal(send(efsp, c.OPS, 'OPS', TAG('701', 'N3')).ack.reason, 'PERMISSION_DENIED');
  for (const bad of [TAG('', 'N4'), TAG('702', ''), TAG('702', 'N4', 'X'), TAG('702', 'N4', 'C172', { code: 'yes' })]) {
    const r = send(efsp, c.CTR, 'CTR', bad).ack;
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.reason, 'VALIDATION_ERROR');
  }
  assert.equal(efsp.flightDataStore.getAll().length, before, 'no flight data was made by a refusal');
  // A VFR strip is never typed up from nothing.
  const typed = act(efsp, c.AP, 'AP', null, { kind: 'CreateStrip', bayId: 'ap-overflight', rackId: 'main', stripType: 'VFR', flightData: { callsign: 'N5' } });
  assert.equal(typed.ok, false);
  assert.match(typed.detail, /started from its track/);
});

test('AssignCode gives the flight a discrete code once; with no code free, refused', () => {
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  let strip = send(efsp, c.AP, 'AP', TAG('710', 'N710')).ack.strip;
  const alloc = efsp.flightDataStore.codeAllocator;
  const real = alloc.allocate.bind(alloc);
  alloc.allocate = () => ({ error: 'POOL_EXHAUSTED' });
  try {
    const r = act(efsp, c.AP, 'AP', strip, { kind: 'AssignCode' });
    assert.equal(r.ok, false);
    assert.equal(r.detail, 'no discrete beacon code is free');
  } finally { alloc.allocate = real; }
  strip = live(efsp, strip);
  const ok = act(efsp, c.AP, 'AP', strip, { kind: 'AssignCode' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const code = fdOf(efsp, strip).identity.beaconAssigned;
  assert.match(code, /^[0-7]{4}$/);
  assert.equal(alloc.holderOf(code), strip.flightDataId);
  assert.match(act(efsp, c.AP, 'AP', live(efsp, strip), { kind: 'AssignCode' }).detail, /already has code/);
});

test('HDG, SPD and ALT on a VFR strip are its clearance cells: assigned, cancelled (empty), and conformance holds it to them', () => {
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  let strip = send(efsp, c.AP, 'AP', TAG('720', 'N720')).ack.strip;
  for (const [blockId, value] of [['7A', '045'], ['9A-VECTOR', '270'], ['9A-SPEED', '120']]) {
    strip = mustAct(efsp, c.AP, 'AP', strip, { kind: 'SetBlock', blockId, value });
  }
  const fd = fdOf(efsp, strip);
  assert.equal(fd.clearance.altitude.entries.at(-1).parsed, 4500);
  assert.equal(fd.clearance.heading.entries.at(-1).parsed, 270);
  strip = mustAct(efsp, c.AP, 'AP', strip, { kind: 'SetBlock', blockId: '7A', value: '' });
  assert.equal(fdOf(efsp, strip).clearance.altitude.entries.at(-1).value, '', 'an emptied value is no clearance');
  // Conformance on the assigned heading (it reads the clearance whatever the strip type).
  const track = { id: '720', callsign: '', squawk: null, coalition: 3, type: 'C-172', lat: 37.1, lon: 35.1, alt: 1400, heading: 90, course: 90, groundSpeed: 55, verticalSpeed: 0, category: 1 };
  const monitor = new ConformanceMonitor({
    trackStore: { get: (id) => (id === '720' ? track : null) },
    flightDataStore: efsp.flightDataStore, correlationStore: efsp.correlationStore,
    weather: () => ({ pressurePa: 101325, tempK: 288 }), transitionAltFt: () => 18000, indicatedAltFt: (alt) => alt * 3.28084,
    config: { headingToleranceDeg: 15, headingPersistSec: 0, headingTurnRateDegPerSec: 3, headingTurnMaxBankDeg: 25, headingGraceMarginSec: 0, wrongWayFpm: 100, wrongWayPersistSec: 0, levelBustFt: 200, levelBustPersistSec: 0, atAltitudeBandFt: 100, minGroundSpeedKt: 0 },
    gridToMagnetic: (deg) => deg,
  });
  const t0 = Date.now() + 600000;
  for (let i = 0; i < 5; i++) monitor.tick(t0 + i * 1000, t0 + i * 1000);
  assert.ok(monitor.getAll().some(a => a.flightDataId === strip.flightDataId), JSON.stringify(monitor.getAll()));
});

test('the STARS handoff: initiate (the holder keeps it), the receiver accepts (its VFR Bay), recall, and who may do what', () => {
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  let strip = send(efsp, c.AP, 'AP', TAG('730', 'N730')).ack.strip;
  // A one-click transfer is not how a VFR moves.
  assert.match(act(efsp, c.AP, 'AP', strip, { kind: 'TransferStrip', toPositionId: 'LC', bayId: 'lc-runway-queue', rackId: 'rwy-05' }).detail, /receiver accepts/);
  for (const [to, re] of [['AP', /already holds/], ['', /name the Position/], ['CTR', /not a Position of this Facility/], ['OPS', /does not work VFR/]]) {
    assert.match(act(efsp, c.AP, 'AP', strip, { kind: 'VfrHandoff', action: 'INITIATE', toPositionId: to }).detail, re, to);
  }
  strip = mustAct(efsp, c.AP, 'AP', strip, { kind: 'VfrHandoff', action: 'INITIATE', toPositionId: 'LC' });
  assert.equal(strip.ownerPositionId, 'AP', 'the transferring Position still holds it');
  assert.equal(strip.vfrHandoff.toPositionId, 'LC');
  assert.match(act(efsp, c.AP, 'AP', strip, { kind: 'VfrHandoff', action: 'INITIATE', toPositionId: 'GC' }).detail, /recall it first/);
  assert.equal(act(efsp, c.GC, 'GC', strip, { kind: 'VfrHandoff', action: 'ACCEPT' }).reason, 'NOT_OWNER', 'only the Position named accepts');
  assert.equal(act(efsp, c.LC, 'LC', strip, { kind: 'VfrHandoff', action: 'RECALL' }).reason, 'NOT_OWNER');
  strip = mustAct(efsp, c.AP, 'AP', strip, { kind: 'VfrHandoff', action: 'RECALL' });
  assert.equal(strip.vfrHandoff, null);
  strip = mustAct(efsp, c.AP, 'AP', strip, { kind: 'VfrHandoff', action: 'INITIATE', toPositionId: 'LC' });
  strip = mustAct(efsp, c.LC, 'LC', strip, { kind: 'VfrHandoff', action: 'ACCEPT' });
  assert.equal(strip.ownerPositionId, 'LC');
  assert.equal(strip.bayId, 'lc-runway-queue');
  assert.equal(strip.vfrHandoff, null);
  assert.equal(efsp.correlationStore.getCorrelation(strip.flightDataId).trackId, '730', 'the binding stays');
  const entries = efsp.mutationLog.readAll().filter(e => e.op === 'VfrHandoff' && e.stripId === strip.stripId);
  assert.deepEqual(entries.map(e => e.vfrHandoff.action), ['INITIATE', 'RECALL', 'INITIATE', 'ACCEPT']);
});

test('the walk at LTAG: GC tags a departure, hands it to LC, the runway queue by runway, departs, closed traffic, lands, back to GC, terminated', () => {
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  let strip = send(efsp, c.GC, 'GC', TAG('740', 'N740', 'C172')).ack.strip;
  assert.equal(strip.bayId, 'gc-taxi-out');
  strip = mustAct(efsp, c.GC, 'GC', strip, { kind: 'SetBlock', blockId: '8A', value: '23' });
  strip = mustAct(efsp, c.GC, 'GC', strip, { kind: 'VfrHandoff', action: 'INITIATE', toPositionId: 'LC' });
  strip = mustAct(efsp, c.LC, 'LC', strip, { kind: 'VfrHandoff', action: 'ACCEPT' });
  assert.deepEqual([strip.bayId, strip.rackId], ['lc-runway-queue', 'rwy-23'], 'the runway queue rack is its runway');
  strip = mustAct(efsp, c.LC, 'LC', strip, { kind: 'LeavePattern' });
  assert.deepEqual([strip.bayId, strip.stripType, strip.state], ['lc-airborne', 'VFR', 'TRACKED'], 'departed: a place, not a lifecycle step');
  strip = mustAct(efsp, c.LC, 'LC', strip, { kind: 'JoinPattern' });
  assert.equal(strip.bayId, 'lc-pattern');
  strip = mustAct(efsp, c.LC, 'LC', strip, { kind: 'MoveStrip', bayId: 'lc-landed', rackId: 'main' });
  assert.deepEqual([strip.bayId, strip.state], ['lc-landed', 'TRACKED'], 'a drag never applies a Bay\'s implied state');
  assert.match(act(efsp, c.LC, 'LC', strip, { kind: 'MoveStrip', bayId: 'par-final', rackId: 'main' }).detail, /does not go in|not a Bay|no such Bay/);
  strip = mustAct(efsp, c.LC, 'LC', strip, { kind: 'VfrHandoff', action: 'INITIATE', toPositionId: 'GC' });
  strip = mustAct(efsp, c.GC, 'GC', strip, { kind: 'VfrHandoff', action: 'ACCEPT' });
  const out = send(efsp, c.GC, 'GC', { kind: 'TerminateRadarService' }, strip);
  assert.equal(out.ack.ok, true, JSON.stringify(out.ack));
  assert.equal(live(efsp, strip).state, 'DROPPED');
  assert.equal(efsp.correlationStore.holderOfTrack('740'), null);
  // No takeoff stamp: a VFR strip has no DEPARTED state.
  assert.equal(fdOf(efsp, strip).timeInputs.takeoffStampedUtc ?? null, null);
});

test('VFR pops up IFR in place (same strip, binding, code, history); IFR cancels IFR in the air back to a VFR strip', () => {
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  let strip = send(efsp, c.AP, 'AP', TAG('750', 'N750')).ack.strip;
  strip = mustAct(efsp, c.AP, 'AP', strip, { kind: 'SetBlock', blockId: '7A', value: '045' });
  // LC originates no IFR strip, so it cannot convert one (a pop-up IFR is the radar Position's or CD's).
  assert.equal(act(efsp, c.AP, 'AP', strip, { kind: 'ChangeFlightRules', to: 'IFR', stripType: 'MISSION' }).reason, 'VALIDATION_ERROR');
  const ifr = mustAct(efsp, c.AP, 'AP', strip, { kind: 'ChangeFlightRules', to: 'IFR', stripType: 'OVERFLIGHT' });
  assert.equal(ifr.stripId, strip.stripId);
  assert.deepEqual([ifr.stripType, ifr.state, ifr.bayId], ['OVERFLIGHT', 'IN_SECTOR', 'ap-overflight']);
  assert.equal(ifr.previousLeg.stripType, 'VFR');
  const code = fdOf(efsp, ifr).identity.beaconAssigned;
  assert.match(code, /^[0-7]{4}$/, 'an IFR flight is given a code');
  assert.equal(efsp.correlationStore.getCorrelation(ifr.flightDataId).trackId, '750');
  assert.equal(fdOf(efsp, ifr).clearance.altitude.entries.at(-1).parsed, 4500, 'the assignment stands as IFR');

  const back = mustAct(efsp, c.AP, 'AP', ifr, { kind: 'ChangeFlightRules', to: 'VFR' });
  assert.deepEqual([back.stripId, back.stripType, back.state, back.bayId], [strip.stripId, 'VFR', 'TRACKED', 'ap-overflight']);
  assert.equal(fdOf(efsp, back).identity.beaconAssigned, code, 'the code stays');
  assert.equal(fdOf(efsp, back).clearance.altitude.entries.at(-1).value, '', 'the IFR altitude no longer applies');
  assert.equal(efsp.correlationStore.getCorrelation(back.flightDataId).trackId, '750');
  const rules = efsp.mutationLog.readAll().filter(e => e.op === 'ChangeFlightRules' && e.stripId === strip.stripId);
  assert.deepEqual(rules.map(e => e.flightRules.to), ['IFR', 'VFR']);

  // An airborne IFR departure cancels IFR at AP: it stays in AP's Bay as a VFR strip.
  const dep = airborneDeparture(efsp, c, { ...DEPARTURE_FLIGHT_DATA, callsign: 'CNX1' });
  const cx = send(efsp, c.AP, 'AP', { kind: 'ChangeFlightRules', to: 'VFR' }, dep).ack;
  assert.equal(cx.ok, true, JSON.stringify(cx));
  assert.deepEqual([cx.strip.stripType, cx.strip.bayId], ['VFR', dep.bayId]);
  assert.equal(cx.undoable.label, 'IFR cancelled CNX1');
  // Undo takes it back to the IFR strip.
  const undo = send(efsp, c.AP, 'AP', { kind: 'Undo', actionId: cx.undoable.actionId }).ack;
  assert.equal(undo.ok, true, JSON.stringify(undo));
  assert.equal(live(efsp, dep).stripType, 'DEPARTURE');
});

test('Undo of a tag takes the whole thing back: strip, flight data, any code and the binding', () => {
  const wallClock = steppedWallClock();
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test', wallClock });
  const started = send(efsp, c.CTR, 'CTR', TAG('900', 'N900', 'C172', { code: true }));
  const strip = started.ack.strip;
  const code = efsp.flightDataStore.getFlightData(strip.flightDataId).identity.beaconAssigned;
  const undone = send(efsp, c.CTR, 'CTR', { kind: 'Undo', actionId: started.ack.undoable.actionId });
  assert.equal(undone.ack.ok, true, JSON.stringify(undone.ack));
  assert.equal(board(efsp, 'CENTER').getStrip(strip.stripId), null);
  assert.equal(efsp.flightDataStore.getFlightData(strip.flightDataId), null);
  assert.equal(efsp.flightDataStore.codeAllocator.holderOf(code), null);
  assert.equal(efsp.correlationStore.holderOfTrack('900'), null);
  assert.equal(correlationFrames(undone)[0].correlations.updated[0].state, 'UNCORRELATED');
  assert.equal(send(efsp, c.CTR, 'CTR', TAG('900', 'N900')).ack.ok, true);
});

test('VFR into active restricted airspace: approved entry, then Radar service terminated (dropped, entry cleared, untracked); Undo puts it back', () => {
  const wallClock = steppedWallClock();
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test', wallClock });
  activate(efsp, c, 'R-FF');
  const strip = send(efsp, c.CTR, 'CTR', TAG('950', 'N950', 'C172', { code: true })).ack.strip;
  const working = mustAct(efsp, c.CTR, 'CTR', strip, { kind: 'ApproveAirspaceEntry', airspaceId: 'R-FF' });
  const code = fdOf(efsp, strip).identity.beaconAssigned;
  assert.equal(fdOf(efsp, strip).comms.workingFrequencyMhz, 133.0);
  const out = send(efsp, c.CTR, 'CTR', { kind: 'TerminateRadarService' }, working);
  assert.equal(out.ack.ok, true, JSON.stringify(out.ack));
  const dropped = live(efsp, strip, 'CENTER');
  assert.equal(dropped.state, 'DROPPED');
  assert.equal(dropped.airspaceEntry, null);
  assert.ok(!efsp.flightDataStore.codeAllocator.holderOf(code));
  assert.equal(efsp.correlationStore.holderOfTrack('950'), null);
  assert.equal(out.ack.undoable.label, 'Radar service terminated N950');
  const undone = send(efsp, c.CTR, 'CTR', { kind: 'Undo', actionId: out.ack.undoable.actionId });
  assert.equal(undone.ack.ok, true, JSON.stringify(undone.ack));
  assert.equal(live(efsp, strip, 'CENTER').state, 'TRACKED');
  assert.deepEqual(efsp.correlationStore.holderOfTrack('950'), { flightDataId: strip.flightDataId, state: 'CORRELATED' });
});

test('Radar service terminated is the holder\'s', () => {
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  const strip = send(efsp, c.AP, 'AP', TAG('960', 'N960')).ack.strip;
  assert.equal(act(efsp, c.LC, 'LC', strip, { kind: 'TerminateRadarService' }).reason, 'NOT_OWNER');
  assert.equal(act(efsp, c.OPS, 'OPS', strip, { kind: 'TerminateRadarService' }).reason, 'PERMISSION_DENIED');
});

test('track lost and back: the binding is kept while the picture misses it (a second tag still refused) and correlates again, code or not', () => {
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  const strip = send(efsp, c.CTR, 'CTR', TAG('990', 'N990')).ack.strip;
  const track = { id: '990', callsign: '', squawk: null, coalition: 3, type: 'C-172', lat: 37.1, lon: 35.1, alt: 1500, heading: 90, course: 90, groundSpeed: 55, verticalSpeed: 0, category: 1 };
  let tracks = [];
  const reconciler = new CorrelationReconciler({
    beaconOf: (t) => octalCode(t.squawk), trackStore: { getAll: () => tracks },
    flightDataStore: efsp.flightDataStore, correlationStore: efsp.correlationStore,
    boardStoreFor: efsp.boardStoreFor, facilityConfig, onDelta: () => {},
  });
  reconciler.tick();
  const record = efsp.correlationStore.getCorrelation(strip.flightDataId);
  assert.equal(record.state, 'UNCORRELATED');
  assert.equal(record.binding.trackId, '990');
  assert.match(send(efsp, c.AP, 'AP', TAG('990', 'N991')).ack.detail, /already tagged as N990/);
  tracks = [track];
  reconciler.tick();
  assert.equal(efsp.correlationStore.getCorrelation(strip.flightDataId).state, 'CORRELATED');
  assert.equal(efsp.correlationStore.getCorrelation(strip.flightDataId).trackId, '990');
});

test('Conflict Alert treats a tagged VFR as a tracked aircraft', async () => {
  const { ConflictAlertMonitor } = await import('../src/conflict-alert.js');
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  send(efsp, c.CTR, 'CTR', TAG('980', 'N980'));
  const a = { id: '980', lat: 37.0, lon: 35.0, alt: 1500, course: 90, groundSpeed: 60, verticalSpeed: 0, category: 1, firstSeenAt: 0 };
  const b = { id: '981', lat: 37.0, lon: 35.05, alt: 1500, course: 270, groundSpeed: 60, verticalSpeed: 0, category: 1, firstSeenAt: 0 };
  const monitor = new ConflictAlertMonitor({
    trackStore: { getAll: () => [a, b] },
    config: { lookAheadSec: 120, lateralNm: 3, verticalFt: 1000, minGroundSpeedKt: 0, minTrackAgeSec: 0 },
    flightDataForTrack: (id) => efsp.correlationStore.flightDataForTrack(id),
    activeMarsaFor: () => null,
  });
  monitor.tick();
  assert.equal(monitor.getAll().length >= 1, true);
});
