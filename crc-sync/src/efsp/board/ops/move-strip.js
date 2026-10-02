'use strict';

function _applyMoveStrip(ctx, strip, op, by) {
  const bayCheck = ctx.placement.requireKnownBay(op.bayId, strip);
  if (bayCheck) return bayCheck;
  const check = ctx.placement.validateBayImpliedTransition(strip, op.bayId, op.rackId);
  if (!check.ok) return { ok: false, reason: check.reason, detail: check.detail, strip };
  const full = ctx.placement.bayFullRefusal(op.bayId, strip);
  if (full) return { ok: false, reason: full.reason, detail: full.detail, strip };

  strip.bayId = op.bayId;
  strip.rackId = op.rackId;
  strip.orderKey = ctx.placement.resolveOrderKey(op.bayId, op.rackId, op.afterStripId || null, op.beforeStripId || null, strip.stripId);
  if (check.impliedState && check.impliedState !== strip.state) strip.state = check.impliedState;
  const flightDataResult = ctx.assignSfaFrequency(strip, by);

  ctx.state.bump(strip, by);
  return { ok: true, strip, flightData: flightDataResult ? flightDataResult.flightData : undefined };
}

module.exports = {
  kind: 'MoveStrip',
  undo: 'none', // docs/adr/0100: not undoable (yet); UNDO-S step 2 declares the scopes
  apply: (ctx, strip, op, meta) => _applyMoveStrip(ctx, strip, op, meta.by),
};
