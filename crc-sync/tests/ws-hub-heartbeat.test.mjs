import { test } from 'node:test';
import assert from 'node:assert/strict';
import WsHub from '../src/ws-hub.js';
import TrackStore from '../src/tracks.js';
import CollaborativeStore from '../src/collab-store.js';

// Narrowly scoped to the EFSP heartbeat message shape (guide §5.6 rule 5).
// The picture itself is ws-hub-coverage.test.mjs.

const OPEN = 1; // WebSocket.OPEN

function fakeWs() {
  const sent = [];
  return { readyState: OPEN, send: (raw) => sent.push(JSON.parse(raw)), sent };
}

function fakeEfsp(currentSeq, boardsFor = (all) => all) {
  const all = { INCIRLIK: { seq: currentSeq, epoch: 'e-I' }, CENTER: { seq: currentSeq + 1, epoch: 'e-C' } };
  return { heartbeatBoardsAll: () => all, heartbeatBoardsFor: (session, a) => boardsFor(a, session), heartbeatStores: () => ({ airspaces: { seq: 3, epoch: 'e-A' } }) };
}

test('_tick sends an efsp-heartbeat with the current Board sequence when EFSP is present', () => {
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore(), efsp: fakeEfsp(7) });
  const ws = fakeWs();
  hub._tick(ws, {});

  const heartbeat = ws.sent.find(m => m.type === 'efsp-heartbeat');
  assert.ok(heartbeat, 'no efsp-heartbeat message was sent');
  assert.deepEqual(heartbeat.boards, { INCIRLIK: { seq: 7, epoch: 'e-I' }, CENTER: { seq: 8, epoch: 'e-C' } });
  assert.deepEqual(heartbeat.stores, { airspaces: { seq: 3, epoch: 'e-A' } });
  assert.equal(Object.keys(heartbeat)[1], 'type', 'type stays the second key (soak and freeze prefix matchers)');
});

test('_tick sends a heartbeat on an otherwise-quiet tick — EFSP heartbeat is NOT gated on the track/collab early-return', () => {
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore(), efsp: fakeEfsp(0) });
  const ws = fakeWs();
  hub._tick(ws, {});

  assert.equal(ws.sent.length, 1); // heartbeat only — no track/collab delta, nothing changed
  assert.equal(ws.sent[0].type, 'efsp-heartbeat');
});

test('_tick sends no efsp-heartbeat when EFSP is absent (existing tracks-only callers unaffected)', () => {
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore(), efsp: null });
  const ws = fakeWs();
  hub._tick(ws, {});

  assert.equal(ws.sent.some(m => m.type === 'efsp-heartbeat'), false);
});

test('_tick sends nothing at all on a closed WebSocket, EFSP included', () => {
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore(), efsp: fakeEfsp(1) });
  const ws = { readyState: 3 /* CLOSED */, send: () => { throw new Error('must not send on a closed socket'); } };
  hub._tick(ws, {});
});
