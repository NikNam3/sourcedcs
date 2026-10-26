'use strict';
import { COORDINATION_ELIGIBLE_STATES } from '../efsp-nla.js';
import { facilityOfPosition } from '../facility-topology.js';


// ── WP4A: cross-Facility coordination (guide §4.6, docs/adr/0015-0016) ──
//
// Only HANDOFF/POINT_OUT/TRAFFIC/OPERATIONAL_REQUEST/AIT — the 5 primitives
// crc-sync's authority tables grant exclusively to AP/CTR (§4.6, this slice's civil
// ATC<->ATC scope). No MRU-refusal audit is needed yet: no MRU Position
// exists this slice (docs/adr/0020's deferral) — gating the Coordinate
// button to AP/CTR only is what D12 will extend once one does.
//
// Target Facility/Position is DETERMINISTIC this slice — there are only
// two Facilities, and each of AP/CTR has exactly one counterpart on the
// other side. A real multi-Facility topology would need a picker; this
// slice deliberately doesn't build one it can't yet exercise.
export const COORDINATION_TARGETS = {
  AP: { facilityId: facilityOfPosition('CTR'), positionId: 'CTR' },
  CTR: { facilityId: facilityOfPosition('AP'), positionId: 'AP' },
};

// docs/adr/0101 (DR-3): APP or CTR may also hand an ARRIVAL in its coordination-eligible state to the carrier's Marshal (the Strip never leaves
// the EFSP). The only primitive it takes is a HANDOFF; the server refuses the rest ("CV_MARSHAL does not take ...").
export const CARRIER_HANDOFF_TARGET = { facilityId: facilityOfPosition('CV_MARSHAL'), positionId: 'CV_MARSHAL' };
export const CARRIER_HANDOFF_STRIP_TYPE = 'ARRIVAL';

/** Can this Strip be handed to the Marshal? (A key of COORDINATION_TARGETS holding an ARRIVAL in that state.) */
export function canHandOffToCarrier(strip) {
  return !!COORDINATION_TARGETS[strip.ownerPositionId]
    && strip.stripType === CARRIER_HANDOFF_STRIP_TYPE && strip.state === COORDINATION_ELIGIBLE_STATES[CARRIER_HANDOFF_STRIP_TYPE];
}

// ── WP4A second slice: TOFI (guide §4.6.3) — a genuinely different
// sub-protocol from the 5 primitives above, not a 6th COORDINATION_TARGETS
// entry (see crc-sync's board/tofi.js for the full list of
// structural differences: two independent exchanges per Strip, a distinct
// comms-transfer action, no jurisdiction transfer ever, a different strip
// type on the receiving side sharing one flightDataId).
//
// Unlike COORDINATION_TARGETS' fixed 1:1 stub, TOFI genuinely needs a
// picker: per the guide's own §4.1 Position table, TOFI is listed only for
// CTR among the ATC Positions built so far (not AP), but the MRU side has
// TWO candidates (TAC_C2, GCI) — CTR-initiated TOFI must let the controller
// choose. TAC_C2/GCI-initiated TOFI has exactly one candidate (CTR) and
// skips the picker, behaving like today's deterministic stub.
const at = (positionId) => ({ facilityId: facilityOfPosition(positionId), positionId });
export const TOFI_COUNTERPARTS = {
  CTR:    [at('TAC_C2'), at('GCI')],
  TAC_C2: [at('CTR')],
  GCI:    [at('CTR')],
};
// H2 / H40 (docs/adr/0080): the Positions a working tactical Position may hand
// a line back to — the only place it may transfer one. A mirror of
// crc-sync's TACTICAL_CAPABILITIES[*].handBackTo (authority/positions/tactical.js), held to it by
// client-mirror-parity.test.mjs (the efsp-nla-client.test.mjs precedent). A
// holder of only JTAC has no TAC_C2 tab to drag to, so the ⋯ menu offers it.
export const HAND_BACK_TO = { AIC: ['TAC_C2'], JTAC: ['TAC_C2'] };

// B2 (docs/adr/0080): AIC "works under TAC_C2's TOFI", so on an AIC-held line
// the TOFI dialogue is TAC_C2's. Mirror of crc-sync's TACTICAL_CAPABILITIES (authority/positions/tactical.js)
// `tofiAnsweredBy`, held to it by the drift test in efsp-ui-reachability.test.mjs.
export const TOFI_ANSWERED_BY = { AIC: 'TAC_C2' };

export const AIRSPACE_ENTRY_POSITIONS = ['AP', 'CTR'];

// The Positions the server lets convert a DEPARTURE into its return ARRIVAL:
// they need both the ConvertToArrival op (authority/op-kinds.js) and the right to
// create an ARRIVAL Strip (canCreateStripType). efsp-coordination-client.test.mjs
// holds this to the server's tables.
export const CONVERT_TO_ARRIVAL_POSITIONS = ['AP', 'CTR'];

// crc-sync H136 (docs/wip/LT-VFR.md): the radar Positions that start and terminate flight following (StartFlightFollowing,
// TerminateRadarService, AP_CTR_ONLY_OP_KINDS, and the right to create an OVERFLIGHT Strip). Held to the server by
// efsp-flight-following-client.test.mjs.
export const FLIGHT_FOLLOWING_POSITIONS = ['AP', 'CTR'];

// crc-sync docs/adr/0143 (H166): the Positions that make a VFR departure (CreateVfrDeparture: the grant, the right to
// create a DEPARTURE and to own its CLEARED state). Held to the server by efsp-vfr-departure-client.test.mjs. A mirror
// by id until the server sends roles (U-ROLE-POSITIONS, ADR 0132).
export const VFR_DEPARTURE_POSITIONS = ['CD'];
