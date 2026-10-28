import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crcLog from '../src/log.js';
import { withPaths, APP_PATHS } from './helpers/with-paths.mjs';

// createApp (src/app.js) with fakes: what server.js, the soak host and these tests share.
// Every path points into a temp dir BEFORE anything under src/ is required.
const paths = withPaths('app-boot-', APP_PATHS, { stateDir: true, shippedConfig: true, extraEnv: { CRCSYNC_TEST_RESET: undefined } }).apply();
const tmpDir = paths.dir;
fs.writeFileSync(paths.env.CRCSYNC_EFSP_AIRSPACES_PATH, '{}');

const { createApp } = await import('../src/app.js');

// Today's timers, by name and period (server.js before AP had these as 11 bare setIntervals).
const EXPECTED = [
  ['signon-grace', 1000], ['datalink-locks', 2000], ['coverage', 250], ['clock-source', 5000], ['airport-weather', 60000], ['airspace-calendar', 60000],
  ['efsp-metrics', 60000], ['efsp-archiver', 60000], ['stale-reaper', 5000], ['obligations-nla', 15000],
  ['correlation', 1000], ['handoff-control', 1000], ['airspace-transits', 5000], ['carrier', 1000], ['par', 500], ['tofi-regime', 1000], ['conformance-conflict-alert', 1000],
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
  const app = createApp({ ...fakes(), env: { ...paths.env } });
  assert.deepEqual(app.tickers.map((x) => [x.name, x.periodMs]), EXPECTED.map(([n, p]) => [n, n === 'correlation' ? correlation : p]));
});

test('createApp: every ticker runs once, start() installs and stop() clears timers and handlers', async (t) => {
  { const cap = crcLog.capture(); t.after(() => cap.stop()); }
  const { grpcClient, srsClient } = fakes();
  const baseTimers = timeouts();
  const baseGrpc = grpcClient.eventNames().length;
  const app = createApp({ grpcClient, srsClient, env: { ...paths.env } });

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
  const app = createApp({ ...fakes(), env: { ...paths.env } });
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
