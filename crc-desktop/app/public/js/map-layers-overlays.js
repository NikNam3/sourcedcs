'use strict';
import { registerAirspaceLayers } from './airspace-layer.js';
import { registerDrawingHighlightLayer } from './drawing-highlight.js';
import { TEXT_SIZE_PX } from './scope-constants.js';
import { map } from './map-handle.js';

// The scope's base overlay sources and layers (DESK-SPLIT, split out of map-setup.js's initMap): elevation contours, radar debug,
// range rings, drawings, text marks, filed route, navpoints, the selection and correlation rings, conflict alert, airports, bullseye,
// trails, PPL, datalink locks, approach vector, centerline, carrier final line and the measure line. Run once, from the map's 'load'.
export function addOverlayLayers() {
  // ── Elevation contour overlay (computed from terrain-RGB DEM) ───────────
  // Toggleable via Settings → General → Map Overlays. Lines-only overlay —
  // no colored terrain fill — so it reads as reference hachures under the
  // tracks rather than a full topo basemap. MapTiler's ready-made contour
  // vector tileset only has data at zoom 9+ (its tile server 400s below
  // that), so contours are instead traced ourselves from MapTiler's
  // terrain-RGB elevation tiles (available at every zoom) — see
  // elevation.js. These two sources start empty; elevation.js populates
  // them on demand, so visibility is entirely data-driven (no
  // layout.visibility toggling needed here).
  map.addSource('elevation-contours', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('elevation-contour-labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'elevation-contours-lines',
    type: 'line',
    source: 'elevation-contours',
    paint: {
      'line-color': '#8a6a3a',
      'line-width':   ['case', ['get', 'isIndex'], 1.4, 0.6],
      'line-opacity': ['case', ['get', 'isIndex'], 0.75, 0.4],
    },
  });
  map.addLayer({
    id: 'elevation-contours-labels',
    type: 'symbol',
    source: 'elevation-contour-labels',
    layout: {
      'text-field': ['get', 'text'],
      'text-font': ['Roboto Medium', 'Noto Sans Regular'],
      'text-size': 10,
    },
    paint: {
      'text-color': '#8a6a3a',
      'text-halo-color': '#000000',
      'text-halo-width': 1,
    },
  });

  // ── Radar debug overlay ──────────────────────────────────────────────
  // Sweep lines / cone edges for active radars (debug mode only).
  map.addSource('radar-debug', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'radar-debug-lines', type: 'line', source: 'radar-debug',
    paint: {
      'line-color':   ['get', 'color'],
      'line-opacity': ['coalesce', ['get', 'opacity'], 0.7],
      'line-width':   1,
      'line-dasharray': [4, 3],
    },
  });

  // ── Range rings ──────────────────────────────────────────────────────
  map.addSource('range-ring', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'range-ring-line', type: 'line', source: 'range-ring',
    filter: ['==', ['get', 'ring'], 'range'],
    paint: { 'line-color': '#8aaa6a', 'line-opacity': 0.4, 'line-width': 1, 'line-dasharray': [8, 6] },
  });
  map.addLayer({
    id: 'ground-ring-line', type: 'line', source: 'range-ring',
    filter: ['==', ['get', 'ring'], 'ground'],
    paint: { 'line-color': '#8aaa6a', 'line-opacity': 0.22, 'line-width': 1, 'line-dasharray': [3, 4] },
  });

  // ── Mission drawings ─────────────────────────────────────────────────
  // Rendered below all track data so they serve as background reference.
  map.addSource('drawings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  // Polygon fills (closed shapes: rects, circles, etc.)
  map.addLayer({
    id: 'drawing-fills', type: 'fill', source: 'drawings',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: {
      'fill-color':   ['get', 'fillColor'],
      'fill-opacity': 1,
    },
  });
  // Outlines for all drawing features
  map.addLayer({
    id: 'drawing-lines', type: 'line', source: 'drawings',
    paint: {
      'line-color':   ['get', 'color'],
      'line-width':   1.2,
      'line-opacity': 0.85,
    },
  });

  // ── DCS mission-editor text marks (TextBox drawings) ───────────────────
  map.addSource('text-marks', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'text-marks-labels', type: 'symbol', source: 'text-marks',
    layout: {
      'text-field':            ['get', 'text'],
      'text-font':             ['Roboto Regular', 'Noto Sans Regular'],
      'text-size':             10,
      'text-anchor':           'left',
      'text-offset':           [0.4, 0],
      'text-allow-overlap':    false,
      'text-ignore-placement': false,
    },
    paint: {
      'text-color':      ['get', 'color'],
      'text-halo-color': '#000000',
      'text-halo-width': 1,
    },
  });

  // ── Airspace outlines (AIRSP-2P-B): below the tracks, above the drawings ──
  registerAirspaceLayers();
  // The airspace editor's picker highlight (drawing-highlight.js): above the drawings and the outlines, below the tracks.
  registerDrawingHighlightLayer();

  // ── Filed route overlay (from the track panel's FPL section) ───────────
  map.addSource('filed-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'filed-route-line', type: 'line', source: 'filed-route',
    paint: {
      'line-color':     '#cc66cc',
      'line-width':     1.5,
      'line-opacity':   0.85,
    },
  });

  // ── Nav/waypoints ─────────────────────────────────────────────────────
  map.addSource('navpoints', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'navpt-icons', type: 'symbol', source: 'navpoints',
    layout: {
      'icon-image':            'navpt',
      'icon-allow-overlap':    true,
      'icon-ignore-placement': true,
    },
    paint: { 'icon-opacity': 0.85 },
  });
  map.addLayer({
    id: 'navpt-labels', type: 'symbol', source: 'navpoints',
    layout: {
      'text-field':            ['get', 'name'],
      'text-font':             ['Roboto Regular', 'Noto Sans Regular'],
      'text-size':             9,
      'text-anchor':           'top',
      'text-offset':           [0, 0.7],
      'text-allow-overlap':    false,
      'text-ignore-placement': false,
    },
    paint: {
      'text-color':   '#3a5a3a',
      'text-opacity': 0.9,
    },
  });

  // ── Selection ring around reference track ────────────────────────────
  map.addSource('ref-dot', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'ref-dot-ring', type: 'circle', source: 'ref-dot',
    paint: {
      'circle-radius': 10, 'circle-color': 'transparent',
      'circle-stroke-color': '#8aaa6a', 'circle-stroke-width': 1.5,
      'circle-opacity': 0, 'circle-stroke-opacity': 0.85,
    },
  });

  // ── Ring around a Strip's contact, from "Show on map" (H129) ─────────
  // A SECOND source, deliberately not `ref-dot`. That one is the BRA
  // reference track — a different, simultaneously-meaningful selection that
  // buildRangeRing also reads — so overloading it would make "Show on map"
  // silently move the controller's bullseye reference. Wider radius
  // and a distinct stroke so both rings can sit on one contact and still
  // read as two different things; not the attention red, which guide §7.7
  // rule 4 reserves.
  map.addSource('efsp-correlation', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'efsp-correlation-ring', type: 'circle', source: 'efsp-correlation',
    paint: {
      'circle-radius': 15, 'circle-color': 'transparent',
      'circle-stroke-color': '#c8b46a', 'circle-stroke-width': 2,
      'circle-opacity': 0, 'circle-stroke-opacity': 0.9,
    },
  });

  // ── Short-term conflict overlay (docs/adr/0058) ──────────────────────
  // Predicted paths to the closest point, the line between the two closest
  // points, and the countdown there. Orange-red, the conflict colour on the
  // Strips too; not the attention red §7.7 rule 4 reserves.
  map.addSource('conflictAlert', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'conflict-alert-paths', type: 'line', source: 'conflictAlert',
    filter: ['==', ['get', 'kind'], 'path'],
    paint: { 'line-color': '#ff8a4c', 'line-width': 1.5, 'line-dasharray': [3, 2], 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'conflict-alert-cpa-line', type: 'line', source: 'conflictAlert',
    filter: ['==', ['get', 'kind'], 'cpa-line'],
    paint: { 'line-color': '#ff8a4c', 'line-width': 1 },
  });
  map.addLayer({
    id: 'conflict-alert-cpa', type: 'circle', source: 'conflictAlert',
    filter: ['==', ['get', 'kind'], 'cpa'],
    paint: {
      'circle-radius': 12, 'circle-color': 'rgba(255,138,76,0.12)',
      'circle-stroke-color': '#ff8a4c', 'circle-stroke-width': 1,
    },
  });
  map.addLayer({
    id: 'conflict-alert-cpa-label', type: 'symbol', source: 'conflictAlert',
    filter: ['==', ['get', 'kind'], 'cpa'],
    layout: {
      'text-field': ['get', 'label'], 'text-font': ['Roboto Regular', 'Noto Sans Regular'],
      'text-size': TEXT_SIZE_PX, 'text-anchor': 'left', 'text-offset': [1.4, -0.8],
      'text-allow-overlap': true, 'text-ignore-placement': true,
    },
    paint: { 'text-color': '#ffd2bd' },
  });

  // ── Airport labels ───────────────────────────────────────────────────
  map.addSource('airports', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'airport-labels', type: 'symbol', source: 'airports',
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Roboto Regular', 'Noto Sans Regular'],
      'text-size': 9, 'text-anchor': 'top', 'text-offset': [0, 0.4],
      'text-allow-overlap': false,
    },
    paint: { 'text-color': '#3a5a3a', 'text-halo-color': '#000', 'text-halo-width': 1 },
  });

  // ── Bullseye symbols ─────────────────────────────────────────────────
  map.addSource('bullseye', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'bullseye-icons', type: 'symbol', source: 'bullseye',
    layout: {
      'icon-image': ['match', ['get', 'coalition'], 'blue', 'be-blue', 'red', 'be-red', 'be-blue'],
      'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': 1,
    },
    paint: { 'icon-opacity': 0.8 },
  });

  // ── Trail dots ───────────────────────────────────────────────────────
  map.addSource('trails', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'trail-dots', type: 'circle', source: 'trails',
    paint: { 'circle-radius': 1.5, 'circle-color': ['get', 'color'], 'circle-opacity': ['get', 'opacity'], 'circle-stroke-width': 0 },
  });

  // ── PPL (projected position line) ─────────────────────────────────────
  map.addSource('ppl', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'ppl-lines', type: 'line', source: 'ppl',
    paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.45, 'line-width': 1 },
  });

  // ── Datalink radar lock lines ────────────────────────────────────────────
  // Dashed line from each friendly player unit to its active radar lock target.
  map.addSource('datalink-locks', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'datalink-lock-lines', type: 'line', source: 'datalink-locks',
    paint: {
      'line-color':     ['get', 'color'],
      'line-opacity':   0.8,
      'line-width':     1.5,
      'line-dasharray': [4, 3],
    },
  });

  // ── Approach vector ───────────────────────────────────────────────────
  map.addSource('approach-vec', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'approach-vec-line', type: 'line', source: 'approach-vec',
    paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.8, 'line-width': 1.5, 'line-dasharray': [8, 4] },
  });

  // ── Extended centerline (AP-radar control, APRT-panel-driven) ────────
  map.addSource('ext-centerline', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'ext-centerline-line', type: 'line', source: 'ext-centerline',
    filter: ['==', ['get', 'kind'], 'centerline'],
    paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.8, 'line-width': 1.5, 'line-dasharray': [8, 4] },
  });
  // Distance ticks — solid (not dashed) so they read as clear crossbars
  // rather than blending into the dashed centerline's own dash pattern.
  map.addLayer({
    id: 'ext-centerline-ticks', type: 'line', source: 'ext-centerline',
    filter: ['==', ['get', 'kind'], 'tick'],
    paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.8, 'line-width': 1.5 },
  });

  // ── The carrier's final-bearing line (crc-sync docs/adr/0074; carrier-panel.js) ──
  map.addSource('carrier-final', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'carrier-final-line', type: 'line', source: 'carrier-final',
    filter: ['==', ['get', 'kind'], 'carrier-final'],
    paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.8, 'line-width': 1.5, 'line-dasharray': [8, 4] },
  });
  map.addLayer({
    id: 'carrier-final-ticks', type: 'line', source: 'carrier-final',
    filter: ['==', ['get', 'kind'], 'carrier-final-tick'],
    paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.8, 'line-width': 1.5 },
  });

  // ── Measure line ─────────────────────────────────────────────────────
  map.addSource('measure', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'measure-line', type: 'line', source: 'measure',
    filter: ['==', ['get', 'kind'], 'line'],
    paint: { 'line-color': '#ffffff', 'line-opacity': 0.7, 'line-width': 1, 'line-dasharray': [6, 4] },
  });
  map.addLayer({
    id: 'measure-label', type: 'symbol', source: 'measure',
    filter: ['==', ['get', 'kind'], 'label'],
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Roboto Regular', 'Noto Sans Regular'],
      'text-size': 11, 'text-anchor': 'center',
      'text-allow-overlap': true, 'text-ignore-placement': true,
    },
    paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 1.5, 'text-opacity': 0.9 },
  });
}
