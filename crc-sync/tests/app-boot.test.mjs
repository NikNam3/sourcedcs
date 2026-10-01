import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crcLog from '../src/log.js';

// createApp (src/app.js) with fakes: what server.js, the soak host and these tests share.
// Every path points into a temp dir BEFORE anything under src/ is required.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-boot-'));
fs.mkdirSync(path.join(tmpDir, 'config-empty'));
// The Facilities' data and the tuning files are the shipped JSON (DATA-1, DATA-2): no code defaults remain,
// so every shipped .json is copied in.
const SHIPPED = new URL('../config/', import.meta.url);
for (const f of fs.readdirSync(SHIPPED).filter(f => f.endsWith('.json'))) {
  fs.copyFileSync(new URL(f, SHIPPED), path.join(tmpDir, 'config-empty', f));
}
for (const [k, v] of Object.entries({
  CRCSYNC_STATE_DIR: '',
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

// Today's timers, by name and period (server.js before APP had these as 11 bare setIntervals).
const EXPECTED = [
  ['datalink-locks', 2000], ['coverage', 250], ['clock-source', 5000], ['airport-weather', 60000],
  ['efsp-metrics', 60000], ['efsp-archiver', 60000], ['stale-reaper', 5000], ['obligations-nla', 15000],
  ['correlation', 1000], ['carrier', 1000], ['conformance-stca', 1000],
];

function fakes() {
  const grpcClient = Object.assign(new EventEmitter(), {
    getWeather: () => ({}), evalLua: async () => null, getAptWeather: async () => ({}),
  });
  const srsClient = new EventEmitter();
  return { grpcClient, srsClient };
}
const timeouts = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

test('createApp: ticker names and periods are the ones server.js had', async (t) => {
  { const cap = crcLog.capture(); t.after(() => cap.stop()); }
  const { correlation } = await import('../src/efsp/correlation-reconciler.js').then((m) => ({ correlation: m.CORRELATION_TICK_MS }));
  const app = createApp({ ...fakes(), env: {} });
  assert.deepEqual(app.tickers.map((x) => [x.name, x.periodMs]), EXPECTED.map(([n, p]) => [n, n === 'correlation' ? correlation : p]));
});

test('createApp: every ticker runs once, start() installs and stop() clears timers and handlers', async (t) => {
  { const cap = crcLog.capture(); t.after(() => cap.stop()); }
  const { grpcClient, srsClient } = fakes();
  const baseTimers = timeouts();
  const baseGrpc = grpcClient.eventNames().length;
  const app = createApp({ grpcClient, srsClient, env: {} });

  for (const tk of app.tickers) await tk.tick();

  app.start();
  assert.ok(timeouts() >= baseTimers + app.tickers.length, 'start() installs one timer per ticker');
  for (const ev of ['unit', 'gone', 'mission-load', 'game-time']) assert.ok(grpcClient.listenerCount(ev) > 0, `${ev} handler attached`);
  assert.equal(srsClient.listenerCount('status'), 1);

  app.stop();
  assert.equal(timeouts(), baseTimers, 'stop() leaves no timer behind');
  assert.equal(grpcClient.eventNames().length, baseGrpc, 'stop() detaches every grpc handler');
  assert.equal(srsClient.eventNames().length, 0);
});

test('createApp: the express app serves /js/config.js without listening', async (t) => {
  { const cap = crcLog.capture(); t.after(() => cap.stop()); }
  const app = createApp({ ...fakes(), env: {} });
  await new Promise((resolve, reject) => {
    const srv = app.http.listen(0, '127.0.0.1', async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${srv.address().port}/js/config.js`);
        assert.equal(r.status, 200);
        assert.match(await r.text(), /CASDOOR_CLIENT_ID/);
        resolve();
      } catch (e) { reject(e); } finally { srv.close(); }
    });
  });
});
