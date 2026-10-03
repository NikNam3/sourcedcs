'use strict';

// Coordinate text for the airspace editor and the map readout (AP2B-Q2, H102): a per-user setting picks DMS, DM or MGRS
// for display; input accepts all three (and decimal degrees) whatever the setting is. Pure: no DOM, no state.
// Stored values are always WGS84 decimal degrees (docs/adr/0098 §5).
//
// MGRS is written by hand (UTM by the Krueger series, ~1 mm; zones 1-60 and bands C-X, no polar UPS and no Norway/Svalbard
// exceptions: no DCS theater is there). tests/coords.test.mjs checks it against reference points.

export const COORD_FORMATS = ['DMS', 'DM', 'MGRS'];
export const DEFAULT_COORD_FORMAT = 'DM';

const round6 = (x) => Math.round(x * 1e6) / 1e6;

// ── DMS / DM / decimal ──────────────────────────────────────────────────────────────────────────

const pad = (n, w) => String(n).padStart(w, '0');

function _split(abs, sub) { // abs degrees -> {deg, min, sec} with carry
  let deg = Math.floor(abs);
  let rest = (abs - deg) * 60;
  if (sub === 'DM') {
    let min = Math.round(rest * 10) / 10;
    if (min >= 60) { deg += 1; min = 0; }
    return { deg, min };
  }
  let min = Math.floor(rest);
  let sec = Math.round((rest - min) * 60 * 10) / 10;
  if (sec >= 60) { sec = 0; min += 1; }
  if (min >= 60) { min = 0; deg += 1; }
  return { deg, min, sec };
}

/** `N37 21.0` (DM) or `N37 21 00.0` (DMS). axis 'lat' | 'lon'. */
export function formatComponent(value, axis, format = DEFAULT_COORD_FORMAT) {
  const hemi = axis === 'lat' ? (value < 0 ? 'S' : 'N') : (value < 0 ? 'W' : 'E');
  const abs = Math.abs(value);
  const w = axis === 'lat' ? 2 : 3;
  if (format === 'DMS') {
    const { deg, min, sec } = _split(abs, 'DMS');
    return `${hemi}${pad(deg, w)} ${pad(min, 2)} ${pad(sec.toFixed(1), 4)}`;
  }
  const { deg, min } = _split(abs, 'DM');
  return `${hemi}${pad(deg, w)} ${pad(min.toFixed(1), 4)}`;
}

/** One component: 36.5, -36.5, N36 30, 36 30 00 N, N36°12'30.5", 036:45:00E. Returns {value, hemi} or null. */
export function parseComponent(str) {
  const s = String(str == null ? '' : str).toUpperCase().trim();
  if (!s) return null;
  const letters = s.match(/[NSEW]/g) || [];
  if (letters.length > 1) return null;
  if (/[^\d.\s°'′"″:+\-NSEW]/.test(s)) return null;
  const hemi = letters[0] || null;
  const nums = s.replace(/[NSEW]/g, ' ').match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length > 3) return null;
  const neg = nums[0].charAt(0) === '-';
  const deg = parseFloat(nums[0]);
  const min = nums.length > 1 ? parseFloat(nums[1]) : 0;
  const sec = nums.length > 2 ? parseFloat(nums[2]) : 0;
  if (nums.length > 1 && (min < 0 || min >= 60)) return null;
  if (nums.length > 2 && (sec < 0 || sec >= 60)) return null;
  const abs = Math.abs(deg) + min / 60 + sec / 3600;
  let value = neg ? -abs : abs;
  if (hemi === 'S' || hemi === 'W') value = -Math.abs(value);
  return { value: round6(value), hemi };
}

/** One cell of a coordinate table. axis 'lat' | 'lon'; null when it does not parse or is out of range. */
export function parseCoord(str, axis) {
  const c = parseComponent(str);
  if (!c) return null;
  if (c.hemi && ((axis === 'lat') !== (c.hemi === 'N' || c.hemi === 'S'))) return null;
  return Math.abs(c.value) <= (axis === 'lat' ? 90 : 180) ? c.value : null;
}

function _parseDegreePair(line) {
  const s = line.replace(/[,;]/g, ' ').trim();
  let lat = null; let lon = null;
  if (/[NSEW]/.test(s)) {
    const re = /([NSEW])\s*([\d.\s°'′"″:]+)|([\d.\s°'′"″:]+?)\s*([NSEW])/g;
    const comps = []; let m;
    while ((m = re.exec(s))) comps.push(m[1] ? `${m[1]} ${m[2]}` : `${m[3]} ${m[4]}`);
    if (comps.length !== 2) return null;
    for (const comp of comps) {
      const c = parseComponent(comp);
      if (!c) return null;
      if (c.hemi === 'N' || c.hemi === 'S') { if (lat !== null) return null; lat = c.value; } else { if (lon !== null) return null; lon = c.value; }
    }
  } else {
    const nums = s.match(/-?\d+(?:\.\d+)?/g);
    if (!nums) return null;
    if (nums.length === 2) { lat = round6(parseFloat(nums[0])); lon = round6(parseFloat(nums[1])); }
    else if (nums.length === 6 || nums.length === 4) {
      const h = nums.length / 2;
      const a = parseComponent(nums.slice(0, h).join(' ')); const b = parseComponent(nums.slice(h).join(' '));
      if (!a || !b) return null;
      lat = a.value; lon = b.value;
    } else return null;
  }
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lat, lon];
}

// ── MGRS ────────────────────────────────────────────────────────────────────────────────────────

const A = 6378137; const F = 1 / 298.257223563; const K0 = 0.9996;
const N_ = F / (2 - F);
const E2 = F * (2 - F);
const BANDS = 'CDEFGHJKLMNPQRSTUVWX';
const COL_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const ROW_LETTERS = 'ABCDEFGHJKLMNPQRSTUV';
const rad = Math.PI / 180;

const _A_ = (A / (1 + N_)) * (1 + N_ ** 2 / 4 + N_ ** 4 / 64);
const ALPHA = [N_ / 2 - (2 / 3) * N_ ** 2 + (5 / 16) * N_ ** 3, (13 / 48) * N_ ** 2 - (3 / 5) * N_ ** 3, (61 / 240) * N_ ** 3];
const BETA = [N_ / 2 - (2 / 3) * N_ ** 2 + (37 / 96) * N_ ** 3, N_ ** 2 / 48 + N_ ** 3 / 15, (17 / 480) * N_ ** 3];

export function zoneOf(lon) { return Math.min(60, Math.floor((lon + 180) / 6) + 1); }
export function bandOf(lat) { return BANDS[Math.min(19, Math.max(0, Math.floor((lat + 80) / 8)))]; }

/** WGS84 -> UTM {zone, hemisphere:'N'|'S', easting, northing} (metres). */
export function toUtm(lat, lon) {
  const zone = zoneOf(lon);
  const lon0 = ((zone - 1) * 6 - 180 + 3) * rad;
  const phi = lat * rad; const dl = lon * rad - lon0;
  const e = Math.sqrt(E2);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
  const xi = Math.atan2(t, Math.cos(dl));
  const eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let x = eta; let y = xi;
  for (let j = 1; j <= 3; j++) {
    x += ALPHA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    y += ALPHA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  return { zone, hemisphere: lat < 0 ? 'S' : 'N', easting: 500000 + K0 * _A_ * x, northing: K0 * _A_ * y + (lat < 0 ? 10000000 : 0) };
}

/** UTM -> [lat, lon]. */
export function fromUtm({ zone, hemisphere, easting, northing }) {
  const x = (easting - 500000) / (K0 * _A_);
  const y = (northing - (hemisphere === 'S' ? 10000000 : 0)) / (K0 * _A_);
  let xi = y; let eta = x;
  for (let j = 1; j <= 3; j++) {
    xi -= BETA[j - 1] * Math.sin(2 * j * y) * Math.cosh(2 * j * x);
    eta -= BETA[j - 1] * Math.cos(2 * j * y) * Math.sinh(2 * j * x);
  }
  const chi = Math.asin(Math.sin(xi) / Math.cosh(eta));
  const e = Math.sqrt(E2);
  // conformal latitude -> geodetic by iteration
  let phi = chi;
  for (let i = 0; i < 8; i++) phi = Math.asin(Math.tanh(Math.atanh(Math.sin(chi)) + e * Math.atanh(e * Math.sin(phi))));
  const lon0 = ((zone - 1) * 6 - 180 + 3);
  const lon = lon0 + Math.atan2(Math.sinh(eta), Math.cos(xi)) / rad;
  return [phi / rad, lon];
}

/** `36S XC 52345 12345` style, precision 1..5 digits per axis (5 = 1 m). null outside 80S-84N. */
export function toMgrs(lat, lon, precision = 5) {
  if (!(lat >= -80 && lat <= 84)) return null;
  const u = toUtm(lat, lon);
  const e = Math.floor(u.easting); const n = Math.floor(u.northing);
  const set = (u.zone - 1) % 3;
  const col = COL_SETS[set][Math.floor(e / 100000) - 1];
  const row = ROW_LETTERS[(Math.floor(n / 100000) + (u.zone % 2 === 0 ? 5 : 0)) % 20];
  const cut = 10 ** (5 - precision);
  const digits = (v) => pad(Math.floor((v % 100000) / cut), precision);
  return `${pad(u.zone, 2)}${bandOf(lat)} ${col}${row} ${digits(e)} ${digits(n)}`;
}

/** Parse an MGRS string (spaces optional) to [lat, lon] at the centre of the cell; null if malformed. */
export function fromMgrs(text) {
  const m = String(text || '').toUpperCase().replace(/\s+/g, '').match(/^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z])([A-HJ-NP-V])(\d*)$/);
  if (!m) return null;
  const zone = Number(m[1]);
  if (zone < 1 || zone > 60 || m[5].length % 2 || m[5].length > 10) return null;
  const col = COL_SETS[(zone - 1) % 3].indexOf(m[3]);
  if (col < 0) return null;
  const prec = m[5].length / 2;
  const cell = 10 ** (5 - prec);
  const eDigits = prec ? Number(m[5].slice(0, prec)) * cell : 0;
  const nDigits = prec ? Number(m[5].slice(prec)) * cell : 0;
  const easting = (col + 1) * 100000 + eDigits + cell / 2;
  const hemisphere = BANDS.indexOf(m[2]) >= BANDS.indexOf('N') ? 'N' : 'S';
  const rowIdx = (ROW_LETTERS.indexOf(m[4]) - (zone % 2 === 0 ? 5 : 0) + 20) % 20;
  // the northing is known mod 2,000,000; pick the one inside the latitude band
  const bandMinLat = -80 + 8 * BANDS.indexOf(m[2]);
  const minN = toUtm(Math.max(bandMinLat, -80), 3 + (zone - 1) * 6 - 180 + 0).northing;
  let northing = rowIdx * 100000 + nDigits + cell / 2;
  const floor = minN - 100000;
  while (northing < floor) northing += 2000000;
  const out = fromUtm({ zone, hemisphere, easting, northing });
  if (bandOf(out[0]) !== m[2]) return null;
  return [round6(out[0]), round6(out[1])];
}

// ── the pair, in any format ─────────────────────────────────────────────────────────────────────

/** A position as text in `format` ('DMS' | 'DM' | 'MGRS'). MGRS falls back to DM outside its range. */
export function formatPair(lat, lon, format = DEFAULT_COORD_FORMAT) {
  if (format === 'MGRS') { const m = toMgrs(lat, lon); if (m) return m; format = 'DM'; }
  return `${formatComponent(lat, 'lat', format)} ${formatComponent(lon, 'lon', format)}`;
}

/** Read "lat lon" in decimal, DM, DMS or MGRS. Returns [lat, lon] or null. */
export function parsePair(text) {
  const line = String(text == null ? '' : text).toUpperCase().trim();
  if (!line) return null;
  const mg = fromMgrs(line);
  if (mg) return mg;
  return _parseDegreePair(line);
}

/** One point per line -> { points, badLines: [1-based] }. */
export function parsePoints(text) {
  const points = []; const badLines = [];
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const p = parsePair(line);
    if (p) points.push(p); else badLines.push(i + 1);
  });
  return { points, badLines };
}

/** The format a stored setting names, or the default. */
export function coordFormatOf(setting) { return COORD_FORMATS.includes(setting) ? setting : DEFAULT_COORD_FORMAT; }
