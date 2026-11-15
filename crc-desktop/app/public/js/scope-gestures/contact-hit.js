'use strict';
import { map } from '../map-handle.js';

// Which contact is under a point (docs/adr/0164): its target (the ATC disc or `+`), its tactical square or its label.
// The layers a scope gesture starts on, and nothing else: anywhere else the map keeps its own gestures.

export const CONTACT_LAYERS = Object.freeze(['atc-targets', 'atc-symbols', 'unit-squares', 'unit-labels', 'atc-labels']);

/** The id of the contact drawn at this canvas point (x, y in canvas pixels), or null. */
export function contactIdAt(x, y) {
  if (!map) return null;
  const layers = CONTACT_LAYERS.filter(l => map.getLayer(l));
  if (!layers.length) return null;
  const hit = map.queryRenderedFeatures([x, y], { layers }).find(f => f.properties && f.properties.id != null);
  return hit ? String(hit.properties.id) : null;
}

/** A DOM mouse/wheel event's point in canvas pixels. */
export function canvasPoint(ev) {
  const r = map.getCanvas().getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}
