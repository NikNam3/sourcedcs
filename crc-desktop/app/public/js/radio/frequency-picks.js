'use strict';

// The frequency table as picks in + RADIO, for a session with no Positions of its own (docs/adr/0161 §2): the radio-only
// page signs on nowhere, so the table's frequencies would otherwise have to be typed by hand. A pick only fills the form.

import { el } from './radio-dom.js';
import { bandOf } from './bands.js';
import { frequencyRowName, frequencyText } from '../panels/efsp/frequency-state.js';

const LABEL_MAX = 12; // a manual radio's label (manual-radio-form.js)
const khzOf = (mhz) => Math.round(mhz * 1000);

function nameOf(row) {
  if (row.kind === 'SFA') return frequencyRowName(row);
  return row.label && row.label !== row.positionId ? `${row.positionId} ${row.label}` : row.positionId;
}

/**
 * The rows on a radio band not tuned yet, one per frequency, in table order.
 * @returns {Array<{ mhz: number, label: string, text: string }>} `label` for the radio, `text` for the menu
 */
export function frequencyPicks(rows = [], radios = []) {
  const taken = new Set(radios.filter(r => Number.isFinite(r.mhz)).map(r => khzOf(r.mhz)));
  const out = [];
  for (const row of rows) {
    if (!Number.isFinite(row.mhz) || bandOf(row.mhz) === null || taken.has(khzOf(row.mhz))) continue;
    taken.add(khzOf(row.mhz));
    const name = nameOf(row);
    out.push({ mhz: row.mhz, label: name.slice(0, LABEL_MAX), text: `${row.facilityId} ${name} ${frequencyText(row.mhz)}` });
  }
  return out;
}

/** The `<select>`; `onPick(pick)`. Its first entry picks nothing. */
export function buildFrequencyPickSelect(picks, onPick) {
  const sel = el('select', 'radio-link radio-frequency-picks', null, { title: 'A frequency from the frequency table', 'aria-label': 'Frequency table' });
  sel.appendChild(el('option', null, 'TABLE', { value: '' }));
  picks.forEach((p, i) => sel.appendChild(el('option', null, p.text, { value: String(i) })));
  sel.addEventListener('change', () => { if (sel.value !== '') onPick(picks[Number(sel.value)]); });
  return sel;
}
