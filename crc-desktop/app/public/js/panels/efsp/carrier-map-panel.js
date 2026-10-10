'use strict';
import { missionNow } from '../../mission-clock.js';
import { getAllTracks, getLatestTrack, history } from '../../picture.js';
import { getTextSizePx } from '../../scope-constants.js';
import { registerSettingsTab, getSetting, setSetting } from '../../settings-registry.js';
import { isAir, sideAltText } from '../../track-label.js';
import { carrierBannerParts, carrierBearingText, carrierStateOf, getEfspCarrier } from './carrier-state.js';
import { correlatedTrackIdForStrip, getAllEfspStrips, getEfspFlightData, getEfspStrip, stripIdsForTrackId } from './efsp-state.js';
import { onEfspChanged } from './efsp-change-bus.js';
import { buildBoard, fuelLevel } from './marshal-board-model.js';
import {
  RANGE_DEFAULT_NM, RANGE_MAX_NM, RANGE_MIN_NM, bolterRacetrack, extendedCentreline, clampRange, declutter, distanceNm, landingPattern,
  marshalStack, occupancy, portHolding, ringSpacingFor, ringsFor, scaleFor, spinCircle, tankerRacetrack, toFrame, wheelRange,
} from './carrier-map-model.js';

// The CARRIER MAP panel (mockup docs/mockups/carrier-map-panel.html, revision 5; decisions H117-H119, S-ARCH-36, H121; lane note
// docs/wip/CARRIER-MAP.md). A radar picture fixed on the ship, always north-up, an ordinary dockable panel that behaves like the
// radar map (H121): the wheel zooms with the map's feel (carrier-map-model.js `wheelRange`), a double click zooms in, Shift+double
// click out; the centre never moves. Contacts look as on the radar map (the hollow diamond, the history dots, labels at the scope's
// text size, which does not change with zoom); their label is the side number and altitude (track-label.js `sideAltText`).
//
// Dark cockpit (memory feedback_dark_cockpit_ui): everything grey; a label is amber within the margin of bingo and red at or below
// it (the MARSHAL panel's rule and its setting, marshal-board-model.js `fuelLevel`, `marshalLowStateMarginKlb`); the header turns
// amber only when the picture cannot be trusted (ship track lost, a bearing that is not true). Patterns appear only while someone
// is in them (carrier-map-model.js `occupancy`) and carry no altitude or distance.
//
// Nothing of the recovery is worked out here: BRC, final bearing, radial, first fix and the fixes in use are the server's (hull
// view); occupancy is the board's rows. This module gathers and draws.

const NS = 'http://www.w3.org/2000/svg';
const COL = Object.freeze({
  bg: '#0b0e11', ring: '#1f5a2e', ring10: '#2f8a45', ringText: '#3f9a55', grid: '#1b2128', line: '#3d4852', ref: '#5f6b76',
  faint: '#56616c', muted: '#8c9aa6', text: '#d8e0e6', ship: '#c9d1d7', track: '#c9d1d7',
});

registerSettingsTab('carrier-map', [
  { key: 'carrierMapRangeNm', type: 'number', label: 'Range', unit: 'nm', default: RANGE_DEFAULT_NM, min: RANGE_MIN_NM, max: RANGE_MAX_NM, step: 0.1, onChange: () => renderCarrierMap() },
  {
    key: 'carrierMapRingSpacing', type: 'select', label: 'Ring spacing', default: 'auto',
    options: [['auto', 'by range'], ['1', '1 nm'], ['2.5', '2.5 nm'], ['5', '5 nm'], ['10', '10 nm']], onChange: () => renderCarrierMap(),
  },
], { label: 'Carrier map' });

let _emptyEl = null;
let _bodyEl = null;
let _els = null;
let _sig = '';
let _geom = null;
let _resize = null;
let _timer = null;

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

function _range() { return clampRange(getSetting('carrierMapRangeNm')); }

function _setRange(nm) {
  const v = Math.round(clampRange(nm) * 10) / 10;
  if (v !== _range()) setSetting('carrierMapRangeNm', v);
}

function _build() {
  _bodyEl.textContent = '';
  const hdr = _el('div', 'cm-hdr');
  const cell = (k, id) => { const s = _el('span', 'cm-hcell'); if (k) s.appendChild(_el('span', 'cm-k', `${k} `)); const b = _el('b', null, ''); b.dataset.cm = id; s.appendChild(b); hdr.appendChild(s); return b; };
  const hull = cell('', 'hull');
  const caseB = cell('CASE', 'case');
  const brc = cell('BRC', 'brc');
  const fb = cell('FB', 'fb');
  const problem = _el('span', 'cm-problem', '');
  problem.dataset.cm = 'problem';
  hdr.appendChild(problem);
  const right = _el('span', 'cm-right');
  right.appendChild(_el('span', 'cm-k', 'RANGE '));
  const range = _el('b', null, ''); range.dataset.cm = 'range';
  right.appendChild(range);
  hdr.appendChild(right);
  const wrap = _el('div', 'cm-wrap');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'cm-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Carrier map, north up');
  svg.dataset.cm = 'svg';
  wrap.appendChild(svg);
  _bodyEl.append(hdr, wrap);
  _els = { hull, caseB, brc, fb, problem, range, wrap, svg };

  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 450 : e.deltaY;
    _setRange(wheelRange(_range(), dy));
  }, { passive: false });
  wrap.addEventListener('dblclick', (e) => {
    e.preventDefault();
    _setRange(e.shiftKey ? _range() * 2 : _range() / 2);
  });
  if (typeof ResizeObserver === 'function') {
    if (_resize) _resize.disconnect();
    _resize = new ResizeObserver(() => { _sig = ''; renderCarrierMap(); });
    _resize.observe(wrap);
  }
}

/** True bearing of a carrier state value, or null when it is unknown or not true (a grid bearing would draw the line in the wrong place). */
function _trueBearing(entry) {
  return entry && entry.ref === 'TRUE' && Number.isFinite(entry.value) ? entry.value : null;
}

function _carrierFd(fd) { return (fd && fd.military && fd.military.carrier) || null; }

/** The side number and fuel of the flight a contact is correlated to, from its live Strips' flight data. */
function _flightOfTrack(trackId) {
  for (const sid of stripIdsForTrackId(trackId)) {
    const s = getEfspStrip(sid);
    const c = s ? _carrierFd(getEfspFlightData(s.flightDataId)) : null;
    if (c) return { flightDataId: s.flightDataId, side: c.sideNumber || '', fuelLb: c.lowStateLb, bingoLb: c.bingoFuelLb };
  }
  return null;
}

/** The contact the recovery tanker is: the one correlated to a live Strip whose flight carries the tanker's side number. */
function _tankerTrackId(side) {
  if (!side) return null;
  for (const s of getAllEfspStrips()) {
    if (!s || s.state === 'DROPPED') continue;
    const c = _carrierFd(getEfspFlightData(s.flightDataId));
    if (c && c.sideNumber === side) {
      const tid = correlatedTrackIdForStrip(s);
      if (tid) return String(tid);
    }
  }
  return null;
}

/** Everything the picture shows, in the ship's frame. Pure over what the client holds; the signature decides a redraw. */
function _model(view, st) {
  const ship = view.shipState;
  const range = _range();
  const margin = Number.isFinite(getSetting('marshalLowStateMarginKlb')) ? getSetting('marshalLowStateMarginKlb') : 1.0;
  const caseValue = view.recoveryCase ? view.recoveryCase.value : null;
  const brc = _trueBearing(st.brc);
  const fb = _trueBearing(st.finalBearing);
  const radial = _trueBearing(st.radial);
  const rows = buildBoard({ view, strips: getAllEfspStrips(), flightDataOf: getEfspFlightData, dmeOf: null, now: missionNow(), marginKlb: margin }).rows;
  const contactOf = (row) => {
    const s = row.stripId ? getEfspStrip(row.stripId) : null;
    const t = s ? getLatestTrack(correlatedTrackIdForStrip(s)) : null;
    if (!t || !Number.isFinite(t.lat) || !Number.isFinite(t.lon)) return null;
    return { at: toFrame(ship, t.lat, t.lon), altFt: t.altitude && Number.isFinite(t.altitude.ft) ? t.altitude.ft : null };
  };
  const tanker = st.tanker || {};
  const occ = occupancy({ caseValue, rows, tankerOnStation: !!(tanker.onStation && tanker.onStation.value === true), contactOf });
  const tankerSide = tanker.sideNumber ? tanker.sideNumber.value : null;
  const tankerTid = _tankerTrackId(tankerSide);
  const aircraft = [];
  for (const t of getAllTracks()) {
    if (!isAir(t) || !Number.isFinite(t.lat) || !Number.isFinite(t.lon)) continue;
    const f = _flightOfTrack(t.id);
    const level = f ? fuelLevel(Number.isFinite(f.fuelLb) ? f.fuelLb : null, Number.isFinite(f.bingoLb) ? f.bingoLb : null, margin) : '';
    const hist = (history.get(t.id) || []).slice(-6).map((h) => toFrame(ship, h.lat, h.lon));
    aircraft.push({
      id: String(t.id), at: toFrame(ship, t.lat, t.lon), hist, label: sideAltText(t, f ? f.side : ''),
      tanker: tankerTid != null && String(t.id) === tankerTid, level,
    });
  }
  const sequenced = caseValue === 'II' || caseValue === 'III';
  const firstFix = st.firstFix && Number.isFinite(st.firstFix.value) ? st.firstFix.value : null;
  const fixDmes = rows.filter((r) => r.kind === 'hold' && Number.isFinite(r.marshalDme)).map((r) => r.marshalDme);
  return {
    range, spacing: getSetting('carrierMapRingSpacing'), caseValue, brc, fb,
    stack: sequenced && radial != null && firstFix != null ? { ...marshalStack(radial, firstFix, fixDmes), text: carrierBearingText(st.radial.display), firstFix } : null,
    occ, tankerSide: tanker.patternSide ? tanker.patternSide.value : 'port', aircraft,
    stale: !!ship.stale,
  };
}

function _pathOf(points, P) { return points.map((q, i) => { const p = P(q); return `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`; }).join(' '); }

function _draw(svg, m, w, h) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const cx = w / 2;
  const cy = h / 2;
  const k = scaleFor(w, h, m.range);
  const reach = Math.hypot(w, h) / 2 / k;
  _geom = { cx, cy, k, range: m.range, w, h };
  const P = (q) => ({ x: cx + q.e * k, y: cy - q.n * k });
  const font = getTextSizePx();
  const textAttrs = (extra) => ({ 'font-size': font, ...extra });

  svg.appendChild(sv('rect', { x: 0, y: 0, width: w, height: h, fill: COL.bg }));
  let stackLabelBox = null;

  // range rings to the corners; the 10 nm ring always (H119)
  const rings = sv('g', { 'data-layer': 'rings', fill: 'none' });
  for (const r of ringsFor(m.range, reach, ringSpacingFor(m.range, m.spacing))) {
    const R = r.nm * k;
    rings.appendChild(sv('circle', { cx, cy, r: R, stroke: r.ten ? COL.ring10 : COL.ring, 'stroke-width': r.ten ? 1.6 : 1.2, 'data-ring-nm': String(r.nm) }));
    if (r.label) rings.appendChild(sv('text', textAttrs({ x: cx + 4, y: cy - R - 4, fill: COL.ringText, class: 'cm-ringlabel', 'data-ring-label': String(r.nm) }), String(r.nm)));
  }
  svg.appendChild(rings);
  svg.appendChild(sv('text', textAttrs({ x: cx - 6, y: 14, 'text-anchor': 'end', fill: COL.muted, 'data-cm': 'north' }), 'N'));

  // the extended centreline astern along the final bearing, a tick every mile
  if (m.fb != null) {
    const c = extendedCentreline(m.fb, reach);
    const g = sv('g', { 'data-cm': 'centreline', 'data-bearing': String(m.fb), stroke: COL.line, 'stroke-width': 1 });
    const a = P(c.from);
    const b = P(c.to);
    g.appendChild(sv('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
    const ux = c.across.e * 4;
    const uy = -c.across.n * 4;
    for (const t of c.ticks) { const p = P(t); g.appendChild(sv('line', { x1: p.x - ux, y1: p.y - uy, x2: p.x + ux, y2: p.y + uy, 'data-tick': '1' })); }
    svg.appendChild(g);
  }

  // the marshal radial and the stack (Case II/III)
  if (m.stack) {
    const s = m.stack;
    const g = sv('g', { 'data-cm': 'stack', stroke: COL.ref });
    const a = P(s.from);
    const b = P(s.to);
    g.appendChild(sv('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, 'stroke-width': 3, opacity: 0.6 }));
    const ux = s.across.e * 5;
    const uy = -s.across.n * 5;
    for (const f of s.fixes) { const p = P(f.at); g.appendChild(sv('line', { x1: p.x - ux, y1: p.y - uy, x2: p.x + ux, y2: p.y + uy, 'data-fix-dme': String(f.dme) })); }
    svg.appendChild(g);
    const l = P(s.labelAt);
    const text = `MARSHAL ${s.text} ${s.firstFix}`;
    svg.appendChild(sv('text', textAttrs({ x: l.x, y: l.y, 'text-anchor': 'middle', fill: COL.faint, 'data-cm': 'stack-label' }), text));
    const tw = text.length * font * 0.6;
    stackLabelBox = { x: l.x - tw / 2, y: l.y - font, w: tw, h: font * 1.2 };
  }

  // the patterns, only while occupied, no altitude or distance on them
  const pat = { fill: 'none', stroke: COL.ref, 'stroke-width': 1.2, 'stroke-dasharray': '3 3' };
  if (m.fb != null) {
    for (const turn of m.occ.bolterTurns) svg.appendChild(sv('path', { ...pat, d: _pathOf(bolterRacetrack(m.fb, turn), P), 'data-pattern': 'bolter', 'data-turn-nm': String(turn) }));
  }
  if (m.brc != null && m.occ.portHolding) {
    const ph = portHolding(m.brc);
    const c = P(ph.centre);
    svg.appendChild(sv('circle', { ...pat, cx: c.x, cy: c.y, r: ph.r * k, 'stroke-dasharray': '4 3', 'data-pattern': 'port-holding' }));
  }
  if (m.brc != null && m.fb != null && m.occ.landing) {
    const lp = landingPattern(m.brc, m.fb);
    svg.appendChild(sv('path', { ...pat, d: _pathOf(lp.points, P), 'data-pattern': 'landing' }));
    const i = P(lp.initial);
    svg.appendChild(sv('circle', { cx: i.x, cy: i.y, r: 3, fill: COL.ref, 'data-pattern': 'initial' }));
    svg.appendChild(sv('text', textAttrs({ x: i.x + 5, y: i.y - 5, fill: COL.faint }), 'INITIAL'));
  }
  if (m.occ.spin) {
    const sc = spinCircle();
    svg.appendChild(sv('circle', { ...pat, cx, cy, r: sc.r * k, opacity: 0.6, 'data-pattern': 'spin' }));
  }
  if (m.brc != null && m.occ.tanker) {
    svg.appendChild(sv('path', { ...pat, d: `${_pathOf(tankerRacetrack(m.brc, m.tankerSide), P)} Z`, 'stroke-dasharray': '2 4', opacity: 0.7, 'data-pattern': 'tanker' }));
  }

  // the ship, pointing along its BRC
  svg.appendChild(m.brc != null
    ? sv('path', { d: 'M 0 -12 L 5 6 L -5 6 Z', transform: `translate(${cx} ${cy}) rotate(${m.brc})`, fill: m.stale ? 'none' : COL.ship, stroke: COL.ship, 'data-cm': 'ship' })
    : sv('circle', { cx, cy, r: 5, fill: 'none', stroke: COL.ship, 'data-cm': 'ship' }));

  // contacts: history dots, the radar map's hollow diamond, and the label, decluttered
  const inView = (p) => p.x >= -20 && p.x <= w + 20 && p.y >= -20 && p.y <= h + 20;
  const shown = m.aircraft.map((a) => ({ ...a, p: P(a.at) })).filter((a) => inView(a.p));
  const rank = (a) => (a.level === 'danger' ? 0 : a.level === 'attn' ? 1 : a.tanker ? 2 : 3);
  shown.sort((a, b) => rank(a) - rank(b) || distanceNm(a.at) - distanceNm(b.at) || (a.id < b.id ? -1 : 1));
  const lineH = Math.round(font * 1.2);
  const boxes = shown.map((a) => ({
    id: a.id, x: a.p.x, y: a.p.y, w: Math.ceil(Math.max(a.label.length, a.tanker ? 3 : 0) * font * 0.6) + 2, h: lineH * (a.tanker ? 2 : 1),
  }));
  // labels keep clear of the ship, of every symbol and of the stack's name
  const obstacles = [{ x: cx - 12, y: cy - 12, w: 24, h: 24 }, ...shown.map((a) => ({ x: a.p.x - 5, y: a.p.y - 5, w: 10, h: 10 }))];
  if (stackLabelBox) obstacles.push(stackLabelBox);
  const placed = declutter(boxes, { dx: 9, dy: Math.round(font * 0.9), obstacles });
  const tracks = sv('g', { 'data-layer': 'tracks' });
  const labels = sv('g', { 'data-layer': 'labels' });
  for (const a of shown) {
    const g = sv('g', { 'data-track-id': a.id, ...(a.tanker ? { 'data-tanker': '1' } : {}), ...(a.level ? { 'data-level': a.level } : {}) });
    a.hist.forEach((q, i) => { const p = P(q); g.appendChild(sv('circle', { cx: p.x, cy: p.y, r: 1.3, fill: COL.muted, opacity: (0.15 + 0.1 * i).toFixed(2) })); });
    g.appendChild(sv('rect', { x: a.p.x - 3.5, y: a.p.y - 3.5, width: 7, height: 7, fill: 'none', stroke: COL.track, transform: `rotate(45 ${a.p.x} ${a.p.y})` }));
    tracks.appendChild(g);
    const box = placed.get(a.id);
    const colour = a.level === 'danger' ? 'var(--efsp-danger, #ff5c5c)' : a.level === 'attn' ? 'var(--efsp-attn, #e0a83c)' : COL.text;
    if (box.moved) {
      const lx = box.x > a.p.x ? box.x : box.x + boxes.find((b) => b.id === a.id).w;
      labels.appendChild(sv('line', { x1: a.p.x, y1: a.p.y, x2: lx, y2: box.y + lineH / 2, stroke: COL.faint, 'stroke-width': 0.75, 'data-leader': a.id }));
    }
    const t = sv('text', textAttrs({ x: box.x, y: box.y + font, fill: colour, class: 'cm-label', 'data-label': a.id }), a.label);
    labels.appendChild(t);
    if (a.tanker) labels.appendChild(sv('text', textAttrs({ x: box.x, y: box.y + font + lineH, fill: COL.muted, class: 'cm-label' }), 'TKR'));
  }
  svg.append(tracks, labels);
}

/** Draws the panel from the hull view, the Strips and the contacts. Called on every carrier, Board or scope change. */
export function renderCarrierMap() {
  if (!_bodyEl) return;
  const view = getEfspCarrier();
  const st = carrierStateOf(view);
  const ship = view && view.shipState;
  const found = !!(st && ship && ship.found && Number.isFinite(ship.lat) && Number.isFinite(ship.lon));
  _emptyEl.hidden = found;
  _bodyEl.hidden = !found;
  if (!found) {
    _emptyEl.textContent = view ? (carrierBannerParts(view).problem || 'hull not found') : 'No carrier.';
    _geom = null;
    return;
  }
  if (!_els) _build();
  const banner = carrierBannerParts(view);
  _els.hull.textContent = view.hullId || '';
  _els.caseB.textContent = (view.recoveryCase && view.recoveryCase.value) || '—';
  _els.brc.textContent = st.brc.value != null ? carrierBearingText(st.brc.display) : '—';
  _els.fb.textContent = st.finalBearing.value != null ? carrierBearingText(st.finalBearing.display) : '—';
  const notTrue = [st.brc, st.finalBearing].some((e) => e && e.value != null && e.ref !== 'TRUE');
  _els.problem.textContent = banner.problem || (notTrue ? 'bearing not true: lines not drawn' : '');
  _els.range.textContent = String(_range());

  const w = Math.max(80, Math.round(_els.wrap.clientWidth || 600));
  const h = Math.max(80, Math.round(_els.wrap.clientHeight || 600));
  const m = _model(view, st);
  const sig = JSON.stringify([w, h, getTextSizePx(), m]);
  if (sig === _sig) return;
  _sig = sig;
  _draw(_els.svg, m, w, h);
}

/** The scale the picture was last drawn at (specs measure against it): centre, pixels per nm, range, size. */
export function carrierMapGeometry() { return _geom ? { ..._geom } : null; }

export function initCarrierMapPanel() {
  _emptyEl = document.getElementById('carrier-map-empty');
  _bodyEl = document.getElementById('carrier-map-body');
  _els = null;
  _sig = '';
  renderCarrierMap();
  if (!_timer) {
    // a setting another panel owns (the MARSHAL panel's low-state margin) changes no frame: a light redraw once a second, only
    // while the panel is in the document (a redraw that changes nothing is a signature compare)
    _timer = setInterval(() => { if (_bodyEl && _bodyEl.isConnected) renderCarrierMap(); }, 1000);
  }
  return { onShow: () => { _sig = ''; renderCarrierMap(); } };
}

onEfspChanged(['snapshot', 'board', 'bays', 'positions', 'ack'], () => renderCarrierMap());
// contacts move every sweep: at most four redraws a second
let _scopeAt = -Infinity;
onEfspChanged('scope', () => {
  const t = performance.now();
  if (t - _scopeAt < 250) return;
  _scopeAt = t;
  renderCarrierMap();
});
