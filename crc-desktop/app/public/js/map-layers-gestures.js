'use strict';
import { map } from './map-handle.js';

// The scope gestures' own drawing (docs/adr/0164): the Ctrl+drag heading line from the contact to the cursor and its
// magnetic heading at the cursor. Grey-white like the measure line (dark cockpit). Run once, from the map's 'load',
// after the track layers so it draws on top.

export const GESTURE_SOURCE = 'scope-gesture';

export function addGestureLayers() {
  map.addSource(GESTURE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'scope-gesture-line', type: 'line', source: GESTURE_SOURCE,
    filter: ['==', ['get', 'kind'], 'line'],
    paint: { 'line-color': '#ffffff', 'line-opacity': 0.8, 'line-width': 1 },
  });
  map.addLayer({
    id: 'scope-gesture-label', type: 'symbol', source: GESTURE_SOURCE,
    filter: ['==', ['get', 'kind'], 'label'],
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Roboto Regular', 'Noto Sans Regular'],
      'text-size': 13, 'text-anchor': 'bottom-left', 'text-offset': [0.8, -0.4],
      'text-allow-overlap': true, 'text-ignore-placement': true,
    },
    paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 1.5 },
  });
}

/** Draws the heading line and readout, or clears it with null. */
export function setGestureDrawing(from, to, label) {
  const src = map && map.getSource(GESTURE_SOURCE);
  if (!src) return;
  if (!from) { src.setData({ type: 'FeatureCollection', features: [] }); return; }
  src.setData({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[from.lon, from.lat], [to.lon, to.lat]] }, properties: { kind: 'line' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [to.lon, to.lat] }, properties: { kind: 'label', label } },
    ],
  });
}
