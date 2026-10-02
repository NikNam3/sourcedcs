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

// Finding F1 (docs/wip/WIRE.md): carrier and SFA gate refusals are not marked `unaudited`, so the metrics tap does not
// log them as the other four mutation families' are. Left as found; the audit lanes decide.
test.todo('carrier and SFA gate refusals are marked unaudited like the other mutation families (F1)');
