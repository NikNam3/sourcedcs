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
    default:                   return null; // not an EFSP message
  }
}

function _handleMutation(ctx, session, msg, persist) {
  const facilityId = msg.facilityId || ctx.facilityConfig.DEFAULT_FACILITY_ID;
  const boardStore = ctx.boardStoreFor(facilityId);
  if (!boardStore) {
    return { ack: { version: VERSION, type: 'efsp-mutation-ack', clientMutationId: msg.clientMutationId, ok: false, reason: 'VALIDATION_ERROR', detail: `unknown facilityId: ${msg.facilityId}` } };
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
  return {
    ack,
    broadcast: {
      version: VERSION, type: 'efsp-board-delta', boardSeq: boardStore.currentSeq,
      facilityId,
      strips: { updated: dropped ? [] : [stampedStrip], gone: dropped ? [stampedStrip.stripId] : [] },
      fdrs: { updated: result.fdr ? [result.fdr] : [] },
      positions: { updated: [] },
    },
  };
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

  for (const facilityId of facilityIds) {
    const boardStore = ctx.boardStoreFor(facilityId);
    const positionStore = ctx.positionStoreFor(facilityId);
    boardSeqByFacility[facilityId] = boardStore.currentSeq;
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
    positions, bays, strips,
    fdrs: fdrStore.getAll(),
  };
}

module.exports = { handleMessage, snapshotMessage: _snapshotMessage, RESYNC_RING_WINDOW };
