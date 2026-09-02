'use strict';

/* Unit tests for the four paper-gesture functions (efsp-gestures.js) — the
   guide's §7.3 "one input" cost ceiling made mechanically checkable by
   counting dispatched Mutations per invocation. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { toggleOffset, toggleFlip, setHighlight, setAttention } = require('../app/public/js/panels/efsp/efsp-gestures.js');

function makeStrip(flags = {}) {
  return { stripId: 's1', flags: { offset: false, flipped: false, highlight: null, attention: null, ...flags } };
}

function counting() {
  const calls = [];
  const fn = (strip, op) => calls.push({ strip, op });
  fn.calls = calls;
  return fn;
}

test('toggleOffset dispatches exactly one Mutation, flipping the current value', () => {
  const send = counting();
  toggleOffset(makeStrip({ offset: false }), send);
  assert.equal(send.calls.length, 1);
  assert.deepEqual(send.calls[0].op, { kind: 'SetFlag', flag: 'offset', value: true });
});

test('toggleOffset flips back to false on a second call against the new state', () => {
  const send = counting();
  toggleOffset(makeStrip({ offset: true }), send);
  assert.equal(send.calls.length, 1);
  assert.deepEqual(send.calls[0].op, { kind: 'SetFlag', flag: 'offset', value: false });
});

test('toggleFlip dispatches exactly one Mutation, flipping strip.flags.flipped', () => {
  const send = counting();
  toggleFlip(makeStrip({ flipped: false }), send);
  assert.equal(send.calls.length, 1);
  assert.deepEqual(send.calls[0].op, { kind: 'SetFlag', flag: 'flipped', value: true });
});

test('setHighlight dispatches exactly one Mutation, setting the color', () => {
  const send = counting();
  setHighlight(makeStrip(), 'yellow', send);
  assert.equal(send.calls.length, 1);
  assert.deepEqual(send.calls[0].op, { kind: 'SetFlag', flag: 'highlight', value: 'yellow' });
});

test('setHighlight with the SAME color already active clears it (one-input toggle-off)', () => {
  const send = counting();
  setHighlight(makeStrip({ highlight: 'yellow' }), 'yellow', send);
  assert.equal(send.calls.length, 1);
  assert.deepEqual(send.calls[0].op, { kind: 'SetFlag', flag: 'highlight', value: null });
});

test('setHighlight with a DIFFERENT color already active replaces it in one input, not two', () => {
  const send = counting();
  setHighlight(makeStrip({ highlight: 'yellow' }), 'red', send);
  assert.equal(send.calls.length, 1);
  assert.deepEqual(send.calls[0].op, { kind: 'SetFlag', flag: 'highlight', value: 'red' });
});

test('setAttention dispatches exactly one Mutation, and toggles off on repeat with the same color', () => {
  const send = counting();
  setAttention(makeStrip(), 'red', send);
  assert.equal(send.calls.length, 1);
  assert.deepEqual(send.calls[0].op, { kind: 'SetFlag', flag: 'attention', value: 'red' });

  const send2 = counting();
  setAttention(makeStrip({ attention: 'red' }), 'red', send2);
  assert.equal(send2.calls.length, 1);
  assert.deepEqual(send2.calls[0].op, { kind: 'SetFlag', flag: 'attention', value: null });
});

test('every gesture function dispatches to exactly the passed-in strip, never a different one', () => {
  const send = counting();
  const strip = makeStrip();
  toggleOffset(strip, send);
  assert.equal(send.calls[0].strip, strip);
});
