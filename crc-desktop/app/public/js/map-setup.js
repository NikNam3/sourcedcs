'use strict';
import { buildAirports, buildBullseye, buildDrawings, buildNavpoints, buildTextMarks } from './geojson.js';
import { initIcons } from './icons.js';
import { addOverlayLayers } from './map-layers-overlays.js';
import { addTrackLayers } from './map-layers-tracks.js';
import { wireMapInteractions } from './map-interactions.js';
import { initElevationContours } from './elevation.js';
import { applyMapTheme } from './map-style.js';
import { mountAirspaceMenuButton, refreshAirspaceLayers } from './airspace-layer.js';
import { maptilerKey, onMaptilerKey, transformMaptilerRequest } from './maptiler-key.js';
import { createBasemapFallback } from './basemap-fallback.js';
import { _setMap, _setMapReady, map, mapReady } from './map-handle.js';
import { applyScale } from './geojson.js';
import { missionData } from './picture.js';

// ── Map initialisation ────────────────────────────────────────────────────
// Sets up all MapLibre sources, layers, and event handlers.

// The key arrives after the map exists (it is fetched at login). The basemap source is then pointed at MapTiler again
// (basemap-fallback.js), in place: the style is never replaced (setStyle would destroy the GeoJSON layers below), and the
// reload drops the tiles that errored without the key. Glyphs are local (app/glyph-route.js), so no GeoJSON tile ever
// errors for want of the key (live test T3's retry of every source's errored tiles is gone with that).

// The basemap note (U-GLYPHS 1b). No key, a refused or exhausted one, or MapTiler down: the basemap source switches to
// the keyless fallback (basemap-fallback.js) and a quiet grey note says so; with the fallback down too the map stays usable
// on the style's Background layer (the scope, strips and every panel do not depend on tiles). Dark cockpit: grey, no colour.
let basemapNotice = null;
const NOTICE_TEXT = { fallback: 'FALLBACK BASEMAP', none: 'NO BASEMAP' };
function showBasemapNotice(container, state) {
  const text = NOTICE_TEXT[state];
  if (!text) { clearBasemapNotice(); return; }
  if (!basemapNotice) {
    basemapNotice = document.createElement('div');
    basemapNotice.id = 'basemap-notice';
    basemapNotice.style.cssText = 'position:absolute;left:8px;bottom:8px;z-index:5;padding:2px 6px;font:10px monospace;letter-spacing:.06em;'
      + 'color:#8a8a8a;background:rgba(0,0,0,.55);border:1px solid #333;pointer-events:none';
    container.appendChild(basemapNotice);
  }
  basemapNotice.textContent = text;
}
function clearBasemapNotice() {
  if (basemapNotice) basemapNotice.remove();
  basemapNotice = null;
}

let basemap = null;
/** 'maptiler', 'fallback' or 'none' (for the specs and the log). */
export function basemapState() { return basemap ? basemap.state : 'maptiler'; }

export function initMap(container) {
  _setMap(new maplibregl.Map({
    container,
    style: '/crc-desktop-scope-style.json',
    // The style carries no key: MapTiler requests get it here once crc-sync has handed it over (maptiler-key.js).
    // Glyphs come from the local server (app/server.js /fonts/), never MapTiler: a failed glyph range hides every track.
    transformRequest: (url) => (url.startsWith('/fonts/') ? { url: location.origin + url } : transformMaptilerRequest(url)),
    center: [35.4258, 37.0021],
    zoom: 7,
  }));

  basemap = createBasemapFallback({
    getMap: () => map,
    getKey: maptilerKey,
    onChange: (state) => {
      if (state === 'fallback') console.warn('[map] MapTiler unavailable: fallback basemap until crc-sync supplies a working key');
      if (state === 'none') console.warn('[map] fallback basemap unavailable too: no basemap');
      showBasemapNotice(container, state);
    },
  });
  onMaptilerKey(() => { basemap.onKey(); });
  map.on('error', (e) => { basemap.onMapError(e); });
  // maplibre fires 'load' from a render frame, and a map whose only tiles errored draws nothing more, so the frame
  // that would announce it never comes: nudge it until the map is ready (mapReady gates every overlay).
  const nudge = setInterval(() => { if (mapReady) clearInterval(nudge); else map.triggerRepaint(); }, 400);

  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();

  map.on('load', () => {
    initIcons();

    addOverlayLayers();
    addTrackLayers();
    wireMapInteractions();

    _setMapReady(true);
    applyScale();
    applyMapTheme();
    initElevationContours();
    if (missionData) {
      map.getSource('airports').setData(buildAirports());
      map.getSource('bullseye').setData(buildBullseye());
      map.getSource('navpoints').setData(buildNavpoints());
      map.getSource('drawings').setData(buildDrawings());
      map.getSource('text-marks').setData(buildTextMarks());
    }
    mountAirspaceMenuButton();
    refreshAirspaceLayers();
  });
}
