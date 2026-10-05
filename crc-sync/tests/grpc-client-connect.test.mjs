// A DCS-gRPC that does not answer: the connect attempt is bounded and retried.
//
// grpc-js opens its TCP connection with no connect timeout, so a host that drops SYNs stalls
// the channel for the kernel's SYN window (~127 s). A real SYN blackhole cannot be made in CI;
// a TCP server that accepts the socket and never speaks HTTP/2 leaves the channel CONNECTING
// the same way, and is what stands in for it here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crcLog from '../src/log.js';
import { until } from './helpers/wait.mjs';

const require = createRequire(import.meta.url);
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../protos');
const missionDef = grpc.loadPackageDefinition(protoLoader.loadSync(
  path.join(ROOT, 'dcs/mission/v0/mission.proto'), { keepCase: true, includeDirs: [ROOT] })).dcs.mission.v0.MissionService.service;
const GrpcClient = require('../src/grpc-client.js');

// Accepts TCP connections and says nothing.
async function blackhole(t, port = 0) {
  const sockets = new Set();
  const connections = [];
  const srv = net.createServer((s) => { sockets.add(s); connections.push(Date.now()); s.on('error', () => {}); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => srv.listen(port, '127.0.0.1', r));
  const stop = () => new Promise((r) => { for (const s of sockets) s.destroy(); srv.close(() => r()); });
  let stopped = false;
  const handle = { port: srv.address().port, connections, stop: async () => { if (!stopped) { stopped = true; await stop(); } } };
  t.after(() => handle.stop());
  return handle;
}

function clientFor(t, port, opts = {}) {
  const cap = crcLog.capture();
  t.after(() => cap.stop());
  const c = new GrpcClient({
    env: { DCS_GRPC_HOST: `127.0.0.1:${port}` },
    connectTimeoutMs: 200, backoffBaseMs: 20, backoffCapMs: 50, connectBackoffCapMs: 50, ...opts,
  });
  t.after(() => c.close());
  c.connect();
  return { c, cap };
}

test('an attempt that never reaches READY is abandoned and retried on a fresh connection, within the bound', async (t) => {
  const hole = await blackhole(t);
  const { c, cap } = clientFor(t, hole.port);
  await until(() => hole.connections.length >= 3, 15000);
  assert.equal(c.getStatus() !== 'connected', true);
  // Each connection is a NEW socket (private subchannel pool), one bound plus the pause apart.
  // A timer never fires early, so the gap is checked from below; the upper bound is generous for a loaded machine.
  for (let i = 1; i < 3; i++) {
    const gap = hole.connections[i] - hole.connections[i - 1];
    assert.ok(gap >= 100, `gap ${gap} ms is far shorter than the bound`);
    assert.ok(gap < 5000, `gap ${gap} ms: the attempt was not abandoned`);
  }
  const lines = cap.records.filter((r) => r.message.includes('connection attempt'));
  assert.equal(lines.length, 1, 'first abandon logged, the rest summarised once a minute: ' + lines.map((r) => r.line).join(' | '));
});

test('once DCS answers, the client connects and streams units within one bound', async (t) => {
  const hole = await blackhole(t);
  const { c } = clientFor(t, hole.port);
  await until(() => hole.connections.length >= 2, 15000);

  // DCS comes up on the same port.
  await hole.stop();
  const server = new grpc.Server();
  server.addService(missionDef, {
    StreamUnits(call) {
      call.on('error', () => {});
      call.write({ time: 1, unit: { id: 7, name: 'u7', callsign: 'c7', coalition: 'COALITION_BLUE', type: 'F-16C', position: { lat: 35, lon: 36, alt: 100 }, group: { category: 'GROUP_CATEGORY_AIRPLANE' } } });
    },
    StreamEvents(call) { call.on('error', () => {}); },
    GetScenarioCurrentTime(_c, cb) { cb(null, { datetime: '2026-09-30T12:00:00Z' }); },
  });
  await new Promise((resolve, reject) => server.bindAsync(`127.0.0.1:${hole.port}`, grpc.ServerCredentials.createInsecure(), (e) => e ? reject(e) : resolve()));
  t.after(() => server.forceShutdown());

  const up = Date.now();
  let seen = null;
  c.on('unit', (u) => { seen = seen || u; });
  await until(() => seen, 15000);
  assert.equal(seen.id, 7);
  assert.ok(Date.now() - up < 200 + 50 + 3000, `took ${Date.now() - up} ms`);
  assert.equal(c.getStatus(), 'connected');
});

test('close() stops the abandon loop and leaves no timers', async (t) => {
  const hole = await blackhole(t);
  const { c } = clientFor(t, hole.port);
  await until(() => hole.connections.length >= 2, 15000);
  c.close();
  const n = hole.connections.length;
  for (const k of ['_connectTimer', '_rebuildTimer', '_unitTimer', '_eventTimer', '_statusTimer', '_missionRetryTimer',
    '_weatherTimer', '_gameTimeTimer', '_keepaliveTimer']) assert.equal(c[k], null, k);
  assert.equal(c._channel, null);
  await new Promise((r) => setTimeout(r, 700)); // three bounds
  assert.equal(hole.connections.length, n, 'no new attempt after close');
});
