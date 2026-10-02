'use strict';

// The MISSION strip-type family (authority registry, docs/adr/0095): states,
// NLA table and state owners.

// [SOURCE-DEFINED] — the guide's own mission lifecycle (the lifecycle list
// under §3.4's [SOURCE-DEFINED] heading; §9.8 names it too). No staffing/
// transferTo gating, same reasoning as OVERFLIGHT's own table: TAC_C2/GCI
// (whichever originated the mission, or received it via a TOFI ENTRY
// exchange) work its entire lifecycle solo — the cross-Position richness
// (AR-line/tanker join, ATO binding) is exactly the WP7 scope deferred by
// this slice's own scope-cut ADR.
const MISSION_STATES = ['TASKED', 'AIRBORNE', 'ON_STATION', 'OFF_STATION', 'RTB', 'DROPPED'];

// [SOURCE-DEFINED] (WP4A second slice) — MISSION has no guide-published
// state-ownership table (§9.8 only names the lifecycle, which is §3.4's lifecycle list);
// mirrors OVERFLIGHT_STATE_OWNERS' "self-originator owns it" precedent —
// whichever Position originated the mission (CREATE_STRIP_TYPE_PERMISSIONS
// above) works its entire lifecycle solo. AIC/JTAC deliberately absent:
// AIC works under TAC_C2's TOFI rather than owning state transitions
// itself; JTAC's absence alone is what makes it read-only (guide §4.1:
// "MISSION (read-only)"), no separate mechanism needed.
const MISSION_STATE_OWNERS = {
  TASKED:     ['TAC_C2', 'GCI'],
  AIRBORNE:   ['TAC_C2', 'GCI'],
  ON_STATION: ['TAC_C2', 'GCI'],
  OFF_STATION: ['TAC_C2', 'GCI'],
  RTB:        ['TAC_C2', 'GCI'],
  // DROPPED is terminal — no NLA exists for it, so no entry is needed.
};

/**
 * MISSION's entire NLA table (WP4A second slice) — a simple linear
 * progression through the guide's own 6-state lifecycle (§9.8), no
 * staffing gating, no transferTo — same shape as computeOverflightNla,
 * for the same reason (the cross-Position richness a real mission-line
 * panel would need is WP7 scope, deferred by this slice's scope-cut ADR).
 */
function computeMissionNla(strip) {
  switch (strip.state) {
    case 'TASKED':      return { toState: 'AIRBORNE' };
    case 'AIRBORNE':    return { toState: 'ON_STATION' };
    case 'ON_STATION':  return { toState: 'OFF_STATION' };
    case 'OFF_STATION': return { toState: 'RTB' };
    case 'RTB':         return { toState: 'DROPPED' };
    case 'DROPPED':
    default:            return null;
  }
}

const family = {
  stripType: 'MISSION',
  states: MISSION_STATES,
  initialState: 'TASKED',
  stateOwners: MISSION_STATE_OWNERS,
  computeNla: computeMissionNla,
  countablePreDropStates: [],                             // never: shares its flight data with the ATC Strip TOFI linked it to
  excludedWhenNotCountable: 'MISSION_LINE',
  replicaStateOnReceipt: null,
  senderStateOnAccept: null,
  // MISSION is deliberately absent from both eligibility tables: it is the
  // MRU-side strip type TOFI *creates*, never a strip type that opens an exchange of its
  // own (docs/adr/0026).
  coordinationEligibleState: undefined,
  tofiEligibleState: undefined,
};

module.exports = { family, MISSION_STATES, MISSION_STATE_OWNERS, computeMissionNla };
