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
//
// `stereoRoute` now matches §9.10's filed short name first and the expanded
// route string only as a fallback — see _matchesOne and docs/adr/0050. The
// route table it names lives in stereo-routes.js; this module still knows
// nothing about it, and deliberately: it compares two strings off the FDR.

/**
 * @param {object} fdr — matched on `filed.stereoRouteName` (preferred) / `filed.route` / `filed.requestedAltitude`
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
    // Match the FILED SHORT NAME when the FDR carries one — that is the
    // whole point of a stereo (§9.10), and docs/adr/0050 built the table
    // this criterion was written against but could not reach.
    //
    // When it does not, fall back to comparing the expanded route string,
    // which is what this did exclusively before the table existed. That
    // fallback is not laziness on either count: docs/adr/0017 shipped
    // route-string matching, so an envelope a squadron configured before
    // this slice still matches the flight it was written for; and a flight
    // filed by hand rather than by short name is still eligible for the
    // agreement. A clean break to name-only would have stopped both
    // matching SILENTLY, and the symptom would be a flight sitting on an
    // unexplained hold — the worst direction for a release rule to fail in.
    //
    // Once a name is present it wins outright; filed.route is not consulted
    // as a second chance. "Match either" was rejected: a flight filed on
    // PACK 1 whose route was later amended to some other envelope's string
    // would then match both, and two answers to one question is the defect
    // class, not the fix.
    const filedName = String(fdr.filed.stereoRouteName || '').trim();
    const candidate = filedName || fdr.filed.route;
    if (String(candidate || '') !== String(envelope.stereoRoute)) return false;
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
