/* DESK-TIDY-2: openPopover is the one popover/menu opener. One open at a time, outside pointerdown (armed one tick after
   opening) and Escape close it, a press inside does not, onClose runs once, and the first focus is the caller's. */

import test from 'node:test';
import assert from 'node:assert/strict';

import './helpers/client-env.mjs';
import { freshGraph } from './helpers/fresh-graph.mjs';
import { makeElement } from './helpers/dom-stub.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

async function load() {
  const listeners = {};
  document.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  document.removeEventListener = (type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); };
  const g = freshGraph();
  const portal = await g.import('panels/efsp/bay/popover-portal.js');
  const fire = (type, e) => (listeners[type] || []).slice().forEach((fn) => fn(e));
  const anchor = makeElement('button');
  const open = (opts = {}) => {
    const el = makeElement('div');
    const closes = { n: 0 };
    const handle = portal.openPopover({ el, anchor, strip: { stripId: 's1' }, onClose: () => { closes.n += 1; }, ...opts });
    return { el, handle, closes };
  };
  return { portal, fire, open, listeners };
}

test('opening a popover closes the one already open', async () => {
  const t = await load();
  const a = t.open();
  const b = t.open();
  assert.equal(a.closes.n, 1);
  assert.equal(b.closes.n, 0);
  assert.equal(t.portal._stripHasOpenPopover('s1'), true);
});

test('an outside pointerdown closes it once armed; a press inside, or before arming, does not', async () => {
  const t = await load();
  const inner = makeElement('button');
  const a = t.open();
  a.el.appendChild(inner);
  t.fire('pointerdown', { target: makeElement('div') });
  assert.equal(a.closes.n, 0, 'not armed in the tick that opened it');
  await tick();
  t.fire('pointerdown', { target: inner });
  assert.equal(a.closes.n, 0, 'a press inside stays open');
  t.fire('pointerdown', { target: makeElement('div') });
  assert.equal(a.closes.n, 1);
  assert.equal(t.portal._stripHasOpenPopover('s1'), false);
});

test('Escape closes it, and the key does not reach the Strip behind', async () => {
  const t = await load();
  const a = t.open();
  let stopped = false;
  t.fire('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.equal(a.closes.n, 1);
  assert.equal(stopped, true);
});

test('close() is idempotent and onClose runs once', async () => {
  const t = await load();
  const a = t.open();
  a.handle.close();
  a.handle.close();
  assert.equal(a.closes.n, 1);
});

test('the first focus goes where the caller says', async () => {
  const t = await load();
  const first = makeElement('button');
  t.open({ focus: first });
  assert.equal(document.activeElement, first);
});

test('a pointerdown inside the popover is stopped before it can start a Bay drag', async () => {
  const t = await load();
  const a = t.open();
  let stopped = false;
  a.el._listeners.pointerdown[0]({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
});
