'use strict';

// Coupled selection (EFSPImplementationGuide.md §6.6 rule 4): "Selecting a
// Strip MUST highlight its track within 1 second, and vice versa."
//
// The one place the EFSP domain and the map domain touch. It lives in its own
// file so bay-view.js stays free of map globals and geojson.js stays free of
// EFSP ones — the split guide §7.5 rule 1 asks for ("keep the panel and the
// map as separate components over shared state"), with this as the seam.
//
// The 1-second budget is almost free here, and it is worth saying why rather
// than instrumenting it: the Strip panel and the map run in ONE renderer, so
// Strip -> contact is a Map lookup plus the existing rAF-batched updateMap().
// There is no code path in which it takes a frame, let alone a second. What
// the budget actually bounds is a contact the server has not bound yet, and
// that is governed by crc-sync's reconcile tick, not by anything here.

// The contact whose ring is currently drawn, or null.
let _correlatedTrackId = null;

function getCorrelatedHighlightTrackId() { return _correlatedTrackId; }

/**
 * Strip -> contact. Called from bay-view.js's _selectStrip.
 *
 * Passing null (nothing selected) clears the ring, which is right: the ring
 * says "this is the Strip you have selected", so with no selection it has
 * nothing to say.
 */
function highlightCorrelatedTrack(stripId) {
  const next = stripId
    ? correlatedTrackIdForStrip(typeof getEfspStrip === 'function' ? getEfspStrip(stripId) : null)
    : null;
  if (next === _correlatedTrackId) return _correlatedTrackId;
  _correlatedTrackId = next;
  if (typeof updateMap === 'function') updateMap();
  return _correlatedTrackId;
}

/** Re-resolves the ring against the current records — called when a correlation delta lands. */
function refreshCorrelatedHighlight() {
  if (typeof getSelectedEfspStripId !== 'function') return;
  highlightCorrelatedTrack(getSelectedEfspStripId());
}

/**
 * Contact -> Strip. Called from the map's own click handlers.
 *
 * Three cases, and the middle one is a judgement rather than an oversight:
 *
 *   one Strip     select it, and scroll it into view.
 *   none          LEAVE THE CURRENT SELECTION ALONE. Clearing a Strip
 *                 selection because of a click somewhere else makes the panel
 *                 feel haunted, and the absence of a ring is already the
 *                 signal that this contact is not on the board.
 *   several       one FDR with several Strips is ordinary after a
 *                 cross-Facility handoff. Prefer the one in a Bay that is
 *                 actually open, so the selection is somewhere the controller
 *                 can see it.
 */
function selectStripForTrack(trackId) {
  if (typeof stripIdsForTrackId !== 'function') return null;
  const stripIds = stripIdsForTrackId(trackId);
  if (stripIds.length === 0) return null;
  const stripId = stripIds.length === 1 ? stripIds[0] : _preferVisibleStrip(stripIds);
  if (typeof selectEfspStripById === 'function') selectEfspStripById(stripId);
  return stripId;
}

/** The candidate whose Bay is currently open, else the first. */
function _preferVisibleStrip(stripIds) {
  if (typeof getOpenEfspBayIds !== 'function' || typeof getEfspStrip !== 'function') return stripIds[0];
  const open = new Set(getOpenEfspBayIds());
  for (const stripId of stripIds) {
    const strip = getEfspStrip(stripId);
    if (strip && open.has(strip.bayId)) return stripId;
  }
  return stripIds[0];
}

/**
 * The badge text and class for a Strip, from its correlation record.
 *
 * Rendered as a Strip-level badge rather than a Block, for three reasons worth
 * keeping written down:
 *
 *   1. A correlation is not a Block. Every Block Map entry routes to an FDR
 *      path, an annotation, a flag, a system value, a composite or a
 *      frequency; a correlation record is keyed by fdrId in its own store and
 *      is none of those. A Block would need a seventh target kind whose only
 *      member is something no controller can type.
 *   2. The reachability test would silently exempt it. That test holds every
 *      WRITABLE Block to being reachable — a read-only Block is invisible to
 *      the very test that exists to catch invisible fields.
 *   3. The precedent is exact: the airspace badge and the obligation badge are
 *      both non-Block Strip-level indicators, built the same way.
 */
function correlationBadgeFor(strip) {
  const record = typeof getEfspCorrelationForStrip === 'function' ? getEfspCorrelationForStrip(strip) : null;
  if (!record) return null;

  const warning = record.warning;
  if (warning && (warning.kind === 'AMBIGUOUS_BEACON' || warning.kind === 'AMBIGUOUS_CALLSIGN')) {
    const n = (warning.candidateTrackIds || []).length;
    return {
      text: `TRK ×${n}`,
      className: 'efsp-correlation-badge efsp-correlation-ambiguous',
      title: warning.detail || `${n} contacts match this flight — bind one`,
      candidateTrackIds: warning.candidateTrackIds || [],
      ambiguous: true,
    };
  }

  if (record.state === 'UNCORRELATED') {
    return {
      text: 'NO TRK',
      className: 'efsp-correlation-badge efsp-correlation-uncorrelated'
        + (warning ? ' efsp-correlation-warned' : ''),
      title: warning
        ? (warning.detail || _warningSentence(warning.kind))
        : 'no surveillance contact matches this flight',
      warned: !!warning,
    };
  }

  // The contact's RESOLVED callsign, not the raw one the matcher compared
  // against — so the controller reads the same name they see on the scope.
  // The asymmetry is deliberate (crc-sync's docs/adr/0046): match on raw,
  // display resolved.
  const track = typeof window !== 'undefined' && typeof window.getLatestTrack === 'function'
    ? window.getLatestTrack(record.trackId) : null;
  const label = (track && track.callsign) || record.trackId;

  if (record.state === 'PROVISIONAL') {
    return {
      text: 'TRK?',
      className: 'efsp-correlation-badge efsp-correlation-provisional',
      title: _provisionalSentence(record, strip),
    };
  }

  return {
    text: `TRK ${label}`,
    className: 'efsp-correlation-badge efsp-correlation-correlated',
    title: _correlatedSentence(record),
  };
}

function _warningSentence(kind) {
  if (kind === 'TRACK_IDENTITY_LOST') return 'the contact this flight was on no longer exists';
  if (kind === 'TRACK_LOST') return 'no surveillance contact matches this flight';
  return 'uncorrelated';
}

function _correlatedSentence(record) {
  if (record.matchedBy === 'BINDING') {
    const by = record.binding && record.binding.boundPositionId;
    return by ? `bound by ${by}` : 'bound by a controller';
  }
  if (record.matchedBy === 'BEACON') return `correlated on beacon ${record.observedBeacon}`;
  return 'correlated on callsign';
}

function _provisionalSentence(record, strip) {
  const fdr = typeof getEfspFdr === 'function' && strip ? getEfspFdr(strip.fdrId) : null;
  const assigned = fdr && fdr.identity ? fdr.identity.beaconAssigned : null;
  if (record.observedBeacon && assigned && record.observedBeacon !== assigned) {
    return `observed ${record.observedBeacon} ≠ assigned ${assigned}`;
  }
  if (record.matchedBy === 'CALLSIGN_FUZZY') {
    return `callsign match (provisional${record.confidence != null ? `, ${record.confidence}` : ''})`;
  }
  return 'provisional match';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    highlightCorrelatedTrack, getCorrelatedHighlightTrackId, refreshCorrelatedHighlight,
    selectStripForTrack, correlationBadgeFor,
  };
}
