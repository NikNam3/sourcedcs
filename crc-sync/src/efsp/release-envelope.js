'use strict';

// Standing-release envelope matching (EFSPImplementationGuide.md §4.6.2,
// docs/adr/0017) — "the agreement normally converts the per-flight call
// into a standing release for a named envelope — a stereo route, at or
// below an altitude, within a radius. Anything outside the envelope falls
// back to a per-flight OPERATIONAL_REQUEST."
//
// Pure predicate, injected into nla.js's ctx the same way
// isFlightPlanValid/isVoidExpired already are — facility-config.js owns
// the `standingReleases` list as DATA (§8.1's "configurability is the
// specification"), this module owns only the matching logic, never the
// envelope definitions themselves.

/**
 * @param {object} fdr
 * @param {Array<{envelopeId:string, description?:string, stereoRoute?:string, atOrBelowAltitude?:number, radiusNm?:number, active?:boolean}>} standingReleases
 * @returns {boolean} true if `fdr`'s filed intent falls inside ANY active envelope
 */
function matchesStandingRelease(fdr, standingReleases) {
  if (!fdr || !Array.isArray(standingReleases)) return false;
  return standingReleases.some((envelope) => _matchesOne(fdr, envelope));
}

function _matchesOne(fdr, envelope) {
  if (!envelope || envelope.active === false) return false;

  let matchedSomething = false;

  if (envelope.stereoRoute) {
    if (fdr.filed.route !== envelope.stereoRoute) return false;
    matchedSomething = true;
  }

  if (envelope.atOrBelowAltitude != null) {
    const requested = Number.parseInt(fdr.filed.requestedAltitude, 10);
    if (!Number.isFinite(requested) || requested > envelope.atOrBelowAltitude) return false;
    matchedSomething = true;
  }

  // radiusNm needs a position to check against — no Strip/FDR field in
  // this slice carries one (WP5 track correlation isn't built), so a
  // radius-only envelope can never be matched yet. Treat as unmatched
  // rather than silently ignoring the restriction (a false "inside the
  // envelope" would incorrectly waive the OPERATIONAL_REQUEST fallback).
  if (envelope.radiusNm != null && !matchedSomething) return false;

  // An envelope with NO criteria at all matches nothing — an empty
  // envelope object is a configuration mistake, not "matches everything."
  return matchedSomething;
}

module.exports = { matchesStandingRelease };
