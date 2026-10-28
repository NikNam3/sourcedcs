import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import crcLog from '../src/log.js';
import { withPaths, APP_PATHS } from './helpers/with-paths.mjs';

// docs/adr/0141 (H164 FT-Q6): what crc-sync itself costs. The sampler on fake clocks, its thresholds, the tuning file,
// and the two places it is read: GET /api/server/resources and the `serverResources` block of the efsp-metrics answer.
const paths = withPaths('server-resources-', APP_PATHS, { stateDir: true, shippedConfig: true, extraEnv: { CRCSYNC_TEST_RESET: undefined } }).apply();
fs.writeFileSync(paths.env.CRCSYNC_EFSP_AIRSPACES_PATH, '{}');

const { createServerResources, loadServerResourcesConfig } = await import('../src/server-resources.js');
const { createApp } = await import('../src/app.js');

const CONFIG = { sampleMs: 1000, windowMs: 3000, warn: { cpuPct: 80, eventLoopP99Ms: 100, rssMb: 1024, tickMaxMs: 50 } };
const MB = 1024 * 1024;

/** A sampler on a hand-driven clock: `hr` is the monotonic ms, `cpuUs` the process's cumulative CPU. */
function rig({ config = CONFIG, loop = () => ({ p50Ms: 2, p99Ms: 10, maxMs: 20 }) } = {}) {
  const s = { hr: 0, cpuUs: 0, rss: 200 * MB, wall: 1_700_000_000_000 };
  const r = createServerResources({
    config,
    counts: () => ({ sessions: 3, tracks: 20 }),
    wallClock: { now: () => s.wall },
    hrNow: () => s.hr,
    cpuUsage: () => ({ user: s.cpuUs, system: 0 }),
    memoryUsage: () => ({ rss: s.rss, heapUsed: 50 * MB, heapTotal: 80 * MB, external: 5 * MB }),
    eventLoop: { enable() {}, disable() {}, take: loop },
  });
  return { s, r };
}

/** One sampler second: `cpuMs` of CPU, then a sample. */
function second({ s, r }, cpuMs) { s.hr += 1000; s.cpuUs += cpuMs * 1000; r.sample(); }

test('CPU is the cumulative cpuUsage delta over the wall interval, averaged over the window, with the worst sample', () => {
  const x = rig();
  second(x, 200); // 20 %
  second(x, 600); // 60 %
  const snap = x.r.snapshot();
  assert.deepEqual(snap.cpu, { pct: 40, maxPct: 60 });
  assert.equal(snap.samples, 2);
  assert.equal(snap.windowMs, 2000);
});

test('the window is a ring: an old sample falls out once windowMs/sampleMs newer ones exist', () => {
  const x = rig();
  second(x, 900); // 90 %, will fall out
  second(x, 100); second(x, 100); second(x, 100);
  const snap = x.r.snapshot();
  assert.equal(snap.samples, 3);
  assert.deepEqual(snap.cpu, { pct: 10, maxPct: 10 });
  assert.equal(snap.warn.cpu, false);
});

test('memory is the latest sample in MB; the counts are what the service carries now', () => {
  const x = rig();
  second(x, 0);
  x.s.rss = 300 * MB;
  second(x, 0);
  const snap = x.r.snapshot();
  assert.deepEqual(snap.memory, { rssMb: 300, heapUsedMb: 50, heapTotalMb: 80, externalMb: 5 });
  assert.equal(snap.sessions, 3);
  assert.equal(snap.tracks, 20);
  assert.equal(snap.sampledAt, 1_700_000_000_000);
});

test('event-loop delay: p50 the median of the samples, p99 and max the worst sample (a bad few seconds is not averaged away)', () => {
  const reads = [{ p50Ms: 1, p99Ms: 5, maxMs: 8 }, { p50Ms: 3, p99Ms: 140, maxMs: 300 }, null, { p50Ms: 2, p99Ms: 6, maxMs: 9 }];
  const x = rig({ config: { ...CONFIG, windowMs: 4000 }, loop: () => reads.shift() });
  for (let i = 0; i < 4; i++) second(x, 0);
  const snap = x.r.snapshot();
  assert.deepEqual(snap.eventLoop, { p50Ms: 2, p99Ms: 140, maxMs: 300 });
  assert.equal(snap.warn.eventLoop, true);
});

test('before the first sample there is nothing to say: null, never a 0', () => {
  const { r } = rig();
  const snap = r.snapshot();
  assert.equal(snap.cpu, null);
  assert.equal(snap.memory, null);
  assert.equal(snap.eventLoop, null);
  assert.deepEqual(snap.warn, { cpu: false, eventLoop: false, memory: false, tickers: [] });
});

test('a timed ticker: runs, mean, worst run and share of the window; slowest first; past tickMaxMs it is named in warn', () => {
  const x = rig();
  const coverage = x.r.timed({ name: 'coverage', periodMs: 250, tick: () => { x.s.hr += 10; return 'ok'; } });
  assert.equal(coverage.name, 'coverage');
  assert.equal(coverage.periodMs, 250);
  assert.equal(coverage.tick(), 'ok', 'the tick\'s own return value passes through');
  coverage.tick();
  x.r.time('hub-feed', () => { x.s.hr += 70; }, 500);
  x.s.hr += 910; // 1000 ms covered in all
  x.r.sample();
  const snap = x.r.snapshot();
  assert.deepEqual(snap.tickers, [
    { name: 'hub-feed', periodMs: 500, runs: 1, meanMs: 70, maxMs: 70, busyPct: 7 },
    { name: 'coverage', periodMs: 250, runs: 2, meanMs: 10, maxMs: 10, busyPct: 2 },
  ]);
  assert.deepEqual(snap.warn.tickers, ['hub-feed']);
});

test('ticker runs in the open slot count before the next sample (the soak never samples: its one slot is the whole run)', () => {
  const x = rig();
  x.r.time('par', () => { x.s.hr += 4; });
  x.s.hr += 96;
  const snap = x.r.snapshot();
  assert.equal(snap.samples, 0);
  assert.deepEqual(snap.tickers, [{ name: 'par', periodMs: null, runs: 1, meanMs: 4, maxMs: 4, busyPct: 4 }]);
});

test('a throwing tick still throws, and its run is still timed', () => {
  const x = rig();
  assert.throws(() => x.r.time('boom', () => { x.s.hr += 3; throw new Error('tick failed'); }), /tick failed/);
  assert.equal(x.r.snapshot().tickers[0].runs, 1);
});

test('thresholds: CPU, RSS and event loop amber only past the tuning file\'s numbers, which ride along', () => {
  const x = rig({ loop: () => ({ p50Ms: 1, p99Ms: 100, maxMs: 120 }) });
  x.s.rss = 1025 * MB;
  second(x, 810);
  const snap = x.r.snapshot();
  assert.deepEqual(snap.warn, { cpu: true, eventLoop: false, memory: true, tickers: [] }, 'p99 exactly at the threshold is not past it');
  assert.deepEqual(snap.thresholds, CONFIG.warn);
});

test('config/server-resources.json loads; a state copy layers key by key; a bad value or unknown key stops start-up', () => {
  const shipped = loadServerResourcesConfig();
  const file = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../config/server-resources.json'), 'utf8'));
  assert.deepEqual(shipped, { sampleMs: file.sampleMs, windowMs: file.windowMs, warn: file.warn });
  const dir = fs.mkdtempSync(path.join(paths.dir, 'layer-'));
  const layer = (body) => { const p = path.join(dir, `${Math.random()}.json`); fs.writeFileSync(p, JSON.stringify(body)); return p; };
  assert.equal(loadServerResourcesConfig(layer({ warn: { cpuPct: 150 } })).warn.cpuPct, 150);
  assert.equal(loadServerResourcesConfig(layer({ warn: { cpuPct: 150 } })).warn.rssMb, file.warn.rssMb);
  assert.throws(() => loadServerResourcesConfig(layer({ warn: { cpu: 1 } })), /unknown key "warn\.cpu"/);
  assert.throws(() => loadServerResourcesConfig(layer({ windowMs: 10, sampleMs: 1000 })), /windowMs/);
  assert.throws(() => loadServerResourcesConfig(layer({ warn: { tickMaxMs: 0 } })), /tickMaxMs/);
});

// ── the app's two readers ──

function fakes() {
  const grpcClient = Object.assign(new EventEmitter(), { getWeather: () => ({}), evalLua: async () => null, getAptWeather: async () => ({}) });
  return { grpcClient, srsClient: new EventEmitter() };
}
const SHAPE = ['sampledAt', 'windowMs', 'samples', 'cpu', 'memory', 'eventLoop', 'tickers', 'sessions', 'tracks', 'thresholds', 'warn'];
const token = `x.${Buffer.from(JSON.stringify({ sub: 'u1', name: 'tester' })).toString('base64url')}.y`;

test('GET /api/server/resources: behind auth; the snapshot, with every createApp ticker timed under its own name', async (t) => {
  { const cap = crcLog.capture(); t.after(() => cap.stop()); }
  const app = createApp({ ...fakes(), env: { ...paths.env } });
  for (const tk of app.tickers) await tk.tick();
  app.serverResources.sample();
  const srv = await new Promise((res) => { const s = app.http.listen(0, '127.0.0.1', () => res(s)); });
  t.after(() => srv.close());
  const url = `http://127.0.0.1:${srv.address().port}/api/server/resources`;
  assert.equal((await fetch(url)).status, 401);
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(Object.keys(body), SHAPE);
  assert.deepEqual(body.tickers.map(x => x.name).sort(), app.tickers.map(x => x.name).sort());
  for (const x of body.tickers) assert.equal(x.periodMs, app.tickers.find(k => k.name === x.name).periodMs);
  assert.equal(body.sessions, 0);
  assert.ok(body.memory.rssMb > 0);
});

test('the efsp-metrics answer carries the same snapshot as `serverResources`', async (t) => {
  { const cap = crcLog.capture(); t.after(() => cap.stop()); }
  const app = createApp({ ...fakes(), env: { ...paths.env } });
  app.serverResources.sample();
  const ack = app.efsp.handleMessage({ controllerId: 'c1' }, { version: 1, type: 'efsp-metrics-request', requestId: 'q' }).ack;
  assert.equal(ack.ok, true);
  assert.deepEqual(Object.keys(ack.serverResources), SHAPE);
  assert.equal(ack.serverResources.samples, 1);
});
