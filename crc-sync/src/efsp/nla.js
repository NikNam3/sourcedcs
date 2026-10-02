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
// the cause named — resolved through `ctx.fieldStateFor()` (runway-status.js).
// Runway OCCUPANCY is still not implemented: §9.7's schema has no occupancy
// field and §3.5's RUNWAY_QUEUE row cites no section, so inventing one would
// be D11. The alert-pad conflict (§9.6) is a FLAG, never an inhibit: a
// SCRAMBLE is raised client-side from alert-scramble.js (docs/adr/0070) and
// nothing in this module reads the alert status. The guide's [GAP] forbids a
// scramble priority ordering until FAA JO 7110.65 §2-1-4 and §9-2-7 are read.
//
// WP4A (docs/adr/0014) migrates ARRIVAL's INBOUND origination from ADR
// 0008's local APP self-creation stub to a real cross-Facility HANDOFF
// from CTR (CENTER Facility) — see computeArrivalNla's INBOUND case,
// which is now Facility-aware via ctx.facilityId. DEPARTURE's DEPARTED
// case is deliberately UNCHANGED this slice (docs/adr/0016 confirms):
// TWR and APP are both INCIRLIK Positions, so "Hand Off to APP" stays the
// existing intrafacility TransferStrip, not WP4A's cross-Facility
// primitive (still nowhere near DEPARTURE's own lifecycle this slice).

// The tables and the per-Role NLA functions now live in the authority
// registry's Role families (authority/strip-types/<role>.js, S3-2). This module is
// their facade: it exports exactly what it exported before.

const authority = require('./authority');
const { _requireNow } = require('./authority/strip-types/nla-common');
const departure = require('./authority/strip-types/departure');
const { ARRIVAL_STATES } = require('./authority/strip-types/arrival');
const { OVERFLIGHT_STATES } = require('./authority/strip-types/overflight');
const { MISSION_STATES } = require('./authority/strip-types/mission');
const { MARSHAL_STATES } = require('./authority/strip-types/marshal');
const { FINAL_STATES } = require('./authority/strip-types/final');
const { PATTERN_STATES } = require('./authority/strip-types/pattern');

const { DEPARTURE_STATES, REQUIRED_FOR_CLEARANCE, CLEARANCE_BLOCK_LABELS, isFlightPlanValid, missingForClearance, isVoidExpired } = departure;
const STATES_BY_ROLE = authority.STATES_BY_ROLE;
const STATE_SETS_BY_ROLE = Object.fromEntries(Object.entries(STATES_BY_ROLE).map(([role, states]) => [role, new Set(states)]));

// Backward-compatible alias — every Phase 1 caller/test imports STATES
// meaning "the departure lifecycle", which is still exactly what it means.
const STATES = DEPARTURE_STATES;

function isValidState(state, role = 'DEPARTURE') {
  const set = STATE_SETS_BY_ROLE[role];
  return !!set && set.has(state);
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
    // The carrier (docs/adr/0074). `carrierCase()` is the ship's recovery Case
    // ('I'|'II'|'III'; the NLA out of IN_STACK depends on it), and
    // `carrierLaneFor(strip)` the manned CV_APP lane the Marshal stack would feed
    // this flight to, or null. Both default to "nothing known", which inhibits
    // the Commence rather than guessing a lane.
    carrierCase: (ctx && ctx.carrierCase) || (() => null),
    carrierLaneFor: (ctx && ctx.carrierLaneFor) || (() => null),
    carrierInStack: (ctx && ctx.carrierInStack) || (() => true),
  };
}

// Each Role family's computeNla is registered in the same commit as the Role:
// computeNla falls back to the DEPARTURE table for an unknown Role, which would
// show a MARSHAL Strip "Send to Clearance" (ADR 0064's trap for L17).
const COMPUTE_BY_ROLE = Object.fromEntries(authority.roleNames().map(role => [role, authority.roleFamily(role).computeNla]));
const computeDepartureNla = departure.computeDepartureNla;

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
  MARSHAL_STATES, FINAL_STATES, PATTERN_STATES,
  isValidState, isFlightPlanValid, isVoidExpired, computeNla, REQUIRED_FOR_CLEARANCE,
  missingForClearance, CLEARANCE_BLOCK_LABELS,
};
