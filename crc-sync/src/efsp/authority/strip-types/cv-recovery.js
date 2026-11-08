'use strict';

// The carrier's recovery strip type (docs/adr/0156). The Marshal creates it (or receives a launch, converted in place);
// the flight's own Case, held on its Marshal-stack entry (`ctx.carrierCaseOf`), picks the chain:
//   Case I:      STACK (Marshal) -> CV_PATTERN (PriFly) -> DROPPED
//   Case II/III: STACK -> COMMENCED (Marshal) -> FINAL_APPROACH -> DIRTY -> BULLSEYE -> CV_PATTERN (lane) -> DROPPED
// CV_PATTERN is owned by PriFly in Case I and by the lanes in II/III: the Strip's owner acts, so the state lists both.

const CV_LANES = ['CV_APP1', 'CV_APP2'];

const RECOVERY_STATES = ['STACK', 'COMMENCED', 'FINAL_APPROACH', 'DIRTY', 'BULLSEYE', 'CV_PATTERN', 'DROPPED'];

const RECOVERY_STATE_OWNERS = {
  STACK:          ['CV_MARSHAL'],
  COMMENCED:      ['CV_MARSHAL'],
  FINAL_APPROACH: CV_LANES,
  DIRTY:          CV_LANES,
  BULLSEYE:       CV_LANES,
  CV_PATTERN:     ['CV_PRIFLY', ...CV_LANES],
};

const _present = (ctx, p) => ctx.isStaffed(p) || !!ctx.consolidatedAt(p);

/** The recovery NLA: one button per state (ADR 0156 §4, §5). Every trigger is a controller gesture. */
function computeRecoveryNla(strip, flightData, now, ctx) {
  const caseValue = ctx.carrierCaseOf(strip) || ctx.carrierCase();
  switch (strip.state) {
    case 'STACK':
      if (!ctx.carrierInStack(strip)) return { inhibited: 'not in the Marshal stack — give it a stack position first' };
      if (caseValue === 'I') {
        if (!_present(ctx, 'CV_PRIFLY')) return { inhibited: 'no receiving Position present' };
        return { toState: 'CV_PATTERN', transferTo: 'CV_PRIFLY', carrierHandoff: 'CASE_I_TO_PRIFLY' };
      }
      return { toState: 'COMMENCED', carrierHandoff: 'COMMENCE' };
    case 'COMMENCED': {
      const lane = ctx.carrierLaneFor(strip);
      if (!lane) return { inhibited: 'no receiving Position present' };
      return { toState: 'FINAL_APPROACH', transferTo: lane, carrierHandoff: 'TO_APPROACH' };
    }
    case 'FINAL_APPROACH': return { toState: 'DIRTY' };
    case 'DIRTY':          return { toState: 'BULLSEYE' };
    case 'BULLSEYE':       return { toState: 'CV_PATTERN' };
    case 'CV_PATTERN':     return { toState: 'DROPPED' };
    default:               return null;
  }
}

const family = {
  stripType: 'CV_RECOVERY',
  states: RECOVERY_STATES,
  initialState: 'STACK',
  stateOwners: RECOVERY_STATE_OWNERS,
  creatorOwnsInitialState: true,
  computeNla: computeRecoveryNla,
  countablePreDropStates: ['CV_PATTERN'],
  excludedWhenNotCountable: 'NEVER_LANDED',
  replicaStateOnReceipt: null,
  senderStateOnAccept: null,
  coordinationEligibleState: undefined,
  tofiEligibleState: undefined,
  splitEligibleStates: [],
  joinEligibleStates: [],
  groundStates: [],
};

module.exports = { family, CV_LANES, RECOVERY_STATES, RECOVERY_STATE_OWNERS, computeRecoveryNla };
