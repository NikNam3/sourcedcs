'use strict';
import { isSyncOpen, sendToSync } from '../../sync.js';
import {
  efspEpochChangeOf, efspFrameGapsOf, getEfspFacility, getPendingMutations, rebaseForResend, registerPendingMutation
} from './efsp-state.js';
import { ageResyncs, beginResync, boardCursorName, endResync, endResyncs, heartbeatGaps, resyncPositionOf } from './sync-cursor.js';
import { addEfspMessageObserver } from './efsp-message-registry.js';
import { allFacilityIds, DEFAULT_FACILITY_ID } from './facility-topology.js';

// Client-side EFSP WebSocket helpers — constructs efsp-mutation/efsp-
// set-positions/efsp-resync messages, sends them via sync.js's existing
// sendToSync(), and registers Mutations as pending (efsp-state.js) until
// their ack arrives. Thin network glue with no dedicated test file, same
// as sync.js itself (which also has none) — the logic worth testing in
// isolation (message merging, rebase) already lives in efsp-state.js.

// WP4A (docs/adr/0013): keyed by facilityId — each Facility's signed-on-Position
// set is independent server-side (a separate PositionStore instance per
// Facility), so the client tracks them the same way. Position IDs are
// globally unique across Facilities in this slice (OPS/CD/GC/LC/AP vs
// CTR never collide), which is what lets getActingPositions() below still
// return one flat, facility-agnostic list for every pre-WP4A call site.
let _actingPositionsByFacility = Object.fromEntries(allFacilityIds().map(f => [f, []]));
let _ackedByFacility = {};     // facilityId -> the last `signedOn` the SERVER acknowledged (e2e waits on this, not on the claim)
let _declaredByFacility = {};   // facilityId -> positionIds the controller asked for
let _observerKeys = new Set(); // 'facility/position' where the controller is Observer (coverage message)
let _primaryKeys = new Set();   // ... and where Primary
let _redeclare = null;          // { expectPrimary, acksPending } while a reconnect's re-declaration is in flight

function efspClientMutationId() {
  // crypto.randomUUID() is available in Electron's Chromium renderer (and
  // any modern browser) with no polyfill — same API crc-sync uses server-side.
  return crypto.randomUUID();
}

// sendToSync() (sync.js) silently drops a message if the WebSocket isn't
// OPEN at the moment of the call — correct for its existing callers, but
// an EFSP action that gets silently dropped is indistinguishable from a
// broken button. Warn loudly here instead, since this is the one place
// every EFSP send passes through.
export function _sendEfsp(msg) {
  if (!isSyncOpen()) {
    console.warn('[efsp] WebSocket not open — message NOT sent (silently dropped by sendToSync):', msg);
    return false;
  }
  sendToSync(msg);
  return true;
}

// The one ack path (DESK-ACKS). Every EFSP request that wants its answer goes through sendEfsp(msg, { onAck }): the
// continuation is kept by clientMutationId and run by settleEfspAck() when the family's ack handler sees the ack
// (efsp-messages.js, airspace-panel.js, ato-import.js). Replaces the per-feature trackers (the Undo slot's, CreateStrip's,
// the ATO dialog's, the airspace views') that each matched an ack by hand.
//
// `onAck(ack, result)` returns true when it has shown the outcome itself, so the caller skips its default surface (the red
// refusal banner). `result` is efsp-state's applyEfspMutationAck() result for a Strip Mutation ack, undefined otherwise.
// `pending: true` also registers the Mutation for replay after a reconnect (efsp-state.js): only a Strip Mutation or a
// CreateStrip may be replayed; anything else is cheap to reissue by hand.
const _acks = new Map(); // clientMutationId -> { onAck, replayable }

export function sendEfsp(msg, { pending = false, onAck } = {}) {
  const id = msg.clientMutationId;
  if (pending) registerPendingMutation(msg);
  if (onAck) _acks.set(id, { onAck, replayable: pending });
  if (_sendEfsp(msg) === false && onAck && !pending) {
    // Nothing went out, so no ack will ever come: answer the continuation now, but after the caller has stored the id.
    queueMicrotask(() => settleEfspAck({ clientMutationId: id, ok: false, reason: 'NOT_CONNECTED', detail: 'not connected to crc-sync' }));
  }
  return id;
}

/** The family's ack handler calls this. True when the request's own continuation handled the outcome (skip the default surface). */
export function settleEfspAck(ack, result) {
  const entry = _acks.get(ack.clientMutationId);
  if (!entry) return false;
  _acks.delete(ack.clientMutationId);
  return entry.onAck(ack, result) === true;
}

/**
 * A (re)connect: a request that was in flight on the dead socket will never be answered. Each non-replayable continuation
 * hears `CONNECTION_LOST`, so a form or slot never waits forever; a replayable Mutation keeps its continuation and is
 * re-sent after the snapshot (replayPendingEfspMutations), with the same id.
 */
export function orphanEfspAcks() {
  for (const [id, entry] of [..._acks]) {
    if (entry.replayable) continue;
    settleEfspAck({ clientMutationId: id, ok: false, reason: 'CONNECTION_LOST', detail: 'the connection to crc-sync dropped before the answer came' });
  }
}

export function _resetEfspAcksForTest() { _acks.clear(); }

/**
 * Sends a Mutation targeting an existing Strip. Caller MUST only pass a
 * currently signed-on Position — efsp-panel.js only offers actions for
 * Positions actually signed on. facilityId is read directly off the Strip
 * (every Strip record arriving from crc-sync since WP4A carries one,
 * efsp-ws.js server-side stamps it on every snapshot/delta/ack) rather
 * than threaded through every call site — bay-view.js's dispatch helpers
 * (NLA/move/transfer/gesture/coordination) all just pass their Strip
 * through unchanged.
 */
export function sendEfspMutation(actingPositionId, strip, op, { onAck } = {}) {
  const msg = {
    version: 1, type: 'efsp-mutation',
    clientMutationId: efspClientMutationId(),
    facilityId: strip.facilityId || undefined, // omitted entirely for a pre-WP4A Strip record with no facilityId — server defaults to INCIRLIK
    actingPositionId,
    stripId: strip.stripId,
    baseRev: strip.rev,
    op,
  };
  return sendEfsp(msg, { pending: true, onAck });
}

/**
 * Undoes the action in the undo slot (docs/adr/0100 §7): `{kind:'Undo', actionId}`. `stripId` is the Strip the
 * original action addressed (it routes the message to the Board); baseRev is not checked for an Undo. Not
 * registered as pending: the replay-on-reconnect machinery would rebase it, and a stale Undo must not be re-sent
 * by guesswork (undo-slot.js tracks its own ack).
 */
export function sendEfspUndo(actingPositionId, slot, { onAck } = {}) {
  const msg = {
    version: 1, type: 'efsp-mutation',
    clientMutationId: efspClientMutationId(),
    facilityId: slot.facilityId || undefined,
    actingPositionId,
    stripId: slot.stripId,
    op: { kind: 'Undo', actionId: slot.actionId },
  };
  return sendEfsp(msg, { onAck });
}

/** CreateStrip has no existing Strip to derive facilityId from — an explicit param, defaulting to INCIRLIK for back-compat with every pre-WP4A call site (efsp-panel.js's OPS-only DEPARTURE form). */
export function sendEfspCreateStrip(actingPositionId, createOp, facilityId = DEFAULT_FACILITY_ID, { onAck } = {}) {
  const msg = {
    version: 1, type: 'efsp-mutation',
    clientMutationId: efspClientMutationId(),
    facilityId,
    actingPositionId,
    op: createOp,
  };
  return sendEfsp(msg, { pending: true, onAck });
}

/**
 * Sets the FULL signed-on-Position set for ONE Facility — mirrors position-store.js's own "declare your full set each call" contract, per Facility (docs/adr/0013: each Facility has its own PositionStore instance server-side).
 * `_declared` is what the controller asked for and is re-sent on every connect; `_actingPositionsByFacility` is what
 * the server said (the ack's `signedOn`), set optimistically here until the ack lands.
 */
export function sendEfspSetPositions(facilityId, signedOn) {
  _notice(''); // a new declaration answers the reconnect notice
  _declaredByFacility[facilityId] = [...signedOn];
  _actingPositionsByFacility[facilityId] = [...signedOn];
  _sendEfsp({ version: 1, type: 'efsp-set-positions', facilityId, signedOn });
}

/** Every Position the server has this controller signed on at (Primary or Observer): what the Acting-As checkboxes show and what a new declaration extends. */
export function getSignedOnPositions(facilityId) {
  if (facilityId) return [...(_actingPositionsByFacility[facilityId] || [])];
  return Object.values(_actingPositionsByFacility).flat();
}

/**
 * The Positions this controller may ACT at: signed on and Primary. An Observer watches (crc-sync's docs/adr/0105 / the
 * GCLC finding), so it is offered no action and shows no COMBINED line. A Position the coverage message has not named
 * yet counts as Primary (sign-on just landed), and the coverage message that follows corrects it.
 *
 * @param {string} [facilityId] — omit to get the flattened union across
 *   EVERY Facility (every pre-WP4A call site in bay-view.js/efsp-panel.js
 *   does this — Position IDs are globally unique across Facilities this
 *   slice, so a flat list is exactly as correct as a facility-scoped one
 *   for "is this controller signed on at Position X").
 */
export function getActingPositions(facilityId) {
  const facilities = facilityId ? [facilityId] : Object.keys(_actingPositionsByFacility);
  return facilities.flatMap(f => (_actingPositionsByFacility[f] || []).filter(p => !_observerKeys.has(`${f}/${p}`)));
}

/** What the server last acknowledged as signed on at this Facility (not the optimistic claim). */
export function getAckedPositions(facilityId) { return [...(_ackedByFacility[facilityId] || [])]; }

/** Is the controller an Observer (not Primary) at this Position? */
export function isObserverAt(facilityId, positionId) { return _observerKeys.has(`${facilityId}/${positionId}`); }

let _noticeListener = null;
/** combination.js registers the one visible line a sign-on notice is shown on. */
export function setSignOnNoticeListener(fn) { _noticeListener = fn; }
function _notice(text) { if (_noticeListener) _noticeListener(text); }

/**
 * A (re)connect: the server signs a closed session off after its grace, so declare again what the controller had.
 * The ack is the truth (noteEfspPositionsAck) and the coverage that follows says Primary or Observer.
 */
export function redeclareEfspPositions() {
  orphanEfspAcks();
  const facilities = Object.keys(_declaredByFacility).filter(f => _declaredByFacility[f].length > 0);
  _redeclare = facilities.length ? { expectPrimary: new Set(_primaryKeys), acksPending: new Set(facilities) } : null;
  for (const f of facilities) _sendEfsp({ version: 1, type: 'efsp-set-positions', facilityId: f, signedOn: _declaredByFacility[f] });
}

/** The server's `efsp-positions-ack`: adopt `signedOn` as the truth. */
export function noteEfspPositionsAck(msg) {
  const f = msg.facilityId;
  if (!f || !Array.isArray(msg.signedOn)) return;
  const asked = _declaredByFacility[f] || [];
  _ackedByFacility[f] = [...msg.signedOn];
  _actingPositionsByFacility[f] = [...msg.signedOn];
  _declaredByFacility[f] = [...msg.signedOn];
  if (_redeclare) {
    _redeclare.acksPending.delete(f);
    const dropped = asked.filter(p => !msg.signedOn.includes(p));
    if (dropped.length) _notice(`Reconnected: ${dropped.join(', ')} could not be signed on again`);
  }
}

/**
 * A `coverage` message's `signedOnPositions` (app.js): who is Primary where. After a reconnect's re-declaration, a
 * Position this controller was Primary at that someone else took meanwhile is unticked here, with one line saying so.
 */
export function noteCoveragePositions(list) {
  _observerKeys = new Set(list.filter(p => p.isPrimary === false).map(p => `${p.facilityId}/${p.positionId}`));
  _primaryKeys = new Set(list.filter(p => p.isPrimary).map(p => `${p.facilityId}/${p.positionId}`));
  if (!_redeclare || _redeclare.acksPending.size > 0) return;
  const { expectPrimary } = _redeclare;
  _redeclare = null;
  const lost = [...expectPrimary].filter(k => _observerKeys.has(k));
  if (!lost.length) return;
  const byFacility = {};
  for (const k of lost) { const [f, p] = k.split('/'); (byFacility[f] = byFacility[f] || []).push(p); }
  for (const [f, ids] of Object.entries(byFacility)) sendEfspSetPositions(f, getSignedOnPositions(f).filter(p => !ids.includes(p)));
  _notice(`Reconnected: ${lost.map(k => k.split('/')[1]).join(', ')} taken by someone else meanwhile, signed off`);
}

/**
 * An airspace op (schedule/request/approve/release/return) — its own message
 * type, because it targets an airspace rather than a Strip and so carries no
 * stripId, no Strip baseRev and no Facility routing. Not registered as a
 * pending mutation: the replay-on-reconnect machinery (§5.6.3) is keyed on
 * Strip identity, and an airspace op is cheap to simply reissue by hand.
 */
export function sendEfspAirspaceMutation(actingPositionId, airspaceId, baseRev, op, extra = {}, { onAck } = {}) {
  const clientMutationId = efspClientMutationId();
  // `extra` carries `baseDefRev` for the definition ops (docs/adr/0098 §4): the revision the form was opened on, which
  // the server checks field by field. Returns the id so the caller can match the ack to the form that sent it.
  return sendEfsp({
    version: 1, type: 'efsp-airspace-mutation',
    clientMutationId,
    airspaceId, baseRev, actingPositionId, op, ...extra,
  }, { onAck });
}

/**
 * Binding or unbinding a surveillance contact (WP5, crc-sync's
 * docs/adr/0045) — guide §6.6 rule 1's top rung, "explicit controller
 * binding". Its own message type because it targets an FLIGHT_DATA: no stripId, no
 * Strip baseRev, no Facility routing.
 *
 * The way out of every ambiguity the server's sweep reports, and the only way
 * to correlate an aircraft with its transponder off and a callsign nothing
 * matches. Not registered as a pending mutation, for the same reason an
 * airspace op is not: §5.6.3's replay machinery is keyed on Strip identity,
 * and a bind is cheap to reissue.
 */
export function sendEfspCorrelationMutation(actingPositionId, flightDataId, baseRev, op, { onAck } = {}) {
  return sendEfsp({
    version: 1, type: 'efsp-correlation-mutation',
    clientMutationId: efspClientMutationId(),
    flightDataId, baseRev, actingPositionId, op,
  }, { onAck });
}

/**
 * A MARSA op (WP6, §9.2 — crc-sync's docs/adr/0051). Its own message type
 * because it targets a relation BETWEEN flights: no stripId, no Strip baseRev,
 * no Facility routing, and no single flightDataId either, since a relation's
 * participants can be worked by different Facilities at once.
 *
 * `marsaId` is undefined for DeclareMarsa, which mints the relation — the same
 * shape CreateStrip has, which carries no stripId or baseRev either.
 *
 * Not registered as a pending mutation, for the reason the airspace and
 * correlation sends give: §5.6.3's replay machinery is keyed on Strip identity.
 */
export function sendEfspMarsaMutation(actingPositionId, marsaId, baseRev, op, { onAck } = {}) {
  return sendEfsp({
    version: 1, type: 'efsp-marsa-mutation',
    clientMutationId: efspClientMutationId(),
    marsaId, baseRev, actingPositionId, op,
  }, { onAck });
}

/**
 * A runway-status op (guide §9.7, crc-sync docs/adr/0061): a runway's status,
 * a request to tower, a runway change. Its own message type because it
 * targets a Facility's field, not a Strip: `baseRev` is the Facility record's
 * rev. Not registered as a pending mutation, for the reason the airspace,
 * correlation and MARSA sends give: §5.6.3's replay machinery is keyed on
 * Strip identity, and a runway-status op is cheap to reissue by hand.
 */
export function sendEfspRunwayStatusMutation(actingPositionId, facilityId, baseRev, op, { onAck } = {}) {
  return sendEfsp({
    version: 1, type: 'efsp-runway-status-mutation',
    clientMutationId: efspClientMutationId(),
    facilityId, baseRev, actingPositionId, op,
  }, { onAck });
}

/**
 * A frequency table op (crc-sync docs/adr/0131): SetFrequency / ResetFrequency on one Position or SFA frequency of
 * `facilityId`. `actingPositionId` is any Position this controller is Primary at (the server's gate). No baseRev (last
 * write wins, every change audited); not a pending mutation, for the reason the airspace and carrier sends give.
 */
export function sendEfspFrequencyMutation(actingPositionId, facilityId, op, { onAck } = {}) {
  return sendEfsp({
    version: 1, type: 'efsp-frequency-mutation',
    clientMutationId: efspClientMutationId(),
    facilityId, actingPositionId, op,
  }, { onAck });
}

/**
 * A carrier op (crc-sync's docs/adr/0074): the recovery Case, a Marshal stack
 * op or the altimeter. Its own message type because it targets the ship's
 * record, not a Strip: no stripId, no Strip baseRev. `baseRev` may be omitted
 * (the server then does not check it: the ops are small and the record is
 * resent whole on every change). Not registered as a pending mutation, for the
 * reason the airspace and MARSA sends give.
 */
export function sendEfspCarrierMutation(actingPositionId, hullId, baseRev, op, { onAck } = {}) {
  return sendEfsp({
    version: 1, type: 'efsp-carrier-mutation',
    clientMutationId: efspClientMutationId(),
    hullId, baseRev, actingPositionId, op,
  }, { onAck });
}

/**
 * Resync one cursor (guide §5.6, docs/adr/0081, 0106): an `efsp-resync` says where this client is (the seq and the
 * epoch it last read) for one Facility's Board (`board:<facilityId>`) or one store (`store:<key>`). The server
 * answers a Board with an efsp-board-delta when that position is inside its window and its own lifetime, and with an
 * efsp-snapshot otherwise; a store with an `efsp-resync-reply` carrying its slice. Does nothing for a cursor we hold
 * no position for (the connect-time snapshot is the answer there) and holds a second request while one is in flight;
 * a lost answer is retried after RESYNC_RETRY_HEARTBEATS heartbeats (counted in heartbeats, not time: the heartbeat
 * is the one signal this client already trusts to tick).
 */
function requestEfspResync(name, reason) {
  const at = resyncPositionOf(name);
  if (!at || !beginResync(name)) return false;
  _sendEfsp({ version: 1, type: 'efsp-resync', ...at });
  console.warn('[efsp] resync requested for', name, '-', reason);
  return true;
}

/**
 * The one sync trigger, registered as the registry's observer, so it runs before the family's handler on every
 * frame: a delta or ack from another Board or store lifetime (or a store delta that skipped a seq) asks for a resync;
 * a Board delta from our own lifetime, a store reply or a snapshot answers one; each heartbeat ages the requests in
 * flight and asks for a resync when it shows a change we never received.
 */
function noteEfspFrameForSync(msg) {
  for (const name of efspFrameGapsOf(msg)) requestEfspResync(name, 'lifetime changed or a delta was missed');
  if (msg.type === 'efsp-board-delta' && !efspEpochChangeOf(msg)) endResync(boardCursorName(msg.facilityId || getEfspFacility()));
  if (msg.type === 'efsp-resync-reply' && (msg.answer === 'stores' || msg.stores)) endResyncs('store:'); // a store left out was current
  if (msg.type === 'efsp-heartbeat') {
    ageResyncs();
    for (const name of heartbeatGaps(msg)) requestEfspResync(name, 'heartbeat names a seq or lifetime we never received');
  }
}
addEfspMessageObserver(noteEfspFrameForSync);

/**
 * The server's answer to an efsp-resync is an `efsp-resync-reply`: the snapshot or the delta,
 * flat, with `answer: 'snapshot' | 'delta'`. Returns the efsp-snapshot / efsp-board-delta
 * message it stands for (the other fields are untouched), for app.js to apply as any other.
 */
export function efspResyncReplyAsMessage(msg) {
  const { answer, stores, ...rest } = msg; // `stores` is applied by its own handler (efsp-messages.js)
  return { ...rest, type: answer === 'snapshot' ? 'efsp-snapshot' : 'efsp-board-delta' };
}

/**
 * Replays every still-pending Mutation against the fresh post-reconnect
 * baseline (guide §5.6.3) — call once after an efsp-snapshot or
 * efsp-board-delta lands following a resync. A Mutation whose target Strip
 * no longer exists locally (rebaseForResend returns null) is surfaced via
 * onOrphaned rather than silently dropped — "the worst failure mode in
 * the system."
 */
export function replayPendingEfspMutations(onOrphaned) {
  for (const original of getPendingMutations()) {
    const rebased = rebaseForResend(original.clientMutationId);
    if (!rebased) {
      if (typeof onOrphaned === 'function') onOrphaned(original);
      continue;
    }
    _sendEfsp(rebased);
  }
}

// ESM-1: replaces one of the senders for every importer (live binding). The classic page let a caller assign the
// global `sendEfsp…`; the e2e specs use this setter (e2e/helpers/modules.js), and unit tests may too.
export function setEfspSender(name, fn) {
  switch (name) {
    case 'sendEfspMutation': sendEfspMutation = fn; break;
    case 'sendEfspUndo': sendEfspUndo = fn; break;
    case 'sendEfspCreateStrip': sendEfspCreateStrip = fn; break;
    case 'sendEfspSetPositions': sendEfspSetPositions = fn; break;
    case 'sendEfspAirspaceMutation': sendEfspAirspaceMutation = fn; break;
    case 'sendEfspCorrelationMutation': sendEfspCorrelationMutation = fn; break;
    case 'sendEfspMarsaMutation': sendEfspMarsaMutation = fn; break;
    case 'sendEfspRunwayStatusMutation': sendEfspRunwayStatusMutation = fn; break;
    case 'sendEfspCarrierMutation': sendEfspCarrierMutation = fn; break;
    case '_sendEfsp': _sendEfsp = fn; break;
    default: throw new TypeError(`setEfspSender: ${name} is not a replaceable sender`);
  }
}
