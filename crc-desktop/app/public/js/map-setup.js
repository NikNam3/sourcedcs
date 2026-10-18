'use strict';
import { buildAirports, buildBullseye, buildDrawings, buildNavpoints, buildTextMarks } from './geojson.js';
import { initIcons } from './icons.js';
import { addOverlayLayers } from './map-layers-overlays.js';
import { addTrackLayers } from './map-layers-tracks.js';
import { wireMapInteractions } from './map-interactions.js';
import { initElevationContours } from './elevation.js';
import { applyMapTheme } from './map-style.js';
import { mountAirspaceMenuButton, refreshAirspaceLayers } from './airspace-layer.js';
import { onMaptilerKey, transformMaptilerRequest } from './maptiler-key.js';
import { _setMap, _setMapReady, map, mapReady } from './map-handle.js';
import { applyScale } from './geojson.js';
import { missionData } from './picture.js';

// ── Map initialisation ────────────────────────────────────────────────────
// Sets up all MapLibre sources, layers, and event handlers.

// The key arrives after the map exists (it is fetched at login). The basemap's tile source reloads then.
// maplibre 3.6.2's VectorTileSource has setTiles(), so the source is not re-added and the style is never
// replaced (setStyle would destroy the GeoJSON layers below).
//
// Live test T3: that was not enough. A tile whose glyph range or tile request failed without the key is
// left 'errored', and maplibre 3.6.2 never asks for an errored tile again: SourceCache.reload() (what
// setTiles and every GeoJSON setData run) skips it, and _addTile() hands it back as it is. The glyphs are
// asked for by every symbol layer, the GeoJSON ones too (airport, navpoint, drawing and track labels,
// airspace names), and one failed range fails the whole tile. A failed range is not cached (GlyphManager
// deletes the request), so dropping the errored tiles of every source makes the next frame request them
// again, now with the key.
export function refreshMaptilerSources() {
  if (!map) return;
  let sources;
  try { sources = map.getStyle().sources; } catch (_) { return; } // style not loaded yet: its first tile requests already carry the key
  for (const [id, src] of Object.entries(sources)) {
    if (src.type !== 'vector' || !Array.isArray(src.tiles) || !src.tiles.some((u) => u.startsWith('https://api.maptiler.com/'))) continue;
    map.getSource(id).setTiles(src.tiles);
  }
  if (retryErroredTiles(map.style && map.style.sourceCaches, map.transform, map.terrain) > 0) map.triggerRepaint();
}

/**
 * Drops the tiles of each source that has an errored one and asks for the ones in view again (T3). Only those
 * sources: a healthy one keeps its tiles and does not flicker. Returns how many sources it cleared.
 * (`update` is what the map's own render loop calls when its sources are dirty; clearing alone does not make them so.)
 * @param {Object<string, {getIds:()=>string[], getTileByID:(id:string)=>{state:string}, clearTiles:()=>void, update:Function}>} sourceCaches
 */
export function retryErroredTiles(sourceCaches, transform, terrain) {
  let cleared = 0;
  for (const cache of Object.values(sourceCaches || {})) {
    if (!cache || typeof cache.getIds !== 'function') continue;
    if (!cache.getIds().some((tileId) => { const t = cache.getTileByID(tileId); return t && t.state === 'errored'; })) continue;
    cache.clearTiles();
    if (transform) cache.update(transform, terrain);
    cleared += 1;
  }
  return cleared;
}

// No key, or MapTiler refuses it: the basemap tiles answer 403. The map stays usable on the style's Background layer
// (the scope, strips and every panel do not depend on tiles); the controller gets one notice and the log one warning.
let basemapNotice = null;
function showBasemapNotice(container) {
  if (basemapNotice) return;
  console.warn('[map] map key unavailable: no basemap or terrain contours until crc-sync supplies a valid MapTiler key');
  basemapNotice = document.createElement('div');
  basemapNotice.id = 'basemap-notice';
  basemapNotice.textContent = 'NO BASEMAP: map key unavailable';
  basemapNotice.style.cssText = 'position:absolute;left:8px;bottom:8px;z-index:5;padding:3px 8px;font:11px monospace;letter-spacing:.06em;'
    + 'color:#c9a24a;background:rgba(0,0,0,.65);border:1px solid #6b5a2a;pointer-events:none';
  container.appendChild(basemapNotice);
}
function clearBasemapNotice() {
  if (basemapNotice) basemapNotice.remove();
  basemapNotice = null;
}

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

  onMaptilerKey(() => { clearBasemapNotice(); refreshMaptilerSources(); });
  map.on('error', (e) => {
    const err = e && e.error;
    if (err && err.status === 403 && /^https:\/\/api\.maptiler\.com\//.test(err.url || '')) showBasemapNotice(container);
  });
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
