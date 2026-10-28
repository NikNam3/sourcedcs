'use strict';

// Pure geometry for JURISDICTION areas (docs/adr/0125): whose airspace a point is in. No I/O, no clock, no store.
//
// A JURISDICTION area is an airspace definition of kind 'JURISDICTION' (airspace-schema.js): an owning Facility, the
// Positions whose airspace it is, an airspace class, vertical limits in feet MSL and a geometry that is a POLYGON or a
// CIRCLE. A circle's centre is a fixed point `{lat, lon}` or a carrier hull `{hullId}` (it follows the live ship); a
// fixed circle may carry a `cut` (the part LEFT of the straight line from `cut.from` to `cut.to` is removed, so the
// right-hand side is kept: the shape of an ICAO control zone "except the part north west of a line"). An area may name
// other static areas in `excludes`: their whole volume as drawn (shape and limits, not their own excludes) is cut out of
// it (H144: RAPCON minus the tower's control zone).
//
// Rules (H142-H145): the boundary counts as inside; a null lower limit is the surface and a null upper is unbounded; a
// carrier-anchored area wins over everything (it moves, so static airspace cannot follow it); two static areas never
// share volume (the store refuses it, `findStaticOverlap`), so a point is in at most one of them except on a shared
// boundary, where the first by airspaceId answers (deterministic, no precedence list: H144 removed it); an excluded
// volume keeps its own boundary. Outside every area the fallback is CENTER, unclassified with
// VFR advisories (H173 VQ-B: no invented class letter). A Class G area belongs to nobody.
//
// Distances are NM on a local equirectangular projection (containment.js's reasoning: far below anything a controller
// can read at 50 nm). A circle is exact for the point query; the overlap check (a validator) uses its 128-gon.

const containment = require('./containment');

// Engineering constants (named, not tuning values).
const RING_POINTS = 128;              // a circle as a polygon, for the overlap check and the map
const MAX_RADIUS_NM = 250;            // a typed radius is checked against this (a sanity bound)
const BOUNDARY_EPSILON_NM = 1e-6;     // as containment.js: this close to an edge is on it (so inside)
const PROBE_NM = 1e-3;                // how far from a vertex the overlap check probes into each face
const UNBOUNDED_PAD_FT = 1000;        // a probe altitude beyond the last finite limit

/** The Facility whose airspace is everything no area covers (H142), and what VFR gets there: unclassified (null), VFR
 *  advisories (H173 VQ-B b; docs/adr/0143's unclassified area with its own vfrService). */
const FALLBACK_FACILITY_ID = 'CENTER';
const FALLBACK_AIRSPACE_CLASS = null;
const FALLBACK_VFR_SERVICE = 'ADVISORY';

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Is this definition's circle anchored to a carrier hull (so it moves and may overlap anything)? */
function isHullAnchored(def) {
  const g = def && def.geometry;
  return !!(g && g.source === 'CIRCLE' && g.centre && typeof g.centre.hullId === 'string');
}

/**
 * The centre of a CIRCLE geometry as `[lat, lon]`, or null when it is anchored to a hull whose position is not known.
 * @param {object} geometry
 * @param {(hullId:string)=>({lat:number, lon:number}|null)} hullPosition
 */
function centreOf(geometry, hullPosition) {
  const c = geometry.centre || {};
  if (typeof c.hullId === 'string') {
    const at = hullPosition ? hullPosition(c.hullId) : null;
    return at && isFiniteNum(at.lat) && isFiniteNum(at.lon) ? [at.lat, at.lon] : null;
  }
  return isFiniteNum(c.lat) && isFiniteNum(c.lon) ? [c.lat, c.lon] : null;
}

function projector(lat0, lon0) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return {
    to: ([lat, lon]) => ({ x: (lon - lon0) * k * containment.NM_PER_DEGREE, y: (lat - lat0) * containment.NM_PER_DEGREE }),
    from: ({ x, y }) => [lat0 + y / containment.NM_PER_DEGREE, lon0 + x / (k * containment.NM_PER_DEGREE)],
  };
}

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Is `[lat, lon]` inside the shape of `geometry` (boundary inside)? A hull-anchored circle with no known hull is not anywhere. */
function insideShape(geometry, point, hullPosition) {
  if (!geometry) return false;
  if (geometry.source === 'POLYGON' || geometry.source === 'DCS_DRAWING') {
    return Array.isArray(geometry.points) && geometry.points.length >= 3 && containment.pointInPolygon(point, geometry.points);
  }
  if (geometry.source !== 'CIRCLE') return false;
  const c = centreOf(geometry, hullPosition);
  if (!c) return false;
  const proj = projector(c[0], c[1]);
  const p = proj.to(point);
  if (Math.hypot(p.x, p.y) > geometry.radiusNm + BOUNDARY_EPSILON_NM) return false;
  const cut = geometry.cut;
  if (!cut) return true;
  // Kept: the right-hand side of from -> to (the cross product is negative there), the line itself included.
  const a = proj.to(cut.from); const b = proj.to(cut.to);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return cross(a, b, p) / len <= BOUNDARY_EPSILON_NM;
}

/** Does the point `{lat, lon, altFt}` lie in this JURISDICTION area's volume (its excludes cut out)? */
function contains(def, { lat, lon, altFt }, { hullPosition = () => null, byId = () => null } = {}) {
  if (!containment.bandContains(def.altLowerFt, def.altUpperFt, altFt)) return false;
  if (!insideShape(def.geometry, [lat, lon], hullPosition)) return false;
  for (const id of def.excludes || []) {
    const ex = byId(id);
    if (ex && containment.bandContains(ex.altLowerFt, ex.altUpperFt, altFt) && insideShape(ex.geometry, [lat, lon], hullPosition)) return false;
  }
  return true;
}

/**
 * The JURISDICTION area a point is in, among `defs` (one theater's definitions; other kinds are ignored): a carrier area
 * first, then a static one, the first by airspaceId either way. `undefined` when no area holds it (the caller's fallback,
 * CENTER). The caller turns a Class G answer into "nobody".
 * @returns {object|undefined}
 */
function areaAt(defs, point, { hullPosition = () => null } = {}) {
  const areas = (defs || []).filter(d => d && d.kind === 'JURISDICTION').sort((a, b) => (a.airspaceId < b.airspaceId ? -1 : a.airspaceId > b.airspaceId ? 1 : 0));
  const byIdMap = new Map(areas.map(d => [d.airspaceId, d]));
  const ctx = { hullPosition, byId: (id) => byIdMap.get(id) || null };
  return areas.find(d => isHullAnchored(d) && contains(d, point, ctx))
    || areas.find(d => !isHullAnchored(d) && contains(d, point, ctx));
}

// ── the shape as a ring (the overlap check and the map) ─────────────────────────────────────────

/** The outline as `[lat, lon]` points (a circle as its RING_POINTS-gon, the cut applied). Null when it cannot be placed. */
function ringOf(geometry, hullPosition) {
  if (!geometry) return null;
  if (geometry.source === 'POLYGON' || geometry.source === 'DCS_DRAWING') return Array.isArray(geometry.points) ? geometry.points.map(p => [p[0], p[1]]) : null;
  if (geometry.source !== 'CIRCLE') return null;
  const c = centreOf(geometry, hullPosition);
  if (!c) return null;
  const proj = projector(c[0], c[1]);
  let ring = [];
  for (let i = 0; i < RING_POINTS; i++) {
    const t = (2 * Math.PI * i) / RING_POINTS;
    ring.push({ x: geometry.radiusNm * Math.sin(t), y: geometry.radiusNm * Math.cos(t) });
  }
  if (geometry.cut) {
    // Sutherland-Hodgman against one half-plane: keep cross(a, b, p) <= 0 (the right-hand side).
    const a = proj.to(geometry.cut.from); const b = proj.to(geometry.cut.to);
    const side = (p) => cross(a, b, p);
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]; const q = ring[(i + 1) % ring.length];
      const sp = side(p); const sq = side(q);
      if (sp <= 0) out.push(p);
      if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
        const t = sp / (sp - sq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
    ring = out;
  }
  return ring.length >= 3 ? ring.map(proj.from) : null;
}

// ── the static-overlap check (H144) ─────────────────────────────────────────────────────────────

function _segDist(p, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function _inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]; const b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function _nearRing(p, ring, tol) {
  for (let i = 0; i < ring.length; i++) if (_segDist(p, ring[i], ring[(i + 1) % ring.length]) <= tol) return true;
  return false;
}

/** Strictly inside the region (outer minus holes): off every boundary, inside the outer ring, in no hole. */
function _inRegionStrict(p, region) {
  if (!_inRing(p, region.outer) || _nearRing(p, region.outer, BOUNDARY_EPSILON_NM)) return false;
  for (const h of region.holes) if (_inRing(p, h) || _nearRing(p, h, BOUNDARY_EPSILON_NM)) return false;
  return true;
}

function _segIntersection(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y }; const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

/**
 * Do two plane regions `{outer, holes}` (projected rings) share any area? Every face of the arrangement of their edges
 * has a vertex (a ring vertex or a crossing) on its boundary, so probing a hair into each angular wedge around every such
 * point finds a point strictly inside both regions whenever one exists. Touching along an edge or at a point is not overlap.
 */
function regionsOverlap(ra, rb) {
  const rings = [ra.outer, ...ra.holes, rb.outer, ...rb.holes];
  const segs = [];
  for (const ring of rings) for (let i = 0; i < ring.length; i++) segs.push([ring[i], ring[(i + 1) % ring.length]]);
  const points = rings.flat();
  // Crossings between edges of different rings, with a box test first.
  const box = segs.map(([a, b]) => ({ x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) }));
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = box[i]; const q = box[j];
      if (p.x1 < q.x0 || q.x1 < p.x0 || p.y1 < q.y0 || q.y1 < p.y0) continue;
      const hit = _segIntersection(segs[i][0], segs[i][1], segs[j][0], segs[j][1]);
      if (hit) points.push(hit);
    }
  }
  const tol = BOUNDARY_EPSILON_NM * 10;
  for (const c of points) {
    const dirs = [];
    for (const [a, b] of segs) {
      if (Math.hypot(c.x - a.x, c.y - a.y) <= tol) dirs.push(Math.atan2(b.y - a.y, b.x - a.x));
      else if (Math.hypot(c.x - b.x, c.y - b.y) <= tol) dirs.push(Math.atan2(a.y - b.y, a.x - b.x));
      else if (_segDist(c, a, b) <= tol) { dirs.push(Math.atan2(b.y - a.y, b.x - a.x)); dirs.push(Math.atan2(a.y - b.y, a.x - b.x)); }
    }
    if (!dirs.length) continue;
    dirs.sort((x, y) => x - y);
    for (let k = 0; k < dirs.length; k++) {
      const d0 = dirs[k]; const d1 = k + 1 < dirs.length ? dirs[k + 1] : dirs[0] + 2 * Math.PI;
      if (d1 - d0 < 1e-9) continue;
      const m = (d0 + d1) / 2;
      const probe = { x: c.x + PROBE_NM * Math.cos(m), y: c.y + PROBE_NM * Math.sin(m) };
      if (_inRegionStrict(probe, ra) && _inRegionStrict(probe, rb)) return true;
    }
  }
  return false;
}

const _lo = (v) => (v == null ? -Infinity : v);
const _hi = (v) => (v == null ? Infinity : v);
const _bandHas = (def, h) => _lo(def.altLowerFt) < h && h < _hi(def.altUpperFt);

/**
 * Do two STATIC JURISDICTION areas share volume (H144)? 3D: the altitude axis is cut at every limit of the two areas and
 * of what they exclude; in each slice both are present in, the lateral regions (shape minus the excluded shapes present
 * in that slice) are tested for shared area. An area that excludes the other never overlaps it, by construction.
 * @param {(id:string)=>object|null} byId the theater's definitions
 */
function staticOverlap(a, b, byId) {
  if ((a.excludes || []).includes(b.airspaceId) || (b.excludes || []).includes(a.airspaceId)) return false;
  if (!(_lo(a.altLowerFt) < _hi(b.altUpperFt) && _lo(b.altLowerFt) < _hi(a.altUpperFt))) return false;
  const holesOf = (d) => (d.excludes || []).map(byId).filter(Boolean);
  const all = [a, b, ...holesOf(a), ...holesOf(b)];
  const cuts = [...new Set(all.flatMap(d => [d.altLowerFt, d.altUpperFt]).filter(isFiniteNum))].sort((x, y) => x - y);
  const probes = cuts.length ? [cuts[0] - UNBOUNDED_PAD_FT, ...cuts.slice(1).map((v, i) => (cuts[i] + v) / 2), cuts[cuts.length - 1] + UNBOUNDED_PAD_FT] : [0];
  const ringA = ringOf(a.geometry); const ringB = ringOf(b.geometry);
  if (!ringA || !ringB) return false;
  const all0 = ringA[0];
  const proj = projector(all0[0], all0[1]);
  const regionAt = (d, ring, h) => ({
    outer: ring.map(proj.to),
    holes: holesOf(d).filter(e => _bandHas(e, h)).map(e => ringOf(e.geometry)).filter(Boolean).map(r => r.map(proj.to)),
  });
  for (const h of probes) {
    if (!_bandHas(a, h) || !_bandHas(b, h)) continue;
    if (regionsOverlap(regionAt(a, ringA, h), regionAt(b, ringB, h))) return true;
  }
  return false;
}

/**
 * The first pair of static JURISDICTION areas among `defs` that share volume, as `[idA, idB]`, or null. Carrier-anchored
 * areas are never checked: they are the one overlap allowed (H144). Ids are compared in airspaceId order.
 */
function findStaticOverlap(defs) {
  const areas = (defs || []).filter(d => d && d.kind === 'JURISDICTION' && !isHullAnchored(d))
    .sort((x, y) => (x.airspaceId < y.airspaceId ? -1 : x.airspaceId > y.airspaceId ? 1 : 0));
  const byIdMap = new Map(areas.map(d => [d.airspaceId, d]));
  const byId = (id) => byIdMap.get(id) || null;
  for (let i = 0; i < areas.length; i++) {
    for (let j = i + 1; j < areas.length; j++) {
      if (staticOverlap(areas[i], areas[j], byId)) return [areas[i].airspaceId, areas[j].airspaceId];
    }
  }
  return null;
}

/**
 * The cross-references of a theater's JURISDICTION areas among themselves: every `excludes` id names a static
 * JURISDICTION area of the same list. Null when all hold, else the first problem as text.
 */
function checkExcludes(defs) {
  const byIdMap = new Map((defs || []).map(d => [d.airspaceId, d]));
  for (const d of defs || []) {
    if (!d || d.kind !== 'JURISDICTION') continue;
    for (const id of d.excludes || []) {
      const ex = byIdMap.get(id);
      if (!ex) return `${d.airspaceId} excludes ${id}, which is not an airspace of this theater`;
      if (ex.kind !== 'JURISDICTION') return `${d.airspaceId} excludes ${id}, which is not a JURISDICTION area`;
      if (isHullAnchored(ex)) return `${d.airspaceId} excludes ${id}, a carrier area (it moves; it wins without being cut out)`;
    }
  }
  return null;
}

/** The whole check a theater's JURISDICTION areas pass at load and on every write: excludes, then static overlap. */
function checkTheater(defs) {
  const bad = checkExcludes(defs);
  if (bad) return bad;
  const pair = findStaticOverlap(defs);
  return pair ? `${pair[0]} and ${pair[1]} share airspace: two jurisdiction areas may not overlap (only a carrier area may)` : null;
}

module.exports = {
  RING_POINTS, MAX_RADIUS_NM, FALLBACK_FACILITY_ID, FALLBACK_AIRSPACE_CLASS, FALLBACK_VFR_SERVICE,
  isHullAnchored, centreOf, insideShape, contains, areaAt, ringOf,
  regionsOverlap, staticOverlap, findStaticOverlap, checkExcludes, checkTheater,
};
