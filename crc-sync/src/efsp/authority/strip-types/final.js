'use strict';

// The FINAL Role family (authority registry, S3-2): the talk-down Role, shared
// by the carrier lanes and PAR (L18). States and NLA moved from nla.js, state
// owners from permission.js. See marshal.js for the carrier Roles' naming rule.

const { CV_LANES } = require('./marshal');

const FINAL_STATES = ['ON_FINAL', 'BALL', 'BOLTER_WAVEOFF', 'DROPPED'];

const FINAL_STATE_OWNERS = {
  ON_FINAL:       CV_LANES,
  BALL:           CV_LANES,
  BOLTER_WAVEOFF: CV_LANES,
};

/**
 * FINAL's NLA table. Shared with PAR (L18), which either adds a terminal state
 * or reuses BALL under a neutral label. `alsoLegal` lists the states a drag may
 * put the Strip in besides the NLA's (a bolter or waveoff is a drag to the
 * Bolter Bay, ADR 0064 B2): board-store.js's Bay-implied check reads it, so the
 * drag stays inside the state table.
 */
function computeFinalNla(strip, flightData, now, ctx = {}) {
  switch (strip.state) {
    case 'ON_FINAL':
      // The carrier records "Ball" as its FINAL_TO_LSO handoff (a trigger type
      // and Case rule of its own, ADR 0074). PAR's "Landing assured" (ADR 0075)
      // is the same state change with nothing to hand over: PAR is not a carrier
      // Position, and that transfer would refuse it by its `from` list.
      return ctx.facilityId === 'CARRIER'
        ? { toState: 'BALL', carrierHandoff: 'FINAL_TO_LSO', alsoLegal: ['BOLTER_WAVEOFF'] }
        : { toState: 'BALL', alsoLegal: ['BOLTER_WAVEOFF'] };
    case 'BALL':           return { toState: 'DROPPED', alsoLegal: ['BOLTER_WAVEOFF'] }; // "Trapped"
    case 'BOLTER_WAVEOFF': return { toState: 'ON_FINAL' };
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
};

module.exports = { family, FINAL_STATES, FINAL_STATE_OWNERS, computeFinalNla };
