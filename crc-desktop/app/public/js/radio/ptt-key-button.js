'use strict';

// A window PTT key chooser for SETUP (the PTT key, and the intercom PTT key, docs/adr/0166 §1): click, then press the
// key or a mouse button (middle, Mouse 4, Mouse 5: radio/ptt-mouse.js; capture phase, before any PTT handler sees it);
// Escape leaves it as it was. With `clearable`, a CLEAR button sets
// it to none. `choose(code)` stores the key and returns false when it was refused (it is the other PTT's key), which
// shows `refusedText` under the row until the next choice.

import { el } from './radio-dom.js';
import { mouseCode, mouseLabel } from './ptt-mouse.js';

export function keyLabel(code) {
  if (!code) return 'none';
  const mouse = mouseLabel(code);
  if (mouse) return mouse;
  return code === 'Space' ? 'Space' : String(code).replace(/^Key/, '').replace(/^Digit/, '');
}

/**
 * @param {object} o
 * @param {() => string|null} o.current  the stored key
 * @param {(code:string|null) => boolean} o.choose  stores it; false: refused
 * @param {boolean} [o.clearable]
 * @param {string} [o.refusedText]
 * @param {string} [o.title]
 * @returns {{ controls: HTMLElement[], note: HTMLElement, refresh(): void, dispose(): void }}  refresh: the stored key changed
 */
export function buildPttKeyButton({ current, choose, clearable = false, refusedText = '', title = 'Click, then press the key or mouse button (middle, 4, 5)' }) {
  const button = el('button', 'radio-small-btn radio-ptt-key', keyLabel(current()), { type: 'button', title });
  const note = el('div', 'radio-note');
  note.hidden = true;
  let listening = false;
  const show = (refused) => {
    button.textContent = keyLabel(current());
    note.textContent = refused ? refusedText : '';
    note.hidden = !refused;
  };
  const onKey = (e) => {
    if (!listening) return;
    e.preventDefault(); e.stopPropagation();
    listening = false;
    button.classList.remove('radio-listening');
    show(e.code !== 'Escape' && choose(e.code) === false);
  };
  const onMouse = (e) => {
    if (!listening) return;
    const code = mouseCode(e.button);
    if (!code) return; // left and right are not PTT buttons: keep listening
    e.preventDefault(); e.stopPropagation();
    listening = false;
    button.classList.remove('radio-listening');
    show(choose(code) === false);
  };
  const swallowAux = (e) => { if (mouseCode(e.button)) e.preventDefault(); };
  button.addEventListener('click', () => { listening = true; button.textContent = 'press a key or button'; button.classList.add('radio-listening'); });
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', onMouse, true);
  button.addEventListener('auxclick', swallowAux);
  const controls = [button];
  if (clearable) {
    const clear = el('button', 'radio-small-btn', 'CLEAR', { type: 'button', title: 'No key' });
    clear.addEventListener('click', () => { listening = false; button.classList.remove('radio-listening'); choose(null); show(false); });
    controls.push(clear);
  }
  return {
    controls, note,
    refresh() { if (!listening) button.textContent = keyLabel(current()); },
    dispose() { document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onMouse, true); },
  };
}
