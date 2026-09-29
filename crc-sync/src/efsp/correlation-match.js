'use strict';

// The correlation key ladder (EFSPImplementationGuide.md §6.6 rule 1):
//
//   explicit controller binding -> Mode 3/A beacon code
//     -> callsign exact match -> callsign fuzzy match (flagged provisional)
//
// Pure, and tested on its own (tests/efsp-correlation-match.test.mjs) — the
// same discipline computeDueObligations has, and for the same reason: the
// rungs are the part of WP5 most likely to be argued about later, so they
// should be arguable against assertions rather than against a running server.
//
// Two decisions live here rather than in the reconciler, because they are
// properties of matching rather than of scheduling.
//
// FIRST: the evidence is what the aircraft itself gives, never what a
// controller sees on the scope.
//
//   - The beacon rung matches the code the transponder is SENDING
//     (surveillance/transponder.js, injected as `beaconOf`): nothing when it
//     is off, and never an AI's synthetic code, which no FDR can hold.
//   - The callsign rungs match the RAW DCS unit callsign, which is what a
//     pilot files, and never the label a controller sees. The label comes
//     from correlation itself (the Strip's callsign) or from a controller's
//     tag, so matching on it would let a correlation confirm itself, and let
//     renaming a contact on the scope re-bind a Strip (docs/adr/0046, 0059).

// SECOND: no edit distance, and no tunable threshold. A Levenshtein cutoff has
// no doctrinal basis (defect D11's shape) and misfires exactly where it
// matters: VIPER1 vs VIPER2 and VIPER1 vs a typo'd VIPER1 are both distance 1
// and mean opposite things. Military callsigns have structure — a stem and an
// element number — so the rule decomposes that structure instead of measuring
// string similarity.

// Affinity values, highest first. Not config and not persisted: nothing about
// them is per-Facility, and a persisted tuning constant lets an old snapshot
// pin a value the code has since moved past (docs/adr/0041's lesson).
const AFFINITY_EXACT = 1.0;
const AFFINITY_FORMATION = 0.9; // VIPER1 filed, VIPER11/VIPER12 flying
const AFFINITY_SUFFIXED = 0.8;  // VIPER1 against VIPER1A
const AFFINITY_SAME_STEM = 0.7; // VIPER1 against VIPER2 — same flight, wrong element

/** Upper-cased alphanumerics only: 'Viper 1-1' -> 'VIPER11'. */
function normaliseCallsign(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Splits a normalised callsign into its letter stem and trailing digits.
 * 'VIPER11' -> { stem: 'VIPER', digits: '11' }
 * 'VIPER1A' -> { stem: 'VIPER', digits: '1', suffix: 'A' }
 */
function splitCallsign(cs) {
  const normalised = normaliseCallsign(cs);
  const m = /^([A-Z]*)(\d*)([A-Z]*)$/.exec(normalised);
  if (!m) return { stem: normalised, digits: '', suffix: '' };
  return { stem: m[1], digits: m[2], suffix: m[3] };
}

/**
 * How closely two callsigns match, or null for no match at all.
 *
 * The formation case is the highest-value rule here for a milsim, and it is
 * the reason the decomposition is worth having: DCS names a two-ship
 * VIPER11/VIPER12 while the flight plan filed VIPER1 for the formation,
 * because guide §3.2 rule 2 makes a formation ONE Identity with flightSize > 1.
 */
function callsignAffinity(fdrCallsign, trackCallsign) {
  const a = normaliseCallsign(fdrCallsign);
  const b = normaliseCallsign(trackCallsign);
  if (!a || !b) return null;
  if (a === b) return AFFINITY_EXACT;

  const sa = splitCallsign(a);
  const sb = splitCallsign(b);
  if (!sa.stem || sa.stem !== sb.stem) return null;

  // One side's element numbering extends the other's: VIPER1 <-> VIPER11.
  if (sa.digits && sb.digits) {
    if (sa.digits.startsWith(sb.digits) || sb.digits.startsWith(sa.digits)) {
      return sa.digits === sb.digits ? AFFINITY_SUFFIXED : AFFINITY_FORMATION;
    }
    // Same stem, genuinely different element: VIPER1 <-> VIPER2. A match, but
    // the weakest one — and the one most in need of a controller's binding.
    return AFFINITY_SAME_STEM;
  }

  // One side has no digits at all: VIPER <-> VIPER1, or VIPER <-> VIPERA.
  return AFFINITY_SUFFIXED;
}

/**
 * Per-tick lookup tables over the live tracks, built once rather than
 * re-scanned per FDR — this is what keeps the reconciler O(tracks + fdrs).
 *
 * Both are one-to-MANY on purpose. A duplicate beacon code is structural and
 * explicitly accepted (§3.10.2 rule 7: "duplicate codes raise an alert, never
 * a hard block"), and two aircraft can share a callsign stem, so collapsing
 * either to one entry would silently pick a winner. Ambiguity is an outcome
 * the reconciler reports, not something to hide here.
 */
function buildTrackIndices(tracks, beaconOf) {
  const byBeacon = new Map(); // '0041' -> [trackId]
  const byStem = new Map();   // 'VIPER' -> [trackId]
  const byId = new Map();     // trackId -> track

  for (const track of tracks || []) {
    const id = String(track.id);
    byId.set(id, track);

    const beacon = beaconOf(track);
    if (beacon) {
      const list = byBeacon.get(beacon);
      if (list) list.push(id); else byBeacon.set(beacon, [id]);
    }

    const { stem } = splitCallsign(track.callsign);
    if (stem) {
      const list = byStem.get(stem);
      if (list) list.push(id); else byStem.set(stem, [id]);
    }
  }

  return { byBeacon, byStem, byId };
}

module.exports = {
  normaliseCallsign, splitCallsign, callsignAffinity, buildTrackIndices,
  AFFINITY_EXACT, AFFINITY_FORMATION, AFFINITY_SUFFIXED, AFFINITY_SAME_STEM,
};
