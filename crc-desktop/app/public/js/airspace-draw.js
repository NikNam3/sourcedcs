'use strict';

// Drawing and editing an airspace's shape on the scope map (AIRSP-2P-B; mockup scenes 4-6). One session at a time:
//   polygon  click to add points, click the first point (or Finish) to close it, then drag points, drag a midpoint to insert
//            one, select a point and press Delete to remove it. Done is disabled with the reason while the shape crosses
//            itself or has too few or too many points: the same rule as Save (airspace-validate.js).
//   route    click to add a fix (a click near a loaded-mission navpoint snaps to it and takes its name); the corridor shows
//            as it grows. Each change goes to the route table straight away.
// The session holds a COPY of the points; nothing reaches the airspace until Done hands them back to the editor, and the
// editor's own Save sends them (AIRSP-3: the form is the draft).

import { map, mapReady, missionData, settings } from './app.js';
import { buildDraftFeatures, corridorRing, setDraftFeatures } from './airspace-layer.js';
import { formatPair, coordFormatOf } from './coords.js';
import {
  MIN_POLYGON_VERTICES, bearingTo, crossingEdges, deletePoint, canDeletePoint, distanceNm, insertPoint, movePoint, polygonProblem,
} from './panels/efsp/airspace-geometry-model.js';
import { MAX_POLYGON_VERTICES } from './panels/efsp/airspace-validate.js';

const CLOSE_PX = 12;
const SNAP_PX = 12;
const HIT_PX = 10;
let _session = null;

/** The point (vertex) or midpoint under a screen position, found from the session's own points, not from what was last rendered. */
function hitAt(point, withMids) {
  const s = _session; if (!s) return null;
  let best = null; let bestD = HIT_PX;
  s.points.forEach((p, i) => { const q = map.project([p[1], p[0]]); const d = Math.hypot(q.x - point.x, q.y - point.y); if (d <= bestD) { bestD = d; best = { role: 'vertex', index: i }; } });
  if (!best && withMids && s.closed) {
    s.points.forEach((p, i) => {
      const n = s.points[(i + 1) % s.points.length];
      const q = map.project([(p[1] + n[1]) / 2, (p[0] + n[0]) / 2]); const d = Math.hypot(q.x - point.x, q.y - point.y);
      if (d <= bestD) { bestD = d; best = { role: 'mid', index: i, lat: (p[0] + n[0]) / 2, lon: (p[1] + n[1]) / 2 }; }
    });
  }
  return best;
}

export function isDrawing() { return !!_session; }

const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/** The navpoint within SNAP_PX of a screen point, or null. Navpoints are the loaded mission's `waypoints`. */
export function snapToNavpoint(point) {
  let best = null; let bestD = SNAP_PX;
  for (const w of (missionData && missionData.waypoints) || []) {
    if (!Number.isFinite(w.lat) || !Number.isFinite(w.lon)) continue;
    const p = map.project([w.lon, w.lat]); const d = Math.hypot(p.x - point.x, p.y - point.y);
    if (d <= bestD) { bestD = d; best = w; }
  }
  return best;
}

/**
 * Start a session. Ends any other. `o`:
 *   mode 'polygon' | 'route', title, points (the existing shape or fixes; polygon: [] to draw from scratch)
 *   routeWidths (route): per-fix leg width NM or null, defaultWidthNm
 *   onChange(points, extra) after every edit (route: extra.names has navpoint names for new fixes)
 *   onDone(points), onCancel()
 */
export function startDraw(o) {
  stopDraw();
  if (!mapReady) return false;
  const route = o.mode === 'route' || o.mode === 'pick';
  const s = _session = {
    o, route, points: (o.points || []).map(p => [p[0], p[1]]), closed: !route && (o.points || []).length >= MIN_POLYGON_VERTICES,
    selected: null, drag: null, cursor: null, names: (o.points || []).map(() => null),
  };
  s.bar = _el('div', 'asd-bar'); s.title = _el('div', 'asd-title'); s.help = _el('div', 'asd-help'); s.problem = _el('div', 'asd-problem');
  s.buttons = _el('div', 'asd-buttons'); s.readout = _el('div', 'asd-readout');
  s.btnDelete = _el('button', 'asd-btn', 'Delete point'); s.btnDone = _el('button', 'asd-btn asd-primary', route ? 'Done' : 'Done'); s.btnCancel = _el('button', 'asd-btn', 'Cancel');
  s.btnFinish = _el('button', 'asd-btn', 'Finish');
  s.btnUndo = _el('button', 'asd-btn', route ? 'Remove last fix' : 'Remove last point');
  for (const b of [s.btnDelete, s.btnFinish, s.btnUndo, s.btnDone, s.btnCancel]) b.type = 'button';
  s.buttons.append(s.btnUndo, s.btnDelete, s.btnFinish, s.btnDone, s.btnCancel);
  s.bar.append(s.title, s.help, s.problem, s.buttons, s.readout);
  map.getContainer().appendChild(s.bar);

  s.btnCancel.addEventListener('click', cancelDraw);
  s.btnDone.addEventListener('click', finishDraw);
  s.btnFinish.addEventListener('click', () => closeShape());
  s.btnUndo.addEventListener('click', () => { if (s.points.length) { s.points.pop(); s.names.pop(); changed(); } });
  s.btnDelete.addEventListener('click', deleteSelected);

  s.handlers = {
    click: (e) => onClick(e), mousedown: (e) => onDown(e), mousemove: (e) => onMove(e), mouseup: () => onUp(),
  };
  map.on('click', s.handlers.click); map.on('mousedown', s.handlers.mousedown); map.on('mousemove', s.handlers.mousemove); map.on('mouseup', s.handlers.mouseup);
  s.keys = (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'Escape') cancelDraw();
    else if (e.key === 'Delete' || (e.key === 'Backspace' && s.selected != null)) deleteSelected();
    else if (e.key === 'Backspace' && !s.closed && s.points.length) { s.points.pop(); s.names.pop(); changed(); }
    else if (e.key === 'Enter' && !s.btnDone.disabled) finishDraw();
  };
  document.addEventListener('keydown', s.keys);
  s.prevCursor = map.getCanvas().style.cursor; map.getCanvas().style.cursor = 'crosshair';
  s.doubleZoom = map.doubleClickZoom.isEnabled(); map.doubleClickZoom.disable();
  render();
  return true;
}

export function stopDraw() {
  const s = _session; if (!s) return;
  _session = null;
  map.off('click', s.handlers.click); map.off('mousedown', s.handlers.mousedown); map.off('mousemove', s.handlers.mousemove); map.off('mouseup', s.handlers.mouseup);
  document.removeEventListener('keydown', s.keys);
  s.bar.remove();
  map.getCanvas().style.cursor = s.prevCursor || '';
  if (s.doubleZoom) map.doubleClickZoom.enable();
  map.dragPan.enable();
  setDraftFeatures(null);
}

function cancelDraw() { const s = _session; if (!s) return; const cb = s.o.onCancel; stopDraw(); if (cb) cb(); }
function finishDraw() { const s = _session; if (!s || s.btnDone.disabled) return; const pts = s.points; const cb = s.o.onDone; stopDraw(); if (cb) cb(pts); }

function problem() {
  const s = _session;
  if (s.o.mode === 'pick') return null;
  if (s.route) return s.points.length < 2 ? `A route needs at least 2 fixes (${s.points.length} so far).` : null;
  if (!s.closed) return s.points.length < MIN_POLYGON_VERTICES ? `Needs at least ${MIN_POLYGON_VERTICES} points (${s.points.length} so far).` : null;
  return polygonProblem(s.points);
}

function changed() {
  const s = _session; if (!s) return;
  if (s.selected != null && s.selected >= s.points.length) s.selected = null;
  if (s.closed && s.points.length < MIN_POLYGON_VERTICES) s.closed = false;
  if (s.o.onChange) s.o.onChange(s.points.map(p => [p[0], p[1]]), { names: [...s.names] });
  render();
}

function closeShape() {
  const s = _session; if (!s || s.route || s.closed || s.points.length < MIN_POLYGON_VERTICES) return;
  s.closed = true; s.selected = null; changed();
}
function deleteSelected() {
  const s = _session; if (!s || s.selected == null || s.route) return;
  if (!canDeletePoint(s.points)) return;
  s.points = deletePoint(s.points, s.selected); s.selected = null; changed();
}

function render() {
  const s = _session; if (!s) return;
  const pr = problem();
  if (s.o.mode === 'pick') {
    s.title.textContent = s.o.title || 'PLACE A POINT';
    s.help.textContent = 'Click the map to place it. A click near a navpoint snaps to it. Esc cancels.';
    s.btnDone.hidden = true; s.btnDelete.hidden = true; s.btnFinish.hidden = true; s.btnUndo.hidden = true;
    return;
  }
  s.title.textContent = `${s.closed ? 'EDITING' : (s.route ? 'ADDING FIXES' : 'DRAWING')} ${s.route ? 'ROUTE' : 'OUTLINE'}${s.o.title ? ` · ${s.o.title}` : ''} · ${s.points.length} ${s.route ? 'fixes' : 'points'}`;
  s.help.textContent = s.route
    ? 'Click the map to add a fix. A click near a navpoint snaps to it.'
    : (s.closed ? `Drag a point to move it. Drag a small midpoint to insert a point. Select a point and press Delete to remove it (not below ${MIN_POLYGON_VERTICES}).`
      : 'Click to add points. Click the first point, or Finish, to close the shape.');
  s.problem.textContent = pr || '';
  s.problem.hidden = !pr;
  s.bar.classList.toggle('asd-bad', !!(pr && s.closed && s.points.length >= MIN_POLYGON_VERTICES));
  s.btnDone.disabled = !!pr || (!s.route && !s.closed);
  s.btnDone.title = s.btnDone.disabled ? (pr || 'Close the shape first.') : '';
  s.btnFinish.hidden = s.route || s.closed; s.btnFinish.disabled = s.points.length < MIN_POLYGON_VERTICES;
  s.btnDelete.hidden = s.route || !s.closed; s.btnDelete.disabled = s.selected == null || !canDeletePoint(s.points);
  s.btnUndo.hidden = s.closed; s.btnUndo.disabled = !s.points.length;
  let corridor = null;
  if (s.route && s.points.length >= 2) {
    const rows = s.points.map((p, i) => ({ lat: p[0], lon: p[1], widthNm: (s.o.routeWidths || [])[i] ?? null }));
    corridor = corridorRing(rows, s.o.defaultWidthNm || 4);
  }
  setDraftFeatures(buildDraftFeatures({
    points: s.points, closed: s.closed, selected: s.selected, route: s.route, corridor,
    crossing: s.closed ? crossingEdges(s.points) : [], rubber: !s.closed && s.cursor && s.points.length ? s.cursor : null,
  }));
}

function onClick(e) {
  const s = _session; if (!s || s.drag) return;
  if (s.o.mode === 'pick') { // one click places one position, then the session ends
    const nav = snapToNavpoint(e.point);
    const fix = { lat: nav ? nav.lat : e.lngLat.lat, lon: nav ? nav.lon : e.lngLat.lng, name: nav ? (nav.name || null) : null };
    const cb = s.o.onPick; stopDraw(); if (cb) cb(fix); return;
  }
  const hit = hitAt(e.point, false);
  if (s.closed) { // editing: a click selects a point, or clears the selection
    s.selected = hit ? hit.index : null; render(); return;
  }
  if (!s.route && hit && hit.index === 0 && s.points.length >= MIN_POLYGON_VERTICES) { closeShape(); return; }
  if (!s.route && s.points.length >= MAX_POLYGON_VERTICES) return;
  let p = [e.lngLat.lat, e.lngLat.lng]; let name = null;
  if (s.route) { const nav = snapToNavpoint(e.point); if (nav) { p = [nav.lat, nav.lon]; name = nav.name || null; } }
  s.points.push(p); s.names.push(name); changed();
}

function onDown(e) {
  const s = _session; if (!s || !s.closed || s.route || e.originalEvent.button !== 0) return;
  const hit = hitAt(e.point, true);
  if (!hit) return;
  e.preventDefault();
  let index = hit.index;
  if (hit.role === 'mid') { s.points = insertPoint(s.points, index, [hit.lat, hit.lon]); index += 1; }
  s.drag = { index, moved: hit.role === 'mid' }; s.selected = index;
  map.dragPan.disable(); render();
}
function onMove(e) {
  const s = _session; if (!s) return;
  s.cursor = [e.lngLat.lat, e.lngLat.lng];
  const fmt = coordFormatOf(settings.coordFormat);
  let text = formatPair(s.cursor[0], s.cursor[1], fmt);
  if (s.drag) {
    s.points = movePoint(s.points, s.drag.index, s.cursor); s.drag.moved = true;
    if (s.o.onChange) s.o.onChange(s.points.map(p => [p[0], p[1]]), { names: [...s.names] });
    render();
  } else if (!s.closed && s.points.length) {
    const last = s.points[s.points.length - 1];
    text += `   ${Math.round(bearingTo(last, s.cursor)).toString().padStart(3, '0')}°  ${distanceNm(last, s.cursor).toFixed(1)} NM`;
    render();
  }
  s.readout.textContent = text;
}
function onUp() {
  const s = _session; if (!s || !s.drag) return;
  const moved = s.drag.moved; s.drag = null; map.dragPan.enable();
  if (moved) changed();
}
