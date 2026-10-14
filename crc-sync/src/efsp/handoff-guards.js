'use strict';

// The handoff guards (docs/adr/0122 §6): the seam ADR 0120 (the RSU) asked for. A guard is keyed on the RECEIVING
// Position and runs twice for a HANDOFF: at the offer (`phase: 'OFFER'`, PROPOSE) and again wherever control would move
// to the receiver (`phase: 'CONTROL'`: CHECKED_IN of a released handoff, a granted release on a checked-in aircraft, the
// control tick). It answers null (go on) or `{ reason, detail }`: a refusal code from refusal-codes.js and the sentence
// the controller reads. A refused PROPOSE, CHECKED_IN or GRANT is refused with that code; the control tick moves nothing
// and asks again on its next pass.
//
// Empty today. ADR 0120's IFR_NOT_CANCELLED (a handoff to the RSU of a flight with an ACTIVE assigned altitude or heading)
// is the first guard; U-RSU adds it here.
//
// Each guard: ({ phase, strip, flightData, receivingFacilityId, receivingPositionId }) => null | { reason, detail }.
// `strip` is the Strip the op or tick addresses (either side of the exchange; the transferring one at OFFER).

const HANDOFF_GUARDS = [];

/** The first guard's refusal, or null. */
function handoffGuardRefusal(ctx) {
  for (const guard of HANDOFF_GUARDS) {
    const refusal = guard(ctx);
    if (refusal) return refusal;
  }
  return null;
}

module.exports = { HANDOFF_GUARDS, handoffGuardRefusal };
