'use strict';

// The radio panel's "+ RADIO" form: a manual radio, label and frequency (S-RADIO-2 RQ19: none is seeded). The
// frequency check is the FREQUENCIES panel's (frequency-state.js parseFrequencyInput: 30 to 400 MHz, on a channel).

import { el } from './radio-dom.js';
import { parseFrequencyInput } from '../panels/efsp/frequency-state.js';

/** `{ mhz }` or `{ error }` for what the controller typed. */
export function parseManualFrequency(text) { return parseFrequencyInput(text, null); }

/**
 * @param {object} ctx  open, error, onOpen(on), onAdd({ label, text })
 */
export function buildManualRadioForm(ctx) {
  const wrap = el('span', 'radio-manual-form');
  if (!ctx.open) {
    const b = el('button', 'radio-small-btn', '+ RADIO', { type: 'button', title: 'A manual radio' });
    b.addEventListener('click', () => ctx.onOpen(true));
    wrap.appendChild(b);
    return wrap;
  }
  const label = el('input', 'radio-manual-label', null, { type: 'text', placeholder: 'LABEL', maxlength: 12, 'aria-label': 'Label' });
  const freq = el('input', 'radio-freq-input', null, { type: 'text', inputmode: 'decimal', placeholder: 'MHz', 'aria-label': 'Frequency MHz' });
  const add = el('button', 'radio-small-btn', 'ADD', { type: 'button' });
  const cancel = el('button', 'radio-small-btn', 'CANCEL', { type: 'button' });
  const submit = () => ctx.onAdd({ label: label.value, text: freq.value });
  add.addEventListener('click', submit);
  cancel.addEventListener('click', () => ctx.onOpen(false));
  for (const i of [label, freq]) {
    i.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); ctx.onOpen(false); }
    });
  }
  queueMicrotask(() => freq.focus());
  wrap.append(label, freq, add, cancel);
  if (ctx.error) wrap.appendChild(el('span', 'radio-note radio-conflict', ctx.error));
  return wrap;
}
