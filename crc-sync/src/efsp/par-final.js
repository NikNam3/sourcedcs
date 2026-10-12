'use strict';

// The PAR final at an airfield, as data (docs/adr/0117). Pure: no store, no clock.
//
// Two strip-type conversions, each an ordinary strip transfer (board/ops/transfer-strip.js) that changes the strip type
// IN PLACE (same Strip, same flight data, as ConvertToArrival does, ADR 0023) because the receiving Position works the
// flight on another strip type:
//
//   PAR_HANDOFF  AP hands the arrival to the final controller: ARRIVAL at INBOUND becomes FINAL at ON_FINAL with PAR.
//                An ordinary radar handoff (JO 7110.65BB para 5-4-5, 5-4-6); on a single frequency approach the pilot
//                does not change frequency (para 5-10-15 b, c), so the flight's frequency is never touched.
//   LANDED       the aircraft has landed: FINAL at ON_FINAL becomes ARRIVAL at TAXI_IN with GC (H134 LT-RQ6 b). The
//                final controller's part ends at touchdown, the pilot told "CONTACT (terminal control function)
//                (frequency, if required) AFTER LANDING" (para 5-12-9; para 5-12-8 d: "Pilots must remain on final
//                controller's frequency until touchdown"). The Strip leaves PAR, which frees the final Bay (T5).
//
// And the calls a final controller records on a FINAL Strip (op FinalCall), never on the carrier, which has its own:
//
//   BEGIN_DESCENT    "BEGIN DESCENT" (para 5-12-3): from here the reference is the glidepath, not an assigned altitude
//                    (para 5-12-4), so the call ends the assigned altitude (H134 LT-RQ8 a).
//   CLEARED_TO_LAND  the tower's clearance relayed: "(runway), WIND ..., CLEARED TO LAND" (para 5-10-13 a). A record,
//                    optional (H134 LT-RQ7 a). "Landing assured" was ours and is gone: no order uses the phrase.
//   LANDED           the LANDED conversion above, pressed on the FINAL line.

const CONVERSIONS = Object.freeze({
  PAR_HANDOFF: Object.freeze({
    trigger: 'CONTROLLER_INITIATED',
    stripType: 'ARRIVAL', state: 'INBOUND',
    toStripType: 'FINAL', toState: 'ON_FINAL',
    label: 'Hand off to PAR',
  }),
  LANDED: Object.freeze({
    trigger: 'CONTROLLER_INITIATED',
    stripType: 'FINAL', state: 'ON_FINAL',
    toStripType: 'ARRIVAL', toState: 'TAXI_IN',
    label: 'Landed',
  }),
});

const FINAL_CALLS = Object.freeze({
  BEGIN_DESCENT: Object.freeze({ label: 'Begin descent' }),
  CLEARED_TO_LAND: Object.freeze({ label: 'Cleared to land' }),
  LANDED: Object.freeze({ label: 'Landed', conversion: 'LANDED' }),
});

// The Facility whose FINAL is the carrier's: its own terminal steps (Ball, Waveoff, ADR 0064, 0074), none of these.
const CARRIER_FACILITY = 'CARRIER';

/**
 * The conversion a strip transfer makes, or null: the Strip's type and state match a conversion's, the receiving Bay
 * implies the converted state, and the Facility is an airfield (the carrier's FINAL has its own handoffs).
 */
function conversionFor(strip, targetImpliedState, facilityId) {
  if (!strip || facilityId === CARRIER_FACILITY || !targetImpliedState) return null;
  for (const [kind, c] of Object.entries(CONVERSIONS)) {
    if (strip.stripType === c.stripType && strip.state === c.state && targetImpliedState === c.toState) return { kind, ...c };
  }
  return null;
}

module.exports = { CONVERSIONS, FINAL_CALLS, CARRIER_FACILITY, conversionFor };
