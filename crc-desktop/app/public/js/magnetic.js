'use strict';

// ── Magnetic display (crc-sync's docs/adr/0085) ────────────────────────────
// Every displayed heading, course, bearing and radial is MAGNETIC (decisions
// H15). crc-sync owns what magnetic means: it evaluates the World Magnetic
// Model at the mission date (or the theater's override) and sends a variation
// grid over the theater in its `theater` message. This file only reads that
// grid. It has no model, no table and no setting of its own.
//
//   toMagneticDisplay(trueDeg[, lat, lon])  the ONE function every heading
//     display calls with a TRUE bearing. Without a position it uses the
//     variation at the centre of the theater's grid.
//
// The other direction — a magnetic value a controller TYPES — is never
// converted here (decisions S-R2-12). requestTrueFromMagnetic() asks crc-sync,
// which converts it with the same model, so what is typed and what is shown
// cannot drift apart.
//
// gridConvergenceDeg() is the client's twin of crc-sync's
// magnetic.convergenceAt() (a parity test holds them together), for a DCS
// GRID heading that has to be shown: true = grid + convergence. The central
// meridian comes from the same `theater` message.

let _theaterFacts = null; // the last `theater` message

/** app.js's `theater` case. */
function applyTheaterFacts(msg) {
  _theaterFacts = msg || null;
}

/** The last `theater` message, or null. */
function currentTheaterFacts() { return _theaterFacts; }

function _normDeg(d) { return ((d % 360) + 360) % 360; }

/** Variation (east positive) at a position, or at the theater's centre; null when crc-sync has not said. */
function magneticVariationAt(lat, lon) {
  const m = _theaterFacts && _theaterFacts.magnetic;
  if (!m) return null;
  if (Number.isFinite(m.fixedDeg)) return m.fixedDeg;
  const g = m.grid;
  if (!g || !g.rows || !g.cols) return null;
  const hasPos = Number.isFinite(lat) && Number.isFinite(lon);
  // Grid coordinates, clamped to its edge: a point just outside the padded
  // airfield box reads the nearest edge value rather than nothing.
  const clamp = (v, max) => Math.min(Math.max(v, 0), max);
  const fr = hasPos ? clamp((lat - g.latMin) / g.stepDeg, g.rows - 1) : (g.rows - 1) / 2;
  const fc = hasPos ? clamp((lon - g.lonMin) / g.stepDeg, g.cols - 1) : (g.cols - 1) / 2;
  const r0 = Math.floor(fr), c0 = Math.floor(fc);
  const r1 = Math.min(r0 + 1, g.rows - 1), c1 = Math.min(c0 + 1, g.cols - 1);
  const at = (r, c) => g.deg[r * g.cols + c];
  const v00 = at(r0, c0), v01 = at(r0, c1), v10 = at(r1, c0), v11 = at(r1, c1);
  if (![v00, v01, v10, v11].every(Number.isFinite)) return null;
  const tr = fr - r0, tc = fc - c0;
  return (v00 * (1 - tc) + v01 * tc) * (1 - tr) + (v10 * (1 - tc) + v11 * tc) * tr;
}

/**
 * A TRUE bearing as the controller sees it: magnetic, whole degrees, 0–359.
 * null when the variation is not known yet — a true value is never shown as
 * if it were magnetic; callers print a dash.
 */
function toMagneticDisplay(trueDeg, lat, lon) {
  if (!Number.isFinite(trueDeg)) return null;
  const v = magneticVariationAt(lat, lon);
  if (v == null) return null;
  return Math.round(_normDeg(trueDeg - v)) % 360;
}

/** toMagneticDisplay() as three digits ("045"), or "---" when unknown. */
function magneticText(trueDeg, lat, lon) {
  const m = toMagneticDisplay(trueDeg, lat, lon);
  return m == null ? '---' : String(m).padStart(3, '0');
}

/** Grid convergence at a position (true = grid + γ); null when the theater's projection is unknown. */
function gridConvergenceDeg(lat, lon) {
  const lon0 = _theaterFacts && _theaterFacts.convergence && _theaterFacts.convergence.tmCentralMeridianDeg;
  if (!Number.isFinite(lon0) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return (lon - lon0) * Math.sin(lat * Math.PI / 180);
}

/**
 * A magnetic value a controller typed → true, converted by crc-sync.
 * @returns {Promise<number|null>} null when crc-sync cannot say (no variation, not reachable)
 */
function requestTrueFromMagnetic(magDeg, lat, lon) {
  if (![magDeg, lat, lon].every(Number.isFinite)) return Promise.resolve(null);
  const q = `magDeg=${encodeURIComponent(magDeg)}&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
  return fetch(`/api/magnetic/to-true?${q}`, { headers: _syncAuthHeaders() })
    .then(r => (r.ok ? r.json() : null))
    .then(d => (d && Number.isFinite(d.trueDeg) ? d.trueDeg : null))
    .catch(() => null);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { applyTheaterFacts, currentTheaterFacts, magneticVariationAt, toMagneticDisplay, magneticText, gridConvergenceDeg, requestTrueFromMagnetic };
}
