import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// The VFR departure (docs/adr/0143, H166): one action at the Position that gives departures their code (CD) makes flight
// data (callsign, type, direction of flight, the airfield, the runway), a discrete code and a DEPARTURE Strip in its
// CLEARED Bay, with no flight-plan lookup and none of the IFR clearance steps. The ordinary steps follow: GC, LC, the
// hand-off to AP, and "Radar service terminated" there. Undo takes it back.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-vfr-dep-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, JSON.stringify({ Test: [] }));

const { createEfsp } = await import('../src/efsp/index.js');
const { hasNoClearance } = await import('../src/efsp/vfr.js');
const { freshEfsp, mustAct, steppedWallClock, lapseNlaGuard } = await import('./helpers/efsp-scenario.mjs');
const permission = await import('../src/efsp/permission.js');
const { classPermission } = await import('./helpers/permission.mjs');
const blockMap = await import('../src/efsp/block-map.js');

const ATC = { OPS: 'INCIRLIK', CD: 'INCIRLIK', GC: 'INCIRLIK', LC: 'INCIRLIK', AP: 'INCIRLIK', CTR: 'CENTER' };

function send(efsp, member, positionId, op, strip = null, cmid = crypto.randomUUID()) {
  return efsp.handleMessage(member.session, {
    version: 1, type: 'efsp-mutation', clientMutationId: cmid, facilityId: member.facilityId,
    actingPositionId: positionId, stripId: strip ? strip.stripId : undefined, baseRev: strip ? strip.rev : undefined, op,
  });
}
const VFR = (flightData = {}) => ({ kind: 'CreateVfrDeparture', flightData: { callsign: 'VIPER11', aircraftData: '2/F16', directionOfFlight: 'NW', ...flightData } });
const fdOf = (efsp, strip) => efsp.flightDataStore.getFlightData(strip.flightDataId);

test('the VFR departure: flight data, a discrete code and a DEPARTURE Strip in CD\'s cleared Bay, in one Mutation', () => {
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  const out = send(efsp, c.CD, 'CD', VFR({ callsign: 'viper11', directionOfFlight: 'nw' }));
  assert.equal(out.ack.ok, true, JSON.stringify(out.ack));
  const strip = out.ack.strip;
  assert.equal(strip.stripType, 'DEPARTURE');
  assert.equal(strip.state, 'CLEARED', 'no clearance to review: it starts where the ordinary steps go on');
  assert.equal(strip.ownerPositionId, 'CD');
  assert.equal(strip.bayId, 'cd-cleared');
  const fd = fdOf(efsp, strip);
  assert.equal(fd.identity.callsign, 'VIPER11');
  assert.equal(fd.identity.aircraftType, 'F16');
  assert.equal(fd.identity.flightSize, 2);
  assert.equal(fd.filed.directionOfFlight, 'NW');
  assert.equal(fd.filed.departureAirport, 'LTAG', 'the airfield the Facility\'s runways belong to');
  assert.match(fd.identity.beaconAssigned, /^[0-7]{4}$/);
  assert.equal(efsp.flightDataStore.codeAllocator.holderOf(fd.identity.beaconAssigned), fd.flightDataId);
  assert.equal(out.ack.undoable.label, 'VFR departure VIPER11');
  // VFR: no clearance, nothing filed beyond the direction (no lookup ran: nothing else is filled in).
  assert.equal(hasNoClearance(fd), true);
  assert.deepEqual([fd.filed.route, fd.filed.requestedAltitude, fd.filed.destinationAirport], ['', '', '']);
  assert.equal(fd.assigned.departureRelease, 'RELEASED');
  assert.equal(fd.assigned.voidDeadlineUtc, null);
  // One audited action.
  const entries = efsp.mutationLog.readAll().filter(e => e.stripId === strip.stripId);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].op, 'CreateVfrDeparture');
  assert.equal(entries[0].vfrDeparture.beaconCode, fd.identity.beaconAssigned);
  assert.equal(entries[0].before, null);
});

test('the runway: the typed end of this airfield, else the active one; an unknown runway is refused', () => {
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  const typed = send(efsp, c.CD, 'CD', VFR({ callsign: 'R1', departureRunway: '23' })).ack;
  assert.equal(typed.ok, true, JSON.stringify(typed));
  assert.equal(fdOf(efsp, typed.strip).filed.departureRunway, '23');
  const active = efsp.runwayStatusStore.statusView('INCIRLIK').activeRunway;
  const none = send(efsp, c.CD, 'CD', VFR({ callsign: 'R2' })).ack;
  assert.equal(fdOf(efsp, none.strip).filed.departureRunway, active, 'the active runway (or none while it is unset)');
  const bad = send(efsp, c.CD, 'CD', VFR({ callsign: 'R3', departureRunway: '17' })).ack;
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /runway 17 is not a runway of this airfield/);
});

test('refused before the first write: bad input, a Position that does not give departures their code, no code free', () => {
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  const before = efsp.flightDataStore.getAll().length;
  for (const bad of [VFR({ callsign: '' }), VFR({ callsign: 'TOOLONG99' }), VFR({ aircraftData: '' }), VFR({ directionOfFlight: '' }),
    VFR({ directionOfFlight: 'NNW' }), VFR({ departureRunway: 'XX' })]) {
    const r = send(efsp, c.CD, 'CD', bad).ack;
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.reason, 'VALIDATION_ERROR');
  }
  for (const p of ['OPS', 'GC', 'LC', 'AP']) {
    const r = send(efsp, c[p], p, VFR()).ack;
    assert.equal(r.ok, false, p);
    assert.equal(r.reason, 'PERMISSION_DENIED', p);
  }
  const ctr = send(efsp, c.CTR, 'CTR', VFR()).ack;
  assert.equal(ctr.ok, false);
  const alloc = efsp.flightDataStore.codeAllocator;
  const real = alloc.allocate.bind(alloc);
  alloc.allocate = () => ({ error: 'POOL_EXHAUSTED' });
  try {
    const r = send(efsp, c.CD, 'CD', VFR({ callsign: 'NOCODE' })).ack;
    assert.equal(r.ok, false);
    assert.equal(r.detail, 'no discrete beacon code is free');
  } finally { alloc.allocate = real; }
  assert.equal(efsp.flightDataStore.getAll().length, before, 'no flight data, so no code, was spent on a refusal');
  assert.equal(efsp.boardStoreFor('INCIRLIK').getAll().length, 0);
});

test('who may: the grant is a ceiling; the op also needs DEPARTURE creation and the CLEARED state, named by no id', () => {
  const { canMutate } = classPermission();
  assert.equal(canMutate('CD', 'CreateVfrDeparture'), true);
  for (const p of ['OPS', 'GC', 'LC', 'AP', 'CTR', 'PAR', 'TAC_C2', 'CV_MARSHAL']) assert.equal(canMutate(p, 'CreateVfrDeparture'), false, p);
  assert.equal(permission.canCreateStripType('CD', 'DEPARTURE') && permission.canActOnState('CD', 'DEPARTURE', 'CLEARED'), true);
  const src = fs.readFileSync(new URL('../src/efsp/board/ops/create-vfr-departure.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /'(CD|OPS|GC|LC|AP|CTR)'/, 'no literal Position id in the rule (ADR 0132)');
});

test('the walk: CD gives the code, GC taxies, LC departs it, AP takes the hand-off and terminates radar service; the code is released', async () => {
  const wallClock = steppedWallClock();
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test', wallClock });
  let strip = send(efsp, c.CD, 'CD', VFR({ callsign: 'VIPER12', departureRunway: '23' })).ack.strip;
  const code = fdOf(efsp, strip).identity.beaconAssigned;
  const nla = async (positionId) => { await lapseNlaGuard(wallClock); strip = mustAct(efsp, c[positionId], positionId, strip, { kind: 'InvokeNla' }); return strip; };
  await nla('CD');
  assert.deepEqual([strip.state, strip.ownerPositionId], ['PUSHBACK', 'GC']);
  await nla('GC');
  assert.deepEqual([strip.state, strip.ownerPositionId], ['TAXI', 'GC']);
  await nla('GC');
  assert.deepEqual([strip.state, strip.ownerPositionId], ['RUNWAY_QUEUE', 'LC']);
  assert.equal(strip.rackId, 'rwy-23', 'queued for its runway');
  await nla('LC');
  assert.equal(strip.state, 'LUAW');
  await nla('LC');
  assert.equal(strip.state, 'DEPARTED');
  assert.ok(fdOf(efsp, strip).timeInputs.takeoffStampedUtc, 'the takeoff time is stamped as for any departure');
  await nla('LC');
  assert.deepEqual([strip.state, strip.ownerPositionId], ['HANDED_OFF', 'AP']);
  assert.equal(hasNoClearance(fdOf(efsp, strip)), true, 'still VFR at AP: nothing for conformance to check');
  // It leaves the MTMA, or the pilot cancels: "RADAR SERVICE TERMINATED, SQUAWK VFR".
  const out = send(efsp, c.AP, 'AP', { kind: 'TerminateRadarService' }, strip);
  assert.equal(out.ack.ok, true, JSON.stringify(out.ack));
  assert.equal(efsp.boardStoreFor('INCIRLIK').getStrip(strip.stripId).state, 'DROPPED');
  assert.ok(!efsp.flightDataStore.codeAllocator.holderOf(code), 'the code is released');
});

test('Undo of the VFR departure: the Strip removed, the flight data archived, the code released', () => {
  const wallClock = steppedWallClock();
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test', wallClock });
  const made = send(efsp, c.CD, 'CD', VFR({ callsign: 'UNDO1' }));
  const strip = made.ack.strip;
  const code = fdOf(efsp, strip).identity.beaconAssigned;
  const undone = send(efsp, c.CD, 'CD', { kind: 'Undo', actionId: made.ack.undoable.actionId });
  assert.equal(undone.ack.ok, true, JSON.stringify(undone.ack));
  assert.equal(efsp.boardStoreFor('INCIRLIK').getStrip(strip.stripId), null);
  assert.equal(efsp.flightDataStore.getFlightData(strip.flightDataId), null);
  assert.equal(efsp.flightDataStore.codeAllocator.holderOf(code), null);
  const entry = efsp.mutationLog.readAll().find(e => e.op === 'Undo' && e.undoneActionId === made.ack.undoable.actionId);
  assert.ok(entry);
  assert.equal(entry.removed, true);
});

test('Block 9K is the direction of flight on the DEPARTURE Block Map; SetBlock validates it', () => {
  assert.deepEqual(blockMap.resolveBlockTarget('DEPARTURE', '9K'), { kind: 'flightData', path: 'filed.directionOfFlight' });
  for (const t of ['ARRIVAL', 'OVERFLIGHT', 'MISSION']) assert.equal(blockMap.resolveBlockTarget(t, '9K'), null, t);
  const { efsp, c } = freshEfsp(createEfsp, ATC, { currentTheater: () => 'Test' });
  let strip = send(efsp, c.CD, 'CD', VFR({ callsign: 'DIR1' })).ack.strip;
  strip = mustAct(efsp, c.CD, 'CD', strip, { kind: 'SetBlock', blockId: '9K', value: 'se' });
  assert.equal(fdOf(efsp, strip).filed.directionOfFlight, 'SE');
  const bad = send(efsp, c.CD, 'CD', { kind: 'SetBlock', blockId: '9K', value: 'UP' }, strip).ack;
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /direction of flight must be one of N, NE, E, SE, S, SW, W, NW/);
  strip = mustAct(efsp, c.CD, 'CD', strip, { kind: 'SetBlock', blockId: '9K', value: '' });
  assert.equal(fdOf(efsp, strip).filed.directionOfFlight, null);
});
