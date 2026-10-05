import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crcLog from '../src/log.js';
import { withPaths, APP_PATHS } from './helpers/with-paths.mjs';

// The mission reset (docs/adr/0108, decisions.md H108): a DCS crash or a mission restart clears the Board, a reconnect or a crc-sync
// restart into the same mission does not. createApp with a fake gRPC client, so the real wiring (mission-session.js ->
// app.js -> efsp.resetForMission -> deliverEfsp -> the archiver's roll-over sweep) is what is judged. Every path points into a
// temp dir BEFORE anything under src/ is required.

const paths = withPaths('mission-reset-', APP_PATHS, { stateDir: true, shippedConfig: true, extraEnv: { CRCSYNC_TEST_RESET: undefined } }).apply();
const tmpDir = paths.dir;

const { createApp } = await import('../src/app.js');
const { crew, mustAct, airborneDeparture, handedToCenter, mustCarrierAct, mustSfaAct, DEPARTURE_FLIGHT_DATA } = await import('./helpers/efsp-scenario.mjs');

const A = { theatre: 'Syria', waypoints: [{ name: 'INCIRLIK' }], drawings: [{ name: 'MOA 1' }], airports: [] };
const B = { theatre: 'Syria', waypoints: [{ name: 'INCIRLIK' }], drawings: [{ name: 'MOA 2' }], airports: [] };
const STAFF = { OPS: 'INCIRLIK', AP: 'INCIRLIK', LC: 'INCIRLIK', CTR: 'CENTER', CV_PRIFLY: 'CARRIER' };
// In-game local times (Syria is UTC+3): the clock the 5 s poll reports.
const T = (hhmm) => `2016-06-21T${hhmm}:00`;

function quiet() { const cap = crcLog.capture(); return cap; }

function wipeState() {
  for (const [k, v] of Object.entries(APP_PATHS)) {
    if (k === 'CRCSYNC_CONFIG_DIR' || k === 'CRCSYNC_TERRAIN_CACHE_DIR' || k.startsWith('CRCSYNC_EFSP_FACILITY')) continue;
    fs.rmSync(path.join(tmpDir, v), { force: true });
  }
  fs.writeFileSync(path.join(tmpDir, APP_PATHS.CRCSYNC_EFSP_AIRSPACES_PATH.split('/').pop()), '{}');
}

/** An app on a fake gRPC client, started, with every frame it delivers captured. */
function boot() {
  const grpcClient = Object.assign(new EventEmitter(), { getWeather: () => ({}), evalLua: async () => null, getAptWeather: async () => ({}) });
  const srsClient = new EventEmitter();
  const app = createApp({ grpcClient, srsClient, env: { ...paths.env } });
  const frames = [];
  const real = app.wsHub.deliverEfsp.bind(app.wsHub);
  app.wsHub.deliverEfsp = (f) => { frames.push(...[].concat(f)); return real(f); };
  app.start();
  return { app, grpcClient, frames, c: crew(app.efsp, STAFF) };
}

const live = (efsp) => ['INCIRLIK', 'CENTER', 'TACTICAL', 'CARRIER'].flatMap(f => (efsp.boardStoreFor(f) ? efsp.boardStoreFor(f).getAll() : []).filter(s => s.state !== 'DROPPED'));
const runwayStatus = (efsp) => efsp.runwayStatusStore.getRunwayStatus('INCIRLIK');

/** A running mission with a busy Board: two flights, one of them handed to CENTER, a closed runway, a carrier Case, an SFA rotation. */
function seed(h) {
  const { app, c } = h;
  const efsp = app.efsp;
  const one = airborneDeparture(efsp, c);
  handedToCenter(efsp, c, one);
  airborneDeparture(efsp, c, { ...DEPARTURE_FLIGHT_DATA, callsign: 'COBRA2' });
  const rs = runwayStatus(efsp);
  const closed = efsp.handleMessage(c.LC.session, {
    version: 1, type: 'efsp-runway-status-mutation', clientMutationId: crypto.randomUUID(), facilityId: 'INCIRLIK',
    baseRev: rs.rev, actingPositionId: 'LC', op: { kind: 'CloseRunway', runwayId: rs.runways[0].runwayId },
  }).ack;
  assert.equal(closed.ok, true, JSON.stringify(closed));
  mustCarrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCase', to: 'II' });
  mustSfaAct(efsp, c.AP, 'AP', { kind: 'SetSfaRotation', rackId: 'freq-4', positionId: 'PAR' });
  assert.ok(live(efsp).length >= 3, 'the Board has live Strips');
  assert.equal(runwayStatus(efsp).runways[0].status, 'CLOSED');
}

/** A mission is loaded and the clock reads `hhmm`. */
function run(h, mission, hhmm) {
  h.grpcClient.emit('mission-load', mission);
  h.grpcClient.emit('game-time', T(hhmm));
}

function assertUntouched(h) {
  const efsp = h.app.efsp;
  assert.ok(live(efsp).length >= 3, 'the live Strips are still there');
  assert.equal(runwayStatus(efsp).runways[0].status, 'CLOSED');
  assert.equal(efsp.carrierStore.caseValue(), 'II');
  assert.equal(h.frames.length, 0, 'nothing was delivered');
  assert.equal(efsp.mutationLog.readAll().filter(e => e.op === 'MissionReset').length, 0);
}

function assertCleared(h) {
  const efsp = h.app.efsp;
  assert.equal(live(efsp).length, 0, 'every live Strip is DROPPED');
  assert.equal(runwayStatus(efsp).runways[0].status, 'OPEN', 'the runway works are over');
  assert.equal(efsp.carrierStore.caseValue(), efsp.carrierStore._fresh(efsp.carrierStore.defaultHullId).recoveryCase.value);
  assert.equal(efsp.sfaStore.positionOn('freq-4') === 'PAR', false);
}

function boardFrames(h) { return h.frames.filter(f => f.type === 'efsp-board-delta'); }

test('same mission: a gRPC reconnect (another mission-load) clears nothing', (t) => {
  const cap = quiet(); t.after(() => cap.stop());
  wipeState();
  const h = boot(); t.after(() => h.app.stop());
  run(h, A, '05:40');
  seed(h);
  h.grpcClient.emit('game-time', T('05:41'));
  run(h, A, '05:41'); // DCS-gRPC reconnects: another mission-load, same fingerprint, the clock carried on
  run(h, A, '05:42');
  assert.equal(h.app.missionSession.currentSeq(), 1);
  assertUntouched(h);
});

test('crc-sync restart with the persisted Board onto the same running mission clears nothing', (t) => {
  const cap = quiet(); t.after(() => cap.stop());
  wipeState();
  const first = boot();
  run(first, A, '05:40');
  seed(first);
  first.app.efsp.persist();
  first.app.stop();

  const h = boot(); t.after(() => h.app.stop());
  assert.ok(live(h.app.efsp).length >= 3, 'the Board came back from disk');
  run(h, A, '05:47'); // the mission has run on while crc-sync was down
  run(h, A, '05:48');
  assert.equal(h.app.missionSession.currentSeq(), 1);
  assert.ok(live(h.app.efsp).length >= 3);
  assert.equal(runwayStatus(h.app.efsp).runways[0].status, 'CLOSED');
  assert.equal(h.app.efsp.mutationLog.readAll().filter(e => e.op === 'MissionReset').length, 0);
});

test('a different mission (changed fingerprint) clears the Board in one audited pass per Board and tells every client', (t) => {
  const cap = quiet(); t.after(() => cap.stop());
  wipeState();
  const h = boot(); t.after(() => h.app.stop());
  run(h, A, '05:40');
  seed(h);
  const airspaces = h.app.efsp.airspaceStore.getAll().length;
  const log0 = h.app.efsp.mutationLog.readAll().length;
  const carrierSeq = h.app.efsp.carrierStore.currentSeq;

  run(h, B, '02:40');
  assertCleared(h);
  const entries = h.app.efsp.mutationLog.readAll().slice(log0);
  const summaries = entries.filter(e => e.op === 'MissionReset' && e.strips !== undefined);
  assert.ok(summaries.length >= 2, 'one summary line per Board that had Strips (INCIRLIK and CENTER)');
  assert.ok(summaries.every(e => e.actorId === 'system' && e.actingPositionId === null && e.reason === 'mission-reset'));
  assert.equal(summaries.reduce((n, e) => n + e.strips, 0) > 0, true);
  assert.ok(entries.filter(e => e.op === 'MissionResetStrip').every(e => e.before.state !== 'DROPPED' && e.after.state === 'DROPPED'));
  // the traffic count reads those drops like any other
  assert.ok(entries.some(e => e.op === 'MissionResetStrip'));
  // the clients converge through the ordinary deltas
  const deltas = boardFrames(h);
  assert.ok(deltas.length >= 1);
  const gone = new Set(deltas.flatMap(f => f.strips.gone));
  assert.ok(gone.size >= 3, 'the dropped Strips are `gone` in the deltas');
  // DESK-NOTICES (H108): the reset's own deltas say so, with the count each Board dropped (the archiver's later deltas do not)
  const marked = deltas.filter(f => f.missionReset);
  assert.ok(marked.length >= 2 && marked.length < deltas.length + 1);
  assert.ok(marked.every(f => Number.isFinite(f.missionReset.at) && f.missionReset.strips > 0));
  assert.equal(marked.reduce((n, f) => n + f.missionReset.strips, 0), summaries.reduce((n, e) => n + e.strips, 0));
  assert.ok(h.frames.some(f => f.type === 'efsp-runway-status-delta'));
  assert.ok(h.frames.some(f => f.type === 'efsp-carrier-delta' && f.carrierSeq > carrierSeq));
  assert.ok(h.frames.some(f => f.type === 'efsp-sfa-delta'));
  // configuration is untouched
  assert.equal(h.app.efsp.airspaceStore.getAll().length, airspaces);
  // persisted
  const saved = JSON.parse(fs.readFileSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, 'utf8'));
  assert.equal(Object.values(saved.boards).flatMap(b => b.strips).filter(s => s.state !== 'DROPPED').length, 0);
});

test('mission_start with a different mission clears at once', (t) => {
  const cap = quiet(); t.after(() => cap.stop());
  wipeState();
  const h = boot(); t.after(() => h.app.stop());
  run(h, A, '05:40');
  seed(h);
  h.grpcClient.emit('mission-start');
  h.grpcClient.emit('mission-load', B);
  assertCleared(h);
});

test('a bare mission_start for the SAME mission does not clear (a reconnect that replays one)', (t) => {
  const cap = quiet(); t.after(() => cap.stop());
  wipeState();
  const h = boot(); t.after(() => h.app.stop());
  run(h, A, '05:40');
  seed(h);
  // 1. a spurious mission_start: same fingerprint, the clock carries on
  h.grpcClient.emit('mission-start');
  h.grpcClient.emit('mission-load', A);
  h.grpcClient.emit('game-time', T('05:41'));
  h.grpcClient.emit('game-time', T('05:42'));
  assert.equal(h.app.missionSession.current().reason, 'MISSION_START', 'it is a new session (the existing decision)');
  assertUntouched(h);
});

test('mission_start for the same .miz, then the clock back at the mission start, clears', (t) => {
  const cap = quiet(); t.after(() => cap.stop());
  wipeState();
  const h = boot(); t.after(() => h.app.stop());
  run(h, A, '05:40');
  h.grpcClient.emit('game-time', T('05:50'));
  seed(h);
  h.grpcClient.emit('mission-start');
  h.grpcClient.emit('mission-load', A);
  assert.ok(live(h.app.efsp).length >= 3, 'the load alone does not clear it');
  h.grpcClient.emit('game-time', T('05:50')); // the stale reading before DCS reports the restarted clock
  assert.ok(live(h.app.efsp).length >= 3);
  h.grpcClient.emit('game-time', T('02:40')); // the .miz restarted: back at its start
  assertCleared(h);
  assert.equal(h.app.efsp.mutationLog.readAll().filter(e => e.op === 'MissionReset' && e.strips !== undefined).length >= 2, true);
});

test('the mission clock stepping back more than 5 min (a restart crc-sync did not see) clears; a short pause step does not', (t) => {
  const cap = quiet(); t.after(() => cap.stop());
  wipeState();
  const h = boot(); t.after(() => h.app.stop());
  run(h, A, '05:40');
  h.grpcClient.emit('game-time', T('05:50'));
  seed(h);
  h.grpcClient.emit('game-time', T('05:49')); // a paused mission: one poll behind
  assertUntouched(h);
  h.grpcClient.emit('game-time', T('05:30')); // 20 min back
  assert.equal(h.app.missionSession.current().reason, 'CLOCK_STEP_BACK');
  assertCleared(h);
});

test('a reset of an empty Board delivers no Strip delta and writes no Strip entries', (t) => {
  const cap = quiet(); t.after(() => cap.stop());
  wipeState();
  const h = boot(); t.after(() => h.app.stop());
  run(h, A, '05:40');
  seed(h);
  run(h, B, '02:40');
  assertCleared(h);
  const n = boardFrames(h).length;
  const log0 = h.app.efsp.mutationLog.readAll().length;
  run(h, A, '02:41'); // another mission again, on an empty Board
  assert.equal(boardFrames(h).length, n, 'no Strip delta');
  assert.equal(h.app.efsp.mutationLog.readAll().slice(log0).filter(e => e.op === 'MissionResetStrip').length, 0);
});

test('a TOFI exchange in ACTIVE state does not block the reset (the flight no longer exists)', (t) => {
  const cap = quiet(); t.after(() => cap.stop());
  wipeState();
  const h = boot(); t.after(() => h.app.stop());
  run(h, A, '05:40');
  const strip = airborneDeparture(h.app.efsp, h.c);
  const board = h.app.efsp.boardStoreFor('INCIRLIK');
  board.getStrip(strip.stripId).tofiCoordination = { direction: 'OUT', state: 'ACTIVE', peerFacilityId: 'TACTICAL', peerStripId: 'x' };
  const r = board.resetForMission({ session: { seq: 9, reason: 'TEST' } });
  assert.deepEqual(r.dropped, [strip.stripId]);
  assert.equal(board.getStrip(strip.stripId).state, 'DROPPED');
});
