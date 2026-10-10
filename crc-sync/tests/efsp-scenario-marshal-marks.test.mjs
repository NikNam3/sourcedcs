import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The "changed, not yet passed" marks through the real wire path (decisions H123, docs/adr/0115), as the walks the lane was
// asked for: Delta then a restart; pass on one Marshal while the other has the board open; Back to stack then Undo; a marked
// flight that commences (and the Commence undone), and one that leaves the recovery.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marshal-marks-'));
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
/** What every client is sent: the derived stack in the hull view, `unpassed` per flight. */
const marks = (efsp) => Object.fromEntries(efsp.carrierStore.view().derived.MAIN.map((e) => [e.flightDataId, [...e.unpassed]]));
const derivedOf = (efsp, s) => efsp.carrierStore.view().derived.MAIN.find((e) => e.flightDataId === s.flightDataId);
const pass = (efsp, who, pos, s) => {
  const d = derivedOf(efsp, s);
  return carrierAct(efsp, who, pos, { kind: 'PassClearance', flightDataId: s.flightDataId, angels: d.angels, eatUtc: d.pushTimeUtc });
};
const commence = (efsp, c, s) => send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, s), { kind: 'CarrierHandoff', transfer: 'MARSHAL_TO_APPROACH', toPositionId: 'CV_APP1' });
const rampDelta = (efsp, c) => {
  carrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCarrierState', field: 'rampTime', value: '2040' });
  const d = carrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'Delta', minutes: 4 });
  assert.equal(d.ack.ok, true, JSON.stringify(d.ack));
};

test('walk: Delta, then crc-sync restarts; the marks come back with the stack, and the pass is in the Mutation log', async () => {
  const { efsp, c } = fresh();
  const a = checkIn(efsp, c, 'AAA11');
  const b = checkIn(efsp, c, 'BBB22');
  rampDelta(efsp, c);
  assert.deepEqual(marks(efsp), { [a.flightDataId]: ['eat'], [b.flightDataId]: ['eat'] });
  const p = pass(efsp, c.CV_MARSHAL, 'CV_MARSHAL', a);
  assert.equal(p.ack.ok, true, JSON.stringify(p.ack));
  // the ack carries the hull view, and every other client gets the same through the one carrier delta
  assert.deepEqual(p.ack.carrier.derived.MAIN.find((e) => e.flightDataId === a.flightDataId).unpassed, []);
  efsp.persist();
  const again = createEfsp({ wallClock });
  assert.deepEqual(marks(again), { [a.flightDataId]: [], [b.flightDataId]: ['eat'] });
  const log = fs.readFileSync(process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const line = log.find((l) => l.op === 'PassClearance' && l.ok);
  assert.ok(line, 'the pass is audited');
  assert.deepEqual([line.actingPositionId, line.flightDataId, line.passed], ['CV_MARSHAL', a.flightDataId, ['eat']]);
  assert.ok(Number.isFinite(line.at) && Number.isFinite(line.eatUtc) && line.angels === 6);
});

test('walk: pass on one Marshal while the other has it open; a Position that does not sequence the stack cannot pass', () => {
  const { efsp, c } = fresh();
  const a = checkIn(efsp, c, 'AAA11');
  rampDelta(efsp, c);
  const prifly = pass(efsp, c.CV_PRIFLY, 'CV_PRIFLY', a);
  assert.equal(prifly.ack.ok, false);
  assert.deepEqual(marks(efsp)[a.flightDataId], ['eat']);
  // the board the other controller reads is the same view: once passed, it is passed for both
  const before = efsp.carrierStore.view().rev;
  assert.equal(pass(efsp, c.CV_MARSHAL, 'CV_MARSHAL', a).ack.ok, true);
  assert.equal(efsp.carrierStore.view().rev, before + 1);
  // the second click (the other window, a moment later) is a quiet no-op, not a refusal
  const second = pass(efsp, c.CV_MARSHAL, 'CV_MARSHAL', a);
  assert.equal(second.ack.ok, true, JSON.stringify(second.ack));
  assert.equal(efsp.carrierStore.view().rev, before + 1);
});

test('walk: Back to stack marks both; Undo puts the flight back as it was, commenced, with nothing to pass', () => {
  const { efsp, c } = fresh();
  const a = checkIn(efsp, c, 'AAA11');
  checkIn(efsp, c, 'BBB22');
  carrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCarrierState', field: 'rampTime', value: '2040' });
  assert.equal(commence(efsp, c, a).ack.ok, true);
  const back = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a), { kind: 'CarrierHandoff', transfer: 'COMMENCED_TO_MARSHAL' });
  assert.equal(back.ack.ok, true, JSON.stringify(back.ack));
  assert.deepEqual(marks(efsp)[a.flightDataId], ['angels', 'eat']);
  const u = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a), { kind: 'Undo', actionId: back.ack.undoable.actionId });
  assert.equal(u.ack.ok, true, JSON.stringify(u.ack));
  const e = efsp.carrierStore.getRecord().stacks.MAIN.entries.find((x) => x.flightDataId === a.flightDataId);
  assert.deepEqual([e.status, e.unpassed], ['PUSHED', []]);
});

test('walk: a marked flight commences (the mark goes, it has left its fix); the Commence undone brings the mark back', () => {
  const { efsp, c } = fresh();
  const a = checkIn(efsp, c, 'AAA11');
  checkIn(efsp, c, 'BBB22');
  rampDelta(efsp, c);
  const go = commence(efsp, c, a);
  assert.equal(go.ack.ok, true, JSON.stringify(go.ack));
  assert.deepEqual(marks(efsp)[a.flightDataId], []);
  const u = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a), { kind: 'Undo', actionId: go.ack.undoable.actionId });
  assert.equal(u.ack.ok, true, JSON.stringify(u.ack));
  assert.deepEqual(marks(efsp)[a.flightDataId], ['eat'], 'still holding, still not told');
});

test('walk: a marked flight that leaves the recovery (its Strip dropped) takes its mark with it; the others keep theirs', () => {
  const { efsp, c } = fresh();
  const a = checkIn(efsp, c, 'AAA11');
  const b = checkIn(efsp, c, 'BBB22');
  rampDelta(efsp, c);
  const drop = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a), { kind: 'DropStrip', reason: 'diverted to the beach' });
  assert.equal(drop.ack.ok, true, JSON.stringify(drop.ack));
  assert.deepEqual(marks(efsp), { [b.flightDataId]: ['eat'] });
});
