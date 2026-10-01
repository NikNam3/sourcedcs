'use strict';

// WP4A cross-Facility coordination primitives (guide §4.6,
// docs/adr/0015) — all 5 share one handler; op.kind IS the primitive,
// op.action selects PROPOSE/ACCEPT/REJECT. See board/coordination.js applyOp.
const KINDS = ['HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT'];

module.exports = KINDS.map(kind => ({
  kind,
  apply: (ctx, strip, op, meta) => ctx.coordination.applyOp(strip, op, meta.by, meta.actingPositionId),
}));
