'use strict';

// The carrier's recovery strip type (docs/adr/0156). The Marshal creates it (or receives a launch, converted in place);
// the flight's own Case, held on its Marshal-stack entry (`ctx.carrierCaseOf`), picks the chain (docs/adr/0157):
//   Case I:      STACK (Marshal) -SGNL C-> SIGNAL_CHARLIE (PriFly) -TRAPPED-> CV_LAUNCH ON_DECK (PriFly)
//                                                     BOLTER: stays SIGNAL_CHARLIE
//   Case II/III: STACK -> COMMENCED (Marshal) -> FINAL_APPROACH -> DIRTY -> BULLSEYE (lane) -TRAPPED-> CV_LAUNCH ON_DECK (PriFly)
//                                                     BOLTER: CV_PATTERN (lane), which offers TRAPPED / BOLTER again
// There is no pattern in Case I (the human, 2026-11-10): SIGNAL_CHARLIE is "cleared to land", PriFly's alone. The trap is
// the landing; the drop of the launch it became ends the Strip.

const CV_LANES = ['CV_APP1', 'CV_APP2'];

const RECOVERY_STATES = ['STACK', 'COMMENCED', 'FINAL_APPROACH', 'DIRTY', 'BULLSEYE', 'CV_PATTERN', 'SIGNAL_CHARLIE', 'DROPPED'];

const RECOVERY_STATE_OWNERS = {
  STACK:          ['CV_MARSHAL'],
  COMMENCED:      ['CV_MARSHAL'],
  FINAL_APPROACH: CV_LANES,
  DIRTY:          CV_LANES,
  BULLSEYE:       CV_LANES,
  CV_PATTERN:     CV_LANES,
  SIGNAL_CHARLIE: ['CV_PRIFLY'],
};

const _present = (ctx, p) => ctx.isStaffed(p) || !!ctx.consolidatedAt(p);

/**
 * The end of an approach (ADR 0157): TRAPPED is the NLA, BOLTER the other button beside it (`also`). In Case II/III the
 * trap hands the jet to PriFly, so it is inhibited while PriFly is not present (staffed or consolidated); the bolter never is.
 */
function _trapOrBolter(sequenced, ctx) {
  if (!sequenced) {
    return { toState: 'ON_DECK', carrierHandoff: 'CASE_I_TRAPPED', also: [{ carrierHandoff: 'CASE_I_BOLTER', toState: 'SIGNAL_CHARLIE' }] };
  }
  const also = [{ carrierHandoff: 'BOLTER', toState: 'CV_PATTERN' }];
  if (!_present(ctx, 'CV_PRIFLY')) return { inhibited: 'no receiving Position present', also };
  return { toState: 'ON_DECK', transferTo: 'CV_PRIFLY', carrierHandoff: 'TRAPPED', also };
}

/** The recovery NLA (ADR 0156 §4, §5; ADR 0157), with its `also` buttons. Every trigger is a controller gesture. */
function computeRecoveryNla(strip, flightData, now, ctx) {
  const caseValue = ctx.carrierCaseOf(strip) || ctx.carrierCase();
  switch (strip.state) {
    case 'STACK':
      if (!ctx.carrierInStack(strip)) return { inhibited: 'not in the Marshal stack — give it a stack position first' };
      if (caseValue === 'I') {
        if (!_present(ctx, 'CV_PRIFLY')) return { inhibited: 'no receiving Position present' };
        return { toState: 'SIGNAL_CHARLIE', transferTo: 'CV_PRIFLY', carrierHandoff: 'CASE_I_TO_PRIFLY' };
      }
      return { toState: 'COMMENCED', carrierHandoff: 'COMMENCE' };
    case 'COMMENCED': {
      const lane = ctx.carrierLaneFor(strip);
      if (!lane) return { inhibited: 'no receiving Position present' };
      return { toState: 'FINAL_APPROACH', transferTo: lane, carrierHandoff: 'TO_APPROACH' };
    }
    case 'FINAL_APPROACH': return { toState: 'DIRTY' };
    case 'DIRTY':          return { toState: 'BULLSEYE' };
    case 'BULLSEYE':
    case 'CV_PATTERN':     return _trapOrBolter(true, ctx);
    case 'SIGNAL_CHARLIE': return _trapOrBolter(false, ctx);
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
  // The trap is the landing, and a trapped recovery is a launch from then on (ADR 0157): its drop is counted as CV_LAUNCH's.
  // A recovery that is dropped (a divert, an error) never landed here.
  countablePreDropStates: [],
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
