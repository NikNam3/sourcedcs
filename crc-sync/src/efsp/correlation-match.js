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
// FIRST: match against the RAW track callsign, never resolve.js's
// resolveCallsign() output. Four reasons, and the first is decisive.
//
//   1. resolveCallsign rewrites the display name FROM THE SQUAWK MAP
//      (squawkMap[squawk], then squawkSeq base+offset). Matching on it would
//      make the callsign rung a laundered restatement of the beacon rung — a
//      squawk match with a config lookup in the middle. That collapses two
//      rungs into one and destroys the point of a ladder, which is that when
//      beacon evidence fails, callsign can still succeed on INDEPENDENT
//      evidence.
//   2. It would make surveillance identity depend on config/squawk-map.json,
//      which any connected client can edit live (ws-hub.js's squawkMapSet). A
//      squadron config edit silently re-correlating flights is indefensible.
//   3. resolveCallsign also mints TN##### for non-friendly tracks and applies
//      controller renames from collab-store.js. A controller renaming a target
//      on the scope must not re-bind a flight strip.
//   4. The raw track callsign is the DCS unit callsign, which is what a pilot
//      files. That is the right thing to compare against identity.callsign.
//
// Match on raw; DISPLAY resolved. The Strip badge shows the track's resolved
// callsign, so a controller reads the same name they see on the scope. The
// asymmetry is deliberate — do not "fix" either half into the other.
//
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
 * The observed Mode 3/A code from a track, as the 4-digit octal STRING the
 * rest of the EFSP uses.
 *
 * This bridges a real type gap: SRS reports `Mode3` as a NUMBER (srs-client.js
 * passes it straight through to TrackStore), while code-allocator.js mints and
 * validates 4-digit octal strings. A code containing an 8 or a 9 is not a
 * Mode 3/A code at all and yields null rather than a plausible-looking wrong
 * answer — a bogus observed code would sit next to the assigned one in §3.10.2
 * rule 1's mismatch display and read as a real disagreement.
 */
function beaconFromTrack(track) {
  if (!track || track.squawk == null) return null;
  const n = Number(track.squawk);
  if (!Number.isInteger(n) || n < 0) return null;
  const code = String(n).padStart(4, '0');
  return /^[0-7]{4}$/.test(code) ? code : null;
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
function buildTrackIndices(tracks) {
  const byBeacon = new Map(); // '0041' -> [trackId]
  const byStem = new Map();   // 'VIPER' -> [trackId]
  const byId = new Map();     // trackId -> track

  for (const track of tracks || []) {
    const id = String(track.id);
    byId.set(id, track);

    const beacon = beaconFromTrack(track);
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
  normaliseCallsign, splitCallsign, beaconFromTrack, callsignAffinity, buildTrackIndices,
  AFFINITY_EXACT, AFFINITY_FORMATION, AFFINITY_SUFFIXED, AFFINITY_SAME_STEM,
};
