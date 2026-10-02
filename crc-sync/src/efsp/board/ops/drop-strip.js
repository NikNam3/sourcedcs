'use strict';

function _applyDropStrip(ctx, strip, op, by) {
  // Same open-coordination-link guard as board/ops/invoke-nla.js's _applyInvokeNla above, for the
  // explicit DropStrip op (dot-command) path — see that guard's comment.
  if (strip.coordination && strip.coordination.state === 'INITIATED') {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: 'cannot drop a Strip with an open coordination proposal — accept, reject, or wait for a response first', strip };
  }
  if (strip.tofiCoordination && strip.tofiCoordination.state === 'INITIATED') {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: 'cannot drop a Strip with an open TOFI proposal — accept, reject, or wait for a response first', strip };
  }
  return ctx.retire(strip, by);
}

module.exports = {
  kind: 'DropStrip',
  undo: 'none', // docs/adr/0100: not undoable (yet); UNDO-S step 2 declares the scopes
  apply: (ctx, strip, op, meta) => _applyDropStrip(ctx, strip, op, meta.by),
};
