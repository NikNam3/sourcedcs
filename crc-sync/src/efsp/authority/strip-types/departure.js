'use strict';

// The DEPARTURE strip-type family (authority registry, docs/adr/0095): its
// states, NLA table, state owners and the rest of the per-strip-type tables
// named on each field below. nla.js and permission.js are facades over it.

const { matchesStandingRelease } = require('../../release-envelope');
const { _requireNow, _runwayInhibit } = require('./nla-common');

const DEPARTURE_STATES = [
  'PROPOSED', 'PENDING_CLEARANCE', 'CLEARED', 'HELD', 'PUSHBACK', 'TAXI',
  'RUNWAY_QUEUE', 'LUAW', 'DEPARTED', 'HANDED_OFF', 'DROPPED',
];

// [SOURCE-DEFINED] (guide §3.4) — per-State authority (the guide's "normally
// owned by" column, itself [SOURCE-DEFINED]): WHO may advance a Strip OUT of a
// given State. Checked by the Board (board/ops/invoke-nla.js) in
// ADDITION to raw Strip ownership, not instead of it: ownership alone
// (guide §4.4) only ever meant "which Position currently holds this
// Strip," and nothing enforced that holding it also lined up with §3.4's
// per-State authority column — a Position could hold a Strip indefinitely
// and simply never transfer it, walking it through every other Position's
// job single-handedly (e.g. OPS pressing "Mark Cleared" on a Strip it
// created and never handed to CD). This table closes that gap.
//
// Keyed on strip.state — the state the Strip is CURRENTLY in when the
// action is taken (the FROM state), matching how §3.4's table reads: who
// works a Strip WHILE it's in a given State. Applies uniformly to every
// NLA transition (board/ops/invoke-nla.js's _applyInvokeNla) AND every equivalent
// drag-based Bay-implied transition (board/placement.js's validateBayImpliedTransition) —
// guide §3.5 rule 4 makes NLA an accelerator, never the ONLY path to a
// transition, so gating only the button would be a trivial bypass via drag.
const DEPARTURE_STATE_OWNERS = {
  PROPOSED:          ['OPS'],
  PENDING_CLEARANCE: ['CD'],
  CLEARED:           ['CD'],
  HELD:              ['CD', 'GC'],
  PUSHBACK:          ['GC'],
  TAXI:              ['GC'],
  RUNWAY_QUEUE:      ['LC'],
  LUAW:              ['LC'],
  DEPARTED:          ['LC'],
  // CTR added (docs/adr/0022 bug fix) — a CENTER-held HANDED_OFF Strip
  // (received via APP's real HANDOFF, mirroring ARRIVAL_STATE_OWNERS.
  // INBOUND's existing ['AP','CTR'] entry for the reverse direction)
  // needs its owning Position authorized to Drop it, same as APP's own
  // copy. Without this, a CENTER-side replica — whether legitimately
  // ACCEPTed and moved to ctr-departures, or REJECTed and left inert in
  // ctr-ap-coordination — had NO way to ever be cleared: NLA's Drop
  // button rendered but stayed permanently disabled (canActOnState denied
  // to CTR), found in live testing.
  HANDED_OFF:        ['AP', 'CTR'],
  // DROPPED is terminal — no NLA exists for it, so no entry is needed.
};

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

function isFlightPlanValid(flightData) {
  if (!flightData) return false;
  return REQUIRED_FOR_CLEARANCE.every(k => !!flightData.filed[k]);
}

/**
 * The Block labels of whatever CLEARED still needs, in Block order — [] when
 * the plan is complete, and every label when there is no FDR at all (nothing
 * is filed, so nothing is filled in).
 * @returns {string[]}
 */
function missingForClearance(flightData) {
  return CLEARANCE_LABEL_ORDER
    .filter(k => !flightData || !flightData.filed[k])
    .map(k => CLEARANCE_BLOCK_LABELS[k]);
}

/** The §3.5-rule-2 inhibit reason for an incomplete plan, naming the Blocks — same specific style as 'a hold is in force' / 'void time expired'. */
function flightPlanInhibitReason(flightData) {
  return `flight plan incomplete — ${missingForClearance(flightData).join(', ')} not filed`;
}

// The two release states whose gate is a derived WINDOW rather than a single
// instant (docs/adr/0017). RELEASE_TIME is deliberately absent — it is a
// "not before" with no upper bound, checked separately in the HELD case.
const WINDOWED_DEPARTURE_RELEASE_STATES = {
  EDCT:             { startKey: 'edctWindowStartUtc',           endKey: 'edctWindowEndUtc',           label: 'EDCT' },
  CALL_FOR_RELEASE: { startKey: 'callForReleaseWindowStartUtc', endKey: 'callForReleaseWindowEndUtc', label: 'call-for-release' },
};

/** True at or after the derived 30-minute void deadline (guide §3.8). Alerting on this is a periodic job elsewhere (this is pure logic, no timers). */
function isVoidExpired(flightData, now) {
  _requireNow(now);
  return !!(flightData && flightData.assigned.voidDeadlineUtc && now >= flightData.assigned.voidDeadlineUtc);
}

/**
 * @param {object} strip
 * @param {object|null} flightData
 * @param {number} now
 * @param {{isStaffed:(positionId:string)=>boolean, consolidatedAt:(positionId:string)=>string|null}} ctx
 * @returns {{toState:string, transferTo?:string}|{inhibited:string}|null}
 */
function computeDepartureNla(strip, flightData, now, ctx) {
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
      if (!flightData || !flightData.identity.beaconAssigned) return { inhibited: 'no beacon code assigned' };
      if (!ctx.isStaffed('CD') && !ctx.consolidatedAt('CD')) {
        return { inhibited: 'no receiving Position present' };
      }
      return { toState: 'PENDING_CLEARANCE', transferTo: 'CD' };

    case 'PENDING_CLEARANCE':
      // CLEARED is still CD's own (DEPARTURE_STATE_OWNERS), so this stays
      // state-only — no Position boundary is crossed here.
      if (!isFlightPlanValid(flightData)) return { inhibited: flightPlanInhibitReason(flightData) };
      return { toState: 'CLEARED' };

    case 'CLEARED':
      if (flightData && flightData.assigned.departureRelease !== 'RELEASED') return { inhibited: 'a hold is in force' };
      // Alert-pad conflict (§9.6) is a flag from alert-scramble.js, never an
      // inhibit here — the guide's [GAP] (docs/adr/0070).
      if (!ctx.isStaffed('GC') && !ctx.consolidatedAt('GC')) {
        return { inhibited: 'no receiving Position present' };
      }
      return { toState: 'PUSHBACK', transferTo: 'GC' };

    case 'HELD':
      if (flightData && flightData.assigned.departureRelease === 'RELEASE_TIME' && flightData.assigned.releaseTimeUtc && now < flightData.assigned.releaseTimeUtc) {
        return { inhibited: 'release time not reached' };
      }
      // WP4A (docs/adr/0017), §4.6.2: a HOLD_FOR_RELEASE flight that falls
      // inside a configured standing-release envelope resolves on its own
      // (the agreement already covers it); one that doesn't needs an
      // explicit per-flight OPERATIONAL_REQUEST — the fallback the guide's
      // own text names. Only checked for HOLD_FOR_RELEASE specifically:
      // RELEASE_TIME/EDCT/CALL_FOR_RELEASE already have their own
      // time-based gates above/below, and RELEASED has none at all.
      if (flightData && flightData.assigned.departureRelease === 'HOLD_FOR_RELEASE' && !matchesStandingRelease(flightData, ctx.standingReleases)) {
        return { inhibited: 'outside standing release envelope — file OPERATIONAL_REQUEST' };
      }
      // WP4A (docs/adr/0017), §4.6.2 — the EDCT and call-for-release
      // windows. flight-data-store.js has derived both on every write since that
      // slice (EDCT ±5 min, call-for-release −2/+1), and until now nothing
      // anywhere read them: a flight with a slot an hour away was not held
      // at all, which made the whole derivation inert. Found by walking a
      // release sortie. Missing a window inhibits too — a slot that has
      // passed needs a new one, and sliding through it silently is exactly
      // what the window exists to prevent.
      const windowed = flightData && WINDOWED_DEPARTURE_RELEASE_STATES[flightData.assigned.departureRelease];
      if (windowed) {
        const opensAt = flightData.assigned[windowed.startKey];
        const closesAt = flightData.assigned[windowed.endKey];
        if (opensAt && now < opensAt) return { inhibited: `${windowed.label} window is not open yet` };
        if (closesAt && now > closesAt) return { inhibited: `${windowed.label} window has passed — a new slot is needed` };
      }
      if (isVoidExpired(flightData, now)) return { inhibited: 'void time expired' };
      // HELD is jointly owned by CD and GND (DEPARTURE_STATE_OWNERS) since
      // either may be the one holding it, but PUSHBACK is GND's alone —
      // always transfer to GND here, a no-op reassignment when GND already
      // held it.
      if (!ctx.isStaffed('GC') && !ctx.consolidatedAt('GC')) {
        return { inhibited: 'no receiving Position present' };
      }
      return { toState: 'PUSHBACK', transferTo: 'GC' };

    case 'PUSHBACK':
      // TAXI is still GND's own — state-only.
      return { toState: 'TAXI' };

    case 'TAXI': {
      // §9.7 rule 1: a departure does not enter the queue for a runway that
      // is suspended or closed — checked before the staffing gate, because
      // the runway is the reason it cannot go, whoever is in the tower.
      const runway = _runwayInhibit(strip, flightData, ctx);
      if (runway) return { inhibited: runway };
      if (!ctx.isStaffed('LC') && !ctx.consolidatedAt('LC')) {
        return { inhibited: 'no receiving Position present' };
      }
      return { toState: 'RUNWAY_QUEUE', transferTo: 'LC' };
    }

    case 'RUNWAY_QUEUE': {
      // §9.7 rule 1: no line-up on a suspended or closed runway. Runway
      // OCCUPANCY is not implemented (no §9.7 field for it — see the module
      // comment); this is the runway-status inhibit only.
      const runway = _runwayInhibit(strip, flightData, ctx);
      if (runway) return { inhibited: runway };
      return { toState: 'LUAW' };
    }

    case 'LUAW': {
      // §9.7 rule 1: no takeoff from a suspended or closed runway — covers a
      // runway works begun while the aircraft sat lined up. Occupancy, again,
      // is not implemented.
      const runway = _runwayInhibit(strip, flightData, ctx);
      if (runway) return { inhibited: runway };
      return { toState: 'DEPARTED' };
    }

    case 'DEPARTED':
      // Real, staffing-gated "Hand Off" to APP (docs/adr/0007) — an
      // intrafacility TransferStrip, not WP4A's cross-Facility HANDOFF.
      if (!ctx.isStaffed('AP') && !ctx.consolidatedAt('AP')) {
        return { inhibited: 'no receiving Position present' };
      }
      return { toState: 'HANDED_OFF', transferTo: 'AP' };

    case 'HANDED_OFF':
      return { toState: 'DROPPED' };

    case 'DROPPED':
    default:
      return null;
  }
}

const family = {
  stripType: 'DEPARTURE',
  states: DEPARTURE_STATES,
  initialState: 'PROPOSED',                       // board-store.js's DEFAULT_INITIAL_STATE_BY_STRIP_TYPE
  stateOwners: DEPARTURE_STATE_OWNERS,
  computeNla: computeDepartureNla,
  countablePreDropStates: ['DEPARTED', 'HANDED_OFF'],   // it got airborne
  excludedWhenNotCountable: 'NEVER_DEPARTED',
  replicaStateOnReceipt: null,                    // absent = the sender's state
  senderStateOnAccept: null,
  coordinationEligibleState: 'HANDED_OFF',        // docs/adr/0022: APP->CTR
  tofiEligibleState: 'HANDED_OFF',
};

module.exports = {
  family,
  DEPARTURE_STATES, DEPARTURE_STATE_OWNERS, REQUIRED_FOR_CLEARANCE, CLEARANCE_BLOCK_LABELS,
  isFlightPlanValid, missingForClearance, isVoidExpired, computeDepartureNla,
};
