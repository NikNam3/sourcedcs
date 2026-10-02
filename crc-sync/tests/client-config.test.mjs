import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crcLog from '../src/log.js';

// GET /api/client-config (MAPKEY): the MapTiler key the client draws with. Same temp-dir setup as app-boot.test.mjs.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-config-'));
fs.mkdirSync(path.join(tmpDir, 'config-empty'));
const SHIPPED = new URL('../config/', import.meta.url);
for (const f of fs.readdirSync(SHIPPED).filter(f => f.endsWith('.json'))) {
  fs.copyFileSync(new URL(f, SHIPPED), path.join(tmpDir, 'config-empty', f));
}
for (const [k, v] of Object.entries({
  CRCSYNC_CONFIG_DIR: 'config-empty',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
  CRCSYNC_EFSP_TRAFFIC_COUNT_PATH: 'traffic-count.jsonl',
  CRCSYNC_EFSP_METRICS_PATH: 'metrics.json',
  CRCSYNC_TERRAIN_CACHE_DIR: 'terrain',
  CRCSYNC_MISSION_SESSION_PATH: 'session.json',
})) process.env[k] = path.join(tmpDir, v);
process.env.CRCSYNC_STATE_DIR = tmpDir;
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');
delete process.env.CRCSYNC_TEST_RESET;

const { createApp } = await import('../src/app.js');

const jwt = 'x.' + Buffer.from(JSON.stringify({ name: 'ctrl' })).toString('base64url') + '.y';

async function get(env, headers) {
  const { grpcClient, srsClient } = { grpcClient: Object.assign(new EventEmitter(), { getWeather: () => ({}) }), srsClient: new EventEmitter() };
  const app = createApp({ grpcClient, srsClient, env });
  return new Promise((resolve, reject) => {
    const srv = app.http.listen(0, '127.0.0.1', async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/client-config`, { headers });
        resolve({ status: r.status, cache: r.headers.get('cache-control'), body: await r.json() });
      } catch (e) { reject(e); } finally { srv.close(); }
    });
  });
}

test('client-config: needs a token', async (t) => {
  { const cap = crcLog.capture(); t.after(() => cap.stop()); }
  assert.equal((await get({ CRCSYNC_MAPTILER_CLIENT_KEY: 'k' }, {})).status, 401);
});

test('client-config: the client key wins, the server key is the fallback, neither is null', async (t) => {
  { const cap = crcLog.capture(); t.after(() => cap.stop()); }
  const h = { Authorization: 'Bearer ' + jwt };
  const both = await get({ CRCSYNC_MAPTILER_CLIENT_KEY: ' clientkey ', CRCSYNC_MAPTILER_KEY: 'serverkey' }, h);
  assert.equal(both.status, 200);
  assert.equal(both.cache, 'no-store');
  assert.deepEqual(both.body, { maptilerKey: 'clientkey' });
  assert.deepEqual((await get({ CRCSYNC_MAPTILER_KEY: 'serverkey' }, h)).body, { maptilerKey: 'serverkey' });
  assert.deepEqual((await get({}, h)).body, { maptilerKey: null });
  assert.deepEqual((await get({ CRCSYNC_MAPTILER_CLIENT_KEY: '  ' }, h)).body, { maptilerKey: null });
});
