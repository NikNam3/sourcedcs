'use strict';
import { updateMap } from '../geojson.js';
import { map } from '../map-handle.js';
import { tracks } from '../picture.js';
import { settings } from '../settings.js';
import { clearAltPreview, setAltPreview } from './alt-preview.js';
import { canvasPoint, contactIdAt } from './contact-hit.js';
import { assignTargetFor, sendAssignment } from './assign-send.js';
import { ALT_FINE_STEP_FT, ALT_STEP_FT, altitudeStart, formatAssignedAltitude, shiftAltitude, wheelNotches } from './gesture-values.js';

// Alt + wheel over a contact moves its assigned altitude (docs/adr/0164). Each notch moves a PREVIEW, 1,000 ft (100 ft
// with Shift), from the assigned altitude (a block moves whole, keeping its height) or, with none, from the contact's
// current altitude rounded to the step. The data block shows the preview with a `?` (alt-preview.js). Releasing Alt sends
// it ONCE to the Strip's altitude cell; Esc, the window losing focus, or a pointer move seen without Alt (the release
// was missed, e.g. off the window) throws it away. Moving off the contact keeps it: Alt's release still sends it. A
// wheel over another such contact throws the first preview away and starts on that one.
// Only over a contact whose Strip this controller may assign (assign-send.js); elsewhere the wheel zooms as today.

let _w = null;            // { trackId, start, alt, acc }
let _usedThisAlt = false; // this Alt hold moved a preview: its release must not open Electron's menu bar

/** For a test: the preview running now, or null. */
export function altWheelState() {
  return _w ? { trackId: _w.trackId, text: formatAssignedAltitude(_w.alt, settings.transitionAltFt) } : null;
}

export function wireAltWheel() {
  // Capture on the outer container: it runs before MapLibre's scroll zoom on the canvas container.
  map.getContainer().addEventListener('wheel', _onWheel, { capture: true, passive: false });
  window.addEventListener('keyup', _onKeyUp, true);
  window.addEventListener('keydown', _onKeyDown, true);
  window.addEventListener('blur', _cancel);
  map.getCanvas().addEventListener('mousemove', (ev) => { if (_w && !ev.altKey) _cancel(); });
}

function _currentFt(t) {
  return t && t.altitude && Number.isFinite(t.altitude.ft) ? t.altitude.ft : null;
}

function _onWheel(ev) {
  // Left Alt: AltGr reports Ctrl+Alt on Windows.
  if (!ev.altKey || ev.ctrlKey || ev.metaKey) return;
  const p = canvasPoint(ev);
  const id = contactIdAt(p.x, p.y);
  if (!id) return;
  const target = assignTargetFor(id, 'altitude');
  if (!target) return;
  ev.preventDefault();
  ev.stopPropagation();
  _usedThisAlt = true;
  const step = ev.shiftKey ? ALT_FINE_STEP_FT : ALT_STEP_FT;
  if (!_w || _w.trackId !== id) {
    if (_w) _cancel();
    const start = altitudeStart(target.active, _currentFt(tracks.get(id)), step);
    if (!start) return;
    _w = { trackId: id, start, alt: start, acc: 0 };
  }
  const { notches, acc } = wheelNotches(_w.acc, ev.deltaY, ev.deltaX, ev.deltaMode);
  _w.acc = acc;
  if (!notches) return;
  _w.alt = shiftAltitude(_w.alt, notches, step);
  setAltPreview(_w.trackId, _w.alt);
  updateMap();
}

function _onKeyUp(ev) {
  if (ev.key !== 'Alt') return;
  if (_usedThisAlt) ev.preventDefault(); // Electron shows the hidden menu bar on an Alt release it is handed
  _usedThisAlt = false;
  _commit();
}

function _onKeyDown(ev) {
  if (ev.key !== 'Escape' || !_w) return;
  ev.preventDefault();
  ev.stopPropagation();
  _cancel();
}

function _commit() {
  if (!_w) return;
  const { trackId, start, alt } = _w;
  _clear();
  if (alt.lowFt === start.lowFt && alt.highFt === start.highFt) return;
  // Resolved again at release: the Strip's rev (and its owner) may have moved while the wheel turned.
  const target = assignTargetFor(trackId, 'altitude');
  if (!target) return;
  sendAssignment(target, formatAssignedAltitude(alt, settings.transitionAltFt));
}

function _cancel() {
  if (_w) _clear();
}

function _clear() {
  _w = null;
  clearAltPreview();
  updateMap();
}
