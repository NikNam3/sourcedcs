'use strict';

const FLAG_KEYS = ['offset', 'flipped', 'removeIndicator', 'highlight', 'attention'];

function _applySetFlag(ctx, strip, op, by) {
  if (!FLAG_KEYS.includes(op.flag)) return { ok: false, reason: 'VALIDATION_ERROR', strip };
  strip.flags[op.flag] = op.value;
  ctx.state.bump(strip, by);
  return { ok: true, strip };
}

module.exports = {
  kind: 'SetFlag',
  undo: 'none', // docs/adr/0100 §1: an edit, corrected by editing
  apply: (ctx, strip, op, meta) => _applySetFlag(ctx, strip, op, meta.by),
};
