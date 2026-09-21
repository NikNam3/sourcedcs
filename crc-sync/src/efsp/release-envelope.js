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

  // radiusNm still matches nothing, and now by choice rather than for want of
  // a position: WP5's correlation can supply one (docs/adr/0045). It stays
  // unmatched because a radius envelope would make a RELEASE decision depend
  // on surveillance correlation, so a DCS re-ID would silently withdraw a
  // standing release mid-taxi. Both answers to the uncorrelated case are bad
  // in isolation — fail closed and a controller gets spurious
  // OPERATIONAL_REQUESTs every time an id churns; fail open and a release is
  // granted outside its envelope — so it belongs in a release-model slice
  // with §3.8 in front of it. Deferred with reasons in docs/adr/0047.
  //
  // Unmatched rather than ignored: a false "inside the envelope" would
  // incorrectly waive the OPERATIONAL_REQUEST fallback.
  if (envelope.radiusNm != null && !matchedSomething) return false;

  // An envelope with NO criteria at all matches nothing — an empty
  // envelope object is a configuration mistake, not "matches everything."
  return matchedSomething;
}

module.exports = { matchesStandingRelease };
