'use strict';

// EFSP WebSocket message handling — the boundary between ws-hub.js's
// session/broadcast machinery and the EFSP stores. Kept as its own file
// rather than inlined into ws-hub.js's existing message switch (the way
// squawkMapSet/theaterSettingsSet/aptConfigSet are) because the EFSP
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

function handleMessage(ctx, session, msg, persist) {
  switch (msg.type) {
    case 'efsp-mutation':      return _handleMutation(ctx, session, msg, persist);
    case 'efsp-resync':        return _handleResync(ctx, msg);
    case 'efsp-set-positions': return _handleSetPositions(ctx, session, msg);
    case 'efsp-airspace-mutation': return _handleAirspaceMutation(ctx, session, msg, persist);
    case 'efsp-correlation-mutation': return _handleCorrelationMutation(ctx, session, msg, persist);
    default:                   return null; // not an EFSP message
  }
}

function _handleMutation(ctx, session, msg, persist) {
  const facilityId = msg.facilityId || ctx.facilityConfig.DEFAULT_FACILITY_ID;
  const boardStore = ctx.boardStoreFor(facilityId);
  if (!boardStore) {
    return { ack: { version: VERSION, type: 'efsp-mutation-ack', clientMutationId: msg.clientMutationId, ok: false, reason: 'VALIDATION_ERROR', detail: `unknown facilityId: ${msg.facilityId}` } };
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
    return { ack: { version: VERSION, type: 'efsp-mutation-ack', clientMutationId: msg.clientMutationId, facilityId, ok: false, reason: 'NOT_HOLDING_POSITION', detail: `you are not Primary at ${msg.actingPositionId} — select it before acting on its Strips` } };
  }

  const mutation = { clientMutationId: msg.clientMutationId, stripId: msg.stripId, baseRev: msg.baseRev, op: msg.op };

  const result = boardStore.applyMutation(mutation, msg.actingPositionId, session.controllerId);
  if (result.ok) persist();

  // Every Strip record leaving this function — ack or broadcast — is
  // stamped with facilityId, matching _snapshotMessage's per-record
  // stamping below. Without this, a client's local Map (efsp-state.js,
  // which just Map.set()s whatever record arrives) would end up with
  // delta-derived Strips missing facilityId entirely, breaking any
  // Facility-scoped filtering downstream — a real bug this WP4A slice
  // would otherwise introduce, not a style choice.
  const stampedStrip = result.strip ? { ...result.strip, facilityId } : result.strip;

  const ack = {
    version: VERSION, type: 'efsp-mutation-ack', clientMutationId: msg.clientMutationId,
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
      fdrs: { updated: result.fdr ? [result.fdr] : [] },
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
      strips: { updated: [{ ...result.peerStrip, facilityId: result.peerFacilityId }], gone: [] },
      fdrs: { updated: [] }, // one shared FdrStore (docs/adr/0013) — already covered by the primary broadcast's fdrs.updated
      positions: { updated: [] },
    };
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
  const withinWindow = lastSeq >= 0 && boardStore.currentSeq - lastSeq <= RESYNC_RING_WINDOW;

  if (withinWindow) {
    const delta = boardStore.getDeltaSince(lastSeq);
    return {
      ack: {
        version: VERSION, type: 'efsp-board-delta', boardSeq: boardStore.currentSeq, facilityId,
        strips: {
          updated: delta.updated.filter(s => s.state !== 'DROPPED').map(s => ({ ...s, facilityId })),
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
    return { ack: { version: VERSION, type: 'efsp-airspace-ack', clientMutationId: msg.clientMutationId, ok: false, reason: 'VALIDATION_ERROR', detail: 'no airspace store' } };
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
    return { ack: { version: VERSION, type: 'efsp-airspace-ack', clientMutationId: msg.clientMutationId, ok: false, reason: 'NOT_HOLDING_POSITION', detail: `you are not Primary at ${msg.actingPositionId} — select it before acting on airspace` } };
  }

  const result = airspaceStore.apply(
    { airspaceId: msg.airspaceId, baseRev: msg.baseRev, op: msg.op },
    msg.actingPositionId, session.controllerId,
  );
  if (result.ok) persist();

  const ack = {
    version: VERSION, type: 'efsp-airspace-ack', clientMutationId: msg.clientMutationId,
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
    return { ack: { version: VERSION, type: 'efsp-correlation-ack', clientMutationId: msg.clientMutationId, ok: false, reason: 'VALIDATION_ERROR', detail: 'no correlation store' } };
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
    return { ack: { version: VERSION, type: 'efsp-correlation-ack', clientMutationId: msg.clientMutationId, ok: false, reason: 'NOT_HOLDING_POSITION', detail: `you are not Primary at ${msg.actingPositionId} — select it before binding a contact` } };
  }

  // Refused by class, not by table: a range Position is the using agency, has
  // no flights to identify (§4.1 rule 2) and, under docs/adr/0042, no scope on
  // which to have seen anything.
  if (!permission.canCorrelate(msg.actingPositionId)) {
    return { ack: { version: VERSION, type: 'efsp-correlation-ack', clientMutationId: msg.clientMutationId, ok: false, reason: 'PERMISSION_DENIED', detail: `${msg.actingPositionId} works no flights, so it identifies no contacts` } };
  }

  const result = correlationStore.apply(
    { clientMutationId: msg.clientMutationId, fdrId: msg.fdrId, baseRev: msg.baseRev, op: msg.op },
    msg.actingPositionId, session.controllerId,
  );
  if (result.ok) persist();

  const ack = {
    version: VERSION, type: 'efsp-correlation-ack', clientMutationId: msg.clientMutationId,
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

function _handleSetPositions(ctx, session, msg) {
  const facilityId = msg.facilityId || ctx.facilityConfig.DEFAULT_FACILITY_ID;
  const positionStore = ctx.positionStoreFor(facilityId);
  const boardStore = ctx.boardStoreFor(facilityId);
  if (!positionStore || !boardStore) {
    return { ack: { version: VERSION, type: 'efsp-positions-ack', held: [], warnings: [], reason: 'VALIDATION_ERROR', detail: `unknown facilityId: ${facilityId}` } };
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
      strips: { updated: boardStore.getAll().filter(s => reassignedIds.includes(s.stripId)).map(s => ({ ...s, facilityId })), gone: [] },
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
    for (const s of boardStore.getAll().filter(s => s.state !== 'DROPPED')) strips.push({ ...s, facilityId });
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
  };
}

module.exports = { handleMessage, snapshotMessage: _snapshotMessage, RESYNC_RING_WINDOW };
