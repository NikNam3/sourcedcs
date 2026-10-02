'use strict';

const { _validateAltitudeBlock } = require('../strip-util');

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
  const frequencyMhz = op.frequencyMhz !== undefined && op.frequencyMhz !== null
    ? op.frequencyMhz
    : (definition.controlFrequencyMhz || definition.workingFrequencyMhz || null);

  const blockCheck = _validateAltitudeBlock(op.altitudeBlock, definition);
  if (!blockCheck.ok) return { ok: false, reason: 'VALIDATION_ERROR', detail: blockCheck.detail, strip };

  const fdrResult = ctx.fdrStore.setWorkingFrequency(strip.fdrId, frequencyMhz, { airspaceId: op.airspaceId, by });
  if (!fdrResult.ok) return { ok: false, reason: fdrResult.reason, detail: fdrResult.detail, strip };

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

  const warning = airspace.state !== 'ACTIVE' ? 'AIRSPACE_NOT_ACTIVE' : undefined;
  return { ok: true, strip, fdr: fdrResult.fdr, warning };
}

// The RANGE slice — a flight is approved onto an airspace's working
// frequency. Deliberately an ordinary Strip Mutation and NOT a
// coordination primitive: nothing crosses a Facility boundary, no
// replica is minted, and above all no jurisdiction moves (guide §4.7 /
// defect D17 — "the frequency is an attribute of the Strip; the
// controller is what moves"). The approving controller keeps the Strip.
module.exports = {
  kind: 'ApproveAirspaceEntry',
  apply: (ctx, strip, op, meta) => _applyApproveAirspaceEntry(ctx, strip, op, meta.by),
};
