'use strict';

// The global PTT listener for Windows and X11 (docs/adr/0161 §3): `uiohook-napi`, a system-wide hook that observes and
// never swallows, so DCS still gets the key. The native module loads on first use, inside the caller's try (index.js):
// requiring this file loads nothing native. Every event is dropped here unless it is the bound input; nothing is logged.

const { bindableKeyLabel, bindableMouseLabel } = require('./input-allowlist');

const LEFT_BUTTON = 1; // ignored by a capture: it is how the controller clicks to cancel
const EVENTS = ['keydown', 'keyup', 'mousedown', 'mouseup'];
const X11_RELEASE_HOLD_MS = 15; // S-RO-1 RO14: soft autorepeat can arrive as release-and-press pairs

/** @param {{load?:()=>{uIOhook:object, UiohookKey:object}, defer?:(fn:Function)=>void, platform?:string}} [o] */
function createUiohookListener(o = {}) {
  const load = o.load || (() => require('uiohook-napi'));
  const defer = o.defer || setImmediate;
  const platform = o.platform || process.platform;
  let lib = null;
  let bound = null;      // the handlers on the hook, while it runs
  let finishCapture = null;

  const native = () => (lib = lib || load());

  function removeHandlers() {
    if (!bound) return false;
    for (const name of EVENTS) lib.uIOhook.removeListener(name, bound[name]);
    bound = null;
    return true;
  }

  function hookOn(handlers) {
    const { uIOhook } = native();
    for (const name of EVENTS) uIOhook.on(name, handlers[name]);
    bound = handlers;
    try {
      uIOhook.start();
    } catch (err) {
      removeHandlers();
      throw err;
    }
  }

  function start(binding, onEdge) {
    const isKey = binding.type === 'key';
    const key = (down) => (e) => { if (isKey && e.keycode === binding.keycode) onEdge(down); };
    const mouse = (down) => (e) => { if (!isKey && e.button === binding.button) onEdge(down); };
    hookOn({ keydown: key(true), keyup: key(false), mousedown: mouse(true), mouseup: mouse(false) });
  }

  function stop() { if (removeHandlers()) lib.uIOhook.stop(); }

  // Reports the first input when it is released, so the hook is never restarted with the chosen key still down (its
  // auto-repeat would key the radio). An input off the allow-list ends the capture as `{ refused: true }`, without
  // saying which it was. Escape cancels. The stop is deferred out of the native callback.
  function capture() {
    return new Promise((resolve, reject) => {
      let pending = null; // the input that was pressed first
      const finish = (result) => {
        finishCapture = null;
        removeHandlers();
        defer(() => { lib.uIOhook.stop(); resolve(result); });
      };
      finishCapture = finish;
      const report = () => finish(pending.binding || { refused: true });
      const handlers = {
        keydown: (e) => {
          if (pending || !e.keycode) return;
          const keys = native().UiohookKey;
          if (e.keycode === keys.Escape) { finish(null); return; }
          const label = bindableKeyLabel(keys, e.keycode);
          pending = { keycode: e.keycode, binding: label && { type: 'key', keycode: e.keycode, label } };
        },
        keyup: (e) => { if (pending && e.keycode === pending.keycode) report(); },
        mousedown: (e) => {
          if (pending || e.button === LEFT_BUTTON) return;
          const label = bindableMouseLabel(e.button);
          pending = { button: e.button, binding: label && { type: 'mouse', button: e.button, label } };
        },
        mouseup: (e) => { if (pending && e.button === pending.button) report(); },
      };
      try {
        hookOn(handlers);
      } catch (err) {
        finishCapture = null;
        reject(err);
      }
    });
  }

  function cancelCapture() { if (finishCapture) finishCapture(null); }

  function accepts(b) {
    if (!b || typeof b.label !== 'string') return false;
    if (b.type === 'key') return !!lib && bindableKeyLabel(lib.UiohookKey, b.keycode) !== null;
    return b.type === 'mouse' && bindableMouseLabel(b.button) !== null;
  }

  /** Loads the native module (which starts no hook). Throws if it cannot. */
  async function probe() { native(); }

  return { kind: 'uiohook', releaseHoldMs: platform === 'linux' ? X11_RELEASE_HOLD_MS : 0, probe, start, stop, capture, cancelCapture, accepts };
}

module.exports = { createUiohookListener };
