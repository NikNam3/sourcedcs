import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serverBoardDelta, correlationDelta, runwayStatusDelta } from '../src/efsp/wire/frames.js';
import WsHub from '../src/ws-hub.js';
import TrackStore from '../src/tracks.js';
import CollaborativeStore from '../src/collab-store.js';
import runwayStatus from '../src/efsp/runway-status.js';
import permission from '../src/efsp/permission.js';
import { fakeWs, OPEN } from './helpers/ws.mjs';

// L1b's two server-side changes (docs/adr/0068): the public runway-status
// broadcaster (decisions.md S-L1d) and the generic "runway works + inspection"
// suspension that replaced the barrier change (decisions.md H52).


test('deliverEfsp(runwayStatusDelta) sends the same efsp-runway-status-delta a runway-status op returns, to every open client', () => {
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore(), efsp: null });
  const a = fakeWs();
  const b = fakeWs();
  const closed = { readyState: 3, send: () => { throw new Error('must not send on a closed socket'); } };
  hub._wss = { clients: [a, closed, b] };
  const record = { facilityId: 'INCIRLIK', rev: 3, activeRunway: '23' };
  hub.deliverEfsp(runwayStatusDelta({ currentSeq: 9, epoch: undefined }, [record, null]));
  for (const ws of [a, b]) {
    assert.deepEqual(ws.sent, [{ version: 1, type: 'efsp-runway-status-delta', runwayStatusSeq: 9, runwayStatuses: { updated: [record] } }]);
  }
});

test('deliverEfsp is a no-op before the WebSocket server exists', () => {
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore(), efsp: null });
  hub._wss = null;
  hub.deliverEfsp(runwayStatusDelta({ currentSeq: 1, epoch: 'e' }, []));
});

test('H52: the suspension is generic runway works — no barrier-specific kind, status, op or request action remains', () => {
  assert.deepEqual(runwayStatus.SUSPENSION_KINDS, ['WORKS', 'RUNWAY_CHANGE']);
  assert.ok(runwayStatus.RUNWAY_STATUSES.includes('SUSPENDED_WORKS'));
  assert.deepEqual(runwayStatus.REQUEST_ACTIONS, ['CLOSE', 'OPEN', 'WORKS']);
  assert.deepEqual(permission.RUNWAY_STATUS_OP_OWNERS.BeginRunwayWorks, ['LC']);
  assert.deepEqual(permission.RUNWAY_STATUS_OP_OWNERS.CompleteRunwayWorks, ['OPS']);
  const everything = JSON.stringify([
    runwayStatus.SUSPENSION_KINDS, runwayStatus.RUNWAY_STATUSES, runwayStatus.REQUEST_ACTIONS,
    runwayStatus.LEGAL_TRANSITIONS, runwayStatus.SUSPENSION_LABELS, Object.keys(permission.RUNWAY_STATUS_OP_OWNERS),
  ]);
  assert.doesNotMatch(everything, /barrier/i);
});

test('H52: the inhibit reason for works names the runway and says works are in progress', () => {
  const runway = { runwayId: '05/23', status: 'SUSPENDED_WORKS', suspension: { kind: 'WORKS' } };
  assert.equal(runwayStatus.runwayStatusReason(runway), 'runway 05/23 suspended — works in progress');
});
