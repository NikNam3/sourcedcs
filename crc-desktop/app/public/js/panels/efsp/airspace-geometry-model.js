'use strict';

// The pure half of the geometry editor (AIRSP-2P-B, docs/adr/0098 §5): polygon editing, the DCS-drawing picker's data,
// the route table <-> segments, and the outline's status (what the OUTLINE section's chip and buttons say). No DOM, no state;
// tests/airspace-geometry.test.mjs exercises it. Points are `[lat, lon]` in WGS84 decimal degrees, the closing point is
// never repeated.

import { NM_M } from '../../geo.js';
import { MAX_POLYGON_VERTICES, MAX_ROUTE_SEGMENTS, polygonSelfIntersects, deriveRouteEnvelope } from './airspace-validate.js';

export const MIN_POLYGON_VERTICES = 3;
/** AP2B-Q1 (a): a DCS drawing over the vertex limit is simplified on pick to within this many NM, then refused only if it crosses itself. */
export const SIMPLIFY_TOLERANCE_NM = 0.1;
export const CIRCLE_POINTS = 64;
export const FRESHNESS_EPS_DEG = 1e-6;
const NM_PER_DEG = 60;
const EARTH_R_M = 6371008.8;
const rad = Math.PI / 180;

// ── small geometry ──────────────────────────────────────────────────────────────────────────────

/** A point `distM` away on `bearingDeg` (spherical). */
export function destination(lat, lon, bearingDeg, distM) {
  const d = distM / EARTH_R_M; const b = bearingDeg * rad; const p = lat * rad; const l = lon * rad;
  const p2 = Math.asin(Math.sin(p) * Math.cos(d) + Math.cos(p) * Math.sin(d) * Math.cos(b));
  const l2 = l + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p), Math.cos(d) - Math.sin(p) * Math.sin(p2));
  return [p2 / rad, ((l2 / rad + 540) % 360) - 180];
}

/** Local equirectangular x/y in NM about (lat0, lon0). */
function _xy(lat0) { const k = Math.cos(lat0 * rad); return ([lat, lon], origin) => ({ x: (lon - origin[1]) * k * NM_PER_DEG, y: (lat - origin[0]) * NM_PER_DEG }); }

export function distanceNm(a, b) {
  const f = _xy((a[0] + b[0]) / 2); const p = f(b, a); return Math.hypot(p.x, p.y);
}

/** Bearing a -> b, degrees true. */
export function bearingTo(a, b) {
  const f = _xy((a[0] + b[0]) / 2); const p = f(b, a); return (Math.atan2(p.x, p.y) / rad + 360) % 360;
}

/** A circle as a 64-point polygon (UI code, ADR 0098 §5). Radius in metres. */
export function circleToPolygon(lat, lon, radiusM, n = CIRCLE_POINTS) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(destination(lat, lon, (i / n) * 360, radiusM));
  return out;
}

export function trimClosing(points) {
  const p = points.map(q => [q[0], q[1]]);
  if (p.length > 1 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) p.pop();
  return p;
}

function _perpDistNm(p, a, b, origin, f) {
  const P = f(p, origin); const A = f(a, origin); const B = f(b, origin);
  const dx = B.x - A.x; const dy = B.y - A.y; const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(P.x - A.x, P.y - A.y);
  const t = Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2));
  return Math.hypot(P.x - (A.x + t * dx), P.y - (A.y + t * dy));
}

function _dp(pts, lo, hi, tol, keep, origin, f) {
  let worst = -1; let idx = -1;
  for (let i = lo + 1; i < hi; i++) {
    const d = _perpDistNm(pts[i], pts[lo], pts[hi], origin, f);
    if (d > worst) { worst = d; idx = i; }
  }
  if (worst > tol) { keep[idx] = true; _dp(pts, lo, idx, tol, keep, origin, f); _dp(pts, idx, hi, tol, keep, origin, f); }
}

/** Douglas-Peucker on a closed ring: split at the two points farthest apart so neither end is arbitrary. */
export function simplifyRing(points, toleranceNm = SIMPLIFY_TOLERANCE_NM) {
  const pts = trimClosing(points);
  if (pts.length <= 3) return pts;
  const origin = pts[0]; const f = _xy(pts.reduce((s, p) => s + p[0], 0) / pts.length);
  let far = 1; let farD = -1;
  for (let i = 1; i < pts.length; i++) { const d = distanceNm(pts[0], pts[i]); if (d > farD) { farD = d; far = i; } }
  const keep = new Array(pts.length).fill(false); keep[0] = true; keep[far] = true;
  _dp(pts, 0, far, toleranceNm, keep, origin, f);
  const second = pts.slice(far).concat([pts[0]]);
  const keep2 = new Array(second.length).fill(false); keep2[0] = true; keep2[second.length - 1] = true;
  _dp(second, 0, second.length - 1, toleranceNm, keep2, origin, f);
  const out = pts.filter((_, i) => i <= far && keep[i]);
  second.forEach((p, i) => { if (i > 0 && i < second.length - 1 && keep2[i]) out.push(p); });
  return out;
}

// ── polygon editing (the map's vertex handles and the coordinate table) ─────────────────────────

export function movePoint(points, i, pt) { const p = points.map(q => [q[0], q[1]]); p[i] = [pt[0], pt[1]]; return p; }
export function insertPoint(points, afterIndex, pt) { const p = points.map(q => [q[0], q[1]]); p.splice(afterIndex + 1, 0, [pt[0], pt[1]]); return p; }
export function canDeletePoint(points) { return points.length > MIN_POLYGON_VERTICES; }
export function deletePoint(points, i) { return canDeletePoint(points) ? points.filter((_, k) => k !== i).map(q => [q[0], q[1]]) : points; }
export function midpoints(points) { return points.map((p, i) => { const q = points[(i + 1) % points.length]; return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; }); }

/** Segments of the closed ring as index pairs [i, j] that cross or touch another (non-adjacent) one. Empty = fine. */
export function crossingEdges(points) {
  if (points.length < 4 || !polygonSelfIntersects(points)) return [];
  const bad = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      if (_segCross([points[i], points[(i + 1) % points.length]], [points[j], points[(j + 1) % points.length]])) bad.push([i, j]);
    }
  }
  return bad;
}
function _segCross(s, t) {
  const f = _xy((s[0][0] + t[0][0]) / 2); const o = s[0];
  const a = f(s[0], o); const b = f(s[1], o); const c = f(t[0], o); const d = f(t[1], o);
  const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = orient(a, b, c); const o2 = orient(a, b, d); const o3 = orient(c, d, a); const o4 = orient(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

/** Why a polygon being drawn or edited cannot be finished yet, or null. The same rules as Save (airspace-validate.js). */
export function polygonProblem(points) {
  if (points.length < MIN_POLYGON_VERTICES) return `Needs at least ${MIN_POLYGON_VERTICES} points (${points.length} so far).`;
  if (points.length > MAX_POLYGON_VERTICES) return `At most ${MAX_POLYGON_VERTICES} points (${points.length}).`;
  if (polygonSelfIntersects(points)) {
    const n = crossingEdges(points).length;
    return `Edges cross${n ? ` at ${n} place${n === 1 ? '' : 's'}` : ''}. Move a point back.`;
  }
  return null;
}

export function pointsEqual(a, b, eps = FRESHNESS_EPS_DEG) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((p, i) => Math.abs(p[0] - b[i][0]) < eps && Math.abs(p[1] - b[i][1]) < eps);
}

/** A drawn polygon as a POLYGON geometry. */
export function polygonGeometry(points) { return { source: 'POLYGON', points: trimClosing(points) }; }

// ── the DCS-drawing picker ──────────────────────────────────────────────────────────────────────

/** Hand copy of crc-sync's mission-session.js missionFingerprint (parity test in tests/airspace-geometry.test.mjs). */
export function missionFingerprint(missionData) {
  if (!missionData) return null;
  const names = (list) => (list || []).map(x => (x && (x.name || x.id)) || '').join('|');
  const text = `${missionData.theatre || ''}#${names(missionData.waypoints)}#${names(missionData.drawings)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${missionData.theatre || '?'}:${h.toString(16)}`;
}

export const UNNAMED_LAYER = 'Mission';
const SKIPPED_PRIMITIVES = ['TextBox', 'Icon'];

/** The name a drawing is listed (and referenced) by: its own, or `unnamed drawing #n` from its place in the list. */
export function drawingName(d, index) { return (d && d.name) ? String(d.name) : `unnamed drawing #${index + 1}`; }
export function drawingLayer(d) { return (d && d.layerName) ? String(d.layerName) : UNNAMED_LAYER; }

/** The raw points of a drawing as an outline: circle and oval become 64 points, a rectangle its 4 corners. */
function _rawRing(d) {
  if (d.polygonMode === 'circle' && d.lat != null && d.lon != null && d.radius) return { points: circleToPolygon(d.lat, d.lon, d.radius), shape: `circle ${Math.round(d.radius / NM_M)} NM`, rawCount: CIRCLE_POINTS };
  const pts = Array.isArray(d.points) ? d.points.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon)).map(p => [p.lat, p.lon]) : [];
  const closed = d.closed || d.primitiveType === 'Polygon' || ['rect', 'oval', 'triangle'].includes(d.polygonMode);
  if (!closed || pts.length < MIN_POLYGON_VERTICES) return { points: null, shape: pts.length >= 2 ? 'open line' : 'no points', rawCount: pts.length };
  const ring = trimClosing(pts);
  const shape = d.polygonMode === 'rect' ? 'rectangle' : d.polygonMode === 'oval' ? 'oval' : d.polygonMode === 'triangle' ? 'triangle'
    : (ring.length > 40 ? 'freehand' : 'polygon');
  return { points: ring, shape, rawCount: ring.length };
}

/**
 * What picking this drawing would copy: `{ ok, points, simplifiedFrom?, reason? }` (AP2B-Q1 a). Over 200 points it is
 * simplified to 0.1 NM and refused only if the result still crosses itself (or still has more than 200 points).
 */
export function outlineFromDrawing(d) {
  const raw = _rawRing(d);
  if (!raw.points) return { ok: false, shape: raw.shape, reason: raw.shape === 'open line' ? 'an open line is not an outline' : 'no outline points' };
  let points = raw.points; let simplifiedFrom = null;
  if (points.length > MAX_POLYGON_VERTICES) {
    simplifiedFrom = points.length;
    points = simplifyRing(points, SIMPLIFY_TOLERANCE_NM);
    if (points.length > MAX_POLYGON_VERTICES) return { ok: false, shape: raw.shape, reason: `${simplifiedFrom} points, still ${points.length} after simplifying; the limit is ${MAX_POLYGON_VERTICES}` };
    if (points.length < MIN_POLYGON_VERTICES) return { ok: false, shape: raw.shape, reason: 'too small once simplified' };
  }
  if (polygonSelfIntersects(points)) {
    return { ok: false, shape: raw.shape, reason: simplifiedFrom ? `${simplifiedFrom} points; simplified to ${points.length} it crosses itself` : 'the drawing crosses itself' };
  }
  return { ok: true, shape: raw.shape, points, simplifiedFrom, rawCount: raw.rawCount };
}

/** The picker's rows grouped by DCS layer, in the mission's order. Text and icon drawings are not listed. */
export function listDrawings(drawings) {
  const groups = new Map();
  (drawings || []).forEach((d, index) => {
    if (!d || SKIPPED_PRIMITIVES.includes(d.primitiveType)) return;
    const o = outlineFromDrawing(d);
    const layer = drawingLayer(d);
    if (!groups.has(layer)) groups.set(layer, []);
    groups.get(layer).push({ index, layerName: layer, name: drawingName(d, index), shape: o.shape, pointCount: o.ok ? o.points.length : null, eligible: o.ok, reason: o.ok ? null : o.reason, simplifiedFrom: o.simplifiedFrom || null });
  });
  return [...groups.entries()].map(([layerName, items]) => ({ layerName, items }));
}

/** The geometry a pick produces: a DCS_DRAWING copy of the points with its provenance (DA-2). null if the drawing cannot be one. */
export function geometryFromDrawing(drawings, index, missionData) {
  const d = (drawings || [])[index];
  if (!d) return null;
  const o = outlineFromDrawing(d);
  if (!o.ok) return null;
  return {
    geometry: { source: 'DCS_DRAWING', drawingRef: { layerName: drawingLayer(d), objectName: drawingName(d, index), missionFingerprint: missionFingerprint(missionData) || '' }, points: o.points },
    simplifiedFrom: o.simplifiedFrom,
  };
}

/** The loaded mission's drawing a DCS_DRAWING geometry came from (layer and name), or null. */
export function findDrawing(drawings, ref) {
  if (!ref) return null;
  const list = drawings || [];
  for (let i = 0; i < list.length; i++) {
    if (!list[i] || SKIPPED_PRIMITIVES.includes(list[i].primitiveType)) continue;
    if (drawingLayer(list[i]) === ref.layerName && drawingName(list[i], i) === ref.objectName) return { index: i, drawing: list[i] };
  }
  return null;
}

/**
 * What the OUTLINE section shows and may do (mockup scenes 1-2). `savedGeometry` is what the record held when the form
 * opened; `readOnlyReason` the R3-23 lock.
 */
export function outlineStatus({ geometry, savedGeometry, drawings, readOnlyReason }) {
  const points = geometry && geometry.points ? geometry.points : [];
  const source = !geometry ? 'NONE' : geometry.source === 'DCS_DRAWING' ? 'DCS DRAWING' : 'DRAWN';
  const out = { source, count: points.length, changed: JSON.stringify(geometry ?? null) !== JSON.stringify(savedGeometry ?? null), locked: !!readOnlyReason };
  out.hasOutline = !!geometry;
  out.canClear = !!geometry && !readOnlyReason;
  out.clearWhy = readOnlyReason || (geometry ? null : 'Clear: there is no outline.');
  out.drawLabel = geometry ? 'Edit on map' : 'Draw on map';
  out.canDraw = !readOnlyReason; out.drawWhy = readOnlyReason || null;
  out.canPick = !readOnlyReason; out.pickWhy = readOnlyReason || null;
  out.refresh = { enabled: false, why: null, found: null, differs: false };
  if (!geometry || geometry.source !== 'DCS_DRAWING') {
    out.refresh.why = geometry ? 'Refresh: this outline was drawn, not copied from a drawing.' : 'Refresh: no drawing picked yet.';
  } else {
    const found = findDrawing(drawings, geometry.drawingRef);
    const ref = geometry.drawingRef;
    out.drawingLabel = `${ref.layerName} / ${ref.objectName}`;
    if (!found) out.refresh.why = `Refresh: ${ref.objectName} is not in the loaded mission.`;
    else {
      const o = outlineFromDrawing(found.drawing);
      out.refresh.found = found.index;
      if (!o.ok) out.refresh.why = `Refresh: the drawing is not an outline now (${o.reason}).`;
      else if (pointsEqual(o.points, points)) out.refresh.why = 'Refresh: the copy matches the drawing.';
      else { out.refresh.differs = true; out.refresh.enabled = !readOnlyReason; out.refresh.newCount = o.points.length; }
    }
  }
  if (readOnlyReason) { out.refresh.enabled = false; out.refresh.why = readOnlyReason; }
  return out;
}

/** Refresh from the drawing: the same geometry with the loaded drawing's points. null if refresh is not available. */
export function refreshGeometry(geometry, drawings, missionData) {
  const found = findDrawing(drawings, geometry && geometry.drawingRef);
  if (!found) return null;
  const pick = geometryFromDrawing(drawings, found.index, missionData);
  return pick ? pick.geometry : null;
}

// ── the ROUTE table ─────────────────────────────────────────────────────────────────────────────

/** A new fix row. */
export function blankFix(n) { return { name: String.fromCharCode(65 + (n % 26)), lat: null, lon: null, altLowerFt: null, altUpperFt: null, widthNm: null }; }

/** segments (ADR 0098 §5) -> flat table rows. */
export function rowsFromSegments(segments) {
  return (segments || []).map(s => ({ name: s.fix.name, lat: s.fix.lat, lon: s.fix.lon, altLowerFt: s.altLowerFt ?? null, altUpperFt: s.altUpperFt ?? null, widthNm: s.widthNm ?? null }));
}

/** table rows -> segments: the exit fix (last row) carries no altitudes or width. */
export function segmentsFromRows(rows) {
  return rows.map((r, i) => {
    const last = i === rows.length - 1;
    return { fix: { name: String(r.name ?? ''), lat: r.lat, lon: r.lon }, altLowerFt: last ? null : (r.altLowerFt ?? null), altUpperFt: last ? null : (r.altUpperFt ?? null), widthNm: last ? null : (r.widthNm ?? null) };
  });
}

export function canAddFix(rows) { return rows.length < MAX_ROUTE_SEGMENTS; }
/** Add a fix at the end; the previous last fix becomes a leg and inherits the old exit leg's blanks (a new leg, no bands yet). */
export function addFix(rows, fix) { return [...rows, { ...blankFix(rows.length), ...fix }]; }
export function removeFix(rows, i) { return rows.length <= 2 ? rows : rows.filter((_, k) => k !== i); }

/** The legs' width: the leg's own or the default. */
export function legWidthNm(row, defaultWidthNm) { return row.widthNm ?? defaultWidthNm; }

/** The derived envelope for display (read-only; crc-sync recomputes it on save). */
export function routeEnvelope(rows) {
  if (rows.length < 2) return { altLowerFt: null, altUpperFt: null };
  return deriveRouteEnvelope(segmentsFromRows(rows));
}

/** Summary line for the section, e.g. "4 fixes, 3 legs, one leg wider than the default". */
export function routeSummary(rows, defaultWidthNm) {
  const legs = Math.max(0, rows.length - 1);
  const wider = rows.slice(0, -1).filter(r => r.widthNm != null && r.widthNm !== defaultWidthNm).length;
  return `${rows.length} fix${rows.length === 1 ? '' : 'es'}, ${legs} leg${legs === 1 ? '' : 's'}${wider ? `, ${wider === 1 ? 'one leg' : `${wider} legs`} different from the default` : ''}`;
}

/** A north-up sketch of a ring or a polyline as an SVG string (numbers only, safe for innerHTML). */
export function sketchSvg(points, { closed = true, w = 96, h = 64, dashed = false } = {}) {
  if (!points || points.length < 2) return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><text x="${w / 2}" y="${h / 2 + 3}" text-anchor="middle" font-size="9" fill="currentColor" opacity=".6">no outline</text></svg>`;
  const k = Math.cos((points.reduce((a, p) => a + p[0], 0) / points.length) * rad);
  const xs = points.map(p => p[1] * k); const ys = points.map(p => -p[0]);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const pad = 6; const span = Math.max(maxX - minX, maxY - minY) || 1e-6; const sc = (Math.min(w, h) - 2 * pad) / span;
  const ox = (w - (maxX - minX) * sc) / 2; const oy = (h - (maxY - minY) * sc) / 2;
  const c = xs.map((x, i) => `${(ox + (x - minX) * sc).toFixed(1)},${(oy + (ys[i] - minY) * sc).toFixed(1)}`);
  const attr = `fill="${closed ? 'currentColor' : 'none'}" fill-opacity=".12" stroke="currentColor" stroke-width="1.4"${dashed ? ' stroke-dasharray="3 2"' : ''}`;
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Outline sketch, north up">${closed ? `<polygon points="${c.join(' ')}" ${attr}/>` : `<polyline points="${c.join(' ')}" ${attr}/>`}${c.map(q => { const [x, y] = q.split(','); return `<circle cx="${x}" cy="${y}" r="1.6" fill="currentColor"/>`; }).join('')}</svg>`;
}
