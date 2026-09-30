import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

/* Field-state sorties — Incirlik's runway walked by hand (WP6, guide §9.7,
 * docs/adr/0061).
 *
 * §13's two field-state acceptance criteria, asserted word for word by the
 * sorties that carry them:
 *
 *   "A barrier reconfiguration suspends the runway, inhibits takeoff and
 *    landing NLA with the reason shown, and requires an attributable
 *    inspection-complete action to resume"
 *
 *   "A runway change cannot be initiated without `OPS` and `APP`
 *    acknowledgement."
 *
 * The rest are the questions a lifecycle never poses: a departure already
 * taxiing when the runway goes, one moved to the other direction's rack, an
 * aircraft already on final, two controllers at once, a crc-sync restart in
 * the middle, a controller holding every Position alone.
 *
 * Tower is the sole authority over the runway (decisions.md H18): OPS asks for
 * the barrier change and TWR takes the runway out; OPS then signs off the
 * inspection. The gear itself is data only (H17).
 *
 * Its own durable board, like every scenario file (ADR 0002), so the tests
 * share one field: each drives it back to OPEN, with no change open, before
 * it ends.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-field-state-scn-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');

const { createEfsp } = await import('../src/efsp/index.js');
const {
  crew, hold, act, mustAct, jumpTo, advance, DEPARTURE_FDR, NLA_DOUBLE_TAP_MS,
} = await import('./helpers/efsp-scenario.mjs');

const ATC = { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER' };
const RWY = '05/23';

let efsp = createEfsp();
let c = crew(efsp, ATC);

// ── local helpers (the shared harness is append-only and L8 is adding to it;
//    the integrator may hoist these) ────────────────────────────────────────

function fieldStateAct(e, member, positionId, op, { baseRev } = {}) {
  const current = e.fieldStateStore.getFieldState('INCIRLIK');
  return e.handleMessage(member.session, {
    version: 1, type: 'efsp-field-state-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: 'INCIRLIK', baseRev: baseRev === undefined ? current.rev : baseRev,
    actingPositionId: positionId, op,
  }).ack;
}

function mustFieldStateAct(e, member, positionId, op) {
  const ack = fieldStateAct(e, member, positionId, op);
  assert.equal(ack.ok, true, `${op.kind} as ${positionId}: ${JSON.stringify({ reason: ack.reason, detail: ack.detail })}`);
  return ack.fieldState;
}

const runway = (e = efsp) => e.fieldStateStore.getFieldState('INCIRLIK').runways.find(r => r.runwayId === RWY);
const fieldState = (e = efsp) => e.fieldStateStore.getFieldState('INCIRLIK');
const strip = (s, e = efsp) => e.boardStore.getStrip(s.stripId);
const mutations = () => fs.readFileSync(process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let n = 0;
/** A DEPARTURE parked at `state`, owned by the right Position, in the right Bay and Rack. */
function departure(state, { runway: rwy = '05', rackId = 'rwy-05', e = efsp, crewOf = c } = {}) {
  let s = mustAct(e, crewOf.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE',
    fdr: { ...DEPARTURE_FDR, callsign: `RWY${++n}`, departureRunway: rwy },
  });
  if (state === 'TAXI') {
    s = jumpTo(e, crewOf.OPS, 'OPS', s, 'TAXI');
    return mustAct(e, crewOf.OPS, 'OPS', s, { kind: 'TransferStrip', toPositionId: 'GND', bayId: 'gnd-taxi-out', rackId: 'main' });
  }
  s = jumpTo(e, crewOf.OPS, 'OPS', s, 'RUNWAY_QUEUE');
  s = mustAct(e, crewOf.OPS, 'OPS', s, { kind: 'TransferStrip', toPositionId: 'TWR', bayId: 'twr-runway-queue', rackId });
  if (state === 'LUAW') s = jumpTo(e, crewOf.TWR, 'TWR', s, 'LUAW');
  return s;
}

/** An ARRIVAL with tower, at `state`, with 8B set to `rwy`. */
function arrival(state, { rwy = '05' } = {}) {
  let s = mustAct(efsp, c.APP, 'APP', null, {
    kind: 'CreateStrip', bayId: 'app-inbound', rackId: 'main', role: 'ARRIVAL',
    fdr: { callsign: `ARR${++n}`, aircraftType: 'F16', wakeCategory: 'M', originAirport: 'LTAG' },
  });
  s = jumpTo(efsp, c.APP, 'APP', s, 'HANDED_TO_TOWER');
  s = mustAct(efsp, c.APP, 'APP', s, { kind: 'TransferStrip', toPositionId: 'TWR', bayId: 'twr-arrivals', rackId: 'main' });
  if (rwy) s = mustAct(efsp, c.TWR, 'TWR', s, { kind: 'SetBlock', blockId: '8B', value: rwy });
  if (state === 'FINAL') s = jumpTo(efsp, c.TWR, 'TWR', s, 'FINAL');
  return s;
}

/** Barrier change the way H18 has it: OPS asks, tower takes the runway out. */
function suspendForBarrierChange(e = efsp, crewOf = c) {
  mustFieldStateAct(e, crewOf.OPS, 'OPS', { kind: 'RequestRunwayStatus', runwayId: RWY, action: 'BARRIER_CHANGE', note: 'BAK-12 re-rig' });
  return mustFieldStateAct(e, crewOf.TWR, 'TWR', { kind: 'AcceptRunwayRequest', runwayId: RWY });
}

function finishAndInspect(e = efsp, crewOf = c) {
  if (runway(e).status === 'SUSPENDED_BARRIER_CHANGE') mustFieldStateAct(e, crewOf.OPS, 'OPS', { kind: 'CompleteBarrierChange', runwayId: RWY });
  return mustFieldStateAct(e, crewOf.OPS, 'OPS', { kind: 'CompleteInspection', runwayId: RWY });
}

/** Captures what the NLA status monitor puts on the ordinary board-delta. */
function captureDeltas(e = efsp) {
  const payloads = [];
  e.nlaStatusMonitor.setOnDelta(p => payloads.push(p));
  return {
    stripFor: (s) => payloads.flatMap(p => p.strips).filter(x => x.stripId === s.stripId).at(-1),
    clear: () => { payloads.length = 0; },
  };
}

// ── the sorties ────────────────────────────────────────────────────────────

test('sortie 0: before the mission wind sets an active runway, a Strip with no runway filed and in no runway rack is never inhibited', () => {
  assert.equal(fieldState().activeRunway, null);
  suspendForBarrierChange();
  const s = departure('TAXI', { runway: null });
  // Built before the suspension would have gated SetState? No — nothing
  // resolves it to a runway, so it was never gated at all.
  const status = efsp.boardStore.nlaStatusFor(strip(s));
  assert.deepEqual(status, { toState: 'RUNWAY_QUEUE', transferTo: 'TWR' });
  finishAndInspect();
  // The mission wind now sets the active end (decisions.md H22): 060 true
  // favours 05 (056 true).
  const r = efsp.fieldStateStore.setActiveRunwayFromWind('INCIRLIK', { windFromTrue: 60, windKt: 10, missionSession: 1 });
  assert.equal(r.activeRunway, '05');
});

test('sortie 1: A barrier reconfiguration suspends the runway, inhibits takeoff and landing NLA with the reason shown, and requires an attributable inspection-complete action to resume', async () => {
  const queued = departure('RUNWAY_QUEUE');
  const lined = departure('LUAW');
  const inbound = arrival('HANDED_TO_TOWER', { rwy: '05' });
  const deltas = captureDeltas();

  // "suspends the runway" — OPS asks, tower takes the pavement out (H18).
  const reason = 'runway 05/23 suspended — barrier change';
  const fsI = suspendForBarrierChange();
  const rwy = fsI.runways.find(r => r.runwayId === RWY);
  assert.equal(rwy.status, 'SUSPENDED_BARRIER_CHANGE');
  assert.equal(rwy.suspension.kind, 'BARRIER_CHANGE');
  assert.equal(rwy.suspension.positionId, 'TWR');
  assert.equal(rwy.suspension.requestedBy.positionId, 'OPS');

  // "inhibits takeoff … NLA": the queued and the lined-up departure.
  for (const s of [queued, lined]) {
    const ack = act(efsp, c.TWR, 'TWR', strip(s), { kind: 'InvokeNla' });
    assert.equal(ack.ok, false);
    assert.equal(ack.reason, 'NLA_INHIBITED');
    assert.equal(ack.detail, reason);
  }
  // "… and landing NLA": the arrival handed to tower for 05.
  const landing = act(efsp, c.TWR, 'TWR', strip(inbound), { kind: 'InvokeNla' });
  assert.equal(landing.reason, 'NLA_INHIBITED');
  assert.equal(landing.detail, reason);

  // "with the reason shown" — on the press, on the Strip's advisory stamp, and
  // on the board-delta the suspension itself caused, for every Strip it hit.
  for (const s of [queued, lined, inbound]) {
    assert.equal(efsp.boardStore.nlaStatusFor(strip(s)).inhibited, reason);
    assert.equal(deltas.stripFor(s).nla.inhibited, reason, `board-delta for ${s.stripId}`);
  }

  // "requires an attributable inspection-complete action to resume".
  mustFieldStateAct(efsp, c.OPS, 'OPS', { kind: 'CompleteBarrierChange', runwayId: RWY });
  assert.equal(runway().status, 'SUSPENDED_INSPECTION');
  assert.equal(efsp.boardStore.nlaStatusFor(strip(queued)).inhibited, 'runway 05/23 suspended — awaiting inspection');
  // No way round the inspection: tower cannot simply reopen it, and tower is
  // not the inspection authority.
  const reopen = fieldStateAct(efsp, c.TWR, 'TWR', { kind: 'OpenRunway', runwayId: RWY });
  assert.equal(reopen.ok, false);
  assert.match(reopen.detail, /only through an inspection/);
  assert.equal(fieldStateAct(efsp, c.TWR, 'TWR', { kind: 'CompleteInspection', runwayId: RWY }).reason, 'PERMISSION_DENIED');
  assert.equal(runway().status, 'SUSPENDED_INSPECTION');

  deltas.clear();
  const done = mustFieldStateAct(efsp, c.OPS, 'OPS', { kind: 'CompleteInspection', runwayId: RWY, note: 'cable tensioned, runway walked' });
  const signed = done.runways.find(r => r.runwayId === RWY);
  assert.equal(signed.status, 'OPEN');
  assert.equal(signed.lastInspection.positionId, 'OPS');
  assert.equal(signed.lastInspection.by, c.OPS.session.controllerId);
  const entry = mutations().filter(m => m.op === 'CompleteInspection' && m.ok).at(-1);
  assert.equal(entry.fieldStateFacilityId, 'INCIRLIK');
  assert.equal(entry.actingPositionId, 'OPS');
  assert.equal(entry.actorId, c.OPS.session.controllerId);
  assert.equal(entry.after.runways[0].lastInspection.positionId, 'OPS');

  // Resuming clears the reason on the next board-delta, and the NLA now works.
  assert.equal(deltas.stripFor(queued).nla.toState, 'LUAW');
  assert.equal((await advance(efsp, c.TWR, 'TWR', strip(queued))).state, 'LUAW');
  assert.equal(mustAct(efsp, c.TWR, 'TWR', strip(lined), { kind: 'InvokeNla' }).state, 'DEPARTED');
  assert.equal(mustAct(efsp, c.TWR, 'TWR', strip(inbound), { kind: 'InvokeNla' }).state, 'FINAL');
});

test('sortie 3: a departure taxiing for the suspended runway is stopped at the hold-short, by button and by drag', () => {
  const taxiing = departure('TAXI', { runway: '05' });
  suspendForBarrierChange();
  const press = act(efsp, c.GND, 'GND', strip(taxiing), { kind: 'InvokeNla' });
  assert.equal(press.reason, 'NLA_INHIBITED');
  assert.equal(press.detail, 'runway 05/23 suspended — barrier change');
  // §3.5 rule 4: the drag is the other path to the same transition — onto
  // either end's rack, since both ends are the one suspended pavement.
  for (const rackId of ['rwy-05', 'rwy-23']) {
    const drag = act(efsp, c.GND, 'GND', strip(taxiing), { kind: 'TransferStrip', toPositionId: 'TWR', bayId: 'twr-runway-queue', rackId });
    assert.equal(drag.reason, 'NLA_INHIBITED', rackId);
    assert.equal(drag.detail, 'runway 05/23 suspended — barrier change');
  }
  assert.equal(strip(taxiing).state, 'TAXI');
  assert.equal(strip(taxiing).bayId, 'gnd-taxi-out');
  finishAndInspect();
});

test('sortie 4: moving a queued departure to the reciprocal rack does not escape a surface-wide suspension', () => {
  const queued = departure('RUNWAY_QUEUE', { rackId: 'rwy-05' });
  suspendForBarrierChange();
  // A same-state move inside the queue stays allowed — it is how a controller
  // re-sequences, and at a two-runway field how they send a Strip to the open
  // one — but 23 is the same pavement as 05, so the Strip is still held.
  const moved = mustAct(efsp, c.TWR, 'TWR', strip(queued), { kind: 'MoveStrip', bayId: 'twr-runway-queue', rackId: 'rwy-23' });
  assert.equal(moved.rackId, 'rwy-23');
  assert.equal(efsp.boardStore.nlaStatusFor(strip(queued)).inhibited, 'runway 05/23 suspended — barrier change');
  assert.equal(act(efsp, c.TWR, 'TWR', strip(queued), { kind: 'InvokeNla' }).reason, 'NLA_INHIBITED');
  finishAndInspect();
});

test('sortie 5: an aircraft on final when the barrier change begins still lands', async () => {
  const onFinal = arrival('FINAL', { rwy: '05' });
  const handed = arrival('HANDED_TO_TOWER', { rwy: '05' });
  suspendForBarrierChange();
  // Touchdown is an observation, never a clearance: FINAL -> LANDED works.
  assert.equal(mustAct(efsp, c.TWR, 'TWR', strip(onFinal), { kind: 'InvokeNla' }).state, 'LANDED');
  // And the raw override honours the inhibit too (decisions.md S-R2-14):
  // SetState cannot clear a Strip onto final for the suspended runway…
  const jump = act(efsp, c.TWR, 'TWR', strip(handed), { kind: 'SetState', toState: 'FINAL' });
  assert.equal(jump.reason, 'NLA_INHIBITED');
  assert.equal(jump.detail, 'runway 05/23 suspended — barrier change');
  // …but it can record a landing, which is not a runway clearance.
  assert.equal(mustAct(efsp, c.TWR, 'TWR', strip(handed), { kind: 'SetState', toState: 'LANDED' }).state, 'LANDED');
  finishAndInspect();
});

test('sortie 9: OPS at INCIRLIK is refused when not Primary at INCIRLIK; a CTR controller naming OPS is refused', () => {
  const asCtr = fieldStateAct(efsp, c.CTR, 'OPS', { kind: 'RequestRunwayStatus', runwayId: RWY, action: 'CLOSE' });
  assert.equal(asCtr.reason, 'NOT_HOLDING_POSITION');
  const asCtrItself = fieldStateAct(efsp, c.CTR, 'CTR', { kind: 'RequestRunwayStatus', runwayId: RWY, action: 'CLOSE' });
  assert.equal(asCtrItself.reason, 'NOT_HOLDING_POSITION');
  // OPS gives the Position up; the same controller is refused a moment later.
  hold(efsp, c.OPS.session, 'INCIRLIK', []);
  const gone = fieldStateAct(efsp, c.OPS, 'OPS', { kind: 'RequestRunwayStatus', runwayId: RWY, action: 'CLOSE' });
  assert.equal(gone.reason, 'NOT_HOLDING_POSITION');
  hold(efsp, c.OPS.session, 'INCIRLIK', ['OPS']);
  assert.equal(runway().pendingRequest, null);
});

test('sortie 10: two controllers reconfigure at once — the second is STALE_REV, audited, and carries the current record', () => {
  const rev = fieldState().rev;
  mustFieldStateAct(efsp, c.OPS, 'OPS', { kind: 'RequestRunwayStatus', runwayId: RWY, action: 'CLOSE', note: 'FOD' });
  // APP had the same idea, working from the rev before OPS's.
  const late = fieldStateAct(efsp, c.APP, 'APP', { kind: 'RequestRunwayStatus', runwayId: RWY, action: 'BARRIER_CHANGE' }, { baseRev: rev });
  assert.equal(late.reason, 'STALE_REV');
  assert.equal(late.fieldState.runways[0].pendingRequest.requestedPositionId, 'OPS');
  const entry = mutations().at(-1);
  assert.deepEqual([entry.op, entry.reason, entry.actingPositionId, entry.fieldStateFacilityId], ['RequestRunwayStatus', 'STALE_REV', 'APP', 'INCIRLIK']);
  mustFieldStateAct(efsp, c.TWR, 'TWR', { kind: 'RejectRunwayRequest', runwayId: RWY });
});

test('sortie 11: crc-sync restarts mid-suspension and the runway comes back SUSPENDED', async () => {
  const queued = departure('RUNWAY_QUEUE');
  suspendForBarrierChange();
  efsp.persist();
  const reborn = createEfsp();
  const rwy = runway(reborn);
  assert.equal(rwy.status, 'SUSPENDED_BARRIER_CHANGE');
  assert.equal(rwy.suspension.positionId, 'TWR');
  assert.equal(rwy.suspension.requestedBy.positionId, 'OPS');
  assert.equal(fieldState(reborn).activeRunway, '05');
  // The same mission reconnecting does not re-derive the active runway.
  assert.equal(reborn.fieldStateStore.setActiveRunwayFromWind('INCIRLIK', { windFromTrue: 240, missionSession: 1 }).changed, false);
  // Occupancy is ephemeral (ADR 0029): the crew re-declares.
  const rc = crew(reborn, ATC);
  const restored = reborn.boardStore.getStrip(queued.stripId);
  assert.equal(reborn.boardStore.nlaStatusFor(restored).inhibited, 'runway 05/23 suspended — barrier change');
  assert.equal(act(reborn, rc.TWR, 'TWR', restored, { kind: 'InvokeNla' }).reason, 'NLA_INHIBITED');
  finishAndInspect(reborn, rc);
  assert.equal(runway(reborn).status, 'OPEN');
  assert.equal(mustAct(reborn, rc.TWR, 'TWR', reborn.boardStore.getStrip(queued.stripId), { kind: 'InvokeNla' }).state, 'LUAW');
  // Carry on with the reborn server from here, like a real restart.
  reborn.persist();
  efsp = reborn;
  c = rc;
  await sleep(NLA_DOUBLE_TAP_MS + 10);
});

test('sortie 14: a closed runway holds its traffic too, and a Strip with nothing filed is judged against the active runway', () => {
  const unfiled = departure('RUNWAY_QUEUE', { runway: null, rackId: 'rwy-05' });
  // Moved out of the queue to a Bay with no runway, it resolves by the
  // active runway (decisions.md S-Q25).
  mustFieldStateAct(efsp, c.OPS, 'OPS', { kind: 'RequestRunwayStatus', runwayId: RWY, action: 'CLOSE', note: 'disabled aircraft' });
  mustFieldStateAct(efsp, c.TWR, 'TWR', { kind: 'AcceptRunwayRequest', runwayId: RWY });
  assert.equal(runway().status, 'CLOSED');
  assert.equal(runway().closure.reason, 'disabled aircraft');
  assert.equal(efsp.boardStore.nlaStatusFor(strip(unfiled)).inhibited, 'runway 05/23 closed');
  const taxi = departure('TAXI', { runway: null });
  assert.equal(act(efsp, c.GND, 'GND', strip(taxi), { kind: 'InvokeNla' }).detail, 'runway 05/23 closed');
  mustFieldStateAct(efsp, c.TWR, 'TWR', { kind: 'OpenRunway', runwayId: RWY });
  assert.equal(efsp.boardStore.nlaStatusFor(strip(taxi)).toState, 'RUNWAY_QUEUE');
});

// ── rule 3: the runway change ──────────────────────────────────────────────

const runwayChange = (e = efsp) => fieldState(e).runwayChange;

/** Walks a change through to the end, inspection included — used to put the field back. */
function completeChange(e = efsp, crewOf = c) {
  mustFieldStateAct(e, crewOf.TWR, 'TWR', { kind: 'BeginRunwayChange' });
  mustFieldStateAct(e, crewOf.TWR, 'TWR', { kind: 'CompleteRunwayChange' });
  mustFieldStateAct(e, crewOf.OPS, 'OPS', { kind: 'CompleteInspection', runwayId: RWY });
  assert.equal(runwayChange(e), null);
}

test('sortie 2: A runway change cannot be initiated without `OPS` and `APP` acknowledgement.', () => {
  assert.equal(fieldState().activeRunway, '05');
  const walk = (to, order) => {
    mustFieldStateAct(efsp, c.TWR, 'TWR', { kind: 'ProposeRunwayChange', toRunwayId: to, note: 'wind veered' });
    // Neither has acknowledged: tower cannot begin.
    let begin = fieldStateAct(efsp, c.TWR, 'TWR', { kind: 'BeginRunwayChange' });
    assert.equal(begin.ok, false);
    assert.equal(begin.fieldState.runwayChange.state, 'PROPOSED');
    // Tower cannot acknowledge its own change on anyone's behalf.
    assert.equal(fieldStateAct(efsp, c.TWR, 'TWR', { kind: 'AckRunwayChange' }).reason, 'PERMISSION_DENIED');
    // One of the two: still not.
    mustFieldStateAct(efsp, c[order[0]], order[0], { kind: 'AckRunwayChange' });
    begin = fieldStateAct(efsp, c.TWR, 'TWR', { kind: 'BeginRunwayChange' });
    assert.equal(begin.ok, false);
    assert.match(begin.detail, /can begin only once acknowledged/);
    // Both: now it can.
    mustFieldStateAct(efsp, c[order[1]], order[1], { kind: 'AckRunwayChange' });
    assert.equal(runwayChange().state, 'ACKNOWLEDGED');
    assert.equal(runwayChange().acks.OPS.positionId, 'OPS');
    assert.equal(runwayChange().acks.APP.positionId, 'APP');
    completeChange();
    assert.equal(fieldState().activeRunway, to);
  };
  walk('23', ['APP', 'OPS']);
  walk('05', ['OPS', 'APP']); // the mirror order, and back where we started
  // Every refused BeginRunwayChange is in the Mutation log.
  const refused = mutations().filter(m => m.op === 'BeginRunwayChange' && !m.ok);
  assert.ok(refused.length >= 4);
  assert.ok(refused.every(m => m.fieldStateFacilityId === 'INCIRLIK' && m.actingPositionId === 'TWR'));
});

test('sortie 6: a runway change completes, the new runway is inspected, and only then released', async () => {
  // A departure already queued for 05 before the change, and one taxiing with
  // nothing filed.
  const queuedFor05 = departure('RUNWAY_QUEUE', { runway: '05', rackId: 'rwy-05' });
  const taxiing = departure('TAXI', { runway: null });
  mustFieldStateAct(efsp, c.TWR, 'TWR', { kind: 'ProposeRunwayChange', toRunwayId: '23' });
  mustFieldStateAct(efsp, c.OPS, 'OPS', { kind: 'AckRunwayChange' });
  mustFieldStateAct(efsp, c.APP, 'APP', { kind: 'AckRunwayChange' });
  mustFieldStateAct(efsp, c.TWR, 'TWR', { kind: 'BeginRunwayChange' });
  // In progress: nothing is suspended yet (decisions.md Q29).
  assert.equal(runway().status, 'OPEN');
  assert.equal(fieldState().runwayChangeInProgress, true);
  const done = mustFieldStateAct(efsp, c.TWR, 'TWR', { kind: 'CompleteRunwayChange' });
  assert.equal(done.activeRunway, '23');
  assert.equal(done.runwayChange.state, 'PENDING_INSPECTION');
  // The pavement waits for its inspection, and holds its traffic meanwhile.
  assert.equal(runway().status, 'SUSPENDED_INSPECTION');
  assert.equal(efsp.boardStore.nlaStatusFor(strip(queuedFor05)).inhibited, 'runway 05/23 suspended — awaiting inspection');
  assert.equal(act(efsp, c.GND, 'GND', strip(taxiing), { kind: 'InvokeNla' }).detail, 'runway 05/23 suspended — awaiting inspection');
  // Only OPS may sign it off.
  assert.equal(fieldStateAct(efsp, c.TWR, 'TWR', { kind: 'CompleteInspection', runwayId: RWY }).reason, 'PERMISSION_DENIED');
  const inspected = mustFieldStateAct(efsp, c.OPS, 'OPS', { kind: 'CompleteInspection', runwayId: RWY });
  assert.equal(inspected.runwayChange, null);
  assert.equal(inspected.runwayChangeInProgress, false);
  assert.equal(inspected.activeRunway, '23');
  assert.equal(inspected.transitions.at(-1).runwayChangeCompleted.toRunwayId, '23');
  // Released: the departure with nothing filed is queued for the ACTIVE end,
  // not the Bay's first rack (decisions.md Q26).
  const queued = await advance(efsp, c.GND, 'GND', strip(taxiing));
  assert.equal(queued.state, 'RUNWAY_QUEUE');
  assert.equal(queued.rackId, 'rwy-23');
  // Put the field back to 05 for the sorties after this one.
  mustFieldStateAct(efsp, c.TWR, 'TWR', { kind: 'ProposeRunwayChange', toRunwayId: '05' });
  mustFieldStateAct(efsp, c.OPS, 'OPS', { kind: 'AckRunwayChange' });
  mustFieldStateAct(efsp, c.APP, 'APP', { kind: 'AckRunwayChange' });
  completeChange();
});

test("sortie 7: APP rejects the runway change, and tower's next proposal starts clean", () => {
  mustFieldStateAct(efsp, c.TWR, 'TWR', { kind: 'ProposeRunwayChange', toRunwayId: '23' });
  mustFieldStateAct(efsp, c.OPS, 'OPS', { kind: 'AckRunwayChange' });
  const rejected = mustFieldStateAct(efsp, c.APP, 'APP', { kind: 'RejectRunwayChange', note: 'recovery of four inbound on 05' });
  assert.deepEqual([rejected.runwayChange.state, rejected.runwayChange.rejected.positionId], ['REJECTED', 'APP']);
  assert.equal(fieldStateAct(efsp, c.TWR, 'TWR', { kind: 'BeginRunwayChange' }).ok, false);
  const oldId = rejected.runwayChange.changeId;
  const again = mustFieldStateAct(efsp, c.TWR, 'TWR', { kind: 'ProposeRunwayChange', toRunwayId: '23' });
  assert.notEqual(again.runwayChange.changeId, oldId);
  assert.deepEqual(again.runwayChange.acks, { OPS: null, APP: null }); // OPS's earlier ack does not carry over
  mustFieldStateAct(efsp, c.TWR, 'TWR', { kind: 'WithdrawRunwayChange' });
});

test('sortie 8: tower withdraws a proposal before it is begun', () => {
  mustFieldStateAct(efsp, c.TWR, 'TWR', { kind: 'ProposeRunwayChange', toRunwayId: '23' });
  mustFieldStateAct(efsp, c.APP, 'APP', { kind: 'AckRunwayChange' });
  const withdrawn = mustFieldStateAct(efsp, c.TWR, 'TWR', { kind: 'WithdrawRunwayChange', note: 'wind backed' });
  assert.deepEqual([withdrawn.runwayChange.state, withdrawn.runwayChange.rejected.cause, withdrawn.runwayChange.rejected.note], ['REJECTED', 'WITHDRAWN', 'wind backed']);
  assert.equal(withdrawn.activeRunway, '05');
  assert.equal(runway().status, 'OPEN');
});

test('sortie 12: a restart mid runway-change keeps the acknowledgements already given', () => {
  mustFieldStateAct(efsp, c.TWR, 'TWR', { kind: 'ProposeRunwayChange', toRunwayId: '23' });
  mustFieldStateAct(efsp, c.APP, 'APP', { kind: 'AckRunwayChange' });
  efsp.persist();
  const reborn = createEfsp();
  const rc = crew(reborn, ATC);
  const ch = runwayChange(reborn);
  assert.equal(ch.state, 'PROPOSED');
  assert.equal(ch.acks.APP.by, c.APP.session.controllerId);
  assert.equal(ch.acks.OPS, null);
  assert.equal(fieldStateAct(reborn, rc.TWR, 'TWR', { kind: 'BeginRunwayChange' }).ok, false);
  mustFieldStateAct(reborn, rc.OPS, 'OPS', { kind: 'AckRunwayChange' });
  assert.equal(runwayChange(reborn).state, 'ACKNOWLEDGED');
  mustFieldStateAct(reborn, rc.TWR, 'TWR', { kind: 'WithdrawRunwayChange' });
  reborn.persist();
  efsp = reborn;
  c = rc;
});

test('sortie 13: the D21 twin — an ack sent as TWR never counts as APP’s, and one person holding every Position self-coordinates in one input', () => {
  // One controller takes TWR and APP (the others give them up first, or the
  // newcomer would only be an Observer, §4.8.2).
  hold(efsp, c.TWR.session, 'INCIRLIK', []);
  hold(efsp, c.APP.session, 'INCIRLIK', []);
  const dual = { session: { controllerId: 'c-dual', who: 'dual' }, facilityId: 'INCIRLIK' };
  hold(efsp, dual.session, 'INCIRLIK', ['TWR', 'APP']);

  mustFieldStateAct(efsp, dual, 'TWR', { kind: 'ProposeRunwayChange', toRunwayId: '23' });
  // Acting TWR, the acknowledgement is refused — never counted as APP's.
  assert.equal(fieldStateAct(efsp, dual, 'TWR', { kind: 'AckRunwayChange' }).reason, 'PERMISSION_DENIED');
  // Acting APP it counts, recorded as self-coordinated (§4.8.3).
  mustFieldStateAct(efsp, dual, 'APP', { kind: 'AckRunwayChange' });
  assert.equal(runwayChange().acks.APP.selfCoordinated, true);
  // OPS is somebody else, and has not answered: tower still cannot begin.
  assert.equal(fieldStateAct(efsp, dual, 'TWR', { kind: 'BeginRunwayChange' }).ok, false);
  // Nor can the dual controller skip OPS with the one-input form.
  mustFieldStateAct(efsp, dual, 'TWR', { kind: 'WithdrawRunwayChange' });
  const notOps = fieldStateAct(efsp, dual, 'TWR', { kind: 'SelfCoordinateRunwayChange', toRunwayId: '23' });
  assert.equal(notOps.reason, 'PERMISSION_DENIED');
  assert.match(notOps.detail, /Primary at OPS/);
  mustFieldStateAct(efsp, dual, 'TWR', { kind: 'ProposeRunwayChange', toRunwayId: '23' });
  mustFieldStateAct(efsp, dual, 'APP', { kind: 'AckRunwayChange' });
  mustFieldStateAct(efsp, c.OPS, 'OPS', { kind: 'AckRunwayChange' });
  assert.equal(fieldStateAct(efsp, dual, 'TWR', { kind: 'BeginRunwayChange' }).ok, true);
  mustFieldStateAct(efsp, dual, 'TWR', { kind: 'CompleteRunwayChange' });
  mustFieldStateAct(efsp, c.OPS, 'OPS', { kind: 'CompleteInspection', runwayId: RWY });
  assert.equal(fieldState().activeRunway, '23');

  // Low manning (H12): one person holds OPS, TWR and APP. One input takes the
  // change straight to ACKNOWLEDGED, naming each Position.
  hold(efsp, c.OPS.session, 'INCIRLIK', []);
  hold(efsp, dual.session, 'INCIRLIK', ['OPS', 'TWR', 'APP']);
  const solo = mustFieldStateAct(efsp, dual, 'TWR', { kind: 'SelfCoordinateRunwayChange', toRunwayId: '05', note: 'back to 05' });
  assert.equal(solo.runwayChange.state, 'ACKNOWLEDGED');
  assert.deepEqual(Object.values(solo.runwayChange.acks).map(a => [a.positionId, a.selfCoordinated]), [['OPS', true], ['APP', true]]);
  const entry = mutations().at(-1);
  assert.deepEqual([entry.op, entry.ok, entry.actingPositionId], ['SelfCoordinateRunwayChange', true, 'TWR']);
  mustFieldStateAct(efsp, dual, 'TWR', { kind: 'BeginRunwayChange' });
  mustFieldStateAct(efsp, dual, 'TWR', { kind: 'CompleteRunwayChange' });
  mustFieldStateAct(efsp, dual, 'OPS', { kind: 'CompleteInspection', runwayId: RWY });
  assert.equal(fieldState().activeRunway, '05');

  // Everyone back to their own Position.
  hold(efsp, dual.session, 'INCIRLIK', []);
  c = { ...c, ...crew(efsp, { OPS: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK' }) };
  assert.equal(runwayChange(), null);
  assert.equal(runway().status, 'OPEN');
});
