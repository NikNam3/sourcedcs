'use strict';
import { trackRef } from '../../track-label.js';
import { getLatestTrack } from '../../picture.js';
import { ORDER, markEfspChanged, onEfspChanged } from './efsp-change-bus.js';
import {
  correlatedTrackIdForStrip, getEfspCorrelationForStrip, getEfspStrip, stripIdsForTrackId
} from './efsp-state.js';
import { selectEfspStripById } from './bay/selection.js';
import { map, mapReady } from '../../map-handle.js';
import { getOpenEfspBayIds } from './bay/open-bays.js';

// "Show on map" (H129, live test T10) and contact -> Strip.
//
// The guide's §6.6 rule 4 ("Selecting a Strip MUST highlight its track within
// 1 second, and vice versa") is ours, not an FAA rule, and its Strip -> contact
// half is gone: a ring on every Strip click was noise (H129). The ring is now
// asked for, from the Strip's ⋯ menu ("Show on map"): it rings the contact,
// brings it into view if it is off the map, and goes away by itself after
// RING_SHOW_MS (ours, logged in docs/wip/LT-UI.md).
//
// The one place the EFSP domain and the map domain touch. It lives in its own
// file so bay-view.js stays free of map globals and geojson.js stays free of
// EFSP ones — the split guide §7.5 rule 1 asks for ("keep the panel and the
// map as separate components over shared state"), with this as the seam.

/** How long a "Show on map" ring stays (ours: long enough to find it, short enough to need no dismissing). */
export const RING_SHOW_MS = 8000;

// The Strip whose contact is ringed, the contact itself, and the timer that ends it.
let _ringStripId = null;
let _correlatedTrackId = null;
let _ringTimer = null;

export function getCorrelatedHighlightTrackId() { return _correlatedTrackId; }

function _setRing(trackId) {
  if (trackId === _correlatedTrackId) return;
  _correlatedTrackId = trackId;
  markEfspChanged('map');
}

/** Clears the ring now (the timer, or a test). */
export function clearShownOnMap() {
  if (_ringTimer) clearTimeout(_ringTimer);
  _ringTimer = null;
  _ringStripId = null;
  _setRing(null);
}

/** The contact "Show on map" would ring for this Strip, or null: correlated and in this controller's picture. */
export function showOnMapTrackFor(strip) {
  const trackId = strip ? correlatedTrackIdForStrip(strip) : null;
  return trackId && getLatestTrack(trackId) ? trackId : null;
}

/**
 * Strip -> contact, from the ⋯ menu. Rings the contact for RING_SHOW_MS and
 * pans the map to it if it is off screen (the zoom is left alone). Returns the
 * ringed contact id, or null when there is nothing in the picture to show.
 */
export function showStripOnMap(stripId) {
  const trackId = showOnMapTrackFor(getEfspStrip(stripId));
  if (!trackId) return null;
  if (_ringTimer) clearTimeout(_ringTimer);
  _ringStripId = stripId;
  _setRing(trackId);
  _bringIntoView(getLatestTrack(trackId));
  _ringTimer = setTimeout(clearShownOnMap, RING_SHOW_MS);
  return trackId;
}

function _bringIntoView(track) {
  if (!mapReady || !map || !track || !Number.isFinite(track.lat) || !Number.isFinite(track.lon)) return;
  const bounds = map.getBounds();
  if (bounds && bounds.contains([track.lon, track.lat])) return;
  map.easeTo({ center: [track.lon, track.lat] });
}

/** Re-resolves a ring that is showing against the current records — a re-bind moves it, a lost contact ends it. */
export function refreshCorrelatedHighlight() {
  if (!_ringStripId) return;
  const trackId = showOnMapTrackFor(getEfspStrip(_ringStripId));
  if (trackId) _setRing(trackId);
  else clearShownOnMap();
}

/**
 * Contact -> Strip. Called from the map's own click handlers. Kept by LT-Q3's
 * default (docs/wip/LT-UI.md): it draws no ring, it only selects. To drop it,
 * remove the one call in map-interactions.js.
 *
 * Three cases, and the middle one is a judgement rather than an oversight:
 *
 *   one Strip     select it, and scroll it into view.
 *   none          LEAVE THE CURRENT SELECTION ALONE. Clearing a Strip
 *                 selection because of a click somewhere else makes the panel
 *                 feel haunted, and the absence of a ring is already the
 *                 signal that this contact is not on the board.
 *   several       one flight data with several Strips is ordinary after a
 *                 cross-Facility handoff. Prefer the one in a Bay that is
 *                 actually open, so the selection is somewhere the controller
 *                 can see it.
 */
export function selectStripForTrack(trackId) {
  const stripIds = stripIdsForTrackId(trackId);
  if (stripIds.length === 0) return null;
  const stripId = stripIds.length === 1 ? stripIds[0] : _preferVisibleStrip(stripIds);
  selectEfspStripById(stripId);
  return stripId;
}

/** The candidate whose Bay is currently open, else the first. */
function _preferVisibleStrip(stripIds) {
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
 *   1. A correlation is not a Block. Every Block Map entry routes to a flight data
 *      path, an annotation, a flag, a system value, a composite or a
 *      frequency; a correlation record is keyed by flightDataId in its own store and
 *      is none of those. A Block would need a seventh target kind whose only
 *      member is something no controller can type.
 *   2. The reachability test would silently exempt it. That test holds every
 *      WRITABLE Block to being reachable — a read-only Block is invisible to
 *      the very test that exists to catch invisible fields.
 *   3. The precedent is exact: the airspace badge and the obligation badge are
 *      both non-Block Strip-level indicators, built the same way.
 */
export function correlationBadgeFor(strip) {
  const record = getEfspCorrelationForStrip(strip);
  if (!record) return null;

  const warning = record.warning;
  if (warning && warning.kind === 'AMBIGUOUS_BEACON') {
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

  // The badge names the CONTACT by its own reference — its code, else its
  // track number (track-label.js's trackRef) — never by a callsign: once
  // correlated, the contact's label IS this Strip's callsign (crc-sync's
  // docs/adr/0059), and `TRK VIPER11` under a Strip reading VIPER11 says
  // nothing.
  const track = getLatestTrack(record.trackId);

  // Correlation is a system-wide fact and is worked out against every contact
  // the server has; coverage is per-controller (crc-sync's docs/adr/0042). So a
  // Strip can legitimately be correlated to a contact THIS controller cannot
  // see — an en-route flight bound on somebody else's radar, say.
  //
  // Say so, rather than showing a bare track id that looks like a callsign:
  // "Show on map" has nothing to ring when the contact is outside your picture.
  if (!track) {
    return {
      text: 'TRK ··',
      className: 'efsp-correlation-badge efsp-correlation-outside',
      title: `correlated, but the contact is outside your radar coverage (${_correlatedSentence(record)})`,
      outsideCoverage: true,
    };
  }

  return {
    text: `TRK ${trackRef(track)}`,
    className: 'efsp-correlation-badge efsp-correlation-correlated',
    title: _correlatedSentence(record),
  };
}

function _warningSentence(kind) {
  if (kind === 'TRACK_IDENTITY_LOST') return 'the contact this flight was on no longer exists';
  if (kind === 'TRACK_LOST') return 'no surveillance contact matches this flight';
  if (kind === 'CODE_REISSUED') return 'this code now belongs to a different AI aircraft — bind it, or enter its code';
  return 'uncorrelated';
}

function _correlatedSentence(record) {
  if (record.matchedBy === 'BINDING') {
    const by = record.binding && record.binding.boundPositionId;
    return by ? `bound by ${by}` : 'bound by a controller';
  }
  return `correlated on beacon ${record.observedBeacon}`;
}

// A ring that is showing is re-resolved before the map reads it (efsp-change-bus.js). Selection no longer moves it (H129).
onEfspChanged(['snapshot', 'correlations'], () => refreshCorrelatedHighlight(), { order: ORDER.RESOLVE });
