// A pending CreateStrip is re-sent after a reconnect only while crc-sync's replay cache can still answer its
// clientMutationId across a restart (REPLAY_PERSIST_WINDOW_MS): past that, a resend could create the Strip twice.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import './helpers/client-env.mjs';
import { freshGraph } from './helpers/fresh-graph.mjs';

const require = createRequire(import.meta.url);
const { REPLAY_PERSIST_WINDOW_MS } = require('../../crc-sync/src/efsp/sync/replay-cache.js');

test('the client resend window stays at least a minute inside the server replay window that survives a restart', async () => {
  const state = await freshGraph().import('panels/efsp/efsp-state.js');
  assert.ok(state.CREATE_STRIP_RESEND_WINDOW_MS > 0);
  assert.ok(state.CREATE_STRIP_RESEND_WINDOW_MS <= REPLAY_PERSIST_WINDOW_MS - 60 * 1000,
    `${state.CREATE_STRIP_RESEND_WINDOW_MS} ms must stay a minute under crc-sync's ${REPLAY_PERSIST_WINDOW_MS} ms`);
});

test('rebaseForResend re-sends a CreateStrip inside the window and refuses it from the window on', async () => {
  const state = await freshGraph().import('panels/efsp/efsp-state.js');
  const W = state.CREATE_STRIP_RESEND_WINDOW_MS;
  const create = { clientMutationId: 'c1', type: 'efsp-mutation', op: { kind: 'CreateStrip' } };
  state.registerPendingMutation(create, 1000);
  assert.deepEqual(state.rebaseForResend('c1', 1000 + W - 1), create, 'inside the window: re-sent as it was');
  assert.equal(state.rebaseForResend('c1', 1000 + W), null, 'at the window: not re-sent');
  assert.equal(state.rebaseForResend('c1', 1000 + 60 * 60 * 1000), null, 'an hour later: not re-sent');
});

test('the window applies only to CreateStrip: a Strip Mutation still rebases however old it is', async () => {
  const state = await freshGraph().import('panels/efsp/efsp-state.js');
  state.applyEfspSnapshot({ facilities: ['INCIRLIK'], boardSeqByFacility: { INCIRLIK: 1 }, strips: [{ stripId: 's1', rev: 4, facilityId: 'INCIRLIK' }], flightDataList: [], positions: [] });
  assert.equal(state.getEfspStrip('s1').rev, 4);
  state.registerPendingMutation({ clientMutationId: 'm1', stripId: 's1', baseRev: 1, op: { kind: 'SetFlag' } }, 0);
  assert.equal(state.rebaseForResend('m1', 24 * 60 * 60 * 1000).baseRev, 4);
});

test('a reconnect long after the send answers the CreateStrip form CONNECTION_LOST instead of re-sending it', async () => {
  const g = freshGraph();
  const ws = await g.import('panels/efsp/efsp-ws.js');
  const state = await g.import('panels/efsp/efsp-state.js');
  const sent = [];
  ws.setEfspSender('_sendEfsp', (m) => { sent.push(m); return true; });
  const id = ws.sendEfspCreateStrip('OPS', { kind: 'CreateStrip', fields: { callsign: 'VIPER 1' } }, 'INCIRLIK', { onAck: () => {} });
  // Age the pending send past the window, as a long disconnect would.
  const original = state.getPendingMutations().find((m) => m.clientMutationId === id);
  state.registerPendingMutation(original, Date.now() - state.CREATE_STRIP_RESEND_WINDOW_MS - 1);
  const before = sent.length;
  const orphans = [];
  ws.replayPendingEfspMutations((o) => orphans.push(o));
  assert.equal(sent.length, before, 'nothing re-sent');
  assert.deepEqual(orphans.map((o) => o.clientMutationId), [id], 'handed to the orphan path, which answers CONNECTION_LOST');
});
