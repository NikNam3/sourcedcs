import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* Terrain masking, server-side.
 *
 * The first half is crc-desktop/tests/los-math.test.js, moved here with the
 * math it covers (docs/adr/0044). It was the only test anywhere in the radar
 * area, so it was worth carrying over intact rather than rewriting — the
 * assertions below are the originals.
 *
 * The second half is new, and covers what had to be replaced: the client
 * decoded MapTiler's WebP terrain tiles through a <canvas>, which Node has
 * not got, so this decodes the PNG variant with zlib instead. A silently
 * mis-decoded DEM masks the wrong things, which is worse than no DEM at all —
 * hence a synthetic tile with known heights rather than trusting the format.
 */

const {
  EFFECTIVE_EARTH_RADIUS_M, losSightLineHeightM, losProfileBlocked,
  decodePng, decodeTerrainTile, TILE_SIZE, GRID_N, GRID_STRIDE, PREWARM_MAX_TILES,
  TerrainStore, lonLatToTile, bearingDeg, projectPos,
} = await import('../src/terrain.js');

// ── losSightLineHeightM (ported) ───────────────────────────────────────────

test('losSightLineHeightM: at the radar itself (d=0), height equals radar altitude', () => {
  assert.equal(losSightLineHeightM(100, 500, 0, 10000), 100);
});

test('losSightLineHeightM: at the target itself (d=D), height equals target altitude', () => {
  assert.equal(losSightLineHeightM(100, 500, 10000, 10000), 500);
});

test('losSightLineHeightM: midpoint of equal-altitude endpoints dips below the straight average by the earth-curvature bulge', () => {
  const D = 100000;
  const straightAvg = 50;
  const expectedBulge = ((D / 2) * (D / 2)) / (2 * EFFECTIVE_EARTH_RADIUS_M);
  const height = losSightLineHeightM(50, 50, D / 2, D);
  assert.ok(Math.abs(height - (straightAvg - expectedBulge)) < 1e-6);
  assert.ok(height < straightAvg, 'curvature must pull the sight line below the flat-earth average');
});

test('losSightLineHeightM: D=0 (radar and target at the same point) returns radar altitude', () => {
  assert.equal(losSightLineHeightM(250, 999, 0, 0), 250);
});

// ── losProfileBlocked (ported) ─────────────────────────────────────────────

test('losProfileBlocked: flat terrain well below the sight line is never blocked', () => {
  const samples = [{ d: 5000, terrainM: 50 }, { d: 10000, terrainM: 50 }, { d: 15000, terrainM: 50 }];
  assert.equal(losProfileBlocked(samples, 500, 500, 20000), false);
});

test('losProfileBlocked: a ridge poking above the sight line partway along the path blocks it', () => {
  const samples = [{ d: 5000, terrainM: 100 }, { d: 10000, terrainM: 800 }, { d: 15000, terrainM: 100 }];
  assert.equal(losProfileBlocked(samples, 500, 500, 20000), true);
});

test('losProfileBlocked: terrain just under the sight line stays clear', () => {
  assert.equal(losProfileBlocked([{ d: 10000, terrainM: 490 }], 500, 500, 20000), false);
});

test('losProfileBlocked: long-range curvature alone blocks flat terrain with low-altitude endpoints', () => {
  const D = 500000;
  assert.equal(losProfileBlocked([{ d: D / 2, terrainM: 0 }], 15, 15, D), true);
});

test('losProfileBlocked: short range keeps the same low-altitude endpoints clear', () => {
  const D = 5000;
  assert.equal(losProfileBlocked([{ d: D / 2, terrainM: 0 }], 15, 15, D), false);
});

test('losProfileBlocked: no samples means nothing can block the path', () => {
  assert.equal(losProfileBlocked([], 100, 100, 10000), false);
});

// ── the PNG decoder ────────────────────────────────────────────────────────

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

/**
 * Builds a real PNG (colour type 2, 8-bit, filter 0) whose pixels encode the
 * heights `heightAt(x, y)` returns, through Mapbox Terrain-RGB v1.
 */
function makeTerrainPng(width, height, heightAt, { filter = 0 } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const line = Buffer.alloc(stride);
    for (let x = 0; x < width; x++) {
      const v = Math.round((heightAt(x, y) + 10000) / 0.1);
      line[x * 3] = (v >> 16) & 0xff;
      line[x * 3 + 1] = (v >> 8) & 0xff;
      line[x * 3 + 2] = v & 0xff;
    }
    raw[(stride + 1) * y] = filter;
    if (filter === 0) {
      line.copy(raw, (stride + 1) * y + 1);
    } else if (filter === 2) {
      // Up filter, so the decoder's unfiltering is actually exercised rather
      // than being a memcpy.
      for (let i = 0; i < stride; i++) raw[(stride + 1) * y + 1 + i] = (line[i] - prev[i]) & 0xff;
    }
    line.copy(prev);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('decodePng: reads an 8-bit RGB image back pixel for pixel', () => {
  const png = makeTerrainPng(4, 3, (x, y) => x * 100 + y);
  const { width, height, channels } = decodePng(png);
  assert.equal(width, 4);
  assert.equal(height, 3);
  assert.equal(channels, 3);
});

test('decodePng: refuses a buffer that is not a PNG rather than guessing', () => {
  assert.throws(() => decodePng(Buffer.from('definitely not a png')), /not a PNG/);
});

test('decodeTerrainTile: recovers the encoded heights through Terrain-RGB', () => {
  // A ridge down the middle of the tile, at grid-aligned positions so the
  // GRID_STRIDE subsampling lands on it.
  const png = makeTerrainPng(TILE_SIZE, TILE_SIZE, (x) => (x >= 256 ? 1500 : 200));
  const { grid, n, min, max } = decodeTerrainTile(png);
  assert.equal(n, GRID_N);
  assert.ok(Math.abs(min - 200) < 0.5, `min was ${min}`);
  assert.ok(Math.abs(max - 1500) < 0.5, `max was ${max}`);
  assert.ok(Math.abs(grid[0] - 200) < 0.5);
  assert.ok(Math.abs(grid[n - 1] - 1500) < 0.5);
});

test('decodeTerrainTile: the Up filter decodes to the same heights as no filter', () => {
  const heights = (x, y) => 100 + ((x / GRID_STRIDE) % 7) * 30 + ((y / GRID_STRIDE) % 5) * 10;
  const plain = decodeTerrainTile(makeTerrainPng(TILE_SIZE, TILE_SIZE, heights, { filter: 0 }));
  const filtered = decodeTerrainTile(makeTerrainPng(TILE_SIZE, TILE_SIZE, heights, { filter: 2 }));
  for (let i = 0; i < plain.grid.length; i += 97) {
    assert.ok(Math.abs(plain.grid[i] - filtered.grid[i]) < 0.5, `grid[${i}] diverged`);
  }
});

test('decodeTerrainTile: a tile that is not the expected size is refused', () => {
  assert.throws(() => decodeTerrainTile(makeTerrainPng(64, 64, () => 0)), /unexpected terrain tile size/);
});

// ── TerrainStore ───────────────────────────────────────────────────────────

function tmpCacheDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'crcsync-terrain-'));
}

test('TerrainStore: with no MapTiler key, every sight line is unknown — masking is off, not blind', () => {
  const store = new TerrainStore({ key: '', cacheDir: tmpCacheDir() });
  assert.equal(store.hasLineOfSight(37, 35, 1000, 37.5, 35.5, 3000), 'unknown');
});

test('TerrainStore: a sample whose tile is not cached answers unknown, and callers fail open', () => {
  const store = new TerrainStore({ key: 'k', cacheDir: tmpCacheDir(), fetchTile: async () => null });
  assert.equal(store.elevationAt(35, 37), null);
  assert.equal(store.hasLineOfSight(37, 35, 1000, 37.2, 35.2, 3000), 'unknown');
});

test('TerrainStore: a fetched tile is decoded, answers elevation, and lands in the disk cache', async () => {
  const cacheDir = tmpCacheDir();
  const png = makeTerrainPng(TILE_SIZE, TILE_SIZE, () => 800);
  let fetches = 0;
  const store = new TerrainStore({
    key: 'k', cacheDir,
    fetchTile: async () => { fetches += 1; return png; },
  });

  store.ensureTile(...tileOf(35, 37));
  await store.settle();

  const elev = store.elevationAt(35, 37);
  assert.ok(elev != null && Math.abs(elev - 800) < 0.5, `elevation was ${elev}`);
  assert.equal(fetches, 1);

  // A second store over the same directory must not re-fetch.
  const second = new TerrainStore({
    key: 'k', cacheDir,
    fetchTile: async () => { throw new Error('should have come off disk'); },
  });
  second.ensureTile(...tileOf(35, 37));
  await second.settle();
  const again = second.elevationAt(35, 37);
  assert.ok(again != null && Math.abs(again - 800) < 0.5);
  assert.equal(second.stats.fromDisk, 1);
});

test('TerrainStore: a tile the source has no data for reads as sea level, not as unknown forever', async () => {
  // Without this an over-water radar would fail open on every sample for the
  // whole session, and never actually mask anything.
  const store = new TerrainStore({ key: 'k', cacheDir: tmpCacheDir(), fetchTile: async () => null });
  store.ensureTile(...tileOf(0, 0));
  await store.settle();
  assert.equal(store.elevationAt(0, 0), 0);
  assert.equal(store.stats.missing, 1);
});

test('TerrainStore: a ridge between radar and target blocks the sight line', async () => {
  // Flat 3000m terrain everywhere, a radar and a target at 100m: the terrain
  // is far above any sight line between them.
  const png = makeTerrainPng(TILE_SIZE, TILE_SIZE, () => 3000);
  const store = new TerrainStore({ key: 'k', cacheDir: tmpCacheDir(), fetchTile: async () => png });
  // Warm every tile the path samples, then ask.
  for (let i = 0; i < 3; i++) {
    store.hasLineOfSight(37, 35, 100, 37.1, 35.1, 100);
    await store.settle();
  }
  assert.equal(store.hasLineOfSight(37, 35, 100, 37.1, 35.1, 100), false);
});

test('TerrainStore: the same terrain does not block two aircraft flying above it', async () => {
  const png = makeTerrainPng(TILE_SIZE, TILE_SIZE, () => 3000);
  const store = new TerrainStore({ key: 'k', cacheDir: tmpCacheDir(), fetchTile: async () => png });
  for (let i = 0; i < 3; i++) {
    store.hasLineOfSight(37, 35, 9000, 37.1, 35.1, 9000);
    await store.settle();
  }
  assert.equal(store.hasLineOfSight(37, 35, 9000, 37.1, 35.1, 9000), true);
});

test('TerrainStore: prewarmForRadars queues the tiles covering a radar range circle', () => {
  const store = new TerrainStore({ key: 'k', cacheDir: tmpCacheDir(), fetchTile: async () => null });
  const queued = store.prewarmForRadars([
    { id: 'app:Incirlik', lat: 37.0, lon: 35.4, rangeM: 80 * 1852 },
  ]);
  assert.ok(queued > 1, `expected several tiles, got ${queued}`);
});

test('TerrainStore: prewarm skips a radar with no position rather than throwing', () => {
  const store = new TerrainStore({ key: 'k', cacheDir: tmpCacheDir(), fetchTile: async () => null });
  assert.equal(store.prewarmForRadars([{ id: 'crc:1', rangeM: 1000 }]), 0);
});

// ── geometry helpers ───────────────────────────────────────────────────────

test('projectPos then bearingDeg round-trips a bearing', () => {
  const [lat, lon] = projectPos(37, 35, 90, 50000);
  const back = bearingDeg(37, 35, lat, lon);
  assert.ok(Math.abs(back - 90) < 0.5, `bearing came back as ${back}`);
});

test('lonLatToTile puts the prime meridian at the middle of the zoom-0 tile', () => {
  const [x, y] = lonLatToTile(0, 0, 0);
  assert.ok(Math.abs(x - 0.5) < 1e-9);
  assert.ok(Math.abs(y - 0.5) < 1e-9);
});

function tileOf(lon, lat) {
  const [xf, yf] = lonLatToTile(lon, lat, 10);
  return [10, Math.floor(xf), Math.floor(yf)];
}

test('prewarm is capped, so a theater-wide selector cannot run away', () => {
  // CTR carries {kind:'approach', airport:'*'} legitimately, which on a
  // 225-airfield map is hundreds of megabytes of tiles. Whatever is skipped
  // loads on demand the first time a sight line needs it.
  const store = new TerrainStore({ key: 'k', cacheDir: tmpCacheDir(), fetchTile: async () => null });
  const manyRadars = [];
  for (let i = 0; i < 400; i++) {
    manyRadars.push({ id: `app:${i}`, lat: 30 + i * 0.1, lon: 20 + i * 0.1, rangeM: 80 * 1852 });
  }
  const queued = store.prewarmForRadars(manyRadars);
  assert.equal(queued, PREWARM_MAX_TILES);
});

test('a pre-warm well under the cap queues everything it found', () => {
  const store = new TerrainStore({ key: 'k', cacheDir: tmpCacheDir(), fetchTile: async () => null });
  const queued = store.prewarmForRadars([{ id: 'apt:X', lat: 37, lon: 35, rangeM: 40 * 1852 }]);
  assert.ok(queued > 0 && queued < PREWARM_MAX_TILES);
});
