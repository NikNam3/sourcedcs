// The SRS push-to-talk state machine, apart from the DOM so a test can drive it (B8, docs/wip/ARCH-C.md §3.4).
//
// This keys a real radio frequency, so a transmission must never outlive the operator's hand:
//  - a keyup of the PTT key releases wherever focus is (the old code ignored it inside an input, so a key pressed
//    on the map and released after clicking into a field stayed open);
//  - losing the window (`blur`, `visibilitychange` to hidden) releases, because the keyup goes to another window;
//  - a maximum key-down time releases a transmission anyway (the safety net), and the key must be lifted and
//    pressed again to transmit afterwards.
// Several sources can hold it at once (docs/adr/0161 §3, S-RO-1 RO14): `window` (the key), `button` (on screen) and
// `global` (an input heard outside the window). It transmits while any holds. Losing the window ends the two that live
// in the window, never `global`, whose release comes from outside. The fuse ends all and latches until every source
// has let go.
// lxsrs has no timeout of its own: it transmits for as long as `/ptt/start` keeps arriving every REPEAT_MS.

import { mouseCode } from './radio/ptt-mouse.js';

export const PTT_REPEAT_MS = 400;
/** Longest continuous transmission. A GCI call is seconds long; DCS-SRS itself has no limit (the key is the limit),
 *  so this is a CRC-side fuse, set well past any real call and short enough to end a stuck radio quickly. */
export const PTT_MAX_TX_DEFAULT_S = 30;
export const PTT_MAX_TX_MIN_S = 5;
export const PTT_MAX_TX_MAX_S = 120;

export function clampMaxTxSeconds(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return PTT_MAX_TX_DEFAULT_S;
  return Math.min(PTT_MAX_TX_MAX_S, Math.max(PTT_MAX_TX_MIN_S, n));
}

/**
 * @param {object} o
 * @param {(path:string)=>void} o.post        sends /ptt/start or /ptt/stop
 * @param {(on:boolean)=>void} o.setActive    paints the button
 * @param {()=>string} o.getKey               the configured KeyboardEvent.code, or a mouse code (radio/ptt-mouse.js)
 * @param {()=>boolean} o.isTyping            focus is in a text field (only a keydown is refused there)
 * @param {{addEventListener:Function}} o.win
 * @param {{addEventListener:Function, hidden?:boolean}} o.doc
 * @param {()=>number} [o.getMaxTxSeconds]
 * @param {Function} [o.setInterval] @param {Function} [o.clearInterval] @param {Function} [o.setTimeout] @param {Function} [o.clearTimeout]
 * @param {(msg:string)=>void} [o.log]
 * @param {()=>void} [o.onFuse]  the maximum transmit time ended a transmission
 */
export function createPttController(o) {
  const si = o.setInterval || setInterval, ci = o.clearInterval || clearInterval;
  const st = o.setTimeout || setTimeout, ct = o.clearTimeout || clearTimeout;
  const log = o.log || (() => {});
  const maxMs = () => clampMaxTxSeconds(o.getMaxTxSeconds ? o.getMaxTxSeconds() : PTT_MAX_TX_DEFAULT_S) * 1000;
  let held = false, repeat = null, fuse = null;
  let keyDown = false; // the PTT key is physically down (set on keydown, cleared on keyup, blur)
  let latched = false; // the fuse fired and a source has not let go yet
  const holding = { window: false, button: false, global: false };
  const anyHolding = () => holding.window || holding.button || holding.global;

  function engage() {
    if (held || latched) return;
    held = true;
    o.post('/ptt/start');
    repeat = si(() => o.post('/ptt/start'), PTT_REPEAT_MS);
    fuse = st(() => {
      log(`PTT released after the ${maxMs() / 1000} s maximum transmit time`);
      latched = true;
      disengage();
      if (o.onFuse) o.onFuse();
    }, maxMs());
    o.setActive(true);
  }

  function disengage() {
    if (!held) return;
    held = false;
    ci(repeat); repeat = null;
    ct(fuse); fuse = null;
    o.post('/ptt/stop');
    o.setActive(false);
  }

  function settle() {
    if (anyHolding()) return;
    latched = false;
    disengage();
  }

  function down(source = 'button') { holding[source] = true; engage(); }
  function up(source = 'button') { holding[source] = false; settle(); }

  function releaseWindow() { keyDown = false; holding.window = false; holding.button = false; settle(); }

  o.doc.addEventListener('keydown', (e) => {
    if (e.code !== o.getKey() || e.repeat || o.isTyping()) return;
    if (e.preventDefault) e.preventDefault();
    keyDown = true;
    down('window');
  });
  // No isTyping() test: the release must work wherever focus has moved to since the key went down.
  o.doc.addEventListener('keyup', (e) => { if (e.code === o.getKey()) { keyDown = false; up('window'); } });
  // A mouse button as the PTT (radio/ptt-mouse.js): the middle or a side button, anywhere in the window, typing or not.
  // preventDefault keeps the middle button's autoscroll and the side buttons' back / forward off it.
  const isPttButton = (e) => { const code = mouseCode(e.button); return !!code && code === o.getKey(); };
  o.doc.addEventListener('mousedown', (e) => {
    if (!isPttButton(e)) return;
    if (e.preventDefault) e.preventDefault();
    keyDown = true;
    down('window');
  }, true);
  o.doc.addEventListener('mouseup', (e) => {
    if (!isPttButton(e)) return;
    if (e.preventDefault) e.preventDefault();
    keyDown = false;
    up('window');
  }, true);
  o.doc.addEventListener('auxclick', (e) => { if (isPttButton(e) && e.preventDefault) e.preventDefault(); }, true);
  o.win.addEventListener('blur', releaseWindow);
  o.doc.addEventListener('visibilitychange', () => { if (o.doc.hidden) releaseWindow(); });

  return { down, up, isHeld: () => held, isKeyDown: () => keyDown };
}
