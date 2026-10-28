/* DESK-ACKS: a popover keeps its input on refusal. _sendFromPopover closes the popover on the ACK, not on send: an
   accepted ack closes it, a refusal leaves it open with its input, and a popover closed meanwhile is left alone. */

import test from 'node:test';
import assert from 'node:assert/strict';

import './helpers/client-env.mjs';
import { freshGraph } from './helpers/fresh-graph.mjs';
import { makeElement } from './helpers/dom-stub.js';

async function load() {
  const g = freshGraph();
  const portal = await g.import('panels/efsp/bay/popover-portal.js');
  const ws = await g.import('panels/efsp/efsp-ws.js');
  const sent = [];
  ws.setEfspSender('_sendEfsp', (m) => { sent.push(m); return true; });
  const anchor = makeElement('button');
  const popover = makeElement('div');
  const note = makeElement('textarea');
  note.value = 'handoff to AP, 3 miles in trail';
  popover.appendChild(note);
  const button = makeElement('button');
  let closed = 0;
  portal._mountPopover(popover, anchor, { stripId: 's1' }, () => { closed += 1; portal._unmountPopover(popover); });
  const send = () => portal._sendFromPopover(popover, button, (onAck) => {
    ws.sendEfspMutation('OPS', { stripId: 's1', rev: 1, facilityId: 'INCIRLIK' }, { kind: 'HANDOFF', note: note.value }, { onAck });
    return true;
  });
  const settle = (ack) => ws.settleEfspAck({ clientMutationId: sent.at(-1).clientMutationId, ...ack });
  return { portal, popover, note, button, send, settle, sent, closed: () => closed };
}

test('Send does not close the popover: it waits for the ack, with the button dead meanwhile', async () => {
  const t = await load();
  assert.equal(t.send(), true);
  assert.equal(t.sent.length, 1);
  assert.equal(t.closed(), 0);
  assert.equal(t.portal._stripHasOpenPopover('s1'), true);
  assert.equal(t.button.disabled, true);
});

test('a refusal leaves the popover open, the typed note intact and the button live again; the banner still shows it', async () => {
  const t = await load();
  t.send();
  const handled = t.settle({ ok: false, reason: 'STALE_REV' });
  assert.equal(handled, false, 'not handled here: the refusal banner is the default surface');
  assert.equal(t.closed(), 0);
  assert.equal(t.note.value, 'handoff to AP, 3 miles in trail');
  assert.equal(t.button.disabled, false);
});

test('an accepted ack closes it', async () => {
  const t = await load();
  t.send();
  t.settle({ ok: true });
  assert.equal(t.closed(), 1);
  assert.equal(t.portal._stripHasOpenPopover('s1'), false);
});

test('a popover the controller already closed is not closed again by a late ack', async () => {
  const t = await load();
  t.send();
  t.portal._unmountPopover(t.popover); // outside click
  t.settle({ ok: true });
  assert.equal(t.closed(), 0);
});

test('nothing sent (not signed on): the button comes back and the popover stays', async () => {
  const t = await load();
  assert.equal(t.portal._sendFromPopover(t.popover, t.button, () => false), false);
  assert.equal(t.button.disabled, false);
  assert.equal(t.closed(), 0);
});
