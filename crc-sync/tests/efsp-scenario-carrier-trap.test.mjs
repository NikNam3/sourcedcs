import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The end of a carrier approach on the wire (docs/adr/0157): TRAPPED and BOLTER after FLY BULLS and from the pattern (Case
// II/III), Signal Charlie and its TRAPPED / BOLTER (Case I), the trapped jet on deck as PriFly's launch (DROP, or launched
// again), and Abort from Signal Charlie. Same prologue as every scenario file: its own paths.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-carrier-trap-'));
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
const { freshEfsp, act, mustAct, mustCarrierAct, advance, recoveryCheckIn } = await import('./helpers/efsp-scenario.mjs');

const STAFFED = { CV_MARSHAL: 'CARRIER', CV_PRIFLY: 'CARRIER', CV_APP1: 'CARRIER', CV_APP2: 'CARRIER', CV_DEP: 'CARRIER' };
const board = (efsp) => efsp.boardStoreFor('CARRIER');
const strip = (efsp, id) => board(efsp).getStrip(id);
const stack = (efsp, id = 'MAIN') => efsp.carrierStore.getRecord().stacks[id].entries;
const fresh = () => freshEfsp(createEfsp, STAFFED);
const setCase = (efsp, c, value) => mustCarrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCarrierState', field: 'case', value });
const press = (efsp, c, pos, s) => advance(efsp, c[pos], pos, strip(efsp, s.stripId));
const handoff = (efsp, c, pos, s, transfer) => act(efsp, c[pos], pos, strip(efsp, s.stripId), { kind: 'CarrierHandoff', transfer });
const code = (efsp, s) => efsp.flightDataStore.getFlightData(s.flightDataId).identity.beaconAssigned;

/** A Case II/III recovery flown to BULLSEYE, at its lane. */
async function toBullseye(efsp, c, side) {
  const a = recoveryCheckIn(efsp, c, side);
  await press(efsp, c, 'CV_MARSHAL', a); // COMMENCE
  await press(efsp, c, 'CV_MARSHAL', a); // TO APPR
  const lane = strip(efsp, a.stripId).ownerPositionId;
  await press(efsp, c, lane, a); // DIRTY UP
  await press(efsp, c, lane, a); // FLY BULLS
  assert.equal(strip(efsp, a.stripId).state, 'BULLSEYE');
  return { a, lane };
}

test('Case III: at BULLSEYE the lane has TRAPPED (the NLA) and BOLTER beside it; BOLTER keeps it in the pattern, again and again', async () => {
  const { efsp, c } = fresh();
  const { a, lane } = await toBullseye(efsp, c, '301');
  const nla = board(efsp).nlaStatusFor(strip(efsp, a.stripId));
  assert.deepEqual(nla, { toState: 'ON_DECK', transferTo: 'CV_PRIFLY', carrierHandoff: 'TRAPPED', also: [{ carrierHandoff: 'BOLTER', toState: 'CV_PATTERN' }] });
  for (let i = 0; i < 2; i++) {
    assert.equal(handoff(efsp, c, lane, a, 'BOLTER').ok, true, `bolter ${i}`);
    const s = strip(efsp, a.stripId);
    assert.deepEqual([s.state, s.ownerPositionId, s.carrierHandoff.kind], ['CV_PATTERN', lane, 'BOLTER']);
  }
  assert.equal(board(efsp).nlaStatusFor(strip(efsp, a.stripId)).carrierHandoff, 'TRAPPED', 'the pattern offers TRAPPED / BOLTER again');
  assert.equal(stack(efsp).length, 1, 'a bolter stays in the stack');
  // The Marshal may not trap or bolter the lane's Strip, nor send it back from the pattern.
  assert.equal(handoff(efsp, c, 'CV_MARSHAL', a, 'BOLTER').ok, false);
  assert.equal(handoff(efsp, c, 'CV_MARSHAL', a, 'RETURN_TO_STACK').ok, false);
});

test('a bolter is recorded, not dragged: a drop into the pattern Bay names the BOLTER button', async () => {
  const { efsp, c } = fresh();
  const { a, lane } = await toBullseye(efsp, c, '301');
  const bay = lane === 'CV_APP1' ? 'cv-app1-pattern' : 'cv-app2-pattern';
  const ack = act(efsp, c[lane], lane, strip(efsp, a.stripId), { kind: 'MoveStrip', bayId: bay, rackId: 'main' });
  assert.equal(ack.ok, false);
  assert.match(ack.detail, /use the BOLTER button/);
});

test('Case III TRAPPED: the same Strip, flight and squawk become PriFly\'s launch on deck, out of the stack, its assignments gone', async () => {
  const { efsp, c } = fresh();
  const { a, lane } = await toBullseye(efsp, c, '301');
  const b = recoveryCheckIn(efsp, c, '302');
  const squawk = code(efsp, a);
  mustAct(efsp, c[lane], lane, strip(efsp, a.stripId), { kind: 'SetBlock', blockId: '9A-VECTOR', value: '270' });
  const deck = await press(efsp, c, lane, a);
  assert.deepEqual([deck.stripType, deck.state, deck.ownerPositionId, deck.bayId, deck.flightDataId, deck.carrierHandoff.kind],
    ['CV_LAUNCH', 'ON_DECK', 'CV_PRIFLY', 'cv-prifly-launch', a.flightDataId, 'TRAPPED']);
  assert.equal(deck.previousLeg.stripType, 'CV_RECOVERY');
  assert.equal(code(efsp, deck), squawk);
  assert.deepEqual(stack(efsp).map(e => e.flightDataId), [b.flightDataId], 'it left the stack');
  const fd = efsp.flightDataStore.getFlightData(a.flightDataId);
  assert.equal(fd.clearance.heading.entries.some(e => e.status === 'ACTIVE' && e.parsed != null), false, 'no heading on deck');
  // On deck in Case III: LAUNCHED, and DROP beside it.
  const nla = board(efsp).nlaStatusFor(strip(efsp, a.stripId));
  assert.deepEqual([nla.carrierHandoff, nla.also], ['LAUNCH_TO_DEPARTURE', [{ toState: 'DROPPED' }]]);
});

test('the trapped jet launches again: LAUNCHED, KILO, TO MARSHAL puts the same flight back in the stack', async () => {
  const { efsp, c } = fresh();
  const { a, lane } = await toBullseye(efsp, c, '301');
  await press(efsp, c, lane, a); // TRAPPED
  assert.equal((await press(efsp, c, 'CV_PRIFLY', a)).state, 'CV_AIRBORNE');
  assert.equal((await press(efsp, c, 'CV_DEP', a)).state, 'KILO');
  assert.equal(handoff(efsp, c, 'CV_DEP', a, 'DEPARTURE_TO_MARSHAL').ok, true);
  const rec = strip(efsp, a.stripId);
  assert.deepEqual([rec.stripType, rec.state, rec.ownerPositionId], ['CV_RECOVERY', 'STACK', 'CV_MARSHAL']);
  assert.deepEqual(stack(efsp).map(e => e.flightDataId), [a.flightDataId]);
});

test('Case I: Signal Charlie is PriFly\'s; BOLTER keeps it there, TRAPPED puts it on deck, where DROP ends it', async () => {
  const { efsp, c } = fresh();
  setCase(efsp, c, 'I');
  const a = recoveryCheckIn(efsp, c, '301');
  await press(efsp, c, 'CV_MARSHAL', a); // SGNL C
  assert.deepEqual(board(efsp).nlaStatusFor(strip(efsp, a.stripId)),
    { toState: 'ON_DECK', carrierHandoff: 'CASE_I_TRAPPED', also: [{ carrierHandoff: 'CASE_I_BOLTER', toState: 'SIGNAL_CHARLIE' }] });
  assert.equal(handoff(efsp, c, 'CV_PRIFLY', a, 'CASE_I_BOLTER').ok, true);
  assert.deepEqual([strip(efsp, a.stripId).state, strip(efsp, a.stripId).ownerPositionId], ['SIGNAL_CHARLIE', 'CV_PRIFLY']);
  assert.equal(stack(efsp, 'CASE_I').length, 1);
  const deck = await press(efsp, c, 'CV_PRIFLY', a);
  assert.deepEqual([deck.stripType, deck.state, deck.ownerPositionId, deck.bayId], ['CV_LAUNCH', 'ON_DECK', 'CV_PRIFLY', 'cv-prifly-launch']);
  assert.equal(stack(efsp, 'CASE_I').length, 0);
  const nla = board(efsp).nlaStatusFor(strip(efsp, a.stripId));
  assert.deepEqual([nla.toState, nla.also], ['DROPPED', [{ carrierHandoff: 'LAUNCH_TO_MARSHAL', toState: 'STACK' }]]);
  assert.equal((await press(efsp, c, 'CV_PRIFLY', a)).state, 'DROPPED');
});

test('a Case I jet trapped while the ship went to Case III gets a squawk when PriFly launches it to departure control', async () => {
  const { efsp, c } = fresh();
  setCase(efsp, c, 'I');
  const a = recoveryCheckIn(efsp, c, '301');
  await press(efsp, c, 'CV_MARSHAL', a); // SGNL C
  await press(efsp, c, 'CV_PRIFLY', a); // TRAPPED
  assert.equal(code(efsp, a), null);
  setCase(efsp, c, 'III');
  const air = await press(efsp, c, 'CV_PRIFLY', a); // LAUNCHED
  assert.deepEqual([air.state, air.ownerPositionId], ['CV_AIRBORNE', 'CV_DEP']);
  assert.ok(code(efsp, a), 'a squawk for departure control');
});

test('Abort to the Case II/III stack works from Signal Charlie (the Marshal, on PriFly\'s Strip), not from the deck', async () => {
  const { efsp, c } = fresh();
  setCase(efsp, c, 'I');
  const a = recoveryCheckIn(efsp, c, '301');
  const b = recoveryCheckIn(efsp, c, '302');
  await press(efsp, c, 'CV_MARSHAL', a);
  await press(efsp, c, 'CV_MARSHAL', b);
  await press(efsp, c, 'CV_PRIFLY', b); // b trapped
  setCase(efsp, c, 'III');
  assert.equal(handoff(efsp, c, 'CV_MARSHAL', a, 'ABORT_TO_STACK').ok, true);
  const back = strip(efsp, a.stripId);
  assert.deepEqual([back.state, back.ownerPositionId], ['STACK', 'CV_MARSHAL']);
  assert.deepEqual(stack(efsp).map(e => e.flightDataId), [a.flightDataId]);
  assert.equal(handoff(efsp, c, 'CV_MARSHAL', b, 'ABORT_TO_STACK').ok, false, 'on deck it is a launch');
});

test('PriFly signed off: TRAPPED goes to whoever is offered PriFly\'s hat, with the unstaffed-receiver warning', async () => {
  const { efsp, c } = fresh();
  const { a, lane } = await toBullseye(efsp, c, '301');
  const { hold } = await import('./helpers/efsp-scenario.mjs');
  hold(efsp, c.CV_PRIFLY.session, 'CARRIER', []);
  const nla = board(efsp).nlaStatusFor(strip(efsp, a.stripId));
  assert.equal(nla.carrierHandoff, 'TRAPPED', 'PriFly is consolidated, so present');
  const ack = handoff(efsp, c, lane, a, 'TRAPPED');
  assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.equal(strip(efsp, a.stripId).ownerPositionId, 'CV_PRIFLY');
});
