'use strict';

// EFSP State machine + Next Logical Action, per strip type
// (EFSPImplementationGuide.md §3.4, §3.5). [SOURCE-DEFINED] (guide §3.4, by the
// guide's own admission): the real TFDM EFS STATE/NLA value sets are not published
// anywhere; only the *shape* (one State per Strip, one NLA button per
// State, an inhibit reason attached rather than a merely-greyed-out
// control) is grounded in real prior art (§3.4, §3.5).
//
// The tables and the per-strip-type NLA functions live in the authority
// registry's strip-type families (authority/strip-types/<type>.js, docs/adr/0095);
// this module is their facade and adds the injected staffing context
// (_normalizeCtx) and the one entry point, computeNla. What it encodes, by
// ADR:
//  - A transition that crosses a state-owner boundary carries `transferTo` and a
//    staffing-gated inhibit (docs/adr/0007, 0012); one that stays with the same
//    owner is state-only. DEPARTED's "Hand Off to AP" is the intrafacility
//    TransferStrip (docs/adr/0016), not the cross-Facility HANDOFF.
//  - ARRIVAL's INBOUND origination at CTR is a cross-Facility HANDOFF
//    (docs/adr/0014), so computeArrivalNla is Facility-aware via ctx.facilityId.
//  - Runway status (§9.7 rule 1, docs/adr/0061) inhibits: a DEPARTURE's
//    TAXI/RUNWAY_QUEUE/LUAW steps and an ARRIVAL's HANDED_TO_TOWER -> FINAL are
//    refused while the Strip's runway is suspended or closed, with the runway and
//    the cause named — resolved through `ctx.runwayStatusFor()` (runway-status.js).
//    Runway occupancy is not an input: §9.7's schema has no occupancy field and
//    §3.5's RUNWAY_QUEUE row cites no section, so inventing one would be D11.
//    The alert-pad conflict (§9.6) is a FLAG, never an inhibit: a SCRAMBLE is
//    raised client-side from alert-scramble.js (docs/adr/0070) and nothing in
//    this module reads the alert status. The guide's [GAP] forbids a scramble
//    priority ordering until FAA JO 7110.65 §2-1-4 and §9-2-7 are read.

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
const STATES_BY_STRIP_TYPE = authority.STATES_BY_STRIP_TYPE;
const STATE_SETS_BY_STRIP_TYPE = Object.fromEntries(Object.entries(STATES_BY_STRIP_TYPE).map(([stripType, states]) => [stripType, new Set(states)]));

// Alias: STATES means "the departure lifecycle".
const STATES = DEPARTURE_STATES;

function isValidState(state, stripType = 'DEPARTURE') {
  const set = STATE_SETS_BY_STRIP_TYPE[stripType];
  return !!set && set.has(state);
}

/** Normalizes the injected staffing context, defaulting to "nothing is staffed, nothing is consolidated anywhere" when omitted — a safe, meaningful degrade (a staffing-gated NLA simply reports inhibited) rather than a throw, since not every caller has staffing info at hand (e.g. a fixture-driven test). `facilityId` defaults to undefined, which computeArrivalNla treats as "not CENTER", so a caller that never passes it gets the INCIRLIK behavior. `standingReleases` (§4.6.2) defaults to an empty array — no envelopes configured means nothing is ever pre-cleared by one. */
function _normalizeCtx(ctx) {
  return {
    isStaffed: (ctx && ctx.isStaffed) || (() => false),
    consolidatedAt: (ctx && ctx.consolidatedAt) || (() => null),
    facilityId: ctx && ctx.facilityId,
    standingReleases: (ctx && ctx.standingReleases) || [],
    // §9.7 (docs/adr/0061): this Facility's runway status view, or null. A
    // caller that never passes it — every pre-L1 caller, a hand-built test
    // ctx, a Facility with no runways — gets null, and null never inhibits.
    runwayStatusFor: (ctx && ctx.runwayStatusFor) || (() => null),
    // The rack a drag is dropping the Strip into (decisions.md Q27): judged
    // against the runway it is about to use, not the one it came from.
    targetRackId: ctx && ctx.targetRackId,
    // The carrier (docs/adr/0074). `carrierCase()` is the ship's recovery Case
    // ('I'|'II'|'III'; the NLA out of IN_STACK depends on it), and
    // `carrierLaneFor(strip)` the staffed CV_APP lane the Marshal stack would feed
    // this flight to, or null. Both default to "nothing known", which inhibits
    // the Commence rather than guessing a lane.
    carrierCase: (ctx && ctx.carrierCase) || (() => null),
    carrierLaneFor: (ctx && ctx.carrierLaneFor) || (() => null),
    carrierInStack: (ctx && ctx.carrierInStack) || (() => true),
  };
}

// Each strip-type family's computeNla is registered in the same commit as the type:
// computeNla falls back to the DEPARTURE table for an unknown strip type, which would
// show a MARSHAL Strip "Send to Clearance" (ADR 0064's trap for L17).
const COMPUTE_BY_STRIP_TYPE = Object.fromEntries(authority.stripTypeNames().map(stripType => [stripType, authority.stripTypeFamily(stripType).computeNla]));
const computeDepartureNla = departure.computeDepartureNla;

/**
 * @param {object} strip
 * @param {object|null} flightData
 * @param {number} now  mission-clock ms (docs/adr/0079)
 * @param {object} [ctx]
 * @returns {{toState:string, transferTo?:string}|{inhibited:string}|null} null means no NLA is
 *   defined for this State at all (a terminal state).
 */
function computeNla(strip, flightData, now, ctx = {}) {
  _requireNow(now);
  const compute = COMPUTE_BY_STRIP_TYPE[strip.stripType] || computeDepartureNla;
  return compute(strip, flightData, now, _normalizeCtx(ctx));
}

module.exports = {
  STATES, DEPARTURE_STATES, ARRIVAL_STATES, OVERFLIGHT_STATES, MISSION_STATES, STATES_BY_STRIP_TYPE,
  MARSHAL_STATES, FINAL_STATES, PATTERN_STATES,
  isValidState, isFlightPlanValid, isVoidExpired, computeNla, REQUIRED_FOR_CLEARANCE,
  missingForClearance, CLEARANCE_BLOCK_LABELS,
};
