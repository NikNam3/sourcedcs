'use strict';

// The global PTT listener for Windows and X11 (docs/adr/0161 §3): `uiohook-napi`, a system-wide hook that observes and
// never swallows, so DCS still gets the key. The native module loads on first use, inside the caller's try (index.js):
// requiring this file loads nothing native. Every event is dropped here unless it is the bound input; nothing is logged.

const LEFT_BUTTON = 1; // never bindable: it would key the radio on every click, and it is how the capture is cancelled
const MOUSE_NAMES = { 2: 'Right Mouse', 3: 'Middle Mouse' };
const SIDED = {
  Ctrl: 'Left Ctrl', CtrlRight: 'Right Ctrl', Alt: 'Left Alt', AltRight: 'Right Alt',
  Shift: 'Left Shift', ShiftRight: 'Right Shift', Meta: 'Left Meta', MetaRight: 'Right Meta',
};
const EVENTS = ['keydown', 'keyup', 'mousedown', 'mouseup'];

function keyName(keys, code) {
  const found = Object.keys(keys).find(k => keys[k] === code);
  if (!found) return `Key ${code}`;
  return SIDED[found] || found;
}

/** @param {{load?:()=>{uIOhook:object, UiohookKey:object}, defer?:(fn:Function)=>void}} [o] */
function createUiohookListener(o = {}) {
  const load = o.load || (() => require('uiohook-napi'));
  const defer = o.defer || setImmediate;
  let lib = null;
  let bound = null;      // the handlers on the hook, while it runs
  let finishCapture = null;

  const native = () => (lib = lib || load());

  function hookOn(handlers) {
    const { uIOhook } = native();
    for (const name of EVENTS) uIOhook.on(name, handlers[name]);
    bound = handlers;
    try {
      uIOhook.start();
    } catch (err) {
      hookOff();
      throw err;
    }
  }

  function removeHandlers() {
    if (!bound) return false;
    for (const name of EVENTS) lib.uIOhook.removeListener(name, bound[name]);
    bound = null;
    return true;
  }

  function hookOff() { if (removeHandlers()) lib.uIOhook.stop(); }

  function start(binding, onEdge) {
    const isKey = binding.type === 'key';
    const key = (down) => (e) => { if (isKey && e.keycode === binding.code) onEdge(down); };
    const mouse = (down) => (e) => { if (!isKey && e.button === binding.button) onEdge(down); };
    hookOn({ keydown: key(true), keyup: key(false), mousedown: mouse(true), mouseup: mouse(false) });
  }

  function stop() { hookOff(); }

  // Reports the first input when it is released, so the hook is never restarted with the chosen key still down (its
  // auto-repeat would key the radio). Escape cancels. The stop is deferred out of the native callback.
  function capture() {
    return new Promise((resolve, reject) => {
      let pending = null; // the input that was pressed first
      const finish = (result) => {
        finishCapture = null;
        removeHandlers();
        defer(() => { lib.uIOhook.stop(); resolve(result); });
      };
      finishCapture = finish;
      const nameKey = (code) => keyName(native().UiohookKey, code);
      const handlers = {
        keydown: (e) => {
          if (pending || !e.keycode) return;
          if (e.keycode === native().UiohookKey.Escape) { finish(null); return; }
          pending = { type: 'key', code: e.keycode, name: nameKey(e.keycode) };
        },
        keyup: (e) => { if (pending && pending.type === 'key' && e.keycode === pending.code) finish(pending); },
        mousedown: (e) => {
          if (pending || e.button === LEFT_BUTTON) return;
          pending = { type: 'mouse', button: e.button, name: MOUSE_NAMES[e.button] || `Mouse ${e.button}` };
        },
        mouseup: (e) => { if (pending && pending.type === 'mouse' && e.button === pending.button) finish(pending); },
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
    if (!b || typeof b.name !== 'string') return false;
    if (b.type === 'key') return Number.isInteger(b.code) && b.code > 0;
    return b.type === 'mouse' && Number.isInteger(b.button) && b.button !== LEFT_BUTTON;
  }

  /** Loads the native module (which starts no hook). Throws if it cannot. */
  async function probe() { native(); }

  return { kind: 'uiohook', probe, start, stop, capture, cancelCapture, accepts };
}

module.exports = { createUiohookListener };
