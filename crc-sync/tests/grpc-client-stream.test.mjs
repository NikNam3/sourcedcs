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

const require = createRequire(import.meta.url);
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../protos');
const missionPkg = grpc.loadPackageDefinition(protoLoader.loadSync(
  path.join(ROOT, 'dcs/mission/v0/mission.proto'), { keepCase: true, includeDirs: [ROOT] }));
const missionDef = missionPkg.dcs.mission.v0.MissionService.service;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function until(pred, ms = 3000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await sleep(10);
  }
}

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
  const logged = [];
  for (const k of ['log', 'warn', 'error']) {
    t.mock.method(console, k, (...a) => { logged.push(a.join(' ')); });
  }
  return logged;
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
  const c = startClient(t);
  let units = 0;
  c.on('unit', () => units++);
  await sleep(5000);
  assert.equal(fake.unitCalls.length, 1);
  assert.equal(c.getStatus(), 'connected');
  assert.ok(units >= 3);
});
