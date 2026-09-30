import { test } from 'node:test';
import assert from 'node:assert/strict';
import WsHub from '../src/ws-hub.js';
import TrackStore from '../src/tracks.js';
import CollaborativeStore from '../src/collab-store.js';
import fieldState from '../src/efsp/field-state.js';
import permission from '../src/efsp/permission.js';

// L1b's two server-side changes (docs/adr/0068): the public field-state
// broadcaster (decisions.md S-L1d) and the generic "runway works + inspection"
// suspension that replaced the barrier change (decisions.md H52).

const OPEN = 1; // WebSocket.OPEN

function fakeWs(readyState = OPEN) {
  const sent = [];
  return { readyState, send: (raw) => sent.push(JSON.parse(raw)), sent };
}

test('broadcastEfspFieldStateDelta sends the same efsp-field-state-delta a field-state op returns, to every open client', () => {
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore(), efsp: null });
  const a = fakeWs();
  const b = fakeWs();
  const closed = { readyState: 3, send: () => { throw new Error('must not send on a closed socket'); } };
  hub._wss = { clients: [a, closed, b] };
  const record = { facilityId: 'INCIRLIK', rev: 3, activeRunway: '23' };
  hub.broadcastEfspFieldStateDelta({ fieldStateSeq: 9, fieldStates: [record, null] });
  for (const ws of [a, b]) {
    assert.deepEqual(ws.sent, [{ version: 1, type: 'efsp-field-state-delta', fieldStateSeq: 9, fieldStates: { updated: [record] } }]);
  }
});

test('broadcastEfspFieldStateDelta is a no-op before the WebSocket server exists', () => {
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore(), efsp: null });
  hub._wss = null;
  hub.broadcastEfspFieldStateDelta({ fieldStateSeq: 1, fieldStates: [] });
});

test('H52: the suspension is generic runway works — no barrier-specific kind, status, op or request action remains', () => {
  assert.deepEqual(fieldState.SUSPENSION_KINDS, ['WORKS', 'RUNWAY_CHANGE']);
  assert.ok(fieldState.RUNWAY_STATUSES.includes('SUSPENDED_WORKS'));
  assert.deepEqual(fieldState.REQUEST_ACTIONS, ['CLOSE', 'OPEN', 'WORKS']);
  assert.deepEqual(permission.FIELD_STATE_OP_OWNERS.BeginRunwayWorks, ['TWR']);
  assert.deepEqual(permission.FIELD_STATE_OP_OWNERS.CompleteRunwayWorks, ['OPS']);
  const everything = JSON.stringify([
    fieldState.SUSPENSION_KINDS, fieldState.RUNWAY_STATUSES, fieldState.REQUEST_ACTIONS,
    fieldState.LEGAL_TRANSITIONS, fieldState.SUSPENSION_LABELS, Object.keys(permission.FIELD_STATE_OP_OWNERS),
  ]);
  assert.doesNotMatch(everything, /barrier/i);
});

test('H52: the inhibit reason for works names the runway and says works are in progress', () => {
  const runway = { runwayId: '05/23', status: 'SUSPENDED_WORKS', suspension: { kind: 'WORKS' } };
  assert.equal(fieldState.runwayStatusReason(runway), 'runway 05/23 suspended — works in progress');
});
