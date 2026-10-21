import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crcLog from '../src/log.js';
import { withPaths, APP_PATHS } from './helpers/with-paths.mjs';

/* docs/adr/0133's hard rule: a running crc-sync never asks DCS (or the web) for terrain. The cache is built only by the
 * human-run command in tools/terrain/; the server reads the file at mission load and serves it to clients. */

const paths = withPaths('terrain-no-dcs-', APP_PATHS, { stateDir: true, shippedConfig: true, extraEnv: { CRCSYNC_TEST_RESET: undefined } }).apply();
fs.writeFileSync(paths.env.CRCSYNC_EFSP_AIRSPACES_PATH, '{}');
const cacheDir = paths.env.CRCSYNC_TERRAIN_CACHE_DIR;

const { createApp } = await import('../src/app.js');
const { planGrid, encodeGrid, cacheFileName, FORMAT } = await import('../src/terrain-grid.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '../src');
const jwt = 'x.' + Buffer.from(JSON.stringify({ name: 'ctrl' })).toString('base64url') + '.y';
const MISSION = (theatre) => ({ theatre, airports: [], waypoints: [], drawings: [], coalitions: {}, bullseye: {} });

function writeCache() {
  const plan = planGrid({ latMin: 35, latMax: 35.2, lonMin: 36, lonMax: 36.2 }, 2000);
  const header = { format: FORMAT, theater: 'Syria', spacingM: 2000, ...plan, builtAt: '2026-10-21T00:00:00.000Z', dcsVersion: 'test' };
  const buf = encodeGrid(header, new Int16Array(plan.rows * plan.cols).fill(123));
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, cacheFileName('Syria', 2000)), buf);
  return buf;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
}

test('no file under src/ loads the terrain commands or asks DCS for heights or visibility', () => {
  for (const file of walk(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /require\([^)]*tools\/terrain/, `${path.relative(SRC, file)} must not load tools/terrain`);
    assert.doesNotMatch(text, /land\.(getHeight|isVisible|profile)/, `${path.relative(SRC, file)} must not ask DCS for terrain`);
  }
  for (const f of ['terrain.js', 'terrain-grid.js']) {
    const text = fs.readFileSync(path.join(SRC, f), 'utf8');
    assert.doesNotMatch(text, /\bfetch\(|evalLua|maptiler|require\('https?'\)/i, `${f} reads a local file only`);
  }
});

test('createApp: a mission load and every ticker never call Eval for terrain nor fetch anything', async (t) => {
  { const cap = crcLog.capture(); t.after(() => cap.stop()); }
  writeCache();
  const evals = [];
  const grpcClient = Object.assign(new EventEmitter(), { getWeather: () => ({}), evalLua: async (lua) => { evals.push(lua); return null; }, getAptWeather: async () => ({}) });
  const realFetch = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async (url, ...rest) => { fetched.push(String(url)); return realFetch(url, ...rest); };
  t.after(() => { globalThis.fetch = realFetch; });
  const app = createApp({ grpcClient, srsClient: new EventEmitter(), env: { ...paths.env } });
  app.start();
  t.after(() => app.stop());
  grpcClient.emit('mission-load', MISSION('Syria'));
  for (const tk of app.tickers) await tk.tick();
  assert.deepEqual(evals.filter((l) => /land\.|coord\.LLtoLO/.test(l)), []);
  assert.deepEqual(fetched.filter((u) => /maptiler|terrain/i.test(u)), []);
  assert.equal(app.picture.terrainStore.status().available, true, 'the cache was read from disk');
});

async function serve(t, theatre) {
  { const cap = crcLog.capture(); t.after(() => cap.stop()); }
  const grpcClient = Object.assign(new EventEmitter(), { getWeather: () => ({}), evalLua: async () => null, getAptWeather: async () => ({}) });
  const app = createApp({ grpcClient, srsClient: new EventEmitter(), env: { ...paths.env } });
  app.start();
  if (theatre) grpcClient.emit('mission-load', MISSION(theatre));
  const srv = await new Promise((r) => { const s = app.http.listen(0, '127.0.0.1', () => r(s)); });
  t.after(() => { app.stop(); srv.close(); });
  return (p, headers = {}) => fetch(`http://127.0.0.1:${srv.address().port}${p}`, { headers });
}

test('GET /api/terrain/grid: the cache file, gzipped when accepted, 304 on its ETag, a token needed', async (t) => {
  const file = writeCache();
  const get = await serve(t, 'Syria');
  const auth = { Authorization: 'Bearer ' + jwt };
  assert.equal((await get('/api/terrain/grid')).status, 401);
  const status = await (await get('/api/terrain/status', auth)).json();
  assert.equal(status.available, true);
  assert.equal(status.spacingM, 2000);
  const r = await get('/api/terrain/grid', { ...auth, 'Accept-Encoding': 'gzip' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-encoding'), 'gzip');
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(file));
  const plain = await get('/api/terrain/grid', { ...auth, 'Accept-Encoding': 'identity' });
  assert.equal(plain.headers.get('content-encoding'), null);
  assert.ok(Buffer.from(await plain.arrayBuffer()).equals(file));
  const etag = r.headers.get('etag');
  assert.equal((await get('/api/terrain/grid', { ...auth, 'If-None-Match': etag })).status, 304);
});

test('GET /api/terrain/grid: 404 for a theater with no cache, and status says why', async (t) => {
  writeCache();
  const get = await serve(t, 'Caucasus');
  const auth = { Authorization: 'Bearer ' + jwt };
  assert.equal((await get('/api/terrain/grid', auth)).status, 404);
  const status = await (await get('/api/terrain/status', auth)).json();
  assert.equal(status.available, false);
  assert.match(status.reason, /no terrain cache for Caucasus/);
});
