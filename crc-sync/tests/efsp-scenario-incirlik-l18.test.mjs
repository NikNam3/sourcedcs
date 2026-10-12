import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

/* L18's walks (docs/adr/0075, 0093), as docs/adr/0117 left them: Incirlik's RSU and PAR on the wire, and the single
 * frequency approach between AP and PAR (no SFA Position; JO 7610.14A para 7-1-5, JO 7110.65BB para 4-7-3, 5-10-15).
 *
 * Not just the lifecycle. Each flow is walked the way pilots disturb it
 * (decisions memory "walk pilot requests"): a pilot who SWITCHES (asks for a
 * different frequency, goes back round the pattern), CANCELS (a missed
 * approach, a drop, a handoff that finds PAR unstaffed), and ARRIVES LATE (the
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
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '{}');

const { createEfsp } = await import('../src/efsp/index.js');
const {
  crew, hold, freshEfsp, act, mustAct, advance,
} = await import('./helpers/efsp-scenario.mjs');

const STAFFED = { OPS: 'INCIRLIK', GC: 'INCIRLIK', LC: 'INCIRLIK', RSU: 'INCIRLIK', AP: 'INCIRLIK', PAR: 'INCIRLIK' };
const MS = { 'freq-1': 232.1, 'freq-2': 233.1, 'freq-3': 234.1, 'freq-4': 235.1, 'freq-5': 236.1 };
const board = (efsp) => efsp.boardStoreFor('INCIRLIK');
const strip = (efsp, s) => board(efsp).getStrip(s.stripId);
const live = (efsp) => board(efsp).getAll().filter(s => s.state !== 'DROPPED');
const mutations = () => fs.readFileSync(process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH, 'utf8').trim().split('\n').map(l => JSON.parse(l));
let n = 0;

const fresh = () => freshEfsp(createEfsp, STAFFED);

function refused(ack, reason, detail, label = '') {
  assert.equal(ack.ok, false, `${label} should be refused: ${JSON.stringify(ack)}`);
  if (reason) assert.equal(ack.reason, reason, `${label}: ${JSON.stringify(ack)}`);
  if (detail) assert.match(ack.detail || '', detail, label);
}

/** An inbound ARRIVAL with AP; on an SFA frequency when `rackId` is given (AP files it on that Rack of ap-sfa). */
function arrival(efsp, c, rackId = 'freq-2') {
  const s = mustAct(efsp, c.AP, 'AP', null, {
    kind: 'CreateStrip', bayId: 'ap-inbound', rackId: 'main', stripType: 'ARRIVAL',
    flightData: { callsign: `ARR${++n}`, aircraftType: 'F16', wakeCategory: 'M', originAirport: 'LTAG' },
  });
  return rackId ? mustAct(efsp, c.AP, 'AP', s, { kind: 'MoveStrip', bayId: 'ap-sfa', rackId }) : s;
}

/** AP's handoff to the final controller: an ordinary strip transfer into PAR's final Bay. */
const toPar = { kind: 'TransferStrip', toPositionId: 'PAR', bayId: 'par-final', rackId: 'main' };
const landed = { kind: 'FinalCall', call: 'LANDED' };

const flightDataOf = (efsp, s) => efsp.flightDataStore.getFlightData(s.flightDataId);
const freqOf = (efsp, s) => flightDataOf(efsp, s).comms.workingFrequencyMhz;

// ── Single frequency approach: AP and PAR ───────────────────────────────────

test('T1: AP files the arrival on an SFA frequency and hands it to PAR; the strip type changes in place, the frequency never does (para 5-10-15)', () => {
  const { efsp, c } = fresh();
  const s = arrival(efsp, c, 'freq-2');
  assert.equal(s.ownerPositionId, 'AP');
  assert.equal(s.bayId, 'ap-sfa');
  assert.equal(freqOf(efsp, s), MS['freq-2'], 'the Rack AP filed the Strip on is its frequency');
  const commsBefore = JSON.stringify(flightDataOf(efsp, s).comms);

  const handed = mustAct(efsp, c.AP, 'AP', strip(efsp, s), toPar);
  assert.equal(handed.ownerPositionId, 'PAR');
  assert.equal(handed.stripType, 'FINAL', 'ARRIVAL becomes FINAL in place');
  assert.equal(handed.state, 'ON_FINAL');
  assert.equal(handed.stripId, s.stripId, 'same Strip');
  assert.equal(handed.flightDataId, s.flightDataId, 'same flight');
  assert.equal(handed.bayId, 'par-final');
  assert.equal(JSON.stringify(flightDataOf(efsp, s).comms), commsBefore, 'no frequency change, no transition');
  assert.deepEqual(
    { kind: handed.sfaTransfer.kind, trigger: handed.sfaTransfer.trigger, from: handed.sfaTransfer.from, to: handed.sfaTransfer.to, frequencyRackId: handed.sfaTransfer.frequencyRackId },
    { kind: 'PAR_HANDOFF', trigger: 'CONTROLLER_INITIATED', from: 'AP', to: 'PAR', frequencyRackId: 'freq-2' });
  const log = mutations().filter(m => m.op === 'TransferStrip' && m.conversion);
  assert.equal(log.at(-1).conversion, 'PAR_HANDOFF');
});

test('T1: the drop the live test refused works: an arrival AP never put on an SFA frequency is handed to PAR the same way (a frequency change is the pilot\'s, ¶5-9-4 d.3)', () => {
  const { efsp, c } = fresh();
  const s = arrival(efsp, c, null);
  const handed = mustAct(efsp, c.AP, 'AP', s, toPar);
  assert.equal(handed.stripType, 'FINAL');
  assert.equal(handed.sfaTransfer.frequencyRackId, null, 'no SFA Rack was left');
});

test('only AP hands an arrival to PAR: LC and RSU may not, and a FINAL already with PAR is not handed again', () => {
  const { efsp, c } = fresh();
  const s = arrival(efsp, c, 'freq-3');
  const lcBound = mustAct(efsp, c.AP, 'AP', s, { kind: 'TransferStrip', toPositionId: 'LC', bayId: 'lc-arrivals', rackId: 'main' });
  assert.equal(lcBound.state, 'HANDED_TO_TOWER');
  refused(act(efsp, c.LC, 'LC', strip(efsp, s), toPar), null, /only valid next state/, 'LC to PAR');
  const t = arrival(efsp, c, 'freq-4');
  mustAct(efsp, c.AP, 'AP', t, toPar);
  refused(act(efsp, c.AP, 'AP', strip(efsp, t), toPar), 'NOT_OWNER', null, 'a second press by the old owner');
});

test('a pilot SWITCHES frequency before the handoff: AP drags the Strip to another Rack, the frequency follows; the handoff then leaves it alone', () => {
  const { efsp, c } = fresh();
  const s = arrival(efsp, c, 'freq-1');
  assert.equal(freqOf(efsp, s), MS['freq-1']);
  const moved = mustAct(efsp, c.AP, 'AP', strip(efsp, s), { kind: 'MoveStrip', bayId: 'ap-sfa', rackId: 'freq-4' });
  assert.equal(moved.rackId, 'freq-4');
  assert.equal(freqOf(efsp, s), MS['freq-4']);
  assert.equal(flightDataOf(efsp, s).comms.transitions.at(-1).workingFrequencyMhz, MS['freq-4'], 'the transition is on the flight');
  mustAct(efsp, c.AP, 'AP', strip(efsp, s), toPar);
  assert.equal(freqOf(efsp, s), MS['freq-4']);
});

test('T5: Landed sends the Strip to GC as an ARRIVAL at TAXI_IN, PAR\'s final Bay is free, and a second aircraft is handed to PAR', () => {
  const { efsp, c } = fresh();
  const a = arrival(efsp, c, 'freq-2');
  const b = arrival(efsp, c, 'freq-3');
  mustAct(efsp, c.AP, 'AP', strip(efsp, a), toPar);
  // PAR holds one aircraft at a time: B waits with AP
  refused(act(efsp, c.AP, 'AP', strip(efsp, b), toPar), 'VALIDATION_ERROR', /par-final holds 1 Strip at a time/);
  assert.equal(strip(efsp, b).ownerPositionId, 'AP');
  assert.equal(strip(efsp, b).stripType, 'ARRIVAL');

  const down = mustAct(efsp, c.PAR, 'PAR', strip(efsp, a), landed);
  assert.deepEqual([down.stripType, down.state, down.ownerPositionId, down.bayId], ['ARRIVAL', 'TAXI_IN', 'GC', 'gc-taxi-in']);
  assert.equal(freqOf(efsp, a), MS['freq-2'], 'the frequency is the flight\'s; GC is the pilot\'s next call ("CONTACT ... AFTER LANDING", ¶5-12-9)');
  assert.equal(board(efsp).getAll().filter(x => x.bayId === 'par-final' && x.state !== 'DROPPED').length, 0, 'PAR\'s final Bay is empty');

  const bIn = mustAct(efsp, c.AP, 'AP', strip(efsp, b), toPar);
  assert.equal(bIn.bayId, 'par-final');
  assert.equal(bIn.ownerPositionId, 'PAR');
  // GC ends A's flight the ordinary way
  const gone = mustAct(efsp, c.GC, 'GC', strip(efsp, a), { kind: 'InvokeNla' });
  assert.equal(gone.state, 'DROPPED');
  const log = mutations().filter(m => m.op === 'FinalCall');
  assert.equal(log.at(-1).finalCall, 'LANDED');
  assert.equal(log.at(-1).conversion, 'LANDED');
});

test('the FINAL NLA at an airfield is Landed (the same transfer), never BALL; a drag to GC\'s taxi-in Bay does the same', async () => {
  const { efsp, c } = fresh();
  const a = arrival(efsp, c);
  mustAct(efsp, c.AP, 'AP', strip(efsp, a), toPar);
  const byNla = await advance(efsp, c.PAR, 'PAR', strip(efsp, a));
  assert.deepEqual([byNla.stripType, byNla.state, byNla.ownerPositionId], ['ARRIVAL', 'TAXI_IN', 'GC']);
  const b = arrival(efsp, c);
  mustAct(efsp, c.AP, 'AP', strip(efsp, b), toPar);
  const byDrag = mustAct(efsp, c.PAR, 'PAR', strip(efsp, b), { kind: 'TransferStrip', toPositionId: 'GC', bayId: 'gc-taxi-in', rackId: 'main' });
  assert.deepEqual([byDrag.stripType, byDrag.state, byDrag.ownerPositionId], ['ARRIVAL', 'TAXI_IN', 'GC']);
});

test('Begin descent and Cleared to land are recorded once each; Begin descent ends the assigned altitude (¶5-12-3, H134 LT-RQ8 a)', () => {
  const { efsp, c } = fresh();
  const s = arrival(efsp, c);
  mustAct(efsp, c.AP, 'AP', strip(efsp, s), { kind: 'SetBlock', blockId: '7', value: '030' });
  mustAct(efsp, c.AP, 'AP', strip(efsp, s), { kind: 'SetBlock', blockId: '9A-VECTOR', value: '050' });
  mustAct(efsp, c.AP, 'AP', strip(efsp, s), toPar);
  const active = (field) => (flightDataOf(efsp, s).clearance[field].entries.find(e => e.status === 'ACTIVE') || {}).value;
  assert.equal(active('altitude'), '030');
  // PAR changes the heading and the altitude on the FINAL Strip (H134: PAR needs to)
  mustAct(efsp, c.PAR, 'PAR', strip(efsp, s), { kind: 'SetBlock', blockId: '9A-VECTOR', value: '060' });
  mustAct(efsp, c.PAR, 'PAR', strip(efsp, s), { kind: 'SetBlock', blockId: '7A', value: '025' });
  assert.equal(active('heading'), '060');
  assert.equal(active('altitude'), '025');
  const d = mustAct(efsp, c.PAR, 'PAR', strip(efsp, s), { kind: 'FinalCall', call: 'BEGIN_DESCENT' });
  assert.ok(d.finalCalls.BEGIN_DESCENT.at > 0);
  assert.equal(active('altitude'), '', 'no assigned altitude on the glidepath');
  assert.equal(active('heading'), '060', 'the heading stays recorded');
  refused(act(efsp, c.PAR, 'PAR', strip(efsp, s), { kind: 'FinalCall', call: 'BEGIN_DESCENT' }), 'VALIDATION_ERROR', /already recorded/);
  const ctl = mustAct(efsp, c.PAR, 'PAR', strip(efsp, s), { kind: 'FinalCall', call: 'CLEARED_TO_LAND' });
  assert.ok(ctl.finalCalls.CLEARED_TO_LAND);
  refused(act(efsp, c.AP, 'AP', strip(efsp, s), { kind: 'FinalCall', call: 'CLEARED_TO_LAND' }), 'PERMISSION_DENIED', null, 'AP records no final call');
  refused(act(efsp, c.PAR, 'PAR', strip(efsp, s), { kind: 'FinalCall', call: 'BALL' }), 'VALIDATION_ERROR', /unknown final call/);
});

test('the pilot CANCELS the approach: a missed approach from PAR, then back on final; a second aircraft is handed in meanwhile and lands first', () => {
  const { efsp, c } = fresh();
  const a = arrival(efsp, c, 'freq-2');
  const b = arrival(efsp, c, 'freq-3');
  mustAct(efsp, c.AP, 'AP', strip(efsp, a), toPar);
  const missed = mustAct(efsp, c.PAR, 'PAR', strip(efsp, a), { kind: 'SetState', toState: 'BOLTER_WAVEOFF' });
  assert.equal(missed.bayId, 'par-missed');
  const bIn = mustAct(efsp, c.AP, 'AP', strip(efsp, b), toPar);
  assert.equal(bIn.bayId, 'par-final');
  refused(act(efsp, c.PAR, 'PAR', strip(efsp, a), { kind: 'InvokeNla' }), null, /par-final holds 1 Strip/, 'A back on final');
  refused(act(efsp, c.PAR, 'PAR', strip(efsp, a), landed), 'VALIDATION_ERROR', /on final/, 'Landed from the missed approach Bay');
  mustAct(efsp, c.PAR, 'PAR', strip(efsp, b), landed);
  const aBack = mustAct(efsp, c.PAR, 'PAR', strip(efsp, a), { kind: 'InvokeNla' });
  assert.equal(aBack.state, 'ON_FINAL');
  mustAct(efsp, c.PAR, 'PAR', strip(efsp, a), landed);
  assert.deepEqual(live(efsp).map(x => x.ownerPositionId), ['GC', 'GC']);
});

test('a handoff CANCELLED by the receiver: PAR unstaffed is offered to AP (docs/adr/0110) and the Strip waits at PAR; PAR LATE to its Position finds it there', () => {
  const { efsp, c } = fresh();
  const s = arrival(efsp, c);
  hold(efsp, c.PAR.session, 'INCIRLIK', []); // PAR leaves
  const r = act(efsp, c.AP, 'AP', strip(efsp, s), toPar);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(strip(efsp, s).ownerPositionId, 'PAR');
  assert.equal(strip(efsp, s).bayId, 'par-final');
  hold(efsp, c.PAR.session, 'INCIRLIK', ['PAR']); // PAR arrives late
  mustAct(efsp, c.PAR, 'PAR', strip(efsp, s), landed);
});

test('Landed with GC unstaffed and nobody offered GC is refused and the aircraft stays with PAR', () => {
  const { efsp, c } = fresh();
  const s = arrival(efsp, c);
  mustAct(efsp, c.AP, 'AP', strip(efsp, s), toPar);
  hold(efsp, c.GC.session, 'INCIRLIK', []);
  hold(efsp, c.LC.session, 'INCIRLIK', []);
  hold(efsp, c.AP.session, 'INCIRLIK', []);
  refused(act(efsp, c.PAR, 'PAR', strip(efsp, s), landed), 'NO_RECEIVING_POSITION');
  assert.equal(strip(efsp, s).ownerPositionId, 'PAR');
  assert.equal(strip(efsp, s).stripType, 'FINAL');
});

test('U5: the handoff to PAR is undoable by AP: back on its frequency Rack after its predecessor, PAR\'s Bay empty (docs/adr/0100, H95)', () => {
  const { efsp, c } = fresh();
  const first = arrival(efsp, c);
  const s = arrival(efsp, c);
  const last = arrival(efsp, c);
  const before = strip(efsp, s);
  const rackBefore = board(efsp).getRack(before.bayId, before.rackId).map(x => x.stripId);
  assert.deepEqual(rackBefore.slice().sort(), [first.stripId, s.stripId, last.stripId].sort());
  const ack = act(efsp, c.AP, 'AP', before, toPar);
  assert.equal(ack.ok, true, JSON.stringify(ack));
  const undo = { kind: 'Undo', actionId: ack.undoable.actionId };
  refused(act(efsp, c.PAR, 'PAR', strip(efsp, s), undo), 'PERMISSION_DENIED', null, 'PAR undoing AP\'s handoff');
  const back = act(efsp, c.AP, 'AP', strip(efsp, s), undo);
  assert.equal(back.ok, true, JSON.stringify(back));
  const now = strip(efsp, s);
  assert.deepEqual([now.stripType, now.state, now.ownerPositionId, now.bayId, now.rackId],
    [before.stripType, before.state, before.ownerPositionId, before.bayId, before.rackId]);
  assert.equal(now.sfaTransfer, before.sfaTransfer);
  assert.deepEqual(board(efsp).getRack(before.bayId, before.rackId).map(x => x.stripId), rackBefore, 'after its predecessor');
  assert.deepEqual(board(efsp).getAll().filter(x => x.ownerPositionId === 'PAR' && x.state !== 'DROPPED'), [], 'PAR\'s Bay is empty');
});

test('U5: Landed is undoable by PAR: back on final, with PAR, as a FINAL', () => {
  const { efsp, c } = fresh();
  const s = arrival(efsp, c);
  mustAct(efsp, c.AP, 'AP', strip(efsp, s), toPar);
  const ack = act(efsp, c.PAR, 'PAR', strip(efsp, s), landed);
  assert.equal(ack.ok, true, JSON.stringify(ack));
  const back = act(efsp, c.PAR, 'PAR', strip(efsp, s), { kind: 'Undo', actionId: ack.undoable.actionId });
  assert.equal(back.ok, true, JSON.stringify(back));
  const now = strip(efsp, s);
  assert.deepEqual([now.stripType, now.state, now.ownerPositionId, now.bayId], ['FINAL', 'ON_FINAL', 'PAR', 'par-final']);
});

test('LATE ARRIVAL: PAR vacates with an aircraft on final; the Strip is not lost and not parked at AP (which cannot advance it): it stays PAR\'s and AP is offered PAR', () => {
  const { efsp, c } = fresh();
  const s = arrival(efsp, c);
  mustAct(efsp, c.AP, 'AP', strip(efsp, s), toPar);
  const r = hold(efsp, c.PAR.session, 'INCIRLIK', []);
  assert.deepEqual(r.ack.warnings, [{ positionId: 'PAR', count: 1, offeredTo: 'AP' }]);
  const now = strip(efsp, s);
  assert.equal(now.ownerPositionId, 'PAR');
  assert.equal(now.state, 'ON_FINAL');
  assert.equal(now.bayId, 'par-final');
  assert.equal(freqOf(efsp, s), MS['freq-2']);
  refused(act(efsp, c.AP, 'AP', now, landed), 'PERMISSION_DENIED', null, 'AP does not work the final');
  hold(efsp, c.PAR.session, 'INCIRLIK', ['PAR']);
  const back = strip(efsp, s);
  assert.equal(back.ownerPositionId, 'PAR');
  assert.equal(back.bayId, 'par-final');
});

test('there is no SFA Position and no SFA rotation message (docs/adr/0117)', () => {
  const { efsp, c } = fresh();
  assert.equal(efsp.facilityConfig.getPositionSet('INCIRLIK').includes('SFA'), false);
  const r = efsp.handleMessage(c.AP.session, { version: 1, type: 'efsp-sfa-mutation', clientMutationId: crypto.randomUUID(), actingPositionId: 'AP', op: { kind: 'SetSfaRotation', rackId: 'freq-2', positionId: 'PAR' } });
  assert.ok(!r || !r.ack || r.ack.ok !== true, 'nothing applies it');
  assert.equal(efsp.snapshotFor(c.AP.session).sfaRotation, undefined);
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

test('LATE ARRIVAL: an aircraft is already in the pattern when RSU leaves; the Strip stays RSU\'s and LC is offered RSU (docs/adr/0110: RSU is back on a list)', () => {
  const { efsp, c } = fresh();
  const s = patternStrip(efsp, c, 'base');
  const r = hold(efsp, c.RSU.session, 'INCIRLIK', []);
  const now = strip(efsp, s);
  // Nothing is re-routed and nothing is lost: the Strip stays owned by RSU in its Bay, and the ack names who is offered it.
  assert.equal(now.ownerPositionId, 'RSU');
  assert.equal(now.bayId, 'rsu-pattern');
  assert.deepEqual(r.ack.warnings, [{ positionId: 'RSU', count: 1, offeredTo: 'LC' }]);
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
  const lc = c.LC;
  const rej = efsp.handleMessage(lc.session, {
    version: 1, type: 'efsp-runway-status-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: 'INCIRLIK', baseRev: current().rev, actingPositionId: 'LC', op: { kind: 'RejectRunwayRequest', runwayId: '05/23' },
  }).ack;
  assert.equal(rej.ok, true, JSON.stringify(rej));
});

test('PAR cannot do what only the ATC boundary Positions do: no HANDOFF, TOFI, ConvertToArrival', () => {
  const { efsp, c } = fresh();
  const s = arrival(efsp, c);
  mustAct(efsp, c.AP, 'AP', strip(efsp, s), toPar);
  for (const kind of ['HANDOFF', 'POINT_OUT', 'TOFI', 'ConvertToArrival', 'ApproveAirspaceEntry']) {
    const ack = act(efsp, c.PAR, 'PAR', strip(efsp, s), { kind, action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' });
    refused(ack, 'PERMISSION_DENIED', null, kind);
  }
});

test('the whole walk leaves the Board empty (no Strip left behind)', () => {
  const { efsp } = fresh();
  assert.equal(live(efsp).length, 0);
});
