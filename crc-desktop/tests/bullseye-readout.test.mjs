/* The bullseye cursor readout (H163, U-FT-SMALL item 1): a tactical aid, so it is hidden while the session is
 * ATC-only (atc-scope.js atcOnlySession(), the rule the black scope already uses), live on a sign-on or a new
 * coverage, and blank whenever the cursor is not over the map (the canvas's mouseleave, which also fires when the
 * cursor moves onto a panel covering the map).
 */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { makeElement } = require('./helpers/dom-stub.js');

// Every id answers an element, so the topbar's other 'scope' listener (updateTopbarUI) runs too.
const els = new Map();
document.getElementById = (id) => { if (!els.has(id)) els.set(id, makeElement('div')); return els.get(id); };
const bra = document.getElementById('cursor-bra');

const { updateBullseyeCursor, hideBullseyeCursor } = await import('../app/public/js/panels/topbar.js');
const picture = await import('../app/public/js/picture.js');
const { _setMap } = await import('../app/public/js/map-handle.js');
const { markEfspChanged } = await import('../app/public/js/panels/efsp/efsp-change-bus.js');

_setMap({
  getCanvas: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }),
  unproject: () => ({ lat: 37.2, lng: 35.6 }),
});
picture.setMissionData({ bullseye: { blue: { lat: 37.0, lon: 35.4 } } });

const ATC = { id: 'r-atc', presentation: 'ATC' };
const TAC = { id: 'r-tac', presentation: 'TACTICAL' };
const move = () => updateBullseyeCursor({ clientX: 200, clientY: 200 });
const shown = () => bra.classList.contains('visible');
const session = (radars, datalink = false) => { picture._setCoverageRadars(radars); picture._setCoverageDatalink(datalink); };

test('signed on to nothing: the readout follows the cursor', () => {
  session([]);
  move();
  assert.equal(shown(), true);
  assert.match(bra.textContent, /\/015$/);
});

test('a tactical session (a tactical radar, or ATC plus a tactical one, or the datalink) shows it', () => {
  for (const [radars, dl] of [[[TAC], false], [[ATC, TAC], false], [[ATC], true]]) {
    hideBullseyeCursor();
    session(radars, dl);
    move();
    assert.equal(shown(), true, JSON.stringify({ radars, dl }));
  }
});

test('an ATC-only session never shows it', () => {
  session([ATC]);
  hideBullseyeCursor();
  move();
  assert.equal(shown(), false);
});

test('becoming ATC-only with the cursor at rest blanks it on the positions / scope topic', () => {
  for (const topic of ['positions', 'scope']) {
    session([TAC]);
    move();
    assert.equal(shown(), true);
    session([ATC]);
    markEfspChanged(topic);
    assert.equal(shown(), false, topic);
  }
});

test('leaving the map blanks it: the canvas mouseleave calls hideBullseyeCursor', () => {
  session([TAC]);
  move();
  hideBullseyeCursor();
  assert.equal(shown(), false);
  const src = fs.readFileSync(path.join(import.meta.dirname, '../app/public/js/map-interactions.js'), 'utf8');
  assert.match(src, /getCanvas\(\)\.addEventListener\('mouseleave', \(\) => hideBullseyeCursor\(\)\)/);
});
