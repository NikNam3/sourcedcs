'use strict';

// docs/adr/0119 (H136 VQ5 a): the Position working the Strip (holding the op kind) clears the entry, and so does the
// airspace's using agency, which withdraws what it approved (14 CFR 73.15 (c)(2)) on a Strip of its own Facility it may
// not hold (facility-rules.js `mayActBesideOwner`). The airspace is the Strip's, so the check runs in `apply`.

/** The flight leaves the airspace and comes back to the controller's own frequency. */
function _applyClearAirspaceEntry(ctx, strip, by, actingPositionId) {
  if (!strip.airspaceEntry) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: 'this Strip is not working an airspace', strip };
  }
  const airspaceId = strip.airspaceEntry.airspaceId;
  if (actingPositionId && !ctx.rules.canMutate(actingPositionId, 'ClearAirspaceEntry')
      && !ctx.rules.isAirspaceUsingAgency(actingPositionId, airspaceId)) {
    return { ok: false, reason: 'PERMISSION_DENIED', detail: `${actingPositionId} is not the using agency for ${airspaceId}`, strip };
  }
  const flightDataResult = ctx.flightDataStore.setWorkingFrequency(strip.flightDataId, null, { airspaceId: null, by });
  if (!flightDataResult.ok) return { ok: false, reason: flightDataResult.reason, detail: flightDataResult.detail, strip };
  strip.airspaceEntry = null;
  ctx.state.bump(strip, by);
  return { ok: true, strip, flightData: flightDataResult.flightData };
}

module.exports = {
  kind: 'ClearAirspaceEntry',
  undo: 'none', // docs/adr/0100 §1: airspace entry approval is not undoable
  // The op grant, or the using agency of some airspace here; in apply, of the Strip's own airspace.
  authorize: (ctx, actingPositionId, op) => (ctx.rules.canMutate(actingPositionId, op.kind)
    || ctx.rules.isAirspaceUsingAgency(actingPositionId, null) ? null : { ok: false, reason: 'PERMISSION_DENIED' }),
  apply: (ctx, strip, op, meta) => _applyClearAirspaceEntry(ctx, strip, meta.by, meta.actingPositionId),
};
