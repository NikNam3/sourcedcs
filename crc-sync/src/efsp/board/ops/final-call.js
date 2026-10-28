'use strict';

const { stripScope, callsignOf } = require('../../undo/scopes');
const { FINAL_CALLS, CONVERSIONS, CARRIER_FACILITY } = require('../../par-final');
const { ARRIVAL_STATE_OWNERS } = require('../../authority/strip-types/arrival');
const { activeClearanceEntry } = require('../../flight-data-store');

/**
 * The final controller's calls on a FINAL Strip at an airfield (docs/adr/0117, par-final.js):
 *
 *   BEGIN_DESCENT    recorded, and it ends the assigned altitude (JO 7110.65BB para 5-12-3, 5-12-4: from "BEGIN DESCENT"
 *                    the reference is the glidepath), so altitude conformance has nothing to check (H134 LT-RQ8 a).
 *   CLEARED_TO_LAND  recorded: the tower's clearance relayed (para 5-10-13 a). Optional.
 *   LANDED           the Strip leaves PAR for GC as an ARRIVAL at TAXI_IN (H134 LT-RQ6 b, para 5-12-9), through the
 *                    one strip transfer (transfer-strip.js's LANDED conversion), so staffing and Bays are its rules.
 *   MISSED_APPROACH  the Strip goes back to AP as an ARRIVAL at INBOUND for another approach (H137 LT-PQ1 a, ours: the
 *                    orders are silent on who works the climb-out), through the same transfer (MISSED_APPROACH
 *                    conversion); on AP's SFA frequency Rack when the flight is on one. Its recorded calls are cleared.
 *
 * Never on the carrier, whose FINAL has its own terminal steps (Ball, Waveoff). A call is recorded once.
 */
function _applyFinalCall(ctx, strip, op, by) {
  const call = Object.prototype.hasOwnProperty.call(FINAL_CALLS, op.call) ? FINAL_CALLS[op.call] : null;
  if (!call) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown final call ${JSON.stringify(op.call)} (one of ${Object.keys(FINAL_CALLS).join(', ')})`, strip };
  if (ctx.rules.facilityId === CARRIER_FACILITY) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: 'the carrier final records Ball and Waveoff, not these calls', strip };
  }
  if (strip.stripType !== 'FINAL' || strip.state !== 'ON_FINAL') {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `${call.label} applies to a FINAL Strip on final, not ${strip.stripType} in ${strip.state}`, strip };
  }
  const blocked = ctx.nlaPrecheck(strip);
  if (blocked) return { ok: false, reason: blocked.reason, detail: blocked.detail, strip };

  if (call.conversion) {
    // The receiving Position is the one that works the converted state: GC for TAXI_IN, AP for INBOUND.
    const { toState } = CONVERSIONS[call.conversion];
    const toPositionId = ARRIVAL_STATE_OWNERS[toState][0];
    const target = ctx.placement.transferTargetFor(toPositionId, toState, strip);
    if (!target || target.bay.impliesState !== toState) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${toPositionId} has no Bay for ${toState}`, strip };
    }
    const r = ctx.run('TransferStrip', strip, { toPositionId, bayId: target.bay.bayId, rackId: target.rackId }, { by });
    return r.ok ? { ...r, finalCall: op.call } : r;
  }

  if (strip.finalCalls && strip.finalCalls[op.call]) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `${call.label} is already recorded`, strip };
  }
  const now = ctx.clock.now();
  let flightData;
  if (op.call === 'BEGIN_DESCENT') {
    const fd = ctx.flightDataStore.getFlightData(strip.flightDataId);
    const active = fd ? activeClearanceEntry(fd, 'altitude') : null;
    if (active && active.value !== '') {
      const r = ctx.flightDataStore.setClearance(strip.flightDataId, 'altitude', { value: '' }, { by });
      if (r.ok) flightData = r.flightData;
    }
  }
  strip.finalCalls = { ...(strip.finalCalls || {}), [op.call]: { at: now, by: by || null } };
  ctx.state.bump(strip, by, now);
  return { ok: true, strip, flightData, finalCall: op.call };
}

module.exports = {
  kind: 'FinalCall',
  // docs/adr/0100: a one-click action, undone like the others; Landed and Missed approach as the transfer they make.
  undo: {
    label: (op, strip, ctx) => `${(FINAL_CALLS[op.call] || {}).label || op.call} ${callsignOf(ctx, strip)}`,
    scope: (ctx, strip) => stripScope(ctx, strip),
  },
  // Not an OP_KINDS grant: the capability table's `recordsFinalCalls` column says who may (incirlik-military.js).
  authorize: (ctx, actingPositionId) => (ctx.rules.canRecordFinalCall(actingPositionId)
    ? null
    : { ok: false, reason: 'PERMISSION_DENIED', detail: `${actingPositionId} does not work the final` }),
  auditFields: (ctx, result, op) => ({ tail: {
    finalCall: result.finalCall,
    ...ctx.auditFieldsFor('TransferStrip', result, op).tail,
  } }),
  apply: (ctx, strip, op, meta) => _applyFinalCall(ctx, strip, op, meta.by),
};
