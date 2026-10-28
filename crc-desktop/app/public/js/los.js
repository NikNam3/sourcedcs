'use strict';
import { bearingDeg, haversineM, projectPos } from './geo.js';
import { terrainHeightAt } from './terrain-grid.js';

// ── Radar line-of-sight (terrain masking), for the radar-debug overlay and the LOS profile chart only ──────────
// The heights are the theater's DCS grid (terrain-grid.js, crc-sync docs/adr/0133), the same file crc-sync masks with,
// so this explains the server's answer from the same terrain. No grid: every lookup is null ("unknown"), and callers
// fail open (assume visible). Nothing here fetches anything.

export const LOS_SAMPLE_COUNT  = 24;   // terrain samples taken along a radar→target path

// Standard radar-horizon approximation: earth curvature + typical atmospheric
// refraction bend the ray back down slightly, modeled as line-of-sight over
// an effective earth 4/3 the true radius.
export const EFFECTIVE_EARTH_RADIUS_M = (4 / 3) * 6371000;

// Synchronous terrain height in meters, or null where it is not known.
function losElevationAt(lon, lat) {
  return terrainHeightAt(lat, lon);
}

// Straight sight-line height at distance d along a path of total length D,
// between two points at radarAltM/targetAltM, minus the earth-curvature bulge.
export function losSightLineHeightM(radarAltM, targetAltM, d, D) {
  if (D <= 0) return radarAltM;
  const straight = radarAltM + (targetAltM - radarAltM) * (d / D);
  const bulge = (d * (D - d)) / (2 * EFFECTIVE_EARTH_RADIUS_M);
  return straight - bulge;
}

// samples: [{ d, terrainM }, ...]. True if any sample's terrain pokes above
// the sight line at that point.
export function losProfileBlocked(samples, radarAltM, targetAltM, D) {
  for (const { d, terrainM } of samples) {
    if (terrainM > losSightLineHeightM(radarAltM, targetAltM, d, D)) return true;
  }
  return false;
}

// Returns true (clear), false (blocked), or 'unknown' (terrain data for at
// least one sample point isn't cached yet — callers should fail open).
function losHasLineOfSight(radarLat, radarLon, radarAltM, targetLat, targetLon, targetAltM) {
  const D = haversineM(radarLat, radarLon, targetLat, targetLon);
  if (D <= 0) return true;
  const bearing = bearingDeg(radarLat, radarLon, targetLat, targetLon);

  const samples = [];
  for (let i = 1; i <= LOS_SAMPLE_COUNT; i++) {
    const d = (D * i) / (LOS_SAMPLE_COUNT + 1);
    const [lat, lon] = projectPos(radarLat, radarLon, bearing, d);
    const terrainM = losElevationAt(lon, lat);
    if (terrainM == null) return 'unknown';
    samples.push({ d, terrainM });
  }
  return !losProfileBlocked(samples, radarAltM, targetAltM, D);
}

// Ground-hugging horizon scan along one bearing, for the radar-debug beam
// overlay: how far out can this radar see anything at ground level before
// terrain blocks the rest of the beam? Reuses losHasLineOfSight against the
// terrain height at each candidate distance as the "target".
export function losVisibleRangeM(radar, bearing, maxRangeM) {
  for (let i = 1; i <= LOS_SAMPLE_COUNT; i++) {
    const d = (maxRangeM * i) / LOS_SAMPLE_COUNT;
    const [lat, lon] = projectPos(radar.lat, radar.lon, bearing, d);
    const terrainM = losElevationAt(lon, lat);
    if (terrainM == null) continue; // unknown — fail open, keep walking rather than truncating
    if (losHasLineOfSight(radar.lat, radar.lon, radar.elevM, lat, lon, terrainM) === false) return d;
  }
  return maxRangeM;
}

// Terrain profile + a reference sight line along one bearing, for the LOS
// profile debug chart (panels/los-panel.js). The reference line runs from the radar to a
// hypothetical grazing target at the terrain height found at maxRangeM — it
// answers "could this radar graze the ground all the way to its nominal
// range," the same question losVisibleRangeM answers for the map beam, just
// rendered as one continuous curve instead of a single truncation point.
export function losBeamProfile(radar, bearing, maxRangeM, steps = 40) {
  const [farLat, farLon] = projectPos(radar.lat, radar.lon, bearing, maxRangeM);
  const farTerrainM = losElevationAt(farLon, farLat);
  const targetAltM = farTerrainM == null ? radar.elevM : farTerrainM;

  const points = [];
  for (let i = 0; i <= steps; i++) {
    const d = (maxRangeM * i) / steps;
    const [lat, lon] = projectPos(radar.lat, radar.lon, bearing, d);
    points.push({
      d,
      terrainM: losElevationAt(lon, lat),
      sightM: losSightLineHeightM(radar.elevM, targetAltM, d, maxRangeM),
    });
  }

  return { points, targetAltM, blockedAtM: losVisibleRangeM(radar, bearing, maxRangeM) };
}
