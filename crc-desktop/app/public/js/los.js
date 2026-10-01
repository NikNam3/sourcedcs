'use strict';

// ── Radar line-of-sight (terrain masking) ───────────────────────────────────
// Reuses elevation.js's MapTiler terrain-RGB tile machinery (elevDecodeTileMeters,
// elevLonLatToTile) to answer "can this radar actually see this point" against
// real terrain, instead of the pure range/beam-angle geometry app.js used to
// rely on alone.
//
// Point elevation lookups are synchronous and cache-only (losElevationAt) so
// they're safe to call from the 50ms sweep loop — a cache miss kicks off a
// background tile fetch and returns null for that call, which callers treat
// as "unknown" and fail open (assume visible) rather than going spuriously
// blind while tiles are still loading.

const LOS_DEM_ZOOM      = 10;   // fixed zoom for terrain sampling, independent of map viewport zoom
const LOS_CACHE_MAX     = 300;  // max decoded tiles kept in memory
const LOS_SAMPLE_COUNT  = 24;   // terrain samples taken along a radar→target path

// Standard radar-horizon approximation: earth curvature + typical atmospheric
// refraction bend the ray back down slightly, modeled as line-of-sight over
// an effective earth 4/3 the true radius.
const EFFECTIVE_EARTH_RADIUS_M = (4 / 3) * 6371000;

const losGridCache      = new Map(); // "z/x/y" → { grid, n, min, max } (meters)
const losFetchInFlight  = new Set();

function losFetchTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (losGridCache.has(key) || losFetchInFlight.has(key)) return;
  losFetchInFlight.add(key);
  elevDecodeTileMeters(z, x, y)
    .then(result => {
      losGridCache.set(key, result);
      if (losGridCache.size > LOS_CACHE_MAX) {
        losGridCache.delete(losGridCache.keys().next().value);
      }
    })
    .catch(() => {}) // ocean/out-of-range tiles or network errors — stays uncached, keeps failing open
    .finally(() => losFetchInFlight.delete(key));
}

function losBilinear(grid, n, px, py) {
  const x0 = Math.min(Math.max(Math.floor(px), 0), n - 1);
  const y0 = Math.min(Math.max(Math.floor(py), 0), n - 1);
  const x1 = Math.min(x0 + 1, n - 1);
  const y1 = Math.min(y0 + 1, n - 1);
  const fx = px - x0, fy = py - y0;
  const v00 = grid[y0 * n + x0], v10 = grid[y0 * n + x1];
  const v01 = grid[y1 * n + x0], v11 = grid[y1 * n + x1];
  const top = v00 + (v10 - v00) * fx;
  const bot = v01 + (v11 - v01) * fx;
  return top + (bot - top) * fy;
}

// Synchronous, cache-only terrain height lookup in meters — returns null
// (and starts a background fetch) if the covering tile isn't cached yet.
function losElevationAt(lon, lat) {
  const [xf, yf] = elevLonLatToTile(lon, lat, LOS_DEM_ZOOM);
  const tx = Math.floor(xf), ty = Math.floor(yf);
  const key = `${LOS_DEM_ZOOM}/${tx}/${ty}`;
  const cached = losGridCache.get(key);
  if (!cached) {
    losFetchTile(LOS_DEM_ZOOM, tx, ty);
    return null;
  }
  const { grid, n } = cached;
  return losBilinear(grid, n, (xf - tx) * n, (yf - ty) * n);
}

// Straight sight-line height at distance d along a path of total length D,
// between two points at radarAltM/targetAltM, minus the earth-curvature bulge.
function losSightLineHeightM(radarAltM, targetAltM, d, D) {
  if (D <= 0) return radarAltM;
  const straight = radarAltM + (targetAltM - radarAltM) * (d / D);
  const bulge = (d * (D - d)) / (2 * EFFECTIVE_EARTH_RADIUS_M);
  return straight - bulge;
}

// samples: [{ d, terrainM }, ...]. True if any sample's terrain pokes above
// the sight line at that point.
function losProfileBlocked(samples, radarAltM, targetAltM, D) {
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
function losVisibleRangeM(radar, bearing, maxRangeM) {
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
function losBeamProfile(radar, bearing, maxRangeM, steps = 40) {
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    EFFECTIVE_EARTH_RADIUS_M,
    LOS_SAMPLE_COUNT,
    losSightLineHeightM,
    losProfileBlocked,
  };
}
