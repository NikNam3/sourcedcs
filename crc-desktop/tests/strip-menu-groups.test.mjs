// The Strip ⋯ menu prints each group heading once (LT-UI finding, S-ARCH-49: "Flight" could appear twice).
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupStripMenuItems } from '../app/public/js/panels/efsp/strip-menu.js';

test('groupStripMenuItems: a group that recurs after another is pulled together, in first-appearance order', () => {
  const items = [
    { group: 'Start', key: 'tofi' },
    { group: 'Flight', key: 'marsa' },
    { group: 'Formation', key: 'split' },
    { group: 'Flight', key: 'show-on-map' },
    { group: 'Flight', key: 'bind' },
    { group: 'Strip', key: 'offset' },
  ];
  const out = groupStripMenuItems(items);
  assert.deepEqual(out.map(i => i.key), ['tofi', 'marsa', 'show-on-map', 'bind', 'split', 'offset']);
  const headings = out.map(i => i.group).filter((g, i, a) => i === 0 || a[i - 1] !== g);
  assert.deepEqual(headings, ['Start', 'Flight', 'Formation', 'Strip']);
});

test('groupStripMenuItems: an empty menu stays empty', () => {
  assert.deepEqual(groupStripMenuItems([]), []);
});
