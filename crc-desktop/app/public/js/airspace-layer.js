'use strict';

// The airspace outlines on the scope map (AIRSP-2P-B, ADR 0098; mockup scenes 6-8). What is drawn is decided by the layer
// menu (airspace-layer-menu.js `decide`), not by a fixed rule. An ACTIVE airspace is a solid grey outline, any other shown
// state a dashed lighter grey one with its state in the label; orange-red is never used here (ADR 0056/0058).
// The builders are pure (tests/airspace-layer.test.mjs); `registerAirspaceLayers` and `refreshAirspaceLayers` touch the map.

import { NM_M } from './geo.js';
import { decide, mountAirspaceLayerMenu, pruneOverrides, sanitizeMenu } from './airspace-layer-menu.js';
import { map, mapReady, missionData, saveSettings, settings } from './app.js';
import { getAllEfspAirspaces } from './panels/efsp/efsp-state.js';

const ROUND = 12; // arc points per join/cap

export const OUTLINE_COLOUR = { dark: { active: '#9aa5b0', other: '#6c7782' }, light: { active: '#4d5963', other: '#8d98a3' } };

// ── limits text ─────────────────────────────────────────────────────────────────────────────────

/** "GND-FL180", "500-6000", "FL100-FL280": FL from the transition altitude up; null low = surface, null high = unbounded. */
export function limitsText(lowerFt, upperFt, transitionAltFt = 18000) {
  const t = (ft, none) => (ft == null ? none : ft >= transitionAltFt ? `FL${String(Math.round(ft / 100)).padStart(3, '0')}` : String(ft));
  return `${t(lowerFt, 'GND')}–${t(upperFt, 'UNL')}`;
}

/** The label: the name, then (for a non-ACTIVE airspace) the state and the limits. An ACTIVE one shows the limits only. */
export function labelText(record, transitionAltFt) {
  const d = record.definition;
  const lim = limitsText(d.altLowerFt ?? null, d.altUpperFt ?? null, transitionAltFt);
  return { line1: d.name, line2: record.state === 'ACTIVE' ? lim : `${record.state} · ${lim}`, text: `${d.name}\n${record.state === 'ACTIVE' ? lim : `${record.state} · ${lim}`}` };
}

// ── the route corridor (buffered by leg width) ──────────────────────────────────────────────────

function _local(origin) { const k = Math.cos(origin[0] * Math.PI / 180); return { to: ([lat, lon]) => [(lon - origin[1]) * k * 60 * NM_M, (lat - origin[0]) * 60 * NM_M], from: ([x, y]) => [origin[0] + y / (60 * NM_M), origin[1] + x / (k * 60 * NM_M)] }; }
const _dot = (a, b) => a[0] * b[0] + a[1] * b[1];
function _arc(c, from, to, steps, ccw) {
  const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]); let a1 = Math.atan2(to[1] - c[1], to[0] - c[0]);
  const r0 = Math.hypot(from[0] - c[0], from[1] - c[1]); const r1 = Math.hypot(to[0] - c[0], to[1] - c[1]);
  let d = a1 - a0; if (ccw && d < 0) d += 2 * Math.PI; if (!ccw && d > 0) d -= 2 * Math.PI;
  const out = [];
  for (let i = 1; i < steps; i++) { const a = a0 + (d * i) / steps; const r = r0 + ((r1 - r0) * i) / steps; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
  return out;
}

/**
 * The corridor around a route as one closed ring of `[lat, lon]` (width per leg, total width; round caps and outer joins,
 * the inner side of a turn meets at the crossing). `rows` are `{lat, lon, widthNm}` (the last row's width is unused).
 */
export function corridorRing(rows, defaultWidthNm) {
  const pts = rows.filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon));
  if (pts.length < 2) return null;
  const { to, from } = _local([pts[0].lat, pts[0].lon]);
  const P = pts.map(r => to([r.lat, r.lon]));
  const half = pts.map((r, i) => ((i < pts.length - 1 ? (r.widthNm ?? defaultWidthNm) : (pts[i - 1].widthNm ?? defaultWidthNm)) * NM_M) / 2);
  const legs = [];
  for (let i = 0; i < P.length - 1; i++) {
    const dx = P[i + 1][0] - P[i][0]; const dy = P[i + 1][1] - P[i][1]; const len = Math.hypot(dx, dy) || 1;
    const u = [dx / len, dy / len]; const nL = [-u[1], u[0]]; const h = half[i];
    legs.push({ u, nL, h, a: P[i], b: P[i + 1] });
  }
  const side = (sign) => { // sign +1 = left of travel, -1 = right
    const out = [];
    legs.forEach((leg, i) => {
      const s0 = [leg.a[0] + sign * leg.nL[0] * leg.h, leg.a[1] + sign * leg.nL[1] * leg.h];
      const s1 = [leg.b[0] + sign * leg.nL[0] * leg.h, leg.b[1] + sign * leg.nL[1] * leg.h];
      if (i === 0) out.push(s0);
      const next = legs[i + 1];
      if (!next) { out.push(s1); return; }
      const t0 = [next.a[0] + sign * next.nL[0] * next.h, next.a[1] + sign * next.nL[1] * next.h];
      const cross = leg.u[0] * next.u[1] - leg.u[1] * next.u[0]; // >0 = left turn
      const outer = sign > 0 ? cross < 0 : cross > 0;
      if (outer || Math.abs(cross) < 1e-9) {
        out.push(s1);
        if (Math.abs(cross) > 1e-9) out.push(..._arc(leg.b, s1, t0, ROUND, sign > 0 ? false : true));
        out.push(t0);
      } else { // inner: the offset lines cross
        const t1 = [next.b[0] + sign * next.nL[0] * next.h, next.b[1] + sign * next.nL[1] * next.h];
        const d1 = [s1[0] - s0[0], s1[1] - s0[1]]; const d2 = [t1[0] - t0[0], t1[1] - t0[1]];
        const den = d1[0] * d2[1] - d1[1] * d2[0];
        if (Math.abs(den) < 1e-9) { out.push(s1, t0); return; }
        const tt = ((t0[0] - s0[0]) * d2[1] - (t0[1] - s0[1]) * d2[0]) / den;
        const uu = ((t0[0] - s0[0]) * d1[1] - (t0[1] - s0[1]) * d1[0]) / den; // the same crossing along the next offset line
        if (tt >= 0 && tt <= 1 && uu >= 0 && uu <= 1) out.push([s0[0] + d1[0] * tt, s0[1] + d1[1] * tt]);
        else out.push(s1, t0); // the offsets do not meet inside the legs (a width step on a straight run): step across
      }
    });
    return out;
  };
  const left = side(1); const right = side(-1).reverse();
  const first = legs[0]; const last = legs[legs.length - 1];
  const endCap = _arc(last.b, left[left.length - 1], right[0], ROUND, false);
  const startCap = _arc(first.a, right[right.length - 1], left[0], ROUND, false);
  return [...left, ...endCap, ...right, ...startCap].map(from);
}

// ── features ────────────────────────────────────────────────────────────────────────────────────

function _centroid(points) { return [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length]; }
const ll = (p) => [p[1], p[0]];

/**
 * GeoJSON for the airspaces the menu shows: `outlines` (area polygons and route corridors, line features), `centrelines`,
 * `labels` (one point each) and the style flags the paint reads (`dashed`, `colour`).
 */
export function buildAirspaceFeatures(airspaces, menu, theater, { transitionAltFt = 18000, lightMode = false } = {}) {
  const outlines = []; const centrelines = []; const labels = [];
  const pal = lightMode ? OUTLINE_COLOUR.light : OUTLINE_COLOUR.dark;
  for (const rec of airspaces || []) {
    const dec = decide(rec, menu, theater);
    if (!dec.shown) continue;
    const d = rec.definition;
    const active = rec.state === 'ACTIVE';
    const props = { id: rec.airspaceId, state: rec.state, dashed: !active, colour: active ? pal.active : pal.other };
    let anchor = null;
    if (d.kind === 'ROUTE') {
      const rows = d.segments.map(s => ({ lat: s.fix.lat, lon: s.fix.lon, widthNm: s.widthNm }));
      if (dec.drawsCorridor) {
        const ring = corridorRing(rows, d.defaultWidthNm);
        if (ring) outlines.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: [...ring, ring[0]].map(ll) } });
      }
      if (dec.drawsCentreline) centrelines.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: rows.map(r => [r.lon, r.lat]) } });
      const mid = rows[Math.floor(rows.length / 2)];
      anchor = [mid.lat, mid.lon];
    } else if (dec.drawsOutline) {
      const pts = d.geometry.points;
      outlines.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: [...pts, pts[0]].map(ll) } });
      anchor = _centroid(pts);
    }
    if (dec.drawsLabel && anchor) {
      const t = labelText(rec, transitionAltFt);
      labels.push({ type: 'Feature', properties: { ...props, text: t.text }, geometry: { type: 'Point', coordinates: ll(anchor) } });
    }
  }
  const fc = (features) => ({ type: 'FeatureCollection', features });
  return { outlines: fc(outlines), centrelines: fc(centrelines), labels: fc(labels) };
}

/** The shape being edited, in the blue accent: the polygon ring, its vertex handles, midpoint handles and crossing edges. */
export function buildDraftFeatures({ points = [], closed = true, selected = null, crossing = [], rubber = null, route = false, corridor = null } = {}) {
  const f = [];
  const ring = closed && points.length >= 3 ? [...points, points[0]] : points;
  if (ring.length >= 2) f.push({ type: 'Feature', properties: { role: 'edge' }, geometry: { type: 'LineString', coordinates: ring.map(ll) } });
  if (closed && points.length >= 3) f.push({ type: 'Feature', properties: { role: 'fill' }, geometry: { type: 'Polygon', coordinates: [ring.map(ll)] } });
  if (corridor && corridor.length > 2) f.push({ type: 'Feature', properties: { role: 'corridor' }, geometry: { type: 'LineString', coordinates: [...corridor, corridor[0]].map(ll) } });
  for (const [i, j] of crossing) {
    for (const k of [i, j]) f.push({ type: 'Feature', properties: { role: 'cross' }, geometry: { type: 'LineString', coordinates: [points[k], points[(k + 1) % points.length]].map(ll) } });
  }
  points.forEach((p, i) => f.push({ type: 'Feature', properties: { role: 'vertex', index: i, selected: i === selected, first: i === 0 }, geometry: { type: 'Point', coordinates: ll(p) } }));
  if (closed && points.length >= 3 && !route) points.forEach((p, i) => { const q = points[(i + 1) % points.length]; f.push({ type: 'Feature', properties: { role: 'mid', index: i }, geometry: { type: 'Point', coordinates: ll([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]) } }); });
  if (rubber && points.length) f.push({ type: 'Feature', properties: { role: 'rubber' }, geometry: { type: 'LineString', coordinates: [points[points.length - 1], rubber, ...(closed ? [points[0]] : [])].map(ll) } });
  return { type: 'FeatureCollection', features: f };
}

// ── the map ─────────────────────────────────────────────────────────────────────────────────────

const ACCENT = '#4a7dbf'; // --efsp-go: the geometry being edited is a selection, not a state
const BAD = '#ff8a4c';     // --efsp-bad: a crossing edge, the only orange-red here

/** The menu as stored for this user (always a complete, valid one). */
export function currentMenu() { return sanitizeMenu(settings.airspaceMenu); }
export function currentTheater() { return (missionData && missionData.theatre) || ''; }
/** Store a changed menu (a per-user display preference, localStorage via the settings store) and redraw. */
export function applyMenu(menu) { settings.airspaceMenu = menu; saveSettings(); refreshAirspaceLayers(); }

const EMPTY = { type: 'FeatureCollection', features: [] };
let _last = { outlines: EMPTY, centrelines: EMPTY, labels: EMPTY };
/** What the map was last given (the e2e specs read it; MapLibre does not keep the data object). */
export function lastAirspaceFeatures() { return _last; }

/** One registration line in map-setup.js: the sources and layers, below the tracks. */
export function registerAirspaceLayers() {
  for (const id of ['airspace-outlines', 'airspace-centrelines', 'airspace-labels', 'airspace-draft']) map.addSource(id, { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'airspace-outline-solid', type: 'line', source: 'airspace-outlines', filter: ['!', ['get', 'dashed']],
    paint: { 'line-color': ['get', 'colour'], 'line-width': 1.5, 'line-opacity': 0.9 } });
  map.addLayer({ id: 'airspace-outline-dashed', type: 'line', source: 'airspace-outlines', filter: ['get', 'dashed'],
    paint: { 'line-color': ['get', 'colour'], 'line-width': 1.3, 'line-opacity': 0.85, 'line-dasharray': [4, 3] } });
  map.addLayer({ id: 'airspace-centrelines', type: 'line', source: 'airspace-centrelines',
    paint: { 'line-color': ['get', 'colour'], 'line-width': 1, 'line-opacity': 0.8, 'line-dasharray': [1, 3] } });
  map.addLayer({ id: 'airspace-labels', type: 'symbol', source: 'airspace-labels',
    layout: { 'text-field': ['get', 'text'], 'text-font': ['Roboto Regular', 'Noto Sans Regular'], 'text-size': 10, 'text-justify': 'center', 'text-allow-overlap': false },
    paint: { 'text-color': ['get', 'colour'], 'text-halo-color': 'rgba(0,0,0,0.6)', 'text-halo-width': 1 } });
  map.addLayer({ id: 'airspace-draft-fill', type: 'fill', source: 'airspace-draft', filter: ['==', ['get', 'role'], 'fill'], paint: { 'fill-color': ACCENT, 'fill-opacity': 0.14 } });
  map.addLayer({ id: 'airspace-draft-edge', type: 'line', source: 'airspace-draft', filter: ['in', ['get', 'role'], ['literal', ['edge', 'corridor']]], paint: { 'line-color': ACCENT, 'line-width': 2 } });
  map.addLayer({ id: 'airspace-draft-rubber', type: 'line', source: 'airspace-draft', filter: ['==', ['get', 'role'], 'rubber'], paint: { 'line-color': ACCENT, 'line-width': 1.5, 'line-dasharray': [3, 3] } });
  map.addLayer({ id: 'airspace-draft-cross', type: 'line', source: 'airspace-draft', filter: ['==', ['get', 'role'], 'cross'], paint: { 'line-color': BAD, 'line-width': 3 } });
  map.addLayer({ id: 'airspace-draft-mid', type: 'circle', source: 'airspace-draft', filter: ['==', ['get', 'role'], 'mid'],
    paint: { 'circle-radius': 3, 'circle-color': '#ffffff', 'circle-opacity': 0.5, 'circle-stroke-color': ACCENT, 'circle-stroke-width': 1 } });
  map.addLayer({ id: 'airspace-draft-vertex', type: 'circle', source: 'airspace-draft', filter: ['==', ['get', 'role'], 'vertex'],
    paint: { 'circle-radius': ['case', ['get', 'first'], 7, 5], 'circle-color': ['case', ['get', 'selected'], ACCENT, '#ffffff'], 'circle-stroke-color': ACCENT, 'circle-stroke-width': 2 } });
  if (mapReady) refreshAirspaceLayers();
}

/** Redraw the airspace outlines from the registry and the menu. Cheap; called on every airspace change and menu change. */
export function refreshAirspaceLayers() {
  if (!mapReady || !map.getSource('airspace-outlines')) return;
  const airspaces = getAllEfspAirspaces();
  const theater = currentTheater();
  let menu = currentMenu();
  if (airspaces.length) { // an override for a deleted airspace is dropped
    const pruned = pruneOverrides(menu, theater, airspaces.map(a => a.airspaceId));
    if (pruned !== menu) { menu = pruned; settings.airspaceMenu = menu; saveSettings(); }
  }
  const f = buildAirspaceFeatures(airspaces, menu, theater, { transitionAltFt: settings.transitionAltFt, lightMode: !!settings.lightMode });
  _last = f;
  map.getSource('airspace-outlines').setData(f.outlines);
  map.getSource('airspace-centrelines').setData(f.centrelines);
  map.getSource('airspace-labels').setData(f.labels);
  for (const m of _menus) m.refresh();
}

/** The shape being edited (airspace-draw.js). */
export function setDraftFeatures(fc) { if (mapReady && map.getSource('airspace-draft')) map.getSource('airspace-draft').setData(fc || EMPTY); }

// ── the menu, mounted in the settings panel and from a button on the map ────────────────────────

const _menus = [];
function _mount(host) {
  const m = mountAirspaceLayerMenu(host, { getMenu: currentMenu, setMenu: applyMenu, getAirspaces: getAllEfspAirspaces, getTheater: currentTheater, onChange: () => {} });
  _menus.push(m); return m;
}

/** The GENERAL settings tab's section (index.html `#set-airspace-menu`). */
export function mountAirspaceMenuInSettings() {
  const host = document.getElementById('set-airspace-menu');
  if (host) _mount(host);
}

/** The small "Airspaces" button on the map; it opens the same menu as a popover. */
export function mountAirspaceMenuButton() {
  const container = map.getContainer();
  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'airspace-menu-btn'; btn.className = 'airspace-menu-map-btn';
  btn.textContent = 'Airspaces \u25be'; btn.setAttribute('aria-expanded', 'false');
  const pop = document.createElement('div'); pop.id = 'airspace-menu-pop'; pop.className = 'airspace-menu-pop'; pop.hidden = true;
  btn.addEventListener('click', (e) => {
    e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden));
    btn.textContent = pop.hidden ? 'Airspaces \u25be' : 'Airspaces \u25b4';
  });
  container.append(btn, pop);
  _mount(pop);
}
