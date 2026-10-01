'use strict';

// Is it night at the ship (docs/adr/0074; ADR 0064 B6, round-1 Q62 default a)?
// §9.12's Case criteria give Case III at night, and the model takes `night` as
// an input. It is derived from the MISSION clock and the ship's position: the
// sun's elevation, by the standard low-precision solar position formulae
// (about a tenth of a degree, far inside what a day/night call needs).
//
// [SOURCE-DEFINED]: "night" is the sun more than 6 degrees below the horizon
// (the end of civil twilight). The guide gives no threshold.

const RAD = Math.PI / 180;
const NIGHT_BELOW_DEG = -6;

/** Solar elevation in degrees at (lat, lon) at `dateMs` (epoch ms, UTC). Null on a non-finite input. */
function solarElevationDeg(latDeg, lonDeg, dateMs) {
  if (![latDeg, lonDeg, dateMs].every(Number.isFinite)) return null;
  const jd = dateMs / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360;                 // mean longitude
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;          // mean anomaly
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD; // ecliptic longitude
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;   // hours
  const lst = ((gmst * 15 + lonDeg) % 360) * RAD;
  const ha = lst - ra;
  const lat = latDeg * RAD;
  const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  return Math.asin(Math.max(-1, Math.min(1, sinEl))) / RAD;
}

/** true / false, or null when it cannot be said (no position or time): the advisory then stays quiet. */
function isNight(latDeg, lonDeg, dateMs) {
  const el = solarElevationDeg(latDeg, lonDeg, dateMs);
  return el == null ? null : el < NIGHT_BELOW_DEG;
}

module.exports = { solarElevationDeg, isNight, NIGHT_BELOW_DEG };
