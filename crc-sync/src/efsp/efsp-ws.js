'use strict';

// EFSP WebSocket message handling — the boundary between ws-hub.js's
// session/broadcast machinery and the EFSP stores. Kept as its own file
// rather than inlined into ws-hub.js's existing message switch (the way
// theaterSettingsSet/aptConfigSet are) because the EFSP
// surface area — three message types, each with a distinct ack/broadcast
// shape, one of which (mutation) now covers fourteen op kinds — is bigger
// than those single-shot squadron-config messages.
//
// handleMessage() returns { ack, broadcast? } for ws-hub.js to send: `ack`
// always goes to the sender only; `broadcast`, when present, goes to every
// connected client (the sender included) — the EFSP Board's guide-mandated
// <200ms remote-change budget (§7.9) needs an immediate broadcast, not the
// existing 500ms tick tracks/collab-store use (see board-store.js's module
// comment; this is docs/adr/0004-immediate-board-broadcast.md).
//
// WP4A (docs/adr/0013) — every message now carries an OPTIONAL `facilityId`
// field, defaulting to facilityConfig.DEFAULT_FACILITY_ID ('INCIRLIK') when
// omitted, routed via ctx.boardStoreFor(facilityId)/positionStoreFor(...)
// rather than the single fixed ctx.boardStore/ctx.positionStore index.js
// built pre-WP4A. This keeps every pre-WP4A message shape (no facilityId
// at all) behaving identically — a deliberate choice over a required
// field, matching facility-config.js's own optional-trailing-param
// back-compat pattern, and minimizing the blast radius on every existing
// test/call site (docs/adr/0013's own back-compat discussion). A client
// acting across both Facilities sends two independent messages (one per
// facilityId) rather than one combined one — Boards remain two.

// The only module this file requires. Every other rule reaches it through
// `ctx`, injected by index.js — but a correlation op targets no Strip and no
// Board, so there is no `rules` object on the path it takes, and threading one
// through purely for a class check would be more indirection than it removes.
const permission = require('./permission');
const readScope = require('./read-scope');

const VERSION = 1;

// board-store.js's own _log ring buffer is pruned back to ~1000 entries
// once it exceeds 2000 (see _pruneLog) — stay comfortably inside that
// before declaring a reconnecting client TOO_OLD and sending a full
// snapshot instead of a delta. Two paths only, per guide §5.6.
const RESYNC_RING_WINDOW = 900;

/**
 * Every Strip record leaving this module — snapshot, delta, ack — is stamped
 * here rather than spread with `{ ...s, facilityId }` at each of the six places
 * one goes out.
 *
 * `facilityId` (WP4A): without it a client's local Map (efsp-state.js, which
 * just Map.set()s whatever record arrives) would end up with delta-derived
 * Strips missing it entirely, breaking every Facility-scoped filter downstream.
 *
 * `nla`: what pressing this Strip's NLA button would do right now, and the
 * reason it would be refused when it would be — see BoardStore.nlaStatusFor.
 * Guide §3.5 rule 2 requires the reason to be RENDERED, not the control merely
 * greyed out, and until now every reason was computed on the press and never
 * left the server: an NLA the server would refuse looked exactly like one it
 * would accept (docs/ui-findings/lane4.md F-408). Computed per Strip for its
 * OWNER, which is the only Position the button is ever offered to (guide §3.5,
 * board-store's NOT_OWNER gate) — Strips are not otherwise scoped per client,
 * so there is nothing per-connection to compute here.
 *
 * Derived at the wire boundary, never stored on the Strip: it is a function of
 * Position occupancy and the clock as much as of the Strip, so persisting it
 * would make the Board snapshot carry a value that is wrong the moment anyone
 * takes or gives up a Position.
 *
 * Every stamp is reported to `ctx.nlaStatusMonitor`, which sweeps for the
 * status changes no message causes — a release time passing, an EDCT window
 * closing. Telling it what went out here is what stops it re-sending a status
 * a Mutation's own ack and broadcast have just carried; see
 * nla-status-monitor.js.
 */
function _stampStrip(boardStore, strip, facilityId, ctx) {
  const nla = boardStore ? boardStore.nlaStatusFor(strip) : null;
  if (ctx && ctx.nlaStatusMonitor) ctx.nlaStatusMonitor.note(strip.stripId, nla);
  return { ...strip, facilityId, nla };
}

/** The FDRs a Mutation changed — the one it addressed, plus any it wrote as a side effect — deduplicated by fdrId, most recent value winning. */
function _mergeFdrs(primary, extra) {
  const byId = new Map();
  for (const fdr of [primary, ...(extra || [])]) if (fdr && fdr.fdrId) byId.set(fdr.fdrId, fdr);
  return [...byId.values()];
}

/**
 * The `strips` section of a board-delta for the Strips a Board event touched
 * (docs/adr/0081): `first` (the addressed Strip, already stamped) leads, then
 * every other touched id, looked up now. DROPPED goes into `gone`, everything
 * else is stamped into `updated` — through _stampStrip, never by hand.
 */
function _touchedStrips(ctx, boardStore, facilityId, touchedIds, first) {
  const updated = [];
  const gone = [];
  const place = (s) => { if (s.state === 'DROPPED') gone.push(s.stripId); else updated.push(s); };
  if (first) place(first);
  for (const id of touchedIds) {
    if (first && id === first.stripId) continue;
    const s = boardStore ? boardStore.getStrip(id) : null;
    if (!s) { gone.push(id); continue; }
    if (s.state === 'DROPPED') gone.push(id);
    else updated.push(_stampStrip(boardStore, s, facilityId, ctx));
  }
  return { updated, gone };
}

/**
 * An efsp-board-delta for one Facility. Every one carries `boardEpoch` beside
 * `boardSeq` (docs/adr/0081): a seq only means something within one Board
 * lifetime, and the epoch names the lifetime.
 */
function _boardDelta(ctx, boardStore, facilityId, strips, fdrs, positions = []) {
  return {
    version: VERSION, type: 'efsp-board-delta',
    boardSeq: boardStore ? boardStore.currentSeq : undefined,
    boardEpoch: boardStore ? boardStore.epoch : undefined,
    facilityId,
    strips,
    fdrs: { updated: fdrs },
    positions: { updated: positions },
  };
}

/**
 * Idempotency for the four non-Board paths (docs/adr/0081, L6's F13). Asked
 * AFTER a path's own session and class gates and BEFORE its store: a refusal
 * made before the store is never cached, so a retry after selecting the
 * Position goes through. A hit is answered with the original outcome and the
 * record as it is now — no store call, no audit line, no persist, no
 * broadcast.
 */
function _cachedOutcome(ctx, kind, msg) {
  return ctx.replayCache ? ctx.replayCache.get(kind, msg.clientMutationId) : null;
}
function _rememberOutcome(ctx, kind, msg, result, id) {
  if (ctx.replayCache) ctx.replayCache.set(kind, msg.clientMutationId, { ok: result.ok, reason: result.reason, detail: result.detail, warning: result.warning, id });
}

/**
 * The flights a MARSA op names in its own body — the participants of a
 * declaration, or the one flight being added or removed. Echoed on the ack so a
 * refusal can be attributed even when it never reached the store and so has no
 * relation to carry back (see _subject below).
 */
function _marsaFdrIds(op) {
  if (!op) return undefined;
  if (Array.isArray(op.participants)) return op.participants.map(String).filter(Boolean);
  if (op.fdrId) return [String(op.fdrId)];
  return undefined;
}

/**
 * WHAT an op was about, echoed from the INBOUND message onto every ack —
 * success and refusal alike.
 *
 * F-103's defect ("a refusal does not say which Strip it was about") survived
 * on the correlation, MARSA and airspace paths. The panel attributes a refused
 * Strip op by recovering its pending Mutation, but those three op families are
 * not registered as pending client-side, so the only subject a refusal can have
 * is whatever the ack carries — and a rejection raised BEFORE the store was
 * consulted (NOT_HOLDING_POSITION, PERMISSION_DENIED, a missing store) carries
 * no record at all. So the reason landed on screen attached to nothing.
 *
 * Echoed rather than looked up, deliberately: a refusal that never reached a
 * store has nothing to look up, and the id the client needs is the id it sent.
 */
function _subject(msg) {
  switch (msg.type) {
    case 'efsp-mutation':             return { stripId: msg.stripId };
    case 'efsp-airspace-mutation':    return { airspaceId: msg.airspaceId };
    case 'efsp-correlation-mutation': return { fdrId: msg.fdrId };
    case 'efsp-marsa-mutation':       return { marsaId: msg.marsaId, fdrIds: _marsaFdrIds(msg.op) };
    case 'efsp-field-state-mutation': return { facilityId: msg.facilityId, runwayId: msg.op && msg.op.runwayId };
    case 'efsp-carrier-mutation':     return { hullId: msg.hullId };
    case 'efsp-sfa-mutation':         return { rackId: msg.op && msg.op.rackId };
    default:                          return {};
  }
}

function handleMessage(ctx, session, msg, persist) {
  switch (msg.type) {
    case 'efsp-mutation':      return _handleMutation(ctx, session, msg, persist);
    case 'efsp-resync':        return _handleResync(ctx, session, msg);
    case 'efsp-set-positions': return _handleSetPositions(ctx, session, msg, persist);
    case 'efsp-airspace-mutation': return _handleAirspaceMutation(ctx, session, msg, persist);
    case 'efsp-correlation-mutation': return _handleCorrelationMutation(ctx, session, msg, persist);
    case 'efsp-marsa-mutation': return _handleMarsaMutation(ctx, session, msg, persist);
    case 'efsp-field-state-mutation': return _handleFieldStateMutation(ctx, session, msg, persist);
    case 'efsp-ato-preview':   return _handleAtoPreview(ctx, session, msg);
    case 'efsp-ato-mutation':  return _handleAtoMutation(ctx, session, msg, persist);
    case 'efsp-carrier-mutation': return _handleCarrierMutation(ctx, session, msg, persist);
    case 'efsp-sfa-mutation':  return _handleSfaMutation(ctx, session, msg, persist);
    default:                   return null; // not an EFSP message
  }
}

function _handleMutation(ctx, session, msg, persist) {
  const facilityId = msg.facilityId || ctx.facilityConfig.DEFAULT_FACILITY_ID;
  const boardStore = ctx.boardStoreFor(facilityId);
  if (!boardStore) {
    return { ack: { version: VERSION, type: 'efsp-mutation-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), ok: false, reason: 'VALIDATION_ERROR', detail: `unknown facilityId: ${msg.facilityId}` }, unaudited: true };
  }
  // `actingPositionId` arrives as an untrusted client claim, and every
  // per-Position authority rule downstream (permission.js's canMutate,
  // board-store's NOT_OWNER check, canActOnState — defects D10/D12/D21) is
  // evaluated against it. Until this check existed, nothing ever tied it to
  // the connecting session: a client could drive any Strip on the Board by
  // naming whichever Position happened to own it, whatever it had actually
  // selected. Bound here, at the wire boundary where the claim enters, so
  // board-store stays a pure function of (mutation, actingPositionId) with
  // no session concept of its own.
  //
  // Primary, not merely held: selecting a Position someone else already has
  // makes you an Observer (§4.8.2 rule 3, D18), and an Observer watches.
  const positionStore = ctx.positionStoreFor(facilityId);
  if (!positionStore || positionStore.primaryOf(msg.actingPositionId) !== session.controllerId) {
    return { ack: { version: VERSION, type: 'efsp-mutation-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), facilityId, ok: false, reason: 'NOT_HOLDING_POSITION', detail: `you are not Primary at ${msg.actingPositionId} — select it before acting on its Strips` }, unaudited: true };
  }

  const mutation = { clientMutationId: msg.clientMutationId, stripId: msg.stripId, baseRev: msg.baseRev, op: msg.op };

  const result = boardStore.applyMutation(mutation, msg.actingPositionId, session.controllerId);
  if (result.ok && !result.replayed) persist();

  // Every Strip record leaving this function — ack or broadcast — goes through
  // the one stamping helper, which is where the reasons for what it adds live.
  const stampedStrip = result.strip ? _stampStrip(boardStore, result.strip, facilityId, ctx) : result.strip;

  // Every FDR this Mutation changed, not just the one it was addressed to. A
  // Strip op can write an FDR as a SIDE EFFECT — accepting a TOFI ENTRY writes
  // the separation regime the MRU controller stated (F-306), and a clearance
  // that voids a MARSA relation, or a flight ending that retires it, writes the
  // regime back to ATC on every participant (F-111's other direction). Those
  // writes landed server-side and reached nobody: the ack carries one `fdr` and
  // the delta carried only that one, so a connected client held the stale value
  // until it next took a full snapshot. board-store.js collects them as
  // `result.fdrs`.
  const updatedFdrs = _mergeFdrs(result.fdr, result.fdrs);

  const ack = {
    version: VERSION, type: 'efsp-mutation-ack', clientMutationId: msg.clientMutationId,
    ..._subject(msg),
    facilityId,
    boardSeq: boardStore.currentSeq, boardEpoch: boardStore.epoch, ok: result.ok,
    strip: stampedStrip, fdr: result.fdr, reason: result.reason, detail: result.detail,
    warning: result.warning, routedTo: result.routedTo,
  };
  // A replay answers from the idempotency cache (docs/adr/0081): the original
  // outcome with the Strip as it is now. Its broadcasts went out the first
  // time, so it sends none — a second one would only repeat a view.
  if (result.replayed) return { ack };

  // One Board event, one broadcast (guide §5.4, docs/adr/0081). The Mutation
  // may have touched Strips it never named — a rebalance re-keys a whole
  // Rack — and every one of them goes out here, or no client hears of it and
  // a later resync from this broadcast's boardSeq cannot heal it either (L6's
  // F1). A refusal normally touched nothing; if one ever did (an exception
  // part-way through an op), what it touched is broadcast rather than dropped.
  const touched = boardStore.drainTouched();
  if (!result.ok) {
    if (touched.length === 0) return { ack };
    return { ack, broadcast: _boardDelta(ctx, boardStore, facilityId, _touchedStrips(ctx, boardStore, facilityId, touched, null), []) };
  }

  const out = {
    ack,
    broadcast: _boardDelta(ctx, boardStore, facilityId, _touchedStrips(ctx, boardStore, facilityId, touched, stampedStrip), updatedFdrs),
  };

  // Bug found in live testing: a coordination primitive's PROPOSE/ACCEPT/
  // REJECT/STAND_BY mutates or mints a Strip in a DIFFERENT Facility's
  // BoardStore (board-store.js's receiveCoordinationProposal/
  // receiveCoordinationResponse — a direct in-process peer-board call, not
  // itself a Mutation dispatched through this function). That side effect
  // was a real, correct change to server state, but nothing ever told any
  // connected client about it — only a full resync (reconnect) would ever
  // pick it up. `peerFacilityId`/`peerStrip` (docs/adr/0022) let this
  // build a SECOND board-delta, scoped to the peer Facility, so a client
  // holding a Position there sees the new/updated replica immediately,
  // same <200ms budget as the primary broadcast (guide §7.9).
  //
  // Built from the peer Board's own drain (docs/adr/0081): placing a replica
  // in a coordination Bay can rebalance that Rack, and those re-keyed Strips
  // are the peer's side of the same Board event. The peer Board is drained
  // only when this broadcast is built, so nothing it touched is discarded.
  if (result.peerStrip) {
    const peerBoardStore = ctx.boardStoreFor(result.peerFacilityId);
    const peerStamped = _stampStrip(peerBoardStore, result.peerStrip, result.peerFacilityId, ctx);
    const peerTouched = peerBoardStore ? peerBoardStore.drainTouched() : [];
    // fdrs: one shared FdrStore (docs/adr/0013) — already covered by the primary broadcast's fdrs.updated
    out.peerBroadcast = _boardDelta(ctx, peerBoardStore, result.peerFacilityId,
      _touchedStrips(ctx, peerBoardStore, result.peerFacilityId, peerTouched, peerStamped), []);
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
    out.marsaBroadcast = _marsaDelta(ctx.marsaStore, marsaChanged);
  }
  // docs/adr/0074 — a carrier hand-over or a Strip retiring moves the Marshal
  // stack (Commence marks a flight pushed, a hand-over to PriFly leaves a
  // vacancy). The record is not a Strip, so it rides its own delta on the same
  // round trip, MARSA's shape.
  if (result.carrierChanged && ctx.carrierStore) {
    out.carrierBroadcast = carrierDelta(ctx.carrierStore);
    // A push re-numbers nothing but changes which lane the next flight feeds.
    if (ctx.nlaStatusMonitor) ctx.nlaStatusMonitor.tick();
  }
  return out;
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
  return { ack: _asResyncReply(ack) };
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
    ack: _boardDelta(ctx, boardStore, facilityId,
      {
        updated: live.map(s => _stampStrip(boardStore, s, facilityId, ctx)),
        // DROPPED Strips still on the Board, then ids no longer on it at all
        // (retention's archive, L24). Disjoint by construction.
        gone: [...dropped, ...delta.gone],
      },
      // FDRs/Positions are cheap enough at this scale to always send in
      // full rather than building a second/third ring buffer — see
      // board-store.js's module comment. fdrStore is shared across every
      // Facility (docs/adr/0013), so this list is NOT facility-scoped —
      // it's the same full set a snapshot would carry.
      ctx.fdrStore.getAll(),
      positionStore.getAll().map(p => ({ ...p, facilityId }))),
  };
}

/**
 * Whether a delta from `lastSeq` would leave this client right. Three ways it
 * cannot, each found the hard way.
 *
 * A different Board LIFETIME (docs/adr/0081, L6's F2). `_seq` and the ring are
 * per process, so after a restart a client's seq names a point in a Board that
 * no longer exists. Once the new lifetime's seq overtakes it, the window and
 * `rewound` checks below both pass and a delta from the wrong ring is served
 * as if continuous: Strips dropped before the restart stay on screen, Strips
 * created are missed. Only the epoch the client last saw can tell. A client
 * that sends none (the shipped client never resyncs, briefing §3.10) gets the
 * snapshot, which is always safe.
 *
 * The client too far BEHIND: `currentSeq - lastSeq > WINDOW` — it missed more
 * than the ring holds, so replaying from there would skip changes.
 *
 * The server having gone BACKWARDS: `lastSeq > currentSeq`. It restarted with
 * no snapshot, or was restored from an older one. The subtraction then went
 * NEGATIVE and sailed through the window check — the server replayed a delta
 * from an empty ring and told a client holding a whole Board of Strips that
 * nothing had changed. Found by clearing the local Board during development
 * and watching a Strip survive it. The epoch now covers this case too; the
 * check stays because it is cheap and still true.
 */
function _deltaCanServe(boardStore, boardEpoch, lastSeq) {
  if (boardEpoch !== boardStore.epoch) return false;
  if (lastSeq < 0) return false;
  if (lastSeq > boardStore.currentSeq) return false; // rewound
  return boardStore.currentSeq - lastSeq <= RESYNC_RING_WINDOW;
}

/**
 * Airspace ops (schedule/request/approve/release/return) — a SEPARATE
 * dispatch path from _handleMutation, because they target an airspace rather
 * than a Strip. `applyMutation` is built on mutation.stripId, the Strip's
 * baseRev and the Strip-owner check, none of which mean anything for a
 * record that no Position owns and no Board holds.
 *
 * Guide §4.1 rule 2: the `RANGE` Position "works no Strips. It owns airspace
 * state". This is the wire surface for that.
 */
function _handleAirspaceMutation(ctx, session, msg, persist) {
  const airspaceStore = ctx.airspaceStore;
  if (!airspaceStore) {
    return { ack: { version: VERSION, type: 'efsp-airspace-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), ok: false, reason: 'VALIDATION_ERROR', detail: 'no airspace store' }, unaudited: true };
  }

  // The same session binding _handleMutation carries (docs/adr/0029), for the
  // same reason: actingPositionId arrives as an untrusted client claim, and
  // the airspace store's whole authority model — who may approve activation,
  // who may release — is evaluated against it. A new dispatch path is exactly
  // where that check gets forgotten and the hole reopens.
  //
  // Which Facility's PositionStore to ask is the airspace's own controlling
  // Facility, or RANGES for the using side; checking both covers a controller
  // holding either end without letting them claim a Position they don't hold.
  const facilityIds = ctx.facilityConfig.getFacilityIds();
  const isPrimarySomewhere = facilityIds.some((facilityId) => {
    const positionStore = ctx.positionStoreFor(facilityId);
    return positionStore && positionStore.primaryOf(msg.actingPositionId) === session.controllerId;
  });
  if (!isPrimarySomewhere) {
    return { ack: { version: VERSION, type: 'efsp-airspace-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), ok: false, reason: 'NOT_HOLDING_POSITION', detail: `you are not Primary at ${msg.actingPositionId} — select it before acting on airspace` }, unaudited: true };
  }

  const cached = _cachedOutcome(ctx, 'airspace', msg);
  if (cached) {
    return { ack: {
      version: VERSION, type: 'efsp-airspace-ack', clientMutationId: msg.clientMutationId, ..._subject(msg),
      ok: cached.ok, airspace: airspaceStore.getAirspace(cached.id), reason: cached.reason, detail: cached.detail,
      warning: cached.warning, airspaceSeq: airspaceStore.currentSeq,
    } };
  }

  const result = airspaceStore.apply(
    { clientMutationId: msg.clientMutationId, airspaceId: msg.airspaceId, baseRev: msg.baseRev, op: msg.op },
    msg.actingPositionId, session.controllerId,
  );
  _rememberOutcome(ctx, 'airspace', msg, result, msg.airspaceId);
  if (result.ok) persist();

  const ack = {
    version: VERSION, type: 'efsp-airspace-ack', clientMutationId: msg.clientMutationId,
    ..._subject(msg),
    ok: result.ok, airspace: result.airspace, reason: result.reason, detail: result.detail,
    warning: result.warning, occupied: result.occupied,
    airspaceSeq: airspaceStore.currentSeq,
  };
  if (!result.ok) return { ack };

  // Broadcast to everyone, not just the two parties: an airspace going active
  // changes what every controller in the theater is looking at, and the
  // client filters by what it holds rather than the server pre-filtering
  // (matching every other EFSP broadcast).
  return {
    ack,
    broadcast: {
      version: VERSION, type: 'efsp-airspace-delta',
      airspaceSeq: airspaceStore.currentSeq,
      airspaces: { updated: [result.airspace] },
    },
  };
}

/**
 * Correlation ops (BindTrack/UnbindTrack) — a THIRD dispatch path, for the
 * same reason _handleAirspaceMutation is a second one: this targets an FDR.
 * There is no stripId, no Strip baseRev and no Strip-owner check, because no
 * Position owns an FDR.
 *
 * Guide §6.6 rule 1's top rung is "explicit controller binding", and this is
 * its wire surface. It is the way out of every ambiguity the sweep reports,
 * and the only way to correlate an aircraft with its transponder off and a
 * callsign nothing matches.
 */
function _handleCorrelationMutation(ctx, session, msg, persist) {
  const correlationStore = ctx.correlationStore;
  if (!correlationStore) {
    return { ack: { version: VERSION, type: 'efsp-correlation-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), ok: false, reason: 'VALIDATION_ERROR', detail: 'no correlation store' }, unaudited: true };
  }

  // The same session binding the other two dispatch paths carry
  // (docs/adr/0029), for the same reason: actingPositionId arrives as an
  // untrusted client claim. This is now the THIRD place that check appears,
  // and a new dispatch path is exactly where it gets forgotten and the hole
  // reopens — _handleAirspaceMutation's own comment says so, and it was right
  // twice.
  //
  // "Primary somewhere" is the right gate here rather than at a particular
  // Facility: no Position owns an FDR, and a correlation is not a clearance.
  // Any Primary may bind, whichever Facility holds a Strip for that flight —
  // the FDR is already shared theater-wide (docs/adr/0013), and refusing would
  // mean a controller who can see the contact cannot tell the system what they
  // see. The binding records boundBy/boundPositionId, so the audit says who.
  const facilityIds = ctx.facilityConfig.getFacilityIds();
  const isPrimarySomewhere = facilityIds.some((facilityId) => {
    const positionStore = ctx.positionStoreFor(facilityId);
    return positionStore && positionStore.primaryOf(msg.actingPositionId) === session.controllerId;
  });
  if (!isPrimarySomewhere) {
    return { ack: { version: VERSION, type: 'efsp-correlation-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), ok: false, reason: 'NOT_HOLDING_POSITION', detail: `you are not Primary at ${msg.actingPositionId} — select it before binding a contact` }, unaudited: true };
  }

  // Refused by class, not by table: a range Position is the using agency, has
  // no flights to identify (§4.1 rule 2) and, under docs/adr/0042, no scope on
  // which to have seen anything.
  if (!permission.canCorrelate(msg.actingPositionId)) {
    return { ack: { version: VERSION, type: 'efsp-correlation-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), ok: false, reason: 'PERMISSION_DENIED', detail: `${msg.actingPositionId} works no flights, so it identifies no contacts` }, unaudited: true };
  }

  const cached = _cachedOutcome(ctx, 'correlation', msg);
  if (cached) {
    return { ack: {
      version: VERSION, type: 'efsp-correlation-ack', clientMutationId: msg.clientMutationId, ..._subject(msg),
      ok: cached.ok, correlation: correlationStore.getCorrelation(cached.id), reason: cached.reason, detail: cached.detail,
      correlationSeq: correlationStore.currentSeq,
    } };
  }

  const result = correlationStore.apply(
    { clientMutationId: msg.clientMutationId, fdrId: msg.fdrId, baseRev: msg.baseRev, op: msg.op },
    msg.actingPositionId, session.controllerId,
  );
  _rememberOutcome(ctx, 'correlation', msg, result, msg.fdrId);
  if (result.ok) persist();

  const ack = {
    version: VERSION, type: 'efsp-correlation-ack', clientMutationId: msg.clientMutationId,
    ..._subject(msg),
    ok: result.ok, correlation: result.correlation, reason: result.reason, detail: result.detail,
    correlationSeq: correlationStore.currentSeq,
  };
  if (!result.ok) return { ack };

  // Its own delta type with its own seq, like efsp-airspace-delta and
  // deliberately NOT a section of efsp-board-delta: a correlation is not a
  // Strip and rides no Board's sequence.
  return {
    ack,
    broadcast: {
      version: VERSION, type: 'efsp-correlation-delta',
      correlationSeq: correlationStore.currentSeq,
      correlations: { updated: [result.correlation] },
    },
  };
}

/**
 * MARSA ops (§9.2) — a FOURTH dispatch path, for the same reason the airspace
 * and correlation paths exist: this targets a relation BETWEEN flights. There
 * is no stripId, no Strip baseRev and no Strip-owner check, because no Position
 * owns a relation and none of its participants' Strips is privileged over the
 * others.
 */
function _handleMarsaMutation(ctx, session, msg, persist) {
  const marsaStore = ctx.marsaStore;
  if (!marsaStore) {
    return { ack: { version: VERSION, type: 'efsp-marsa-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), ok: false, reason: 'VALIDATION_ERROR', detail: 'no MARSA store' }, unaudited: true };
  }

  // The same session binding the other three dispatch paths carry
  // (docs/adr/0029). This is now the FOURTH place the check appears, and
  // _handleAirspaceMutation's comment — "a new dispatch path is exactly where
  // that check gets forgotten and the hole reopens" — has now been right three
  // times. actingPositionId is an untrusted client claim.
  //
  // "Primary somewhere" rather than at a particular Facility, matching
  // correlation and for a stronger version of its reason: a relation's
  // participants may be worked by different Facilities at once (a tanker at
  // CENTER, a receiver at INCIRLIK), so there is no single Facility whose
  // PositionStore could be the right one to ask. The relation records
  // declaredBy/declaredPositionId, so the audit still says who.
  const facilityIds = ctx.facilityConfig.getFacilityIds();
  const isPrimarySomewhere = facilityIds.some((facilityId) => {
    const positionStore = ctx.positionStoreFor(facilityId);
    return positionStore && positionStore.primaryOf(msg.actingPositionId) === session.controllerId;
  });
  if (!isPrimarySomewhere) {
    return { ack: { version: VERSION, type: 'efsp-marsa-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), ok: false, reason: 'NOT_HOLDING_POSITION', detail: `you are not Primary at ${msg.actingPositionId} — select it before acting on a MARSA relation` }, unaudited: true };
  }

  // Refused by class, not by table — a range Position is the using agency and
  // works no Strips (§4.1 rule 2), so it has no flights to put into a relation.
  if (!permission.canDeclareMarsa(msg.actingPositionId)) {
    return { ack: { version: VERSION, type: 'efsp-marsa-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), ok: false, reason: 'PERMISSION_DENIED', detail: `${msg.actingPositionId} works no flights, so it declares no MARSA` }, unaudited: true };
  }

  // DeclareMarsa is the case that matters: a retried declaration minted a
  // second relation.
  const cached = _cachedOutcome(ctx, 'marsa', msg);
  if (cached) {
    return { ack: {
      version: VERSION, type: 'efsp-marsa-ack', clientMutationId: msg.clientMutationId, ..._subject(msg),
      ok: cached.ok, marsa: cached.id ? marsaStore.getRelation(cached.id) : undefined, reason: cached.reason, detail: cached.detail,
      marsaSeq: marsaStore.currentSeq,
    } };
  }

  const result = marsaStore.apply(
    { clientMutationId: msg.clientMutationId, marsaId: msg.marsaId, baseRev: msg.baseRev, op: msg.op },
    msg.actingPositionId, session.controllerId,
  );
  _rememberOutcome(ctx, 'marsa', msg, result, result.relation ? result.relation.marsaId : (msg.marsaId || null));
  if (result.ok) persist();

  const ack = {
    version: VERSION, type: 'efsp-marsa-ack', clientMutationId: msg.clientMutationId,
    ..._subject(msg),
    ok: result.ok, marsa: result.relation, reason: result.reason, detail: result.detail,
    marsaSeq: marsaStore.currentSeq,
  };
  if (!result.ok) return { ack };

  // Broadcast to everyone rather than to the participants' owners, matching
  // every other EFSP broadcast: the client filters by what it holds. §9.2 rule
  // 5 requires the relation to render on EVERY participant Strip, and those
  // Strips can sit in different Facilities in front of different controllers —
  // pre-filtering server-side would mean working out that set here, twice
  // (once for the relation, once for its replicas), to save nothing.
  const out = { ack, marsaBroadcast: _marsaDelta(marsaStore, [result.relation]) };

  // Declaring writes `tofi.separationRegime` = MARSA on every participant, and
  // ending, voiding or leaving a relation writes ATC back. Those are FDR
  // writes, and an FDR rides an efsp-board-delta — the marsa-delta above
  // carries the RELATION and nothing else. So SEP REG stayed blank on every
  // already-connected page and only a reconnect ever showed the truth: guide
  // §4.8.3's "they inherit a lie", in the direction it warns about
  // (docs/ui-findings/lane1.md F-111). marsa-store.js journals the writes; this
  // is where they reach the wire.
  //
  // A board-delta with no Strips in it, because none changed. It is stamped
  // with the default Facility's own boardSeq, unchanged for the same reason —
  // fdrs are shared theater-wide (docs/adr/0013) and are not Facility-scoped,
  // so there is no per-Facility delta to send N of.
  const regimeFdrs = result.fdrs || [];
  if (regimeFdrs.length > 0) {
    const facilityId = ctx.facilityConfig.DEFAULT_FACILITY_ID;
    const boardStore = ctx.boardStoreFor(facilityId);
    out.broadcast = _boardDelta(ctx, boardStore, facilityId, { updated: [], gone: [] }, regimeFdrs);
  }
  return out;
}

/**
 * Carrier ops (docs/adr/0074; guide §9.12): the recovery Case, the Marshal
 * stack and the altimeter. A SEVENTH dispatch path, for the reason the MARSA one
 * exists: the record targets a SHIP, not a Strip, so there is no stripId, no
 * Strip baseRev and no Strip-owner check. Authority is permission.js's
 * one-parameter predicates inside the store (PriFly owns the Case, the Marshal
 * the stack), plus the session binding every dispatch path carries
 * (docs/adr/0029): the session must be PRIMARY at the acting Position, at the
 * CARRIER Facility, since a hull has exactly one Facility.
 */
function _handleCarrierMutation(ctx, session, msg, persist) {
  const store = ctx.carrierStore;
  const nack = (reason, detail) => ({ ack: { version: VERSION, type: 'efsp-carrier-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), ok: false, reason, detail } });
  if (!store) return nack('VALIDATION_ERROR', 'no carrier store');
  const positionStore = ctx.positionStoreFor('CARRIER');
  if (!positionStore || positionStore.primaryOf(msg.actingPositionId) !== session.controllerId) {
    return nack('NOT_HOLDING_POSITION', `you are not Primary at ${msg.actingPositionId} — select it before acting on the carrier`);
  }
  const cached = _cachedOutcome(ctx, 'carrier', msg);
  if (cached) {
    return { ack: { version: VERSION, type: 'efsp-carrier-ack', clientMutationId: msg.clientMutationId, ..._subject(msg),
      ok: cached.ok, carrier: store.view(msg.hullId || undefined), reason: cached.reason, detail: cached.detail, carrierSeq: store.currentSeq } };
  }
  const result = store.apply({ clientMutationId: msg.clientMutationId, hullId: msg.hullId, baseRev: msg.baseRev, op: msg.op }, msg.actingPositionId, session.controllerId);
  _rememberOutcome(ctx, 'carrier', msg, result, msg.hullId || null);
  if (result.ok) persist();
  const ack = {
    version: VERSION, type: 'efsp-carrier-ack', clientMutationId: msg.clientMutationId, ..._subject(msg),
    ok: result.ok, carrier: store.view(msg.hullId || undefined), reason: result.reason, detail: result.detail,
    changed: result.ok ? result.changed : undefined, carrierSeq: store.currentSeq,
  };
  if (!result.ok) return { ack };
  // The Case and the stack decide every carrier Strip's NLA (Commence or To
  // pattern, and which lane): re-state the ones whose status moved, as
  // the sweep does for a clock-driven change (nla-status-monitor.js).
  if (ctx.nlaStatusMonitor) ctx.nlaStatusMonitor.tick();
  // One delta carrying the whole hull record: a Case change reaches every
  // client as ONE message and each re-renders every carrier Strip from it
  // (WP7A bullet 3, "at once").
  return { ack, carrierBroadcast: carrierDelta(store) };
}

/**
 * The SFA rotation record (guide §4.7, docs/adr/0075, 0093): which Position is on
 * which frequency. An EIGHTH dispatch path for the carrier's reason: the record
 * is about the approach, not a Strip, so there is no stripId and no Strip-owner
 * check. Authority is permission.js's capability table narrowed by config's
 * jurisdiction, inside the store, plus the session binding every dispatch path
 * carries (docs/adr/0029): Primary at the acting Position, at its Facility.
 * One delta carrying the whole record, ADR 0064 B6's shape.
 */
function _handleSfaMutation(ctx, session, msg, persist) {
  const store = ctx.sfaStore;
  const nack = (reason, detail) => ({ ack: { version: VERSION, type: 'efsp-sfa-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), ok: false, reason, detail } });
  if (!store) return nack('VALIDATION_ERROR', 'no SFA in this crc-sync');
  const facilityId = ctx.facilityConfig.DEFAULT_FACILITY_ID;
  const positionStore = ctx.positionStoreFor(facilityId);
  if (!positionStore || positionStore.primaryOf(msg.actingPositionId) !== session.controllerId) {
    return nack('NOT_HOLDING_POSITION', `you are not Primary at ${msg.actingPositionId} — select it before rotating the SFA frequencies`);
  }
  const cached = _cachedOutcome(ctx, 'sfa', msg);
  if (cached) {
    return { ack: { version: VERSION, type: 'efsp-sfa-ack', clientMutationId: msg.clientMutationId, ..._subject(msg),
      ok: cached.ok, sfaRotation: store.view(), reason: cached.reason, detail: cached.detail, sfaSeq: store.currentSeq } };
  }
  const result = store.apply({ clientMutationId: msg.clientMutationId, baseRev: msg.baseRev, op: msg.op }, msg.actingPositionId, session.controllerId);
  _rememberOutcome(ctx, 'sfa', msg, result, null);
  if (result.ok && result.changed) persist();
  const ack = {
    version: VERSION, type: 'efsp-sfa-ack', clientMutationId: msg.clientMutationId, ..._subject(msg),
    ok: result.ok, sfaRotation: store.view(), reason: result.reason, detail: result.detail, sfaSeq: store.currentSeq,
  };
  if (!result.ok || !result.changed) return { ack };
  return { ack, sfaBroadcast: sfaDelta(store) };
}

/** The whole rotation record, sent whole: small. Its own delta type and seq, like efsp-carrier-delta. */
function sfaDelta(sfaStore) {
  return { version: VERSION, type: 'efsp-sfa-delta', sfaSeq: sfaStore.currentSeq, sfaRotation: sfaStore.view() };
}

/** The whole hull view(s), sent whole: small, and the derived stack comes from the server so the client never reimplements it. */
function carrierDelta(carrierStore) {
  return { version: VERSION, type: 'efsp-carrier-delta', carrierSeq: carrierStore.currentSeq, carriers: { updated: carrierStore.getAll() } };
}

/** Its own delta type with its own seq, like efsp-airspace-delta and efsp-correlation-delta — a relation is not a Strip and rides no Board's sequence. */
function _marsaDelta(marsaStore, relations) {
  return {
    version: VERSION, type: 'efsp-marsa-delta',
    marsaSeq: marsaStore.currentSeq,
    marsa: { updated: relations.filter(Boolean) },
  };
}

function facilityConfig_positionIds(ctx, facilityId) { return ctx.facilityConfig.getPositionSet(facilityId); }

function _handleSetPositions(ctx, session, msg, persist) {
  const facilityId = msg.facilityId || ctx.facilityConfig.DEFAULT_FACILITY_ID;
  const positionStore = ctx.positionStoreFor(facilityId);
  const boardStore = ctx.boardStoreFor(facilityId);
  if (!positionStore || !boardStore) {
    return { ack: { version: VERSION, type: 'efsp-positions-ack', facilityId, held: [], warnings: [], reason: 'VALIDATION_ERROR', detail: `unknown facilityId: ${facilityId}` } };
  }
  const held = Array.isArray(msg.held) ? msg.held : [];
  const occupiedBefore = new Set(facilityConfig_positionIds(ctx, facilityId).filter(id => positionStore.isOccupied(id)));
  const { held: actuallyHeld, vacated } = positionStore.setHeldPositions(session.controllerId, session.who, held);

  const warnings = [];
  const reassignedIds = [];
  // F10: a Position that was empty and now has a Primary gets back the Strips
  // that were routed away from it (docs/adr/0080).
  for (const positionId of actuallyHeld) {
    if (!occupiedBefore.has(positionId) && positionStore.isOccupied(positionId)) {
      reassignedIds.push(...boardStore.returnCoveredStrips(positionId));
    }
  }
  for (const positionId of vacated) {
    if (positionStore.isOccupied(positionId)) continue; // another controller is now Primary — nothing to route
    const owned = boardStore.getAll().filter(s => s.ownerPositionId === positionId && s.state !== 'DROPPED');
    if (owned.length === 0) continue;

    const covering = positionStore.coveringPositionFor(positionId);
    if (covering) {
      const moved = boardStore.reassignPositionStrips(positionId, covering);
      reassignedIds.push(...moved);
      const warning = { positionId, count: owned.length, routedTo: covering };
      if (moved.unplaced && moved.unplaced.length) warning.unplaced = moved.unplaced.length; // no Bay of the covering Position fits: they stay where they were
      warnings.push(warning);
    } else {
      // Defect D19 boundary: the covering chain bottomed out with nobody
      // occupying any link. MUST be a visible, distinct condition — never
      // a Strip silently left owned by an unoccupied Position with no
      // signal to anyone (guide §4.8.6 rule 3).
      warnings.push({ positionId, count: owned.length, routedTo: null });
    }
  }

  // The re-send below carries every live Strip, so whatever
  // reassignPositionStrips touched is already in it. Drained so those touches
  // do not ride again on the next Mutation's broadcast (docs/adr/0081).
  boardStore.drainTouched();
  // A covering-chain reassignment changes the Board, and it used to be the one
  // Board change never persisted: a restart before the next Mutation restored
  // the Strips to the Position that had left (docs/adr/0081, L6's F2/F5 tail).
  if (reassignedIds.length > 0 && typeof persist === 'function') persist();

  return {
    ack: { version: VERSION, type: 'efsp-positions-ack', facilityId, held: actuallyHeld, warnings },
    // EVERY live Strip, not just the reassigned ones. Taking or giving up a
    // Position changes who is there to receive a transfer, which changes the
    // `nla` status _stampStrip computes for Strips this message never
    // touched — a TWR Strip at DEPARTED becomes "no receiving Position
    // present" the instant APP is released, and F-408's whole point is that
    // the panel be told BEFORE the press. The Board is a few dozen Strips
    // (board-store.js's module comment) and a Position change is a rare,
    // deliberate act, so re-sending the set is cheaper than tracking which
    // Strips' status actually moved.
    broadcast: _boardDelta(ctx, boardStore, facilityId,
      { updated: boardStore.getAll().filter(s => s.state !== 'DROPPED').map(s => _stampStrip(boardStore, s, facilityId, ctx)), gone: [] },
      [], positionStore.getAll().map(p => ({ ...p, facilityId }))),
  };
}

// ── The read scope (docs/adr/0080) ───────────────────────────────────────────

/**
 * What `session` is sent of the flights, from what it holds NOW at every
 * Facility (nothing is cached, so nothing goes stale). A pure function of the
 * PositionStores and permission.js's capability table.
 */
function readScopeOf(ctx, session) {
  if (!session || !session.controllerId) return { kind: readScope.ALL };
  const held = [];
  for (const facilityId of ctx.facilityConfig.getFacilityIds()) {
    const positionStore = ctx.positionStoreFor(facilityId);
    if (!positionStore) continue;
    for (const positionId of positionStore.heldBy(session.controllerId)) held.push({ facilityId, positionId });
  }
  return readScope.scopeOf(held, permission.readScopeFor);
}

/** Every live Strip on every Board, stamped with its Facility (what the visibility sets are computed from). */
function _liveStamped(ctx) {
  const out = [];
  for (const facilityId of ctx.facilityConfig.getFacilityIds()) {
    const boardStore = ctx.boardStoreFor(facilityId);
    if (!boardStore) continue;
    for (const s of boardStore.getAll()) if (s.state !== 'DROPPED') out.push({ ...s, facilityId });
  }
  return out;
}

/**
 * The message this session is to be sent for `msg`: the SAME object for a
 * session that reads everything (the fast path), a filtered copy for one that
 * reads only what it owns, or null when nothing is left to send.
 */
function filterForSession(ctx, session, msg) {
  if (!msg) return msg;
  const scope = readScopeOf(ctx, session);
  if (scope.kind === readScope.ALL) return msg;
  switch (msg.type) {
    case 'efsp-snapshot':
      return readScope.filterSnapshot(msg, scope);
    case 'efsp-board-delta':
      return readScope.filterBoardDelta(msg, scope, readScope.visibleFdrIdsOf(scope, _liveStamped(ctx)), (id) => ctx.fdrStore.getFdr(id));
    case 'efsp-correlation-delta':
      return readScope.filterCorrelationDelta(msg, scope, readScope.visibleFdrIdsOf(scope, _liveStamped(ctx)));
    case 'efsp-marsa-delta':
      return readScope.filterMarsaDelta(msg, scope, readScope.visibleFdrIdsOf(scope, _liveStamped(ctx)));
    case 'efsp-alerts': {
      const live = _liveStamped(ctx);
      const byKey = new Map(live.map(s => [`${s.facilityId}:${s.stripId}`, s]));
      return readScope.filterAlerts(msg, scope, readScope.visibleFdrIdsOf(scope, live),
        (facilityId, stripId) => readScope.isStripVisible(scope, byKey.get(`${facilityId}:${stripId}`)));
    }
    default:
      return msg;
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
  const fdrIds = new Set(((filtered.strips || {}).updated || []).map(s => s.fdrId).filter(Boolean));
  if (fdrIds.size === 0) return [];
  const out = [];
  const records = ctx.correlationStore ? [...fdrIds].map(id => ctx.correlationStore.getCorrelation(id)).filter(Boolean) : [];
  if (records.length) out.push({ version: VERSION, type: 'efsp-correlation-delta', correlations: { updated: records } });
  const relations = ctx.marsaStore ? ctx.marsaStore.getAll().filter(r => (r.participants || []).some(id => fdrIds.has(id))) : [];
  if (relations.length) out.push(_marsaDelta(ctx.marsaStore, relations));
  return out;
}

/** Changes exactly when what `session` may see of the flights changes. */
function readScopeKey(ctx, session) { return readScope.scopeKey(readScopeOf(ctx, session)); }

/**
 * WP4A: sends every Facility's strips/positions/bays in one message (each
 * record stamped with `facilityId`), since a client can now hold Positions
 * and act across both. `boardSeq`/`facility` stay as top-level back-compat
 * aliases for INCIRLIK specifically — `boardSeqByFacility`/`facilities` are
 * the real, general shape.
 */
function _snapshotMessage(ctx, session = null) {
  const full = _fullSnapshotMessage(ctx);
  return session ? readScope.filterSnapshot(full, readScopeOf(ctx, session)) : full;
}

function _fullSnapshotMessage(ctx) {
  const { fdrStore, facilityConfig } = ctx;
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
  // against the server-side check in board-store.js's
  // _applyCoordinationPropose) when no written directive is on file.
  const aitAuthorizedByFacility = {};

  for (const facilityId of facilityIds) {
    const boardStore = ctx.boardStoreFor(facilityId);
    const positionStore = ctx.positionStoreFor(facilityId);
    boardSeqByFacility[facilityId] = boardStore.currentSeq;
    boardEpochByFacility[facilityId] = boardStore.epoch;
    aitAuthorizedByFacility[facilityId] = !!facilityConfig.getFacilityConfig(facilityId).aitAuthorized;
    for (const s of boardStore.getAll().filter(s => s.state !== 'DROPPED')) strips.push(_stampStrip(boardStore, s, facilityId, ctx));
    for (const p of positionStore.getAll()) positions.push({ ...p, facilityId });
    bays.push(...facilityConfig.getAllBays(facilityId));
  }

  const defaultFacilityId = facilityConfig.DEFAULT_FACILITY_ID;
  return {
    version: VERSION, type: 'efsp-snapshot',
    boardSeq: boardSeqByFacility[defaultFacilityId], // back-compat alias
    facility: facilityConfig.getFacilityConfig(defaultFacilityId).facility, // back-compat alias
    facilities: facilityIds,
    boardSeqByFacility,
    boardEpochByFacility,
    aitAuthorizedByFacility,
    // The character each Position's owned contacts carry on an ATC scope
    // (docs/adr/0088). Config, so it rides the snapshot only.
    positionLetters: facilityConfig.allPositionLetters ? facilityConfig.allPositionLetters() : {},
    positions, bays, strips,
    fdrs: fdrStore.getAll(),
    // The airspace board (guide §4.2 — "not a strip rack"), sent whole: the
    // list is small, static in size, and every controller's board shows the
    // same theater-wide set.
    airspaces: ctx.airspaceStore ? ctx.airspaceStore.getAll() : [],
    // Correlation records, one per live FDR and sent whole for the same reason
    // fdrs are: cheap enough at this scale that a second ring buffer would
    // cost more than it saved (_handleResync's own stated reasoning). There is
    // deliberately no correlation branch in efsp-resync either — a reconnecting
    // client gets these in its snapshot and a fresh reconcile delta within a
    // second, so §5.6's "two paths only" holds.
    correlations: ctx.correlationStore ? ctx.correlationStore.getAll() : [],
    // MARSA relations (§9.2), sent whole for the same reason correlations are.
    // Finished ones ride along too: §9.2 rule 5 puts the relation on every
    // participant Strip, and a relation that was VOIDED by the interlock is
    // precisely the one a reconnecting controller most needs to see — dropping
    // it on reconnect would make the alert the rule requires disappear for the
    // one person who just missed it. No efsp-resync branch either, matching
    // correlation and airspace, so §5.6's "two paths only" holds.
    marsa: ctx.marsaStore ? ctx.marsaStore.getAll() : [],
    // Field state (§9.7, docs/adr/0061), one record per Facility with runways,
    // sent whole. No efsp-resync branch, matching airspace, correlation and
    // MARSA: a reconnecting controller gets the current runway status here —
    // which is the point of rule 5's own sequence (a reconnect after a
    // suspension must not show an OPEN runway).
    fieldStates: ctx.fieldStateStore ? ctx.fieldStateStore.getAll() : [],
    // The carrier's hull record(s) with the derived stack and the banner
    // (docs/adr/0074), sent whole; no efsp-resync branch, as for MARSA.
    carriers: ctx.carrierStore ? ctx.carrierStore.getAll() : [],
    // Who is on which SFA frequency (docs/adr/0075, 0093), sent whole; null where
    // this crc-sync has no SFA. No efsp-resync branch, as for the carrier.
    sfaRotation: ctx.sfaStore ? ctx.sfaStore.view() : null,
  };
}

/**
 * Field state (guide §9.7, docs/adr/0061) — its own dispatch path, since a
 * runway is not a Strip and rides no Board's sequence.
 *
 * The session binding (docs/adr/0029) is PER FACILITY, copied from
 * _handleMutation — this is the fifth dispatch path to carry it, and the one
 * where "Primary somewhere" (airspace, correlation, MARSA) would be wrong: a
 * field has exactly one Facility, and OPS at INCIRLIK must not suspend a runway
 * anywhere else.
 *
 * A refusal made here, before the store (no store, NOT_HOLDING_POSITION), is
 * marked `unaudited` so the metrics tap writes it (docs/adr/0083); the store
 * audits from its door onward (decisions.md S-R2-5).
 */
function _handleFieldStateMutation(ctx, session, msg, persist) {
  const store = ctx.fieldStateStore;
  const facilityId = msg.facilityId || ctx.facilityConfig.DEFAULT_FACILITY_ID;
  const op = msg.op && typeof msg.op === 'object' ? msg.op : {};
  const refuse = (reason, detail) => ({
    ack: {
      version: VERSION, type: 'efsp-field-state-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), facilityId,
      ok: false, reason, detail, fieldState: store ? store.getFieldState(facilityId) : null,
      fieldStateSeq: store ? store.currentSeq : undefined,
    },
    // Both refusals made here come before the store: the tap logs them (docs/adr/0083).
    unaudited: true,
  });
  if (!store) return refuse('VALIDATION_ERROR', 'no field-state store');

  const positionStore = ctx.positionStoreFor(facilityId);
  if (!positionStore || positionStore.primaryOf(msg.actingPositionId) !== session.controllerId) {
    return refuse('NOT_HOLDING_POSITION', `you are not Primary at ${msg.actingPositionId} at ${facilityId} — select it before acting on the field`);
  }

  const cached = _cachedOutcome(ctx, 'fieldState', msg);
  if (cached) {
    return { ack: {
      version: VERSION, type: 'efsp-field-state-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), facilityId,
      ok: cached.ok, fieldState: store.getFieldState(cached.id), reason: cached.reason, detail: cached.detail,
      fieldStateSeq: store.currentSeq,
    } };
  }

  // The permission table (and every refusal) is checked inside apply(), so a
  // PERMISSION_DENIED is audited like any other outcome.
  const result = store.apply(
    { clientMutationId: msg.clientMutationId, facilityId, baseRev: msg.baseRev, op },
    msg.actingPositionId, session.controllerId,
  );
  _rememberOutcome(ctx, 'fieldState', msg, result, facilityId);
  if (result.ok) {
    persist();
    // A runway's status moves the `nla` stamp of Strips this op never touched
    // — every Strip queued for, or landing on, that runway — the same problem
    // _handleSetPositions has. The monitor re-stamps only the Strips whose
    // status actually changed and sends them on the ordinary board-delta
    // (server.js wires its onDelta), so "the reason shown" reaches every
    // controller now rather than on the next 15 s sweep.
    if (ctx.nlaStatusMonitor) ctx.nlaStatusMonitor.tick();
  }

  const ack = {
    version: VERSION, type: 'efsp-field-state-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), facilityId,
    ok: result.ok, fieldState: result.fieldState, reason: result.reason, detail: result.detail,
    fieldStateSeq: store.currentSeq,
  };
  if (!result.ok) return { ack };
  return { ack, broadcast: _fieldStateDelta(store, [result.fieldState]) };
}

/** Its own delta type with its own seq (rule 5's deliberate deviation, docs/adr/0061). */
function _fieldStateDelta(store, records) {
  return {
    version: VERSION, type: 'efsp-field-state-delta',
    fieldStateSeq: store.currentSeq,
    fieldStates: { updated: records.filter(Boolean) },
  };
}

// ── WP7: the ATO import (docs/adr/0071, guide §9.8/§9.9) ─────────────────────
//
// Two message types. `efsp-ato-preview` is read-only — never logged, and not
// named `…-mutation`, so L5's metrics tap does not count it. `efsp-ato-mutation`
// imports: the server RE-PARSES the text (it never trusts a client's parse, a
// seed or a code), checks the text is the one previewed, validates the
// controller's choices against its own re-parse, and then creates each mission
// line through the EXISTING CreateStrip path (docs/adr/0054), one derived
// clientMutationId per line. Everything lands on TACTICAL's Board, so the
// session binding is per Facility, copied from _handleMutation — not the
// "Primary somewhere" of the airspace/correlation/MARSA paths.

const atoBoard = require('./ato/ato-board');
const ATO_ACK_CACHE_CAP = 200;
const _atoAckCaches = new WeakMap(); // ctx -> Map(clientMutationId -> first ack)

function _atoAckCache(ctx) {
  let cache = _atoAckCaches.get(ctx);
  if (!cache) { cache = new Map(); _atoAckCaches.set(ctx, cache); }
  return cache;
}

/** Every live Strip on every Board, stamped with its Facility — bind candidates look at all of them. */
function _atoLiveStrips(ctx) {
  const out = [];
  const ids = ctx.facilityConfig && typeof ctx.facilityConfig.getFacilityIds === 'function'
    ? ctx.facilityConfig.getFacilityIds() : [atoBoard.ATO_IMPORT_ORIGIN.facilityId];
  for (const facilityId of ids) {
    const boardStore = ctx.boardStoreFor(facilityId);
    if (!boardStore) continue;
    for (const s of boardStore.getAll()) if (s.state !== 'DROPPED') out.push({ ...s, facilityId });
  }
  return out;
}

/** The checks both ATO messages share, in the order a refusal should name them. */
function _atoGate(ctx, session, msg, text) {
  const origin = atoBoard.ATO_IMPORT_ORIGIN;
  const boardStore = typeof ctx.boardStoreFor === 'function' ? ctx.boardStoreFor(origin.facilityId) : null;
  const positionStore = typeof ctx.positionStoreFor === 'function' ? ctx.positionStoreFor(origin.facilityId) : null;
  if (!boardStore || !positionStore || !ctx.fdrStore) return { reason: 'VALIDATION_ERROR', detail: 'this server has no TACTICAL Board to import an ATO into' };
  if (positionStore.primaryOf(msg.actingPositionId) !== session.controllerId) {
    return { reason: 'NOT_HOLDING_POSITION', detail: `you are not Primary at ${msg.actingPositionId} at ${origin.facilityId} — select it before importing an ATO` };
  }
  if (msg.actingPositionId !== origin.positionId) {
    return { reason: 'PERMISSION_DENIED', detail: `only ${origin.positionId} imports an ATO — it works the mission lines (guide §9.8)` };
  }
  if (!ctx.clock) return { reason: 'VALIDATION_ERROR', detail: 'no mission clock to date the ATO against' };
  if (typeof text !== 'string' || text.trim() === '') return { reason: 'VALIDATION_ERROR', detail: 'paste or drop the ATO text first' };
  if (Buffer.byteLength(text, 'utf8') > atoBoard.MAX_ATO_TEXT_BYTES) return { reason: 'VALIDATION_ERROR', detail: 'ATO text over 1 MiB' };
  return { boardStore };
}

function _handleAtoPreview(ctx, session, msg) {
  const base = { version: VERSION, type: 'efsp-ato-preview-result', requestId: msg.requestId };
  const gate = _atoGate(ctx, session, msg, msg.text);
  if (gate.reason) return { ack: { ...base, ok: false, reason: gate.reason, detail: gate.detail } };
  const preview = atoBoard.previewAto({ text: msg.text, fdrs: ctx.fdrStore.getAll(), liveStrips: _atoLiveStrips(ctx), nowUtc: ctx.clock.now() });
  return { ack: { ...base, ok: true, preview } };
}

function _atoMsgId(header) {
  const m = header && header.msgId;
  return m ? [m.formatId, m.originator, m.serial, m.month, m.qualifier, m.qualifierSerial].filter(Boolean).join('/') : null;
}

function _handleAtoMutation(ctx, session, msg, persist) {
  const facilityId = atoBoard.ATO_IMPORT_ORIGIN.facilityId;
  const op = msg.op && typeof msg.op === 'object' ? msg.op : {};
  const cmid = msg.clientMutationId;
  const base = { version: VERSION, type: 'efsp-ato-ack', clientMutationId: cmid, facilityId };
  const logEntry = (entry) => {
    if (!ctx.mutationLog) return;
    ctx.mutationLog.record({
      clientMutationId: cmid === undefined ? null : cmid, type: msg.type, op: 'ImportAto', facilityId,
      actingPositionId: msg.actingPositionId || null, actorId: session.controllerId || null,
      at: ctx.clock ? ctx.clock.now() : null, ...entry,
    });
  };
  // A refusal made here is audited like any store's (the store convention since
  // docs/adr/0040), except NOT_HOLDING_POSITION, which L5's tap already logs.
  const refuse = (reason, detail) => {
    if (reason !== 'NOT_HOLDING_POSITION') logEntry({ ok: false, reason, detail, source: 'wire' });
    return { ack: { ...base, ok: false, reason, detail, results: [] }, ...(reason === 'NOT_HOLDING_POSITION' ? { unaudited: true } : {}) };
  };

  const gate = _atoGate(ctx, session, msg, op.text);
  if (gate.reason) return refuse(gate.reason, gate.detail);
  if (typeof cmid !== 'string' || cmid === '') return refuse('VALIDATION_ERROR', 'an ATO import carries a clientMutationId');
  const cache = _atoAckCache(ctx);
  if (cache.has(cmid)) return { ack: cache.get(cmid) }; // a replayed import: the first answer, nothing twice
  if (op.kind !== 'ImportAto') return refuse('VALIDATION_ERROR', `unknown ATO op ${JSON.stringify(op.kind)}`);

  const now = ctx.clock.now();
  const analysis = atoBoard.analyseAto({ text: op.text, fdrs: ctx.fdrStore.getAll(), liveStrips: _atoLiveStrips(ctx), nowUtc: now });
  const plan = atoBoard.planImport(analysis, op.choices, { textSha1: op.textSha1 });
  if (!plan.ok) return refuse(plan.reason, plan.detail);

  const atoRef = {
    importId: cmid, msgId: analysis.preview.header.msgId, operation: analysis.preview.header.operation,
    textSha1: analysis.preview.textSha1, importedAt: now, importedBy: session.controllerId || null,
  };
  const { boardStore } = gate;
  const exec = atoBoard.executeImport({
    analysis, plan, boardStore, fdrStore: ctx.fdrStore, clientMutationId: cmid,
    actingPositionId: msg.actingPositionId, by: session.controllerId, atoRef,
  });
  logEntry({
    ok: true, atoMsgId: _atoMsgId(analysis.doc.header), textSha1: atoRef.textSha1,
    lines: exec.results.map((r) => ({ lineId: r.lineId, action: r.action, ok: r.ok, stripId: r.stripId || null, fdrId: r.fdrId || null, reason: r.reason || null })),
  });
  if (exec.applied) persist();

  const ack = { ...base, ok: true, boardSeq: boardStore.currentSeq, boardEpoch: boardStore.epoch, results: exec.results, textSha1: atoRef.textSha1 };
  cache.set(cmid, ack);
  if (cache.size > ATO_ACK_CACHE_CAP) cache.delete(cache.keys().next().value);
  if (!exec.applied) return { ack };
  return {
    ack,
    broadcast: {
      version: VERSION, type: 'efsp-board-delta', boardSeq: boardStore.currentSeq, boardEpoch: boardStore.epoch, facilityId,
      strips: { updated: exec.strips.map((s) => _stampStrip(boardStore, boardStore.getStrip(s.stripId) || s, facilityId, ctx)), gone: [] },
      fdrs: { updated: exec.fdrIds.map((id) => ctx.fdrStore.getFdr(id)).filter(Boolean) },
      positions: { updated: [] },
    },
  };
}

module.exports = { handleMessage, carrierDelta, sfaDelta, snapshotMessage: _snapshotMessage, filterForSession, supplementFor, readScopeKey, readScopeOf, RESYNC_RING_WINDOW };
