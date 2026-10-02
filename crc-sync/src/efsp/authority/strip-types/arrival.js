'use strict';

// The ARRIVAL Role family (authority registry, S3-2). States and NLA moved
// from nla.js, state owners from permission.js.

const { _runwayInhibit } = require('./nla-common');

// [SOURCE-DEFINED], per guide §3.4's arrival lifecycle:
// INBOUND -> HANDED_TO_TOWER -> FINAL -> LANDED -> TAXI_IN -> DROPPED.
// NOTE: EfspState 'FINAL' here (a value of strip.state) is unrelated to
// Strip Role 'FINAL' (guide §7.10's PAR/carrier role, WP7A, still
// unbuilt — that would live on strip.role) — they share the string but
// are different fields on different objects. Don't conflate them.
const ARRIVAL_STATES = ['INBOUND', 'HANDED_TO_TOWER', 'FINAL', 'LANDED', 'TAXI_IN', 'DROPPED'];

// [SOURCE-DEFINED] — ARRIVAL has no guide-published "normally owned by"
// table (§3.4 only gives the state sequence); this mirrors the same
// per-Position-per-lifecycle-stage shape as DEPARTURE's guide-sourced one.
const ARRIVAL_STATE_OWNERS = {
  // CTR added (docs/adr/0014) — a CENTER-held INBOUND Strip (CTR's own
  // local origination, mirroring APP's original ADR 0008 stub) needs its
  // owning Position authorized to act on it too, even though "acting on
  // it" now means proposing a cross-Facility HANDOFF via the Coordinate
  // button rather than an ordinary NLA transfer (nla.js's computeArrivalNla
  // INBOUND case is Facility-aware — see that module's comment).
  INBOUND:         ['APP', 'CTR'],
  HANDED_TO_TOWER: ['TWR'],
  FINAL:           ['TWR'],
  LANDED:          ['TWR'],
  TAXI_IN:         ['GND'],
};

/** [SOURCE-DEFINED] ARRIVAL lifecycle NLA (docs/adr/0008) — same shape as DEPARTURE's table above. */
function computeArrivalNla(strip, fdr, now, ctx) {
  switch (strip.state) {
    case 'INBOUND':
      // WP4A (docs/adr/0014): a CENTER-held INBOUND Strip's next step is
      // the cross-Facility HANDOFF to APP — a genuinely different
      // mechanism (guide §4.6, "a different mechanism entirely"), fired
      // via the Coordinate button/dispatch path, not this ordinary
      // intrafacility-transfer NLA. There is no TWR Position at CENTER to
      // transfer to at all, so this branches BEFORE attempting the
      // INCIRLIK-only TWR-occupancy check below. Every caller that never
      // sets ctx.facilityId (every pre-WP4A call site, and every
      // INCIRLIK-scoped one) is unaffected.
      if (ctx.facilityId === 'CENTER') {
        return { inhibited: 'cross-Facility HANDOFF required — use Coordinate' };
      }
      if (!ctx.isOccupied('TWR') && !ctx.coveringPositionFor('TWR')) {
        return { inhibited: 'no receiving Position present' };
      }
      return { toState: 'HANDED_TO_TOWER', transferTo: 'TWR' };

    case 'HANDED_TO_TOWER': {
      // §9.7 rule 1, the landing half: no clearance onto final for a runway
      // that is suspended or closed. The Strip waits (decisions.md H19).
      const runway = _runwayInhibit(strip, fdr, ctx);
      if (runway) return { inhibited: runway };
      return { toState: 'FINAL' };
    }

    case 'FINAL':
      // Never inhibited by field state, deliberately: LANDED is an
      // OBSERVATION that the aircraft touched down, not a clearance. Refusing
      // it would make the board lie about something that already happened
      // and strand a landed aircraft with no legal transition.
      return { toState: 'LANDED' };

    case 'LANDED':
      if (!ctx.isOccupied('GND') && !ctx.coveringPositionFor('GND')) {
        return { inhibited: 'no receiving Position present' };
      }
      return { toState: 'TAXI_IN', transferTo: 'GND' };

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
  role: 'ARRIVAL',
  states: ARRIVAL_STATES,
  initialState: 'INBOUND',
  stateOwners: ARRIVAL_STATE_OWNERS,
  computeNla: computeArrivalNla,
  countablePreDropStates: ['LANDED', 'TAXI_IN'],          // it got down
  excludedWhenNotCountable: 'NEVER_LANDED',
  replicaStateOnReceipt: null,
  senderStateOnAccept: null,
  coordinationEligibleState: 'INBOUND',           // docs/adr/0014: CTR->APP
  tofiEligibleState: 'INBOUND',
};

module.exports = { family, ARRIVAL_STATES, ARRIVAL_STATE_OWNERS, computeArrivalNla };
