'use strict';

const { _validateAltitudeBlock } = require('../strip-util');
const { warn } = require('../../warnings');

/**
 * Approves this flight to work inside an airspace, on a frequency.
 *
 * The frequency defaults from the airspace itself — a range with a control
 * tower of its own hands the flight to that tower's frequency, an ordinary
 * MOA to its working frequency — and an explicit `frequencyMhz` overrides
 * both, because a controller assigning something off-config is a normal
 * thing to do and refusing it would be worse than recording it.
 *
 * Entry into an airspace that is not ACTIVE is WARNED, never refused
 * (guide §9.11: "aircraft entering unactivated airspace MUST alert").
 * Refusing would be wrong every time the airspace is hot in reality and
 * the board has simply not caught up, which is the situation the alert
 * exists to surface.
 *
 * An optional `altitudeBlock` restricts this flight to a slice of the
 * airspace — the ordinary way two aircraft share one block, or the way a
 * working flight is pushed out of the way while somebody transits. Re-
 * issuing this op on a Strip already in the same airspace AMENDS the
 * restriction rather than being refused, because tightening or lifting a
 * block mid-sortie is the normal case, not an error.
 */
function _applyApproveAirspaceEntry(ctx, strip, op, by) {
  if (!op.airspaceId) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: 'an airspace entry needs an airspaceId', strip };
  }
  const airspace = ctx.rules.airspaceFor(op.airspaceId);
  if (!airspace) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown airspace: ${op.airspaceId}`, strip };
  }

  const definition = airspace.definition || {};
  // A jurisdiction area (docs/adr/0125) says whose airspace it is; it is not a block a flight is cleared into.
  if (definition.kind === 'JURISDICTION') {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `${definition.name || op.airspaceId} is a jurisdiction area, not an airspace a flight is cleared into`, strip };
  }
  const frequencyMhz = op.frequencyMhz !== undefined && op.frequencyMhz !== null
    ? op.frequencyMhz
    : (definition.controlFrequencyMhz || definition.workingFrequencyMhz || null);

  const blockCheck = _validateAltitudeBlock(op.altitudeBlock, definition);
  if (!blockCheck.ok) return { ok: false, reason: 'VALIDATION_ERROR', detail: blockCheck.detail, strip };

  const flightDataResult = ctx.flightDataStore.setWorkingFrequency(strip.flightDataId, frequencyMhz, { airspaceId: op.airspaceId, by });
  if (!flightDataResult.ok) return { ok: false, reason: flightDataResult.reason, detail: flightDataResult.detail, strip };

  strip.airspaceEntry = {
    airspaceId: op.airspaceId,
    frequencyMhz,
    // null means "the whole block", which is what an aircraft working
    // alone gets. It is deliberately not defaulted to the airspace's own
    // vertical limits: "unrestricted within the airspace" and "restricted
    // to exactly the airspace's limits" read the same on a Strip but mean
    // different things to the controller who has to deconflict later.
    altitudeBlock: op.altitudeBlock || null,
    approvedAt: ctx.clock.now(),
    approvedBy: by || null,
  };
  ctx.state.bump(strip, by);

  const warnings = airspace.state !== 'ACTIVE' ? [warn('AIRSPACE_NOT_ACTIVE')] : undefined;
  return { ok: true, strip, flightData: flightDataResult.flightData, warnings };
}

// The RANGE slice — a flight is approved onto an airspace's working
// frequency. Deliberately an ordinary Strip Mutation and NOT a
// coordination primitive: nothing crosses a Facility boundary, no
// replica is minted, and above all no jurisdiction moves (guide §4.7 /
// defect D17 — "the frequency is an attribute of the Strip; the
// controller is what moves"). The approving controller keeps the Strip.
module.exports = {
  kind: 'ApproveAirspaceEntry',
  undo: 'none', // docs/adr/0100 §1: airspace entry approval is not undoable
  // docs/adr/0119 (H136 VQ5 a): the Position working the Strip relays the using agency's permission (it holds the op kind,
  // JO 7110.65BB para 9-3-1 NOTE), or the using agency of this airspace grants it itself (14 CFR 73.15 (c)(2), para 9-3-1
  // b), with no op grant, on a Strip of its own Facility it may not hold (facility-rules.js `mayActBesideOwner`).
  authorize: (ctx, actingPositionId, op) => (ctx.rules.canMutate(actingPositionId, op.kind)
    || (!!op.airspaceId && ctx.rules.isAirspaceUsingAgency(actingPositionId, op.airspaceId)) ? null : { ok: false, reason: 'PERMISSION_DENIED' }),
  apply: (ctx, strip, op, meta) => _applyApproveAirspaceEntry(ctx, strip, op, meta.by),
};
