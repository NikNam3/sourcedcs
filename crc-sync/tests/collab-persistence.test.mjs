// docs/adr/0094: the collaborative overlay survives a crc-sync restart onto the
// same running DCS mission, survives a gRPC reconnect, and does not survive a
// DCS restart or mission reload. The unit unit stream is the real GrpcClient
// against an in-process fake of DCS-gRPC (as tests/grpc-client-stream.test.mjs);
// the wiring is src/collab-wiring.js, the same call server.js makes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../protos');
const missionPkg = grpc.loadPackageDefinition(protoLoader.loadSync(
  path.join(ROOT, 'dcs/mission/v0/mission.proto'), { keepCase: true, includeDirs: [ROOT] }));
const missionDef = missionPkg.dcs.mission.v0.MissionService.service;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(pred, ms = 4000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await sleep(10);
  }
}

// ── fake DCS-gRPC: whatever `fake.units` holds is streamed on each StreamUnits ──
const fake = { units: [], calls: [] };
const unitMsg = (u) => ({
  time: 1,
  unit: {
    id: u.id, name: u.name, callsign: u.name, coalition: 'COALITION_RED', type: u.type,
    position: { lat: 35, lon: 36, alt: 5000 }, group: { category: 'GROUP_CATEGORY_AIRPLANE' },
  },
});
const server = new grpc.Server();
server.addService(missionDef, {
  StreamUnits(call) {
    fake.calls.push(call);
    call.on('error', () => {});
    for (const u of fake.units) call.write(unitMsg(u));
  },
  StreamEvents(call) { call.on('error', () => {}); },
  GetScenarioCurrentTime(_c, cb) { cb(null, { datetime: '2026-09-30T12:00:00Z' }); },
});
const port = await new Promise((res, rej) =>
  server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (e, p) => e ? rej(e) : res(p)));
after(() => server.forceShutdown());
process.env.DCS_GRPC_HOST = `127.0.0.1:${port}`;
const GrpcClient = require('../src/grpc-client.js');
const TrackStore = require('../src/tracks.js');
const CollaborativeStore = require('../src/collab-store.js');
const { MissionSession } = require('../src/mission-session.js');
const { wireCollabSession } = require('../src/collab-wiring.js');

const MISSION = { theatre: 'Syria', waypoints: [{ name: 'A' }], drawings: [], airports: [] };
const VIPER = { id: 101, name: 'Viper 1-1', type: 'F-16C_50' };
const BEAR = { id: 102, name: 'Bear 1-1', type: 'Tu-95MS' };

// One crc-sync process: the same stores and wiring server.js builds.
function boot(t, dir, { grace = 150 } = {}) {
  const clock = { source: 'MISSION', t: 1_000_000, now() { return this.t; } };
  const trackStore = new TrackStore();
  const collab = new CollaborativeStore({
    persist: true, path: path.join(dir, 'collab.json'), identityOf: (id) => trackStore.get(id), clockGraceMs: grace,
  });
  const session = new MissionSession({ path: path.join(dir, 'session.json'), clock });
  const grpcClient = new GrpcClient({ backoffBaseMs: 50, backoffCapMs: 50 });
  for (const k of ['log', 'warn', 'error']) t.mock.method(console, k, () => {});
  grpcClient.on('unit', (u) => trackStore.update(u));
  grpcClient.on('mission-start', () => session.noteMissionStart());
  grpcClient.on('mission-load', (m) => session.noteMissionLoad(m));
  grpcClient.on('game-time', () => session.observeClock());
  wireCollabSession({ grpcClient, missionSession: session, collabStore: collab });
  const p = {
    clock, trackStore, collab, session, grpcClient,
    // what GetScenarioCurrentTime + the mission fetch do on a real connect
    announce(minutes = 0) {
      clock.t += minutes * 60000;
      grpcClient.emit('mission-load', MISSION);
      grpcClient.emit('game-time');
    },
    stop() { grpcClient.close(); collab.close(); },
  };
  t.after(() => p.stop());
  grpcClient.connect();
  return p;
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'collab-'));
const streamed = (p, ...ids) => until(() => ids.every(id => p.trackStore.get(id)));

test('declare, restart crc-sync against the same running mission: still declared', async (t) => {
  const dir = tmp();
  fake.units = [VIPER, BEAR];
  const a = boot(t, dir);
  await streamed(a, 101, 102);
  a.announce();
  a.collab.declare('101', 'hostile', 'Alice');
  a.collab.rename('102', 'bomber one', 'Bob');
  a.stop();

  const b = boot(t, dir);
  assert.equal(b.collab.get('101'), null, 'held back until the session is confirmed');
  await streamed(b, 101, 102);
  b.announce(1);
  assert.equal(b.session.currentSeq(), a.session.currentSeq(), 'same mission session');
  assert.equal(b.collab.get('101').iff.state, 'hostile');
  assert.equal(b.collab.get('102').rename.value, 'BOMBER ONE');
});

test('DCS restarted while crc-sync was down (same .miz, clock steps back): gone', async (t) => {
  const dir = tmp();
  fake.units = [VIPER];
  const a = boot(t, dir);
  await streamed(a, 101);
  a.announce(30); // the mission had been running a while
  a.session.observeClock(); // (announce emitted game-time; make the high-water mark explicit)
  a.collab.declare('101', 'hostile', 'Alice');
  a.stop();

  // Same .miz, same unit, same id: only the clock reveals the restart.
  const b = boot(t, dir);
  await streamed(b, 101);
  b.clock.t -= 20 * 60000;
  b.announce();
  assert.equal(b.session.currentSeq(), a.session.currentSeq() + 1);
  assert.equal(b.collab.get('101'), null);
  await sleep(300);
  assert.equal(b.collab.get('101'), null, 'and never comes back at the end of the grace');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'collab.json'), 'utf8')).entries.length, 0);
});

test('DCS restarted and the id re-minted to another unit, no session signal at all: gone', async (t) => {
  const dir = tmp();
  fake.units = [VIPER];
  const a = boot(t, dir);
  await streamed(a, 101);
  a.announce();
  a.collab.declare('101', 'friendly', 'Alice');
  a.stop();

  fake.units = [{ id: 101, name: 'Tanker 9', type: 'KC-135' }]; // id 101, a different unit
  const b = boot(t, dir);
  await streamed(b, 101);
  b.announce(1);
  await sleep(300);
  assert.equal(b.collab.get('101'), null, 'no stale colour on the re-minted unit');
});

test('mission_start while up: cleared at once, a reused id does not inherit', async (t) => {
  const dir = tmp();
  fake.units = [VIPER];
  const a = boot(t, dir);
  await streamed(a, 101);
  a.announce();
  a.collab.declare('101', 'hostile', 'Alice');
  a.grpcClient.emit('mission-start');
  assert.equal(a.collab.get('101'), null);
  a.announce();
  fake.units = [VIPER]; // the very same unit and id in the restarted mission
  await sleep(1200); // a keepalive re-emit
  assert.equal(a.collab.get('101'), null);
});

test('gRPC reconnect while DCS keeps running keeps declarations, even past the 12 s reaper', async (t) => {
  const dir = tmp();
  fake.units = [VIPER];
  fake.calls.length = 0;
  const a = boot(t, dir);
  await streamed(a, 101);
  a.announce();
  a.collab.declare('101', 'hostile', 'Alice');

  fake.calls[0].end(); // the stream drops; the client reconnects
  // The reaper meanwhile: the unit is not being streamed for the moment.
  a.trackStore.remove(101);
  assert.equal(a.collab.evictStale(new Set()), 1);
  assert.equal(a.collab.get('101'), null, 'not shown while its unit is not streamed');
  await until(() => fake.calls.length >= 2);
  await until(() => a.collab.get('101'));
  assert.equal(a.collab.get('101').iff.state, 'hostile');
});

test('crc-sync restart while the gRPC link is down, DCS then returns on the same mission: restored', async (t) => {
  const dir = tmp();
  fake.units = [VIPER];
  const a = boot(t, dir);
  await streamed(a, 101);
  a.announce();
  a.collab.declare('101', 'hostile', 'Alice');
  a.stop();
  fake.units = [];
  const b = boot(t, dir);
  await sleep(100);
  fake.units = [VIPER];
  fake.calls.at(-1).end();
  await streamed(b, 101);
  b.announce();
  await until(() => b.collab.get('101'));
});
