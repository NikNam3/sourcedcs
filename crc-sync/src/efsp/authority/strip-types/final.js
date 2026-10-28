'use strict';

// The FINAL strip-type family (authority registry, S3-2): the talk-down strip type, shared
// by the carrier lanes and PAR (L18). States and NLA moved from nla.js, state
// owners from permission.js. See marshal.js for the carrier strip types' naming rule.

const { CV_LANES } = require('./marshal');

const FINAL_STATES = ['ON_FINAL', 'BALL', 'BOLTER_WAVEOFF', 'DROPPED'];

const FINAL_STATE_OWNERS = {
  ON_FINAL:       CV_LANES,
  BALL:           CV_LANES,
  BOLTER_WAVEOFF: CV_LANES,
};

/**
 * FINAL's NLA table, shared by the carrier lanes and PAR. `alsoLegal` lists the states a drag may put the Strip in
 * besides the NLA's (a bolter, waveoff or missed approach is a drag to that Bay, ADR 0064 B2): board/placement.js's
 * Bay-implied check reads it, so the drag stays inside the state table.
 *
 * The carrier records "Ball" as its FINAL_TO_LSO handoff (a trigger type and Case rule of its own, ADR 0074). At an
 * airfield the final controller's part ends when the aircraft lands (docs/adr/0117; JO 7110.65BB para 5-12-8 d, 5-12-9):
 * the NLA is "Landed", the Strip going to GC as an ARRIVAL at TAXI_IN (H134 LT-RQ6 b) through transfer-strip.js's LANDED
 * conversion. BALL is the carrier's only: "Landing assured", which reused it at PAR (ADR 0075), is gone. A missed
 * approach (H137 LT-PQ1 a) is the FINAL line's own transfer to AP; a drag to PAR's missed-approach Bay (`alsoLegal`)
 * stays possible, for an AP nobody can take it at, and that Bay's NLA is the same transfer.
 */
function computeFinalNla(strip, flightData, now, ctx = {}) {
  switch (strip.state) {
    case 'ON_FINAL':
      if (ctx.facilityId === 'CARRIER') return { toState: 'BALL', carrierHandoff: 'FINAL_TO_LSO', alsoLegal: ['BOLTER_WAVEOFF'] };
      // Never inhibited on GC's staffing: that would also refuse the missed approach drag (alsoLegal). An unstaffed GC
      // nobody is offered refuses the transfer itself (NO_RECEIVING_POSITION).
      return { toState: 'TAXI_IN', transferTo: 'GC', alsoLegal: ['BOLTER_WAVEOFF'] };
    // "Trapped" (docs/adr/0137, live test U20): to PriFly's RECOVERED Bay, where PriFly drops it. BALL is the carrier's only.
    case 'BALL':           return { toState: 'RECOVERED', carrierHandoff: 'FINAL_TRAPPED', alsoLegal: ['BOLTER_WAVEOFF'] };
    case 'BOLTER_WAVEOFF':
      // The carrier's bolter or waveoff goes round to the final again (its own CV procedure, unchanged). At an airfield a
      // missed approach goes back to AP for another approach (H137 LT-PQ1 a, ours), the same transfer as the FINAL
      // line's Missed approach (par-final.js MISSED_APPROACH).
      if (ctx.facilityId === 'CARRIER') return { toState: 'ON_FINAL' };
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
  countablePreDropStates: ['BALL'],
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
