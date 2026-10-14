'use strict';

// A HAND COPY of crc-sync's src/efsp/airspace/jurisdiction.js outline maths (`isHullAnchored`, `centreOf`, `ringOf`),
// crc-sync docs/adr/0125, held to it by tests/jurisdiction-geometry-parity.test.mjs. The map draws a jurisdiction area
// from it; the server alone answers whose airspace a point is in (`jurisdictionAt`). Pure: no DOM, no state.

export const RING_POINTS = 128;
const NM_PER_DEGREE = 60;
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Is this definition's circle anchored to a carrier hull (it follows the live ship)? */
export function isHullAnchored(def) {
  const g = def && def.geometry;
  return !!(g && g.source === 'CIRCLE' && g.centre && typeof g.centre.hullId === 'string');
}

/** The centre of a CIRCLE as `[lat, lon]`; null for a hull whose position is not known. */
export function centreOf(geometry, hullPosition) {
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
    to: ([lat, lon]) => ({ x: (lon - lon0) * k * NM_PER_DEGREE, y: (lat - lat0) * NM_PER_DEGREE }),
    from: ({ x, y }) => [lat0 + y / NM_PER_DEGREE, lon0 + x / (k * NM_PER_DEGREE)],
  };
}

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** The outline as `[lat, lon]` points (a circle as its RING_POINTS-gon, the cut applied). Null when it cannot be placed. */
export function ringOf(geometry, hullPosition) {
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
