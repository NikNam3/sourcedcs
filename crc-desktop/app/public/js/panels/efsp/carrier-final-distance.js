'use strict';
import { getLatestTrack } from '../../picture.js';
import { correlatedTrackIdForStrip } from './efsp-state.js';
import { getEfspCarrier } from './carrier-state.js';

// ── FINAL's distance, from the ship and the contact ──────────────────────

/** Nautical miles from the ship to the flight's correlated contact, or null when either is unknown. The two positions are the server's; this only measures between them for display. */
export function carrierDistanceNm(strip) {
  const view = getEfspCarrier();
  const s = view && view.shipState;
  if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon) || !strip) return null;
  const trackId = correlatedTrackIdForStrip(strip);
  const track = trackId ? getLatestTrack(trackId) : null;
  if (!track || !Number.isFinite(track.lat) || !Number.isFinite(track.lon)) return null;
  const R = 3440.065; // earth radius, NM
  const rad = Math.PI / 180;
  const dLat = (track.lat - s.lat) * rad;
  const dLon = (track.lon - s.lon) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(s.lat * rad) * Math.cos(track.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** The same, as FINAL's DIST Block shows it; '' when either position is unknown. */
export function carrierFinalDistanceText(strip) {
  const nm = carrierDistanceNm(strip);
  return nm == null ? '' : `${nm.toFixed(1)} NM`;
}
