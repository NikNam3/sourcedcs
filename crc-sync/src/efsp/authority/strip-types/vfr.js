'use strict';

// The VFR strip-type family (docs/adr/0146, H174, H175 VR-Q1): the minimal VFR strip. A VFR aircraft navigates itself;
// what a controller keeps on it is the tag on its track (callsign and type, a code only if one was given), the heading,
// speed and altitude it was assigned, and the runway at the tower. No clearance steps, no release, no route: so no
// lifecycle either. The Strip is TRACKED from the moment a controller tags the track until "Radar service terminated"
// (or a drop) ends it.
//
// Who works it: its owner, whoever that is (`ownerWorksEveryState`, read by permission.js's canActOnState), because a VFR
// is tagged at any Position that sees the track and moves between Positions only by the STARS automated handoff
// (board/ops/vfr-handoff.js, JO 7110.65BB para 5-4-5, 5-4-6), never by a lifecycle step. No Position id is named
// (ADR 0132). Placement: a VFR strip sits in any Bay of its owner (`anyBay`, board/placement.js): the runway queue, the
// pattern, the overflight Bay; a Bay's implied state never applies to it.

const VFR_STATES = ['TRACKED', 'DROPPED'];

/** No next lifecycle action: the actions on a VFR strip are the handoff and "Radar service terminated". */
function computeVfrNla() { return null; }

const family = {
  stripType: 'VFR',
  states: VFR_STATES,
  initialState: 'TRACKED',
  stateOwners: {},
  ownerWorksEveryState: true,
  anyBay: true,
  computeNla: computeVfrNla,
  countablePreDropStates: ['TRACKED'], // a tagged VFR was worked (FAA traffic count counts VFR operations too)
  excludedWhenNotCountable: 'NEVER_TRACKED',
  replicaStateOnReceipt: null,
  senderStateOnAccept: null,
  coordinationEligibleState: undefined, // ADR 0146: handed off inside the Facility by VfrHandoff, not the cross-Facility primitives
  tofiEligibleState: undefined,
  splitEligibleStates: [],
  joinEligibleStates: [],
  groundStates: [],
};

module.exports = { family, VFR_STATES };
