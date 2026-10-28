'use strict';
import { projectPos } from './geo.js';
import { map, mapReady } from './map-handle.js';
import { settings } from './settings.js';

// The mission drawings' shapes, and the highlight the airspace editor's "Pick DCS drawing" list puts on the map
// (U-SCOPE-SMALL item 2). The highlight has its own source and layers above the drawings and the airspace outlines,
// built from `missionData.drawings` directly, so it shows when the "DCS drawings" switch is off and when T28 hides the
// drawing behind the airspace it was copied into. Ours: no FAA rule covers mission drawings.

/** The map geometry of one mission drawing (a circle as a 64-sided polygon), or null for a text box or a drawing with no shape. */
export function drawingGeometry(d) {
  if (!d || d.primitiveType === 'TextBox') return null;
  if (d.polygonMode === 'circle' && d.lat != null && d.radius) {
    const coords = [];
    for (let i = 0; i <= 64; i++) {
      const [lat, lon] = projectPos(d.lat, d.lon, (i / 64) * 360, d.radius);
      coords.push([lon, lat]);
    }
    return { type: 'Polygon', coordinates: [coords] };
  }
  if (!d.points || d.points.length < 2) return null;
  const coords = d.points.map(p => [p.lon, p.lat]);
  // Closed if explicitly flagged or it's a polygon primitive (not a plain line)
  if ((d.closed || d.primitiveType === 'Polygon') && coords.length >= 3) {
    const ring = [...coords];
    const a = ring[0], b = ring[ring.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) ring.push(a);
    return { type: 'Polygon', coordinates: [ring] };
  }
  return { type: 'LineString', coordinates: coords };
}

const EMPTY = { type: 'FeatureCollection', features: [] };

/** The highlight of drawing `index` of `drawings`: its outline as one line (a polygon's ring), or nothing. */
export function buildDrawingHighlight(drawings, index) {
  const d = Array.isArray(drawings) && Number.isInteger(index) ? drawings[index] : null;
  const g = drawingGeometry(d);
  if (!g) return EMPTY;
  const coordinates = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates;
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { idx: index }, geometry: { type: 'LineString', coordinates } }] };
}

/** [[west, south], [east, north]] of a highlight, or null when it is empty. */
export function highlightBounds(fc) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const f of (fc && fc.features) || []) for (const [lon, lat] of f.geometry.coordinates) {
    if (lon < w) w = lon; if (lon > e) e = lon; if (lat < s) s = lat; if (lat > n) n = lat;
  }
  return Number.isFinite(w) ? [[w, s], [e, n]] : null;
}

// Bright turquoise: reads on the dark scope and is none of the alert colours (red, orange, yellow), nor the blue of the
// geometry being edited (airspace-layer.js ACCENT) or of a friendly track. A darker teal on the light theme.
const COLOUR = () => (settings.lightMode ? '#007a7a' : '#40e0d0');
export const HIGHLIGHT_SOURCE = 'drawing-highlight';

/** One registration line in map-layers-overlays.js, right after the airspace layers (so above them and the drawings). */
export function registerDrawingHighlightLayer() {
  _shown = null;
  map.addSource(HIGHLIGHT_SOURCE, { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'drawing-highlight-halo', type: 'line', source: HIGHLIGHT_SOURCE, layout: { 'line-join': 'round' },
    paint: { 'line-color': COLOUR(), 'line-width': 8, 'line-opacity': 0.22 } });
  map.addLayer({ id: 'drawing-highlight-line', type: 'line', source: HIGHLIGHT_SOURCE, layout: { 'line-join': 'round' },
    paint: { 'line-color': COLOUR(), 'line-width': 2.5, 'line-opacity': 1 } });
}

let _shown = null;
let _owner = null;
let _watch = null;
/** The drawing index highlighted now, or null (the e2e spec reads it). */
export function highlightedDrawing() { return _shown; }

/**
 * Highlight drawing `index` of `drawings` (replacing any other). `owner`: the element that asked (a picker row); the
 * highlight clears itself once that element is no longer shown, e.g. its dock panel was closed or put behind another tab.
 */
export function showDrawingHighlight(drawings, index, owner = null) {
  if (!mapReady || !map.getSource(HIGHLIGHT_SOURCE)) return;
  const fc = buildDrawingHighlight(drawings, index);
  _shown = fc.features.length ? index : null;
  _owner = _shown === null ? null : owner;
  for (const id of ['drawing-highlight-halo', 'drawing-highlight-line']) map.setPaintProperty(id, 'line-color', COLOUR());
  map.getSource(HIGHLIGHT_SOURCE).setData(fc);
  if (_owner && !_watch) _watch = setInterval(() => { if (_owner && !(_owner.isConnected && _owner.offsetParent)) clearDrawingHighlight(); }, 300);
}

export function clearDrawingHighlight() {
  _owner = null;
  if (_watch) { clearInterval(_watch); _watch = null; }
  if (_shown === null) return;
  _shown = null;
  if (mapReady && map.getSource(HIGHLIGHT_SOURCE)) map.getSource(HIGHLIGHT_SOURCE).setData(EMPTY);
}

/**
 * The picker's "show" control: bring drawing `index` into view when it is not wholly in view already. The map never
 * moves on a hover or a focus, only on this explicit action. Returns true when it moved the map.
 */
export function bringDrawingIntoView(drawings, index) {
  if (!mapReady) return false;
  const b = highlightBounds(buildDrawingHighlight(drawings, index));
  if (!b) return false;
  const v = map.getBounds();
  const inView = b[0][0] >= v.getWest() && b[1][0] <= v.getEast() && b[0][1] >= v.getSouth() && b[1][1] <= v.getNorth();
  if (inView) return false;
  map.fitBounds(b, { padding: 60, maxZoom: Math.max(map.getZoom(), 9), duration: 600 });
  return true;
}
