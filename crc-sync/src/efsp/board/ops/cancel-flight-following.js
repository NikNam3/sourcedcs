'use strict';

// CancelFlightFollowing (docs/adr/0146, amended 2026-11-15): flight following ends, the strip stays. The VFR flight's
// code is released ("squawk VFR", JO 7110.65BB para 5-2-7 b) and the flight data has none again, so it alerts as
// untracked (conflict-alert.js: a VFR flight with no code is not on flight following). The strip, its track binding
// and its cells stay with the holder, as after a tag with no code (StartFlightFollowing): CODE gives a new one.
// "Radar service terminated" (TerminateRadarService) is the other way out: it drops the strip and untags the track.
// Not undone (docs/adr/0100 §1), as AssignCode: CODE is the way back.

function _applyCancelFlightFollowing(ctx, strip, op, meta) {
  if (strip.state === 'DROPPED') return { ok: false, reason: 'VALIDATION_ERROR', detail: 'this strip is dropped', strip };
  if (strip.stripType !== 'VFR') return { ok: false, reason: 'VALIDATION_ERROR', detail: 'only a VFR strip is on flight following', strip };
  const r = ctx.flightDataStore.releaseAssignedCode(strip.flightDataId, { by: meta.by });
  if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail, strip };
  return { ok: true, strip, flightData: r.flightData, releasedCode: r.code };
}

module.exports = {
  kind: 'CancelFlightFollowing',
  undo: 'none',
  auditFields: (ctx, result) => ({ tail: { releasedCode: result.releasedCode } }),
  apply: (ctx, strip, op, meta) => _applyCancelFlightFollowing(ctx, strip, op, meta),
};
