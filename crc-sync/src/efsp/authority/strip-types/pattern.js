'use strict';

// The PATTERN strip-type family (authority registry, S3-2): the carrier's visual-pattern
// strip type (PriFly). The airfield's pattern is LC's, on ordinary Strips (docs/adr/0126). States and NLA moved from nla.js, state
// owners from permission.js. See marshal.js for the carrier strip types' naming rule.

const PATTERN_STATES = ['IN_PATTERN', 'RECOVERED', 'DROPPED'];

const PATTERN_STATE_OWNERS = {
  IN_PATTERN: ['CV_PRIFLY'],
  RECOVERED:  ['CV_PRIFLY'],
};

/** PATTERN's NLA table: pattern legs are Racks, not states (ADR 0064 B2). */
function computePatternNla(strip) {
  switch (strip.state) {
    case 'IN_PATTERN': return { toState: 'RECOVERED' };
    case 'RECOVERED':  return { toState: 'DROPPED' };
    case 'DROPPED':
    default:           return null;
  }
}

const family = {
  stripType: 'PATTERN',
  states: PATTERN_STATES,
  initialState: 'IN_PATTERN',
  stateOwners: PATTERN_STATE_OWNERS,
  computeNla: computePatternNla,
  countablePreDropStates: ['RECOVERED'],
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

module.exports = { family, PATTERN_STATES, PATTERN_STATE_OWNERS, computePatternNla };
