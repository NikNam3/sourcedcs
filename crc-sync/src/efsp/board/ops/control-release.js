'use strict';

// ControlRelease (docs/adr/0122, replacing ADR 0101's; H94, H98 — always "ControlRelease", never a bare "Release", which
// is departure release): the receiver's REQUEST on a not-released HANDOFF and the handing-off station's GRANT or REFUSE,
// between ACCEPT and the transfer of control. No WITHDRAW (H141 U-RQ2 c). Never undoable (H100 DR-5): a release is an
// authorisation another controller may already have acted on. The work is board/handoff-control.js.

function authorize(ctx, actingPositionId, op) {
  return ctx.rules.canMutate(actingPositionId, 'ControlRelease') && ctx.rules.canMutateAction(actingPositionId, 'ControlRelease', op.action) ? null : { ok: false, reason: 'PERMISSION_DENIED' };
}

module.exports = {
  kind: 'ControlRelease',
  undo: 'none', // docs/adr/0101 "Undo", 0122: a release is neither undone nor withdrawn
  authorize,
  auditFields: (ctx, result) => (result.controlAudit ? { tail: result.controlAudit } : {}),
  apply: (ctx, strip, op, meta) => ctx.control.applyRelease(strip, op, meta.by, meta.actingPositionId),
};
