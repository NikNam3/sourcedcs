/* DESK-ACKS: the one ack path. sendEfsp(msg, { onAck, pending }) keeps a cmid -> continuation map, settleEfspAck() runs
   it once, a send the socket could not carry answers NOT_CONNECTED, and a reconnect answers CONNECTION_LOST to every
   request that is not replayable. */

import test from 'node:test';
import assert from 'node:assert/strict';

import './helpers/client-env.mjs';
import { freshGraph } from './helpers/fresh-graph.mjs';

async function load() {
  const g = freshGraph();
  const ws = await g.import('panels/efsp/efsp-ws.js');
  const state = await g.import('panels/efsp/efsp-state.js');
  const sent = [];
  ws.setEfspSender('_sendEfsp', (m) => { sent.push(m); return true; });
  return { ws, state, sent };
}
const strip = { stripId: 's1', rev: 3, facilityId: 'INCIRLIK' };

test('an onAck continuation runs once, with the ack, and its return says whether it handled the outcome', async () => {
  const { ws, sent } = await load();
  const heard = [];
  const id = ws.sendEfspMutation('OPS', strip, { kind: 'InvokeNla' }, { onAck: (ack, result) => { heard.push([ack.ok, result]); return true; } });
  assert.equal(sent.at(-1).clientMutationId, id);
  assert.equal(ws.settleEfspAck({ clientMutationId: id, ok: true }, 'r'), true);
  assert.deepEqual(heard, [[true, 'r']]);
  assert.equal(ws.settleEfspAck({ clientMutationId: id, ok: true }), false, 'a second ack for it finds no continuation');
  assert.equal(heard.length, 1);
  const id2 = ws.sendEfspMutation('OPS', strip, { kind: 'InvokeNla' }, { onAck: () => false });
  assert.equal(ws.settleEfspAck({ clientMutationId: id2, ok: false }), false, 'returning anything but true leaves the default surface to the caller');
  assert.equal(ws.settleEfspAck({ clientMutationId: 'nobody-sent-this', ok: false }), false);
});

test('every family sender takes the same trailing { onAck }', async () => {
  const { ws, sent } = await load();
  const ids = [];
  const on = (n) => ({ onAck: () => { ids.push(n); } });
  const sends = [
    () => ws.sendEfspUndo('LC', { stripId: 's1', actionId: 'a1' }, on('undo')),
    () => ws.sendEfspCreateStrip('OPS', { kind: 'CreateStrip' }, 'INCIRLIK', on('create')),
    () => ws.sendEfspAirspaceMutation('CTR', 'AS1', 1, { kind: 'X' }, {}, on('airspace')),
    () => ws.sendEfspCorrelationMutation('CTR', 'fd1', 1, { kind: 'X' }, on('correlation')),
    () => ws.sendEfspMarsaMutation('CTR', null, null, { kind: 'X' }, on('marsa')),
    () => ws.sendEfspRunwayStatusMutation('TWR', 'INCIRLIK', 1, { kind: 'X' }, on('runway')),
    () => ws.sendEfspCarrierMutation('CV_MARSHAL', 'h1', 1, { kind: 'X' }, on('carrier')),
    () => ws.sendEfspSfaMutation('APP', 1, { kind: 'X' }, on('sfa')),
  ];
  for (const send of sends) ws.settleEfspAck({ clientMutationId: send(), ok: true });
  assert.equal(ids.length, sends.length);
  assert.equal(sent.length, sends.length);
});

test('a send the socket could not carry answers NOT_CONNECTED, after the caller has the id', async () => {
  const { ws } = await load();
  ws.setEfspSender('_sendEfsp', () => false);
  let heard = null;
  const id = ws.sendEfspRunwayStatusMutation('TWR', 'INCIRLIK', 1, { kind: 'X' }, { onAck: (ack) => { heard = ack; } });
  assert.equal(heard, null, 'not synchronously: the caller stores the id first');
  await Promise.resolve();
  assert.equal(heard.clientMutationId, id);
  assert.equal(heard.ok, false);
  assert.equal(heard.reason, 'NOT_CONNECTED');
});

test('a (re)connect answers CONNECTION_LOST to a request in flight, but keeps a replayable Mutation\'s continuation', async () => {
  const { ws, state } = await load();
  const heard = {};
  const undoId = ws.sendEfspUndo('LC', { stripId: 's1', actionId: 'a1' }, { onAck: (a) => { heard.undo = a.reason; } });
  const mutId = ws.sendEfspMutation('OPS', strip, { kind: 'InvokeNla' }, { onAck: (a) => { heard.mut = a.reason ?? 'acked'; } });
  assert.equal(state.getPendingMutations().length, 1, 'only the Strip Mutation is replayable');
  ws.redeclareEfspPositions();
  assert.equal(heard.undo, 'CONNECTION_LOST');
  assert.equal(heard.mut, undefined);
  assert.equal(ws.settleEfspAck({ clientMutationId: mutId, ok: true }), false);
  assert.equal(heard.mut, 'acked', 'its own ack still reaches it after the replay');
  assert.equal(ws.settleEfspAck({ clientMutationId: undoId, ok: true }), false, 'the orphaned one is gone');
});
