// The DCS unit stream against an in-process fake of DCS-gRPC's MissionService
// (docs/parallel/research/grpc-reconnect-loop.md).
//
// The fake mimics rust-server's stream_units(): a full sync of every unit,
// then, when the request carried poll_rate 0, the tokio interval panic that
// drops the sender and ends the RPC with status OK. The real GrpcClient is
// driven against it over a real HTTP/2 connection.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crcLog from '../src/log.js';
import { sleep, until } from './helpers/wait.mjs';

const require = createRequire(import.meta.url);
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../protos');
const missionPkg = grpc.loadPackageDefinition(protoLoader.loadSync(
  path.join(ROOT, 'dcs/mission/v0/mission.proto'), { keepCase: true, includeDirs: [ROOT] }));
const missionDef = missionPkg.dcs.mission.v0.MissionService.service;

// ── The fake DCS-gRPC ────────────────────────────────────────────────────────

const unitMsg = (id) => ({
  time: 1,
  unit: {
    id, name: `u${id}`, callsign: `c${id}`, coalition: 'COALITION_BLUE', type: 'SA-11 Buk LN 9A310M1',
    position: { lat: 35, lon: 36, alt: 100 }, group: { category: 'GROUP_CATEGORY_GROUND' },
  },
});

// Emulates stream_units(): full sync, then the zero-interval panic.
function dcsStreamUnits(ids) {
  return (call, pollRate) => {
    for (const id of ids) call.write(unitMsg(id));
    if (pollRate === 0) call.end(); // task panicked, tx dropped: status OK
    // otherwise steady state: an unchanged unit is never sent again
  };
}

const fake = {
  unitCalls: [],   // { at, bytes }
  eventCalls: [],  // { at }
  unitCall: null,  // the live StreamUnits call
  onStreamUnits: dcsStreamUnits([1, 2, 3]),
  onStreamEvents: () => {}, // hold open
  reset(onStreamUnits, onStreamEvents = () => {}) {
    this.unitCalls = []; this.eventCalls = []; this.unitCall = null;
    this.onStreamUnits = onStreamUnits; this.onStreamEvents = onStreamEvents;
  },
};

const server = new grpc.Server();
server.addService(
  // Raw request bytes, so the test sees exactly what went on the wire.
  { ...missionDef, StreamUnits: { ...missionDef.StreamUnits, requestDeserialize: b => b } },
  {
    StreamUnits(call) {
      const bytes = Buffer.from(call.request);
      fake.unitCalls.push({ at: Date.now(), bytes });
      fake.unitCall = call;
      call.on('error', () => {}); // client cancels on close
      // field 1 (poll_rate) is varint tag 0x08
      const pollRate = bytes[0] === 0x08 ? bytes[1] : undefined;
      fake.onStreamUnits(call, pollRate);
    },
    StreamEvents(call) {
      fake.eventCalls.push({ at: Date.now() });
      call.on('error', () => {});
      fake.onStreamEvents(call);
    },
    GetScenarioCurrentTime(_call, cb) { cb(null, { datetime: '2026-09-30T12:00:00Z' }); },
  },
);
const port = await new Promise((resolve, reject) =>
  server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (e, p) => e ? reject(e) : resolve(p)));
after(() => server.forceShutdown());

// grpc-client.js reads its env when it loads.
process.env.DCS_GRPC_HOST = `127.0.0.1:${port}`;
delete process.env.DCS_GRPC_POLL_RATE;
delete process.env.DCS_GRPC_MAX_BACKOFF;
const GrpcClient = require('../src/grpc-client.js');

// Everything else connect() starts (mission data, weather) is unimplemented
// on the fake and complains; keep that out of the test output and let a test
// read what the unit stream logged.
function quietConsole(t) {
  const cap = crcLog.capture();
  t.after(() => cap.stop());
  return cap;
}

function startClient(t, opts) {
  const c = new GrpcClient(opts);
  t.after(() => c.close());
  c.connect();
  return c;
}

// ── 1. A valid poll rate ─────────────────────────────────────────────────────

test('StreamUnits asks for a non-zero poll_rate and a max_backoff (never 0x0800)', async (t) => {
  quietConsole(t);
  fake.reset(dcsStreamUnits([1, 2, 3]));
  startClient(t);
  await until(() => fake.unitCalls.length >= 1);
  const b = fake.unitCalls[0].bytes;
  assert.equal(b[0], 0x08, 'poll_rate present');
  assert.ok(b[1] >= 1, `poll_rate is ${b[1]}`);
  assert.equal(b.subarray(0, 4).toString('hex'), '08011005', 'poll_rate 1, max_backoff 5 by default');
});

// ── 2. No re-sync loop ───────────────────────────────────────────────────────

test('a held-open unit stream is asked for exactly once', async (t) => {
  quietConsole(t);
  fake.reset(dcsStreamUnits([1, 2, 3]));
  // A 50 ms reconnect floor instead of 1 s: a stream that ended and was re-asked would show within a few of these, so the
  // old 5 s hold is not needed to prove "exactly once".
  const c = startClient(t, { backoffBaseMs: 50, backoffCapMs: 100 });
  let units = 0;
  c.on('unit', () => units++);
  await until(() => units >= 3);
  await sleep(500);
  assert.equal(fake.unitCalls.length, 1);
  assert.equal(c.getStatus(), 'connected');
  assert.ok(units >= 3);
});

// ── 3. Stationary units survive; gone is delivered; a lost stream ages out ───

test('unchanged units outlive the 12 s reaper, gone removes one at once, a lost stream lets them expire', async (t) => {
  quietConsole(t);
  const TrackStore = require('../src/tracks.js');
  // The steady state: 3 units sent once, never again.
  fake.reset(dcsStreamUnits([1, 2, 3]));
  const c = startClient(t, { keepaliveMs: 50 });
  const store = new TrackStore();
  c.on('unit', (u) => store.update(u));
  c.on('gone', (id) => store.remove(id));

  // TrackStore dates everything with Date.now; move it by hand.
  const realNow = Date.now;
  let offset = 0;
  t.mock.method(Date, 'now', () => realNow() + offset);

  await until(() => store.getAll().length === 3);
  const syncs = fake.unitCalls.length;

  offset += 13000; // 13 s with no change from DCS
  await sleep(200); // a few keepalive ticks
  assert.equal(store.expireStale(), 0);
  assert.deepEqual(store.getAll().map(u => u.id).sort(), [1, 2, 3]);
  assert.equal(fake.unitCalls.length, syncs, 'kept alive without a re-sync');

  // DCS-gRPC reports a unit gone: it leaves at once, not 12 s later.
  fake.unitCall.write({ time: 2, gone: { id: 2, name: 'u2' } });
  await until(() => !store.get(2));
  offset += 13000;
  await sleep(200);
  assert.equal(store.expireStale(), 0);
  assert.equal(store.get(2), null, 'a gone unit is not resurrected by the keepalive');

  // The stream is lost, and the next one never comes back with data: nothing
  // is kept alive, so the reaper takes the rest.
  fake.onStreamUnits = () => {};
  fake.unitCall.end();
  await until(() => c.getStatus() !== 'connected');
  offset += 13000;
  await sleep(200);
  assert.equal(store.expireStale(), 2);
  assert.equal(store.getAll().length, 0);
});

// ── 4. Backoff, and one 'ended' line a minute ───────────────────────────────

// Load-robust by construction: these tests assert on the delays the client COMPUTED (every call of _backoffDelay with
// its retry index and answer), never on how long a real timer happened to take on a busy machine. A gap between two
// real calls can only be longer than the delay (a timer never fires early), so it is checked from below only.
function trackBackoff(t) {
  const calls = [];
  const real = GrpcClient.prototype._backoffDelay;
  t.mock.method(GrpcClient.prototype, '_backoffDelay', function (retries) {
    const delay = real.call(this, retries);
    calls.push({ retries, delay });
    return delay;
  });
  return calls;
}

// Each delay sits in its jitter window [50 %, 100 %] of min(cap, base*2^k), never below the base.
function assertWindow({ retries, delay }, base, cap) {
  const nominal = Math.min(cap, base * 2 ** retries);
  assert.ok(delay >= Math.max(base, Math.round(nominal / 2)) && delay <= nominal,
    `retry ${retries}: ${delay} ms outside [${nominal / 2}, ${nominal}]`);
}

test('the backoff delay is min(cap, base*2^n) jittered to 50-100 %, from a scripted jitter source', () => {
  const base = 50, cap = 400;
  const at = (r) => new GrpcClient({ backoffBaseMs: base, backoffCapMs: cap, random: () => r });
  const low = at(0), high = at(0.999999);
  const nominal = (k) => Math.min(cap, base * 2 ** k);
  for (let k = 0; k < 12; k++) {
    assert.equal(low._backoffDelay(k), Math.max(base, Math.round(nominal(k) / 2)), `retry ${k} at the bottom of the window`);
    assert.equal(high._backoffDelay(k), nominal(k), `retry ${k} at the top of the window`);
    if (k > 0) assert.ok(low._backoffDelay(k) >= low._backoffDelay(k - 1), `retry ${k} shrank at the bottom of the window`);
    if (k > 0) assert.ok(high._backoffDelay(k) >= high._backoffDelay(k - 1), `retry ${k} shrank at the top of the window`);
  }
  low.close(); high.close();
});

test('a stream the server ends straight away is retried with growing, jittered delays and logged once', async (t) => {
  const sink = quietConsole(t);
  const delays = trackBackoff(t);
  const base = 50, cap = 400;
  // Data then an OK end every time, exactly what poll_rate 0 did: data on its
  // own must not reset the backoff.
  fake.reset(
    (call) => { call.write(unitMsg(1)); call.end(); },
    (call) => { call.end(); },
  );
  startClient(t, { keepaliveMs: 50, backoffBaseMs: base, backoffCapMs: cap });
  await until(() => fake.unitCalls.length >= 8 && fake.eventCalls.length >= 8, 20000);

  // Two streams, so each retry index appears once per stream, and it only grows until the cap.
  for (const d of delays) assertWindow(d, base, cap);
  for (let k = 0; k < 7; k++) assert.ok(delays.filter(d => d.retries === k).length >= 2, `retry ${k} happened for both streams: ${delays.map(d => d.retries).join(',')}`);

  const ended = sink.records.filter(r => r.message.includes('unit stream ended'));
  assert.equal(ended.length, 1, `one line in the first minute, got: ${ended.map(r => r.line).join(' | ')}`);
});

test('a stream that stayed up resets the backoff', async (t) => {
  quietConsole(t);
  const delays = trackBackoff(t);
  const base = 50, cap = 400, stableMs = 300;
  let n = 0;
  // Four immediate ends, one stream that holds 400 ms, then immediate ends again.
  fake.reset((call) => {
    n++;
    call.write(unitMsg(1));
    if (n === 5) setTimeout(() => call.end(), stableMs + 100);
    else call.end();
  });
  startClient(t, { backoffBaseMs: base, backoffCapMs: cap, stableMs });
  await until(() => fake.unitCalls.length >= 7, 20000);
  // The unit stream's retry indexes: 0, 1, 2, 3 after the four quick ends; the fifth stream lived past stableMs, so
  // the index restarts at 0 and grows again (without the reset they would be 4 and 5, at the cap).
  // (The event stream, held open by the fake, never retries.)
  assert.deepEqual(delays.slice(0, 6).map(d => d.retries), [0, 1, 2, 3, 0, 1], delays.map(d => d.retries).join(','));
  for (const d of delays) assertWindow(d, base, cap);
});

test('the reconnect delay never drops below the base, so the rate has a floor', async (t) => {
  const c = new GrpcClient({ backoffBaseMs: 100, backoffCapMs: 800 });
  t.after(() => c.close());
  for (let n = 0; n < 6; n++) {
    for (let i = 0; i < 200; i++) assert.ok(c._backoffDelay(n) >= 100, `retry ${n} went below the floor`);
  }
});
