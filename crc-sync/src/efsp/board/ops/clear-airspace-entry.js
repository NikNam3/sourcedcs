'use strict';

/** The flight leaves the airspace and comes back to the controller's own frequency. */
function _applyClearAirspaceEntry(ctx, strip, by) {
  if (!strip.airspaceEntry) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: 'this Strip is not working an airspace', strip };
  }
  const flightDataResult = ctx.flightDataStore.setWorkingFrequency(strip.flightDataId, null, { airspaceId: null, by });
  if (!flightDataResult.ok) return { ok: false, reason: flightDataResult.reason, detail: flightDataResult.detail, strip };
  strip.airspaceEntry = null;
  ctx.state.bump(strip, by);
  return { ok: true, strip, flightData: flightDataResult.flightData };
}

module.exports = {
  kind: 'ClearAirspaceEntry',
  apply: (ctx, strip, op, meta) => _applyClearAirspaceEntry(ctx, strip, meta.by),
};
