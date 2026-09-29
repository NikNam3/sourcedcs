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
    default:                          return {};
  }
}

function handleMessage(ctx, session, msg, persist) {
  switch (msg.type) {
    case 'efsp-mutation':      return _handleMutation(ctx, session, msg, persist);
    case 'efsp-resync':        return _handleResync(ctx, msg);
    case 'efsp-set-positions': return _handleSetPositions(ctx, session, msg);
    case 'efsp-airspace-mutation': return _handleAirspaceMutation(ctx, session, msg, persist);
    case 'efsp-correlation-mutation': return _handleCorrelationMutation(ctx, session, msg, persist);
    case 'efsp-marsa-mutation': return _handleMarsaMutation(ctx, session, msg, persist);
    case 'efsp-field-state-mutation': return _handleFieldStateMutation(ctx, session, msg, persist);
    default:                   return null; // not an EFSP message
  }
}

function _handleMutation(ctx, session, msg, persist) {
  const facilityId = msg.facilityId || ctx.facilityConfig.DEFAULT_FACILITY_ID;
  const boardStore = ctx.boardStoreFor(facilityId);
  if (!boardStore) {
    return { ack: { version: VERSION, type: 'efsp-mutation-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), ok: false, reason: 'VALIDATION_ERROR', detail: `unknown facilityId: ${msg.facilityId}` } };
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
    return { ack: { version: VERSION, type: 'efsp-mutation-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), facilityId, ok: false, reason: 'NOT_HOLDING_POSITION', detail: `you are not Primary at ${msg.actingPositionId} — select it before acting on its Strips` } };
  }

  const mutation = { clientMutationId: msg.clientMutationId, stripId: msg.stripId, baseRev: msg.baseRev, op: msg.op };

  const result = boardStore.applyMutation(mutation, msg.actingPositionId, session.controllerId);
  if (result.ok) persist();

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
    boardSeq: boardStore.currentSeq, ok: result.ok,
    strip: stampedStrip, fdr: result.fdr, reason: result.reason, detail: result.detail,
    warning: result.warning, routedTo: result.routedTo,
  };
  if (!result.ok) return { ack };

  const dropped = stampedStrip.state === 'DROPPED';
  const out = {
    ack,
    broadcast: {
      version: VERSION, type: 'efsp-board-delta', boardSeq: boardStore.currentSeq,
      facilityId,
      strips: { updated: dropped ? [] : [stampedStrip], gone: dropped ? [stampedStrip.stripId] : [] },
      fdrs: { updated: updatedFdrs },
      positions: { updated: [] },
    },
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
  if (result.peerStrip) {
    const peerBoardStore = ctx.boardStoreFor(result.peerFacilityId);
    out.peerBroadcast = {
      version: VERSION, type: 'efsp-board-delta', boardSeq: peerBoardStore ? peerBoardStore.currentSeq : undefined,
      facilityId: result.peerFacilityId,
      strips: { updated: [_stampStrip(peerBoardStore, result.peerStrip, result.peerFacilityId, ctx)], gone: [] },
      fdrs: { updated: [] }, // one shared FdrStore (docs/adr/0013) — already covered by the primary broadcast's fdrs.updated
      positions: { updated: [] },
    };
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
  return out;
}

function _handleResync(ctx, msg) {
  const { fdrStore, facilityConfig } = ctx;
  const facilityId = msg.facilityId || facilityConfig.DEFAULT_FACILITY_ID;
  const boardStore = ctx.boardStoreFor(facilityId);
  const positionStore = ctx.positionStoreFor(facilityId);
  if (!boardStore || !positionStore) return { ack: _snapshotMessage(ctx) };

  const lastSeq = Number.isFinite(msg.lastBoardSeq) ? msg.lastBoardSeq : -1;
  // Two ways a delta cannot serve this client, and only one of them used to be
  // checked.
  //
  // `currentSeq - lastSeq > WINDOW` is the client being too far BEHIND — it
  // missed more than the ring holds, so replaying from there would skip
  // changes.
  //
  // `lastSeq > currentSeq` is the server having gone BACKWARDS: it restarted
  // with no snapshot, or was restored from an older one, so its sequence is
  // lower than what the client already saw. The subtraction then goes NEGATIVE
  // and sailed through the window check — the server replayed a delta from an
  // empty ring, found nothing, and answered "no changes" to a client holding a
  // whole Board of Strips that no longer exist. They stayed on screen forever,
  // and no amount of reconnecting cleared them.
  //
  // Found by clearing the local Board during development and watching a Strip
  // survive it. Same class as docs/adr/0049's five: not a mutation, a
  // TRANSITION — here, the server's own lifetime.
  const rewound = lastSeq > boardStore.currentSeq;
  const withinWindow = lastSeq >= 0 && !rewound && boardStore.currentSeq - lastSeq <= RESYNC_RING_WINDOW;

  if (withinWindow) {
    const delta = boardStore.getDeltaSince(lastSeq);
    return {
      ack: {
        version: VERSION, type: 'efsp-board-delta', boardSeq: boardStore.currentSeq, facilityId,
        strips: {
          updated: delta.updated.filter(s => s.state !== 'DROPPED').map(s => _stampStrip(boardStore, s, facilityId, ctx)),
          gone: delta.updated.filter(s => s.state === 'DROPPED').map(s => s.stripId),
        },
        // FDRs/Positions are cheap enough at this scale to always send in
        // full rather than building a second/third ring buffer — see
        // board-store.js's module comment. fdrStore is shared across every
        // Facility (docs/adr/0013), so this list is NOT facility-scoped —
        // it's the same full set a snapshot would carry.
        fdrs: { updated: fdrStore.getAll() },
        positions: { updated: positionStore.getAll().map(p => ({ ...p, facilityId })) },
      },
    };
  }

  return { ack: _snapshotMessage(ctx) };
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
    return { ack: { version: VERSION, type: 'efsp-airspace-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), ok: false, reason: 'VALIDATION_ERROR', detail: 'no airspace store' } };
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
    return { ack: { version: VERSION, type: 'efsp-airspace-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), ok: false, reason: 'NOT_HOLDING_POSITION', detail: `you are not Primary at ${msg.actingPositionId} — select it before acting on airspace` } };
  }

  const result = airspaceStore.apply(
    { airspaceId: msg.airspaceId, baseRev: msg.baseRev, op: msg.op },
    msg.actingPositionId, session.controllerId,
  );
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
    return { ack: { version: VERSION, type: 'efsp-correlation-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), ok: false, reason: 'VALIDATION_ERROR', detail: 'no correlation store' } };
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
    return { ack: { version: VERSION, type: 'efsp-correlation-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), ok: false, reason: 'NOT_HOLDING_POSITION', detail: `you are not Primary at ${msg.actingPositionId} — select it before binding a contact` } };
  }

  // Refused by class, not by table: a range Position is the using agency, has
  // no flights to identify (§4.1 rule 2) and, under docs/adr/0042, no scope on
  // which to have seen anything.
  if (!permission.canCorrelate(msg.actingPositionId)) {
    return { ack: { version: VERSION, type: 'efsp-correlation-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), ok: false, reason: 'PERMISSION_DENIED', detail: `${msg.actingPositionId} works no flights, so it identifies no contacts` } };
  }

  const result = correlationStore.apply(
    { clientMutationId: msg.clientMutationId, fdrId: msg.fdrId, baseRev: msg.baseRev, op: msg.op },
    msg.actingPositionId, session.controllerId,
  );
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
    return { ack: { version: VERSION, type: 'efsp-marsa-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), ok: false, reason: 'VALIDATION_ERROR', detail: 'no MARSA store' } };
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
    return { ack: { version: VERSION, type: 'efsp-marsa-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), ok: false, reason: 'NOT_HOLDING_POSITION', detail: `you are not Primary at ${msg.actingPositionId} — select it before acting on a MARSA relation` } };
  }

  // Refused by class, not by table — a range Position is the using agency and
  // works no Strips (§4.1 rule 2), so it has no flights to put into a relation.
  if (!permission.canDeclareMarsa(msg.actingPositionId)) {
    return { ack: { version: VERSION, type: 'efsp-marsa-ack', clientMutationId: msg.clientMutationId, ..._subject(msg), ok: false, reason: 'PERMISSION_DENIED', detail: `${msg.actingPositionId} works no flights, so it declares no MARSA` } };
  }

  const result = marsaStore.apply(
    { clientMutationId: msg.clientMutationId, marsaId: msg.marsaId, baseRev: msg.baseRev, op: msg.op },
    msg.actingPositionId, session.controllerId,
  );
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
    out.broadcast = {
      version: VERSION, type: 'efsp-board-delta',
      boardSeq: boardStore ? boardStore.currentSeq : undefined,
      facilityId,
      strips: { updated: [], gone: [] },
      fdrs: { updated: regimeFdrs },
      positions: { updated: [] },
    };
  }
  return out;
}

/** Its own delta type with its own seq, like efsp-airspace-delta and efsp-correlation-delta — a relation is not a Strip and rides no Board's sequence. */
function _marsaDelta(marsaStore, relations) {
  return {
    version: VERSION, type: 'efsp-marsa-delta',
    marsaSeq: marsaStore.currentSeq,
    marsa: { updated: relations.filter(Boolean) },
  };
}

function _handleSetPositions(ctx, session, msg) {
  const facilityId = msg.facilityId || ctx.facilityConfig.DEFAULT_FACILITY_ID;
  const positionStore = ctx.positionStoreFor(facilityId);
  const boardStore = ctx.boardStoreFor(facilityId);
  if (!positionStore || !boardStore) {
    return { ack: { version: VERSION, type: 'efsp-positions-ack', facilityId, held: [], warnings: [], reason: 'VALIDATION_ERROR', detail: `unknown facilityId: ${facilityId}` } };
  }
  const held = Array.isArray(msg.held) ? msg.held : [];
  const { held: actuallyHeld, vacated } = positionStore.setHeldPositions(session.controllerId, session.who, held);

  const warnings = [];
  const reassignedIds = [];
  for (const positionId of vacated) {
    if (positionStore.isOccupied(positionId)) continue; // another controller is now Primary — nothing to route
    const owned = boardStore.getAll().filter(s => s.ownerPositionId === positionId && s.state !== 'DROPPED');
    if (owned.length === 0) continue;

    const covering = positionStore.coveringPositionFor(positionId);
    if (covering) {
      reassignedIds.push(...boardStore.reassignPositionStrips(positionId, covering));
      warnings.push({ positionId, count: owned.length, routedTo: covering });
    } else {
      // Defect D19 boundary: the covering chain bottomed out with nobody
      // occupying any link. MUST be a visible, distinct condition — never
      // a Strip silently left owned by an unoccupied Position with no
      // signal to anyone (guide §4.8.6 rule 3).
      warnings.push({ positionId, count: owned.length, routedTo: null });
    }
  }

  return {
    ack: { version: VERSION, type: 'efsp-positions-ack', facilityId, held: actuallyHeld, warnings },
    broadcast: {
      version: VERSION, type: 'efsp-board-delta', boardSeq: boardStore.currentSeq, facilityId,
      // EVERY live Strip, not just the reassigned ones. Taking or giving up a
      // Position changes who is there to receive a transfer, which changes the
      // `nla` status _stampStrip computes for Strips this message never
      // touched — a TWR Strip at DEPARTED becomes "no receiving Position
      // present" the instant APP is released, and F-408's whole point is that
      // the panel be told BEFORE the press. The Board is a few dozen Strips
      // (board-store.js's module comment) and a Position change is a rare,
      // deliberate act, so re-sending the set is cheaper than tracking which
      // Strips' status actually moved.
      strips: { updated: boardStore.getAll().filter(s => s.state !== 'DROPPED').map(s => _stampStrip(boardStore, s, facilityId, ctx)), gone: [] },
      fdrs: { updated: [] },
      positions: { updated: positionStore.getAll().map(p => ({ ...p, facilityId })) },
    },
  };
}

/**
 * WP4A: sends every Facility's strips/positions/bays in one message (each
 * record stamped with `facilityId`), since a client can now hold Positions
 * and act across both. `boardSeq`/`facility` stay as top-level back-compat
 * aliases for INCIRLIK specifically — `boardSeqByFacility`/`facilities` are
 * the real, general shape.
 */
function _snapshotMessage(ctx) {
  const { fdrStore, facilityConfig } = ctx;
  const facilityIds = facilityConfig.getFacilityIds();

  const strips = [];
  const positions = [];
  const bays = [];
  const boardSeqByFacility = {};
  // WP4A gap-closure (docs/adr/0022) — lets the client proactively disable
  // the AIT option (rather than let the controller submit-and-silently-fail
  // against the server-side check in board-store.js's
  // _applyCoordinationPropose) when no written directive is on file.
  const aitAuthorizedByFacility = {};

  for (const facilityId of facilityIds) {
    const boardStore = ctx.boardStoreFor(facilityId);
    const positionStore = ctx.positionStoreFor(facilityId);
    boardSeqByFacility[facilityId] = boardStore.currentSeq;
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
    aitAuthorizedByFacility,
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
 * not written to the Mutation log — the store audits from its door onward
 * (decisions.md S-R2-5).
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
  });
  if (!store) return refuse('VALIDATION_ERROR', 'no field-state store');

  const positionStore = ctx.positionStoreFor(facilityId);
  if (!positionStore || positionStore.primaryOf(msg.actingPositionId) !== session.controllerId) {
    return refuse('NOT_HOLDING_POSITION', `you are not Primary at ${msg.actingPositionId} at ${facilityId} — select it before acting on the field`);
  }

  // The permission table (and every refusal) is checked inside apply(), so a
  // PERMISSION_DENIED is audited like any other outcome.
  const result = store.apply(
    { clientMutationId: msg.clientMutationId, facilityId, baseRev: msg.baseRev, op },
    msg.actingPositionId, session.controllerId,
  );
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

module.exports = { handleMessage, snapshotMessage: _snapshotMessage, RESYNC_RING_WINDOW };
