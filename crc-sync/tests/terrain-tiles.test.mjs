import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Real MapTiler terrain tiles (live-test finding T2).
 *
 * terrain-rgb-v2 serves lossless WebP only, so every tile used to fail "not a
 * PNG" and every radar saw to full range. These fixtures are real tiles,
 * fetched once:
 *   10-612-398.webp  terrain-rgb-v2, z10 x612 y398 (Incirlik and the Adana plain)
 *   10-612-398.png   the older terrain-rgb set, same tile, PNG
 *   10-600-400.webp  terrain-rgb-v2, z10 x600 y400 (open sea south of Antalya)
 * The expected RGBA hash is libwebp 1.6.0's decode of the WebP (Pillow); the
 * PNG decodes to the same pixels, so one hash checks both decoders.
 */

const {
  decodePng, decodeWebp, decodeTerrainImage, decodeTerrainTile,
  TerrainStore, lonLatToTile, TILE_SIZE, TILE_FORMAT, LOS_DEM_ZOOM,
} = await import('../src/terrain.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => fs.readFileSync(path.join(here, 'fixtures/terrain', name));
const WEBP = fixture('10-612-398.webp');
const PNG = fixture('10-612-398.png');
const SEA = fixture('10-600-400.webp');
const LIBWEBP_RGBA_SHA256 = '3f1aaf52519ff156e3d99af5e88b6fbdf0f7587613a44f55e1c4385ebb058d7b';

const INCIRLIK = { lat: 37.0021, lon: 35.4259 };

function rgba({ width, height, channels, data }) {
  if (channels === 4) return data;
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0, o = 0; i < data.length; i += 3, o += 4) {
    out[o] = data[i]; out[o + 1] = data[i + 1]; out[o + 2] = data[i + 2]; out[o + 3] = 255;
  }
  return out;
}
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const heightAt = (img, x, y) => {
  const i = (y * img.width + x) * img.channels;
  return -10000 + (img.data[i] * 65536 + img.data[i + 1] * 256 + img.data[i + 2]) * 0.1;
};

// ── decoders ────────────────────────────────────────────────────────────────

test('decodeWebp: a real terrain-rgb-v2 tile decodes byte for byte as libwebp does', () => {
  const img = decodeWebp(WEBP);
  assert.equal(img.width, TILE_SIZE);
  assert.equal(img.height, TILE_SIZE);
  assert.equal(img.channels, 4);
  assert.equal(sha(img.data), LIBWEBP_RGBA_SHA256);
});

test('decodePng: the real terrain-rgb PNG of the same tile decodes to the same pixels', () => {
  const img = decodePng(PNG);
  assert.equal(img.width, TILE_SIZE);
  assert.equal(img.channels, 3);
  assert.equal(sha(rgba(img)), LIBWEBP_RGBA_SHA256);
});

test('decodeTerrainImage: picks the decoder by magic bytes, not by the URL', () => {
  assert.equal(decodeTerrainImage(WEBP).channels, 4);
  assert.equal(decodeTerrainImage(PNG).channels, 3);
  assert.throws(() => decodeTerrainImage(Buffer.from('neither format')), /not a PNG/);
});

test('decoded heights: known pixels of the real tile, in metres (Terrain-RGB)', () => {
  // Values as libwebp decodes them: -10000 + (R*65536 + G*256 + B) * 0.1.
  const img = decodeWebp(WEBP);
  const expected = [[0, 0, 114.9], [256, 256, 35.6], [511, 511, 9.3], [100, 400, 11.7], [400, 100, 191.8]];
  for (const [x, y, m] of expected) {
    assert.ok(Math.abs(heightAt(img, x, y) - m) < 0.05, `(${x},${y}) was ${heightAt(img, x, y)}, expected ${m}`);
  }
});

test('decodeTerrainTile: WebP and PNG give the same grid, within the plain\'s range', () => {
  const w = decodeTerrainTile(WEBP);
  const p = decodeTerrainTile(PNG);
  assert.deepEqual(Array.from(w.grid), Array.from(p.grid));
  assert.ok(Math.abs(w.min - 5.7) < 0.05, `min ${w.min}`);
  assert.ok(Math.abs(w.max - 317.8) < 0.05, `max ${w.max}`);
});

test('decodeTerrainTile: a real open-sea tile is sea level everywhere', () => {
  const { min, max } = decodeTerrainTile(SEA);
  assert.equal(min, 0);
  assert.equal(max, 0);
});

test('decodeWebp: refuses a lossy (VP8) WebP rather than guessing heights', () => {
  const body = Buffer.alloc(10);
  const riff = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.from([10, 0, 0, 0]), body]);
  riff.writeUInt32LE(riff.length - 8, 4);
  assert.throws(() => decodeWebp(riff), /lossy WebP not supported/);
});

test('decodeWebp: a truncated tile throws instead of returning a half-decoded DEM', () => {
  assert.throws(() => decodeWebp(WEBP.subarray(0, WEBP.length >> 1)));
});

// ── the store against MapTiler's real responses (fetch stubbed) ─────────────

function stubFetch(t, body) {
  const urls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response(body, { status: 200, headers: { 'content-type': 'image/webp' } });
  };
  t.after(() => { globalThis.fetch = original; });
  return urls;
}

test('pre-warm at boot with a key: every tile around Incirlik fetches, decodes and caches, no failures', async (t) => {
  // Built as src/app/radar-picture.js builds it: from the environment alone.
  // The fetch answers every tile with the real WebP bytes, as MapTiler does.
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crcsync-terrain-prewarm-'));
  const urls = stubFetch(t, WEBP);
  const store = new TerrainStore({ env: { CRCSYNC_MAPTILER_KEY: 'test-key', CRCSYNC_TERRAIN_CACHE_DIR: cacheDir } });

  const queued = store.prewarmForRadars([{ id: 'app:Incirlik', lat: INCIRLIK.lat, lon: INCIRLIK.lon, rangeM: 30 * 1852 }]);
  await store.settle();

  assert.ok(queued > 1, `expected several tiles, got ${queued}`);
  assert.equal(store.stats.failed, 0);
  assert.equal(store.stats.fetched, queued);
  assert.equal(urls.length, queued);
  for (const url of urls) {
    assert.match(url, /^https:\/\/api\.maptiler\.com\/tiles\/terrain-rgb-v2\/10\/\d+\/\d+\.webp\?key=test-key$/);
  }
  // The cache file carries the format it holds.
  const [xf, yf] = lonLatToTile(INCIRLIK.lon, INCIRLIK.lat, LOS_DEM_ZOOM);
  const cached = path.join(cacheDir, String(LOS_DEM_ZOOM), String(Math.floor(xf)), `${Math.floor(yf)}.${TILE_FORMAT}`);
  assert.equal(TILE_FORMAT, 'webp');
  assert.deepEqual(fs.readFileSync(cached), WEBP);
});

test('Incirlik field elevation from the real tile, and a restart reads it back off the disk cache', async (t) => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crcsync-terrain-incirlik-'));
  stubFetch(t, WEBP);
  const env = { CRCSYNC_MAPTILER_KEY: 'test-key', CRCSYNC_TERRAIN_CACHE_DIR: cacheDir };
  const store = new TerrainStore({ env });
  assert.equal(store.elevationAt(INCIRLIK.lon, INCIRLIK.lat), null); // queued
  await store.settle();
  // Published field elevation 238 ft (72.5 m); the 4-pixel DEM grid reads 62 m.
  const m = store.elevationAt(INCIRLIK.lon, INCIRLIK.lat);
  assert.ok(m > 50 && m < 80, `Incirlik elevation was ${m}`);

  globalThis.fetch = async () => { throw new Error('should have come off disk'); };
  const restarted = new TerrainStore({ env });
  assert.equal(restarted.elevationAt(INCIRLIK.lon, INCIRLIK.lat), null);
  assert.equal(restarted.stats.fromDisk, 1);
  assert.ok(Math.abs(restarted.elevationAt(INCIRLIK.lon, INCIRLIK.lat) - m) < 1e-9);
});
