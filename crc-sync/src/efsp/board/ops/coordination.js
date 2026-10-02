'use strict';

// Cross-Facility coordination primitives (guide §4.6,
// docs/adr/0015) — all 5 share one handler; op.kind IS the primitive,
// op.action selects PROPOSE/ACCEPT/REJECT. See board/coordination.js applyOp.
const KINDS = ['HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT'];

module.exports = KINDS.map(kind => ({
  kind,
  undo: 'none', // docs/adr/0100 §1: a coordination primitive has CANCEL (CR-S declares its undoable marks)
  apply: (ctx, strip, op, meta) => ctx.coordination.applyOp(strip, op, meta.by, meta.actingPositionId),
}));
