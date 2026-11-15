'use strict';
import { bearingDeg } from '../geo.js';
import { toMagneticDisplay } from '../magnetic.js';
import { map } from '../map-handle.js';
import { tracks } from '../picture.js';
import { LABEL_DRAG_THRESHOLD_PX } from '../label-drag-gate.js';
import { setGestureDrawing } from '../map-layers-gestures.js';
import { canvasPoint } from './contact-hit.js';
import { assignTargetFor, sendAssignment } from './assign-send.js';
import { headingText, roundHeading } from './gesture-values.js';

// Ctrl + drag from a contact assigns a heading (docs/adr/0164). Press with Ctrl on the contact's target, tactical square
// or label, drag: a line from the contact to the cursor, its magnetic heading at the cursor (the nearest 5°, 360 for
// north). Release sends it to the Strip's heading cell, overwriting what was assigned. Esc cancels; a release closer
// than the label drag threshold to the press sends nothing (and MapLibre then fires today's click).
// Only on a contact whose Strip this controller may assign (assign-send.js); anywhere else Ctrl+drag is the map's.

let _drag = null;     // { trackId, startX, startY, heading }
let _lastDown = null; // the DOM press last taken: one press reaches the disc, its character and the label

/** For a test: the drag running now, or null. */
export function hdgDragState() {
  return _drag ? { trackId: _drag.trackId, heading: _drag.heading } : null;
}

/**
 * A MapLibre layer mousedown. True when it starts (or already is) a heading drag: the caller then does nothing else
 * with the press (no label drag). preventDefault keeps MapLibre's own drag handlers off this press.
 */
export function startHdgDrag(e) {
  const ev = e.originalEvent;
  if (!ev || ev.button !== 0 || !ev.ctrlKey) return false;
  if (_lastDown === ev) return true;
  const feat = e.features && e.features[0];
  if (!feat) return false;
  const id = String(feat.properties.id);
  if (!tracks.get(id) || !assignTargetFor(id, 'heading')) return false;
  _lastDown = ev;
  e.preventDefault();
  _drag = { trackId: id, startX: e.point.x, startY: e.point.y, heading: null };
  window.addEventListener('mousemove', _onMove, true);
  window.addEventListener('mouseup', _onUp, true);
  window.addEventListener('keydown', _onKey, true);
  window.addEventListener('blur', _cancel);
  return true;
}

function _farEnough(p) {
  return Math.hypot(p.x - _drag.startX, p.y - _drag.startY) >= LABEL_DRAG_THRESHOLD_PX;
}

function _onMove(ev) {
  if (!_drag) return;
  const p = canvasPoint(ev);
  const t = tracks.get(_drag.trackId);
  if (!t || !_farEnough(p)) { _drag.heading = null; setGestureDrawing(null); return; }
  const to = map.unproject([p.x, p.y]);
  _drag.heading = roundHeading(toMagneticDisplay(bearingDeg(t.lat, t.lon, to.lat, to.lng), t.lat, t.lon));
  setGestureDrawing({ lat: t.lat, lon: t.lon }, { lat: to.lat, lon: to.lng }, headingText(_drag.heading));
}

function _onUp(ev) {
  if (!_drag || ev.button !== 0) return;
  _onMove(ev);
  const { trackId, heading } = _drag;
  const far = _farEnough(canvasPoint(ev));
  _end();
  if (!far || heading == null) return;
  // Resolved again at release: the Strip's rev (and its owner) may have moved during the drag.
  const target = assignTargetFor(trackId, 'heading');
  if (!target || (target.active && target.active.parsed === heading)) return;
  sendAssignment(target, headingText(heading));
}

function _onKey(ev) {
  if (ev.key !== 'Escape' || !_drag) return;
  ev.preventDefault();
  ev.stopPropagation();
  _cancel();
}

function _cancel() { if (_drag) _end(); }

function _end() {
  _drag = null;
  setGestureDrawing(null);
  window.removeEventListener('mousemove', _onMove, true);
  window.removeEventListener('mouseup', _onUp, true);
  window.removeEventListener('keydown', _onKey, true);
  window.removeEventListener('blur', _cancel);
}
