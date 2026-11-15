import test from 'node:test';
import assert from 'node:assert/strict';
import { isMouseCode, mouseCode, mouseLabel } from '../app/public/js/radio/ptt-mouse.js';
import { keyLabel } from '../app/public/js/radio/ptt-key-button.js';

test('only the middle and side buttons are PTT buttons, with Global PTT labels', () => {
  assert.equal(mouseCode(0), null, 'left');
  assert.equal(mouseCode(2), null, 'right');
  assert.equal(mouseCode(1), 'MouseMiddle');
  assert.equal(mouseCode(3), 'Mouse4');
  assert.equal(mouseCode(4), 'Mouse5');
  assert.equal(isMouseCode('Mouse4'), true);
  assert.equal(isMouseCode('KeyM'), false);
  assert.equal(mouseLabel('MouseMiddle'), 'Middle Mouse');
  assert.equal(keyLabel('Mouse5'), 'Mouse 5');
  assert.equal(keyLabel('KeyT'), 'T');
});
