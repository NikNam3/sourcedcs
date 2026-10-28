// The SRS push-to-talk state machine, apart from the DOM so a test can drive it (B8, docs/wip/ARCH-C.md §3.4).
//
// This keys a real radio frequency, so a transmission must never outlive the operator's hand:
//  - a keyup of the PTT key releases wherever focus is (the old code ignored it inside an input, so a key pressed
//    on the map and released after clicking into a field stayed open);
//  - losing the window (`blur`, `visibilitychange` to hidden) releases, because the keyup goes to another window;
//  - a maximum key-down time releases a transmission anyway (the safety net), and the key must be lifted and
//    pressed again to transmit afterwards.
// lxsrs has no timeout of its own: it transmits for as long as `/ptt/start` keeps arriving every REPEAT_MS.

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
 * @param {()=>string} o.getKey               the configured KeyboardEvent.code
 * @param {()=>boolean} o.isTyping            focus is in a text field (only a keydown is refused there)
 * @param {{addEventListener:Function}} o.win
 * @param {{addEventListener:Function, hidden?:boolean}} o.doc
 * @param {()=>number} [o.getMaxTxSeconds]
 * @param {Function} [o.setInterval] @param {Function} [o.clearInterval] @param {Function} [o.setTimeout] @param {Function} [o.clearTimeout]
 * @param {(msg:string)=>void} [o.log]
 */
export function createPttController(o) {
  const si = o.setInterval || setInterval, ci = o.clearInterval || clearInterval;
  const st = o.setTimeout || setTimeout, ct = o.clearTimeout || clearTimeout;
  const log = o.log || (() => {});
  const maxMs = () => clampMaxTxSeconds(o.getMaxTxSeconds ? o.getMaxTxSeconds() : PTT_MAX_TX_DEFAULT_S) * 1000;
  let held = false, repeat = null, fuse = null;
  let keyDown = false; // the PTT key is physically down (set on keydown, cleared on keyup, blur)

  function down() {
    if (held) return;
    held = true;
    o.post('/ptt/start');
    repeat = si(() => o.post('/ptt/start'), PTT_REPEAT_MS);
    fuse = st(() => { log(`PTT released after the ${maxMs() / 1000} s maximum transmit time`); up(); }, maxMs());
    o.setActive(true);
  }

  function up() {
    if (!held) return;
    held = false;
    ci(repeat); repeat = null;
    ct(fuse); fuse = null;
    o.post('/ptt/stop');
    o.setActive(false);
  }

  function releaseAll() { keyDown = false; up(); }

  o.doc.addEventListener('keydown', (e) => {
    if (e.code !== o.getKey() || e.repeat || o.isTyping()) return;
    if (e.preventDefault) e.preventDefault();
    keyDown = true;
    down();
  });
  // No isTyping() test: the release must work wherever focus has moved to since the key went down.
  o.doc.addEventListener('keyup', (e) => { if (e.code === o.getKey()) releaseAll(); });
  o.win.addEventListener('blur', releaseAll);
  o.doc.addEventListener('visibilitychange', () => { if (o.doc.hidden) releaseAll(); });

  return { down, up, isHeld: () => held, isKeyDown: () => keyDown };
}
