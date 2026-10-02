'use strict';

// The PATTERN Role family (authority registry, S3-2): the visual-pattern Role,
// shared by PriFly and RSU (L18). States and NLA moved from nla.js, state
// owners from permission.js. See marshal.js for the carrier Roles' naming rule.

const PATTERN_STATES = ['IN_PATTERN', 'RECOVERED', 'DROPPED'];

const PATTERN_STATE_OWNERS = {
  IN_PATTERN: ['CV_PRIFLY'],
  RECOVERED:  ['CV_PRIFLY'],
};

/** PATTERN's NLA table: pattern legs are Racks, not states (ADR 0064 B2). Shared with RSU (L18). */
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
};

module.exports = { family, PATTERN_STATES, PATTERN_STATE_OWNERS, computePatternNla };
