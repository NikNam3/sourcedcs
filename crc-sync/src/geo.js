'use strict';

// Plain geometry shared by the radar picture and the surveillance layer.

const GROUND_RADIUS_M = 5000;
const GROUND_AGL_M    = 50;

function haversineM(lat1, lon1, lat2, lon2) {
  const R  = 6371000;
  const phi1 = lat1 * Math.PI / 180, phi2 = lat2 * Math.PI / 180;
  const dPhi = (lat2 - lat1) * Math.PI / 180;
  const dLambda = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * An aircraft within 5 km of an airfield and under 50 m above it. A radar
 * masking heuristic (docs/adr/0047), not a definition of "airborne".
 */
function checkOnGround(track, missionData) {
  if (!missionData || !missionData.airports) return false;
  if (track.category !== 1 && track.category !== 2) return false;
  for (const ap of missionData.airports) {
    if (!ap.lat || !ap.lon) continue;
    const distM = haversineM(track.lat, track.lon, ap.lat, ap.lon);
    if (distM < GROUND_RADIUS_M) {
      const agl = track.alt - (ap.elev || 0);
      if (agl < GROUND_AGL_M) return true;
    }
  }
  return false;
}

module.exports = { haversineM, checkOnGround };
