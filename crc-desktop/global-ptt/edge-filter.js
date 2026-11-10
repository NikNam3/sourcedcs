'use strict';

// Turns a listener's raw presses and releases into clean edges (S-RO-1 RO14). A hook has no repeat filter, so:
//  - a press while down is dropped;
//  - on X11 a held key can arrive as release-and-press pairs: a release waits `releaseHoldMs`, and a press inside that
//    window cancels it;
//  - after the renderer's transmit fuse fires, a press is ignored until a release, or until SILENCE_MS with no press.
//    Repeats stay latched, and a release the listener never saw (a lock screen, an elevated window) cannot leave it
//    deaf: the silence reports the release, and the next real press works.

const SILENCE_MS = 1000;

/**
 * @param {object} o
 * @param {(down:boolean)=>void} o.emit
 * @param {number} [o.releaseHoldMs]
 * @param {Function} [o.setTimeout] @param {Function} [o.clearTimeout]
 */
function createEdgeFilter(o) {
  const st = o.setTimeout || setTimeout, ct = o.clearTimeout || clearTimeout;
  const holdMs = o.releaseHoldMs || 0;
  let down = false, latched = false, hold = null, silence = null;

  const clearHold = () => { if (hold !== null) { ct(hold); hold = null; } };
  const clearSilence = () => { if (silence !== null) { ct(silence); silence = null; } };

  function finishRelease() {
    clearHold(); clearSilence();
    latched = false;
    if (!down) return;
    down = false;
    o.emit(false);
  }

  const restartSilence = () => { clearSilence(); silence = st(finishRelease, SILENCE_MS); };

  function press() {
    if (hold !== null) { clearHold(); if (latched) restartSilence(); return; }
    if (latched) { restartSilence(); return; }
    if (down) return;
    down = true;
    o.emit(true);
  }

  function release() {
    if (!down) return;
    if (!holdMs) { finishRelease(); return; }
    if (hold === null) hold = st(finishRelease, holdMs);
  }

  function fuse() {
    if (!down || latched) return;
    latched = true;
    restartSilence();
  }

  return { press, release, fuse, reset: finishRelease };
}

module.exports = { createEdgeFilter, SILENCE_MS };
