/* A data block's estimated box (docs/adr/0165): the leader stops at its edge and a wide block grows away from its
 * track, so the remarks line (one more line, up to 20 characters) never runs into the target or the leader. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { boxEdgeDistPx, CHAR_EM, labelBoxPx, labelNudgePx, LINE_EM } from '../app/public/js/label-box.js';

test('the box is the longest line wide and one line height per line tall', () => {
  const box = labelBoxPx(['VIPER11', '120 28', 'NORDO CHECK LIGHTGUN'], 10);
  assert.equal(box.halfW, (20 * CHAR_EM * 10) / 2);
  assert.equal(box.halfH, (3 * LINE_EM * 10) / 2);
  assert.deepEqual(labelBoxPx([], 10), { halfW: 0, halfH: 0 });
});

test('a block wider than the base grows away from its track, on whichever side it sits', () => {
  assert.equal(labelNudgePx(50, 30, 44), 20, 'right of the track: moved right');
  assert.equal(labelNudgePx(50, 30, -44), -20, 'left of the track: moved left');
  assert.equal(labelNudgePx(25, 30, 44), 0, 'no wider than the base: where it was');
  assert.equal(labelNudgePx(50, 30, 0), 0, 'straight above or below: no side to grow away from');
});

test('the leader meets the box where its direction crosses the nearer edge', () => {
  assert.equal(boxEdgeDistPx(1, 0, 40, 20), 40, 'from the side');
  assert.equal(boxEdgeDistPx(0, -1, 40, 20), 20, 'from below');
  const d = Math.SQRT1_2;
  assert.ok(Math.abs(boxEdgeDistPx(d, d, 40, 20) - 20 / d) < 1e-9, 'at 45°: the top edge comes first');
  assert.equal(boxEdgeDistPx(0, 0, 40, 20), 0);
});
