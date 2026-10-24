'use strict';

// EFSP WebSocket message handling — the boundary between ws-hub.js's
// session/broadcast machinery and the EFSP stores. Kept as its own file
// rather than inlined into ws-hub.js's existing message switch (the way
// aptConfigSet is) because the EFSP
// surface area — three message types, each with a distinct ack/broadcast
// shape, one of which (mutation) now covers fourteen op kinds — is bigger
// than those single-shot squadron-config messages.
//
// handleMessage() returns { ack, broadcasts } for ws-hub.js to send: `ack`
// always goes to the sender only; `broadcasts`, an ordered array of frames (wire/skeleton.js SLOT_ORDER), goes to every
// connected client (the sender included) — the EFSP Board's guide-mandated
// <200ms remote-change budget (§7.9) needs an immediate broadcast, not the
// existing 500ms tick tracks/collab-store use
// (docs/adr/0004-immediate-board-broadcast.md).
//
// Every message carries an OPTIONAL `facilityId` (docs/adr/0013), defaulting
// to facilityConfig.DEFAULT_FACILITY_ID ('INCIRLIK') when omitted, routed via
// ctx.boardStoreFor(facilityId)/positionStoreFor(...). A message with no
// facilityId behaves as an INCIRLIK one — a deliberate choice over a required
// field, matching facility-config.js's own optional-trailing-param pattern
// (docs/adr/0013's own back-compat discussion). A client
// acting across both Facilities sends two independent messages (one per
// facilityId) rather than one combined one — Boards remain two.

// The only module this file requires. Every other rule reaches it through
// `ctx`, injected by index.js — but a correlation op targets no Strip and no
// Board, so there is no `rules` object on the path it takes, and threading one
// through purely for a class check would be more indirection than it removes.
const permission = require('./permission');
const readScope = require('./read-scope');
const frames = require('./wire/frames');
const { VERSION, stampStrip, mergeFlightDataList, touchedStrips, boardDelta, marsaDelta, carrierDelta, liveStamped } = frames;
const skeleton = require('./wire/skeleton');
const { warn } = require('./warnings');
const families = require('./wire/families');

// The resync window and the delta-or-snapshot decision live with the ring (sync/sync-log.js).
const { canServeDelta, RESYNC_RING_WINDOW } = require('./sync/sync-log');
const { STORE_SYNC } = require('./stores');

function handleMessage(ctx, session, msg, persist) {
  const family = families.byType[msg.type];
  if (family) return skeleton.run(family, ctx, session, msg, persist);
  switch (msg.type) {
    case 'efsp-mutation':      return _handleMutation(ctx, session, msg, persist);
    case 'efsp-resync':        return _handleResync(ctx, session, msg);
    case 'efsp-set-positions': return _handleSetPositions(ctx, session, msg, persist);
    default:                   return null; // not an EFSP message
  }
}

function _handleMutation(ctx, session, msg, persist) {
  const facilityId = msg.facilityId || ctx.facilityConfig.DEFAULT_FACILITY_ID;
  const boardStore = ctx.boardStoreFor(facilityId);
  if (!boardStore) {
    return { ack: { version: VERSION, type: 'efsp-mutation-ack', clientMutationId: msg.clientMutationId, ...skeleton.subjectOf(msg), ok: false, reason: 'VALIDATION_ERROR', detail: `unknown facilityId: ${msg.facilityId}` }, broadcasts: skeleton.orderSlots(null), unaudited: true };
  }
  // `actingPositionId` arrives as an untrusted client claim, and every
  // per-Position authority rule downstream (permission.js's canMutate,
  // the Board's NOT_OWNER check in board/strip-ops.js, canActOnState — defects D10/D12/D21) is
  // evaluated against it. Until this check existed, nothing ever tied it to
  // the connecting session: a client could drive any Strip on the Board by
  // naming whichever Position happened to own it, whatever it had actually
  // selected. Bound here, at the wire boundary where the claim enters, so
  // the Board stays a pure function of (mutation, actingPositionId) with
  // no session concept of its own.
  //
  // Primary, not merely signed on: selecting a Position someone else already has
  // makes you an Observer (§4.8.2 rule 3, D18), and an Observer watches.
  const positionStore = ctx.positionStoreFor(facilityId);
  if (!positionStore || positionStore.primaryOf(msg.actingPositionId) !== session.controllerId) {
    return { ack: { version: VERSION, type: 'efsp-mutation-ack', clientMutationId: msg.clientMutationId, ...skeleton.subjectOf(msg), facilityId, ok: false, reason: 'NOT_HOLDING_POSITION', detail: `you are not Primary at ${msg.actingPositionId} — select it before acting on its Strips` }, broadcasts: skeleton.orderSlots(null), unaudited: true };
  }

  const mutation = { clientMutationId: msg.clientMutationId, stripId: msg.stripId, baseRev: msg.baseRev, op: msg.op };

  const stateBefore = (boardStore.getStrip(msg.stripId) || {}).state;
  const offersBefore = offersSignature(ctx);
  const result = boardStore.applyMutation(mutation, msg.actingPositionId, session.controllerId);
  // A throw part-way through an op leaves its earlier writes on the Board (`partial`): saved with their audit line, not dropped.
  if ((result.ok || result.partial) && !result.replayed) persist();

  // Every Strip record leaving this function — ack or broadcast — goes through
  // the one stamping helper, which is where the reasons for what it adds live.
  const stampedStrip = result.strip ? stampStrip(boardStore, result.strip, facilityId, ctx) : result.strip;

  // Every flight data this Mutation changed, not just the one it was addressed to. A
  // Strip op can write a flight data as a SIDE EFFECT — accepting a TOFI ENTRY writes
  // the separation regime the MRU controller stated (F-306), and a clearance
  // that voids a MARSA relation, or a flight ending that retires it, writes the
  // regime back to ATC on every participant (F-111's other direction). Those
  // writes landed server-side and reached nobody: the ack carries one `flightData` and
  // the delta carried only that one, so a connected client held the stale value
  // until it next took a full snapshot. the Board collects them as
  // `result.flightDataList` (board/strip-ops.js, board/tofi.js).
  const updatedFlightDataList = mergeFlightDataList(result.flightData, result.flightDataList);

  // docs/wip/SERVER-BUGS.md (B4): every warning the op made, then the one the wire adds; absent when there are none.
  const luaw = luawWhileCombined(positionStore, msg.actingPositionId, session.controllerId, result, stateBefore);
  const warnings = [...(result.warnings || []), ...(luaw ? [luaw] : [])];

  const ack = {
    version: VERSION, type: 'efsp-mutation-ack', clientMutationId: msg.clientMutationId,
    ...skeleton.subjectOf(msg),
    facilityId,
    boardSeq: boardStore.currentSeq, boardEpoch: boardStore.epoch, ok: result.ok,
    strip: stampedStrip, flightData: result.flightData, reason: result.reason, detail: result.detail,
    ...(warnings.length ? { warnings } : {}),
    // docs/adr/0101: a control write that needs "coordinated with" is refused with who and what, as data.
    ...(result.attestation ? { attestation: result.attestation } : {}),
    routedTo: result.routedTo,
    // docs/adr/0100 §7: the server says what is undoable (the client keeps no list), and an Undo's ack says what it
    // undid and voided. Absent otherwise.
    undoable: result.undoable, undone: result.undone, voided: result.voided,
    // docs/adr/0099: the part a split made (its Strip rides the broadcast) and what a join did.
    ...(result.split ? { splitStripId: result.splitStrip.stripId, split: result.split } : {}),
    ...(result.join ? { join: result.join } : {}),
  };
  // A replay answers from the idempotency cache (docs/adr/0081): the original
  // outcome with the Strip as it is now. Its broadcasts went out the first
  // time, so it sends none — a second one would only repeat a view.
  if (result.replayed) return { ack, broadcasts: skeleton.orderSlots(null) };

  // One Board event, one broadcast (guide §5.4, docs/adr/0081). The Mutation
  // may have touched Strips it never named — a rebalance re-keys a whole
  // Rack — and every one of them goes out here, or no client hears of it and
  // a later resync from this broadcast's boardSeq cannot heal it either (L6's
  // F1). A refusal normally touched nothing; if one ever did (an exception
  // part-way through an op), what it touched is broadcast rather than dropped.
  const touched = boardStore.drainTouched();
  if (!result.ok) {
    if (touched.length === 0) return { ack, broadcasts: skeleton.orderSlots(null) };
    return { ack, broadcasts: skeleton.orderSlots({ primary: boardDelta(ctx, boardStore, facilityId, touchedStrips(ctx, boardStore, facilityId, touched, null), []) }) };
  }

  // docs/adr/0110 §6: a Mutation that changed who is offered what (a hand-off into an unstaffed Position, an Undo of one, a
  // Strip dropped at one) carries that Facility's Positions; one that did not carries none, as before.
  const offersAfter = offersSignature(ctx);
  const offersMoved = [...offersAfter.keys()].filter(id => offersAfter.get(id) !== offersBefore.get(id));
  const slots = {
    primary: boardDelta(ctx, boardStore, facilityId, touchedStrips(ctx, boardStore, facilityId, touched, stampedStrip), updatedFlightDataList,
      offersMoved.includes(facilityId) ? positionsWire(ctx, facilityId) : [], result.flightDataGone || []),
  };
  // docs/adr/0100 §6 (H100 Q-U2 b): an Undo that voided another Position's Mutations tells that Position by a panel
  // message, sent by the hub after this round trip's broadcasts to the sessions signed on to it (directedFor).
  const directed = (result.undoVoided || []).map(d => ({
    facilityId: d.facilityId, positionId: d.positionId,
    frame: { version: VERSION, type: 'efsp-undo-voided', facilityId: d.facilityId, positionId: d.positionId, ...d.message },
  }));

  // Bug found in live testing: a coordination primitive's PROPOSE/ACCEPT/
  // REJECT/STAND_BY mutates or mints a Strip in a DIFFERENT Facility's
  // BoardStore (board/coordination.js's receiveCoordinationProposal/
  // receiveCoordinationResponse — a direct in-process peer-board call, not
  // itself a Mutation dispatched through this function). That side effect
  // was a real, correct change to server state, but nothing ever told any
  // connected client about it — only a full resync (reconnect) would ever
  // pick it up. `peerFacilityId`/`peerStrip` (docs/adr/0022) let this
  // build a SECOND board-delta, scoped to the peer Facility, so a client
  // signed on to a Position there sees the new/updated replica immediately,
  // same <200ms budget as the primary broadcast (guide §7.9).
  //
  // Built from the peer Board's own drain (docs/adr/0081): placing a replica
  // in a coordination Bay can rebalance that Rack, and those re-keyed Strips
  // are the peer's side of the same Board event. The peer Board is drained
  // only when this broadcast is built, so nothing it touched is discarded.
  if (result.peerStrip || result.peerFacilityId) {
    const peerBoardStore = ctx.boardStoreFor(result.peerFacilityId);
    // An Undo that only removed the peer's replica has no peer Strip to name: the delta carries its `gone`.
    const peerStamped = result.peerStrip ? stampStrip(peerBoardStore, result.peerStrip, result.peerFacilityId, ctx) : null;
    const peerTouched = peerBoardStore ? peerBoardStore.drainTouched() : [];
    // flightDataList: one shared FlightDataStore (docs/adr/0013) — already covered by the primary broadcast's flightDataList.updated
    slots.peer = boardDelta(ctx, peerBoardStore, result.peerFacilityId,
      touchedStrips(ctx, peerBoardStore, result.peerFacilityId, peerTouched, peerStamped), []);
  }

  // Another Facility's offers moved (a cross-Facility replica minted at an unstaffed Position): its Positions ride the peer slot.
  for (const id of offersMoved) {
    if (id === facilityId) continue;
    const peers = slots.peer ? (Array.isArray(slots.peer) ? slots.peer : [slots.peer]) : [];
    const own = peers.find(f => f.facilityId === id);
    if (own) own.positions = { updated: positionsWire(ctx, id) };
    else { const b = ctx.boardStoreFor(id); peers.push(boardDelta(ctx, b, id, { updated: [], gone: [] }, [], positionsWire(ctx, id))); }
    slots.peer = peers.length === 1 ? peers[0] : peers;
  }

  // WP6 (docs/adr/0051) — a Strip Mutation can change a MARSA relation without
  // being a MARSA op: §9.2 rule 2's interlock voids one when a course or
  // altitude is assigned before rendezvous (`marsaVoided`), and a flight's last
  // Strip being dropped retires it from any relation it was in
  // (`marsaChanged`). Both are real changes to server state that no
  // efsp-board-delta can carry, because a relation is not a Strip and its
  // participants' Strips may sit in another Facility entirely.
  //
  // Emitted as a THIRD broadcast on the same round trip rather than left for
  // the next MARSA op, so the clearance and the void reach every participant's
  // controller together — exactly the bug docs/adr/0022 found for peer Strips,
  // where a correct server-side change reached no client until a reconnect.
  const marsaChanged = [
    ...(result.marsaVoided ? [result.marsaVoided] : []),
    ...(result.marsaChanged || []),
  ];
  if (marsaChanged.length > 0 && ctx.marsaStore) {
    slots.marsa = marsaDelta(ctx.marsaStore, marsaChanged);
  }
  // docs/adr/0074 — a carrier handoff or a Strip retiring moves the Marshal
  // stack (Commence marks a flight pushed, a handoff to PriFly leaves a
  // vacancy). The record is not a Strip, so it rides its own delta on the same
  // round trip, MARSA's shape.
  if (result.carrierChanged && ctx.carrierStore) {
    slots.carrier = carrierDelta(ctx.carrierStore);
    // A push re-numbers nothing but changes which lane the next flight feeds.
    if (ctx.nlaStatusMonitor) ctx.nlaStatusMonitor.tick();
  }
  // H136 (docs/wip/LT-VFR.md): "Start flight following" binds the contact, "Radar service terminated" ends the binding,
  // and their Undo reverses either. The record is not a Strip, so it rides its own delta on the same round trip.
  if (result.correlationChanged && result.correlationChanged.length && ctx.correlationStore) {
    slots.correlation = frames.correlationDelta(ctx.correlationStore, result.correlationChanged);
  }
  return directed.length
    ? { ack, broadcasts: skeleton.orderSlots(slots), directed }
    : { ack, broadcasts: skeleton.orderSlots(slots) };
}

/**
 * efsp-resync (guide §5.6): exactly two answers, a delta or a snapshot, sent as an
 * `efsp-resync-reply` (see _asResyncReply).
 *
 * Three steps, kept in this order so each can grow on its own: resolve the
 * Board, decide whether a delta can serve this client, build the answer. A
 * rule that forces a snapshot for some sessions (L23) is one more early return
 * in the middle step; retention removing Strips (L24) only changes what
 * getDeltaSince reports as `gone`.
 */
function _handleResync(ctx, session, msg) {
  // A request that names no Board position asks about the other stores only (docs/adr/0106): answered with their
  // slices and no Board answer, which would be a full snapshot for a lastBoardSeq it was never given.
  const storesOnly = msg.stores && typeof msg.stores === 'object' && msg.lastBoardSeq === undefined && msg.boardEpoch === undefined;
  if (storesOnly) {
    return { ack: { version: VERSION, type: 'efsp-resync-reply', answer: 'stores', stores: storeSlicesFor(ctx, session, msg.stores) }, broadcasts: skeleton.orderSlots(null) };
  }
  const { ack } = _resyncAnswer(ctx, session, msg);
  const reply = _asResyncReply(ack);
  // A full snapshot already carries every store; only a delta answer gets slices beside it.
  if (reply.answer === 'delta' && msg.stores && typeof msg.stores === 'object') reply.stores = storeSlicesFor(ctx, session, msg.stores);
  return { ack: reply, broadcasts: skeleton.orderSlots(null) };
}

/** The sync-declared stores that exist in this ctx: `{ ...declaration, store }`. */
function syncedStores(ctx) {
  const out = [];
  for (const decl of STORE_SYNC) {
    const store = ctx.stores && ctx.stores[decl.registryKey];
    if (store) out.push({ ...decl, store });
  }
  return out;
}

/**
 * The `stores` of an efsp-resync-reply (docs/adr/0106): for each store the client named whose epoch differs from ours
 * or whose seq is not ours, `{ seq, epoch, slice }`, `slice` being what the full snapshot carries under that store's key,
 * filtered for this session's read scope (docs/adr/0080). A store the client already has is left out; one it did not name is too.
 * @param {Record<string, {lastSeq?: number, epoch?: string}>} asked
 */
function storeSlicesFor(ctx, session, asked) {
  const out = {};
  const scope = readScopeOf(ctx, session);
  let strips = null;
  for (const { key, store } of syncedStores(ctx)) {
    const have = asked[key];
    if (!have || typeof have !== 'object') continue;
    if (have.epoch === store.epoch && have.lastSeq === store.currentSeq) continue;
    let slice = families.bySnapshotKey[key].snapshot(ctx);
    if (scope.kind !== readScope.ALL) {
      strips = strips || liveStamped(ctx);
      slice = readScope.filterSnapshot({ strips, [key]: slice }, scope)[key];
    }
    out[key] = { seq: store.currentSeq, epoch: store.epoch, slice };
  }
  return out;
}

/**
 * The heartbeat's `stores`: `{ [snapshotKey]: { seq, epoch } }` for every store with a sync declaration (docs/adr/0106).
 * Built once per tick. The same for every session: an owned-scope session is sent a (possibly empty) delta for every
 * change of a filtered store, so its seq is continuous and the numbers hide nothing.
 */
function heartbeatStores(ctx) {
  const out = {};
  for (const { key, store } of syncedStores(ctx)) out[key] = { seq: store.currentSeq, epoch: store.epoch };
  return out;
}

/**
 * The answer to an efsp-resync has its own wire type (R3-47, S-12): the snapshot or the
 * delta it would have been, flat, tagged `answer: 'snapshot' | 'delta'`, so the client
 * knows it is a reply to what it asked and applies it as the message it carries.
 */
function _asResyncReply(inner) {
  return { ...inner, version: VERSION, type: 'efsp-resync-reply', answer: inner.type === 'efsp-snapshot' ? 'snapshot' : 'delta' };
}

function _resyncAnswer(ctx, session, msg) {
  // 1. Resolve the Board.
  const facilityId = msg.facilityId || ctx.facilityConfig.DEFAULT_FACILITY_ID;
  const boardStore = ctx.boardStoreFor(facilityId);
  const positionStore = ctx.positionStoreFor(facilityId);
  if (!boardStore || !positionStore) return { ack: _snapshotMessage(ctx, session) };

  // A session that reads only what it owns (docs/adr/0080) always gets the
  // filtered SNAPSHOT: the ring replays unfiltered history, and a snapshot is
  // the other of §5.6's two answers, so the rule of two paths still holds.
  if (readScope.isOwned(readScopeOf(ctx, session))) return { ack: _snapshotMessage(ctx, session) };

  // 2. Decide: delta or snapshot.
  const lastSeq = Number.isFinite(msg.lastBoardSeq) ? msg.lastBoardSeq : -1;
  if (!_deltaCanServe(boardStore, msg.boardEpoch, lastSeq)) return { ack: _snapshotMessage(ctx, session) };

  // 3. Build the delta.
  const delta = boardStore.getDeltaSince(lastSeq);
  const live = delta.updated.filter(s => s.state !== 'DROPPED');
  const dropped = delta.updated.filter(s => s.state === 'DROPPED').map(s => s.stripId);
  return {
    ack: boardDelta(ctx, boardStore, facilityId,
      {
        updated: live.map(s => stampStrip(boardStore, s, facilityId, ctx)),
        // DROPPED Strips still on the Board, then ids no longer on it at all
        // (retention's archive, L24). Disjoint by construction.
        gone: [...dropped, ...delta.gone],
      },
      // flight data/Positions are cheap enough at this scale to always send in
      // full rather than building a second/third ring buffer: the Board is a
      // few dozen Strips. flightDataStore is shared across every
      // Facility (docs/adr/0013), so this list is NOT facility-scoped —
      // it's the same full set a snapshot would carry.
      ctx.flightDataStore.getAll(),
      positionsWire(ctx, facilityId)),
  };
}

/** Whether a delta from `lastSeq` would leave this client right (sync/sync-log.js canServeDelta). */
function _deltaCanServe(boardStore, boardEpoch, lastSeq) {
  return canServeDelta({ seq: boardStore.currentSeq, epoch: boardStore.epoch }, boardEpoch, lastSeq);
}

/** docs/adr/0105 (H104 GCLC-2): LC putting a Strip into LUAW while the same controller also holds GC or CD. A warning, never a refusal. */
function luawWhileCombined(positionStore, actingPositionId, controllerId, result, stateBefore) {
  if (!result.ok || !result.strip || result.strip.state !== 'LUAW' || stateBefore === 'LUAW') return undefined;
  if (actingPositionId !== combination.LOCAL) return undefined;
  const held = positionStore.primaryPositionsOf(controllerId);
  return combination.NON_LOCAL.some(id => held.includes(id)) ? warn('LUAW_WHILE_COMBINED') : undefined;
}

/**
 * Every Position entry of a Facility as the wire carries it: the store's own plus `facilityId` and the standing `hatOffers`
 * (docs/adr/0110 §6). The one place Positions are serialised.
 */
function positionsWire(ctx, facilityId) {
  const positionStore = ctx.positionStoreFor(facilityId);
  const strips = ctx.boardStoreFor(facilityId).getAll();
  return positionStore.getAll().map(p => ({ ...p, facilityId, hatOffers: combination.hatOffersFor(positionStore, p.positionId, strips) }));
}

/** Per Facility, the offers standing now as a string: a before/after compare says whether a round trip changed any (docs/adr/0110 §6). */
function offersSignature(ctx) {
  const out = new Map();
  for (const facilityId of ctx.facilityConfig.getFacilityIds()) {
    const positionStore = ctx.positionStoreFor(facilityId);
    const boardStore = ctx.boardStoreFor(facilityId);
    if (!positionStore || !boardStore) continue;
    const strips = boardStore.getAll();
    out.set(facilityId, JSON.stringify(positionStore.positionIds().map(id => [id, positionStore.observersOf(id).length > 0, combination.hatOffersFor(positionStore, id, strips)])));
  }
  return out;
}

function facilityConfig_positionIds(ctx, facilityId) { return ctx.facilityConfig.getPositionSet(facilityId); }

const combination = require('./combination'); // docs/adr/0105

function _handleSetPositions(ctx, session, msg, persist) {
  const facilityId = msg.facilityId || ctx.facilityConfig.DEFAULT_FACILITY_ID;
  const positionStore = ctx.positionStoreFor(facilityId);
  const boardStore = ctx.boardStoreFor(facilityId);
  if (!positionStore || !boardStore) {
    return { ack: { version: VERSION, type: 'efsp-positions-ack', facilityId, signedOn: [], warnings: [], reason: 'VALIDATION_ERROR', detail: `unknown facilityId: ${facilityId}` }, broadcasts: skeleton.orderSlots(null) };
  }
  const signedOn = Array.isArray(msg.signedOn) ? msg.signedOn : [];
  const staffedBefore = new Set(facilityConfig_positionIds(ctx, facilityId).filter(id => positionStore.isStaffed(id)));
  const { signedOn: actuallySignedOn, vacated } = positionStore.setSignedOnPositions(session.controllerId, session.who, signedOn);

  // A takeover (a sign-on that ended an absent Primary's held entry) is a sign-off of that Position too: same effects.
  const takenOver = positionStore.drainTakenOver();
  const fx = staffingChanged(ctx, session.controllerId, [{ facilityId, signedOn: actuallySignedOn, vacated: [...vacated, ...takenOver], staffedBefore }], persist);
  const { warnings } = fx.byFacility.get(facilityId);
  const result = {
    // docs/adr/0105: `combination` is the warning for one controller holding LC with GC or CD (null otherwise), and
    // `monitoring` the frequencies of every Position this controller is Primary at (a combination has both).
    ack: { version: VERSION, type: 'efsp-positions-ack', facilityId, signedOn: actuallySignedOn, warnings,
      combination: combination.combinationOf(positionStore, session.controllerId, boardStore.getAll()),
      monitoring: positionStore.frequenciesHeldBy(session.controllerId) },
    broadcasts: skeleton.orderSlots({ primary: fx.primary.get(facilityId), peer: fx.peer.length ? fx.peer : null }),
  };
  return result;
}

/**
 * THE sign-off's effects, whoever caused it: an explicit `efsp-set-positions`, a disconnect whose sign-on grace ran
 * out (ws-hub.js), or a sign-on that took over an absent controller's Position. One function, so a sign-off caused by a
 * disconnect has the same effects as an explicit one (docs/wip/SIGNOFF-EFFECTS.md).
 *
 * `changes` is `[{ facilityId, signedOn, vacated, staffedBefore }]`, one per Facility whose staffing moved, the Position
 * store already updated. Does: (1) a Position left unstaffed with Strips warns who is offered its hat (nothing moves; TACTICAL hands the Strips back, docs/adr/0110); (2) a Position that gained a Primary gets its routed-away Strips back; (3) the control invariant is repaired on
 * every Facility's Board (docs/adr/0101, sign-off is never blocked, DR-6); (4) the other Boards' touched Strips are sent;
 * (5) the Board is persisted when 1-3 changed it.
 * @returns {{byFacility: Map, primary: Map, peer: object[]}} per changed Facility `{warnings}`,
 *   its full-Board delta, and the other Boards' deltas. The hat offers are standing state on the Position entries (docs/adr/0110), not frames.
 */
function staffingChanged(ctx, controllerId, changes, persist) {
  const byFacility = new Map();
  const changed = new Set(changes.map(c => c.facilityId));
  let boardChanged = false;
  for (const c of changes) {
    const positionStore = ctx.positionStoreFor(c.facilityId);
    const boardStore = ctx.boardStoreFor(c.facilityId);
    const warnings = [];
    const reassignedIds = [];
    // F10: a Position that was empty and now has a Primary gets back the Strips that were routed away from it (docs/adr/0080).
    for (const positionId of c.signedOn) {
      if (!c.staffedBefore.has(positionId) && positionStore.isStaffed(positionId)) {
        reassignedIds.push(...boardStore.returnConsolidatedStrips(positionId));
      }
    }
    for (const positionId of c.vacated) {
      if (positionStore.isStaffed(positionId)) continue; // another controller is now Primary — nothing to route
      const owned = boardStore.getAll().filter(s => s.ownerPositionId === positionId && s.state !== 'DROPPED');
      if (owned.length === 0) continue;

      if (positionStore.hasHandBack(positionId)) {
        // TACTICAL (docs/adr/0110 decision 7): the line was delegated, so it is handed back; it returns when this Position is staffed.
        const handBack = positionStore.handBackTo(positionId);
        if (handBack) {
          const moved = boardStore.reassignPositionStrips(positionId, handBack);
          reassignedIds.push(...moved);
          const warning = { positionId, count: owned.length, routedTo: handBack };
          if (moved.unplaced && moved.unplaced.length) warning.unplaced = moved.unplaced.length; // no Bay of the Position they were handed back to fits: they stay where they were
          warnings.push(warning);
        } else {
          warnings.push({ positionId, count: owned.length, routedTo: null });
        }
      } else {
        // docs/adr/0110 §2: nothing moves. The Strips stay this Position's and the first staffed member of its list is
        // offered the hat. `offeredTo: null` is defect D19's boundary: nobody to offer it to, a visible warning, never a block
        // (guide §4.8.6 rule 3, rule 5). `onRunway` names an aircraft in LUAW or on FINAL (LC left with VIPER1 in LUAW).
        const warning = { positionId, count: owned.length, offeredTo: positionStore.hatTakerOf(positionId) };
        const onRunway = combination.onRunwayCount(owned);
        if (onRunway) warning.onRunway = onRunway;
        warnings.push(warning);
      }
    }
    if (reassignedIds.length > 0) boardChanged = true;
    byFacility.set(c.facilityId, { warnings });
  }

  // docs/adr/0101: a change of staffing is when a HANDOFF holder can lose its staffed owner. Every Facility's exchanges are
  // checked (sign-off is not blocked, DR-6: the invariant repairs or alerts, and the alert stands until someone signs on).
  for (const id of ctx.facilityConfig.getFacilityIds()) {
    const b = ctx.boardStoreFor(id);
    if (b && b.reconcileExchanges() > 0) boardChanged = true;
  }

  // A repair writes both halves of an exchange, so it touches the OTHER Facility's Board whichever side lost its holder:
  // what any Board that is not re-sent in full touched is sent in this round trip, to the sessions that read it.
  const peer = [];
  for (const id of ctx.facilityConfig.getFacilityIds()) {
    if (changed.has(id)) continue;
    const b = ctx.boardStoreFor(id);
    const touched = b ? b.drainTouched() : [];
    if (touched.length) peer.push(boardDelta(ctx, b, id, touchedStrips(ctx, b, id, touched, null), []));
  }

  // The re-send carries every live Strip (taking or giving up a Position changes who is there to receive a transfer, which
  // changes the `nla` status of Strips this change never touched, F-408), so whatever was touched is already in it; drained
  // so those touches do not ride again on the next Mutation's broadcast (docs/adr/0081). It carries the Positions too.
  const primary = new Map();
  for (const c of changes) {
    const boardStore = ctx.boardStoreFor(c.facilityId);
    const positionStore = ctx.positionStoreFor(c.facilityId);
    primary.set(c.facilityId, boardDelta(ctx, boardStore, c.facilityId,
      { updated: boardStore.getAll().filter(s => s.state !== 'DROPPED').map(s => stampStrip(boardStore, s, c.facilityId, ctx)), gone: [] },
      [], positionsWire(ctx, c.facilityId)));
    boardStore.drainTouched();
  }
  // A consolidation reassignment or a repair changes the Board; a restart before the next Mutation must not undo it (docs/adr/0081).
  if (boardChanged && typeof persist === 'function') persist();

  return { byFacility, primary, peer };
}

/**
 * A controller's connection is gone and its sign-on grace ran out: sign them off every Position at every Facility
 * (guide §4.8.6 rule 1: the longest-waiting Observer is promoted) with the same effects as an explicit sign-off.
 * @returns {{broadcasts: object[]}} the frames to send; empty when they held nothing
 */
function signOffController(ctx, controllerId, persist) {
  const changes = [];
  for (const facilityId of ctx.facilityConfig.getFacilityIds()) {
    const positionStore = ctx.positionStoreFor(facilityId);
    if (!positionStore) continue;
    const staffedBefore = new Set(facilityConfig_positionIds(ctx, facilityId).filter(id => positionStore.isStaffed(id)));
    const { vacated } = positionStore.onDisconnect(controllerId);
    if (vacated.length) changes.push({ facilityId, signedOn: [], vacated, staffedBefore });
  }
  if (changes.length === 0) return { broadcasts: [] };
  const fx = staffingChanged(ctx, controllerId, changes, persist);
  const [first, ...rest] = changes.map(c => fx.primary.get(c.facilityId));
  return { broadcasts: skeleton.orderSlots({ primary: first, peer: [...rest, ...fx.peer] }) };
}

// ── The read scope (docs/adr/0080) ───────────────────────────────────────────

/**
 * What `session` is sent of the flights, from the Positions it is signed on to NOW at every
 * Facility (nothing is cached, so nothing goes stale). A pure function of the
 * PositionStores and permission.js's capability table.
 */
function readScopeOf(ctx, session) {
  if (!session || !session.controllerId) return { kind: readScope.ALL };
  const signedOn = [];
  for (const facilityId of ctx.facilityConfig.getFacilityIds()) {
    const positionStore = ctx.positionStoreFor(facilityId);
    if (!positionStore) continue;
    for (const positionId of positionStore.signedOnBy(session.controllerId)) signedOn.push({ facilityId, positionId });
  }
  return readScope.scopeOf(signedOn, permission.readScopeFor);
}

/**
 * The message this session is to be sent for `msg`: the SAME object for a
 * session that reads everything (the fast path), a filtered copy for one that
 * reads only what it owns, or null when nothing is left to send.
 */
/**
 * The frame a directed message (`{facilityId, positionId, frame}`, an Undo's `efsp-undo-voided`) gives `session`:
 * the frame when the session is signed on to that Position and may see the Strip it names, else null.
 */
function directedFor(ctx, session, directed) {
  if (!session || !session.controllerId || !directed || !directed.frame) return null;
  const positionStore = ctx.positionStoreFor(directed.facilityId);
  if (!positionStore || !positionStore.signedOnBy(session.controllerId).includes(directed.positionId)) return null;
  // Read scope (docs/adr/0080): a session that reads only what it owns hears only of what it may see.
  const scope = readScopeOf(ctx, session);
  if (scope.kind === readScope.ALL) return directed.frame;
  const board = ctx.boardStoreFor(directed.facilityId);
  const strip = board && directed.frame.stripId ? board.getStrip(directed.frame.stripId) : null;
  return strip && readScope.isStripVisible(scope, { ...strip, facilityId: directed.facilityId }, directed.facilityId) ? directed.frame : null;
}

function filterForSession(ctx, session, msg) {
  if (!msg) return msg;
  const scope = readScopeOf(ctx, session);
  if (scope.kind === readScope.ALL) return msg;
  switch (msg.type) {
    case 'efsp-snapshot':
      return readScope.filterSnapshot(msg, scope);
    case 'efsp-board-delta':
      return readScope.filterBoardDelta(msg, scope, readScope.visibleFlightDataIdsOf(scope, liveStamped(ctx)), (id) => ctx.flightDataStore.getFlightData(id));
    case 'efsp-alerts': {
      const live = liveStamped(ctx);
      const byKey = new Map(live.map(s => [`${s.facilityId}:${s.stripId}`, s]));
      return readScope.filterAlerts(msg, scope, readScope.visibleFlightDataIdsOf(scope, live),
        (facilityId, stripId) => readScope.isStripVisible(scope, byKey.get(`${facilityId}:${stripId}`)));
    }
    default: {
      // A family's own delta, filtered by the family (correlation, MARSA).
      const family = families.byDeltaType[msg.type];
      return family && family.filter ? family.filter(ctx, scope, msg) : msg;
    }
  }
}

/**
 * What else an OWNED session needs alongside a filtered board delta: the
 * correlation record and the MARSA relations of the Strips in it, which the
 * delta cannot carry. A Strip that has just become visible (handed to the
 * session) has had its record filtered out of every earlier delta, and a
 * record only changes when the flight does, so waiting for the next change
 * would leave the handed line uncorrelated on screen. Empty for a session that
 * reads everything, and for a delta with no visible Strip.
 * @returns {object[]} messages to send after `filtered`
 */
function supplementFor(ctx, session, filtered) {
  if (!filtered || filtered.type !== 'efsp-board-delta') return [];
  const scope = readScopeOf(ctx, session);
  if (scope.kind === readScope.ALL) return [];
  const flightDataIds = new Set(((filtered.strips || {}).updated || []).map(s => s.flightDataId).filter(Boolean));
  if (flightDataIds.size === 0) return [];
  const out = [];
  const records = ctx.correlationStore ? [...flightDataIds].map(id => ctx.correlationStore.getCorrelation(id)).filter(Boolean) : [];
  if (records.length) out.push(frames.correlationDelta(null, records));
  const relations = ctx.marsaStore ? ctx.marsaStore.getAll().filter(r => (r.participants || []).some(id => flightDataIds.has(id))) : [];
  if (relations.length) {
    // A supplement is a partial: it names no seq, so it cannot move the client's marsaSeq past a change it never got (docs/adr/0106).
    const { marsaSeq, marsaEpoch, ...supplement } = marsaDelta(ctx.marsaStore, relations);
    out.push(supplement);
  }
  return out;
}

/** Changes exactly when what `session` may see of the flights changes. */
function readScopeKey(ctx, session) { return readScope.scopeKey(readScopeOf(ctx, session)); }

/**
 * The heartbeat's `boards` for every Facility: `{ [facilityId]: { seq, epoch } }`
 * (docs/adr/0104). Built once per tick and shared by every session that reads everything.
 */
function heartbeatBoardsAll(ctx) {
  const boards = {};
  for (const facilityId of ctx.facilityConfig.getFacilityIds()) {
    const board = ctx.boardStoreFor(facilityId);
    boards[facilityId] = { seq: board.currentSeq, epoch: board.epoch };
  }
  return boards;
}

/**
 * The `boards` this session's heartbeat names: every Facility for a session that reads
 * everything (the shared `all` object itself), and only the Facilities where it holds a
 * Position for one that reads only what it owns (docs/adr/0080, 0104).
 */
function heartbeatBoardsFor(ctx, session, all = heartbeatBoardsAll(ctx)) {
  const scope = readScopeOf(ctx, session);
  if (scope.kind === readScope.ALL) return all;
  const out = {};
  for (const facilityId of scope.own.keys()) if (all[facilityId]) out[facilityId] = all[facilityId];
  return out;
}

/**
 * WP4A: sends every Facility's strips/positions/bays in one message (each
 * record stamped with `facilityId`), since a client can be signed on to Positions
 * and act across both. `boardSeqByFacility`/`facilities` are the shape (the
 * old top-level `boardSeq`/`facility` aliases are gone, docs/adr/0104).
 */
function _snapshotMessage(ctx, session = null) {
  const full = _fullSnapshotMessage(ctx);
  if (!session) return full;
  // docs/adr/0110 §6: who this session is, so its client can tell Primary from Observer at a Position (the Take Q row, the COMBINED line).
  return { ...readScope.filterSnapshot(full, readScopeOf(ctx, session)), self: { controllerId: session.controllerId || null } };
}

/** The snapshot keys the families own, in registry order (airspaces, correlations, marsa, runwayStatuses, carriers). */
function familySnapshots(ctx) {
  const out = {};
  for (const family of families.FAMILIES) if (family.snapshotKey) out[family.snapshotKey] = family.snapshot(ctx);
  return out;
}

function storeMaps(ctx) {
  const storeSeqs = {};
  const storeEpochs = {};
  for (const { key, store } of syncedStores(ctx)) { storeSeqs[key] = store.currentSeq; storeEpochs[key] = store.epoch; }
  return { storeSeqs, storeEpochs };
}

function _fullSnapshotMessage(ctx) {
  const { flightDataStore, facilityConfig } = ctx;
  const facilityIds = facilityConfig.getFacilityIds();

  const strips = [];
  const positions = [];
  const bays = [];
  const boardSeqByFacility = {};
  // The lifetime each seq belongs to (docs/adr/0081): a client that resyncs
  // sends back the epoch it read here, or it is answered with a snapshot.
  const boardEpochByFacility = {};
  // WP4A gap-closure (docs/adr/0022) — lets the client proactively disable
  // the AIT option (rather than let the controller submit-and-silently-fail
  // against the server-side check in board/coordination.js's
  // _applyCoordinationPropose) when no written directive is on file.
  const aitAuthorizedByFacility = {};

  for (const facilityId of facilityIds) {
    const boardStore = ctx.boardStoreFor(facilityId);
    const positionStore = ctx.positionStoreFor(facilityId);
    boardSeqByFacility[facilityId] = boardStore.currentSeq;
    boardEpochByFacility[facilityId] = boardStore.epoch;
    aitAuthorizedByFacility[facilityId] = !!facilityConfig.getFacilityConfig(facilityId).aitAuthorized;
    for (const s of boardStore.getAll().filter(s => s.state !== 'DROPPED')) strips.push(stampStrip(boardStore, s, facilityId, ctx));
    positions.push(...positionsWire(ctx, facilityId));
    bays.push(...facilityConfig.getAllBays(facilityId));
  }

  return {
    version: VERSION, type: 'efsp-snapshot',
    // The default Facility comes first (docs/adr/0104): a client selects `facilities[0]`.
    facilities: facilityIds,
    boardSeqByFacility,
    boardEpochByFacility,
    // Every other store's seq and lifetime, by snapshot key (docs/adr/0106).
    ...storeMaps(ctx),
    aitAuthorizedByFacility,
    // The character each Position's owned contacts carry on an ATC scope
    // (docs/adr/0088). Config, so it rides the snapshot only.
    positionLetters: facilityConfig.allPositionLetters ? facilityConfig.allPositionLetters() : {},
    // The Positions whose controller sees the airport surface (H162), per Facility. Config, snapshot only.
    airportSurfacePositions: facilityConfig.allAirportSurfacePositions ? facilityConfig.allAirportSurfacePositions() : {},
    // The Block writes a Position may make on a Strip it does not hold (permission.js mayActBesideOwner): the client names
    // that Position as the acting one, and leaves the cell read-only when it holds none of them. Rules, snapshot only.
    nonOwnerBlockWrites: permission.NON_OWNER_BLOCK_WRITES.map(r => ({ blockId: r.blockId, stripType: r.stripType, positions: [...r.positions] })),
    positions, bays, strips,
    flightDataList: flightDataStore.getAll(),
    ...familySnapshots(ctx),
  };
}

module.exports = { handleMessage, signOffController, directedFor, carrierDelta, snapshotMessage: _snapshotMessage, filterForSession, supplementFor, readScopeKey, readScopeOf, heartbeatBoardsAll, heartbeatBoardsFor, heartbeatStores, RESYNC_RING_WINDOW };
