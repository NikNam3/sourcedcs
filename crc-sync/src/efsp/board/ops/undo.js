'use strict';

/** Reverts the last NLA-driven transition, within its 30s window (guide §3.5 rule 5). */
function _applyUndo(ctx, strip, by) {
  const last = ctx.nlaHistory.get(strip.stripId);
  if (!last || Date.now() > last.expiresAt) { // the latch's real-time window, see board/ops/invoke-nla.js's _applyInvokeNla
    return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no Undo available', strip };
  }
  ctx.nlaHistory.delete(strip.stripId);
  // A terminal NLA Drop now does more than set a state (see _retireStrip),
  // so undoing one has to put back what it took: clear the remove
  // indicator and re-claim the beacon code. The code can only have been
  // taken by another flight if one was created inside this 30s window —
  // reacquireFlightData leaves it alone in that case rather than minting a
  // silent duplicate, exactly as a controller override would (D23).
  if (strip.state === 'DROPPED') {
    strip.flags.removeIndicator = false;
    ctx.flightDataStore.reacquireFlightData(strip.flightDataId);
    ctx.droppedWallAt.delete(strip.stripId);
  }
  return ctx.applySetState(strip, last.prevState, by);
}

module.exports = {
  kind: 'Undo',
  apply: (ctx, strip, op, meta) => _applyUndo(ctx, strip, meta.by),
};
