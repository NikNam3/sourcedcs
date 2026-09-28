'use strict';

/* Unit tests for strip-drag.js's pure insertion-index math (no DOM/real
   pointer events involved), matching los-math.test.js's style. */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeInsertionIndex, computeRackReconciliation, DRAG_THRESHOLD_PX, hasExceededDragThreshold,
  scrollCompensatedY, cachedTopToViewportY,
} = require('../app/public/js/panels/efsp/strip-drag.js');

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

// ── hasExceededDragThreshold — click vs. drag ────────────────────────────
// The actual bug this exists to fix: a click with negligible pointer
// movement (normal mouse/trackpad jitter) was being treated as a real
// drag and could silently relocate a Strip, since computeInsertionIndex
// above always resolves to SOME neighbor position when a Rack has other
// Strips — it has no "no movement happened" case of its own.

test('zero movement is well under the threshold', () => {
  assert.equal(hasExceededDragThreshold(0, 0), false);
});

test('movement just under the threshold does not count as a drag', () => {
  assert.equal(hasExceededDragThreshold(DRAG_THRESHOLD_PX - 1, 0), false);
  assert.equal(hasExceededDragThreshold(0, DRAG_THRESHOLD_PX - 1), false);
});

test('movement past the threshold counts as a drag, on either axis', () => {
  assert.equal(hasExceededDragThreshold(DRAG_THRESHOLD_PX + 1, 0), true);
  assert.equal(hasExceededDragThreshold(0, DRAG_THRESHOLD_PX + 1), true);
});

test('diagonal movement is measured as total distance (hypotenuse), not per-axis', () => {
  // dx=4, dy=4: neither axis alone exceeds the (default 5px) threshold,
  // but the combined distance (~5.66) does.
  assert.equal(hasExceededDragThreshold(4, 4), true);
  assert.equal(hasExceededDragThreshold(4, 0), false);
  assert.equal(hasExceededDragThreshold(0, 4), false);
});

test('negative deltas (movement up/left) are treated the same as positive ones', () => {
  assert.equal(hasExceededDragThreshold(-(DRAG_THRESHOLD_PX + 1), 0), true);
  assert.equal(hasExceededDragThreshold(0, -(DRAG_THRESHOLD_PX + 1)), true);
});

// ── scroll compensation — F-402 and F-404's shared mechanism ─────────────
// The cache of Strip rects is taken once (guide §7.2 rule 5) and the Rack
// then moves under it, so the pointer is mapped into the cache's coordinate
// space rather than the rects being re-measured. These are the two halves of
// that mapping: the query direction and the draw-the-line direction.

test('with no scrolling at all, the pointer Y is untouched', () => {
  assert.equal(scrollCompensatedY(300, 0, 0), 300);
  assert.equal(scrollCompensatedY(300, 545, 545), 300);
  assert.equal(cachedTopToViewportY(288, 120, 120), 288);
});

test('scrolling the Bay DOWN moves the pointer down in the cache\'s space by the same amount', () => {
  // The rects were measured at scrollTop 0; the Bay is now 600px further down,
  // so everything cached sits 600px higher than where it was measured. A
  // pointer at y=400 is over whatever was cached at y=1000.
  assert.equal(scrollCompensatedY(400, 0, 600), 1000);
});

test('scrolling the Bay UP moves it the other way', () => {
  assert.equal(scrollCompensatedY(400, 600, 0), -200);
});

test('the two directions are exact inverses', () => {
  const [atCache, now] = [120, 665];
  assert.equal(cachedTopToViewportY(scrollCompensatedY(430, atCache, now), atCache, now), 430);
  assert.equal(scrollCompensatedY(cachedTopToViewportY(430, atCache, now), atCache, now), 430);
});

test('F-404: a Strip dropped after a 600px scroll lands at the gap under the pointer, not where that gap used to be', () => {
  // Ten 140px Strips cached at scrollTop 0 with the dragged one out of the
  // flow; the Bay is wheeled down 600px mid-drag and released in the visible
  // gap between the Strips cached at 1260 and 1400 (i.e. at viewport y=1260-600).
  const rects = Array.from({ length: 9 }, (_, i) => ({ stripId: `c${i + 1}`, top: 280 + i * 140, height: 140 }));
  const pointerY = 1260 - 600;
  // Uncompensated, the drop lands near the top of the Rack — the measured bug.
  assert.deepEqual(computeInsertionIndex(rects, pointerY), { index: 3, afterStripId: 'c3', beforeStripId: 'c4' });
  // Compensated, it lands in the gap the controller was actually looking at.
  assert.deepEqual(computeInsertionIndex(rects, scrollCompensatedY(pointerY, 0, 600)),
    { index: 7, afterStripId: 'c7', beforeStripId: 'c8' });
});

test('F-402: rects measured AFTER the dragged Strip leaves the flow put it in the gap the insertion line is drawn in', () => {
  // The four-Strip case from the finding, 140px Strips. Cached at pointerdown
  // (A1 still in the flow) the answers are wrong by exactly one slot; cached
  // once A1 is `position: fixed` and the Rack has closed up, they are right.
  const pointerY = 572; // the midpoint of the VISIBLE A3|A4 gap, mid-drag
  const staleCache = [{ stripId: 'A2', top: 430, height: 140 }, { stripId: 'A3', top: 572, height: 140 }, { stripId: 'A4', top: 714, height: 140 }];
  assert.deepEqual(computeInsertionIndex(staleCache, pointerY), { index: 1, afterStripId: 'A2', beforeStripId: 'A3' });
  const freshCache = [{ stripId: 'A2', top: 288, height: 140 }, { stripId: 'A3', top: 430, height: 140 }, { stripId: 'A4', top: 572, height: 140 }];
  assert.deepEqual(computeInsertionIndex(freshCache, pointerY), { index: 2, afterStripId: 'A3', beforeStripId: 'A4' });
});

test('F-402: dragging UPWARD past Strips above the dragged one is unaffected by the re-cache', () => {
  // A4 dragged up into the A1|A2 gap. Nothing ABOVE the dragged Strip moves
  // when it leaves the flow, so the pointerdown cache and the post-class cache
  // are the same array here — which is why the upward case was never wrong,
  // and why re-caching must not change its answer either.
  const pointerY = 430; // the midpoint of the A1|A2 gap, unmoved by A4 leaving the flow
  const above = [{ stripId: 'A1', top: 288, height: 140 }, { stripId: 'A2', top: 430, height: 140 }, { stripId: 'A3', top: 572, height: 140 }];
  assert.deepEqual(computeInsertionIndex(above, pointerY), { index: 1, afterStripId: 'A1', beforeStripId: 'A2' });
});
