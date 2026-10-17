'use strict';
import { getSetting, registerSettingsTab } from '../../settings-registry.js';
import { toggleDockPanel, isDockPanelOpen } from '../../dock-handle.js';
import { getEfspFlightData, getEfspStrip } from './efsp-state.js';
import { getActingPositions, sendEfspMutation, sendEfspRunwayStatusMutation } from './efsp-ws.js';
import { RUNWAY_STATUS_ACTION_OWNERS } from './runway-status-rules.js';
import { onEfspChanged } from './efsp-change-bus.js';
import { parSampleTimes, parSamples, parSampleFor } from './par-samples.js';
import {
  DEFAULT_VIEW, PAR_DEFAULTS, PAR_VALUE_CELLS, autoscaleView, azAxisLabel, clampTo, createTrailFilter, gpHeightFt, headerModel,
  niceStep, noPlotState, pickFlight, rangeAtDaNm, readoutModel, parseParValue, parTerminalOp, parTerminalRecorded, parTerminals, parValueCells,
  severity, zoomView,
} from './par-model.js';

// The PAR panel (decisions H115, H116, H122, H141; mockup docs/mockups/par-panel.html, revision 5; ADR 0123; lane note docs/wip/PAR-2.md). An
// ordinary dockable panel: the approach, the flight, its range to touchdown, and two scopes (elevation and azimuth against range
// from touchdown) drawn from the server's PAR sample (crc-sync docs/adr/0112), plus FINAL's two terminal buttons. It replaced the
// FINAL Bay view's talk-down component (its cadence bar and call prompts are gone: H115, no required calls, no cadence).
//
// Scopes: touchdown fixed in the bottom-left corner (azimuth: the left edge, on the centreline); the wheel zooms the range of both,
// Shift+wheel this scope's vertical; no pan. Autoscale (the PAR Settings tab) keeps the track at the golden-ratio point until the
// window is 10 NM; a manual zoom pauses it and a double-click resumes it. Track style E: a magenta diamond with a dark halo and a
// magenta trail over dimmed reference lines.
//
// The azimuth scope is in degrees only (ADR 0123): the course is the 0° line, the ±tolerance lines are straight, and a plot past
// the window's edge is drawn at the edge. The elevation scope keeps feet (height above TDZE; DA is in feet on the plate).
//
// Dark cockpit: grey unless a problem. Red outside a tolerance above DA only (Settings: elevation +1° above and 0.5° below the
// glidepath, the FAA lower safe limit; azimuth ±1°); nothing is coloured below DA and the dashed tolerance lines start there (H116). Amber only for no plot for 3 s. An INOP scope is blanked in orange-red with
// the reason. Several flights on finals sent to this controller: a row of their names picks the one the scopes show
// (par-model.js `pickFlight`); the Strip's ⋯ menu item "Show in PAR panel" picks it too (the FINAL Bay is ordinary
// Strips, H138 U10).
//
// The approach values (crc-sync docs/adr/0130, decisions H153): TDZE, TCH, DH and GPA on the approach header are the PAR
// controller's to set, in place (click, type, Enter; an empty field or "Default" goes back to the default; Escape abandons). They
// are held on the server per runway end, so every PAR scope and the monitor measure against the same numbers; DA = TDZE + DH. A
// value the controller set is marked grey (a dotted underline and a small mark), never amber: a set value is not a problem.

const NS = 'http://www.w3.org/2000/svg';
const COL = Object.freeze({
  grid: '#181e24', faint: '#56616c', ref: '#5f6b76', refDash: '#46505a', plot: '#e58bff', halo: '#0b0e11',
  danger: '#ff5c5c', attn: '#e0a83c', bad: '#ff8a4c',
});
const PAD = Object.freeze({ L: 44, R: 8, T: 18, B: 16 });
const TICK_MS = 500; // the no-plot age is read off the clock between frames

registerSettingsTab('par', [
  { key: 'parAutoscale', type: 'toggle', label: 'Autoscale', default: PAR_DEFAULTS.autoscale, onChange: () => { _paused = false; renderParPanel(); } },
  // two elevation limits (ADR 0123): a saved single `parTolEl` became the upper one (settings.js loadSettings)
  { key: 'parTolElHigh', type: 'number', label: 'Elevation tolerance above', unit: '°', default: PAR_DEFAULTS.tolElHighDeg, min: 0.1, max: 3, step: 0.1, onChange: () => renderParPanel() },
  { key: 'parTolElLow', type: 'number', label: 'Elevation tolerance below', unit: '°', default: PAR_DEFAULTS.tolElLowDeg, min: 0.1, max: 3, step: 0.1, onChange: () => renderParPanel() },
  { key: 'parTolAz', type: 'number', label: 'Azimuth tolerance ±', unit: '°', default: PAR_DEFAULTS.tolAzDeg, min: 0.1, max: 5, step: 0.1, onChange: () => renderParPanel() },
], { label: 'PAR' });

let _emptyEl = null;
let _bodyEl = null;
let _els = null;
let _timer = null;
let _resize = null;
let _selected = null;          // the Strip the scopes show
let _shown = null;             // the Strip last drawn (a new one resumes autoscale)
let _view = { ...DEFAULT_VIEW };
let _paused = false;           // a manual zoom paused autoscale
const _trails = new Map();     // stripId -> trail filter (a changed landing runway drops the old plots)
const _firstSeen = new Map();  // stripId -> when its sample first came (no plot for 3 s since then is amber)
let _editing = null;           // { approachId, field, input, error } while an approach value is being typed

function _el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function sv(name, attrs, text) {
  const e = document.createElementNS(NS, name);
  for (const k of Object.keys(attrs || {})) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text;
  return e;
}

function _num(key, fallback) {
  const v = getSetting(key);
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** The flight a Strip names: its callsign (the PAR is an airfield feature, H125), its type and beacon. */
export function parFlightOf(stripId) {
  const strip = getEfspStrip(stripId);
  const fd = strip ? getEfspFlightData(strip.flightDataId) : null;
  const identity = (fd && fd.identity) || {};
  return {
    name: identity.callsign || '',
    type: identity.aircraftType || '',
    beacon: identity.beaconAssigned || '',
  };
}

/** Shows a flight in the scopes (the FINAL Strip's ⋯ menu calls this) and opens the panel. */
export function showParFlight(stripId) {
  _selected = stripId || null;
  try { if (!isDockPanelOpen('par')) toggleDockPanel('par', true); } catch (_) { /* no dock (tests) */ }
  renderParPanel();
}

/** The Strip the scopes show, or null. */
export function parShownStripId() { return _shown; }

/** The window the scopes are drawn in, and whether a manual zoom paused autoscale (specs read it). */
export function parPanelView() { return { ..._view, paused: _paused, autoscale: !!getSetting('parAutoscale') }; }

function _build() {
  _bodyEl.textContent = '';
  const picks = _el('div', 'par-picks');
  picks.dataset.par = 'picks';
  const head = _el('div', 'par-row par-head');
  const cell = (row, k, key, cls) => {
    if (k) row.appendChild(_el('span', 'par-k', k));
    const v = _el('span', cls || 'par-v', '');
    v.dataset.par = key;
    row.appendChild(v);
    return v;
  };
  const title = cell(head, '', 'title');
  // the approach values the PAR controller sets (docs/adr/0130), then DA, which follows from TDZE + DH
  const values = {};
  for (const { field, label } of PAR_VALUE_CELLS) {
    const v = cell(head, label, field, 'par-v par-value');
    v.dataset.parValue = field;
    v.addEventListener('click', () => _beginEdit(field));
    values[field] = v;
  }
  const da = cell(head, 'DA', 'da');
  const facK = _el('span', 'par-k', 'FAC');
  head.appendChild(facK);
  const fac = cell(head, '', 'fac');
  const flags = _el('span', 'par-right par-flags');
  flags.dataset.par = 'flags';
  head.appendChild(flags);

  const flight = _el('div', 'par-row par-flight');
  const name = cell(flight, '', 'name', 'par-cs');
  const type = cell(flight, '', 'type');
  const bcnK = _el('span', 'par-k', 'BCN');
  flight.appendChild(bcnK);
  const bcn = cell(flight, '', 'beacon');
  const gs = cell(flight, 'GS', 'gs');
  const vs = cell(flight, 'VS', 'vs');
  const rangeBox = _el('span', 'par-right par-range');
  const range = _el('span', null, '');
  range.dataset.par = 'range';
  rangeBox.append(range, _el('small', null, 'NM to TD'));
  flight.appendChild(rangeBox);

  const scopes = _el('div', 'par-scopes');
  const scope = (kind, cap) => {
    const box = _el('div', 'par-scope');
    box.dataset.parScope = kind;
    box.appendChild(_el('span', 'par-cap', cap));
    const win = _el('span', 'par-win', '');
    box.appendChild(win);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'par-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${cap.toLowerCase()} scope`);
    box.appendChild(svg);
    box.addEventListener('wheel', (e) => {
      e.preventDefault();
      _view = zoomView(_view, kind, e.shiftKey, e.deltaY);
      if (getSetting('parAutoscale')) _paused = true;
      renderParPanel();
    }, { passive: false });
    box.addEventListener('dblclick', (e) => {
      e.preventDefault();
      _paused = false;
      if (!getSetting('parAutoscale')) _view = { ...DEFAULT_VIEW };
      renderParPanel();
    });
    scopes.appendChild(box);
    return { box, win, svg };
  };
  const el = scope('el', 'ELEVATION');
  const az = scope('az', 'AZIMUTH');

  const dev = _el('div', 'par-dev');
  const item = (label, key) => {
    const s = _el('span', 'par-dev-item');
    s.dataset.parDev = key;
    s.appendChild(document.createTextNode(`${label} `));
    const b = _el('b', null, '');
    s.appendChild(b);
    const extra = _el('span', 'par-dev-extra', '');
    s.appendChild(extra);
    dev.appendChild(s);
    return { s, b, extra };
  };
  const elDev = item('EL', 'el');
  const azDev = item('AZ', 'az');
  const alt = item('ALT', 'alt');
  const msg = _el('div', 'par-msg', '');
  msg.dataset.par = 'msg';
  const terms = _el('div', 'par-terms');
  _bodyEl.append(picks, head, flight, scopes, dev, msg, terms);
  _els = { picks, title, values, da, facK, fac, flags, name, type, bcnK, bcn, gs, vs, range, el, az, elDev, azDev, alt, msg, terms, termSig: '' };

  if (typeof ResizeObserver === 'function') {
    if (_resize) _resize.disconnect();
    _resize = new ResizeObserver(() => renderParPanel());
    _resize.observe(el.box);
    _resize.observe(az.box);
  }
}

function _drawScope(scope, kind, c) {
  const svg = scope.svg;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const w = Math.max(120, Math.round(scope.box.clientWidth || 600));
  const h = Math.max(60, Math.round(scope.box.clientHeight || (kind === 'el' ? 220 : 150)));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const { L, R: padR, T, B: padB } = PAD;
  const R = w - padR;
  const B = h - padB;
  const v = c.view;
  const lo = kind === 'el' ? 0 : -v.azMaxDeg;
  const hi = kind === 'el' ? v.hMax : v.azMaxDeg;
  const X = (r) => L + (r / v.rMax) * (R - L);
  const Y = (y) => B - ((y - lo) / (hi - lo)) * (B - T);
  const clipId = `par-clip-${kind}`;
  const defs = sv('defs', {});
  const clip = sv('clipPath', { id: clipId });
  clip.appendChild(sv('rect', { x: L, y: T, width: R - L, height: B - T }));
  defs.appendChild(clip);
  svg.appendChild(defs);
  const g = sv('g', {});
  const pg = sv('g', { 'clip-path': `url(#${clipId})` });
  svg.append(g, pg);

  const rs = niceStep(v.rMax, 8);
  for (let r = 0; r <= v.rMax + 1e-9; r += rs) {
    g.appendChild(sv('line', { x1: X(r), x2: X(r), y1: T, y2: B, stroke: COL.grid }));
    g.appendChild(sv('text', { x: X(r), y: h - 3, 'text-anchor': r === 0 ? 'start' : 'middle', fill: COL.faint }, r === 0 ? 'TD' : String(+r.toFixed(2))));
  }
  const vs = niceStep(hi - lo, 4);
  for (let y = Math.ceil(lo / vs) * vs; y <= hi + 1e-9; y += vs) {
    g.appendChild(sv('line', { x1: L, x2: R, y1: Y(y), y2: Y(y), stroke: COL.grid }));
    const t = kind === 'el' ? String(Math.round(y)) : azAxisLabel(y);
    g.appendChild(sv('text', { x: L - 4, y: Y(y) + 3, 'text-anchor': 'end', fill: COL.faint, 'data-par-axis': kind }, t));
  }

  const inop = kind === 'el' ? c.elInop : c.azInop;
  scope.box.dataset.inop = inop ? '1' : '';
  if (inop) {
    const t = sv('text', { x: (L + R) / 2, y: (T + B) / 2, 'text-anchor': 'middle', fill: COL.bad, 'data-par-inop': kind }, kind === 'el' ? 'NO ELEVATION DATA' : 'NO AZIMUTH DATA');
    svg.appendChild(t);
    if (c.reason) svg.appendChild(sv('text', { x: (L + R) / 2, y: (T + B) / 2 + 15, 'text-anchor': 'middle', fill: COL.bad }, c.reason));
    return;
  }

  const path = (fn, dashed, tag) => {
    const from = dashed ? Math.min(c.rDa, v.rMax) : 0;
    let d = '';
    for (let i = 0; i <= 60; i++) {
      const rr = from + ((v.rMax - from) * i) / 60;
      d += `${i ? 'L' : 'M'}${X(rr).toFixed(1)} ${Y(fn(rr)).toFixed(1)}`;
    }
    pg.appendChild(sv('path', {
      d, fill: 'none', stroke: dashed ? COL.refDash : COL.ref, 'stroke-width': dashed ? 1 : 1.3,
      'stroke-dasharray': dashed ? '5 4' : 'none', 'data-par-line': tag, ...(dashed ? { 'data-from-nm': from.toFixed(3) } : {}),
    }));
  };
  const tch = c.approach ? c.approach.tchFt : 0;
  if (kind === 'el') {
    path((rr) => gpHeightFt(rr, c.gpa, tch), false, 'glidepath');
    path((rr) => gpHeightFt(rr, c.gpa, tch, -c.tolElLow), true, 'tol-low');
    path((rr) => gpHeightFt(rr, c.gpa, tch, c.tolElHigh), true, 'tol-high');
    if (c.approach && Number.isFinite(c.approach.dhFt)) {
      const xd = X(c.rDa);
      const yd = Y(c.approach.dhFt);
      pg.appendChild(sv('line', { x1: xd, x2: xd, y1: yd - 7, y2: yd + 7, stroke: COL.ref, 'data-par-line': 'da' }));
      pg.appendChild(sv('text', { x: xd + 4, y: yd + 15, fill: COL.faint }, 'DA'));
    }
  } else {
    path(() => 0, false, 'course');
    // degrees: the ±tolerance lines are straight (a B-display, ADR 0123)
    path(() => c.tolAz, true, 'tol-right');
    path(() => -c.tolAz, true, 'tol-left');
  }

  // azimuth: a plot past the window's edge (close in, a few feet are degrees) is drawn at the edge, never lost
  const yOf = (p) => (kind === 'el' ? p.heightFt : (Number.isFinite(p.azDeg) ? clampTo(p.azDeg, lo, hi) : NaN));
  const ok = (p) => p && Number.isFinite(p.rangeNm) && Number.isFinite(yOf(p));
  const sev = kind === 'el' ? c.sev.el : c.sev.az;
  const colour = sev === 'danger' ? COL.danger : COL.plot;
  const trail = sv('g', { 'data-par-trail': kind });
  const pts = c.trail.filter(ok);
  pts.forEach((p, i) => {
    trail.appendChild(sv('circle', { cx: X(p.rangeNm), cy: Y(yOf(p)), r: 1.9, fill: colour, opacity: (0.18 + (i + Math.max(0, 12 - pts.length)) * 0.06).toFixed(2) }));
  });
  pg.appendChild(trail);
  if (ok(c.plot)) {
    const x = X(c.plot.rangeNm);
    const y = Y(yOf(c.plot));
    const lost = c.noPlot;
    const fill = lost ? COL.attn : colour;
    pg.appendChild(sv('path', {
      d: `M${x} ${y - 6}L${x + 6} ${y}L${x} ${y + 6}L${x - 6} ${y}Z`,
      fill: lost ? 'none' : fill, stroke: lost ? fill : COL.halo, 'stroke-width': lost ? 1.6 : 2.5, 'paint-order': 'stroke',
      'data-par-plot': kind, 'data-level': lost ? 'attn' : (sev || ''),
      ...(kind === 'az' && Math.abs(c.plot.azDeg) > hi ? { 'data-clamped': '1' } : {}),
    }));
  }
}

function _windowText(kind, autoscale) {
  const v = _view;
  const span = kind === 'el' ? `0–${Math.round(v.hMax)} ft` : `±${+v.azMaxDeg.toPrecision(2)}°`;
  const auto = autoscale ? (_paused ? ' · AUTO paused (double-click)' : ' · AUTO') : '';
  return `0–${v.rMax.toFixed(1)} NM · ${span}${auto}`;
}

function _renderPicks(samples) {
  const picks = _els.picks;
  picks.hidden = samples.length < 2;
  const sig = samples.length < 2 ? '' : samples.map(s => s.stripId).join(',');
  if (picks.dataset.sig !== sig) {
    // rebuilt only when the flights change, never under a click
    picks.dataset.sig = sig;
    picks.textContent = '';
    if (!sig) return;
    for (const s of samples) {
      const b = _el('button', 'par-pick', '');
      b.type = 'button';
      b.dataset.parPick = s.stripId;
      b.addEventListener('click', () => { _selected = s.stripId; renderParPanel(); });
      picks.appendChild(b);
    }
  }
  for (const b of picks.children) {
    const s = samples.find(x => x.stripId === b.dataset.parPick);
    const name = (s && parFlightOf(s.stripId).name) || b.dataset.parPick;
    if (b.textContent !== name) b.textContent = name;
    b.setAttribute('aria-pressed', String(b.dataset.parPick === _shown));
  }
}

function _renderTerminals(sample) {
  const live = getEfspStrip(sample.stripId);
  const recorded = parTerminals().filter(t => parTerminalRecorded(live, t)).map(t => t.id);
  // rebuilt when the flight or a recorded call changes, never under a click
  const sig = `${sample.stripId}|${recorded.join(',')}`;
  if (_els.termSig === sig) return;
  _els.termSig = sig;
  _els.terms.textContent = '';
  for (const t of parTerminals()) {
    const b = _el('button', 'par-term', t.label);
    b.type = 'button';
    b.dataset.terminal = t.id;
    // a recorded call stays on the line, greyed: it is the record (crc-sync docs/adr/0117)
    if (recorded.includes(t.id)) { b.disabled = true; b.dataset.recorded = '1'; }
    b.addEventListener('click', () => {
      const strip = getEfspStrip(sample.stripId);
      if (!strip) return;
      const facility = strip.facilityId || sample.facilityId;
      if (!getActingPositions(facility).includes(strip.ownerPositionId)) return;
      const op = parTerminalOp(t);
      if (op) sendEfspMutation(strip.ownerPositionId, strip, op);
    });
    _els.terms.appendChild(b);
  }
}

/** The Position this session acts as that may set the approach values at the sample's Facility, or null (the mirror of SetParApproach's owners). */
function _valueSetter(sample) {
  if (!sample) return null;
  const owners = RUNWAY_STATUS_ACTION_OWNERS.SetParApproach || [];
  return getActingPositions(sample.facilityId).find(p => owners.includes(p)) || null;
}

function _renderValues(sample, approach) {
  const cells = parValueCells(approach);
  const editable = !!(approach && approach.runwayEnd && _valueSetter(sample));
  if (_editing && (!approach || _editing.approachId !== approach.id || !editable)) _editing = null;
  for (const c of cells) {
    const span = _els.values[c.field];
    span.dataset.set = c.set ? '1' : '';
    span.dataset.editable = editable ? '1' : '';
    span.classList.toggle('par-set', c.set);
    if (_editing && _editing.field === c.field) continue; // never redrawn under the controller's typing
    if (span.firstChild && span.firstChild.nodeType !== 3) span.textContent = '';
    const text = c.text || '—';
    if (span.textContent !== text) span.textContent = text;
    span.title = editable ? `${c.title} — click to set` : c.title;
  }
}

/** Opens an approach value for typing, in place. */
function _beginEdit(field) {
  const sample = _shown ? parSampleFor(_shown) : null;
  const approach = sample && sample.approach;
  if (!approach || !approach.runwayEnd || !_valueSetter(sample)) return;
  if (_editing && _editing.field === field) return;
  _editing = null;
  renderParPanel(); // puts the cell that was open back
  const cell = parValueCells(approach).find(c => c.field === field);
  const span = _els.values[field];
  span.textContent = '';
  const input = _el('input', 'par-input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.size = field === 'gpaDeg' ? 5 : 6;
  input.value = cell && cell.value != null ? String(field === 'gpaDeg' ? cell.value.toFixed(2) : Math.round(cell.value)) : '';
  input.dataset.parInput = field;
  input.setAttribute('aria-label', `${cell ? cell.label : field}, default ${cell ? cell.defaultText : ''}`);
  input.title = `${cell ? cell.label : field}: Enter to set, empty for the default (${cell ? cell.defaultText : ''}), Escape to cancel`;
  const reset = _el('button', 'par-default', 'Default');
  reset.type = 'button';
  reset.dataset.parDefault = field;
  reset.title = `back to the default, ${cell ? cell.defaultText : ''}`;
  reset.hidden = !(cell && cell.set);
  // mousedown would blur the input first, which cancels the edit
  reset.addEventListener('mousedown', (e) => e.preventDefault());
  reset.addEventListener('click', () => _commitEdit(null));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); _commitEdit(input.value); }
    else if (e.key === 'Escape') { e.preventDefault(); _cancelEdit(); }
    e.stopPropagation(); // the app's shortcuts must not see the typing
  });
  input.addEventListener('blur', () => { if (_editing && _editing.input === input) _cancelEdit(); });
  span.append(input, reset);
  _editing = { approachId: approach.id, field, input };
  input.focus();
  input.select();
}

function _cancelEdit() {
  _editing = null;
  if (_els) _els.msg.dataset.valueError = '';
  renderParPanel();
}

/** Sends a typed value (`text` null: back to the default). An invalid one keeps the field open with the range. */
function _commitEdit(text) {
  if (!_editing) return;
  const sample = _shown ? parSampleFor(_shown) : null;
  const approach = sample && sample.approach;
  const positionId = _valueSetter(sample);
  if (!approach || !positionId) { _cancelEdit(); return; }
  const { field, input } = _editing;
  const r = text === null ? { ok: true, value: null } : parseParValue(field, text);
  if (!r.ok) {
    input.setAttribute('aria-invalid', 'true');
    input.dataset.invalid = '1';
    input.title = r.error;
    _els.msg.textContent = `${PAR_VALUE_CELLS.find(c => c.field === field).label}: ${r.error}`;
    _els.msg.dataset.valueError = '1';
    _els.msg.className = 'par-msg';
    return;
  }
  sendEfspRunwayStatusMutation(positionId, sample.facilityId, undefined, { kind: 'SetParApproach', runwayEnd: approach.runwayEnd, field, value: r.value });
  _cancelEdit();
}

/** Draws the panel from the PAR samples this session holds. Called on every `par` frame, Board change, setting, zoom and tick. */
export function renderParPanel() {
  if (!_bodyEl) return;
  const samples = parSamples();
  const now = Date.now();
  for (const id of [..._firstSeen.keys()]) if (!samples.some(s => s.stripId === id)) { _firstSeen.delete(id); _trails.delete(id); }
  for (const s of samples) if (!_firstSeen.has(s.stripId)) _firstSeen.set(s.stripId, now);
  const id = pickFlight(samples, _selected);
  const sample = id ? parSampleFor(id) : null;
  _emptyEl.hidden = !!sample;
  _bodyEl.hidden = !sample;
  if (!sample) { _shown = null; return; }
  if (!_els) _build();
  if (id !== _shown) { _paused = false; _els.termSig = ''; }
  _shown = id;
  _renderPicks(samples);

  const approach = sample.approach || null;
  // the angle in use is the approach's, one value per approach on the server (docs/adr/0130)
  const gpa = approach && Number.isFinite(approach.gpaDeg) ? approach.gpaDeg : PAR_DEFAULTS.gpaDeg;
  const tolElHigh = _num('parTolElHigh', PAR_DEFAULTS.tolElHighDeg);
  const tolElLow = _num('parTolElLow', PAR_DEFAULTS.tolElLowDeg);
  const tolAz = _num('parTolAz', PAR_DEFAULTS.tolAzDeg);
  const rDa = rangeAtDaNm(approach, gpa);
  const plot = sample.plot || null;
  const sev = severity(plot, { rDaNm: rDa, tolElHighDeg: tolElHigh, tolElLowDeg: tolElLow, tolAzDeg: tolAz });
  const times = parSampleTimes();
  const np = noPlotState(sample, { receivedAtMs: times.receivedAt, nowMs: now, firstSeenMs: _firstSeen.get(id) });
  if (!_trails.has(id)) _trails.set(id, createTrailFilter());
  const trail = _trails.get(id).apply(sample);
  const flight = parFlightOf(id);
  const ro = readoutModel({ sample, plot, flight, sev, noPlot: np });
  const hd = headerModel(approach, gpa);

  _els.title.textContent = hd.title;
  _renderValues(sample, approach);
  _els.da.textContent = hd.da || '—';
  _els.fac.textContent = hd.fac;
  _els.facK.hidden = !hd.fac;
  _els.fac.hidden = !hd.fac;
  _els.flags.textContent = '';
  for (const [on, text] of [[ro.elInop, 'EL INOP'], [ro.azInop, 'AZ INOP']]) {
    if (!on) continue;
    const f = _el('span', 'par-flag par-bad', text);
    f.dataset.parFlag = text.slice(0, 2).toLowerCase();
    f.title = ro.inopReason;
    _els.flags.appendChild(f);
  }
  _els.name.textContent = ro.name;
  _els.type.textContent = ro.type;
  _els.bcn.textContent = ro.beacon;
  _els.bcnK.hidden = !ro.beacon;
  _els.bcn.hidden = !ro.beacon;
  _els.gs.textContent = ro.gs;
  _els.vs.textContent = ro.vs;
  _els.range.textContent = ro.range;

  const setDev = (it, value, level) => {
    it.b.textContent = value;
    it.s.className = `par-dev-item${level ? ` par-${level}` : ''}`;
    it.s.dataset.level = level || '';
    it.extra.textContent = level === 'danger' ? ' OUTSIDE TOLERANCE' : '';
  };
  setDev(_els.elDev, ro.el, ro.elSev);
  setDev(_els.azDev, ro.az, ro.azSev);
  setDev(_els.alt, ro.alt, '');
  if (!(_editing && _els.msg.dataset.valueError === '1')) {
    _els.msg.dataset.valueError = '';
    _els.msg.textContent = ro.noPlot;
    _els.msg.className = ro.noPlot ? 'par-msg par-attn' : 'par-msg';
  }
  _renderTerminals(sample);

  const autoscale = !!getSetting('parAutoscale');
  if (autoscale && !_paused && plot) _view = autoscaleView(plot, { gpaDeg: gpa, tchFt: approach ? approach.tchFt : 0, tolAzDeg: tolAz });
  const ctx = {
    view: _view, gpa, approach, tolElHigh, tolElLow, tolAz, rDa, plot, trail, sev, noPlot: np.amber,
    elInop: ro.elInop, azInop: ro.azInop, reason: ro.inopReason,
  };
  _els.el.win.textContent = _windowText('el', autoscale);
  _els.az.win.textContent = _windowText('az', autoscale);
  _drawScope(_els.el, 'el', ctx);
  _drawScope(_els.az, 'az', ctx);
}

export function initParPanel() {
  _emptyEl = document.getElementById('par-empty');
  _bodyEl = document.getElementById('par-body');
  _els = null;
  renderParPanel();
  if (!_timer) {
    // the no-plot age grows between frames (and when frames stop): a redraw twice a second while the panel is in the document
    _timer = setInterval(() => { if (_bodyEl && _bodyEl.isConnected) renderParPanel(); }, TICK_MS);
  }
  return { onShow: () => renderParPanel() };
}

onEfspChanged(['par', 'snapshot', 'board'], () => renderParPanel());
