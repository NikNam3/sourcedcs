import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { slot } from './helpers/wire-slots.mjs';

/* L18's walks (docs/adr/0075, 0093): Incirlik's RSU, SFA and PAR on the wire.
 *
 * Not just the lifecycle. Each flow is walked the way pilots disturb it
 * (decisions memory "walk pilot requests"): a pilot who SWITCHES (asks for a
 * different frequency, goes back round the pattern), CANCELS (a missed
 * approach, a drop, a rotation that finds PAR unstaffed), and ARRIVES LATE (the
 * receiving Position signs on after the aircraft is ready, a Position
 * vacates with an aircraft on its frequency).
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-l18-scn-'));
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
const { snapshotMessage } = await import('../src/efsp/efsp-ws.js');
const {
  crew, hold, act, mustAct, advance, sfaAct, mustSfaAct,
} = await import('./helpers/efsp-scenario.mjs');

const STAFFED = { OPS: 'INCIRLIK', LC: 'INCIRLIK', RSU: 'INCIRLIK', AP: 'INCIRLIK', SFA: 'INCIRLIK', PAR: 'INCIRLIK' };
const MS = { 'freq-1': 232.1, 'freq-2': 233.1, 'freq-3': 234.1, 'freq-4': 235.1, 'freq-5': 236.1 };
const board = (efsp) => efsp.boardStoreFor('INCIRLIK');
const strip = (efsp, s) => board(efsp).getStrip(s.stripId);
const live = (efsp) => board(efsp).getAll().filter(s => s.state !== 'DROPPED');
const mutations = () => fs.readFileSync(process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH, 'utf8').trim().split('\n').map(l => JSON.parse(l));
let n = 0;

function fresh() {
  fs.rmSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, { force: true });
  const efsp = createEfsp();
  return { efsp, c: crew(efsp, STAFFED) };
}

function refused(ack, reason, detail, label = '') {
  assert.equal(ack.ok, false, `${label} should be refused: ${JSON.stringify(ack)}`);
  if (reason) assert.equal(ack.reason, reason, `${label}: ${JSON.stringify(ack)}`);
  if (detail) assert.match(ack.detail || '', detail, label);
}

/** An inbound ARRIVAL with AP, then handed to SFA on a frequency Rack. */
function sfaArrival(efsp, c, rackId = 'freq-2') {
  let s = mustAct(efsp, c.AP, 'AP', null, {
    kind: 'CreateStrip', bayId: 'ap-inbound', rackId: 'main', stripType: 'ARRIVAL',
    flightData: { callsign: `ARR${++n}`, aircraftType: 'F16', wakeCategory: 'M', originAirport: 'LTAG' },
  });
  return mustAct(efsp, c.AP, 'AP', s, { kind: 'TransferStrip', toPositionId: 'SFA', bayId: 'sfa-frequencies', rackId });
}

const flightDataOf = (efsp, s) => efsp.flightDataStore.getFlightData(s.flightDataId);
const freqOf = (efsp, s) => flightDataOf(efsp, s).comms.workingFrequencyMhz;

// ── SFA ─────────────────────────────────────────────────────────────────────

test('SFA acceptance (guide §4.7, D17): rotating moves the controller and the Strip\'s frequency is unchanged', () => {
  const { efsp, c } = fresh();
  const s = sfaArrival(efsp, c, 'freq-2');
  assert.equal(s.ownerPositionId, 'SFA');
  assert.equal(s.bayId, 'sfa-frequencies');
  assert.equal(s.rackId, 'freq-2');
  assert.equal(freqOf(efsp, s), MS['freq-2'], 'the Rack the Strip was filed in is its frequency');
  const commsBefore = JSON.stringify(flightDataOf(efsp, s).comms);

  const rotated = mustAct(efsp, c.SFA, 'SFA', strip(efsp, s), { kind: 'SfaRotation' });
  assert.equal(rotated.ownerPositionId, 'PAR', 'the controller moved');
  assert.equal(rotated.stripType, 'FINAL', 'ARRIVAL becomes FINAL in place');
  assert.equal(rotated.state, 'ON_FINAL');
  assert.equal(rotated.stripId, s.stripId, 'same Strip');
  assert.equal(rotated.flightDataId, s.flightDataId, 'same flight');
  assert.equal(rotated.bayId, 'par-final');
  assert.equal(JSON.stringify(flightDataOf(efsp, s).comms), commsBefore, 'the flight\'s comms record is byte-identical: no frequency change, no transition');
  assert.equal(freqOf(efsp, s), MS['freq-2']);
  assert.deepEqual(
    { kind: rotated.sfaTransfer.kind, trigger: rotated.sfaTransfer.trigger, from: rotated.sfaTransfer.from, to: rotated.sfaTransfer.to, frequencyRackId: rotated.sfaTransfer.frequencyRackId },
    { kind: 'SFA_ROTATION', trigger: 'CONTROLLER_INITIATED', from: 'SFA', to: 'PAR', frequencyRackId: 'freq-2' });
  // the four trigger types stay four
  const log = mutations().filter(m => m.op === 'SfaRotation');
  assert.equal(log.length, 1);
  assert.equal(log[0].sfaTransfer, 'SFA_ROTATION');
  assert.equal(log[0].sfaTrigger, 'CONTROLLER_INITIATED');
});

test('AP may send the rotation transfer from its own Strip too (AP/SFA to PAR); PAR, RSU and LC may not', () => {
  const { efsp, c } = fresh();
  let s = mustAct(efsp, c.AP, 'AP', null, {
    kind: 'CreateStrip', bayId: 'ap-inbound', rackId: 'main', stripType: 'ARRIVAL',
    flightData: { callsign: `ARR${++n}`, aircraftType: 'F16', wakeCategory: 'M', originAirport: 'LTAG' },
  });
  refused(act(efsp, c.RSU, 'RSU', s, { kind: 'SfaRotation' }), 'PERMISSION_DENIED', null, 'RSU');
  refused(act(efsp, c.LC, 'LC', s, { kind: 'SfaRotation' }), 'PERMISSION_DENIED', null, 'LC');
  const rotated = mustAct(efsp, c.AP, 'AP', s, { kind: 'SfaRotation' });
  assert.equal(rotated.ownerPositionId, 'PAR');
  assert.equal(rotated.sfaTransfer.from, 'AP');
  refused(act(efsp, c.PAR, 'PAR', strip(efsp, s), { kind: 'SfaRotation' }), 'PERMISSION_DENIED', null, 'PAR cannot rotate its own Strip');
});

test('only the jurisdiction Position changes the rotation record; the others get a permission refusal, and the record is one whole delta', () => {
  const { efsp, c } = fresh();
  const before = efsp.sfaStore.view();
  assert.deepEqual(before.rotation, { 'freq-1': 'AP', 'freq-2': 'SFA', 'freq-3': 'PAR' });
  for (const id of ['SFA', 'PAR', 'RSU', 'LC', 'OPS']) {
    const r = sfaAct(efsp, c[id], id, { kind: 'SetSfaRotation', rackId: 'freq-4', positionId: id });
    refused(r.ack, 'PERMISSION_DENIED', /AP holds jurisdiction/, id);
    assert.equal(slot(r, 'sfa'), undefined);
  }
  assert.deepEqual(efsp.sfaStore.view().rotation, before.rotation);

  const r = mustSfaAct(efsp, c.AP, 'AP', { kind: 'SetSfaRotation', rackId: 'freq-4', positionId: 'PAR' });
  assert.equal(slot(r, 'sfa').type, 'efsp-sfa-delta');
  assert.deepEqual(slot(r, 'sfa').sfaRotation.rotation, { 'freq-1': 'AP', 'freq-2': 'SFA', 'freq-4': 'PAR' }, 'PAR moved off freq-3 onto freq-4: one Position, one frequency');
  assert.equal(slot(r, 'sfa').sfaRotation.pool.length, 5);
  assert.equal(r.ack.sfaRotation.rev, 1);
  // audited
  const line = mutations().filter(m => m.op === 'SetSfaRotation').pop();
  assert.equal(line.ok, true); assert.equal(line.actingPositionId, 'AP'); assert.equal(line.sfaRackId, 'freq-4');
  assert.ok(mutations().some(m => m.op === 'SetSfaRotation' && m.ok === false && m.reason === 'PERMISSION_DENIED'), 'refusals are audited too');
});

test('the rotation record refuses what cannot be: an unknown frequency, an unknown Position, a Position that does not work the SFA, a stale rev', () => {
  const { efsp, c } = fresh();
  refused(sfaAct(efsp, c.AP, 'AP', { kind: 'SetSfaRotation', rackId: 'freq-9', positionId: 'PAR' }).ack, 'VALIDATION_ERROR', /pool/);
  refused(sfaAct(efsp, c.AP, 'AP', { kind: 'SetSfaRotation', rackId: 'freq-4', positionId: 'CTR' }).ack, 'VALIDATION_ERROR', /not a Position/);
  // only a Position that works the SFA can be put on a frequency
  refused(sfaAct(efsp, c.AP, 'AP', { kind: 'SetSfaRotation', rackId: 'freq-3', positionId: 'LC' }).ack, 'VALIDATION_ERROR', /does not work the SFA/);
  // a frequency taken out of the rotation, and another put in
  mustSfaAct(efsp, c.AP, 'AP', { kind: 'SetSfaRotation', rackId: 'freq-3', positionId: null });
  mustSfaAct(efsp, c.AP, 'AP', { kind: 'SetSfaRotation', rackId: 'freq-5', positionId: 'PAR' });
  refused(sfaAct(efsp, c.AP, 'AP', { kind: 'SetSfaRotation', rackId: 'freq-1', positionId: 'AP' }, { baseRev: 0 }).ack, 'STALE_REV');
  // setting what is already true changes nothing and says so
  const same = sfaAct(efsp, c.AP, 'AP', { kind: 'SetSfaRotation', rackId: 'freq-1', positionId: 'AP' });
  assert.equal(same.ack.ok, true); assert.equal(slot(same, 'sfa'), undefined);
});

test('a controller must be Primary at the acting Position to touch the rotation (docs/adr/0029)', () => {
  const { efsp, c } = fresh();
  const outsider = { session: { controllerId: 'someone-else', who: 'x' }, facilityId: 'INCIRLIK' };
  refused(sfaAct(efsp, outsider, 'AP', { kind: 'SetSfaRotation', rackId: 'freq-4', positionId: 'PAR' }).ack, 'NOT_HOLDING_POSITION');
  void c;
});

test('the rotation record is in the snapshot and survives a restart', () => {
  const { efsp, c } = fresh();
  mustSfaAct(efsp, c.AP, 'AP', { kind: 'SetSfaRotation', rackId: 'freq-5', positionId: 'SFA' });
  const snap = efsp.snapshotFor(c.AP.session);
  assert.equal(snap.sfaRotation.rotation['freq-5'], 'SFA');
  assert.equal(snap.sfaRotation.pool.length, 5);
  assert.equal(snap.sfaRotation.jurisdiction, 'AP');
  const restarted = createEfsp(); // same snapshot path: the first life's state
  assert.equal(restarted.sfaStore.positionOn('freq-5'), 'SFA');
  assert.equal(restarted.sfaStore.positionOn('freq-2'), null, 'SFA moved off freq-2 and the move came back');
  assert.equal(restarted.sfaStore.view().rev, 1);
});

test('a pilot SWITCHES frequency: the controller drags the Strip to another Rack, the frequency follows, nobody else is touched', () => {
  const { efsp, c } = fresh();
  const s = sfaArrival(efsp, c, 'freq-1');
  assert.equal(freqOf(efsp, s), MS['freq-1']);
  const moved = mustAct(efsp, c.SFA, 'SFA', strip(efsp, s), { kind: 'MoveStrip', bayId: 'sfa-frequencies', rackId: 'freq-4' });
  assert.equal(moved.rackId, 'freq-4');
  assert.equal(moved.ownerPositionId, 'SFA', 'the controller did not move');
  assert.equal(freqOf(efsp, s), MS['freq-4']);
  assert.equal(flightDataOf(efsp, s).comms.transitions.at(-1).workingFrequencyMhz, MS['freq-4'], 'the transition is on the flight, for the sortie\'s record');
  // back again, and the rotation afterwards still leaves the frequency alone
  mustAct(efsp, c.SFA, 'SFA', strip(efsp, s), { kind: 'MoveStrip', bayId: 'sfa-frequencies', rackId: 'freq-2' });
  mustAct(efsp, c.SFA, 'SFA', strip(efsp, s), { kind: 'SfaRotation' });
  assert.equal(freqOf(efsp, s), MS['freq-2']);
});

test('a pilot SWITCHES controller (back to AP, then on to PAR): the frequency is the same each time', () => {
  const { efsp, c } = fresh();
  const s = sfaArrival(efsp, c, 'freq-3');
  const back = mustAct(efsp, c.SFA, 'SFA', strip(efsp, s), { kind: 'TransferStrip', toPositionId: 'AP', bayId: 'ap-inbound', rackId: 'main' });
  assert.equal(back.ownerPositionId, 'AP');
  assert.equal(freqOf(efsp, s), MS['freq-3'], 'leaving the SFA Bay does not touch the frequency');
  const again = mustAct(efsp, c.AP, 'AP', strip(efsp, s), { kind: 'TransferStrip', toPositionId: 'SFA', bayId: 'sfa-frequencies', rackId: 'freq-3' });
  assert.equal(again.rackId, 'freq-3');
  mustAct(efsp, c.SFA, 'SFA', strip(efsp, s), { kind: 'SfaRotation' });
  assert.equal(freqOf(efsp, s), MS['freq-3']);
});

test('the pilot CANCELS the approach: a missed approach from PAR, then back on final; a second aircraft cannot take the Bay meanwhile', () => {
  const { efsp, c } = fresh();
  const a = sfaArrival(efsp, c, 'freq-1');
  const b = sfaArrival(efsp, c, 'freq-2');
  mustAct(efsp, c.SFA, 'SFA', strip(efsp, a), { kind: 'SfaRotation' });
  // PAR holds one aircraft: the second rotation is refused, and B stays with SFA, role intact
  refused(act(efsp, c.SFA, 'SFA', strip(efsp, b), { kind: 'SfaRotation' }), 'VALIDATION_ERROR', /par-final holds 1 Strip at a time/);
  assert.equal(strip(efsp, b).ownerPositionId, 'SFA');
  assert.equal(strip(efsp, b).stripType, 'ARRIVAL');
  // A goes around: the missed-approach Bay is FINAL's own BOLTER_WAVEOFF
  const missed = mustAct(efsp, c.PAR, 'PAR', strip(efsp, a), { kind: 'MoveStrip', bayId: 'par-missed', rackId: 'main' });
  assert.equal(missed.state, 'BOLTER_WAVEOFF');
  // the Bay is free again: B rotates in
  const bIn = mustAct(efsp, c.SFA, 'SFA', strip(efsp, b), { kind: 'SfaRotation' });
  assert.equal(bIn.bayId, 'par-final');
  // A cannot come back on final while B is on it (the NLA is refused, not doubled)
  refused(act(efsp, c.PAR, 'PAR', strip(efsp, a), { kind: 'InvokeNla' }), null, /par-final holds 1 Strip/, 'A back on final');
  assert.equal(strip(efsp, a).state, 'BOLTER_WAVEOFF');
  // B lands: Landing assured (BALL), then the controller drops it; A returns
  assert.equal(strip(efsp, b).state, 'ON_FINAL');
});

test('PAR\'s terminal events: Landing assured is the ordinary BALL state with no carrier handoff; then it is dropped', async () => {
  const { efsp, c } = fresh();
  const s = sfaArrival(efsp, c);
  mustAct(efsp, c.SFA, 'SFA', strip(efsp, s), { kind: 'SfaRotation' });
  const ball = await advance(efsp, c.PAR, 'PAR', strip(efsp, s));
  assert.equal(ball.state, 'BALL');
  assert.equal(ball.carrierHandoff, undefined);
  const gone = await advance(efsp, c.PAR, 'PAR', strip(efsp, s));
  assert.equal(gone.state, 'DROPPED');
  assert.equal(live(efsp).length, 0);
});

test('a rotation CANCELLED by the receiver: PAR unstaffed refuses it and the aircraft stays; PAR LATE to its Position, the retry works', () => {
  const { efsp, c } = fresh();
  const s = sfaArrival(efsp, c);
  hold(efsp, c.PAR.session, 'INCIRLIK', []); // PAR leaves
  refused(act(efsp, c.SFA, 'SFA', strip(efsp, s), { kind: 'SfaRotation' }), 'NO_RECEIVING_POSITION', /PAR is not staffed/);
  assert.equal(strip(efsp, s).ownerPositionId, 'SFA');
  assert.equal(strip(efsp, s).stripType, 'ARRIVAL');
  hold(efsp, c.PAR.session, 'INCIRLIK', ['PAR']); // PAR arrives late
  const ok = mustAct(efsp, c.SFA, 'SFA', strip(efsp, s), { kind: 'SfaRotation' });
  assert.equal(ok.ownerPositionId, 'PAR');
});

test('a rotation is not undoable (the state the Undo would restore is another strip type\'s): Undo is refused and nothing moves', () => {
  const { efsp, c } = fresh();
  const s = sfaArrival(efsp, c);
  mustAct(efsp, c.SFA, 'SFA', strip(efsp, s), { kind: 'SfaRotation' });
  refused(act(efsp, c.PAR, 'PAR', strip(efsp, s), { kind: 'Undo' }), null, null, 'Undo');
  assert.equal(strip(efsp, s).stripType, 'FINAL');
  assert.equal(strip(efsp, s).ownerPositionId, 'PAR');
});

test('a rotation applies to an ARRIVAL at INBOUND only: a Strip already on final, or not an arrival, is refused', () => {
  const { efsp, c } = fresh();
  const s = sfaArrival(efsp, c);
  mustAct(efsp, c.SFA, 'SFA', strip(efsp, s), { kind: 'SfaRotation' });
  refused(act(efsp, c.SFA, 'SFA', strip(efsp, s), { kind: 'SfaRotation' }), 'NOT_OWNER', null, 'a second press by the old owner');
  const dep = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE',
    flightData: { callsign: `DEP${++n}`, aircraftType: 'F16', wakeCategory: 'M', departureAirport: 'LTAG', destinationAirport: 'LTAG', route: 'DCT', requestedAltitude: '250' },
  });
  refused(act(efsp, c.OPS, 'OPS', dep, { kind: 'SfaRotation' }), 'PERMISSION_DENIED', null, 'OPS holds no rotation right');
});

test('LATE ARRIVAL: SFA vacates with aircraft on its frequencies; the Strips go to AP, every frequency is unchanged, and they come back to their own Racks when SFA returns', () => {
  const { efsp, c } = fresh();
  const a = sfaArrival(efsp, c, 'freq-1');
  const b = sfaArrival(efsp, c, 'freq-5');
  const result = hold(efsp, c.SFA.session, 'INCIRLIK', []);
  assert.deepEqual(result.ack.warnings, [{ positionId: 'SFA', count: 2, routedTo: 'AP' }]);
  for (const [s, mhz] of [[a, MS['freq-1']], [b, MS['freq-5']]]) {
    const now = strip(efsp, s);
    assert.equal(now.ownerPositionId, 'AP', 'the covering Position holds them');
    assert.equal(now.bayId, 'ap-inbound', 'in the Bay APP works inbound aircraft from, not a frequency Rack APP does not have');
    assert.equal(freqOf(efsp, s), mhz, 'the frequency did not change when the controller did');
  }
  // SFA returns late: the consolidation hand-back puts each aircraft back on ITS frequency Rack
  hold(efsp, c.SFA.session, 'INCIRLIK', ['SFA']);
  for (const [s, rack] of [[a, 'freq-1'], [b, 'freq-5']]) {
    const now = strip(efsp, s);
    assert.equal(now.ownerPositionId, 'SFA');
    assert.equal(now.bayId, 'sfa-frequencies');
    assert.equal(now.rackId, rack);
    assert.equal(freqOf(efsp, s), MS[rack]);
  }
});

test('LATE ARRIVAL: PAR vacates with an aircraft on final; the Strip is not lost (it goes to AP, which cannot advance it: the trap L17 recorded for the Marshal), and PAR gets it back', () => {
  const { efsp, c } = fresh();
  const s = sfaArrival(efsp, c);
  mustAct(efsp, c.SFA, 'SFA', strip(efsp, s), { kind: 'SfaRotation' });
  const r = hold(efsp, c.PAR.session, 'INCIRLIK', []);
  assert.deepEqual(r.ack.warnings, [{ positionId: 'PAR', count: 1, routedTo: 'AP' }]);
  const now = strip(efsp, s);
  assert.equal(now.ownerPositionId, 'AP');
  assert.equal(now.state, 'ON_FINAL');
  assert.ok(efsp.boardStoreFor('INCIRLIK').getRack(now.bayId, now.rackId).some(x => x.stripId === s.stripId), 'on a visible Rack of APP');
  assert.equal(freqOf(efsp, s), MS['freq-2']);
  refused(act(efsp, c.AP, 'AP', now, { kind: 'SetState', toState: 'BALL' }), 'PERMISSION_DENIED', null, 'APP holds a FINAL Strip it has no authority to advance');
  hold(efsp, c.PAR.session, 'INCIRLIK', ['PAR']);
  const back = strip(efsp, s);
  assert.equal(back.ownerPositionId, 'PAR');
  assert.equal(back.bayId, 'par-final');
});

// ── RSU ─────────────────────────────────────────────────────────────────────

function patternStrip(efsp, c, rackId = 'initial') {
  return mustAct(efsp, c.RSU, 'RSU', null, {
    kind: 'CreateStrip', bayId: 'rsu-pattern', rackId, stripType: 'PATTERN',
    flightData: { callsign: `PAT${++n}`, aircraftType: 'F16', wakeCategory: 'M' },
  });
}

test('RSU pattern walk: initial, base, final by ordinary Moves (a leg is a Rack), Landed, Drop', async () => {
  const { efsp, c } = fresh();
  const s = patternStrip(efsp, c);
  assert.equal(s.stripType, 'PATTERN'); assert.equal(s.state, 'IN_PATTERN'); assert.equal(s.ownerPositionId, 'RSU');
  for (const leg of ['base', 'final']) {
    const m = mustAct(efsp, c.RSU, 'RSU', strip(efsp, s), { kind: 'MoveStrip', bayId: 'rsu-pattern', rackId: leg });
    assert.equal(m.rackId, leg); assert.equal(m.state, 'IN_PATTERN');
  }
  const landed = await advance(efsp, c.RSU, 'RSU', strip(efsp, s));
  assert.equal(landed.state, 'RECOVERED');
  const gone = await advance(efsp, c.RSU, 'RSU', strip(efsp, s));
  assert.equal(gone.state, 'DROPPED');
  assert.equal(live(efsp).length, 0);
});

test('a pilot SWITCHES in the pattern: goes back round to CLOSED from FINAL, and the board never refuses (RSU advises, it does not control)', () => {
  const { efsp, c } = fresh();
  const s = patternStrip(efsp, c, 'final');
  const m = mustAct(efsp, c.RSU, 'RSU', strip(efsp, s), { kind: 'MoveStrip', bayId: 'rsu-pattern', rackId: 'closed' });
  assert.equal(m.rackId, 'closed');
  // two aircraft on the last leg is legal: the pattern board advises, the server does not refuse
  const t = patternStrip(efsp, c, 'final');
  const u = patternStrip(efsp, c, 'final');
  assert.equal(strip(efsp, t).rackId, 'final'); assert.equal(strip(efsp, u).rackId, 'final');
  for (const x of [s, t, u]) mustAct(efsp, c.RSU, 'RSU', strip(efsp, x), { kind: 'DropStrip' });
});

test('the pilot CANCELS: an RSU Drop takes the Strip off the Board and a dropped Strip cannot be moved', () => {
  const { efsp, c } = fresh();
  const s = patternStrip(efsp, c);
  mustAct(efsp, c.RSU, 'RSU', strip(efsp, s), { kind: 'DropStrip' });
  assert.equal(strip(efsp, s).state, 'DROPPED');
  assert.equal(live(efsp).length, 0);
  assert.equal(strip(efsp, s).state, 'DROPPED', 'a late Move of a dropped Strip does not revive it');
  act(efsp, c.RSU, 'RSU', strip(efsp, s), { kind: 'MoveStrip', bayId: 'rsu-pattern', rackId: 'base' });
  assert.equal(strip(efsp, s).state, 'DROPPED');
  assert.equal(live(efsp).length, 0);
});

test('LATE ARRIVAL: an aircraft is already in the pattern when RSU leaves; the Strip is not stranded on a Position outside the chain, it stays with RSU\'s seat empty', () => {
  const { efsp, c } = fresh();
  const s = patternStrip(efsp, c, 'base');
  const r = hold(efsp, c.RSU.session, 'INCIRLIK', []);
  const now = strip(efsp, s);
  // RSU has no Position to be consolidated at (ADR 0075: a supervisory Position the chain does not name), so nothing is
  // re-routed and nothing is lost: the Strip stays owned by RSU in its Bay, and the ack says so.
  assert.equal(now.ownerPositionId, 'RSU');
  assert.equal(now.bayId, 'rsu-pattern');
  assert.deepEqual(r.ack.warnings, [{ positionId: 'RSU', count: 1, routedTo: null }], 'the ack says nobody covers it');
  hold(efsp, c.RSU.session, 'INCIRLIK', ['RSU']); // RSU back, late
  mustAct(efsp, c.RSU, 'RSU', strip(efsp, s), { kind: 'MoveStrip', bayId: 'rsu-pattern', rackId: 'final' });
});

test('RSU asks for a runway change and may not make one (H18): a request reaches LC, a close is refused', () => {
  const { efsp, c } = fresh();
  const rsu = c.RSU;
  const current = () => efsp.runwayStatusStore.getRunwayStatus('INCIRLIK');
  const send = (op) => efsp.handleMessage(rsu.session, {
    version: 1, type: 'efsp-runway-status-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: 'INCIRLIK', baseRev: current().rev, actingPositionId: 'RSU', op,
  }).ack;
  const req = send({ kind: 'RequestRunwayStatus', runwayId: '05/23', action: 'WORKS', note: 'barrier re-rig' });
  assert.equal(req.ok, true, JSON.stringify(req));
  assert.equal(current().runways[0].status, 'OPEN', 'asking suspends nothing');
  refused(send({ kind: 'CloseRunway', runwayId: '05/23' }), 'PERMISSION_DENIED');
  refused(send({ kind: 'OpenRunway', runwayId: '05/23' }), 'PERMISSION_DENIED');
  // withdraw by letting LC reject it, so the shared runway is left as found
  const twr = c.LC;
  const rej = efsp.handleMessage(twr.session, {
    version: 1, type: 'efsp-runway-status-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: 'INCIRLIK', baseRev: current().rev, actingPositionId: 'LC', op: { kind: 'RejectRunwayRequest', runwayId: '05/23' },
  }).ack;
  assert.equal(rej.ok, true, JSON.stringify(rej));
});

test('a Position of the new three cannot do what only the ATC boundary Positions do: no HANDOFF, TOFI, ConvertToArrival', () => {
  const { efsp, c } = fresh();
  const s = sfaArrival(efsp, c);
  for (const kind of ['HANDOFF', 'POINT_OUT', 'TOFI', 'ConvertToArrival', 'ApproveAirspaceEntry']) {
    const ack = act(efsp, c.SFA, 'SFA', strip(efsp, s), { kind, action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' });
    refused(ack, 'PERMISSION_DENIED', null, kind);
  }
});

test('the whole walk leaves the Board empty (no Strip left behind)', () => {
  const { efsp } = fresh();
  assert.equal(live(efsp).length, 0);
});
