'use strict';

const { stripScope, retireScope, union, callsignOf } = require('../../undo/scopes');

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
  // docs/adr/0100: a retirement, with everything it ends (MARSA, carrier stack, the peer link, the code).
  undo: {
    label: (op, strip, ctx) => `Drop ${callsignOf(ctx, strip)}`,
    scope: (ctx, strip) => retireScope(ctx, strip),
  },
  apply: (ctx, strip, op, meta) => _applyDropStrip(ctx, strip, op, meta.by),
};
