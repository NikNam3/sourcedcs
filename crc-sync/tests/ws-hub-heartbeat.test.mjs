import { test } from 'node:test';
import assert from 'node:assert/strict';
import WsHub from '../src/ws-hub.js';
import TrackStore from '../src/tracks.js';
import CollaborativeStore from '../src/collab-store.js';

// Narrowly scoped to the EFSP heartbeat message shape (guide §5.6 rule 5) —
// no existing test file exercises WsHub._tick() at all, so this is
// deliberately just enough to cover the one thing Phase 2 added to it, not
// a general ws-hub test suite.

const OPEN = 1; // WebSocket.OPEN

function fakeWs() {
  const sent = [];
  return { readyState: OPEN, send: (raw) => sent.push(JSON.parse(raw)), sent };
}

function fakeEfsp(currentSeq) {
  return { boardStore: { currentSeq } };
}

test('_tick sends an efsp-heartbeat with the current Board sequence when EFSP is present', () => {
  const hub = new WsHub(new TrackStore(), new CollaborativeStore(), fakeEfsp(7));
  const ws = fakeWs();
  hub._tick(ws, { lastTrackSeq: 0, lastCollabSeq: 0 });

  const heartbeat = ws.sent.find(m => m.type === 'efsp-heartbeat');
  assert.ok(heartbeat, 'no efsp-heartbeat message was sent');
  assert.equal(heartbeat.boardSeq, 7);
});

test('_tick sends a heartbeat on an otherwise-quiet tick — EFSP heartbeat is NOT gated on the track/collab early-return', () => {
  const hub = new WsHub(new TrackStore(), new CollaborativeStore(), fakeEfsp(0));
  const ws = fakeWs();
  hub._tick(ws, { lastTrackSeq: 0, lastCollabSeq: 0 });

  assert.equal(ws.sent.length, 1); // heartbeat only — no track/collab delta, nothing changed
  assert.equal(ws.sent[0].type, 'efsp-heartbeat');
});

test('_tick sends no efsp-heartbeat when EFSP is absent (existing tracks-only callers unaffected)', () => {
  const hub = new WsHub(new TrackStore(), new CollaborativeStore(), null);
  const ws = fakeWs();
  hub._tick(ws, { lastTrackSeq: 0, lastCollabSeq: 0 });

  assert.equal(ws.sent.some(m => m.type === 'efsp-heartbeat'), false);
});

test('_tick sends nothing at all on a closed WebSocket, EFSP included', () => {
  const hub = new WsHub(new TrackStore(), new CollaborativeStore(), fakeEfsp(1));
  const ws = { readyState: 3 /* CLOSED */, send: () => { throw new Error('must not send on a closed socket'); } };
  hub._tick(ws, { lastTrackSeq: 0, lastCollabSeq: 0 });
});
