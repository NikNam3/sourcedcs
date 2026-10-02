import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import WsHub from '../src/ws-hub.js';
import TrackStore from '../src/tracks.js';
import CollaborativeStore from '../src/collab-store.js';

const require = createRequire(import.meta.url);
const families = require('../src/efsp/wire/families');
const { ReplayCache } = require('../src/efsp/sync/replay-cache.js');

test('the replay cache accepts exactly the kinds the registry declares', () => {
  assert.deepEqual([...families.REPLAY_KINDS].sort(), ['airspace', 'carrier', 'correlation', 'marsa', 'runwayStatus', 'sfa']);
  const cache = new ReplayCache();
  for (const kind of families.REPLAY_KINDS) cache.set(kind, 'c1', { ok: true });
  assert.throws(() => cache.set('nope', 'c1', { ok: true }), /unknown kind/);
});

test('the registry is in snapshot key order and every family has a unique request type', () => {
  assert.deepEqual(families.FAMILIES.filter(f => f.snapshotKey).map(f => f.snapshotKey), ['airspaces', 'correlations', 'marsa', 'runwayStatuses', 'carriers', 'sfaRotation']);
  assert.equal(new Set(families.FAMILIES.map(f => f.type)).size, families.FAMILIES.length);
});

test('WsHub.stop() clears the tick attach() started, and is safe twice', () => {
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore() });
  const server = http.createServer();
  hub.attach(server);
  assert.ok(hub._timer, 'attach() started the tick');
  hub.stop();
  assert.equal(hub._timer, null);
  hub.stop();
  hub._wss.close();
});

// Finding F1 (docs/wip/WIRE.md), fixed: a gate refusal made before the store is marked `unaudited`, in every one of the six
// mutation families, so the metrics tap writes it to the Mutation log (docs/adr/0083). The log entry carries what the
// refusal concerned (the family's subject key).
test('each of the six mutation families\' gate refusal is logged once, with its subject', async () => {
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const crcLog = (await import('../src/log.js')).default;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wire-skeleton-f1-'));
  for (const [k, v] of Object.entries({
    CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json', CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
    CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json', CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
    CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl', CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
    CRCSYNC_EFSP_TRAFFIC_COUNT_PATH: 'traffic-count.jsonl', CRCSYNC_EFSP_METRICS_PATH: 'metrics.json',
    CRCSYNC_EFSP_INSTRUMENTATION_CONFIG_PATH: 'instrumentation.json',
  })) process.env[k] = path.join(tmpDir, v);
  fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');
  const { createEfsp } = await import('../src/efsp/index.js');
  const facilityConfig = await import('../src/efsp/facility-config.js');
  const { createEfspInstrumentation } = await import('../src/efsp/metrics.js');
  const efsp = createEfsp();
  const cap = crcLog.capture();
  try { createEfspInstrumentation({ efsp, facilityConfig, correlationStats: () => ({ rate: null, eligible: 0 }), obligationStats: () => ({}) }); } finally { cap.stop(); }

  const session = { controllerId: 'nobody' }; // holds no Position, so every gate refuses it
  const cases = [
    ['efsp-airspace-mutation', { airspaceId: 'A1', op: { kind: 'SetControlling' } }, 'airspaceId', 'A1'],
    ['efsp-correlation-mutation', { flightDataId: 'fd1', op: { kind: 'Bind' } }, 'flightDataId', 'fd1'],
    ['efsp-marsa-mutation', { marsaId: 'm1', op: { kind: 'Create' } }, 'marsaId', 'm1'],
    ['efsp-runway-status-mutation', { op: { kind: 'Suspend', runwayId: '05' } }, 'facilityId', 'INCIRLIK'],
    ['efsp-carrier-mutation', { hullId: 'CVN-1', op: { kind: 'SetRecoveryCase' } }, 'hullId', 'CVN-1'],
    ['efsp-sfa-mutation', { op: { kind: 'SetFrequency', rackId: 'sfa-1', positionId: null } }, 'rackId', 'sfa-1'],
  ];
  assert.equal(cases.length, families.FAMILIES.filter(f => f.replayKind).length, 'every mutation family is covered');
  for (const [type, extra, key, value] of cases) {
    const cmid = `f1-${type}`;
    const { ack } = efsp.handleMessage(session, { version: 1, type, clientMutationId: cmid, facilityId: 'INCIRLIK', actingPositionId: 'LC', ...extra });
    assert.equal(ack.ok, false, type);
    const entries = efsp.mutationLog.readAll().filter(e => e.clientMutationId === cmid);
    assert.equal(entries.length, 1, `${type}: one Mutation-log entry for its gate refusal`);
    assert.equal(entries[0].ok, false);
    assert.equal(entries[0][key], value, `${type}: the entry says what it concerned`);
  }
});
