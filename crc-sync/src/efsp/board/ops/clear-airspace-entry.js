'use strict';

const { authorize, usingAgencyGate } = require('../airspace-entry-rights');

/** The flight leaves the airspace and comes back to the controller's own frequency. */
function _applyClearAirspaceEntry(ctx, strip, by, actingPositionId) {
  if (!strip.airspaceEntry) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: 'this Strip is not working an airspace', strip };
  }
  // docs/adr/0119: the using agency may withdraw what it approved, on a Strip it does not hold.
  const airspaceId = strip.airspaceEntry.airspaceId;
  const denied = usingAgencyGate(ctx, actingPositionId, 'ClearAirspaceEntry', airspaceId, ctx.rules.airspaceFor(airspaceId), strip);
  if (denied) return denied;
  const flightDataResult = ctx.flightDataStore.setWorkingFrequency(strip.flightDataId, null, { airspaceId: null, by });
  if (!flightDataResult.ok) return { ok: false, reason: flightDataResult.reason, detail: flightDataResult.detail, strip };
  strip.airspaceEntry = null;
  ctx.state.bump(strip, by);
  return { ok: true, strip, flightData: flightDataResult.flightData };
}

module.exports = {
  kind: 'ClearAirspaceEntry',
  undo: 'none', // docs/adr/0100 §1: airspace entry approval is not undoable
  authorize,
  apply: (ctx, strip, op, meta) => _applyClearAirspaceEntry(ctx, strip, meta.by, meta.actingPositionId),
};
