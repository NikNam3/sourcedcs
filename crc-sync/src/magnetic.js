'use strict';

// Magnetic variation and grid convergence (docs/adr/0085). Pure functions.
//
// Three north references meet in crc-sync, and every displayed heading,
// course, bearing and radial is MAGNETIC (decisions.md H15, H69):
//
//   true      what lat/lon maths gives (bearings between two positions).
//   grid      what DCS-gRPC's `heading`/`course` give: DCS's flat-world grid
//             north, a Transverse Mercator projection per theater.
//             true = grid + convergence.
//   magnetic  what a controller reads and types.
//             magnetic = true − variation (variation positive EAST).
//
// VARIATION comes from the World Magnetic Model, WMM2025, evaluated at the
// position and the MISSION date (decisions.md H69), unless the theater sets an
// override in config/theaters.json:
//   { "magneticVariation": { "fixedDeg": 5 } }    one value for the whole map
//   { "magneticVariation": { "offsetDeg": 0.5 } } the model, plus a squadron correction
//
// WMM2025. Coefficients: NOAA NCEI / British Geological Survey, "The US/UK
// World Magnetic Model for 2025-2030", WMM2025COF.zip, WMM.COF header
// "2025.0 WMM-2025 11/13/2024", shipped verbatim as data/wmm/WMM2025.COF
// (https://www.ncei.noaa.gov/products/world-magnetic-model). The synthesis
// follows the WMM2025 Technical Report (NOAA NCEI, Dec 2024) §1.2 equations
// 7–19: geodetic → geocentric, Schmidt semi-normalised associated Legendre
// functions, field in geocentric frame, rotated back to geodetic. Checked
// against NCEI's official test values (tests/magnetic.test.mjs). US Government
// work, public domain.
//
// Outside the model's validity window (2025.0–2030.0) the secular variation is
// extrapolated linearly, as the reference software does. A mission dated 2016
// therefore reads a variation that is not the 2016 IGRF value — typically a few
// tenths of a degree off over DCS's theaters. `modelDateValid` says so; a
// theater that needs better sets an override.
//
// CONVERGENCE is the first-order Transverse Mercator formula the client has
// used since geo.js's gridConvergenceDeg (crc-desktop/app/public/js/
// magnetic.js now), γ = (lon − lon0)·sin(lat), with lon0 the theater
// projection's central meridian (config/theaters.json `tmCentralMeridianDeg`,
// mirroring tools/miztoyaml/projection.py). Accurate to a small fraction of a
// degree across a DCS map. A theater with no central meridian has unknown
// convergence (null), never 0.

const fs = require('fs');
const path = require('path');

const COF_PATH = path.join(__dirname, '..', 'data', 'wmm', 'WMM2025.COF');

// WGS-84 and the WMM's reference radius (Technical Report Table 1).
const WGS84_A  = 6378.137;             // km
const WGS84_F  = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const WMM_RE   = 6371.2;               // km, geomagnetic reference radius

const DEG = Math.PI / 180;

/**
 * Parses a WMM.COF file.
 * @param {string} text
 * @returns {{ epoch:number, name:string, nMax:number, g:number[][], h:number[][], gDot:number[][], hDot:number[][] }}
 */
function parseCof(text) {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const [epochStr, name] = lines[0].split(/\s+/);
  const epoch = Number(epochStr);
  if (!Number.isFinite(epoch)) throw new Error('WMM.COF: no epoch in the header');
  const rows = [];
  for (const line of lines.slice(1)) {
    if (/^9{10,}/.test(line)) break;
    const p = line.split(/\s+/).map(Number);
    if (p.length < 6 || p.some(x => !Number.isFinite(x))) throw new Error(`WMM.COF: bad line "${line}"`);
    rows.push(p);
  }
  const nMax = Math.max(...rows.map(r => r[0]));
  const grid = () => Array.from({ length: nMax + 1 }, () => new Array(nMax + 1).fill(0));
  const g = grid(), h = grid(), gDot = grid(), hDot = grid();
  for (const [n, m, gv, hv, gd, hd] of rows) { g[n][m] = gv; h[n][m] = hv; gDot[n][m] = gd; hDot[n][m] = hd; }
  return { epoch, name, nMax, g, h, gDot, hDot };
}

let _model = null;
/** The shipped WMM2025 model, read once on first use (P5: never written). */
function wmmModel() {
  if (!_model) _model = parseCof(fs.readFileSync(COF_PATH, 'utf8'));
  return _model;
}

/** Epoch ms → decimal year (UTC). */
function decimalYear(dateMs) {
  const d = new Date(dateMs);
  const y = d.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  return y + (dateMs - start) / (end - start);
}

/**
 * The WMM field at a point. Geodetic latitude/longitude in degrees, height
 * above the WGS-84 ellipsoid in km, time as a decimal year.
 * @returns {{ x:number, y:number, z:number, declination:number }} nT north/east/down; declination degrees, east positive
 */
function wmmField(latDeg, lonDeg, heightKm, year, model = wmmModel()) {
  const { nMax, g, h, gDot, hDot, epoch } = model;
  const dt = year - epoch;

  // Geodetic → geocentric spherical (report eq. 7–8).
  const phi = latDeg * DEG;
  const lambda = lonDeg * DEG;
  const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
  const rc = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  const p = (rc + heightKm) * cosPhi;
  const zc = (rc * (1 - WGS84_E2) + heightKm) * sinPhi;
  const r = Math.hypot(p, zc);
  const phiC = Math.asin(zc / r);

  // Schmidt semi-normalised P(n,m)(cos θ) and dP/dθ, θ = geocentric colatitude.
  const cosT = Math.sin(phiC);
  const sinT = Math.max(Math.cos(phiC), 1e-12); // the geographic pole: keep Y finite
  const P  = Array.from({ length: nMax + 1 }, () => new Array(nMax + 1).fill(0));
  const dP = Array.from({ length: nMax + 1 }, () => new Array(nMax + 1).fill(0));
  P[0][0] = 1;
  for (let n = 1; n <= nMax; n++) {
    // Sectoral term: n = m.
    const k = n === 1 ? 1 : Math.sqrt((2 * n - 1) / (2 * n));
    P[n][n]  = k * sinT * P[n - 1][n - 1];
    dP[n][n] = k * (cosT * P[n - 1][n - 1] + sinT * dP[n - 1][n - 1]);
    for (let m = 0; m < n; m++) {
      const a = Math.sqrt(n * n - m * m);
      const b = n >= 2 ? Math.sqrt((n - 1) * (n - 1) - m * m) : 0;
      const p2  = n >= 2 ? P[n - 2][m] : 0;
      const dp2 = n >= 2 ? dP[n - 2][m] : 0;
      P[n][m]  = ((2 * n - 1) * cosT * P[n - 1][m] - b * p2) / a;
      dP[n][m] = ((2 * n - 1) * (cosT * dP[n - 1][m] - sinT * P[n - 1][m]) - b * dp2) / a;
    }
  }

  // Field in geocentric north/east/down (report eq. 10–12).
  let xc = 0, yc = 0, zcF = 0;
  const ratio = WMM_RE / r;
  let rn = ratio * ratio; // (a/r)^(n+2) for n = 0
  for (let n = 1; n <= nMax; n++) {
    rn *= ratio;
    for (let m = 0; m <= n; m++) {
      const gt = g[n][m] + dt * gDot[n][m];
      const ht = h[n][m] + dt * hDot[n][m];
      const cm = Math.cos(m * lambda), sm = Math.sin(m * lambda);
      const gc = gt * cm + ht * sm;
      xc  += rn * gc * dP[n][m];
      yc  += rn * m * (gt * sm - ht * cm) * P[n][m] / sinT;
      zcF -= rn * (n + 1) * gc * P[n][m];
    }
  }

  // Rotate back to geodetic (report eq. 17).
  const psi = phiC - phi;
  const x = xc * Math.cos(psi) - zcF * Math.sin(psi);
  const z = xc * Math.sin(psi) + zcF * Math.cos(psi);
  return { x, y: yc, z, declination: Math.atan2(yc, x) / DEG };
}

/** → [0, 360); non-finite → null. */
function normDeg(deg) {
  if (typeof deg !== 'number' || !Number.isFinite(deg)) return null;
  const n = ((deg % 360) + 360) % 360;
  return n === 360 ? 0 : n;
}

/** Whether a date is inside the model's published validity window. */
function modelDateValid(dateMs, model = wmmModel()) {
  const y = decimalYear(dateMs);
  return y >= model.epoch && y < model.epoch + 5;
}

/**
 * Magnetic variation (declination) at sea level, degrees, EAST positive.
 * @param {number} lat
 * @param {number} lon
 * @param {number} dateMs  the MISSION date (epoch ms, mission clock), not the wall date
 * @param {{fixedDeg?:number, offsetDeg?:number}} [override] the theater's `magneticVariation`
 * @returns {number|null} null when lat/lon/date are not usable
 */
function variationAt(lat, lon, dateMs, override = null) {
  if (override && Number.isFinite(override.fixedDeg)) return override.fixedDeg;
  if (![lat, lon, dateMs].every(Number.isFinite) || Math.abs(lat) > 90) return null;
  const d = wmmField(lat, lon, 0, decimalYear(dateMs)).declination;
  return override && Number.isFinite(override.offsetDeg) ? d + override.offsetDeg : d;
}

/** Which rule `variationAt` applies for this override — shown to controllers, and in logs. */
function variationSource(override) {
  if (override && Number.isFinite(override.fixedDeg)) return 'FIXED';
  if (override && Number.isFinite(override.offsetDeg)) return 'WMM2025+OFFSET';
  return 'WMM2025';
}

/**
 * Grid convergence γ, degrees: true = grid + γ (positive when grid north lies
 * east of true north — the same sign as efsp/carrier/angles.js gridToTrue).
 * @param {number} lat
 * @param {number} lon
 * @param {{tmCentralMeridianDeg?:number}|null} theater the theater's config/theaters.json entry
 * @returns {number|null} null when the theater's projection is unknown
 */
function convergenceAt(lat, lon, theater) {
  const lon0 = theater && theater.tmCentralMeridianDeg;
  if (!Number.isFinite(lon0) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return (lon - lon0) * Math.sin(lat * DEG);
}

/** True → magnetic. Unknown variation → null: a true value is never passed off as magnetic. */
function trueToMagnetic(trueDeg, variationDeg) {
  if (!Number.isFinite(variationDeg)) return null;
  return normDeg(trueDeg - variationDeg);
}

/** Magnetic → true, for anything a controller TYPES (decisions S-R2-12: on the server, never the client). */
function magneticToTrue(magDeg, variationDeg) {
  if (!Number.isFinite(variationDeg)) return null;
  return normDeg(magDeg + variationDeg);
}

module.exports = {
  wmmModel, wmmField, decimalYear, modelDateValid,
  variationAt, variationSource, convergenceAt,
  trueToMagnetic, magneticToTrue, normDeg,
  COF_PATH,
};
