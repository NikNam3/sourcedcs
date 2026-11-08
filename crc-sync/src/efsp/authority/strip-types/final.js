'use strict';

// The FINAL strip-type family (authority registry, S3-2): PAR's talk-down strip type (L18). The carrier used it until
// docs/adr/0156 (its approach is now CV_RECOVERY's FINAL_APPROACH, DIRTY, BULLSEYE). PAR's state owners come from
// positions/incirlik-military.js's `ownsStates`.

const FINAL_STATES = ['ON_FINAL', 'BOLTER_WAVEOFF', 'DROPPED'];

const FINAL_STATE_OWNERS = {};

/**
 * FINAL's NLA table (PAR). `alsoLegal` lists the states a drag may put the Strip in
 * besides the NLA's (a bolter, waveoff or missed approach is a drag to that Bay, ADR 0064 B2): board/placement.js's
 * Bay-implied check reads it, so the drag stays inside the state table.
 *
 * The final controller's part ends when the aircraft lands (docs/adr/0117; JO 7110.65BB para 5-12-8 d, 5-12-9):
 * the NLA is "Landed", the Strip going to GC as an ARRIVAL at TAXI_IN (H134 LT-RQ6 b) through transfer-strip.js's LANDED
 * conversion. BALL went with the carrier's use (docs/adr/0156). A missed
 * approach (H137 LT-PQ1 a) is the FINAL line's own transfer to AP; a drag to PAR's missed-approach Bay (`alsoLegal`)
 * stays possible, for an AP nobody can take it at, and that Bay's NLA is the same transfer.
 */
function computeFinalNla(strip, flightData, now, ctx = {}) {
  switch (strip.state) {
    case 'ON_FINAL':
      // Never inhibited on GC's staffing: that would also refuse the missed approach drag (alsoLegal). An unstaffed GC
      // nobody is offered refuses the transfer itself (NO_RECEIVING_POSITION).
      return { toState: 'TAXI_IN', transferTo: 'GC', alsoLegal: ['BOLTER_WAVEOFF'] };
    case 'BOLTER_WAVEOFF':
      // A missed approach goes back to AP for another approach (H137 LT-PQ1 a, ours), the same transfer as the FINAL
      // line's Missed approach (par-final.js MISSED_APPROACH).
      return { toState: 'INBOUND', transferTo: 'AP' };
    case 'DROPPED':
    default:               return null;
  }
}

const family = {
  stripType: 'FINAL',
  states: FINAL_STATES,
  initialState: 'ON_FINAL',
  stateOwners: FINAL_STATE_OWNERS,
  computeNla: computeFinalNla,
  countablePreDropStates: [],
  excludedWhenNotCountable: 'NEVER_LANDED',
  replicaStateOnReceipt: null,
  senderStateOnAccept: null,
  coordinationEligibleState: undefined,
  tofiEligibleState: undefined,
  // docs/adr/0099 §4: never split or joined (MARSA records nothing; carrier control is its own regime)
  splitEligibleStates: [],
  joinEligibleStates: [],
  groundStates: [],
};

module.exports = { family, FINAL_STATES, FINAL_STATE_OWNERS, computeFinalNla };
