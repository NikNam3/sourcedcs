'use strict';

// Who may approve or clear a flight's entry into an airspace (docs/adr/0119, H136 VQ5 a; the ops are
// board/ops/approve-airspace-entry.js and clear-airspace-entry.js). The ownership half is facility-rules.js's
// `mayActBesideOwner`: the using agency acts on a Strip of its own Facility it does not hold.

/**
 * Who may send an entry op (docs/adr/0119, H136 VQ5 a): a Position holding the op kind (the Position working the Strip,
 * relaying the using agency's permission, JO 7110.65BB para 9-3-1 NOTE), or the airspace's using agency itself (14 CFR
 * 73.15 (c)(2), para 9-3-1 b), which needs no op grant. An approval names its airspace, so it is checked here; a clear
 * names none until the Strip is read, so `usingAgencyGate` checks it in `apply`.
 */
function authorize(ctx, actingPositionId, op) {
  if (ctx.rules.canMutate(actingPositionId, op.kind)) return null;
  if (op.kind === 'ClearAirspaceEntry' || ctx.rules.isAirspaceUsingAgency(actingPositionId, op.airspaceId)) return null;
  return { ok: false, reason: 'PERMISSION_DENIED' };
}

/** The apply-time half of `authorize`: without the op grant, only the using agency of this airspace. Null when allowed. */
function usingAgencyGate(ctx, actingPositionId, kind, airspaceId, airspace, strip) {
  if (!actingPositionId || ctx.rules.canMutate(actingPositionId, kind)) return null;
  if (ctx.rules.isAirspaceUsingAgency(actingPositionId, airspaceId)) return null;
  const name = (airspace && airspace.definition && airspace.definition.name) || airspaceId;
  return { ok: false, reason: 'PERMISSION_DENIED', detail: `${actingPositionId} is not the using agency for ${name}`, strip };
}

module.exports = { authorize, usingAgencyGate };
