'use strict';

// Which inputs may be the global PTT (S-RO-1 RO13). A hook does not swallow, so a key that is typed would transmit on
// every word, in any program. Letters, digits, numpad digits, punctuation, Space, Enter, Tab, Backspace, Delete, Esc,
// Shift and the left and right mouse buttons are refused.

const FUNCTION_KEYS = Array.from({ length: 24 }, (_, i) => `F${i + 1}`);
const OTHER_KEYS = ['ScrollLock', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'CtrlRight'];
const PAUSE = 0x0E45; // libuiohook's VC_PAUSE; uiohook-napi's key table leaves it out
const LABELS = { ScrollLock: 'Scroll Lock', PageUp: 'Page Up', PageDown: 'Page Down', ArrowLeft: 'Left', ArrowUp: 'Up', ArrowRight: 'Right', ArrowDown: 'Down', CtrlRight: 'Right Ctrl' };
const MOUSE = { 3: 'Middle Mouse', 4: 'Mouse 4', 5: 'Mouse 5' };

/** The key's label if it may be bound, else null. `keys` is uiohook-napi's UiohookKey. */
function bindableKeyLabel(keys, keycode) {
  if (keycode === PAUSE) return 'Pause';
  const name = [...FUNCTION_KEYS, ...OTHER_KEYS].find(k => keys[k] === keycode);
  return name ? (LABELS[name] || name) : null;
}

/** The button's label if it may be bound, else null. */
const bindableMouseLabel = (button) => MOUSE[button] || null;

module.exports = { bindableKeyLabel, bindableMouseLabel };
