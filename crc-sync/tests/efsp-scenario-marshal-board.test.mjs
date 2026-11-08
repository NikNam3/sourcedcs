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
    kind: 'CreateStrip', bayId: 'cv-marshal-stack', rackId: 'main', stripType: 'CV_RECOVERY', flightData: { sideNumber: callsign, callsign, aircraftType: 'F-18C' },
  });
}
const stack = (efsp) => efsp.carrierStore.getRecord().stacks.MAIN.entries;
const commence = (efsp, c, s) => send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, s), { kind: 'CarrierHandoff', transfer: 'COMMENCE' });

test('Back to stack (docs/adr/0156): a COMMENCED flight comes back to the top slot; the Undo puts it back as it was', () => {
  const { efsp, c } = fresh();
  const a = checkIn(efsp, c, 'AAA11');
  const b = checkIn(efsp, c, 'BBB22');
  const d = checkIn(efsp, c, 'DDD44');
  carrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCarrierState', field: 'rampTime', value: '2040' });
  assert.equal(commence(efsp, c, a).ack.ok, true);
  const owner = get(efsp, a);
  assert.deepEqual([owner.state, owner.ownerPositionId, stack(efsp)[0].status], ['COMMENCED', 'CV_MARSHAL', 'PUSHED']);
  assert.ok(stack(efsp)[0].pushedAtUtc != null, 'the moment it commenced is on the stack entry');

  // the lanes and PriFly do not hold a COMMENCED Strip: they cannot send it back
  for (const pos of ['CV_APP1', 'CV_PRIFLY']) {
    assert.equal(send(efsp, c[pos], pos, get(efsp, a), { kind: 'CarrierHandoff', transfer: 'RETURN_TO_STACK' }).ack.ok, false, pos);
  }
  const back = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a), { kind: 'CarrierHandoff', transfer: 'RETURN_TO_STACK' });
  assert.equal(back.ack.ok, true, JSON.stringify(back.ack));
  const s = get(efsp, a);
  assert.deepEqual([s.stripType, s.state, s.ownerPositionId], ['CV_RECOVERY', 'STACK', 'CV_MARSHAL']);
  const e = stack(efsp).find((x) => x.flightDataId === a.flightDataId);
  assert.deepEqual([e.status, e.stackIndex, e.pushedAtUtc, e.eatUtc], ['HOLDING', 3, null, null]);
  assert.deepEqual(stack(efsp).filter((x) => x.flightDataId !== a.flightDataId).map((x) => x.stackIndex), [1, 2]);

  // the Undo (10 s) puts the Strip and the entry back as they were, push time included
  const u = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a), { kind: 'Undo', actionId: back.ack.undoable.actionId });
  assert.equal(u.ack.ok, true, JSON.stringify(u.ack));
  const e2 = stack(efsp).find((x) => x.flightDataId === a.flightDataId);
  assert.deepEqual([e2.status, e2.stackIndex], ['PUSHED', 0]);
  assert.ok(e2.pushedAtUtc != null && e2.eatUtc != null, 'the push time on record is back with it');
  assert.deepEqual([get(efsp, a).state, get(efsp, a).ownerPositionId], ['COMMENCED', 'CV_MARSHAL']);
  assert.ok(b && d);
});

test('Back to stack is refused on a flight that has not commenced', () => {
  const { efsp, c } = fresh();
  const a = checkIn(efsp, c, 'AAA11');
  const r = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a), { kind: 'CarrierHandoff', transfer: 'RETURN_TO_STACK' });
  assert.equal(r.ack.ok, false);
  assert.match(String(r.ack.detail), /COMMENCED or FINAL_APPROACH or DIRTY/);
});

test('the side number is a Block (C18) on the flight, typed by the Marshal, validated', () => {
  const { efsp, c } = fresh();
  const a = checkIn(efsp, c, 'AAA11');
  const ok = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a), { kind: 'SetBlock', blockId: 'C18', value: '201' });
  assert.equal(ok.ack.ok, true, JSON.stringify(ok.ack));
  assert.equal(efsp.flightDataStore.getFlightData(a.flightDataId).military.carrier.sideNumber, '201');
  const bad = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a), { kind: 'SetBlock', blockId: 'C18', value: 'TOO LONG NUMBER' });
  assert.equal(bad.ack.ok, false);
  assert.equal(efsp.flightDataStore.getFlightData(a.flightDataId).military.carrier.sideNumber, '201');
});
