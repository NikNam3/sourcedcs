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
const { VERSION, stampStrip, mergeFlightDataList, touchedStrips, boardDelta, marsaDelta, carrierDelta, sfaDelta, liveStamped } = frames;
const skeleton = require('./wire/skeleton');
const families = require('./wire/families');

// The resync window and the delta-or-snapshot decision live with the ring (sync/sync-log.js).
const { canServeDelta, RESYNC_RING_WINDOW } = require('./sync/sync-log');

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

  const result = boardStore.applyMutation(mutation, msg.actingPositionId, session.controllerId);
  if (result.ok && !result.replayed) persist();

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

  const ack = {
    version: VERSION, type: 'efsp-mutation-ack', clientMutationId: msg.clientMutationId,
    ...skeleton.subjectOf(msg),
    facilityId,
    boardSeq: boardStore.currentSeq, boardEpoch: boardStore.epoch, ok: result.ok,
    strip: stampedStrip, flightData: result.flightData, reason: result.reason, detail: result.detail,
    warning: result.warning, routedTo: result.routedTo,
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

  const slots = {
    primary: boardDelta(ctx, boardStore, facilityId, touchedStrips(ctx, boardStore, facilityId, touched, stampedStrip), updatedFlightDataList),
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
  const { ack } = _resyncAnswer(ctx, session, msg);
  return { ack: _asResyncReply(ack), broadcasts: skeleton.orderSlots(null) };
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
      positionStore.getAll().map(p => ({ ...p, facilityId }))),
  };
}

/** Whether a delta from `lastSeq` would leave this client right (sync/sync-log.js canServeDelta). */
function _deltaCanServe(boardStore, boardEpoch, lastSeq) {
  return canServeDelta({ seq: boardStore.currentSeq, epoch: boardStore.epoch }, boardEpoch, lastSeq);
}

function facilityConfig_positionIds(ctx, facilityId) { return ctx.facilityConfig.getPositionSet(facilityId); }

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

  const warnings = [];
  const reassignedIds = [];
  // F10: a Position that was empty and now has a Primary gets back the Strips
  // that were routed away from it (docs/adr/0080).
  for (const positionId of actuallySignedOn) {
    if (!staffedBefore.has(positionId) && positionStore.isStaffed(positionId)) {
      reassignedIds.push(...boardStore.returnConsolidatedStrips(positionId));
    }
  }
  for (const positionId of vacated) {
    if (positionStore.isStaffed(positionId)) continue; // another controller is now Primary — nothing to route
    const owned = boardStore.getAll().filter(s => s.ownerPositionId === positionId && s.state !== 'DROPPED');
    if (owned.length === 0) continue;

    const consolidatedAt = positionStore.consolidatedAt(positionId);
    if (consolidatedAt) {
      const moved = boardStore.reassignPositionStrips(positionId, consolidatedAt);
      reassignedIds.push(...moved);
      const warning = { positionId, count: owned.length, routedTo: consolidatedAt };
      if (moved.unplaced && moved.unplaced.length) warning.unplaced = moved.unplaced.length; // no Bay of the Position they were consolidated at fits: they stay where they were
      warnings.push(warning);
    } else {
      // Defect D19 boundary: the consolidation chain bottomed out with nobody
      // staffing any link. MUST be a visible, distinct condition — never
      // a Strip silently left owned by an unstaffed Position with no
      // signal to anyone (guide §4.8.6 rule 3).
      warnings.push({ positionId, count: owned.length, routedTo: null });
    }
  }

  // The re-send below carries every live Strip, so whatever
  // reassignPositionStrips touched is already in it. Drained so those touches
  // do not ride again on the next Mutation's broadcast (docs/adr/0081).
  boardStore.drainTouched();
  // A consolidation reassignment changes the Board, and it used to be the one
  // Board change never persisted: a restart before the next Mutation restored
  // the Strips to the Position that had left (docs/adr/0081, L6's F2/F5 tail).
  if (reassignedIds.length > 0 && typeof persist === 'function') persist();

  return {
    ack: { version: VERSION, type: 'efsp-positions-ack', facilityId, signedOn: actuallySignedOn, warnings },
    // EVERY live Strip, not just the reassigned ones. Taking or giving up a
    // Position changes who is there to receive a transfer, which changes the
    // `nla` status stampStrip computes for Strips this message never
    // touched — an LC Strip at DEPARTED becomes "no receiving Position
    // present" the instant AP is released, and F-408's whole point is that
    // the panel be told BEFORE the press. The Board is a few dozen Strips
    // (a few dozen Strips) and a Position change is a rare,
    // deliberate act, so re-sending the set is cheaper than tracking which
    // Strips' status actually moved.
    broadcasts: skeleton.orderSlots({ primary: boardDelta(ctx, boardStore, facilityId,
      { updated: boardStore.getAll().filter(s => s.state !== 'DROPPED').map(s => stampStrip(boardStore, s, facilityId, ctx)), gone: [] },
      [], positionStore.getAll().map(p => ({ ...p, facilityId }))) }),
  };
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
  if (records.length) out.push({ version: VERSION, type: 'efsp-correlation-delta', correlations: { updated: records } });
  const relations = ctx.marsaStore ? ctx.marsaStore.getAll().filter(r => (r.participants || []).some(id => flightDataIds.has(id))) : [];
  if (relations.length) out.push(marsaDelta(ctx.marsaStore, relations));
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
  return session ? readScope.filterSnapshot(full, readScopeOf(ctx, session)) : full;
}

/** The snapshot keys the families own, in registry order (airspaces, correlations, marsa, runwayStatuses, carriers, sfaRotation). */
function familySnapshots(ctx) {
  const out = {};
  for (const family of families.FAMILIES) if (family.snapshotKey) out[family.snapshotKey] = family.snapshot(ctx);
  return out;
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
    for (const p of positionStore.getAll()) positions.push({ ...p, facilityId });
    bays.push(...facilityConfig.getAllBays(facilityId));
  }

  return {
    version: VERSION, type: 'efsp-snapshot',
    // The default Facility comes first (docs/adr/0104): a client selects `facilities[0]`.
    facilities: facilityIds,
    boardSeqByFacility,
    boardEpochByFacility,
    aitAuthorizedByFacility,
    // The character each Position's owned contacts carry on an ATC scope
    // (docs/adr/0088). Config, so it rides the snapshot only.
    positionLetters: facilityConfig.allPositionLetters ? facilityConfig.allPositionLetters() : {},
    positions, bays, strips,
    flightDataList: flightDataStore.getAll(),
    ...familySnapshots(ctx),
  };
}

module.exports = { handleMessage, directedFor, carrierDelta, sfaDelta, snapshotMessage: _snapshotMessage, filterForSession, supplementFor, readScopeKey, readScopeOf, heartbeatBoardsAll, heartbeatBoardsFor, RESYNC_RING_WINDOW };
