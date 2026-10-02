'use strict';

// Pure geometry for the airspace registry (docs/adr/0098 §5-§7). No I/O, no clock, no store.
//
// Coordinates are WGS84 decimal degrees, `[lat, lon]`. Distances are in nautical miles on a local
// equirectangular projection about the shape's own centroid: at the size of a MOA or an MTR leg the error is far
// below anything a controller can read, and it needs no geodesy library. Altitudes are INDICATED feet (§6):
// the caller converts with `indicatedAltFt`, exactly as conformance does. Bounds are inclusive; a null lower is the
// surface and a null upper is unbounded.

// Engineering constants (named, not tuning values).
const MAX_POLYGON_VERTICES = 200;   // typed or drawn outline
const CIRCLE_POLYGON_POINTS = 64;   // a circle or oval from a mission drawing, turned into a polygon by the picker
const NM_PER_DEGREE = 60;           // one degree of latitude
const BOUNDARY_EPSILON_NM = 1e-6;   // a point this close to an edge counts as on it (so inside)

/** Local projection about (lat0, lon0): `[lat, lon]` -> `{x, y}` in NM east and north. */
function projector(lat0, lon0) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return ([lat, lon]) => ({ x: (lon - lon0) * k * NM_PER_DEGREE, y: (lat - lat0) * NM_PER_DEGREE });
}

function centroidOf(points) {
  let lat = 0; let lon = 0;
  for (const [a, o] of points) { lat += a; lon += o; }
  return [lat / points.length, lon / points.length];
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Is `point` ([lat, lon]) inside the polygon `points`? The boundary counts as inside. */
function pointInPolygon(point, points) {
  const [lat0, lon0] = centroidOf(points);
  const proj = projector(lat0, lon0);
  const p = proj(point);
  const ring = points.map(proj);
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]; const b = ring[j];
    if (distToSegment(p, a, b) <= BOUNDARY_EPSILON_NM) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance in NM from `point` to the segment `from`-`to` (both `[lat, lon]`). */
function pointToLegNm(point, from, to) {
  const proj = projector((from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
  return distToSegment(proj(point), proj(from), proj(to));
}

/** altLowerFt <= altFt <= altUpperFt, a null bound being open. An altFt that is not a number is outside any band. */
function bandContains(altLowerFt, altUpperFt, altFt) {
  if (typeof altFt !== 'number' || !Number.isFinite(altFt)) return false;
  if (altLowerFt != null && altFt < altLowerFt) return false;
  if (altUpperFt != null && altFt > altUpperFt) return false;
  return true;
}

function _orient(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
function _onSeg(a, b, c) {
  return Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y);
}
function _segmentsIntersect(a, b, c, d) {
  const o1 = _orient(a, b, c); const o2 = _orient(a, b, d); const o3 = _orient(c, d, a); const o4 = _orient(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  if (o1 === 0 && _onSeg(a, b, c)) return true;
  if (o2 === 0 && _onSeg(a, b, d)) return true;
  if (o3 === 0 && _onSeg(c, d, a)) return true;
  if (o4 === 0 && _onSeg(c, d, b)) return true;
  return false;
}

/** Do two non-adjacent edges of the (implicitly closed) ring cross or touch? */
function polygonSelfIntersects(points) {
  const [lat0, lon0] = centroidOf(points);
  const proj = projector(lat0, lon0);
  const r = points.map(proj);
  const n = r.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (_segmentsIntersect(r[i], r[(i + 1) % n], r[j], r[(j + 1) % n])) return true;
    }
  }
  return false;
}

/**
 * Where is `point` ({lat, lon, altFt}) relative to one definition?
 * @returns {'inside'|'outside'|'unknown'} unknown = the geometry cannot be evaluated (an AREA with no outline, or a
 *   definition with no usable shape). Never a guess (ADR 0098's consequences).
 */
function evaluate(definition, { lat, lon, altFt }) {
  const at = [lat, lon];
  if (definition.kind === 'ROUTE') {
    const segs = definition.segments;
    if (!Array.isArray(segs) || segs.length < 2) return 'unknown';
    for (let i = 0; i < segs.length - 1; i++) {
      const leg = segs[i];
      const width = leg.widthNm != null ? leg.widthNm : definition.defaultWidthNm;
      if (!(width > 0)) continue;
      if (pointToLegNm(at, [leg.fix.lat, leg.fix.lon], [segs[i + 1].fix.lat, segs[i + 1].fix.lon]) <= width / 2
        && bandContains(leg.altLowerFt, leg.altUpperFt, altFt)) return 'inside';
    }
    return 'outside';
  }
  const geometry = definition.geometry;
  if (!geometry || !Array.isArray(geometry.points) || geometry.points.length < 3) return 'unknown';
  if (!bandContains(definition.altLowerFt, definition.altUpperFt, altFt)) return 'outside';
  return pointInPolygon(at, geometry.points) ? 'inside' : 'outside';
}

module.exports = {
  MAX_POLYGON_VERTICES, CIRCLE_POLYGON_POINTS, NM_PER_DEGREE,
  pointInPolygon, pointToLegNm, bandContains, polygonSelfIntersects, evaluate,
};
