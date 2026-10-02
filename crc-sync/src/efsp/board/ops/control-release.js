'use strict';

// ControlRelease (docs/adr/0101; H94, H98 — always "ControlRelease", never a bare "Release", which is departure
// release): GRANT, REQUEST, REFUSE, WITHDRAW on a HANDOFF between its ACCEPT and the transfer of control. Never
// undoable (H100 DR-5): a release is an authorisation another controller may already have acted on, and WITHDRAW is the
// correction. The work is board/handoff-control.js.

function authorize(ctx, actingPositionId, op) {
  return ctx.rules.canMutate(actingPositionId, 'ControlRelease') && ctx.rules.canMutateAction(actingPositionId, 'ControlRelease', op.action) ? null : { ok: false, reason: 'PERMISSION_DENIED' };
}

module.exports = {
  kind: 'ControlRelease',
  undo: 'none', // docs/adr/0101 "Undo": a release is not undone, it is withdrawn
  authorize,
  auditFields: (ctx, result) => (result.controlAudit ? { tail: result.controlAudit } : {}),
  apply: (ctx, strip, op, meta) => ctx.control.applyRelease(strip, op, meta.by, meta.actingPositionId),
};
