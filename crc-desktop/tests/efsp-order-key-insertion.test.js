'use strict';

/* Unit tests for strip-drag.js's pure insertion-index math (no DOM/real
   pointer events involved), matching los-math.test.js's style. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeInsertionIndex, computeRackReconciliation } = require('../app/public/js/panels/efsp/strip-drag.js');

function rect(stripId, top, height = 40) { return { stripId, top, height }; }

test('an empty Rack always inserts at index 0 with no neighbors', () => {
  assert.deepEqual(computeInsertionIndex([], 100), { index: 0, afterStripId: null, beforeStripId: null });
});

test('pointer above the first Strip\'s midpoint inserts at the very start', () => {
  const rects = [rect('a', 0), rect('b', 40), rect('c', 80)];
  assert.deepEqual(computeInsertionIndex(rects, 5), { index: 0, afterStripId: null, beforeStripId: 'a' });
});

test('pointer below the last Strip\'s midpoint inserts at the very end', () => {
  const rects = [rect('a', 0), rect('b', 40), rect('c', 80)];
  assert.deepEqual(computeInsertionIndex(rects, 105), { index: 3, afterStripId: 'c', beforeStripId: null });
});

test('pointer between two Strips\' midpoints inserts between them', () => {
  const rects = [rect('a', 0), rect('b', 40), rect('c', 80)]; // midpoints at 20, 60, 100
  assert.deepEqual(computeInsertionIndex(rects, 45), { index: 1, afterStripId: 'a', beforeStripId: 'b' });
});

test('pointer exactly AT a Strip\'s midpoint inserts after it (strict less-than boundary: pointerY < mid, not <=)', () => {
  const rects = [rect('a', 0, 40)]; // midpoint at 20
  assert.deepEqual(computeInsertionIndex(rects, 19), { index: 0, afterStripId: null, beforeStripId: 'a' });
  assert.deepEqual(computeInsertionIndex(rects, 20), { index: 1, afterStripId: 'a', beforeStripId: null });
});

test('a single-Strip Rack: pointer above midpoint inserts before it, below inserts after', () => {
  const rects = [rect('only', 0, 40)];
  assert.deepEqual(computeInsertionIndex(rects, 10), { index: 0, afterStripId: null, beforeStripId: 'only' });
  assert.deepEqual(computeInsertionIndex(rects, 30), { index: 1, afterStripId: 'only', beforeStripId: null });
});

test('varying Strip heights are respected in the midpoint calculation', () => {
  const rects = [rect('a', 0, 100), rect('b', 100, 20)]; // a's midpoint at 50, b's at 110
  assert.deepEqual(computeInsertionIndex(rects, 60), { index: 1, afterStripId: 'a', beforeStripId: 'b' });
});

// ── computeRackReconciliation ────────────────────────────────────────────
// guide §7.5.4 / §4.8.5 rule 3 / defect D6 — renderBay()'s keyed diff, made
// unit-testable per this file's own "math is pure, DOM wiring is manual QA"
// convention (see bay-view.js's module comment).

test('an unchanged Rack (same ids, same revs) rebuilds nothing', () => {
  const result = computeRackReconciliation(['a', 'b'], ['a', 'b'], new Set(), new Set());
  assert.deepEqual(result.toRemove, []);
  assert.deepEqual(result.order, [{ stripId: 'a', rebuild: false }, { stripId: 'b', rebuild: false }]);
});

test('a Strip no longer wanted is removed', () => {
  const result = computeRackReconciliation(['a', 'b'], ['a'], new Set(), new Set());
  assert.deepEqual(result.toRemove, ['b']);
  assert.deepEqual(result.order, [{ stripId: 'a', rebuild: false }]);
});

test('a newly wanted Strip not yet in the DOM is built (rebuild:true) even though it\'s not "dirty"', () => {
  const result = computeRackReconciliation(['a'], ['a', 'b'], new Set(), new Set());
  assert.deepEqual(result.order, [{ stripId: 'a', rebuild: false }, { stripId: 'b', rebuild: true }]);
});

test('a dirty existing Strip (rev changed, or selection changed) is rebuilt', () => {
  const result = computeRackReconciliation(['a', 'b'], ['a', 'b'], new Set(['b']), new Set());
  assert.deepEqual(result.order, [{ stripId: 'a', rebuild: false }, { stripId: 'b', rebuild: true }]);
});

test('a protected Strip (mid-drag or an open edit) is NEVER removed, even if no longer wanted', () => {
  const result = computeRackReconciliation(['a', 'b'], ['a'], new Set(), new Set(['b']));
  assert.deepEqual(result.toRemove, []);
});

test('a protected Strip is NEVER rebuilt, even if it\'s dirty', () => {
  const result = computeRackReconciliation(['a', 'b'], ['a', 'b'], new Set(['b']), new Set(['b']));
  assert.deepEqual(result.order, [{ stripId: 'a', rebuild: false }, { stripId: 'b', rebuild: false }]);
});

test('a protected Strip still appears in the order (so bay-view.js knows to skip it in place, not lose track of it)', () => {
  const result = computeRackReconciliation(['a', 'b', 'c'], ['c', 'b', 'a'], new Set(), new Set(['b']));
  assert.deepEqual(result.order.map(o => o.stripId), ['c', 'b', 'a']);
});
