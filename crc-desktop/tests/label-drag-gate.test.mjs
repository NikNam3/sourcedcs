/* A label is dragged to move it and clicked to open the track panel (docs/wip/STRIP-JUMP.md). The first click must
 * always count: a drag that ended off the label used to leave the "dragged" flag set, and the next label click was
 * thrown away. */

import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { LABEL_DRAG_THRESHOLD_PX, createLabelDragGate } from '../app/public/js/label-drag-gate.js';

test('the drag threshold is 8 px', () => {
  assert.equal(LABEL_DRAG_THRESHOLD_PX, 8);
});

test('a hand tremor under the threshold is still a click', () => {
  const g = createLabelDragGate();
  g.down();
  assert.equal(g.move(7), false);
  assert.equal(g.takeClick(), true);
});

test('a move of 8 px is a drag, and its click is not a click', () => {
  const g = createLabelDragGate();
  g.down();
  assert.equal(g.move(8), true);
  assert.equal(g.move(3), true, 'once dragging, every move moves the label');
  assert.equal(g.takeClick(), false);
});

test('a drag released off the label does not swallow the next click', () => {
  const g = createLabelDragGate();
  g.down();
  g.move(20); // released somewhere else: no click on the label follows
  g.down();
  assert.equal(g.takeClick(), true);
});

test('the map\'s click tolerance is the drag threshold, so a press under it is a click and one over it a drag', () => {
  // MapLibre drops `click` once mouse-up is clickTolerance px from mouse-down (default 3). Below the drag threshold and
  // above the tolerance a press did nothing at all: the label did not move and no panel opened.
  const src = fs.readFileSync(path.join(import.meta.dirname, '../app/public/js/map-setup.js'), 'utf8');
  assert.match(src, /clickTolerance: LABEL_DRAG_THRESHOLD_PX/);
});
