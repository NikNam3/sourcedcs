'use strict';

// The PAR sample (docs/adr/0112): what a precision approach radar tells the controller working a final about the
// aircraft on it. Pure: no clock, no store, no require of anything stateful. par-monitor.js feeds it the geometry and
// the aircraft's position each tick and keeps the history; ws-hub.js sends the result to the Position that works the
// final, and nobody else.
//
// The geometry of one approach is a REFERENCE POINT and a course: the landing threshold (Facility config `parApproaches`,
// per runway end). The PAR is an airfield feature only (decisions H125, docs/adr/0116): the carrier has none.
// Range is measured ALONG the final approach course from that point (positive on the approach side), height above the
// touchdown zone elevation (TDZE), and the glidepath passes
// over the reference point at the threshold crossing height (TCH) at the glidepath angle (GPA). That is the model the
// approved mockup draws (docs/mockups/par-panel.html rev 4: `gpHeight(r) = TCH + r * tan(GPA)`) and the one JO 7110.65
// 5-12 speaks in ("(number of miles) MILES FROM TOUCHDOWN", deviations above/below glidepath, left/right of course).
//
// Every number in the sample is exact (to 1 ft, 0.01 NM, 0.01 degree): the PAR measures height itself. The 100 ft
// rounding the radar picture applies (presentation.js) is a property of SSR Mode C, not of a PAR.

const FT_PER_M = 3.28084;
const FT_PER_NM = 6076.12;
const M_PER_NM = 1852;
const KT_PER_MS = 1.943844;
const FPM_PER_MS = 196.8504;
const EARTH_R_M = 6371008.8;
const RAD = Math.PI / 180;

/** The keys of one sample entry, in wire order (tools/wire-surface.js records them). */
const SAMPLE_KEYS = Object.freeze(['stripId', 'facilityId', 'positionId', 'approach', 'sensor', 'plot', 'plotAgeMs', 'trail']);
/** The keys of one `approaches` entry of the frame: the approach a final Bay's next aircraft flies (par-monitor.js finalApproaches). */
const FINAL_APPROACH_KEYS = Object.freeze(['facilityId', 'positionId', 'approach']);
/** The keys of `approach`. */
// The four values in force are the controller's where the PAR controller set one (docs/adr/0130, decisions H153), else the
// default; `defaults` holds the four defaults and `set` names the ones a controller set, so the panel can mark them and offer
// "reset to default".
const APPROACH_KEYS = Object.freeze(['id', 'label', 'runwayEnd', 'airportIcao', 'gpaDeg', 'tchFt', 'tdzeFt', 'dhFt', 'daFt', 'courseTrueDeg', 'courseDisplay', 'defaults', 'set']);
/** The keys of `plot` (and of each `trail` entry, which has no gsKt / vsFpm). */
const PLOT_KEYS = Object.freeze(['rangeNm', 'heightFt', 'elevDeg', 'elevDevDeg', 'elevDevFt', 'azDeg', 'azDevFt', 'gsKt', 'vsFpm']);
const TRAIL_KEYS = Object.freeze(['rangeNm', 'heightFt', 'elevDeg', 'elevDevDeg', 'elevDevFt', 'azDeg', 'azDevFt']);
/** Why a scope is INOP. */
const INOP_REASONS = Object.freeze(['NO_APPROACH', 'NO_TDZE']);

const _fin = (v) => typeof v === 'number' && Number.isFinite(v);
const _r = (v, step) => (_fin(v) ? Math.round(v / step) * step + 0 : null); // + 0: never -0 on the wire
const _r2 = (v) => (_fin(v) ? Math.round(v * 100) / 100 + 0 : null);
const _r0 = (v) => (_fin(v) ? Math.round(v) + 0 : null);

/** A point `distM` metres from (lat, lon) on true bearing `brgDeg` (great circle; exact enough for a few hundred metres or 20 NM). */
function offsetPoint(lat, lon, brgDeg, distM) {
  const la = lat * RAD, lo = lon * RAD, b = brgDeg * RAD, dr = distM / EARTH_R_M;
  const la2 = Math.asin(Math.sin(la) * Math.cos(dr) + Math.cos(la) * Math.sin(dr) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(dr) * Math.cos(la), Math.cos(dr) - Math.sin(la) * Math.sin(la2));
  return { lat: la2 / RAD, lon: lo2 / RAD };
}

/**
 * East/north metres of `p` from `ref` on the azimuthal equidistant projection centred on `ref`: the great-circle distance
 * along the initial bearing from `ref`. A radar measures range and angle from where it stands, and this is that, exactly.
 */
function enuM(ref, p) {
  const la1 = ref.lat * RAD, la2 = p.lat * RAD, dLo = (p.lon - ref.lon) * RAD;
  const a = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  const d = 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(a)));
  const brg = Math.atan2(Math.sin(dLo) * Math.cos(la2), Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLo));
  return { e: d * Math.sin(brg), n: d * Math.cos(brg) };
}

/**
 * One measurement of an aircraft against one approach.
 * @param {object} g geometry { refLat, refLon, courseTrueDeg|null, tdzeFt|null, tchFt, gpaDeg }
 * @param {object} p the aircraft { lat, lon, altFt (true MSL, exact), gsMs?, vsMs? }
 * @returns {object} a `plot` (PLOT_KEYS). With no course, range is the straight-line distance and the azimuth is null;
 *   with no TDZE, the height and every elevation figure are null. Past the reference point (range <= 0) there is no
 *   angle, only feet.
 */
function measure(g, p) {
  const v = enuM({ lat: g.refLat, lon: g.refLon }, p);
  let alongM, crossM = null;
  if (_fin(g.courseTrueDeg)) {
    const c = g.courseTrueDeg * RAD;
    // The aircraft flies the course TOWARDS the reference point, so it is on the approach side when its offset points
    // against the course. Right of course (as the pilot sees it) is the course + 90 direction.
    alongM = -(v.e * Math.sin(c) + v.n * Math.cos(c));
    crossM = v.e * Math.cos(c) - v.n * Math.sin(c);
  } else {
    alongM = Math.hypot(v.e, v.n);
  }
  const alongFt = alongM * FT_PER_M;
  const heightFt = _fin(g.tdzeFt) && _fin(p.altFt) ? p.altFt - g.tdzeFt : null;
  const ahead = alongFt > 0;
  let elevDeg = null, elevDevDeg = null, elevDevFt = null;
  if (heightFt !== null) {
    if (ahead) {
      elevDeg = Math.atan2(heightFt - g.tchFt, alongFt) / RAD;
      elevDevDeg = elevDeg - g.gpaDeg;
      elevDevFt = heightFt - (g.tchFt + alongFt * Math.tan(g.gpaDeg * RAD));
    } else {
      elevDevFt = heightFt - g.tchFt; // over or past the threshold: against the crossing height
    }
  }
  const crossFt = crossM === null ? null : crossM * FT_PER_M;
  const azDeg = crossFt !== null && ahead ? Math.atan2(crossFt, alongFt) / RAD : null;
  return {
    rangeNm: _r2(alongM / M_PER_NM),
    heightFt: _r0(heightFt),
    elevDeg: _r2(elevDeg),
    elevDevDeg: _r2(elevDevDeg),
    elevDevFt: _r0(elevDevFt),
    azDeg: _r2(azDeg),
    azDevFt: _r0(crossFt),
    gsKt: _fin(p.gsMs) ? Math.round(p.gsMs * KT_PER_MS) : null,
    vsFpm: _fin(p.vsMs) ? _r(p.vsMs * FPM_PER_MS, 10) : null,
  };
}

/**
 * Is the aircraft inside the PAR's coverage volume? The antenna is modelled at TDZE, `apexBeyondNm` beyond the reference
 * point along the course (a PAR sits beside the touchdown zone, not on the threshold), and covers out to `rangeNm`,
 * `azimuthHalfDeg` either side of the course and `elevationMinDeg` to `elevationMaxDeg` (config/par.json).
 * With no course the azimuth limit is not applied; with no height the elevation limit is not.
 */
function inCoverage(g, p, cov) {
  const v = enuM({ lat: g.refLat, lon: g.refLon }, p);
  const apexFt = cov.apexBeyondNm * FT_PER_NM;
  let alongFt, crossFt = 0;
  if (_fin(g.courseTrueDeg)) {
    const c = g.courseTrueDeg * RAD;
    alongFt = -(v.e * Math.sin(c) + v.n * Math.cos(c)) * FT_PER_M + apexFt;
    crossFt = (v.e * Math.cos(c) - v.n * Math.sin(c)) * FT_PER_M;
  } else {
    alongFt = Math.hypot(v.e, v.n) * FT_PER_M + apexFt;
  }
  if (!(alongFt > 0) || Math.hypot(alongFt, crossFt) > (cov.rangeNm + cov.apexBeyondNm) * FT_PER_NM) return false;
  if (_fin(g.courseTrueDeg) && Math.abs(Math.atan2(crossFt, alongFt) / RAD) > cov.azimuthHalfDeg) return false;
  if (_fin(g.tdzeFt) && _fin(p.altFt)) {
    const el = Math.atan2(p.altFt - g.tdzeFt, alongFt) / RAD;
    if (el < cov.elevationMinDeg || el > cov.elevationMaxDeg) return false;
  }
  return true;
}

/** A trail entry: the plot without the speeds. */
function trailEntry(plot) {
  const out = {};
  for (const k of TRAIL_KEYS) out[k] = plot[k];
  return out;
}

// ── Approach geometry config ───────────────────────────────────────────────

const RUNWAY_APPROACH_KEYS = Object.freeze(['label', 'thresholdLat', 'thresholdLon', 'courseTrueDeg', 'tdzeFt', 'tchFt', 'decisionHeightFt', 'glideslopeDeg']);
const GPA_MIN = 2, GPA_MAX = 4.5;

const _num = (v, lo, hi) => _fin(v) && v >= lo && v <= hi;

/**
 * A Facility's `parApproaches` (optional): runway end -> the PAR approach to it. Every value is [SOURCE-DEFINED], a default
 * the PAR controller may replace at run time (docs/adr/0130, H153). `tdzeFt` null means "the DCS airfield's elevation" (what the aircraft actually fly over);
 * `glideslopeDeg` null means "no published angle": par.json's default applies (H116), and the PAR controller may set its own (docs/adr/0130). Returns a problem string or null.
 * @param {object} cfg the `parApproaches` value
 * @param {string[]} ends every runway end the Facility's `runwayStatus` names
 */
function validateParApproaches(cfg, ends) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return 'parApproaches must be an object keyed by runway end';
  for (const [end, a] of Object.entries(cfg)) {
    if (end.startsWith('_')) continue;
    const at = `parApproaches.${end}`;
    if (!ends.includes(end)) return `${at}: no runway end ${end} in runwayStatus`;
    if (!a || typeof a !== 'object' || Array.isArray(a)) return `${at} must be an object`;
    for (const k of Object.keys(a)) if (!k.startsWith('_') && !RUNWAY_APPROACH_KEYS.includes(k)) return `${at}: unknown key ${k}`;
    if (typeof a.label !== 'string' || !a.label) return `${at}.label must be a non-empty string`;
    if (!_num(a.thresholdLat, -90, 90)) return `${at}.thresholdLat must be a latitude`;
    if (!_num(a.thresholdLon, -180, 180)) return `${at}.thresholdLon must be a longitude`;
    if (!(_fin(a.courseTrueDeg) && a.courseTrueDeg >= 0 && a.courseTrueDeg < 360)) return `${at}.courseTrueDeg must be degrees true in [0, 360)`;
    if (a.tdzeFt !== null && !_num(a.tdzeFt, -1500, 15000)) return `${at}.tdzeFt must be feet MSL or null (the DCS airfield elevation)`;
    if (!_num(a.tchFt, 0, 200)) return `${at}.tchFt must be feet from 0 to 200`;
    if (!_num(a.decisionHeightFt, 50, 1000)) return `${at}.decisionHeightFt must be feet above TDZE from 50 to 1000`;
    if (a.glideslopeDeg !== null && !_num(a.glideslopeDeg, GPA_MIN, GPA_MAX)) return `${at}.glideslopeDeg must be degrees from ${GPA_MIN} to ${GPA_MAX}, or null (no published angle)`;
  }
  return null;
}

// ── Controller-set approach values (docs/adr/0130, decisions H153) ─────────
//
// The PAR controller sets the threshold-relative values of an approach at run time: TDZE, TCH, decision height (DA = TDZE + DH)
// and the glidepath angle. The ranges are OURS (no order gives a range a controller may type): TDZE and TCH as the Facility file
// allows them; DH 100 to 1,000 ft above TDZE (a Category I 200 ft and a lower military PAR minimum both fit); the glidepath angle
// 2.5 to 3.5 degrees, around the usual 3.00 (not quoted from TERPS: ours). Whole feet, hundredths of a degree.
const PAR_VALUE_FIELDS = Object.freeze(['tdzeFt', 'tchFt', 'dhFt', 'gpaDeg']);
const PAR_VALUE_LIMITS = Object.freeze({
  tdzeFt: Object.freeze({ min: -1500, max: 15000, step: 1, unit: 'ft' }),
  tchFt: Object.freeze({ min: 0, max: 200, step: 1, unit: 'ft' }),
  dhFt: Object.freeze({ min: 100, max: 1000, step: 1, unit: 'ft' }),
  gpaDeg: Object.freeze({ min: 2.5, max: 3.5, step: 0.01, unit: 'deg' }),
});

/**
 * One typed value, checked and rounded. `null` (or undefined) clears it: the default applies again.
 * @returns {{ok:true, value:number|null}|{ok:false, reason:'VALIDATION_ERROR', detail:string}}
 */
function validateParValue(field, value) {
  const lim = Object.prototype.hasOwnProperty.call(PAR_VALUE_LIMITS, field) ? PAR_VALUE_LIMITS[field] : null;
  if (!lim) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown PAR approach value ${field} (${PAR_VALUE_FIELDS.join(', ')})` };
  if (value === null || value === undefined) return { ok: true, value: null };
  if (!_fin(value)) return { ok: false, reason: 'VALIDATION_ERROR', detail: `${field} must be a number or null (the default)` };
  const v = lim.step === 1 ? Math.round(value) + 0 : Math.round(value * 100) / 100 + 0;
  if (v < lim.min || v > lim.max) return { ok: false, reason: 'VALIDATION_ERROR', detail: `${field} must be from ${lim.min} to ${lim.max} ${lim.unit}` };
  return { ok: true, value: v };
}

module.exports = {
  PAR_VALUE_FIELDS, PAR_VALUE_LIMITS, validateParValue,
  SAMPLE_KEYS, FINAL_APPROACH_KEYS, APPROACH_KEYS, PLOT_KEYS, TRAIL_KEYS, INOP_REASONS, RUNWAY_APPROACH_KEYS,
  FT_PER_M, FT_PER_NM,
  offsetPoint, measure, inCoverage, trailEntry,
  validateParApproaches,
};
