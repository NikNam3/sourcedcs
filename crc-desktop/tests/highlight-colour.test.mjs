/* HIGHLIGHT's colours (docs/adr/0165): eight swatches, any #RRGGBB, never red (ATTENTION's, guide §7.7 rule 4). */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HIGHLIGHT_SWATCHES, hexToHsv, highlightFromInput, isNearRed, nextHighlightColour, parseHexColour,
} from '../app/public/js/panels/efsp/highlight-colour.js';

test('eight swatches, each a #rrggbb, none of them red', () => {
  assert.equal(HIGHLIGHT_SWATCHES.length, 8);
  assert.deepEqual(HIGHLIGHT_SWATCHES.map(s => s.name), ['yellow', 'cyan', 'lime', 'orange', 'pink', 'violet', 'white', 'sky blue']);
  for (const { hex } of HIGHLIGHT_SWATCHES) {
    assert.equal(parseHexColour(hex), hex);
    assert.equal(isNearRed(hex), false, hex);
  }
});

test('a typed colour is #RRGGBB in any case, with or without the #', () => {
  assert.equal(parseHexColour('#A77BFF'), '#a77bff');
  assert.equal(parseHexColour(' a77bff '), '#a77bff');
  for (const bad of ['', '#fff', '#12345g', 'yellow', '#1234567', null]) assert.equal(parseHexColour(bad), null, String(bad));
});

test('hue, saturation and value', () => {
  assert.deepEqual(hexToHsv('#ff0000'), { h: 0, s: 1, v: 1 });
  assert.deepEqual(hexToHsv('#00ff00'), { h: 120, s: 1, v: 1 });
  assert.deepEqual(hexToHsv('#000000'), { h: 0, s: 0, v: 0 });
  assert.equal(Math.round(hexToHsv('#ff00ff').h), 300);
});

test('close to red is a hue within 20° of red, saturated and bright enough to read as a colour', () => {
  for (const red of ['#ff0000', '#cc2222', '#e05030', '#ff2060', '#b03030']) assert.equal(isNearRed(red), true, red);
  assert.equal(isNearRed('#ff5500'), true, 'exactly 20°: still red');
  assert.equal(isNearRed('#ff6000'), false, 'past 20°: orange');
  assert.equal(isNearRed('#ff0066'), false, 'past 20° the other way: a rose');
  assert.equal(isNearRed('#d8b0b0'), false, 'pale: a pinkish grey');
  assert.equal(isNearRed('#401010'), false, 'dark: a brown');
});

test('a typed colour is set, or refused with a line saying why', () => {
  assert.deepEqual(highlightFromInput('#33E0FF'), { colour: '#33e0ff' });
  assert.match(highlightFromInput('#ee1111').error, /ATTENTION/);
  assert.match(highlightFromInput('blue').error, /#RRGGBB/);
});

test('Ctrl+click steps through the eight swatches, then off; any other colour starts at the first', () => {
  const hexes = HIGHLIGHT_SWATCHES.map(s => s.hex);
  let c = null;
  const seen = [];
  for (let i = 0; i < 9; i++) { c = nextHighlightColour(c); seen.push(c); }
  assert.deepEqual(seen, [...hexes, null]);
  assert.equal(nextHighlightColour('#123456'), hexes[0], 'a typed colour');
  assert.equal(nextHighlightColour('yellow'), hexes[0], 'a name an older client wrote');
});

test('a tooltip names a swatch, and shows any other colour as stored', async () => {
  const { highlightName } = await import('../app/public/js/panels/efsp/highlight-colour.js');
  assert.equal(highlightName('#a77bff'), 'violet');
  assert.equal(highlightName('#123456'), '#123456');
  assert.equal(highlightName('yellow'), 'yellow');
});
