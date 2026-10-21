'use strict';

// Terrain elevation and radar line-of-sight, server-side (docs/adr/0044, 0133).
//
// The heights are DCS's own: `npm run terrain:build` (tools/terrain/) samples DCS's height call over a theater once and
// writes one cache file per theater and spacing (src/terrain-grid.js). This store only READS that file, when a mission
// on that theater loads. Nothing here, and nothing a running crc-sync does, asks DCS or any web service for terrain
// (tests/terrain-no-dcs.test.mjs): no cache for the theater means one log line and every radar sees to its full range,
// which is the fail-open rule below.
//
// The LOS math is unchanged from crc-desktop's los.js (docs/adr/0042): 24 samples along the path, the 4/3-earth
// curvature model. `losSightLineHeightM` and `losProfileBlocked` are byte-for-byte the client's functions; a test of
// each lives in both packages (tests/terrain.test.mjs here, crc-desktop/tests/los-math.test.mjs).
//
// `hasLineOfSight` answers 'unknown' when no grid is loaded or a sample falls outside it, and every caller treats that
// as visible. Going spuriously blind is worse than seeing slightly too much.

const fs = require('fs');

const { haversineM } = require('./geo');
const { decodeGrid, terrainCacheDir, findCacheFile } = require('./terrain-grid');
const log = require('./log').logger('terrain');

const LOS_SAMPLE_COUNT = 24;

// Earth curvature plus typical atmospheric refraction bend the ray back down
// slightly, modelled as line of sight over an effective earth 4/3 the true
// radius. Standard radar-horizon approximation.
const EFFECTIVE_EARTH_RADIUS_M = (4 / 3) * 6371000;

// ── pure geometry (ported verbatim; covered by tests/terrain.test.mjs) ──────

/**
 * Straight sight-line height at distance d along a path of total length D,
 * between two points at radarAltM/targetAltM, minus the earth-curvature bulge.
 */
function losSightLineHeightM(radarAltM, targetAltM, d, D) {
  if (D <= 0) return radarAltM;
  const straight = radarAltM + (targetAltM - radarAltM) * (d / D);
  const bulge = (d * (D - d)) / (2 * EFFECTIVE_EARTH_RADIUS_M);
  return straight - bulge;
}

/** samples: [{ d, terrainM }]. True if any sample's terrain pokes above the sight line there. */
function losProfileBlocked(samples, radarAltM, targetAltM, D) {
  for (const { d, terrainM } of samples) {
    if (terrainM > losSightLineHeightM(radarAltM, targetAltM, d, D)) return true;
  }
  return false;
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const phi1 = (lat1 * Math.PI) / 180, phi2 = (lat2 * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Great-circle destination from a point, given a bearing and a distance. */
function projectPos(lat, lon, bearing, distM) {
  const R = 6371000;
  const phi1 = (lat * Math.PI) / 180, lambda1 = (lon * Math.PI) / 180;
  const theta = (bearing * Math.PI) / 180;
  const delta = distM / R;
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lambda2 = lambda1 + Math.atan2(
    Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
    Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
  );
  return [(phi2 * 180) / Math.PI, (((lambda2 * 180) / Math.PI + 540) % 360) - 180];
}

/** The 24 path samples between two points: [{ d, lat, lon }], radar end excluded, target end excluded. */
function losSamplePoints(radarLat, radarLon, targetLat, targetLon) {
  const D = haversineM(radarLat, radarLon, targetLat, targetLon);
  const bearing = bearingDeg(radarLat, radarLon, targetLat, targetLon);
  const out = [];
  for (let i = 1; i <= LOS_SAMPLE_COUNT; i++) {
    const d = (D * i) / (LOS_SAMPLE_COUNT + 1);
    const [lat, lon] = projectPos(radarLat, radarLon, bearing, d);
    out.push({ d, lat, lon });
  }
  return { D, points: out };
}

/**
 * Line of sight over any height source: `heightAt(lat, lon)` returns metres or null (unknown).
 * True (clear), false (blocked), or 'unknown'.
 */
function lineOfSight(heightAt, radarLat, radarLon, radarAltM, targetLat, targetLon, targetAltM) {
  const { D, points } = losSamplePoints(radarLat, radarLon, targetLat, targetLon);
  if (D <= 0) return true;
  const samples = [];
  for (const { d, lat, lon } of points) {
    const terrainM = heightAt(lat, lon);
    if (terrainM == null) return 'unknown';
    samples.push({ d, terrainM });
  }
  return !losProfileBlocked(samples, radarAltM, targetAltM, D);
}

// ── the store ───────────────────────────────────────────────────────────────

class TerrainStore {
  /**
   * @param {object} [opts]
   * @param {object} [opts.env] the environment: CRCSYNC_TERRAIN_CACHE_DIR, else state/terrain-cache
   * @param {string} [opts.cacheDir]
   */
  constructor({ env = process.env, cacheDir = terrainCacheDir(env) } = {}) {
    this._cacheDir = cacheDir;
    this._theater = null;
    this._grid = null;
    this._file = null;     // the cache file's bytes, served to clients as they are (GET /api/terrain/grid)
    this._reason = 'no mission loaded';
    this._logged = new Set(); // one line per theater and outcome
  }

  /**
   * A mission on `theater` loaded: read its cache file, finest spacing first. Synchronous, a local file only, read
   * again on every mission load, so a file built while crc-sync runs is picked up at the next mission (re)start.
   */
  loadTheater(theater) {
    this._theater = theater || null;
    this._grid = null;
    this._file = null;
    const once = (outcome, level, msg, fields) => {
      const k = `${theater}|${outcome}`;
      if (this._logged.has(k)) return;
      this._logged.add(k);
      log[level](msg, fields);
    };
    if (!theater) {
      this._reason = 'the theater is unknown';
      return null;
    }
    const found = findCacheFile(this._cacheDir, theater);
    if (!found) {
      this._reason = `no terrain cache for ${theater} in ${this._cacheDir}`;
      once('none', 'warn', 'no terrain cache for this theater: terrain masks nothing and every radar sees to its full range (build one with npm run terrain:build)', { theater, dir: this._cacheDir });
      return null;
    }
    try {
      const buf = fs.readFileSync(found.file);
      this._grid = decodeGrid(buf, { theater });
      this._file = buf;
      this._reason = null;
      const { spacingM, rows, cols, builtAt, dcsVersion } = this._grid.header;
      once('loaded', 'info', 'terrain cache loaded', { theater, file: found.file, spacingM, rows, cols, builtAt, dcsVersion });
    } catch (e) {
      this._reason = `${found.file}: ${e.message}`;
      once('bad', 'warn', 'terrain cache not used: terrain masks nothing and every radar sees to its full range', { theater, file: found.file, error: e.message });
    }
    return this._grid;
  }

  get grid() { return this._grid; }

  /** The loaded file's bytes, or null. */
  get fileBytes() { return this._file; }

  /** What the status route says. */
  status() {
    const h = this._grid && this._grid.header;
    return h
      ? { theater: this._theater, available: true, spacingM: h.spacingM, rows: h.rows, cols: h.cols, builtAt: h.builtAt, dcsVersion: h.dcsVersion, bytes: this._file.length }
      : { theater: this._theater, available: false, reason: this._reason };
  }

  /** Terrain height in metres, or null where it is not known (no grid, or outside it). Safe from the coverage tick. */
  elevationAt(lon, lat) {
    return this._grid ? this._grid.heightAt(lat, lon) : null;
  }

  /**
   * True (clear), false (blocked), or 'unknown' when terrain for at least one
   * sample is not known. Callers MUST treat 'unknown' as visible — see this module's header.
   */
  hasLineOfSight(radarLat, radarLon, radarAltM, targetLat, targetLon, targetAltM) {
    if (!this._grid) return 'unknown';
    return lineOfSight((lat, lon) => this._grid.heightAt(lat, lon), radarLat, radarLon, radarAltM, targetLat, targetLon, targetAltM);
  }
}

module.exports = {
  TerrainStore,
  // pure, and covered by tests/terrain.test.mjs
  losSightLineHeightM, losProfileBlocked, lineOfSight, losSamplePoints, bearingDeg, projectPos,
  EFFECTIVE_EARTH_RADIUS_M, LOS_SAMPLE_COUNT,
};
