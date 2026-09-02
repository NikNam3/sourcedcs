'use strict';

// EFSP State machine + Next Logical Action, per Strip Role
// (EFSPImplementationGuide.md §3.4, §3.5). [SOURCE-DEFINED] per the guide's
// own admission — the real TFDM EFS STATE/NLA value sets are not published
// anywhere; only the *shape* (one State per Strip, one NLA button per
// State, an inhibit reason attached rather than a merely-greyed-out
// control) is grounded in real prior art (§3.4, §3.5).
//
// Phase 1 implemented DEPARTURE only, for OPS/CD/GND/TWR at one Facility.
// Phase 2 adds ARRIVAL (originated by APP — docs/adr/0008, since there's
// still no CTR Facility to hand an inbound flight off from) and makes
// DEPARTED's NLA real: APP is now a configured, occupiable INCIRLIK
// Position, so "Hand Off" is a genuine, occupancy-gated intrafacility
// TransferStrip (docs/adr/0007 supersedes ADR 0005's always-succeed stub —
// TWR and APP are both INCIRLIK Positions, so this is NOT WP4A's
// cross-Facility HANDOFF, which is still APP<->CTR and still unbuilt).
//
// Inhibits tied to machinery that doesn't exist yet — field state/
// arresting gear (§9.7, WP6), alert-pad conflict (§9.6, WP6) — are simply
// never triggered here (documented per state below), not fabricated as
// always-true or always-false doctrine.

const DEPARTURE_STATES = [
  'PROPOSED', 'PENDING_CLEARANCE', 'CLEARED', 'HELD', 'PUSHBACK', 'TAXI',
  'RUNWAY_QUEUE', 'LUAW', 'DEPARTED', 'HANDED_OFF', 'DROPPED',
];
const DEPARTURE_STATE_SET = new Set(DEPARTURE_STATES);

// [SOURCE-DEFINED], per guide §3.4's arrival lifecycle:
// INBOUND -> HANDED_TO_TOWER -> FINAL -> LANDED -> TAXI_IN -> DROPPED.
// NOTE: EfspState 'FINAL' here (a value of strip.state) is unrelated to
// Strip Role 'FINAL' (guide §7.10's PAR/carrier role, WP7A, still
// unbuilt — that would live on strip.role) — they share the string but
// are different fields on different objects. Don't conflate them.
const ARRIVAL_STATES = ['INBOUND', 'HANDED_TO_TOWER', 'FINAL', 'LANDED', 'TAXI_IN', 'DROPPED'];
const ARRIVAL_STATE_SET = new Set(ARRIVAL_STATES);

const STATES_BY_ROLE = { DEPARTURE: DEPARTURE_STATES, ARRIVAL: ARRIVAL_STATES };
const STATE_SETS_BY_ROLE = { DEPARTURE: DEPARTURE_STATE_SET, ARRIVAL: ARRIVAL_STATE_SET };

// Backward-compatible alias — every Phase 1 caller/test imports STATES
// meaning "the departure lifecycle", which is still exactly what it means.
const STATES = DEPARTURE_STATES;

function isValidState(state, role = 'DEPARTURE') {
  const set = STATE_SETS_BY_ROLE[role];
  return !!set && set.has(state);
}

// A Strip's filed intent must have these non-empty before CLEARED is
// reachable — a minimal stand-in for the real flight-plan validator (the
// guide's fuller §8.5 validation is facility-config/Block-Map-driven and
// not built in Phase 1).
const REQUIRED_FOR_CLEARANCE = ['route', 'requestedAltitude', 'departureAirport', 'destinationAirport'];

function isFlightPlanValid(fdr) {
  if (!fdr) return false;
  return REQUIRED_FOR_CLEARANCE.every(k => !!fdr.filed[k]);
}

/** True at or after the derived 30-minute void deadline (guide §3.8). Alerting on this is a periodic job elsewhere (this is pure logic, no timers). */
function isVoidExpired(fdr, now = Date.now()) {
  return !!(fdr && fdr.assigned.voidDeadlineUtc && now >= fdr.assigned.voidDeadlineUtc);
}

/** Normalizes the injected occupancy context, defaulting to "nothing is occupied, nothing covers" when omitted — a safe, meaningful degrade (an occupancy-gated NLA simply reports inhibited) rather than a throw, since not every caller has occupancy info at hand (e.g. a fixture-driven test). */
function _normalizeCtx(ctx) {
  return {
    isOccupied: (ctx && ctx.isOccupied) || (() => false),
    coveringPositionFor: (ctx && ctx.coveringPositionFor) || (() => null),
  };
}

/**
 * @param {object} strip
 * @param {object|null} fdr
 * @param {number} now
 * @param {{isOccupied:(positionId:string)=>boolean, coveringPositionFor:(positionId:string)=>string|null}} ctx
 * @returns {{toState:string, transferTo?:string}|{inhibited:string}|null}
 */
function computeDepartureNla(strip, fdr, now, ctx) {
  switch (strip.state) {
    case 'PROPOSED':
      if (!fdr || !fdr.identity.beaconAssigned) return { inhibited: 'no beacon code assigned' };
      return { toState: 'PENDING_CLEARANCE' };

    case 'PENDING_CLEARANCE':
      if (!isFlightPlanValid(fdr)) return { inhibited: 'flight plan invalid' };
      return { toState: 'CLEARED' };

    case 'CLEARED':
      if (fdr && fdr.assigned.releaseState !== 'RELEASED') return { inhibited: 'a hold is in force' };
      // Alert-pad conflict (§9.6) is WP6/field-state territory, not built
      // in Phase 2 — never triggers here.
      return { toState: 'PUSHBACK' };

    case 'HELD':
      if (fdr && fdr.assigned.releaseState === 'RELEASE_TIME' && fdr.assigned.releaseTimeUtc && now < fdr.assigned.releaseTimeUtc) {
        return { inhibited: 'release time not reached' };
      }
      if (isVoidExpired(fdr, now)) return { inhibited: 'void time expired' };
      return { toState: 'PUSHBACK' };

    case 'PUSHBACK':
      return { toState: 'TAXI' };

    case 'TAXI':
      // Runway-unavailable inhibit (§9.7 field state) is WP6 territory,
      // not built in Phase 2 — never triggers here.
      return { toState: 'RUNWAY_QUEUE' };

    case 'RUNWAY_QUEUE':
      // Runway-occupied inhibit (§9.7) is WP6 territory — never triggers here.
      return { toState: 'LUAW' };

    case 'LUAW':
      // Runway-occupied / arresting-gear-reconfiguration inhibits (§9.7)
      // are WP6 territory — never trigger here.
      return { toState: 'DEPARTED' };

    case 'DEPARTED':
      // Real, occupancy-gated "Hand Off" to APP (docs/adr/0007) — an
      // intrafacility TransferStrip, not WP4A's cross-Facility HANDOFF.
      if (!ctx.isOccupied('APP') && !ctx.coveringPositionFor('APP')) {
        return { inhibited: 'no receiving Position present' };
      }
      return { toState: 'HANDED_OFF', transferTo: 'APP' };

    case 'HANDED_OFF':
      return { toState: 'DROPPED' };

    case 'DROPPED':
    default:
      return null;
  }
}

/** [SOURCE-DEFINED] ARRIVAL lifecycle NLA (docs/adr/0008) — same shape as DEPARTURE's table above. */
function computeArrivalNla(strip, fdr, now, ctx) {
  switch (strip.state) {
    case 'INBOUND':
      if (!ctx.isOccupied('TWR') && !ctx.coveringPositionFor('TWR')) {
        return { inhibited: 'no receiving Position present' };
      }
      return { toState: 'HANDED_TO_TOWER', transferTo: 'TWR' };

    case 'HANDED_TO_TOWER':
      return { toState: 'FINAL' };

    case 'FINAL':
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

const COMPUTE_BY_ROLE = { DEPARTURE: computeDepartureNla, ARRIVAL: computeArrivalNla };

/**
 * @param {object} strip
 * @param {object|null} fdr
 * @param {number} [now]
 * @param {object} [ctx]
 * @returns {{toState:string, transferTo?:string}|{inhibited:string}|null} null means no NLA is
 *   defined for this State at all (a terminal state).
 */
function computeNla(strip, fdr, now = Date.now(), ctx = {}) {
  const compute = COMPUTE_BY_ROLE[strip.role] || computeDepartureNla;
  return compute(strip, fdr, now, _normalizeCtx(ctx));
}

module.exports = {
  STATES, DEPARTURE_STATES, ARRIVAL_STATES, STATES_BY_ROLE,
  isValidState, isFlightPlanValid, isVoidExpired, computeNla, REQUIRED_FOR_CLEARANCE,
};
