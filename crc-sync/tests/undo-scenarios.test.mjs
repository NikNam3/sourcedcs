import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ADR 0100's scenarios (U1–U23), driven through createEfsp() + handleMessage (the real composition root and wire
// path), with an injected wall clock for the 10 s window (no sleeps, except the NLA's 400 ms double-tap guard).

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-scn-'));
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
const { controlInvariantRefusal } = (await import('../src/efsp/board/ops/undo.js')).default;
const {
  crew, hold, act, mustAct, jumpTo, marsaAct, mustMarsaAct, carrierAct, airborneDeparture, handedToCenter,
  DEPARTURE_FLIGHT_DATA, NLA_DOUBLE_TAP_MS,
} = await import('./helpers/efsp-scenario.mjs');

const ALL = {
  OPS: 'INCIRLIK', CD: 'INCIRLIK', GC: 'INCIRLIK', LC: 'INCIRLIK', AP: 'INCIRLIK', CTR: 'CENTER',
  TAC_C2: 'TACTICAL', JTAC: 'TACTICAL',
};
const CARRIER = { CV_MARSHAL: 'CARRIER', CV_PRIFLY: 'CARRIER', CV_APP1: 'CARRIER', CV_APP2: 'CARRIER' };

let wallNow = 1_000_000;
const wallClock = { now: () => wallNow };
let n = 0;

function fresh(spec = ALL) {
  fs.rmSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, { force: true });
  wallNow = 1_000_000;
  const efsp = createEfsp({ wallClock, airborneEvidence: (strip) => (efsp.__airborne ? efsp.__airborne(strip) : false) });
  return { efsp, c: crew(efsp, spec) };
}

const board = (efsp, f = 'INCIRLIK') => efsp.boardStoreFor(f);
const get = (efsp, s, f = 'INCIRLIK') => board(efsp, f).getStrip(s.stripId);
const fdOf = (efsp, s) => efsp.flightDataStore.getFlightData(s.flightDataId);
const log = () => fs.readFileSync(process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const pause = async () => { wallNow += NLA_DOUBLE_TAP_MS + 10; }; // the guard lapses on the injected wall clock

/** The whole round trip (ack, broadcasts, directed) of one Mutation. */
function send(efsp, who, positionId, strip, op, { cmid = crypto.randomUUID(), baseRev } = {}) {
  return efsp.handleMessage(who.session, {
    version: 1, type: 'efsp-mutation', clientMutationId: cmid, facilityId: who.facilityId, actingPositionId: positionId,
    stripId: strip ? strip.stripId : undefined, baseRev: baseRev !== undefined ? baseRev : (strip ? strip.rev : undefined), op,
  });
}
const undoOp = (ack) => ({ kind: 'Undo', actionId: ack.undoable.actionId });

function refused(ack, reason, detail) {
  assert.equal(ack.ok, false, JSON.stringify(ack));
  if (reason) assert.equal(ack.reason, reason, JSON.stringify(ack));
  if (detail) assert.match(ack.detail || '', detail);
}

/** A DEPARTURE in LC's Airborne Bay (DEPARTED), whose NLA hands it off to AP. */
function departedAtLc(efsp, c, callsign = `LC${++n}`) {
  let s = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...DEPARTURE_FLIGHT_DATA, callsign },
  });
  s = jumpTo(efsp, c.OPS, 'OPS', s, 'DEPARTED');
  return mustAct(efsp, c.OPS, 'OPS', s, { kind: 'TransferStrip', toPositionId: 'LC', bayId: 'lc-airborne', rackId: 'main' });
}

// ── U1 the window ─────────────────────────────────────────────────────────

test('U1: a state-only NLA is undoable at +9.999 s and not at +10.000 s', () => {
  const { efsp, c } = fresh();
  const a = airborneDeparture(efsp, c, { ...DEPARTURE_FLIGHT_DATA, callsign: 'WIN1' });
  const b = airborneDeparture(efsp, c, { ...DEPARTURE_FLIGHT_DATA, callsign: 'WIN2' });
  const dropA = act(efsp, c.AP, 'AP', a, { kind: 'InvokeNla' });
  const dropB = act(efsp, c.AP, 'AP', b, { kind: 'InvokeNla' });
  assert.deepEqual(dropA.undoable, { actionId: dropA.undoable.actionId, label: 'Drop WIN1', windowMs: 10_000 });
  wallNow += 9_999;
  assert.equal(act(efsp, c.AP, 'AP', get(efsp, a), undoOp(dropA)).ok, true);
  wallNow += 1;
  refused(act(efsp, c.AP, 'AP', get(efsp, b), undoOp(dropB)), 'UNDO_UNAVAILABLE');
  assert.equal(get(efsp, b).state, 'DROPPED');
});

// ── U2 / U20 transfer-shaped NLA, a later edit at the receiver voided, the panel message ──

test('U2/U20: LC undoes its hand-off after AP annotated: back after its predecessor, AP\'s entry VOIDED, AP told on its panel only', () => {
  const { efsp, c } = fresh();
  const pred = departedAtLc(efsp, c, 'PRED1');
  const s = departedAtLc(efsp, c, 'VIPER1');
  const next = departedAtLc(efsp, c, 'NEXT1');
  const rackBefore = board(efsp).getRack('lc-airborne', 'main').map(x => x.stripId);
  const before = get(efsp, s);
  const handoff = act(efsp, c.LC, 'LC', s, { kind: 'InvokeNla' });
  assert.equal(handoff.strip.ownerPositionId, 'AP');
  assert.equal(handoff.undoable.label, 'Hand off VIPER1 → AP');

  wallNow += 3_000;
  const note = act(efsp, c.AP, 'AP', get(efsp, s), { kind: 'SetBlock', blockId: '9A', value: 'RV' });
  assert.equal(note.ok, true, JSON.stringify(note));

  wallNow += 3_000;
  const r = send(efsp, c.LC, 'LC', get(efsp, s), undoOp(handoff));
  assert.equal(r.ack.ok, true, JSON.stringify(r.ack));
  const now = get(efsp, s);
  assert.deepEqual([now.ownerPositionId, now.bayId, now.state], ['LC', 'lc-airborne', 'DEPARTED']);
  assert.deepEqual(board(efsp).getRack('lc-airborne', 'main').map(x => x.stripId), rackBefore, 'after its predecessor');
  assert.equal(rackBefore.length, 3, JSON.stringify([pred.stripId, s.stripId, next.stripId]));
  assert.equal(now.annotations['9A'].entries[0].status, 'VOIDED');
  assert.equal(now.annotations['9A'].entries[0].voidedBy, handoff.undoable.actionId);
  assert.equal('undoNotice' in now, false, 'no Strip marker (H100 Q-U2 b)');
  // the restored Strip is its before-image but for rev/updatedAt/updatedBy and the VOIDED entry
  const strip = (x) => { const { rev, updatedAt, updatedBy, annotations, ...rest } = x; return rest; };
  assert.deepEqual(strip(now), strip(before));
  assert.equal(now.rev, note.strip.rev + 1);

  assert.deepEqual(r.ack.voided.map(v => [v.op, v.actingPositionId]), [['SetBlock', 'AP']]);
  assert.deepEqual(r.ack.undone, { actionId: handoff.undoable.actionId, op: 'InvokeNla', label: 'Hand off VIPER1 → AP', transfer: true });
  // U20: one efsp-undo-voided, to AP's session only, naming AP's voided Mutation
  assert.equal(r.directed.length, 1);
  const forAp = efsp.directedFor(c.AP.session, r.directed[0]);
  assert.equal(forAp.type, 'efsp-undo-voided');
  assert.deepEqual([forAp.positionId, forAp.undoneBy, forAp.undoneLabel], ['AP', 'LC', 'Hand off VIPER1 → AP']);
  assert.deepEqual(forAp.voided.map(v => [v.op, v.positionId, v.summary]), [['SetBlock', 'AP', 'SetBlock on VIPER1']]);
  assert.equal(efsp.directedFor(c.LC.session, r.directed[0]), null, 'not to a session not signed on to AP');
  assert.equal(efsp.directedFor(c.OPS.session, r.directed[0]), null);
  // the audit entry
  const entry = log().filter(e => e.op === 'Undo').pop();
  assert.equal(entry.undoneActionId, handoff.undoable.actionId);
  assert.equal(entry.undoneOp, 'InvokeNla');
  assert.deepEqual(entry.voided.map(v => [v.clientMutationId, v.actingPositionId]), [[note.clientMutationId, 'AP']]);
  // the snapshot carries no notice
  assert.equal(JSON.stringify(board(efsp).snapshot()).includes('undoNotice'), false);
});

test('U20: AP not signed on when LC undoes: no message and no error; the audit still names AP\'s Mutation', () => {
  const { efsp, c } = fresh();
  const s = departedAtLc(efsp, c, 'VIPER2');
  const handoff = act(efsp, c.LC, 'LC', s, { kind: 'InvokeNla' });
  const note = act(efsp, c.AP, 'AP', get(efsp, s), { kind: 'SetBlock', blockId: '9A', value: 'RV' });
  // AP's controller signs on to a second Position too, so AP stays staffed but this session leaves it.
  const apSession = c.AP.session;
  hold(efsp, apSession, 'INCIRLIK', []);
  const r = send(efsp, c.LC, 'LC', get(efsp, s), undoOp(handoff));
  assert.equal(r.ack.ok, true, JSON.stringify(r.ack));
  assert.equal(efsp.directedFor(apSession, r.directed[0]), null);
  const entry = log().filter(e => e.op === 'Undo').pop();
  assert.equal(entry.voided[0].clientMutationId, note.clientMutationId);
});

// ── U3 a terminal Drop with a MARSA relation ─────────────────────────────

test('U3: undoing a Drop reopens the MARSA relation it ended, re-claims the code, and VOIDs the COUNT', () => {
  const { efsp, c } = fresh();
  const tanker = airborneDeparture(efsp, c, { ...DEPARTURE_FLIGHT_DATA, callsign: 'SHELL1' });
  const rx = airborneDeparture(efsp, c, { ...DEPARTURE_FLIGHT_DATA, callsign: 'VIPER3' });
  const relation = mustMarsaAct(efsp, c.AP, 'AP', null, {
    kind: 'DeclareMarsa', participants: [tanker.flightDataId, rx.flightDataId],
    startEvent: 'TANKER_ACCEPTED', endCondition: 'VERTICALLY_POSITIONED', declaringCallsign: 'SHELL1',
  });
  const code = fdOf(efsp, rx).identity.beaconAssigned;
  const r1 = send(efsp, c.AP, 'AP', get(efsp, rx), { kind: 'DropStrip' });
  assert.equal(r1.ack.ok, true);
  assert.equal(efsp.marsaStore.getRelation(relation.marsaId).state, 'ENDED');
  assert.equal(fdOf(efsp, tanker).tofi.separationRegime, 'ATC');
  assert.equal(efsp.flightDataStore.codeAllocator.holderOf(code), null);

  const r = send(efsp, c.AP, 'AP', get(efsp, rx), undoOp(r1.ack));
  assert.equal(r.ack.ok, true, JSON.stringify(r.ack));
  assert.equal(get(efsp, rx).state, 'HANDED_OFF');
  assert.equal(get(efsp, rx).flags.removeIndicator, false);
  const reopened = efsp.marsaStore.getRelation(relation.marsaId);
  assert.equal(reopened.state, 'ACTIVE');
  assert.deepEqual(reopened.participants, [tanker.flightDataId, rx.flightDataId]);
  assert.equal(fdOf(efsp, tanker).tofi.separationRegime, 'MARSA');
  assert.equal(fdOf(efsp, rx).tofi.separationRegime, 'MARSA');
  assert.equal(efsp.flightDataStore.codeAllocator.holderOf(code), rx.flightDataId);
  const reopen = log().filter(e => e.op === 'ReopenRelation').pop();
  assert.equal(reopen.causedBy, r.ack.clientMutationId);
  const undo = log().filter(e => e.op === 'Undo').pop();
  assert.equal(undo.before.state, 'DROPPED', 'the traffic count VOIDs the drop\'s COUNT from this entry (isUndoOfDrop)');
  assert.notEqual(undo.after.state, 'DROPPED');
  assert.deepEqual(r.broadcasts.slots, ['primary', 'marsa'], 'U19: Board then MARSA');
});

// ── U4 carrier handoffs ──────────────────────────────────────────────────

function checkIn(efsp, c, callsign) {
  return mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', null, {
    kind: 'CreateStrip', bayId: 'cv-marshal-stack', rackId: 'main', stripType: 'MARSHAL', flightData: { callsign, aircraftType: 'F-18C' },
  });
}
const stack = (efsp) => efsp.carrierStore.getRecord().stacks.MAIN.entries;

test('U4: Commence undone is UnmarkPushed; a PriFly removal undone is Reinsert; a refilled index blocks', () => {
  const { efsp, c } = fresh(CARRIER);
  const a = checkIn(efsp, c, 'AAA11');
  const b = checkIn(efsp, c, 'BBB22');
  const commence = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', a, { kind: 'CarrierHandoff', transfer: 'MARSHAL_TO_APPROACH', toPositionId: 'CV_APP1' });
  assert.equal(commence.ack.ok, true, JSON.stringify(commence.ack));
  assert.equal(stack(efsp)[0].status, 'PUSHED');
  const u = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a, 'CARRIER'), undoOp(commence.ack));
  assert.equal(u.ack.ok, true, JSON.stringify(u.ack));
  assert.equal(stack(efsp)[0].status, 'HOLDING');
  assert.deepEqual([get(efsp, a, 'CARRIER').state, get(efsp, a, 'CARRIER').ownerPositionId], ['IN_STACK', 'CV_MARSHAL']);
  assert.deepEqual(u.broadcasts.slots, ['primary', 'carrier'], 'U19: Board then carrier');
  assert.equal(log().filter(e => e.op === 'Stack:UnmarkPushed').pop().causedBy, u.ack.clientMutationId);

  carrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCase', to: 'II' });
  const seeYou = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a, 'CARRIER'), { kind: 'CarrierHandoff', transfer: 'MARSHAL_TO_PRIFLY' });
  assert.equal(seeYou.ack.ok, true, JSON.stringify(seeYou.ack));
  assert.deepEqual(stack(efsp).map(e => e.flightDataId), [b.flightDataId]);
  const back = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a, 'CARRIER'), undoOp(seeYou.ack));
  assert.equal(back.ack.ok, true, JSON.stringify(back.ack));
  assert.deepEqual(stack(efsp).map(e => [e.flightDataId, e.stackIndex]), [[a.flightDataId, 0], [b.flightDataId, 1]]);

  // removed again, then the vacated index is refilled before the Undo
  const again = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a, 'CARRIER'), { kind: 'CarrierHandoff', transfer: 'MARSHAL_TO_PRIFLY' });
  const d = checkIn(efsp, c, 'DDD44');
  const moved = carrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'Move', flightDataId: d.flightDataId, toIndex: 0 });
  assert.equal(moved.ack.ok, true, JSON.stringify(moved.ack));
  const blocked = send(efsp, c.CV_MARSHAL, 'CV_MARSHAL', get(efsp, a, 'CARRIER'), undoOp(again.ack));
  refused(blocked.ack, 'UNDO_BLOCKED', new RegExp(d.flightDataId));
  assert.equal(get(efsp, a, 'CARRIER').stripType, 'PATTERN', 'nothing restored');
});

// ── U6 the L19 chip ──────────────────────────────────────────────────────

test('U6: the chip\'s SetState (observedAirborne) undone: the state is back and the takeoff stamp cleared', () => {
  const { efsp, c } = fresh();
  efsp.__airborne = () => true;
  let s = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...DEPARTURE_FLIGHT_DATA, callsign: 'CHIP1' },
  });
  s = jumpTo(efsp, c.OPS, 'OPS', s, 'RUNWAY_QUEUE');
  s = mustAct(efsp, c.OPS, 'OPS', s, { kind: 'TransferStrip', toPositionId: 'LC', bayId: 'lc-runway-queue', rackId: 'rwy-05' });
  const chip = act(efsp, c.LC, 'LC', s, { kind: 'SetState', toState: 'DEPARTED', observedAirborne: true });
  assert.equal(chip.ok, true, JSON.stringify(chip));
  assert.ok(fdOf(efsp, s).timeInputs.takeoffStampedUtc != null);
  const u = act(efsp, c.LC, 'LC', get(efsp, s), undoOp(chip));
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(get(efsp, s).state, s.state);
  assert.equal(fdOf(efsp, s).timeInputs.takeoffStampedUtc, null);
});

// ── U7 / U8 TOFI ─────────────────────────────────────────────────────────

const tac = (efsp, id) => efsp.boardStoreFor('TACTICAL').getStrip(id);

function underTofi(efsp, c, callsign) {
  const atCenter = handedToCenter(efsp, c, airborneDeparture(efsp, c, { ...DEPARTURE_FLIGHT_DATA, callsign }));
  const proposed = mustAct(efsp, c.CTR, 'CTR', atCenter, { kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2' });
  const mission = mustAct(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, proposed.tofiCoordination.peerStripId), { kind: 'TOFI', action: 'ACCEPT', separationRegime: 'MARSA' });
  let ctr = efsp.boardStoreFor('CENTER').getStrip(atCenter.stripId);
  ctr = mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'SetBlock', blockId: 'SREG', value: 'ATC' });
  return { ctr, mission };
}

test('U7: TOFI Exit undone before the MRU answers: both Strips ACTIVE ENTRY, InterfacilityUndo on the MRU Board; after the answer: UNDO_BLOCKED', () => {
  const { efsp, c } = fresh();
  const { ctr, mission } = underTofi(efsp, c, 'TOFI1');
  const exit = send(efsp, c.CTR, 'CTR', ctr, { kind: 'TOFI', action: 'PROPOSE', direction: 'EXIT' });
  assert.equal(exit.ack.ok, true, JSON.stringify(exit.ack));
  assert.equal(tac(efsp, mission.stripId).tofiCoordination.direction, 'EXIT');
  const u = send(efsp, c.CTR, 'CTR', efsp.boardStoreFor('CENTER').getStrip(ctr.stripId), undoOp(exit.ack));
  assert.equal(u.ack.ok, true, JSON.stringify(u.ack));
  for (const s of [efsp.boardStoreFor('CENTER').getStrip(ctr.stripId), tac(efsp, mission.stripId)]) {
    assert.deepEqual([s.tofiCoordination.state, s.tofiCoordination.direction], ['ACTIVE', 'ENTRY']);
  }
  assert.deepEqual(u.broadcasts.slots, ['primary', 'peer'], 'U19: Board then Interfacility');
  const peerEntry = log().filter(e => e.op === 'InterfacilityUndo').pop();
  assert.deepEqual([peerEntry.facilityId, peerEntry.causedBy, peerEntry.stripId], ['TACTICAL', u.ack.clientMutationId, mission.stripId]);

  // again, and the MRU answers first
  const exit2 = send(efsp, c.CTR, 'CTR', efsp.boardStoreFor('CENTER').getStrip(ctr.stripId), { kind: 'TOFI', action: 'PROPOSE', direction: 'EXIT' });
  assert.equal(exit2.ack.ok, true, JSON.stringify(exit2.ack));
  const answer = act(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, mission.stripId), { kind: 'TOFI', action: 'REJECT', note: 'not yet' });
  assert.equal(answer.ok, true, JSON.stringify(answer));
  refused(send(efsp, c.CTR, 'CTR', efsp.boardStoreFor('CENTER').getStrip(ctr.stripId), undoOp(exit2.ack)).ack, 'UNDO_BLOCKED', /TACTICAL/);
});

test('U8: TOFI ENTRY proposal undone: the MISSION Strip it minted on the MRU Board is removed (gone in the MRU delta)', () => {
  const { efsp, c } = fresh();
  const atCenter = handedToCenter(efsp, c, airborneDeparture(efsp, c, { ...DEPARTURE_FLIGHT_DATA, callsign: 'TOFI2' }));
  const entry = send(efsp, c.CTR, 'CTR', atCenter, { kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2' });
  assert.equal(entry.ack.ok, true, JSON.stringify(entry.ack));
  const minted = entry.ack.strip.tofiCoordination.peerStripId;
  assert.ok(tac(efsp, minted));
  const u = send(efsp, c.CTR, 'CTR', efsp.boardStoreFor('CENTER').getStrip(atCenter.stripId), undoOp(entry.ack));
  assert.equal(u.ack.ok, true, JSON.stringify(u.ack));
  assert.equal(tac(efsp, minted), null);
  assert.equal(u.ack.strip.tofiCoordination, atCenter.tofiCoordination === undefined ? undefined : atCenter.tofiCoordination);
  const peer = u.broadcasts[u.broadcasts.slots.indexOf('peer')];
  assert.deepEqual(peer.strips.gone, [minted]);
  assert.equal(peer.facilityId, 'TACTICAL');
});

// ── U9 who may undo ──────────────────────────────────────────────────────

test('U9: the new owner may not undo; a JTAC undoes its own hand-back (Undo is not an op-kind grant)', () => {
  const { efsp, c } = fresh();
  const s = departedAtLc(efsp, c);
  const handoff = act(efsp, c.LC, 'LC', s, { kind: 'InvokeNla' });
  refused(act(efsp, c.AP, 'AP', get(efsp, s), undoOp(handoff)), 'PERMISSION_DENIED');

  let line = mustAct(efsp, c.TAC_C2, 'TAC_C2', null, { kind: 'CreateStrip', bayId: 'tac-c2-tasked', rackId: 'main', stripType: 'MISSION', flightData: { callsign: 'JT1' } });
  for (const st of ['AIRBORNE', 'ON_STATION']) line = jumpTo(efsp, c.TAC_C2, 'TAC_C2', line, st);
  line = mustAct(efsp, c.TAC_C2, 'TAC_C2', line, { kind: 'TransferStrip', toPositionId: 'JTAC', bayId: 'jtac-mission', rackId: 'main' });
  const handBack = act(efsp, c.JTAC, 'JTAC', line, { kind: 'TransferStrip', toPositionId: 'TAC_C2', bayId: 'tac-c2-on-station', rackId: 'main' });
  assert.equal(handBack.ok, true, JSON.stringify(handBack));
  const u = act(efsp, c.JTAC, 'JTAC', tac(efsp, line.stripId), undoOp(handBack));
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.deepEqual([tac(efsp, line.stripId).ownerPositionId, tac(efsp, line.stripId).bayId], ['JTAC', 'jtac-mission']);
});

// ── U10 a later Interfacility proposal blocks ────────────────────────────

test('U10: after LC\'s hand-off AP proposes a HANDOFF to CENTER; LC\'s Undo is UNDO_BLOCKED naming AP\'s Mutation', () => {
  const { efsp, c } = fresh();
  let s = departedAtLc(efsp, c);
  const handoff = act(efsp, c.LC, 'LC', s, { kind: 'InvokeNla' });
  s = jumpTo(efsp, c.AP, 'AP', get(efsp, s), 'HANDED_OFF');
  const proposal = act(efsp, c.AP, 'AP', get(efsp, s), { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' });
  assert.equal(proposal.ok, true, JSON.stringify(proposal));
  refused(act(efsp, c.LC, 'LC', get(efsp, s), undoOp(handoff)), 'UNDO_BLOCKED', /HANDOFF by AP/);
});

// ── U11 sign-off ─────────────────────────────────────────────────────────

test('U11: the performing Position signed off: NOT_STAFFED; from another Position: PERMISSION_DENIED', () => {
  const { efsp, c } = fresh();
  const s = departedAtLc(efsp, c);
  const handoff = act(efsp, c.LC, 'LC', s, { kind: 'InvokeNla' });
  hold(efsp, c.LC.session, 'INCIRLIK', ['AP']); // LC's controller leaves LC (AP is held by AP's: an Observer there)
  refused(act(efsp, c.LC, 'LC', get(efsp, s), undoOp(handoff)), 'NOT_HOLDING_POSITION');
  // the Board's own gate, below the wire's
  const r = board(efsp).applyMutation({ clientMutationId: crypto.randomUUID(), stripId: s.stripId, op: undoOp(handoff) }, 'LC', 'c-LC');
  refused(r, 'NOT_STAFFED');
  refused(act(efsp, c.AP, 'AP', get(efsp, s), undoOp(handoff)), 'PERMISSION_DENIED');
});

// ── U12 idempotency ──────────────────────────────────────────────────────

test('U12: an Undo re-sent with its cmid and the original action re-sent answer from the cache; nothing re-applies', () => {
  const { efsp, c } = fresh();
  const s = departedAtLc(efsp, c);
  const actionCmid = crypto.randomUUID();
  const handoff = send(efsp, c.LC, 'LC', s, { kind: 'InvokeNla' }, { cmid: actionCmid }).ack;
  const undoCmid = crypto.randomUUID();
  const first = send(efsp, c.LC, 'LC', get(efsp, s), undoOp(handoff), { cmid: undoCmid });
  assert.equal(first.ack.ok, true);
  const rev = get(efsp, s).rev;
  const again = send(efsp, c.LC, 'LC', get(efsp, s), undoOp(handoff), { cmid: undoCmid });
  assert.equal(again.ack.ok, true);
  assert.equal(again.broadcasts.length, 0);
  const original = send(efsp, c.LC, 'LC', s, { kind: 'InvokeNla' }, { cmid: actionCmid });
  assert.equal(original.broadcasts.length, 0, 'the mis-click is not re-applied');
  assert.equal(get(efsp, s).rev, rev);
  assert.equal(get(efsp, s).ownerPositionId, 'LC');
});

// ── U13 restart ──────────────────────────────────────────────────────────

test('U13: after a restart the window is gone (UNDO_UNAVAILABLE) and the Board has a new epoch', () => {
  const { efsp, c } = fresh();
  const s = departedAtLc(efsp, c);
  const handoff = act(efsp, c.LC, 'LC', s, { kind: 'InvokeNla' });
  const epoch = board(efsp).epoch;
  const restarted = createEfsp({ wallClock });
  const c2 = crew(restarted, ALL);
  assert.notEqual(restarted.boardStoreFor('INCIRLIK').epoch, epoch);
  refused(act(restarted, c2.LC, 'LC', restarted.boardStoreFor('INCIRLIK').getStrip(s.stripId), undoOp(handoff)), 'UNDO_UNAVAILABLE');
});

// ── U15 / U16 flight data ────────────────────────────────────────────────

test('U15/U16: an observed code survives the Undo; AP\'s later FL240 is VOIDED and LC\'s earlier altitude ACTIVE again', () => {
  const { efsp, c } = fresh();
  let s = departedAtLc(efsp, c, 'ALT1');
  s = mustAct(efsp, c.LC, 'LC', s, { kind: 'SetBlock', blockId: '21', value: 'FL100' });
  const handoff = act(efsp, c.LC, 'LC', s, { kind: 'InvokeNla' });
  wallNow += 2_000;
  efsp.flightDataStore.setBeaconObserved(s.flightDataId, '4321');
  const fl = act(efsp, c.AP, 'AP', get(efsp, s), { kind: 'SetBlock', blockId: '21', value: 'FL240' });
  assert.equal(fl.ok, true, JSON.stringify(fl));
  const u = act(efsp, c.LC, 'LC', get(efsp, s), undoOp(handoff));
  assert.equal(u.ok, true, JSON.stringify(u));
  const fd = fdOf(efsp, s);
  assert.equal(fd.identity.beaconObserved, '4321', 'surveillance is never restored');
  assert.deepEqual(fd.clearance.altitude.entries.map(e => [e.value, e.status]), [['FL100', 'ACTIVE'], ['FL240', 'VOIDED']]);
  assert.equal(fd.clearance.altitude.entries[1].voidedBy, handoff.undoable.actionId);
});

// ── U21 two actions on one Strip ─────────────────────────────────────────

test('U21: two moves by one Position (a drag, then a Drop): undoing the first voids both; undoing the second reverts only it', async () => {
  for (const which of ['first', 'second']) {
    const { efsp, c } = fresh();
    const s = mustAct(efsp, c.OPS, 'OPS', null, {
      kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...DEPARTURE_FLIGHT_DATA, callsign: 'TWO1' },
    });
    const cd = jumpTo(efsp, c.OPS, 'OPS', s, 'HANDED_OFF');
    const toAp = mustAct(efsp, c.OPS, 'OPS', cd, { kind: 'TransferStrip', toPositionId: 'AP', bayId: 'ap-departures', rackId: 'main' });
    const one = act(efsp, c.AP, 'AP', toAp, { kind: 'SetFlag', flag: 'highlight', value: 'yellow' });
    assert.equal(one.undoable, undefined, 'SetFlag is an edit, not undoable');
    const nla1 = act(efsp, c.AP, 'AP', get(efsp, s), { kind: 'MoveStrip', bayId: 'ap-departures', rackId: 'main' });
    const nla2 = act(efsp, c.AP, 'AP', get(efsp, s), { kind: 'SetState', toState: 'DROPPED' });
    assert.ok(nla1.undoable && nla2.undoable, JSON.stringify([nla1, nla2]));
    if (which === 'first') {
      const u = act(efsp, c.AP, 'AP', get(efsp, s), undoOp(nla1));
      assert.equal(u.ok, true, JSON.stringify(u));
      assert.equal(get(efsp, s).state, 'HANDED_OFF');
      assert.deepEqual(u.voided.map(v => v.op), ['SetState']);
      refused(act(efsp, c.AP, 'AP', get(efsp, s), undoOp(nla2)), 'UNDO_UNAVAILABLE');
    } else {
      const u = act(efsp, c.AP, 'AP', get(efsp, s), undoOp(nla2));
      assert.equal(u.ok, true, JSON.stringify(u));
      assert.equal(get(efsp, s).state, 'HANDED_OFF');
      assert.deepEqual(u.voided, []);
      refused(act(efsp, c.AP, 'AP', get(efsp, s), undoOp(nla1)), 'UNDO_UNAVAILABLE', null);
    }
  }
});

// ── U19 the wire ─────────────────────────────────────────────────────────

test('U19: the ack carries undoable; an Undo without actionId is refused; its baseRev is not checked', () => {
  const { efsp, c } = fresh();
  const s = departedAtLc(efsp, c);
  const handoff = send(efsp, c.LC, 'LC', s, { kind: 'InvokeNla' }).ack;
  assert.deepEqual(Object.keys(handoff.undoable).sort(), ['actionId', 'label', 'windowMs']);
  refused(act(efsp, c.LC, 'LC', get(efsp, s), { kind: 'Undo' }), 'VALIDATION_ERROR', /actionId/);
  const r = send(efsp, c.LC, 'LC', get(efsp, s), undoOp(handoff), { baseRev: 1 });
  assert.equal(r.ack.ok, true, JSON.stringify(r.ack));
  const edit = act(efsp, c.LC, 'LC', get(efsp, s), { kind: 'SetBlock', blockId: '9A', value: 'X' });
  assert.equal(edit.undoable, undefined, 'an edit is not undoable');
});

// ── U23 the control invariant ────────────────────────────────────────────

test('U23: a restored HANDOFF record naming a retired holder is UNDO_BLOCKED (the backstop); a live one passes', () => {
  const strip = (state) => ({ stripId: 'p1', state });
  const images = [{ facilityId: 'INCIRLIK', stripId: 's1', strip: { stripId: 's1', state: 'HANDED_OFF', coordination: { primitive: 'HANDOFF', state: 'ACTIVE', peerFacilityId: 'CENTER', peerStripId: 'p1' } } }];
  for (const [peer, blocked] of [[strip('DROPPED'), true], [null, true], [strip('INBOUND'), false]]) {
    const env = { boardFor: () => ({ getStrip: () => peer }) };
    const r = controlInvariantRefusal(env, images, new Map());
    assert.equal(!!r, blocked, JSON.stringify(peer));
    if (r) assert.equal(r.reason, 'UNDO_BLOCKED');
  }
});

test('U23: in a scenario the cross-Facility block comes first: CTR dropped its accepted replica, AP\'s Undo is refused', () => {
  const { efsp, c } = fresh();
  const s = airborneDeparture(efsp, c, { ...DEPARTURE_FLIGHT_DATA, callsign: 'INV1' });
  const move = act(efsp, c.AP, 'AP', s, { kind: 'MoveStrip', bayId: 'ap-departures', rackId: 'main' });
  const ctr = handedToCenter(efsp, c, get(efsp, s));
  assert.ok(ctr);
  refused(act(efsp, c.AP, 'AP', get(efsp, s), undoOp(move)), 'UNDO_BLOCKED');
});
