'use strict';


// ── WP4A: cross-Facility coordination (guide §4.6, docs/adr/0015-0016) ──
//
// Only HANDOFF/POINT_OUT/TRAFFIC/OPERATIONAL_REQUEST/AIT — the 5 primitives
// permission.js grants exclusively to APP/CTR (§4.6, this slice's civil
// ATC<->ATC scope). No MRU-refusal audit is needed yet: no MRU Position
// exists this slice (docs/adr/0020's deferral) — gating the Coordinate
// button to APP/CTR only is what D12 will extend once one does.
//
// Target Facility/Position is DETERMINISTIC this slice — there are only
// two Facilities, and each of APP/CTR has exactly one counterpart on the
// other side. A real multi-Facility topology would need a picker; this
// slice deliberately doesn't build one it can't yet exercise.
export const COORDINATION_TARGETS = {
  AP: { facilityId: 'CENTER', positionId: 'CTR' },
  CTR: { facilityId: 'INCIRLIK', positionId: 'AP' },
};

// ── WP4A second slice: TOFI (guide §4.6.3) — a genuinely different
// sub-protocol from the 5 primitives above, not a 6th COORDINATION_TARGETS
// entry (see crc-sync's board-store.js module comment for the full list of
// structural differences: two independent exchanges per Strip, a distinct
// comms-transfer action, no jurisdiction transfer ever, a different Strip
// Role on the receiving side sharing one flightDataId).
//
// Unlike COORDINATION_TARGETS' fixed 1:1 stub, TOFI genuinely needs a
// picker: per the guide's own §4.1 Position table, TOFI is listed only for
// CTR among the ATC Positions built so far (not APP), but the MRU side has
// TWO candidates (TAC_C2, GCI) — CTR-initiated TOFI must let the controller
// choose. TAC_C2/GCI-initiated TOFI has exactly one candidate (CTR) and
// skips the picker, behaving like today's deterministic stub.
export const TOFI_COUNTERPARTS = {
  CTR:    [{ facilityId: 'TACTICAL', positionId: 'TAC_C2' }, { facilityId: 'TACTICAL', positionId: 'GCI' }],
  TAC_C2: [{ facilityId: 'CENTER', positionId: 'CTR' }],
  GCI:    [{ facilityId: 'CENTER', positionId: 'CTR' }],
};
// H2 / H40 (docs/adr/0080): the Positions a working tactical Position may hand
// a line back to — the only place it may transfer one. A mirror of
// permission.js's TACTICAL_CAPABILITIES[*].handBackTo, held to it by
// efsp-tactical-client.test.js (the efsp-nla-client.test.js precedent). A
// holder of only JTAC has no TAC_C2 tab to drag to, so the ⋯ menu offers it.
export const HAND_BACK_TO = { AIC: ['TAC_C2'], JTAC: ['TAC_C2'] };

// B2 (docs/adr/0080): AIC "works under TAC_C2's TOFI", so on an AIC-held line
// the TOFI dialogue is TAC_C2's. Mirror of permission.js's TACTICAL_CAPABILITIES
// `tofiAnsweredBy`, held to it by the drift test in efsp-ui-reachability.test.js.
export const TOFI_ANSWERED_BY = { AIC: 'TAC_C2' };

export const AIRSPACE_ENTRY_POSITIONS = ['AP', 'CTR'];

// The Positions the server lets convert a DEPARTURE into its return ARRIVAL:
// they need both the ConvertToArrival op (permission.js) and the right to
// create an ARRIVAL Strip (canCreateStripType). efsp-coordination-client.test.js
// holds this to the server's tables.
export const CONVERT_TO_ARRIVAL_POSITIONS = ['AP', 'CTR'];
