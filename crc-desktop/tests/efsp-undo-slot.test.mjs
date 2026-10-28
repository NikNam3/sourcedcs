/* The client half of ADR 0100 (UNDO-C): the undo slot (fill, replace, expiry at 10 s on an injected clock, cleared on
   an epoch change), `.undo` / Ctrl+Z dispatch, the outcome line and the panel message for a voided Position. */

import test from 'node:test';
import assert from 'node:assert/strict';

import './helpers/client-env.mjs';
import { freshGraph } from './helpers/fresh-graph.mjs';

const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => { const t = realSetTimeout(fn, ms, ...a); if (t && t.unref) t.unref(); return t; };

async function load() {
  globalThis.document.getElementById = () => null; // render is a no-op without panel elements
  const g = freshGraph();
  const slot = await g.import('panels/efsp/panel/undo-slot.js');
  const ws = await g.import('panels/efsp/efsp-ws.js');
  const sent = [];
  ws.setEfspSender('_sendEfsp', (m) => sent.push(m));
  let now = 1_000_000;
  slot._setUndoClockForTest(() => now);
  slot._resetUndoForTest();
  return { slot, ws, sent, tick: (ms) => { now += ms; } };
}
const ack = (over = {}) => ({
  clientMutationId: 'c1', ok: true, facilityId: 'INCIRLIK', boardEpoch: 'e1',
  undoable: { actionId: 'c1', label: 'Hand off VIPER1 → APP', windowMs: 10000 }, ...over,
});
const pending = { stripId: 's1', facilityId: 'INCIRLIK', actingPositionId: 'LC' };

test('an undoable ack fills the slot; the next undoable ack replaces it', async () => {
  const { slot } = await load();
  assert.equal(slot.getUndoSlot(), null);
  slot.noteUndoAck(ack(), pending);
  assert.equal(slot.getUndoSlot().actionId, 'c1');
  assert.equal(slot.undoSlotText(), 'Undo · Hand off VIPER1 → APP · 10 s');
  slot.noteUndoAck(ack({ clientMutationId: 'c2', undoable: { actionId: 'c2', label: 'Drop VIPER2', windowMs: 10000 } }), pending);
  assert.equal(slot.getUndoSlot().actionId, 'c2');
});

test('an ack without `undoable` or a refusal leaves the slot alone', async () => {
  const { slot } = await load();
  slot.noteUndoAck(ack(), pending);
  slot.noteUndoAck({ clientMutationId: 'x', ok: true }, pending);
  slot.noteUndoAck({ clientMutationId: 'y', ok: false, reason: 'STALE_REV' }, pending);
  assert.equal(slot.getUndoSlot().actionId, 'c1');
});

test('the slot expires at 10 s (9.999 s still there, 10.000 s gone) and counts down', async () => {
  const { slot, tick } = await load();
  slot.noteUndoAck(ack(), pending);
  tick(3000);
  assert.match(slot.undoSlotText(), /· 7 s$/);
  tick(6999);
  assert.ok(slot.getUndoSlot());
  tick(1);
  assert.equal(slot.getUndoSlot(), null);
  assert.equal(slot.undoSlotText(), null);
});

test('a different Board epoch clears the slot; the same epoch and other Facilities do not', async () => {
  const { slot } = await load();
  slot.noteUndoAck(ack(), pending);
  slot.noteUndoBoardEpoch('INCIRLIK', 'e1');
  slot.noteUndoBoardEpoch('CENTER', 'e9');
  assert.ok(slot.getUndoSlot());
  slot.noteUndoBoardEpoch('INCIRLIK', 'e2');
  assert.equal(slot.getUndoSlot(), null);
});

test('.undo / the button send the slot actionId for the slot Strip and Position, not the selected Strip', async () => {
  const { slot, ws, sent } = await load();
  ws.sendEfspSetPositions('INCIRLIK', ['LC']);
  sent.length = 0;
  slot.noteUndoAck(ack(), pending);
  assert.equal(slot.requestUndo(), true);
  assert.equal(sent.length, 1);
  assert.deepEqual(
    { type: sent[0].type, facilityId: sent[0].facilityId, actingPositionId: sent[0].actingPositionId, stripId: sent[0].stripId, op: sent[0].op },
    { type: 'efsp-mutation', facilityId: 'INCIRLIK', actingPositionId: 'LC', stripId: 's1', op: { kind: 'Undo', actionId: 'c1' } });
  assert.equal(sent[0].baseRev, undefined);
});

test('with nothing in the slot, requestUndo sends nothing and says so', async () => {
  const { slot, sent } = await load();
  sent.length = 0;
  assert.equal(slot.requestUndo(), false);
  assert.equal(sent.length, 0);
  assert.match(slot.getUndoOutcome().text, /Nothing to undo/);
});

test('an Undo ack clears the slot and shows "Undone; voided N" for 3 s; its own ack skips the refusal banner', async () => {
  const { slot, ws, sent, tick } = await load();
  ws.sendEfspSetPositions('INCIRLIK', ['LC']);
  slot.noteUndoAck(ack(), pending);
  slot.requestUndo();
  const undoId = sent.at(-1).clientMutationId;
  const own = ws.settleEfspAck({
    clientMutationId: undoId, ok: true, undone: { actionId: 'c1', label: 'Hand off VIPER1 → APP' },
    voided: [{ actingPositionId: 'APP', op: 'SetBlock' }],
  }, null);
  assert.equal(own, true, 'the Undo\'s own continuation handled it, so the refusal banner is skipped');
  assert.equal(slot.getUndoSlot(), null);
  assert.equal(slot.getUndoOutcome().text, 'Undone · Hand off VIPER1 → APP; voided 1 change by APP');
  tick(3000);
  assert.equal(slot.getUndoOutcome(), null);
});

test('a refused Undo shows the detail; a terminal refusal ends the offer, a transient one keeps it', async () => {
  const { slot, ws, sent } = await load();
  ws.sendEfspSetPositions('INCIRLIK', ['LC']);
  slot.noteUndoAck(ack(), pending);
  slot.requestUndo();
  ws.settleEfspAck({ clientMutationId: sent.at(-1).clientMutationId, ok: false, reason: 'NOT_STAFFED', detail: 'LC is not staffed' }, null);
  assert.match(slot.getUndoOutcome().text, /Cannot undo: LC is not staffed/);
  assert.ok(slot.getUndoSlot());
  slot.requestUndo();
  ws.settleEfspAck({ clientMutationId: sent.at(-1).clientMutationId, ok: false, reason: 'UNDO_BLOCKED', detail: 'APP changed it' }, null);
  assert.equal(slot.getUndoSlot(), null);
});

test('efsp-undo-voided: a message naming the Position and what was voided, dismissible, nothing on the Strip', async () => {
  const { slot } = await load();
  slot.noteUndoVoided({
    undoneBy: 'LC', undoneLabel: 'Hand off VIPER1 → APP', undoneOp: 'InvokeNla',
    voided: [{ op: 'SetBlock', summary: 'annotation on VIPER1' }],
  });
  const [m] = slot.getUndoVoidedMessages();
  assert.equal(m.text, 'LC undid Hand off VIPER1 → APP; your annotation on VIPER1 was voided');
  slot.dismissUndoVoided(m.id);
  assert.deepEqual(slot.getUndoVoidedMessages(), []);
});

test('Ctrl+Z is recognised; text entry keeps its own', async () => {
  const { slot } = await load();
  assert.equal(slot.isUndoKey({ key: 'z', ctrlKey: true }), true);
  assert.equal(slot.isUndoKey({ key: 'Z', metaKey: true }), true);
  assert.equal(slot.isUndoKey({ key: 'z', ctrlKey: true, shiftKey: true }), false);
  assert.equal(slot.isUndoKey({ key: 'z' }), false);
  assert.equal(slot.isTextEntryTarget({ tagName: 'INPUT' }), true);
  assert.equal(slot.isTextEntryTarget({ tagName: 'DIV' }), false);
});

test('the Undo button element survives the 250 ms countdown ticks, so a click spanning a tick is not lost (B9)', async () => {
  const dom = (await import('./helpers/dom-stub.js')).default;
  const el = dom.makeElement('div');
  const g = freshGraph();
  const gState = await g.import('panels/efsp/panel/state.js');
  const gSlot = await g.import('panels/efsp/panel/undo-slot.js');
  const gWs = await g.import('panels/efsp/efsp-ws.js');
  gWs.setEfspSender('_sendEfsp', () => {});
  let now = 1_000_000;
  gSlot._setUndoClockForTest(() => now);
  gSlot._resetUndoForTest();
  globalThis.document.getElementById = (id) => (id === 'efsp-undo-slot' ? el : null);
  gState._cachePanelElements();
  gSlot.noteUndoAck(ack(), pending);
  gSlot.renderUndoSlot();
  const btn = el.children[0];
  assert.ok(btn && btn.className === 'efsp-undo-btn');
  assert.match(btn.textContent, /· 10 s$/);
  now += 1500;
  gSlot.renderUndoSlot();
  assert.equal(el.children[0], btn, 'the same element');
  assert.equal(el.children.length, 1);
  assert.match(btn.textContent, /· 9 s$|· 8 s$/);
  assert.equal((btn._listeners.click || []).length, 1, 'one click handler, not one per render');
  globalThis.document.getElementById = () => null;
});
