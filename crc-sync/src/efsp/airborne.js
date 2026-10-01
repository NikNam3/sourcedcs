'use strict';

// What "detected airborne" means (docs/adr/0076; guide §10.3, §10.4).
//
// Pure: a track, the airports and the thresholds in, a phase out. The
// debounce (`holdSec`) is the caller's, because it needs a memory per flight.
//
//   AIRBORNE   an aircraft, at least `minGroundSpeedKt`, and at least
//              `minAglFt` above the nearest airfield when within its footprint
//              (beyond every footprint height is unknown, speed alone decides).
//   ON_GROUND  geo.js's checkOnGround: within 5 km of an airfield and under
//              50 m above it. Where a radar would mask it.
//   UNKNOWN    everything else, including the band between the two.

const { checkOnGround, haversineM } = require('../geo');

const MS_PER_KT = 0.514444;
const M_PER_FT = 0.3048;
const FOOTPRINT_M = 5000; // geo.js GROUND_RADIUS_M — kept in step with it, see the test

const PHASES = Object.freeze({ AIRBORNE: 'AIRBORNE', ON_GROUND: 'ON_GROUND', UNKNOWN: 'UNKNOWN' });

/** The elevation (m) of the airfield whose footprint holds the track, or null when it holds none. */
function footprintElevationM(track, missionData) {
  const airports = (missionData && missionData.airports) || [];
  let best = null;
  for (const ap of airports) {
    if (!ap.lat || !ap.lon) continue;
    const d = haversineM(track.lat, track.lon, ap.lat, ap.lon);
    if (d < FOOTPRINT_M && (best === null || d < best.d)) best = { d, elev: ap.elev || 0 };
  }
  return best ? best.elev : null;
}

/**
 * The instantaneous phase of one track. No memory: a single sample.
 * @returns {'AIRBORNE'|'ON_GROUND'|'UNKNOWN'}
 */
function instantPhase(track, missionData, cfg) {
  if (!track || (track.category !== 1 && track.category !== 2)) return PHASES.UNKNOWN;
  if (checkOnGround(track, missionData)) return PHASES.ON_GROUND;
  if (!Number.isFinite(track.groundSpeed) || track.groundSpeed < cfg.minGroundSpeedKt * MS_PER_KT) return PHASES.UNKNOWN;
  const elev = footprintElevationM(track, missionData);
  if (elev !== null) {
    if (!Number.isFinite(track.alt) || track.alt - elev < cfg.minAglFt * M_PER_FT) return PHASES.UNKNOWN;
  }
  return PHASES.AIRBORNE;
}

/**
 * The debounced phase. `mem` is per flight and mutated; AIRBORNE is only
 * reported once it has held for `holdSec` without a break, ON_GROUND and
 * UNKNOWN at once (UNKNOWN is what ends an episode, so it must not lag).
 * @returns {{phase:string, since:number|null}} `since` is when the current
 *   unbroken run of this instant phase began.
 */
function debouncedPhase(mem, instant, now, cfg) {
  if (mem.instant !== instant) { mem.instant = instant; mem.since = now; }
  if (instant === PHASES.AIRBORNE && now - mem.since < cfg.holdSec * 1000) return { phase: PHASES.UNKNOWN, since: mem.since };
  return { phase: instant, since: mem.since };
}

module.exports = { PHASES, instantPhase, debouncedPhase, };
