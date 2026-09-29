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
// docs/adr/0012 extends that same transfer-shaped pattern to EVERY
// transition that crosses a DEPARTURE_STATE_OWNERS boundary (not just
// DEPARTED->APP): PROPOSED->PENDING_CLEARANCE, CLEARED->PUSHBACK,
// HELD->PUSHBACK, and TAXI->RUNWAY_QUEUE all now carry `transferTo` and
// the same occupancy-gated inhibit. A transition that stays with the same
// owner (PENDING_CLEARANCE->CLEARED, PUSHBACK->TAXI, RUNWAY_QUEUE->LUAW,
// LUAW->DEPARTED) is still state-only — no Position boundary, nothing to
// transfer.
//
// Field state (§9.7 rule 1, docs/adr/0061) now inhibits: a DEPARTURE's
// TAXI/RUNWAY_QUEUE/LUAW steps and an ARRIVAL's HANDED_TO_TOWER -> FINAL are
// refused while the Strip's runway is suspended or closed, with the runway and
// the cause named — resolved through `ctx.fieldStateFor()` (field-state.js).
// Runway OCCUPANCY is still not implemented: §9.7's schema has no occupancy
// field and §3.5's RUNWAY_QUEUE row cites no section, so inventing one would
// be D11. The alert-pad conflict (§9.6, WP6) is still never triggered here
// (documented per state below), not fabricated as always-true or always-false
// doctrine.
//
// WP4A (docs/adr/0014) migrates ARRIVAL's INBOUND origination from ADR
// 0008's local APP self-creation stub to a real cross-Facility HANDOFF
// from CTR (CENTER Facility) — see computeArrivalNla's INBOUND case,
// which is now Facility-aware via ctx.facilityId. DEPARTURE's DEPARTED
// case is deliberately UNCHANGED this slice (docs/adr/0016 confirms):
// TWR and APP are both INCIRLIK Positions, so "Hand Off to APP" stays the
// existing intrafacility TransferStrip, not WP4A's cross-Facility
// primitive (still nowhere near DEPARTURE's own lifecycle this slice).

const { matchesStandingRelease } = require('./release-envelope');
const { runwayInhibitFor } = require('./field-state');

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

// [SOURCE-DEFINED] (docs/adr/0023) — OVERFLIGHT has no guide-published
// state table at all (§6.3 only notes it shares Blocks 20/21 with
// ARRIVAL); deliberately the simplest possible 2-state lifecycle, mirroring
// DEPARTURE's own HANDED_OFF->DROPPED terminus shape — an overflight never
// lands at Incirlik, so none of ARRIVAL's tower/final/landed/taxi stages
// apply.
const OVERFLIGHT_STATES = ['TRANSITING', 'DROPPED'];
const OVERFLIGHT_STATE_SET = new Set(OVERFLIGHT_STATES);

// Guide-specified lifecycle (§9.8, line 215) — not invented. No occupancy/
// transferTo gating, same reasoning as OVERFLIGHT's own table: TAC_C2/GCI
// (whichever originated the mission, or received it via a TOFI ENTRY
// exchange) work its entire lifecycle solo — the cross-Position richness
// (AR-line/tanker join, ATO binding) is exactly the WP7 scope deferred by
// this slice's own scope-cut ADR.
const MISSION_STATES = ['TASKED', 'AIRBORNE', 'ON_STATION', 'OFF_STATION', 'RTB', 'DROPPED'];
const MISSION_STATE_SET = new Set(MISSION_STATES);

const STATES_BY_ROLE = { DEPARTURE: DEPARTURE_STATES, ARRIVAL: ARRIVAL_STATES, OVERFLIGHT: OVERFLIGHT_STATES, MISSION: MISSION_STATES };
const STATE_SETS_BY_ROLE = { DEPARTURE: DEPARTURE_STATE_SET, ARRIVAL: ARRIVAL_STATE_SET, OVERFLIGHT: OVERFLIGHT_STATE_SET, MISSION: MISSION_STATE_SET };

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

// The controller-facing Block label for each of those four, so the inhibit
// reason names what the controller has to go and fill in rather than an
// internal field path. A Strip shows 28 chips, most of them empty; "flight
// plan invalid" told them nothing about which four mattered, and nothing on
// the Strip marks them (docs/ui-findings/lane1.md F-104).
//
// These are Blocks 7/8/8B/9 of every Role's Block Map. block-map.js carries
// the routing (`filed.requestedAltitude` &c) but deliberately not the labels
// — those are the panel's rendering concern (crc-desktop's strip-template.js)
// — so the mapping is spelled out here, in the one place a server-side reason
// string needs to speak the controller's vocabulary. Listed in Block order,
// which is also the order the chips appear in.
const CLEARANCE_BLOCK_LABELS = {
  requestedAltitude: 'ALT',       // Block 7
  departureAirport: 'DEP',        // Block 8
  destinationAirport: 'DEST',     // Block 8B
  route: 'RTE',                   // Block 9
};
const CLEARANCE_LABEL_ORDER = ['requestedAltitude', 'departureAirport', 'destinationAirport', 'route'];

function isFlightPlanValid(fdr) {
  if (!fdr) return false;
  return REQUIRED_FOR_CLEARANCE.every(k => !!fdr.filed[k]);
}

/**
 * The Block labels of whatever CLEARED still needs, in Block order — [] when
 * the plan is complete, and every label when there is no FDR at all (nothing
 * is filed, so nothing is filled in).
 * @returns {string[]}
 */
function missingForClearance(fdr) {
  return CLEARANCE_LABEL_ORDER
    .filter(k => !fdr || !fdr.filed[k])
    .map(k => CLEARANCE_BLOCK_LABELS[k]);
}

/** The §3.5-rule-2 inhibit reason for an incomplete plan, naming the Blocks — same specific style as 'a hold is in force' / 'void time expired'. */
function flightPlanInhibitReason(fdr) {
  return `flight plan incomplete — ${missingForClearance(fdr).join(', ')} not filed`;
}

// The two release states whose gate is a derived WINDOW rather than a single
// instant (docs/adr/0017). RELEASE_TIME is deliberately absent — it is a
// "not before" with no upper bound, checked separately in the HELD case.
const WINDOWED_RELEASE_STATES = {
  EDCT:             { startKey: 'edctWindowStartUtc',           endKey: 'edctWindowEndUtc',           label: 'EDCT' },
  CALL_FOR_RELEASE: { startKey: 'callForReleaseWindowStartUtc', endKey: 'callForReleaseWindowEndUtc', label: 'call-for-release' },
};

/**
 * `now` is required everywhere in this module, and is the mission clock's
 * (docs/adr/0079): every gate here is a time of day a controller reads. It
 * used to default to Date.now(), which is the one answer that is always
 * plausible and, with a mission set at 0240Z and flown at 1900Z, always wrong.
 */
function _requireNow(now) {
  if (!Number.isFinite(now)) throw new TypeError('nla: `now` (mission-clock ms) is required');
}

/** True at or after the derived 30-minute void deadline (guide §3.8). Alerting on this is a periodic job elsewhere (this is pure logic, no timers). */
function isVoidExpired(fdr, now) {
  _requireNow(now);
  return !!(fdr && fdr.assigned.voidDeadlineUtc && now >= fdr.assigned.voidDeadlineUtc);
}

/** Normalizes the injected occupancy context, defaulting to "nothing is occupied, nothing covers" when omitted — a safe, meaningful degrade (an occupancy-gated NLA simply reports inhibited) rather than a throw, since not every caller has occupancy info at hand (e.g. a fixture-driven test). `facilityId` (WP4A) defaults to undefined, which computeArrivalNla treats as "not CENTER" — i.e. every pre-WP4A caller that never passes it keeps the original INCIRLIK behavior unchanged. `standingReleases` (WP4A, §4.6.2) defaults to an empty array — no envelopes configured means nothing is ever pre-cleared by one. */
function _normalizeCtx(ctx) {
  return {
    isOccupied: (ctx && ctx.isOccupied) || (() => false),
    coveringPositionFor: (ctx && ctx.coveringPositionFor) || (() => null),
    facilityId: ctx && ctx.facilityId,
    standingReleases: (ctx && ctx.standingReleases) || [],
    // §9.7 (docs/adr/0061): this Facility's runway status view, or null. A
    // caller that never passes it — every pre-L1 caller, a hand-built test
    // ctx, a Facility with no runways — gets null, and null never inhibits.
    fieldStateFor: (ctx && ctx.fieldStateFor) || (() => null),
    // The rack a drag is dropping the Strip into (decisions.md Q27): judged
    // against the runway it is about to use, not the one it came from.
    targetRackId: ctx && ctx.targetRackId,
  };
}

/** Rule 1's inhibit for this Strip's runway, or null (fail open — see field-state.js). */
function _runwayInhibit(strip, fdr, ctx) {
  return runwayInhibitFor(strip, fdr, ctx.fieldStateFor(), { targetRackId: ctx.targetRackId });
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
      // Every boundary crossing between two DIFFERENT owning Positions
      // (permission.js's DEPARTURE_STATE_OWNERS) is transfer-shaped, same
      // pattern as DEPARTED->APP below — matches real strip-passing
      // procedure (OPS finishes their part, the strip actually moves to
      // the next desk in the SAME action, not a separate manual drag) and
      // closes the single-Position-controller gap: without this, OPS
      // alone has no drop target to hand a Strip to CD at all (CD's Bay
      // tabs only render for Positions the acting controller holds).
      if (!fdr || !fdr.identity.beaconAssigned) return { inhibited: 'no beacon code assigned' };
      if (!ctx.isOccupied('CD') && !ctx.coveringPositionFor('CD')) {
        return { inhibited: 'no receiving Position present' };
      }
      return { toState: 'PENDING_CLEARANCE', transferTo: 'CD' };

    case 'PENDING_CLEARANCE':
      // CLEARED is still CD's own (DEPARTURE_STATE_OWNERS), so this stays
      // state-only — no Position boundary is crossed here.
      if (!isFlightPlanValid(fdr)) return { inhibited: flightPlanInhibitReason(fdr) };
      return { toState: 'CLEARED' };

    case 'CLEARED':
      if (fdr && fdr.assigned.releaseState !== 'RELEASED') return { inhibited: 'a hold is in force' };
      // Alert-pad conflict (§9.6) is WP6/field-state territory, not built
      // in Phase 2 — never triggers here.
      if (!ctx.isOccupied('GND') && !ctx.coveringPositionFor('GND')) {
        return { inhibited: 'no receiving Position present' };
      }
      return { toState: 'PUSHBACK', transferTo: 'GND' };

    case 'HELD':
      if (fdr && fdr.assigned.releaseState === 'RELEASE_TIME' && fdr.assigned.releaseTimeUtc && now < fdr.assigned.releaseTimeUtc) {
        return { inhibited: 'release time not reached' };
      }
      // WP4A (docs/adr/0017), §4.6.2: a HOLD_FOR_RELEASE flight that falls
      // inside a configured standing-release envelope resolves on its own
      // (the agreement already covers it); one that doesn't needs an
      // explicit per-flight OPERATIONAL_REQUEST — the fallback the guide's
      // own text names. Only checked for HOLD_FOR_RELEASE specifically:
      // RELEASE_TIME/EDCT/CALL_FOR_RELEASE already have their own
      // time-based gates above/below, and RELEASED has none at all.
      if (fdr && fdr.assigned.releaseState === 'HOLD_FOR_RELEASE' && !matchesStandingRelease(fdr, ctx.standingReleases)) {
        return { inhibited: 'outside standing release envelope — file OPERATIONAL_REQUEST' };
      }
      // WP4A (docs/adr/0017), §4.6.2 — the EDCT and call-for-release
      // windows. fdr-store.js has derived both on every write since that
      // slice (EDCT ±5 min, call-for-release −2/+1), and until now nothing
      // anywhere read them: a flight with a slot an hour away was not held
      // at all, which made the whole derivation inert. Found by walking a
      // release sortie. Missing a window inhibits too — a slot that has
      // passed needs a new one, and sliding through it silently is exactly
      // what the window exists to prevent.
      const windowed = fdr && WINDOWED_RELEASE_STATES[fdr.assigned.releaseState];
      if (windowed) {
        const opensAt = fdr.assigned[windowed.startKey];
        const closesAt = fdr.assigned[windowed.endKey];
        if (opensAt && now < opensAt) return { inhibited: `${windowed.label} window is not open yet` };
        if (closesAt && now > closesAt) return { inhibited: `${windowed.label} window has passed — a new slot is needed` };
      }
      if (isVoidExpired(fdr, now)) return { inhibited: 'void time expired' };
      // HELD is jointly owned by CD and GND (DEPARTURE_STATE_OWNERS) since
      // either may be the one holding it, but PUSHBACK is GND's alone —
      // always transfer to GND here, a no-op reassignment when GND already
      // held it.
      if (!ctx.isOccupied('GND') && !ctx.coveringPositionFor('GND')) {
        return { inhibited: 'no receiving Position present' };
      }
      return { toState: 'PUSHBACK', transferTo: 'GND' };

    case 'PUSHBACK':
      // TAXI is still GND's own — state-only.
      return { toState: 'TAXI' };

    case 'TAXI': {
      // §9.7 rule 1: a departure does not enter the queue for a runway that
      // is suspended or closed — checked before the occupancy gate, because
      // the runway is the reason it cannot go, whoever is in the tower.
      const runway = _runwayInhibit(strip, fdr, ctx);
      if (runway) return { inhibited: runway };
      if (!ctx.isOccupied('TWR') && !ctx.coveringPositionFor('TWR')) {
        return { inhibited: 'no receiving Position present' };
      }
      return { toState: 'RUNWAY_QUEUE', transferTo: 'TWR' };
    }

    case 'RUNWAY_QUEUE': {
      // §9.7 rule 1: no line-up on a suspended or closed runway. Runway
      // OCCUPANCY is not implemented (no §9.7 field for it — see the module
      // comment); this is the field-state inhibit only.
      const runway = _runwayInhibit(strip, fdr, ctx);
      if (runway) return { inhibited: runway };
      return { toState: 'LUAW' };
    }

    case 'LUAW': {
      // §9.7 rule 1: no takeoff from a suspended or closed runway — covers a
      // barrier change begun while the aircraft sat lined up. Occupancy, again,
      // is not implemented.
      const runway = _runwayInhibit(strip, fdr, ctx);
      if (runway) return { inhibited: runway };
      return { toState: 'DEPARTED' };
    }

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

/**
 * OVERFLIGHT's entire NLA table (docs/adr/0023) — a flight transiting this
 * Facility's airspace without landing or departing here at all (guide §2).
 * No occupancy gating, no transferTo: unlike DEPARTURE/ARRIVAL, an
 * overflight was never "owned" by a chain of Positions leading somewhere —
 * whichever Position originated it (permission.js's CREATE_ROLE_PERMISSIONS)
 * just works it until it exits coverage, then Drops it.
 */
function computeOverflightNla(strip) {
  switch (strip.state) {
    case 'TRANSITING':
      return { toState: 'DROPPED' };
    case 'DROPPED':
    default:
      return null;
  }
}

/**
 * MISSION's entire NLA table (WP4A second slice) — a simple linear
 * progression through the guide's own 6-state lifecycle (§9.8), no
 * occupancy gating, no transferTo — same shape as computeOverflightNla,
 * for the same reason (the cross-Position richness a real mission-line
 * panel would need is WP7 scope, deferred by this slice's scope-cut ADR).
 */
function computeMissionNla(strip) {
  switch (strip.state) {
    case 'TASKED':      return { toState: 'AIRBORNE' };
    case 'AIRBORNE':    return { toState: 'ON_STATION' };
    case 'ON_STATION':  return { toState: 'OFF_STATION' };
    case 'OFF_STATION': return { toState: 'RTB' };
    case 'RTB':         return { toState: 'DROPPED' };
    case 'DROPPED':
    default:            return null;
  }
}

const COMPUTE_BY_ROLE = { DEPARTURE: computeDepartureNla, ARRIVAL: computeArrivalNla, OVERFLIGHT: computeOverflightNla, MISSION: computeMissionNla };

/**
 * @param {object} strip
 * @param {object|null} fdr
 * @param {number} now  mission-clock ms (docs/adr/0079)
 * @param {object} [ctx]
 * @returns {{toState:string, transferTo?:string}|{inhibited:string}|null} null means no NLA is
 *   defined for this State at all (a terminal state).
 */
function computeNla(strip, fdr, now, ctx = {}) {
  _requireNow(now);
  const compute = COMPUTE_BY_ROLE[strip.role] || computeDepartureNla;
  return compute(strip, fdr, now, _normalizeCtx(ctx));
}

module.exports = {
  STATES, DEPARTURE_STATES, ARRIVAL_STATES, OVERFLIGHT_STATES, MISSION_STATES, STATES_BY_ROLE,
  isValidState, isFlightPlanValid, isVoidExpired, computeNla, REQUIRED_FOR_CLEARANCE,
  missingForClearance, flightPlanInhibitReason, CLEARANCE_BLOCK_LABELS,
};
