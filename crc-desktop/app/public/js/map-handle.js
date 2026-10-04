'use strict';
import { getActiveRadars } from './picture.js';

// The MapLibre map and the two pointer-tool states that go with it. A leaf (DESK-GRAPH): `map-setup.js` creates the map and
// hands it over through the setters; everything else reads `map` / `mapReady` from here instead of from `app.js`.
// An imported binding is read-only, so the assignment lives behind the setters (ESM-1).

export let mapReady         = false;
export let map;
export let _drag            = null;
export let _measure         = null;

export function _setMap(v) { map = v; }
export function _setMapReady(v) { mapReady = v; }
export function _setDrag(v) { _drag = v; }
export function _setMeasure(v) { _measure = v; }

// ── Zoom + pan limits ─────────────────────────────────────────────────────
// Computes the bounding rectangle of all active radar coverage areas (each
// radar treated as a square), then enforces that rectangle as the map bounds
// and sets minZoom so the full coverage area is always visible.
export function updateZoomLimits() {
  if (!mapReady) return;
  const radars = getActiveRadars();

  if (radars.length === 0) {
    map.setMaxBounds(null);
    map.setMinZoom(2);
    return;
  }

  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;

  for (const r of radars) {
    const latDeg = r.rangeM / 111320;
    const lonDeg = r.rangeM / (111320 * Math.cos(r.lat * Math.PI / 180)) * 1.5;
    minLat = Math.min(minLat, r.lat - latDeg);
    maxLat = Math.max(maxLat, r.lat + latDeg);
    minLon = Math.min(minLon, r.lon - lonDeg);
    maxLon = Math.max(maxLon, r.lon + lonDeg);
  }

  // Aggressive: pad only 3% so the view is tightly constrained
  const padLat = (maxLat - minLat) * 0.03;
  const padLon = (maxLon - minLon) * 0.03;

  map.setMaxBounds([
    [minLon - padLon, minLat - padLat],
    [maxLon + padLon, maxLat + padLat],
  ]);

  // minZoom: just enough to see the full coverage rect at screen size
  const spanDeg = Math.max(maxLat - minLat, (maxLon - minLon) * 0.65);
  const minZoom = spanDeg > 12 ? 4 : spanDeg > 5 ? 5 : spanDeg > 2 ? 6 : 7;
  map.setMinZoom(minZoom);
}
