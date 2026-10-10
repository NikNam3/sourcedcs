import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Back to stack through the real wire path (docs/adr/0114): the Marshal sends a COMMENCED flight, the lane's Strip, back into the
// stack; the Strip comes home, the stack entry takes the next free slot at the top, an Undo puts it back, nobody else may. And the
// side number Block (C18).

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshal-board-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CARRIER: 'carrier.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '{}');

const { createEfsp } = await import('../src/efsp/index.js');
const { crew, mustAct, carrierAct } = await import('./helpers/efsp-scenario.mjs');

const CARRIER = { CV_MARSHAL: 'CARRIER', CV_PRIFLY: 'CARRIER', CV_APP1: 'CARRIER', CV_APP2: 'CARRIER' };
const wallClock = { now: () => 1_000_000 };

function fresh() {
  fs.rmSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, { force: true });
  const efsp = createEfsp({ wallClock });
  return { efsp, c: crew(efsp, CARRIER) };
}
const board = (efsp) => efsp.boardStoreFor('CARRIER');
const get = (efsp, s) => board(efsp).getStrip(s.stripId);
function send(efsp, who, positionId, strip, op) {
  return efsp.handleMessage(who.session, {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), facilityId: who.facilityId, actingPositionId: positionId,
    stripId: strip ? strip.stripId : undefined, baseRev: strip ? strip.rev : undefined, op,
  });
}
function checkIn(efsp, c, callsign) {
  return mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', null, {
    kind: 'CreateStrip', bayId: 'cv-marshal-stack', rackId: 'main', stripType: 'MARSHAL', flightData: { callsign, aircraftType: 'F-18C' },
  });
}
const stack = (efsp) => efsp.carrierStore.getRecord().stacks.MAIN.entries;
const commence = (efsp, c, s) => send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, s), { kind: 'CarrierHandoff', transfer: 'MARSHAL_TO_APPROACH', toPositionId: 'CV_APP1' });

test('Back to stack: the lane\'s COMMENCED Strip comes home to the Marshal, in IN_STACK, and the stack entry takes the top slot', () => {
  const { efsp, c } = fresh();
  const a = checkIn(efsp, c, 'AAA11');
  const b = checkIn(efsp, c, 'BBB22');
  const d = checkIn(efsp, c, 'DDD44');
  carrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCarrierState', field: 'rampTime', value: '2040' });
  assert.equal(commence(efsp, c, a).ack.ok, true);
  const owner = get(efsp, a);
  assert.deepEqual([owner.state, owner.ownerPositionId, stack(efsp)[0].status], ['COMMENCED', 'CV_APP1', 'PUSHED']);
  assert.ok(stack(efsp)[0].pushedAtUtc != null, 'the moment it commenced is on the stack entry');

  // only the Marshal may take it back; the lane that holds the Strip is not asked (its own hand is Radar contact)
  const lane = send(efsp, c.CV_APP1, 'CV_APP1', get(efsp, a), { kind: 'CarrierHandoff', transfer: 'COMMENCED_TO_MARSHAL' });
  assert.equal(lane.ack.ok, false);
  const prifly = send(efsp, c.CV_PRIFLY, 'CV_PRIFLY', get(efsp, a), { kind: 'CarrierHandoff', transfer: 'COMMENCED_TO_MARSHAL' });
  assert.equal(prifly.ack.ok, false);

  const back = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a), { kind: 'CarrierHandoff', transfer: 'COMMENCED_TO_MARSHAL' });
  assert.equal(back.ack.ok, true, JSON.stringify(back.ack));
  const s = get(efsp, a);
  assert.deepEqual([s.stripType, s.state, s.ownerPositionId], ['MARSHAL', 'IN_STACK', 'CV_MARSHAL']);
  const e = stack(efsp).find((x) => x.flightDataId === a.flightDataId);
  assert.deepEqual([e.status, e.stackIndex, e.pushedAtUtc, e.eatUtc], ['HOLDING', 3, null, null]);
  assert.deepEqual(stack(efsp).filter((x) => x.flightDataId !== a.flightDataId).map((x) => x.stackIndex), [1, 2]);

  // the Undo (10 s) puts the Strip and the entry back as they were, push time included
  const u = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a), { kind: 'Undo', actionId: back.ack.undoable.actionId });
  assert.equal(u.ack.ok, true, JSON.stringify(u.ack));
  const e2 = stack(efsp).find((x) => x.flightDataId === a.flightDataId);
  assert.deepEqual([e2.status, e2.stackIndex], ['PUSHED', 0]);
  assert.ok(e2.pushedAtUtc != null && e2.eatUtc != null, 'the push time on record is back with it');
  assert.deepEqual([get(efsp, a).state, get(efsp, a).ownerPositionId], ['COMMENCED', 'CV_APP1']);
  assert.ok(b && d);
});

test('Back to stack is refused on a flight that has not commenced, and on a FINAL Strip (the lane has it on its scope)', () => {
  const { efsp, c } = fresh();
  const a = checkIn(efsp, c, 'AAA11');
  const r = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a), { kind: 'CarrierHandoff', transfer: 'COMMENCED_TO_MARSHAL' });
  assert.equal(r.ack.ok, false);
  assert.match(String(r.ack.detail || r.ack.reason), /COMMENCED|IN_STACK|VALIDATION|OWNER|PERMISSION/);
  commence(efsp, c, a);
  const radar = send(efsp, c.CV_APP1, 'CV_APP1', get(efsp, a), { kind: 'CarrierHandoff', transfer: 'APPROACH_TO_FINAL' });
  assert.equal(radar.ack.ok, true, JSON.stringify(radar.ack));
  const late = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a), { kind: 'CarrierHandoff', transfer: 'COMMENCED_TO_MARSHAL' });
  assert.equal(late.ack.ok, false);
  assert.equal(get(efsp, a).stripType, 'FINAL');
});

test('the side number is a Block (C18) on the flight, typed by the Marshal, shown on FINAL, validated', () => {
  const { efsp, c } = fresh();
  const a = checkIn(efsp, c, 'AAA11');
  const ok = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a), { kind: 'SetBlock', blockId: 'C18', value: '201' });
  assert.equal(ok.ack.ok, true, JSON.stringify(ok.ack));
  assert.equal(efsp.flightDataStore.getFlightData(a.flightDataId).military.carrier.sideNumber, '201');
  const bad = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a), { kind: 'SetBlock', blockId: 'C18', value: 'TOO LONG NUMBER' });
  assert.equal(bad.ack.ok, false);
  assert.equal(efsp.flightDataStore.getFlightData(a.flightDataId).military.carrier.sideNumber, '201');
  const clear = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a), { kind: 'SetBlock', blockId: 'C18', value: '' });
  assert.equal(clear.ack.ok, true, JSON.stringify(clear.ack));
  assert.equal(efsp.flightDataStore.getFlightData(a.flightDataId).military.carrier.sideNumber, null);
});

test('the approach turn (C19) is 4, 6 or 8 nm and nothing else', () => {
  const { efsp, c } = fresh();
  const a = checkIn(efsp, c, 'AAA11');
  const turn = () => efsp.flightDataStore.getFlightData(a.flightDataId).military.carrier.approachTurnNm;
  assert.equal(send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a), { kind: 'SetBlock', blockId: 'C19', value: '8' }).ack.ok, true);
  assert.equal(turn(), 8);
  assert.equal(send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a), { kind: 'SetBlock', blockId: 'C19', value: '5' }).ack.ok, false);
  assert.equal(turn(), 8);
});
