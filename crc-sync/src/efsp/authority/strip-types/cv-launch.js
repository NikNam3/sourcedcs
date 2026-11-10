'use strict';

// The carrier's launch strip type (docs/adr/0156): PriFly creates it on deck; in Case II and III departure control
// (CV_DEP) works it airborne to KILO. Whoever holds it last drops it or hands it to the Marshal, where it becomes the
// flight's CV_RECOVERY in place (carrier/handoffs.js). A recovery that traps becomes one again, ON_DECK (docs/adr/0157). State names collide with no other strip type's but DROPPED
// (ADR 0074's rule): MISSION has AIRBORNE, so this one is CV_AIRBORNE.

const LAUNCH_STATES = ['ON_DECK', 'CV_AIRBORNE', 'KILO', 'DROPPED'];

const LAUNCH_STATE_OWNERS = {
  ON_DECK:     ['CV_PRIFLY'],
  CV_AIRBORNE: ['CV_DEP'],
  KILO:        ['CV_DEP'],
};

const _present = (ctx, p) => ctx.isStaffed(p) || !!ctx.consolidatedAt(p);

/** A handoff to the Marshal beside the NLA, inhibited while no Marshal is present (staffed or consolidated). */
function _toMarshal(kind, ctx) {
  const item = { carrierHandoff: kind, toState: 'STACK' };
  if (!_present(ctx, 'CV_MARSHAL')) item.inhibited = 'no receiving Position present';
  return item;
}

/**
 * The launch NLA, with the buttons beside it (`also`, docs/adr/0157). A launch takes the ship's Case at the moment PriFly
 * launches it (ADR 0156 §2): Case I has no departure control, so PriFly's button is DROP, with TO MARSHAL beside it; in II
 * and III it is LAUNCHED, to departure control, with DROP beside it (a trapped jet that stays on deck, ADR 0157), which stays
 * when LAUNCHED is inhibited. At KILO departure control has DROP and TO MARSHAL.
 */
function computeLaunchNla(strip, flightData, now, ctx) {
  switch (strip.state) {
    case 'ON_DECK': {
      if (ctx.carrierCase() === 'I') return { toState: 'DROPPED', also: [_toMarshal('LAUNCH_TO_MARSHAL', ctx)] };
      const also = [{ toState: 'DROPPED' }];
      if (!_present(ctx, 'CV_DEP')) return { inhibited: 'no receiving Position present', also };
      return { toState: 'CV_AIRBORNE', transferTo: 'CV_DEP', carrierHandoff: 'LAUNCH_TO_DEPARTURE', also };
    }
    case 'CV_AIRBORNE': return { toState: 'KILO' };
    case 'KILO':        return { toState: 'DROPPED', also: [_toMarshal('DEPARTURE_TO_MARSHAL', ctx)] };
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
