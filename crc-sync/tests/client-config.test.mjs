import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crcLog from '../src/log.js';
import { withPaths, APP_PATHS } from './helpers/with-paths.mjs';

// GET /api/client-config (MAPKEY): the MapTiler key the client draws with. Same temp-dir setup as app-boot.test.mjs.
const paths = withPaths('client-config-', APP_PATHS, { stateDir: true, shippedConfig: true, extraEnv: { CRCSYNC_TEST_RESET: undefined, CRCSYNC_MAPTILER_KEY: undefined, CRCSYNC_MAPTILER_CLIENT_KEY: undefined } }).apply();
const tmpDir = paths.dir;
fs.writeFileSync(paths.env.CRCSYNC_EFSP_AIRSPACES_PATH, '{}');

const { createApp } = await import('../src/app.js');

const jwt = 'x.' + Buffer.from(JSON.stringify({ name: 'ctrl' })).toString('base64url') + '.y';

async function get(env, headers) {
  const { grpcClient, srsClient } = { grpcClient: Object.assign(new EventEmitter(), { getWeather: () => ({}) }), srsClient: new EventEmitter() };
  const app = createApp({ grpcClient, srsClient, env: { ...paths.env, ...env } });
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
