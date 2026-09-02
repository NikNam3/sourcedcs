'use strict';

// EFSP WebSocket message handling — the boundary between ws-hub.js's
// session/broadcast machinery and the EFSP stores. Kept as its own file
// rather than inlined into ws-hub.js's existing message switch (the way
// squawkMapSet/theaterSettingsSet/aptConfigSet are) because the EFSP
// surface area — three message types, each with a distinct ack/broadcast
// shape, one of which (mutation) covers eight op kinds — is bigger than
// those single-shot squadron-config messages.
//
// handleMessage() returns { ack, broadcast? } for ws-hub.js to send: `ack`
// always goes to the sender only; `broadcast`, when present, goes to every
// connected client (the sender included) — the EFSP Board's guide-mandated
// <200ms remote-change budget (§7.9) needs an immediate broadcast, not the
// existing 500ms tick tracks/collab-store use (see board-store.js's module
// comment; this is docs/adr/0004-immediate-board-broadcast.md).

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
  const { boardStore } = ctx;
  const mutation = { clientMutationId: msg.clientMutationId, stripId: msg.stripId, baseRev: msg.baseRev, op: msg.op };

  const result = boardStore.applyMutation(mutation, msg.actingPositionId, session.controllerId);
  if (result.ok) persist();

  const ack = {
    version: VERSION, type: 'efsp-mutation-ack', clientMutationId: msg.clientMutationId,
    boardSeq: boardStore.currentSeq, ok: result.ok,
    strip: result.strip, fdr: result.fdr, reason: result.reason, detail: result.detail,
    warning: result.warning, routedTo: result.routedTo,
  };
  if (!result.ok) return { ack };

  const dropped = result.strip.state === 'DROPPED';
  return {
    ack,
    broadcast: {
      version: VERSION, type: 'efsp-board-delta', boardSeq: boardStore.currentSeq,
      strips: { updated: dropped ? [] : [result.strip], gone: dropped ? [result.strip.stripId] : [] },
      fdrs: { updated: result.fdr ? [result.fdr] : [] },
      positions: { updated: [] },
    },
  };
}

function _handleResync(ctx, msg) {
  const { boardStore, fdrStore, positionStore, facilityConfig } = ctx;
  const lastSeq = Number.isFinite(msg.lastBoardSeq) ? msg.lastBoardSeq : -1;
  const withinWindow = lastSeq >= 0 && boardStore.currentSeq - lastSeq <= RESYNC_RING_WINDOW;

  if (withinWindow) {
    const delta = boardStore.getDeltaSince(lastSeq);
    return {
      ack: {
        version: VERSION, type: 'efsp-board-delta', boardSeq: boardStore.currentSeq,
        strips: {
          updated: delta.updated.filter(s => s.state !== 'DROPPED'),
          gone: delta.updated.filter(s => s.state === 'DROPPED').map(s => s.stripId),
        },
        // FDRs/Positions are cheap enough at Phase-1 scale to always send
        // in full rather than building a second/third ring buffer — see
        // board-store.js's module comment.
        fdrs: { updated: fdrStore.getAll() },
        positions: { updated: positionStore.getAll() },
      },
    };
  }

  return { ack: _snapshotMessage(ctx) };
}

function _handleSetPositions(ctx, session, msg) {
  const { positionStore, boardStore } = ctx;
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
    ack: { version: VERSION, type: 'efsp-positions-ack', held: actuallyHeld, warnings },
    broadcast: {
      version: VERSION, type: 'efsp-board-delta', boardSeq: boardStore.currentSeq,
      strips: { updated: boardStore.getAll().filter(s => reassignedIds.includes(s.stripId)), gone: [] },
      fdrs: { updated: [] },
      positions: { updated: positionStore.getAll() },
    },
  };
}

function _snapshotMessage(ctx) {
  const { boardStore, fdrStore, positionStore, facilityConfig } = ctx;
  return {
    version: VERSION, type: 'efsp-snapshot', boardSeq: boardStore.currentSeq,
    facility: facilityConfig.getFacilityConfig().facility,
    positions: positionStore.getAll(),
    bays: facilityConfig.getAllBays(),
    strips: boardStore.getAll().filter(s => s.state !== 'DROPPED'),
    fdrs: fdrStore.getAll(),
  };
}

module.exports = { handleMessage, snapshotMessage: _snapshotMessage, RESYNC_RING_WINDOW };
