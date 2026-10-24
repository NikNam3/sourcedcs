'use strict';
import { AIRPORT_SURFACE_LAYERS, airportSurfaceHeld, airportSurfacePaint, airportSurfaceVisibility, getAirportSurfacePositions } from './airport-surface.js';
import { ATC_DIM_GRAY, atcBackgroundDirty, atcBlackScope } from './atc-scope.js';
import { buildDrawings, buildTextMarks, updateMap } from './geojson.js';
import { createNavpointIcon, updateIcons, updateIffIcons } from './icons.js';
import { refreshAirspaceLayers } from './airspace-layer.js';
import { map, mapReady } from './map-handle.js';
import { settings } from './settings.js';
import { missionData } from './picture.js';
import { onEfspChanged } from './panels/efsp/efsp-change-bus.js';
import { getSignedOnPositions } from './panels/efsp/efsp-ws.js';

// Colours, theme and the black ATC background (DESK-SPLIT, split out of map-setup.js's initMap: these re-paint an existing map,
// and settings-panel.js and the ATC scope need them without importing the map's construction).

// ── Colour application ────────────────────────────────────────────────────
// Called whenever colour settings change (colour-picker input events).
// Re-registers all colour-sensitive icon images and updates layer paint props.

export function applyColors() {
  if (!mapReady) return;
  const ring = settings.colRangeRing || '#8aaa6a';
  const nav  = settings.colNavpoint  || '#3a5a3a';

  // Range rings and selection ring
  map.setPaintProperty('range-ring-line',  'line-color',          ring);
  map.setPaintProperty('ground-ring-line', 'line-color',          ring);
  map.setPaintProperty('ref-dot-ring',     'circle-stroke-color', ring);

  // Navpoints
  map.updateImage('navpt', createNavpointIcon(nav));
  map.setPaintProperty('navpt-labels',   'text-color', nav);
  map.setPaintProperty('airport-labels', 'text-color', nav);

  // IFF + emergency icon images
  updateIffIcons();

  // Rebuild GeoJSON so label colours and trail colours update immediately
  updateMap();
}

// ── Map theme ─────────────────────────────────────────────────────────────
// Switches base-layer colors between dark (radar scope) and light without
// reloading the style (which would destroy all custom GeoJSON layers).

export function applyMapTheme() {
  if (!mapReady) return;
  const light = settings.lightMode;

  // Background (land)
  map.setPaintProperty('Background', 'background-color', light ? '#f4f3f0' : '#141414');

  // Water — in dark mode use a distinct dark blue-grey so land/water are easy to tell apart
  map.setPaintProperty('Water', 'fill-color', light ? '#c0d8e8' : '#07111a');

  // Rivers
  map.setPaintProperty('River', 'line-color', light ? '#a0c0d8' : '#0f0f0f');

  // Country borders
  map.setPaintProperty('Country border', 'line-color', light ? '#9a9690' : '#2a2a2a');

  // Airport zone fill, and the airport surface (U-SCOPE-SMALL): pavement a shade off the land, taxiways a shade above it,
  // runways brightest; names in the label grey (airport-surface.js airportSurfacePaint).
  map.setPaintProperty('Airport zone', 'fill-color', light ? '#e8e6e2' : '#111111');
  paintAirportSurface(airportSurfacePaint({ light }));
  // Runways (the video map's runways: always drawn, surface switch or not)
  map.setPaintProperty('Aeroway', 'line-color', light ? '#8a9a8a' : '#4a5a4a');

  // Elevation contour lines + height labels
  const contourColor = light ? '#8a6a3a' : '#a08050';
  map.setPaintProperty('elevation-contours-lines',  'line-color', contourColor);
  map.setPaintProperty('elevation-contours-labels', 'text-color', contourColor);
  map.setPaintProperty('elevation-contours-labels', 'text-halo-color', light ? '#ffffff' : '#000000');

  // Text labels — halo flips so text stays readable
  const labelPaint = light
    ? { color: '#3a3a3a', halo: '#ffffff' }
    : { color: '#5a6a5a', halo: '#000000' };

  const placePaint = light
    ? { color: '#2a2a2a', halo: '#ffffff' }
    : { color: '#404040', halo: '#000000' };

  map.setPaintProperty('Country labels',  'text-color',      placePaint.color);
  map.setPaintProperty('Country labels',  'text-halo-color', placePaint.halo);

  // Airport labels — halo only needed in dark mode for contrast
  map.setPaintProperty('airport-labels', 'text-halo-width', light ? 0 : 1);
  map.setPaintProperty('airport-labels', 'text-halo-color', light ? '#ffffff' : '#000000');

  // Measure line + label
  const measureColor = light ? '#333333' : '#ffffff';
  map.setPaintProperty('measure-line',  'line-color',  measureColor);
  map.setPaintProperty('measure-label', 'text-color',  measureColor);
  map.setPaintProperty('measure-label', 'text-halo-color', light ? '#ffffff' : '#000000');
  map.setPaintProperty('measure-label', 'text-halo-width', light ? 0 : 1.5);
  // Rebuild drawings so line color (white vs dark) updates
  if (missionData) map.getSource('drawings').setData(buildDrawings());
  map.setPaintProperty('text-marks-labels', 'text-halo-color', light ? '#ffffff' : '#000000');
  if (missionData) map.getSource('text-marks').setData(buildTextMarks());
  map.setPaintProperty('airspace-labels', 'text-halo-color', light ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.6)');
  refreshAirspaceLayers();
  // Re-register coalition icons with theme-correct colors
  updateIcons(light);
  applyAirportSurface();
  // The black ATC scope, if it is on, sits over whatever theme this painted.
  atcBackgroundDirty();
}

// ── The black ATC scope (crc-sync's docs/adr/0088, H41) ───────────────────
// The personal "ATC map background" setting, off, in an ATC-only session:
// STARS's black background with the video map in dim gray (7210.3 §3-9-1a1,
// a3). The land and water fills go black; the coastline survives as the
// water fill's outline and the runways as dim-gray lines; contours, rivers
// and place names are hidden. `black: false` puts the normal theme back.
export function applyAtcBackground(black) {
  if (!mapReady) return;
  if (!black) {
    for (const id of ['River', 'Country labels', 'elevation-contours-lines', 'elevation-contours-labels']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
    }
    map.setPaintProperty('Water', 'fill-outline-color', undefined);
    applyMapTheme();
    applyAirportSurface(false);
    return;
  }
  const gray = ATC_DIM_GRAY;
  map.setPaintProperty('Background', 'background-color', '#000000');
  map.setPaintProperty('Water', 'fill-color', '#000000');
  map.setPaintProperty('Water', 'fill-outline-color', gray);
  map.setPaintProperty('Airport zone', 'fill-color', '#000000');
  map.setPaintProperty('Country border', 'line-color', '#3a3a3a');
  map.setPaintProperty('Aeroway', 'line-color', gray);
  for (const id of ['River', 'Country labels', 'elevation-contours-lines', 'elevation-contours-labels']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
  }
  applyAirportSurface(true);
  updateMap();
}

function paintAirportSurface(list) {
  for (const [id, prop, value] of list) if (map.getLayer(id)) map.setPaintProperty(id, prop, value);
}

/**
 * Shows or hides the airport surface layers (airport-surface.js): the controller's "Airport surface" switch is on and they
 * hold a Position their Facility lists in the snapshot's `airportSurfacePositions` (H162). `black`: the black ATC scope is
 * on, which greys the surface (the theme's paint comes back with applyMapTheme); by default, whether it is on now.
 */
export function applyAirportSurface(black = atcBlackScope()) {
  if (!mapReady) return;
  const held = airportSurfaceHeld(getAirportSurfacePositions(), getSignedOnPositions);
  const v = airportSurfaceVisibility({ enabled: settings.airportSurface, held });
  for (const id of AIRPORT_SURFACE_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
  if (black) paintAirportSurface(airportSurfacePaint({ black: true, gray: ATC_DIM_GRAY }));
}

// A sign-on or sign-off (Primary or Observer, efsp-ws.js) and a snapshot (the table) decide who sees the surface.
onEfspChanged(['positions', 'snapshot'], () => applyAirportSurface());
// atc-scope.js's beat marks 'atcBackground' when the black-scope decision changed (efsp-change-bus.js), so it need not import this file.
onEfspChanged(['atcBackground'], () => applyAtcBackground(atcBlackScope()));
