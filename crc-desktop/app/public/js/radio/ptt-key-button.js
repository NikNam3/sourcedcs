'use strict';

// A window PTT key chooser for SETUP (the PTT key, and the intercom PTT key, docs/adr/0166 §1): click, then press the
// key (capture phase, before any PTT handler sees it); Escape leaves it as it was. With `clearable`, a CLEAR button sets
// it to none. `choose(code)` stores the key and returns false when it was refused (it is the other PTT's key), which
// shows `refusedText` under the row until the next choice.

import { el } from './radio-dom.js';

export function keyLabel(code) {
  if (!code) return 'none';
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
export function buildPttKeyButton({ current, choose, clearable = false, refusedText = '', title = 'Click, then press the key' }) {
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
  button.addEventListener('click', () => { listening = true; button.textContent = 'press a key'; button.classList.add('radio-listening'); });
  document.addEventListener('keydown', onKey, true);
  const controls = [button];
  if (clearable) {
    const clear = el('button', 'radio-small-btn', 'CLEAR', { type: 'button', title: 'No key' });
    clear.addEventListener('click', () => { listening = false; button.classList.remove('radio-listening'); choose(null); show(false); });
    controls.push(clear);
  }
  return {
    controls, note,
    refresh() { if (!listening) button.textContent = keyLabel(current()); },
    dispose() { document.removeEventListener('keydown', onKey, true); },
  };
}
