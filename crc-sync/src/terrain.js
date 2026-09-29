'use strict';

// Terrain elevation and radar line-of-sight, server-side (docs/adr/0044).
//
// The math is ported unchanged from crc-desktop's app/public/js/los.js — same
// 24 samples along the path, same 4/3-earth curvature model, same fail-open
// rule. `losSightLineHeightM` and `losProfileBlocked` are byte-for-byte the
// functions crc-desktop/tests/los-math.test.js already covered, and that test
// moved here with them (tests/terrain.test.mjs). It is the only pre-existing
// coverage anywhere in the radar area, so it was worth keeping.
//
// What had to be replaced is the DEM source. The client decodes MapTiler
// terrain-RGB WebP tiles through a <canvas>, which Node has not got. This
// requests the PNG variant of the same tileset and decodes it with Node's own
// zlib — no new dependency, which matters for a package that runs on six.
//
// Two caches, for two different problems:
//   - decoded Float32 grids in memory, so the sweep can sample synchronously;
//   - the raw tiles on disk, so a restart does not re-fetch the theater.
//
// And a pre-warm: on mission load the theater's radars are known, so the tiles
// covering their range circles are fetched up front. Until a tile is there,
// `losHasLineOfSight` answers 'unknown' and every caller treats that as
// visible. Going spuriously blind is worse than seeing slightly too much.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { haversineM } = require('./geo');

// Fixed sampling zoom, independent of anything a client is looking at.
const LOS_DEM_ZOOM = 10;
const LOS_SAMPLE_COUNT = 24;
const GRID_CACHE_MAX = 600; // decoded tiles held in memory (FIFO)

// Earth curvature plus typical atmospheric refraction bend the ray back down
// slightly, modelled as line of sight over an effective earth 4/3 the true
// radius. Standard radar-horizon approximation.
const EFFECTIVE_EARTH_RADIUS_M = (4 / 3) * 6371000;

const TILE_SIZE = 512;   // terrain-rgb-v2 tile pixel dimensions
const GRID_STRIDE = 4;   // sample every 4th pixel -> 128x128 grid per tile
const GRID_N = TILE_SIZE / GRID_STRIDE;

const MAPTILER_KEY = process.env.CRCSYNC_MAPTILER_KEY || '';
// Under state/, not config/ (baked into the image, hand-edited squadron data)
// and not data/ (baked into the image, shipped reference tables) — this is a
// few megabytes of derived cache. In the compose stack it is a volume
// (infra/docker-compose.yml's crc-sync-state). See src/state-paths.js.
const CACHE_DIR = process.env.CRCSYNC_TERRAIN_CACHE_DIR
  || path.join(__dirname, '../state/terrain-cache');

const FETCH_TIMEOUT_MS = 15000;
const MAX_CONCURRENT_FETCHES = 6;
// A ceiling on one pre-warm, not on the cache. See prewarmForRadars.
const PREWARM_MAX_TILES = 1500;

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

function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return [x, y];
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

// ── PNG decode (no dependency) ─────────────────────────────────────────────

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Decodes the one PNG flavour MapTiler's terrain-rgb-v2 actually serves:
 * 8-bit, colour type 2 (RGB) or 6 (RGBA), no interlacing. Anything else
 * throws rather than guessing — a silently mis-decoded DEM is terrain that
 * masks the wrong things, which is far worse than no terrain at all.
 *
 * @returns {{width:number, height:number, channels:number, data:Buffer}}
 */
function decodePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_MAGIC)) throw new Error('not a PNG');

  let width = 0, height = 0, bitDepth = 0, colourType = -1, interlace = 0;
  const idat = [];
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const body = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colourType = body[9];
      interlace = body[12];
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 8 + len + 4; // length + type + body + CRC
  }

  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  if (colourType !== 2 && colourType !== 6) throw new Error(`unsupported PNG colour type ${colourType}`);
  if (interlace !== 0) throw new Error('interlaced PNG not supported');
  if (!idat.length) throw new Error('PNG has no IDAT');

  const channels = colourType === 2 ? 3 : 4;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);

  // Reverse the per-scanline filters (PNG spec §9.2). Each scanline is
  // prefixed with its filter type byte.
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;          // left
      const b = prev ? prev[i] : 0;                             // up
      const c = prev && i >= channels ? prev[i - channels] : 0; // up-left
      const x = line[i];
      let v;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`unsupported PNG filter ${filter}`);
      }
      cur[i] = v & 0xff;
    }
  }

  return { width, height, channels, data: out };
}

/**
 * Mapbox Terrain-RGB v1 encoding, which is what MapTiler's terrain-rgb-v2
 * tileset carries: height = -10000 + ((R*256*256 + G*256 + B) * 0.1).
 * Subsampled by GRID_STRIDE into a GRID_N x GRID_N Float32Array of metres.
 */
function decodeTerrainTile(buf) {
  const { width, height, channels, data } = decodePng(buf);
  if (width !== TILE_SIZE || height !== TILE_SIZE) {
    throw new Error(`unexpected terrain tile size ${width}x${height}`);
  }
  const grid = new Float32Array(GRID_N * GRID_N);
  let min = Infinity, max = -Infinity;
  for (let gy = 0; gy < GRID_N; gy++) {
    for (let gx = 0; gx < GRID_N; gx++) {
      const px = gx * GRID_STRIDE, py = gy * GRID_STRIDE;
      const i = (py * width + px) * channels;
      const m = -10000 + (data[i] * 65536 + data[i + 1] * 256 + data[i + 2]) * 0.1;
      grid[gy * GRID_N + gx] = m;
      if (m < min) min = m;
      if (m > max) max = m;
    }
  }
  return { grid, n: GRID_N, min, max };
}

function bilinear(grid, n, px, py) {
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

// ── the store ───────────────────────────────────────────────────────────────

class TerrainStore {
  /**
   * @param {object} [opts]
   * @param {string} [opts.key] — MapTiler key. Without one the store stays
   *   empty and every LOS answer is 'unknown', i.e. fail-open: the picture
   *   works, terrain masking simply does not happen. That is the correct
   *   degradation for a missing credential, and it is logged once.
   * @param {string} [opts.cacheDir]
   * @param {(url:string)=>Promise<Buffer>} [opts.fetchTile] — injected so a
   *   test can drive the decoder and the cache without a network.
   */
  constructor({ key = MAPTILER_KEY, cacheDir = CACHE_DIR, fetchTile } = {}) {
    this._key = key;
    this._cacheDir = cacheDir;
    this._fetchTile = fetchTile || ((url) => this._httpGet(url));
    this._grids = new Map();      // "z/x/y" -> {grid, n, min, max}
    this._missing = new Set();    // tiles the source has no data for (ocean, out of range)
    this._inFlight = new Map();   // "z/x/y" -> Promise
    this._queue = [];
    this._active = 0;
    this._warnedNoKey = false;
    this._stats = { fetched: 0, fromDisk: 0, missing: 0, failed: 0 };
  }

  get stats() {
    return { ...this._stats, cachedTiles: this._grids.size, queued: this._queue.length };
  }

  _tileUrl(z, x, y) {
    return `https://api.maptiler.com/tiles/terrain-rgb-v2/${z}/${x}/${y}.png?key=${this._key}`;
  }

  _diskPath(z, x, y) {
    return path.join(this._cacheDir, String(z), String(x), `${y}.png`);
  }

  async _httpGet(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      // 404/422 is the source saying "no data here" — ocean, or outside the
      // tileset's coverage. Distinct from a failure, and cached as such so we
      // stop asking.
      if (res.status === 404 || res.status === 422) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }

  _rememberGrid(key, decoded) {
    this._grids.set(key, decoded);
    if (this._grids.size > GRID_CACHE_MAX) {
      this._grids.delete(this._grids.keys().next().value);
    }
  }

  /** Reads a tile off the disk cache, returning true if it decoded. */
  _loadFromDisk(z, x, y) {
    const key = `${z}/${x}/${y}`;
    try {
      const buf = fs.readFileSync(this._diskPath(z, x, y));
      this._rememberGrid(key, decodeTerrainTile(buf));
      this._stats.fromDisk += 1;
      return true;
    } catch {
      return false;
    }
  }

  _saveToDisk(z, x, y, buf) {
    try {
      const file = this._diskPath(z, x, y);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
    } catch (e) {
      // A read-only or full cache directory must not stop the picture working;
      // it only costs a re-fetch next boot.
      console.warn('[terrain] could not write the tile cache:', e.message);
    }
  }

  /**
   * Queues a tile for fetching. Never throws and never awaits on the caller's
   * behalf — the sweep calls this from a synchronous path.
   */
  ensureTile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (this._grids.has(key) || this._missing.has(key) || this._inFlight.has(key)) return;
    if (!this._key) {
      if (!this._warnedNoKey) {
        console.warn('[terrain] CRCSYNC_MAPTILER_KEY is not set — terrain masking is disabled and every radar sees to its full range');
        this._warnedNoKey = true;
      }
      this._missing.add(key);
      return;
    }
    if (this._loadFromDisk(z, x, y)) return;

    const promise = new Promise((resolve) => this._queue.push({ z, x, y, key, resolve }));
    this._inFlight.set(key, promise);
    this._drain();
  }

  _drain() {
    while (this._active < MAX_CONCURRENT_FETCHES && this._queue.length) {
      const job = this._queue.shift();
      this._active += 1;
      this._fetchTile(this._tileUrl(job.z, job.x, job.y))
        .then((buf) => {
          if (!buf) {
            this._missing.add(job.key);
            this._stats.missing += 1;
            return;
          }
          this._rememberGrid(job.key, decodeTerrainTile(buf));
          this._saveToDisk(job.z, job.x, job.y, buf);
          this._stats.fetched += 1;
        })
        .catch((e) => {
          // Left uncached rather than marked missing, so a transient network
          // failure is retried on the next sample instead of blinding the
          // radar permanently.
          this._stats.failed += 1;
          if (this._stats.failed <= 3) console.warn(`[terrain] tile ${job.key} failed:`, e.message);
        })
        .finally(() => {
          this._inFlight.delete(job.key);
          this._active -= 1;
          job.resolve();
          this._drain();
        });
    }
  }

  /** Waits for everything currently queued — used by the pre-warm, never by the sweep. */
  async settle() {
    while (this._inFlight.size) await Promise.all([...this._inFlight.values()]);
  }

  /**
   * Synchronous, cache-only terrain height in metres. Returns null on a miss
   * and queues the tile. Safe to call from the coverage tick.
   */
  elevationAt(lon, lat) {
    const [xf, yf] = lonLatToTile(lon, lat, LOS_DEM_ZOOM);
    const tx = Math.floor(xf), ty = Math.floor(yf);
    const key = `${LOS_DEM_ZOOM}/${tx}/${ty}`;
    const cached = this._grids.get(key);
    if (!cached) {
      // A tile the source has no data for is sea level, not unknown. Without
      // this an over-water radar would never get an answer and would fail
      // open on every sample forever.
      if (this._missing.has(key)) return 0;
      this.ensureTile(LOS_DEM_ZOOM, tx, ty);
      return null;
    }
    const { grid, n } = cached;
    return bilinear(grid, n, (xf - tx) * n, (yf - ty) * n);
  }

  /**
   * True (clear), false (blocked), or 'unknown' when terrain for at least one
   * sample is not cached yet. Callers MUST treat 'unknown' as visible — see
   * this module's header.
   */
  hasLineOfSight(radarLat, radarLon, radarAltM, targetLat, targetLon, targetAltM) {
    const D = haversineM(radarLat, radarLon, targetLat, targetLon);
    if (D <= 0) return true;
    const bearing = bearingDeg(radarLat, radarLon, targetLat, targetLon);

    const samples = [];
    for (let i = 1; i <= LOS_SAMPLE_COUNT; i++) {
      const d = (D * i) / (LOS_SAMPLE_COUNT + 1);
      const [lat, lon] = projectPos(radarLat, radarLon, bearing, d);
      const terrainM = this.elevationAt(lon, lat);
      if (terrainM == null) return 'unknown';
      samples.push({ d, terrainM });
    }
    return !losProfileBlocked(samples, radarAltM, targetAltM, D);
  }

  /**
   * Pre-fetches every tile covering the given radars' range circles, so the
   * first sweep after a mission load has terrain to work with instead of
   * failing open for the first minute. Called from the mission-load handler.
   */
  prewarmForRadars(radars) {
    const wanted = new Set();
    for (const r of radars || []) {
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
      // The bounding box of the range circle, walked in tile steps.
      for (const bearing of [0, 90, 180, 270]) {
        const [lat, lon] = projectPos(r.lat, r.lon, bearing, r.rangeM);
        wanted.add(`${lat},${lon}`);
      }
      const [north] = projectPos(r.lat, r.lon, 0, r.rangeM);
      const [south] = projectPos(r.lat, r.lon, 180, r.rangeM);
      const [, east] = projectPos(r.lat, r.lon, 90, r.rangeM);
      const [, west] = projectPos(r.lat, r.lon, 270, r.rangeM);
      const [x0, y0] = lonLatToTile(west, north, LOS_DEM_ZOOM);
      const [x1, y1] = lonLatToTile(east, south, LOS_DEM_ZOOM);
      for (let tx = Math.floor(Math.min(x0, x1)); tx <= Math.floor(Math.max(x0, x1)); tx++) {
        for (let ty = Math.floor(Math.min(y0, y1)); ty <= Math.floor(Math.max(y0, y1)); ty++) {
          wanted.add(`${LOS_DEM_ZOOM}/${tx}/${ty}`);
        }
      }
    }
    const pending = [];
    for (const key of wanted) {
      if (!key.startsWith(`${LOS_DEM_ZOOM}/`)) continue;
      if (this._grids.has(key) || this._missing.has(key)) continue;
      pending.push(key);
    }

    // A theater-wide selector is legitimate — `CTR` carries
    // `{kind:'approach', airport:'*'}`, because an en-route Position genuinely
    // works every airfield — but on a 225-airfield map that is a few hundred
    // megabytes of tiles. The cap bounds the surprise rather than changing the
    // behaviour: it is a background fetch, everything fails open while it
    // runs, and whatever is skipped warms on demand the first time a sight
    // line needs it. Raise it if a session genuinely pans the whole theater.
    const truncated = pending.length > PREWARM_MAX_TILES;
    const batch = truncated ? pending.slice(0, PREWARM_MAX_TILES) : pending;
    for (const key of batch) {
      const [z, x, y] = key.split('/').map(Number);
      this.ensureTile(z, x, y);
    }

    if (batch.length) {
      console.log(`[terrain] pre-warming ${batch.length} DEM tiles for ${(radars || []).length} radars`
        + (truncated ? ` (capped; ${pending.length - batch.length} more will load on demand)` : ''));
    }
    return batch.length;
  }
}

module.exports = {
  TerrainStore,
  // pure, and covered by tests/terrain.test.mjs
  losSightLineHeightM, losProfileBlocked,
  decodePng, decodeTerrainTile, lonLatToTile, bearingDeg, projectPos, bilinear,
  EFFECTIVE_EARTH_RADIUS_M, LOS_SAMPLE_COUNT, LOS_DEM_ZOOM,
  TILE_SIZE, GRID_STRIDE, GRID_N, CACHE_DIR, PREWARM_MAX_TILES,
};
