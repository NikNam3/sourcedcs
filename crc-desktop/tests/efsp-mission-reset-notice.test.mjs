/* DESK-NOTICES (H108): a board delta marked `missionReset` shows one dismissible notice, closes popovers on the removed
   Strips and sends a pending Mutation on one of them down the orphan path. Plain drops show no notice. */
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshGraph } from './helpers/fresh-graph.mjs';

async function load() {
  globalThis.document.getElementById = () => null;
  const g = freshGraph();
  const reg = await g.import('panels/efsp/efsp-message-registry.js');
  await g.import('panels/efsp/efsp-messages.js');
  const state = await g.import('panels/efsp/efsp-state.js');
  const slot = await g.import('panels/efsp/panel/undo-slot.js');
  const portal = await g.import('panels/efsp/bay/popover-portal.js');
  slot._resetUndoForTest();
  state._resetEfspStateForTest();
  return { reg, state, slot, portal };
}
const strip = (id) => ({ stripId: id, rev: 1, facilityId: 'INCIRLIK', state: 'PROPOSED' });
const delta = (o) => ({ type: 'efsp-board-delta', facilityId: 'INCIRLIK', strips: { updated: [], gone: [] }, flightDataList: { updated: [] }, positions: { updated: [] }, ...o });

test('a reset delta shows the notice with the count; a second Facility of the same reset adds to it; a click dismisses it', async () => {
  const { reg, state, slot } = await load();
  state.applyEfspDelta(delta({ strips: { updated: [strip('a'), strip('b'), strip('c')], gone: [] } }));
  reg.dispatchEfspMessage(delta({ strips: { updated: [], gone: ['a', 'b'] }, missionReset: { at: 100, strips: 2 } }));
  assert.deepEqual(slot.getUndoVoidedMessages().map(m => m.text), ['New mission — the Board was cleared (2 Strips)']);
  reg.dispatchEfspMessage(delta({ facilityId: 'CENTER', strips: { updated: [], gone: ['c'] }, missionReset: { at: 100, strips: 1 } }));
  const [m] = slot.getUndoVoidedMessages();
  assert.equal(slot.getUndoVoidedMessages().length, 1);
  assert.equal(m.text, 'New mission — the Board was cleared (3 Strips)');
  assert.equal(state.getEfspStrip('a'), null);
  slot.dismissUndoVoided(m.id);
  assert.deepEqual(slot.getUndoVoidedMessages(), []);
});

test('an ordinary drop shows no notice', async () => {
  const { reg, state, slot } = await load();
  state.applyEfspDelta(delta({ strips: { updated: [strip('a')], gone: [] } }));
  reg.dispatchEfspMessage(delta({ strips: { updated: [], gone: ['a'] } }));
  assert.deepEqual(slot.getUndoVoidedMessages(), []);
});

test('an open popover on a Strip the reset removed is closed; one on another Strip stays', async () => {
  const { reg, state, portal } = await load();
  state.applyEfspDelta(delta({ strips: { updated: [strip('a'), strip('b')], gone: [] } }));
  const mk = () => { const el = globalThis.document.createElement('div'); return el; };
  const closed = [];
  const anchor = globalThis.document.createElement('button');
  portal._mountPopover(mk(), anchor, { stripId: 'a' }, () => closed.push('a'));
  portal._mountPopover(mk(), anchor, { stripId: 'b' }, () => closed.push('b'));
  reg.dispatchEfspMessage(delta({ strips: { updated: [], gone: ['a'] }, missionReset: { at: 5, strips: 1 } }));
  assert.deepEqual(closed, ['a']);
});

test('a pending Mutation on a removed Strip is answered through the orphan path; one on a kept Strip is not', async () => {
  globalThis.document.getElementById = () => null;
  const g = freshGraph();
  const reg = await g.import('panels/efsp/efsp-message-registry.js');
  await g.import('panels/efsp/efsp-messages.js');
  const state = await g.import('panels/efsp/efsp-state.js');
  const ws = await g.import('panels/efsp/efsp-ws.js');
  const refusal = await g.import('panels/efsp/panel/refusal.js');
  ws.setEfspSender('_sendEfsp', () => {});
  state._resetEfspStateForTest();
  state.applyEfspDelta(delta({ strips: { updated: [strip('a'), strip('b')], gone: [] } }));
  for (const [id, stripId] of [['m1', 'a'], ['m2', 'b']]) {
    state.registerPendingMutation({ clientMutationId: id, stripId, baseRev: 1, op: { kind: 'SetBlock' } });
  }
  reg.dispatchEfspMessage(delta({ strips: { updated: [], gone: ['a'] }, missionReset: { at: 7, strips: 1 } }));
  const r = refusal.getCurrentEfspRefusal();
  assert.ok(r, 'a refusal is on screen');
  assert.match(JSON.stringify(r), /could not be replayed|Could not resync/);
  assert.equal(r.stripId, 'a');
});
