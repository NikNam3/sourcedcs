'use strict';

// The ARRIVAL strip-type family (authority registry, docs/adr/0095): states,
// NLA table and state owners.

const { _runwayInhibit } = require('./nla-common');

// [SOURCE-DEFINED], per guide §3.4's arrival lifecycle:
// INBOUND -> HANDED_TO_TOWER -> FINAL -> LANDED -> TAXI_IN -> DROPPED,
// and LC's visual pattern beside it (docs/adr/0126): HANDED_TO_TOWER ->
// TRAFFIC_PATTERN -> FINAL -> TRAFFIC_PATTERN (touch-and-go or low approach,
// JO 7110.65 ¶3-10-11 closed traffic) ... -> FINAL -> LANDED (full stop).
// NOTE: the state 'FINAL' here (a value of strip.state) is unrelated to the
// strip type 'FINAL' (guide §7.10's PAR/carrier stripType, strip-types/final.js,
// a value of strip.stripType) — they share the string but are different fields
// on different objects. Don't conflate them.
const ARRIVAL_STATES = ['INBOUND', 'HANDED_TO_TOWER', 'TRAFFIC_PATTERN', 'FINAL', 'LANDED', 'TAXI_IN', 'DROPPED'];

// docs/adr/0126: the pattern intent cells (Blocks 9J-ENTRY and 9J-OPTION, on the flight data's
// assigned.patternEntry / assigned.patternOption, validated by flight-data-store.js) steer LC's NLA.
// The options after which the aircraft stays airborne and, by default, in closed traffic (JO 7110.65 ¶3-8-2).
const STAYS_AIRBORNE_OPTIONS = ['TOUCH_AND_GO', 'LOW_APPROACH'];

function _assigned(flightData, key) {
  return flightData && flightData.assigned ? flightData.assigned[key] || null : null;
}

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
  TRAFFIC_PATTERN: ['LC'], // docs/adr/0126: the tower works the pattern (H149, no RSU)
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
      // docs/adr/0126: PAT on the Strip (Block 9J-ENTRY) sends the flight into the pattern
      // (LC's Pattern Bay); entering the pattern is not a landing, so no runway inhibit.
      // Straight in (or nothing set) is the final, as always; the other is legal by drag.
      const runway = _runwayInhibit(strip, flightData, ctx);
      if (_assigned(flightData, 'patternEntry') === 'PATTERN') {
        return runway ? { toState: 'TRAFFIC_PATTERN' } : { toState: 'TRAFFIC_PATTERN', alsoLegal: ['FINAL'] };
      }
      // §9.7 rule 1, the landing half: no clearance onto final for a runway
      // that is suspended or closed. The Strip waits (decisions.md H19).
      if (runway) return { inhibited: runway };
      return { toState: 'FINAL', alsoLegal: ['TRAFFIC_PATTERN'] };
    }

    case 'TRAFFIC_PATTERN': {
      // docs/adr/0126: in the pattern, the next step is the final (the option clearance,
      // JO 7110.65 ¶3-10-5), with the same runway inhibit as a straight-in.
      const runway = _runwayInhibit(strip, flightData, ctx);
      if (runway) return { inhibited: runway };
      return { toState: 'FINAL' };
    }

    case 'FINAL':
      // Never inhibited by runway status, deliberately: LANDED is an
      // OBSERVATION that the aircraft touched down, not a clearance. Refusing
      // it would make the board lie about something that already happened
      // and strand a landed aircraft with no legal transition.
      // docs/adr/0126: after a touch-and-go or low approach (Block 9J-OPTION) the aircraft is
      // back in closed traffic (¶3-8-2, ¶3-10-11); either outcome stays legal by drag, since
      // what the pilot did is an observation too.
      if (STAYS_AIRBORNE_OPTIONS.includes(_assigned(flightData, 'patternOption'))) {
        return { toState: 'TRAFFIC_PATTERN', alsoLegal: ['LANDED'] };
      }
      return { toState: 'LANDED', alsoLegal: ['TRAFFIC_PATTERN'] };

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

module.exports = { family, ARRIVAL_STATES, ARRIVAL_STATE_OWNERS, computeArrivalNla, STAYS_AIRBORNE_OPTIONS };
