/* U-STRIP (decisions.md H138 U2, H139): the remarks Block on every strip type, and the cut that keeps the face's RMKS
   row one line at a word boundary. Pure: `fits` stands in for the laid-out row. */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { BLOCK_MAPS, blockLabelFor, cutRemarksToFit, isBlockEditable, remarksBlockFor, remarksOf } from '../app/public/js/panels/efsp/strip-template.js';

test('every strip type has one remarks Block, labelled RMKS: 9E, and M8 on MISSION', () => {
  for (const type of Object.keys(BLOCK_MAPS)) {
    const id = remarksBlockFor(type);
    assert.equal(id, type === 'MISSION' ? 'M8' : '9E', type);
    assert.equal(blockLabelFor(id, type), 'RMKS', type);
    assert.equal(isBlockEditable(id, type, type === 'FINAL' ? 'CARRIER' : null), true, `${type}: an ordinary SetBlock`);
  }
  assert.equal(remarksBlockFor('NOPE'), null);
});

test('remarksOf: blank is none, so an absent row takes no space', () => {
  assert.equal(remarksOf(null), '');
  assert.equal(remarksOf({ filed: {} }), '');
  assert.equal(remarksOf({ filed: { remarks: '   ' } }), '');
  assert.equal(remarksOf({ filed: { remarks: 'PPR 1420' } }), 'PPR 1420');
});

const fitsIn = (n) => (s) => s.length <= n;

test('cutRemarksToFit: whole when it fits, on one line', () => {
  assert.equal(cutRemarksToFit('PPR 1420', fitsIn(20)), 'PPR 1420');
  assert.equal(cutRemarksToFit('PPR 1420\n  TAIL   SWAP', fitsIn(40)), 'PPR 1420 TAIL SWAP');
  assert.equal(cutRemarksToFit('', fitsIn(5)), '');
});

test('cutRemarksToFit: the longest word-boundary prefix that fits with the ellipsis', () => {
  const text = 'Formations expect block FL210-FL230. RECOVERY: contact Ankara Center';
  assert.equal(cutRemarksToFit(text, fitsIn(30)), 'Formations expect block…');
  assert.equal(cutRemarksToFit(text, fitsIn(37)), 'Formations expect block FL210-FL230…', 'trailing punctuation goes before the ellipsis');
  for (let n = 12; n < text.length; n++) {
    const cut = cutRemarksToFit(text, fitsIn(n));
    assert.ok(cut.length <= n, `${n}: ${cut}`);
    assert.match(cut, /…$/);
    const shown = cut.slice(0, -1);
    assert.ok(text.startsWith(shown), `${n}: a prefix`);
    assert.match(text.charAt(shown.length), /[\s.,;:\-]/, `${n}: at a boundary`);
  }
});

test('cutRemarksToFit: a first word longer than the row comes back whole, for the CSS ellipsis', () => {
  assert.equal(cutRemarksToFit('SUPERCALIFRAGILISTIC remarks', fitsIn(8)), 'SUPERCALIFRAGILISTIC remarks');
});
