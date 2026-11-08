'use strict';

// The carrier's launch strip type (docs/adr/0156): PriFly creates it on deck; in Case II and III departure control
// (CV_DEP) works it airborne to KILO. Whoever holds it last drops it or hands it to the Marshal, where it becomes the
// flight's CV_RECOVERY in place (carrier/handoffs.js). State names collide with no other strip type's but DROPPED
// (ADR 0074's rule): MISSION has AIRBORNE, so this one is CV_AIRBORNE.

const LAUNCH_STATES = ['ON_DECK', 'CV_AIRBORNE', 'KILO', 'DROPPED'];

const LAUNCH_STATE_OWNERS = {
  ON_DECK:     ['CV_PRIFLY'],
  CV_AIRBORNE: ['CV_DEP'],
  KILO:        ['CV_DEP'],
};

const _present = (ctx, p) => ctx.isStaffed(p) || !!ctx.consolidatedAt(p);

/**
 * The launch NLA. A launch takes the ship's Case at the moment PriFly launches it (ADR 0156 §2): Case I has no
 * departure control, so PriFly's button is DROP, with TO MARSHAL beside it (`alsoHandoff`); in II and III it is
 * LAUNCHED, to departure control. At KILO departure control has the same pair.
 */
function computeLaunchNla(strip, flightData, now, ctx) {
  switch (strip.state) {
    case 'ON_DECK': {
      if (ctx.carrierCase() === 'I') return { toState: 'DROPPED', alsoHandoff: 'LAUNCH_TO_MARSHAL' };
      if (!_present(ctx, 'CV_DEP')) return { inhibited: 'no receiving Position present' };
      return { toState: 'CV_AIRBORNE', transferTo: 'CV_DEP', carrierHandoff: 'LAUNCH_TO_DEPARTURE' };
    }
    case 'CV_AIRBORNE': return { toState: 'KILO' };
    case 'KILO':        return { toState: 'DROPPED', alsoHandoff: 'DEPARTURE_TO_MARSHAL' };
    default:            return null;
  }
}

const family = {
  stripType: 'CV_LAUNCH',
  states: LAUNCH_STATES,
  initialState: 'ON_DECK',
  stateOwners: LAUNCH_STATE_OWNERS,
  creatorOwnsInitialState: true,
  computeNla: computeLaunchNla,
  // A launch is a movement whichever state it is dropped from: a Case I launch has no airborne state (ADR 0156).
  countablePreDropStates: ['ON_DECK', 'CV_AIRBORNE', 'KILO'],
  excludedWhenNotCountable: 'NEVER_DEPARTED',
  replicaStateOnReceipt: null,
  senderStateOnAccept: null,
  coordinationEligibleState: undefined,
  tofiEligibleState: undefined,
  // docs/adr/0099 §4: never split or joined (carrier control is its own regime)
  splitEligibleStates: [],
  joinEligibleStates: [],
  groundStates: [],
};

module.exports = { family, LAUNCH_STATES, LAUNCH_STATE_OWNERS, computeLaunchNla };
