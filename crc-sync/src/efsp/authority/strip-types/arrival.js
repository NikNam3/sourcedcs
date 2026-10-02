'use strict';

// The ARRIVAL strip-type family (authority registry, docs/adr/0095): states,
// NLA table and state owners.

const { _runwayInhibit } = require('./nla-common');

// [SOURCE-DEFINED], per guide §3.4's arrival lifecycle:
// INBOUND -> HANDED_TO_TOWER -> FINAL -> LANDED -> TAXI_IN -> DROPPED.
// NOTE: the state 'FINAL' here (a value of strip.state) is unrelated to the
// strip type 'FINAL' (guide §7.10's PAR/carrier stripType, strip-types/final.js,
// a value of strip.stripType) — they share the string but are different fields
// on different objects. Don't conflate them.
const ARRIVAL_STATES = ['INBOUND', 'HANDED_TO_TOWER', 'FINAL', 'LANDED', 'TAXI_IN', 'DROPPED'];

// [SOURCE-DEFINED] — ARRIVAL has no guide-published "normally owned by"
// table (§3.4 only gives the state sequence); this mirrors the same
// per-Position-per-lifecycle-stage shape as DEPARTURE's guide-given one.
const ARRIVAL_STATE_OWNERS = {
  // CTR added (docs/adr/0014) — a CENTER-held INBOUND Strip (CTR's own
  // local origination, mirroring AP's original ADR 0008 stub) needs its
  // owning Position authorized to act on it too, even though "acting on
  // it" now means proposing a cross-Facility HANDOFF via the Coordinate
  // button rather than an ordinary NLA transfer (computeArrivalNla's
  // INBOUND case below is Facility-aware).
  INBOUND:         ['AP', 'CTR'],
  HANDED_TO_TOWER: ['LC'],
  FINAL:           ['LC'],
  LANDED:          ['LC'],
  TAXI_IN:         ['GC'],
};

/** [SOURCE-DEFINED] ARRIVAL lifecycle NLA (docs/adr/0008) — same shape as DEPARTURE's table above. */
function computeArrivalNla(strip, flightData, now, ctx) {
  switch (strip.state) {
    case 'INBOUND':
      // WP4A (docs/adr/0014): a CENTER-held INBOUND Strip's next step is
      // the cross-Facility HANDOFF to AP — a genuinely different
      // mechanism (guide §4.6, "a different mechanism entirely"), fired
      // via the Coordinate button/dispatch path, not this ordinary
      // intrafacility-transfer NLA. There is no LC Position at CENTER to
      // transfer to at all, so this branches BEFORE attempting the
      // INCIRLIK-only LC-staffing check below. Every caller that never
      // sets ctx.facilityId (every pre-WP4A call site, and every
      // INCIRLIK-scoped one) is unaffected.
      if (ctx.facilityId === 'CENTER') {
        return { inhibited: 'cross-Facility HANDOFF required — use Coordinate' };
      }
      if (!ctx.isStaffed('LC') && !ctx.consolidatedAt('LC')) {
        return { inhibited: 'no receiving Position present' };
      }
      return { toState: 'HANDED_TO_TOWER', transferTo: 'LC' };

    case 'HANDED_TO_TOWER': {
      // §9.7 rule 1, the landing half: no clearance onto final for a runway
      // that is suspended or closed. The Strip waits (decisions.md H19).
      const runway = _runwayInhibit(strip, flightData, ctx);
      if (runway) return { inhibited: runway };
      return { toState: 'FINAL' };
    }

    case 'FINAL':
      // Never inhibited by runway status, deliberately: LANDED is an
      // OBSERVATION that the aircraft touched down, not a clearance. Refusing
      // it would make the board lie about something that already happened
      // and strand a landed aircraft with no legal transition.
      return { toState: 'LANDED' };

    case 'LANDED':
      if (!ctx.isStaffed('GC') && !ctx.consolidatedAt('GC')) {
        return { inhibited: 'no receiving Position present' };
      }
      return { toState: 'TAXI_IN', transferTo: 'GC' };

    case 'TAXI_IN':
      // Matches DEPARTURE's own HANDED_OFF -> DROPPED precedent — a plain
      // state transition, not the fuller DropStrip op (which sets the
      // Remove Strip Indicator flag too; this is the terminal NLA step).
      return { toState: 'DROPPED' };

    case 'DROPPED':
    default:
      return null;
  }
}

const family = {
  stripType: 'ARRIVAL',
  states: ARRIVAL_STATES,
  initialState: 'INBOUND',
  stateOwners: ARRIVAL_STATE_OWNERS,
  computeNla: computeArrivalNla,
  countablePreDropStates: ['LANDED', 'TAXI_IN'],          // it got down
  excludedWhenNotCountable: 'NEVER_LANDED',
  replicaStateOnReceipt: null,
  senderStateOnAccept: null,
  coordinationEligibleState: 'INBOUND',           // docs/adr/0014: CTR->AP
  tofiEligibleState: 'INBOUND',
  // docs/adr/0099 §4 (H100 Q-SJ2): any live IFR Strip may split or join; `groundStates` are the states a split needs no assignment in
  splitEligibleStates: ARRIVAL_STATES.filter(s => s !== 'DROPPED'),
  joinEligibleStates: ARRIVAL_STATES.filter(s => s !== 'DROPPED'),
  groundStates: ['LANDED', 'TAXI_IN'],
};

module.exports = { family, ARRIVAL_STATES, ARRIVAL_STATE_OWNERS, computeArrivalNla };
