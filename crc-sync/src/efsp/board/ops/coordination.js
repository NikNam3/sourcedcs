'use strict';

// Cross-Facility coordination primitives (guide §4.6,
// docs/adr/0015) — all 5 share one handler; op.kind IS the primitive,
// op.action selects PROPOSE/ACCEPT/REJECT/STAND_BY/CANCEL, and for a HANDOFF TRANSFER_COMMS and TRANSFER_CONTROL
// (docs/adr/0101). See board/coordination.js applyOp.
const KINDS = ['HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT'];

/** The two one-click marks of a HANDOFF (docs/adr/0101 "Undo", H100 DR-5): undoable inside the window; nothing else here is. */
const UNDOABLE_MARKS = ['TRANSFER_COMMS', 'TRANSFER_CONTROL'];

/**
 * docs/adr/0100: the scope of a mark is both Strips of the exchange (the mark writes this one and mirrors onto the peer
 * Board's, and a FULL release may move control inside it). `null` for every other action: a PROPOSE, ACCEPT, REJECT or
 * CANCEL is not undone (a PROPOSE has CANCEL, an ACCEPT is the receiver's answer).
 */
const HANDOFF_UNDO = {
  label: (op, strip) => {
    // Always the RECEIVING Position, whichever side records the mark: on the receiver's replica that is its own owner,
    // on the transferring Strip it is the peer (so a receiver's mark never reads "to" the Position that held it).
    const co = strip && strip.coordination;
    const receiving = (co && (co.mintedForCoordination ? strip.ownerPositionId : co.peerPositionId)) || 'the receiving Position';
    return op.action === 'TRANSFER_COMMS' ? `Communications to ${receiving}` : `Control to ${receiving}`;
  },
  scope: (ctx, strip, op) => {
    if (!UNDOABLE_MARKS.includes(op.action) || !strip || !strip.coordination) return null;
    return {
      strips: [
        { facilityId: ctx.rules.facilityId, stripId: strip.stripId },
        { facilityId: strip.coordination.peerFacilityId, stripId: strip.coordination.peerStripId },
      ],
      flightData: [],
    };
  },
};

// Authority is by op kind, and a Position may hold a coordination kind with only some of its actions (the carrier
// Marshal answers a HANDOFF, never proposes one): the registry's COORDINATION_ACTIONS, read by canMutateAction.
function authorize(ctx, actingPositionId, op) {
  return ctx.rules.canMutate(actingPositionId, op.kind) && ctx.rules.canMutateAction(actingPositionId, op.kind, op.action) ? null : { ok: false, reason: 'PERMISSION_DENIED' };
}

module.exports = KINDS.map(kind => ({
  kind,
  undo: kind === 'HANDOFF' ? HANDOFF_UNDO : 'none', // docs/adr/0100 §1: the other primitives have CANCEL
  authorize,
  // docs/adr/0101: what a mark wrote, in the entry of the op that caused it (one entry per outcome, ADR 0083).
  auditFields: (ctx, result) => (result.controlAudit ? { tail: result.controlAudit } : {}),
  apply: (ctx, strip, op, meta) => ctx.coordination.applyOp(strip, op, meta.by, meta.actingPositionId),
}));
