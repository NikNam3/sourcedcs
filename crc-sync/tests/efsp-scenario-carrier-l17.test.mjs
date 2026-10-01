import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// L17's walks (docs/adr/0074, WP7A part 2): a carrier sortie from launch to
// trap on the wire, Case as broadcast state, the four hand-overs as four
// buttons, the derived fields that cannot be typed, and the whole thing
// surviving a restart. Same prologue as every scenario file: its own paths.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-carrier-l17-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CARRIER: 'carrier.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');

const { createEfsp } = await import('../src/efsp/index.js');
const { crew, hold, act, mustAct, carrierAct, mustCarrierAct, advance } = await import('./helpers/efsp-scenario.mjs');

const SEATS = { CV_MARSHAL: 'CARRIER', CV_PRIFLY: 'CARRIER', CV_APP1: 'CARRIER', CV_APP2: 'CARRIER' };
const strip = (efsp, id) => efsp.boardStoreFor('CARRIER').getStrip(id);
const live = (efsp) => efsp.boardStoreFor('CARRIER').getAll().filter(s => s.state !== 'DROPPED');
const stack = (efsp) => efsp.carrierStore.getRecord().stacks.MAIN.entries;
const view = (efsp) => efsp.carrierStore.view();
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function fresh() {
  fs.rmSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, { force: true });
  const efsp = createEfsp();
  return { efsp, c: crew(efsp, SEATS) };
}

function checkIn(efsp, c, callsign, { fdrId } = {}) {
  return mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', null, {
    kind: 'CreateStrip', bayId: 'cv-marshal-stack', rackId: 'main', role: 'MARSHAL',
    ...(fdrId ? { fdrId } : { fdr: { callsign, aircraftType: 'F-18C' } }),
  });
}

function refused(ack, reason, detail, label = '') {
  assert.equal(ack.ok, false, `${label} should be refused: ${JSON.stringify(ack)}`);
  if (reason) assert.equal(ack.reason, reason, `${label}: ${JSON.stringify(ack)}`);
  if (detail) assert.match(ack.detail, detail, label);
}

test('a launch is a MARSHAL Strip in LAUNCH; EEAT set on it is on the recovery Strip, because it is on the flight', async () => {
  const { efsp, c } = fresh();
  const launch = mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', null, {
    kind: 'CreateStrip', bayId: 'cv-marshal-departures', rackId: 'main', role: 'MARSHAL', initialState: 'LAUNCH',
    fdr: { callsign: 'VIPER11', aircraftType: 'F-18C' },
  });
  assert.equal(launch.role, 'MARSHAL');
  assert.equal(launch.state, 'LAUNCH');
  assert.equal(stack(efsp).length, 0, 'a launch is not in the recovery stack');
  const eeat = Date.UTC(2026, 5, 1, 14, 30);
  mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', launch, { kind: 'SetBlock', blockId: 'C15', value: eeat });
  mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', strip(efsp, launch.stripId), { kind: 'SetBlock', blockId: 'C10', value: 7 });
  // "Launched": the Strip ends
  const dropped = await advance(efsp, c.CV_MARSHAL, 'CV_MARSHAL', strip(efsp, launch.stripId));
  assert.equal(dropped.state, 'DROPPED');
  // the recovery is a new MARSHAL Strip on the same flight
  const recovery = checkIn(efsp, c, null, { fdrId: launch.fdrId });
  assert.equal(recovery.fdrId, launch.fdrId);
  assert.equal(recovery.state, 'IN_STACK');
  const carrierFields = efsp.fdrStore.getFdr(launch.fdrId).military.carrier;
  assert.equal(carrierFields.eeatUtc, eeat, 'EEAT survives from the launch Strip to the recovery Strip');
  assert.equal(carrierFields.approachButton, 7);
  assert.equal(stack(efsp).length, 1, 'the check-in joined the stack');
});

test('a button is a number: a frequency is refused (§9.12 rule 6)', () => {
  const { efsp, c } = fresh();
  const s = checkIn(efsp, c, 'VIPER11');
  refused(act(efsp, c.CV_MARSHAL, 'CV_MARSHAL', s, { kind: 'SetBlock', blockId: 'C10', value: '251.000' }), 'VALIDATION_ERROR', /frequency/);
});

test('the derived Blocks cannot be typed, by any Position (WP7A bullets 2 and 5)', () => {
  const { efsp, c } = fresh();
  const s = checkIn(efsp, c, 'VIPER11');
  for (const id of ['C3', 'C5', 'C6', 'C7', 'C8', 'C9']) {
    refused(act(efsp, c.CV_MARSHAL, 'CV_MARSHAL', strip(efsp, s.stripId), { kind: 'SetBlock', blockId: id, value: '12' }), 'VALIDATION_ERROR', null, id);
  }
  // and no stack op names a derived value
  for (const kind of ['SetAngels', 'SetDme', 'SetPushTime']) {
    refused(carrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind, fdrId: s.fdrId, value: 9 }).ack, 'VALIDATION_ERROR', null, kind);
  }
  assert.equal(view(efsp).derived.MAIN[0].angels, 6);
});

test('the stack index drives angels, DME and push time; one Move re-sequences and nobody else is typed', () => {
  const { efsp, c } = fresh();
  const a = checkIn(efsp, c, 'AAA11');
  const b = checkIn(efsp, c, 'BBB22');
  const d = checkIn(efsp, c, 'CCC33');
  mustCarrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCase', to: 'II' });
  const charlie = Date.UTC(2026, 5, 1, 15, 0);
  mustCarrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'SetCharlieTime', charlieTimeUtc: charlie });
  let v = view(efsp).derived.MAIN;
  assert.deepEqual(v.map(e => [e.angels, e.marshalDme]), [[6, 21], [7, 22], [8, 23]]);
  assert.equal(v[1].pushTimeUtc, charlie + 60000);
  // the low-fuel aircraft goes to the bottom: everyone above moves up together
  const r = mustCarrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'Move', fdrId: d.fdrId, toIndex: 0 });
  assert.equal(r.ack.ok, true);
  v = view(efsp).derived.MAIN;
  assert.deepEqual(v.map(e => e.fdrId), [d.fdrId, a.fdrId, b.fdrId]);
  assert.deepEqual(v.map(e => e.angels), [6, 7, 8]);
  assert.ok(r.carrierBroadcast && r.carrierBroadcast.type === 'efsp-carrier-delta', 'one delta carrying the hull record');
  assert.equal(r.carrierBroadcast.carriers.updated[0].derived.MAIN.length, 3);
});

test('Case is PriFly\'s: Marshal and the lanes are refused; a change is ONE delta every client re-renders from', () => {
  const { efsp, c } = fresh();
  checkIn(efsp, c, 'AAA11');
  for (const pos of ['CV_MARSHAL', 'CV_APP1', 'CV_APP2']) {
    refused(carrierAct(efsp, c[pos], pos, { kind: 'SetCase', to: 'I' }).ack, 'PERMISSION_DENIED', null, pos);
  }
  assert.equal(efsp.carrierStore.caseValue(), 'III', 'the default is the most restrictive');
  const r = mustCarrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCase', to: 'I' });
  assert.equal(r.carrierBroadcast.carriers.updated[0].recoveryCase.value, 'I');
  assert.equal(r.carrierBroadcast.carriers.updated[0].derived.MAIN[0].pushTimeUtc, null, 'Case I has no push times');
  // a no-op is not a transition
  refused(carrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCase', to: 'I' }).ack, 'VALIDATION_ERROR');
  // only the Marshal sequences the stack
  refused(carrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'Move', fdrId: live(efsp)[0].fdrId, toIndex: 0 }).ack, 'PERMISSION_DENIED');
});

test('the session must be Primary at the acting Position', () => {
  const { efsp, c } = fresh();
  refused(carrierAct(efsp, c.CV_APP1, 'CV_PRIFLY', { kind: 'SetCase', to: 'II' }).ack, 'NOT_HOLDING_POSITION');
});

test('the altimeter is the only ship input; anything else is refused by name', () => {
  const { efsp, c } = fresh();
  mustCarrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetShipInput', input: { altimeterInHg: 29.92 } });
  assert.equal(efsp.carrierStore.shipInputs().altimeterInHg, 29.92);
  refused(carrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetShipInput', input: { finalBearingDeg: 350 } }).ack, 'VALIDATION_ERROR', /computed from ship heading/);
  refused(carrierAct(efsp, c.CV_APP1, 'CV_APP1', { kind: 'SetShipInput', input: { altimeterInHg: 30 } }).ack, 'PERMISSION_DENIED');
});

test('Case II: Commence feeds the lanes alternately, marks the flight pushed and moves nobody', async () => {
  const { efsp, c } = fresh();
  mustCarrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCase', to: 'II' });
  const a = checkIn(efsp, c, 'AAA11');
  const b = checkIn(efsp, c, 'BBB22');
  const d = checkIn(efsp, c, 'CCC33');
  const pa = await advance(efsp, c.CV_MARSHAL, 'CV_MARSHAL', strip(efsp, a.stripId));
  assert.equal(pa.state, 'COMMENCED');
  assert.equal(pa.ownerPositionId, 'CV_APP1');
  assert.equal(pa.bayId, 'cv-app1-lane');
  assert.equal(pa.carrierTransfer.kind, 'MARSHAL_TO_APPROACH');
  assert.equal(pa.carrierTransfer.trigger, 'CONTROLLER_INITIATED');
  const pb = await advance(efsp, c.CV_MARSHAL, 'CV_MARSHAL', strip(efsp, b.stripId));
  assert.equal(pb.ownerPositionId, 'CV_APP2', 'alternate lane');
  const entries = stack(efsp);
  assert.deepEqual(entries.map(e => [e.stackIndex, e.status]), [[0, 'PUSHED'], [1, 'PUSHED'], [2, 'HOLDING']], 'pushing renumbers nobody');
  assert.equal(strip(efsp, d.stripId).ownerPositionId, 'CV_MARSHAL');
});

test('a lane that is unmanned feeds the other; with neither manned the Commence is inhibited', async () => {
  const { efsp, c } = fresh();
  const a = checkIn(efsp, c, 'AAA11');
  hold(efsp, c.CV_APP1.session, 'CARRIER', []);
  assert.equal(efsp.boardStoreFor('CARRIER').nlaStatusFor(strip(efsp, a.stripId)).transferTo, 'CV_APP2');
  hold(efsp, c.CV_APP2.session, 'CARRIER', []);
  // APP2's cover is APP1 (unmanned), APP1's is the Marshal: the lane list is the occupancy of the two lanes only
  const status = efsp.boardStoreFor('CARRIER').nlaStatusFor(strip(efsp, a.stripId));
  assert.match(status.inhibited, /no receiving Position present/);
});

test('radar contact changes the Role in place; ball and trap end the approach; the stack entry leaves with a vacancy', async () => {
  const { efsp, c } = fresh();
  const a = checkIn(efsp, c, 'AAA11');
  const b = checkIn(efsp, c, 'BBB22');
  await advance(efsp, c.CV_MARSHAL, 'CV_MARSHAL', strip(efsp, a.stripId)); // -> APP1
  const onFinal = await advance(efsp, c.CV_APP1, 'CV_APP1', strip(efsp, a.stripId)); // radar contact
  assert.equal(onFinal.role, 'FINAL');
  assert.equal(onFinal.state, 'ON_FINAL');
  assert.equal(onFinal.stripId, a.stripId, 'in place, same Strip');
  assert.equal(onFinal.ownerPositionId, 'CV_APP1');
  assert.equal(onFinal.bayId, 'cv-app1-final');
  assert.equal(onFinal.carrierTransfer.trigger, 'RADAR_ACQUISITION');
  // nothing is typed on the talk-down
  refused(act(efsp, c.CV_APP1, 'CV_APP1', onFinal, { kind: 'SetBlock', blockId: 'C1', value: 'X' }), 'VALIDATION_ERROR');
  refused(act(efsp, c.CV_APP1, 'CV_APP1', onFinal, { kind: 'SetBlock', blockId: '5', value: '1234' }), 'VALIDATION_ERROR');
  const ball = await advance(efsp, c.CV_APP1, 'CV_APP1', strip(efsp, a.stripId));
  assert.equal(ball.state, 'BALL');
  assert.equal(ball.carrierTransfer.trigger, 'PILOT_BALL_CALL');
  const trapped = await advance(efsp, c.CV_APP1, 'CV_APP1', strip(efsp, a.stripId));
  assert.equal(trapped.state, 'DROPPED');
  assert.deepEqual(stack(efsp).map(e => [e.fdrId, e.stackIndex]), [[b.fdrId, 1]], 'a vacancy at index 0, nobody re-cleared');
});

test('a bolter is a drag to the Bolter Bay, and the NLA brings it back on final', async () => {
  const { efsp, c } = fresh();
  const a = checkIn(efsp, c, 'AAA11');
  await advance(efsp, c.CV_MARSHAL, 'CV_MARSHAL', strip(efsp, a.stripId));
  await advance(efsp, c.CV_APP1, 'CV_APP1', strip(efsp, a.stripId));
  await advance(efsp, c.CV_APP1, 'CV_APP1', strip(efsp, a.stripId)); // BALL
  const bolter = mustAct(efsp, c.CV_APP1, 'CV_APP1', strip(efsp, a.stripId), { kind: 'MoveStrip', bayId: 'cv-app1-bolter', rackId: 'main' });
  assert.equal(bolter.state, 'BOLTER_WAVEOFF');
  const again = await advance(efsp, c.CV_APP1, 'CV_APP1', strip(efsp, a.stripId));
  assert.equal(again.state, 'ON_FINAL');
});

test('the four hand-overs are four buttons: a drag into the lane Bay is refused and names the button', () => {
  const { efsp, c } = fresh();
  const a = checkIn(efsp, c, 'AAA11');
  const ack = act(efsp, c.CV_MARSHAL, 'CV_MARSHAL', a, { kind: 'TransferStrip', toPositionId: 'CV_APP1', bayId: 'cv-app1-lane', rackId: 'main' });
  refused(ack, 'VALIDATION_ERROR', /Commence/);
  assert.equal(strip(efsp, a.stripId).state, 'IN_STACK');
});

test('CarrierTransfer: the op names the kind; the wrong Case, sender or state is refused with the kind\'s own wording', async () => {
  const { efsp, c } = fresh();
  const a = checkIn(efsp, c, 'AAA11'); // Case III
  refused(act(efsp, c.CV_MARSHAL, 'CV_MARSHAL', a, { kind: 'CarrierTransfer', transfer: 'MARSHAL_TO_PRIFLY' }), 'VALIDATION_ERROR', /Case II/);
  refused(act(efsp, c.CV_APP1, 'CV_APP1', a, { kind: 'CarrierTransfer', transfer: 'MARSHAL_TO_APPROACH' }), 'PERMISSION_DENIED');
  refused(act(efsp, c.CV_MARSHAL, 'CV_MARSHAL', a, { kind: 'CarrierTransfer', transfer: 'FINAL_TO_LSO' }), 'PERMISSION_DENIED');
  refused(act(efsp, c.CV_MARSHAL, 'CV_MARSHAL', a, { kind: 'CarrierTransfer', transfer: 'MARSHAL_TO_APPROACH', toPositionId: 'CV_PRIFLY' }), 'VALIDATION_ERROR', /CV_APP1 or CV_APP2/);
  // the explicit op reaches the same implementation as the button
  const done = mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', a, { kind: 'CarrierTransfer', transfer: 'MARSHAL_TO_APPROACH', toPositionId: 'CV_APP2' });
  assert.equal(done.ownerPositionId, 'CV_APP2');
  assert.equal(stack(efsp)[0].status, 'PUSHED');
  refused(act(efsp, c.CV_MARSHAL, 'CV_MARSHAL', strip(efsp, a.stripId), { kind: 'CarrierTransfer', transfer: 'MARSHAL_TO_APPROACH' }), null, null, 'a flight already pushed');
});

test('Case II "See you" hands the flight to PriFly as PATTERN and leaves a vacancy; Case I "To pattern" is the same hand-over, its own button', async () => {
  const { efsp, c } = fresh();
  mustCarrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCase', to: 'II' });
  const a = checkIn(efsp, c, 'AAA11');
  const b = checkIn(efsp, c, 'BBB22');
  const seen = mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', a, { kind: 'CarrierTransfer', transfer: 'MARSHAL_TO_PRIFLY' });
  assert.equal(seen.role, 'PATTERN');
  assert.equal(seen.state, 'IN_PATTERN');
  assert.equal(seen.ownerPositionId, 'CV_PRIFLY');
  assert.equal(seen.bayId, 'cv-prifly-pattern');
  assert.equal(seen.carrierTransfer.trigger, 'PILOT_SEE_YOU');
  assert.deepEqual(stack(efsp).map(e => e.stackIndex), [1]);
  // Case I
  mustCarrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCase', to: 'I' });
  refused(act(efsp, c.CV_MARSHAL, 'CV_MARSHAL', b, { kind: 'CarrierTransfer', transfer: 'MARSHAL_TO_PRIFLY' }), 'VALIDATION_ERROR', /Case II/);
  const status = efsp.boardStoreFor('CARRIER').nlaStatusFor(strip(efsp, b.stripId));
  assert.equal(status.carrierTransfer, 'MARSHAL_TO_PATTERN_CASE_I');
  const toPattern = await advance(efsp, c.CV_MARSHAL, 'CV_MARSHAL', strip(efsp, b.stripId));
  assert.equal(toPattern.role, 'PATTERN');
  assert.equal(toPattern.carrierTransfer.trigger, 'CONTROLLER_INITIATED');
  assert.equal(stack(efsp).length, 0);
  // PriFly recovers and drops it
  const rec = await advance(efsp, c.CV_PRIFLY, 'CV_PRIFLY', strip(efsp, b.stripId));
  assert.equal(rec.state, 'RECOVERED');
  assert.equal((await advance(efsp, c.CV_PRIFLY, 'CV_PRIFLY', strip(efsp, b.stripId))).state, 'DROPPED');
});

test('a Strip dropped out of the recovery leaves the stack with a vacancy, never a close-up (H28)', () => {
  const { efsp, c } = fresh();
  const a = checkIn(efsp, c, 'AAA11');
  const b = checkIn(efsp, c, 'BBB22');
  const e = checkIn(efsp, c, 'CCC33');
  mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', strip(efsp, b.stripId), { kind: 'DropStrip' });
  assert.deepEqual(stack(efsp).map(x => x.stackIndex), [0, 2]);
  const closed = mustCarrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'CloseUp', fromIndex: 1 });
  assert.equal(closed.ack.ok, true);
});

test('the Case, the stack and the altimeter survive a restart; the banner is re-derived', () => {
  const { efsp, c } = fresh();
  mustCarrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCase', to: 'II' });
  mustCarrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetShipInput', input: { altimeterInHg: 30.01 } });
  const a = checkIn(efsp, c, 'AAA11');
  const b = checkIn(efsp, c, 'BBB22');
  mustCarrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'SetMarshalRadial', marshalRadialDeg: 190 });
  assert.equal(act(efsp, c.CV_MARSHAL, 'CV_MARSHAL', strip(efsp, a.stripId), { kind: 'SetBlock', blockId: 'C1', value: 'AAA11' }).ok, true); // forces a persist
  const again = createEfsp();
  assert.equal(again.carrierStore.caseValue(), 'II');
  assert.equal(again.carrierStore.shipInputs().altimeterInHg, 30.01);
  const entries = again.carrierStore.getRecord().stacks.MAIN;
  assert.deepEqual(entries.entries.map(e => e.fdrId), [a.fdrId, b.fdrId]);
  assert.equal(entries.marshalRadialDeg, 190);
  assert.equal(again.carrierStore.getShipState(), null);
});

test('the audit log carries the carrier ops and the trigger of each hand-over', async () => {
  const { efsp, c } = fresh();
  mustCarrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCase', to: 'II' });
  const a = checkIn(efsp, c, 'AAA11');
  await advance(efsp, c.CV_MARSHAL, 'CV_MARSHAL', strip(efsp, a.stripId));
  const lines = fs.readFileSync(process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.ok(lines.some(l => l.op === 'SetCase' && l.carrierHullId === 'CVN-72' && l.ok === true));
  assert.ok(lines.some(l => l.op === 'InvokeNla' && l.carrierTransfer === 'MARSHAL_TO_APPROACH' && l.carrierTrigger === 'CONTROLLER_INITIATED'));
  assert.ok(lines.some(l => l.op === 'Stack:MarkPushed'));
});

test('typed values are what a controller reads: EEAT and Charlie time as Zulu HHMM, the marshal radial magnetic', () => {
  const { efsp, c } = fresh();
  const a = checkIn(efsp, c, 'AAA11');
  mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', a, { kind: 'SetBlock', blockId: 'C15', value: '1432' });
  const eeat = efsp.fdrStore.getFdr(a.fdrId).military.carrier.eeatUtc;
  assert.equal(new Date(eeat).getUTCHours() * 100 + new Date(eeat).getUTCMinutes(), 1432);
  refused(act(efsp, c.CV_MARSHAL, 'CV_MARSHAL', strip(efsp, a.stripId), { kind: 'SetBlock', blockId: 'C15', value: '2561' }), 'VALIDATION_ERROR', /Zulu/);
  mustCarrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'SetCharlieTime', hhmm: '1500' });
  assert.ok(Number.isFinite(efsp.carrierStore.getRecord().stacks.MAIN.charlieTimeUtc));
  // no variation known (no ship yet): a magnetic radial cannot be converted, and says so
  refused(carrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'SetMarshalRadial', marshalRadialMagDeg: 180 }).ack, 'VALIDATION_ERROR', /variation/);
  efsp.carrierStore.setShipState('CVN-72', { hullId: 'CVN-72', found: true, stale: false, headingRef: 'TRUE', brcDeg: 10, finalBearingDeg: 1, magneticVariationDeg: 5, altimeterInHg: null, altimeterSource: null });
  mustCarrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'SetMarshalRadial', marshalRadialMagDeg: 180 });
  assert.equal(efsp.carrierStore.getRecord().stacks.MAIN.marshalRadialDeg, 185, 'true = magnetic + easterly variation');
  const d = view(efsp).derived.MAIN[0];
  assert.deepEqual(d.marshalRadialDisplay, { value: 180, ref: 'M' });
});

test('a Case change re-states every carrier Strip\'s NLA: Commence becomes To pattern at once', () => {
  const { efsp, c } = fresh();
  const deltas = [];
  efsp.nlaStatusMonitor.setOnDelta((p) => deltas.push(p));
  const a = checkIn(efsp, c, 'AAA11');
  efsp.nlaStatusMonitor.tick(); deltas.length = 0;
  assert.equal(efsp.boardStoreFor('CARRIER').nlaStatusFor(strip(efsp, a.stripId)).carrierTransfer, 'MARSHAL_TO_APPROACH');
  mustCarrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCase', to: 'I' });
  const restated = deltas.flatMap(d => d.strips).filter(s => s.stripId === a.stripId);
  assert.equal(restated.length, 1, 'the Strip was re-sent with its new NLA');
  assert.equal(restated[0].nla.carrierTransfer, 'MARSHAL_TO_PATTERN_CASE_I');
});
