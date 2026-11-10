'use strict';

// One radio's row in the radio panel: the PTT target mark, label, frequency, band (and AM/FM on a manual radio),
// RX/TX lit from the engine, volume, pan, mute, the link menu, and for a manual radio retune and remove. The
// intercom (H183) has its unit picker instead of the link menu, and a remove. Dark cockpit:
// grey throughout; RX and TX light while they happen; a conflict is amber because it is a problem; a receive-only
// radio says RX ONLY in grey, and so does a radio with no SRS slot (S-RADIO-1 RQ13).

import { el } from './radio-dom.js';
import { radioBandText, radioFrequencyText } from './radio-panel-model.js';
import { VOLUME_MAX, VOLUME_MIN, PAN_MAX, PAN_MIN } from './radio-prefs.js';
import { NO_SLOT_CONFLICT, mayTransmit } from './link-groups.js';
import { buildIntercomUnitSelect } from './intercom-unit-select.js';

function slider(className, min, max, step, value, title) {
  return el('input', className, null, { type: 'range', min, max, step, value, title });
}

function frequencyCell(radio, ctx) {
  if (radio.kind === 'INTERCOM') return el('span', 'radio-freq', '--');
  if (radio.kind !== 'MANUAL') return el('span', 'radio-freq', radioFrequencyText(radio));
  if (ctx.editing) {
    const input = el('input', 'radio-freq-input', null, { type: 'text', inputmode: 'decimal', value: radioFrequencyText(radio), 'aria-label': 'Frequency MHz' });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); ctx.onRetune(input.value); }
      if (e.key === 'Escape') { e.preventDefault(); ctx.onEdit(false); }
    });
    queueMicrotask(() => { input.focus(); input.select(); });
    return input;
  }
  const b = el('button', 'radio-freq radio-freq-edit', radioFrequencyText(radio), { type: 'button', title: 'Retune' });
  b.addEventListener('click', () => ctx.onEdit(true));
  return b;
}

function linkMenu(options, onMove, disabled) {
  const sel = el('select', 'radio-link', null, { title: 'Link group', disabled });
  for (const o of options) {
    const opt = el('option', null, o.label, { value: o.groupId == null ? '' : o.groupId });
    if (o.current) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onMove(sel.value === '' ? null : sel.value));
  return sel;
}

/**
 * @param {object} radio      a radio of the set
 * @param {object} ctx
 *   audio `{ volume, pan, muted }`, isTarget, linkOptions (radio-panel-model.js linkMenuOptions), editing, editError,
 *   onTarget(), onMove(groupId|null), onAudio(patch, commit), onEdit(on), onRetune(text), onModulation(), onRemove(),
 *   and for the intercom srsClients, intercomUnitId, onIntercomUnit(unitId|null)
 */
export function buildRadioRow(radio, ctx) {
  const row = el('div', 'radio-row', null, { dataset: { radioId: radio.id } });
  if (radio.receiveOnly) row.classList.add('radio-row-rxonly');

  const target = el('button', 'radio-target' + (ctx.isTarget ? ' radio-target-on' : ''), ctx.isTarget ? '●' : '○', {
    type: 'button', title: ctx.isTarget ? 'PTT transmits on this radio\'s group' : 'Transmit on this radio\'s group', disabled: !mayTransmit(radio),
  });
  target.addEventListener('click', () => ctx.onTarget());
  row.appendChild(target);

  row.appendChild(el('span', 'radio-label', radio.label, { title: radio.label }));
  row.appendChild(frequencyCell(radio, ctx));
  const band = el('span', 'radio-band', radioBandText(radio));
  row.appendChild(band);
  if (radio.kind === 'MANUAL') {
    const mod = el('button', 'radio-mod', radio.modulation, { type: 'button', title: 'AM or FM' });
    mod.addEventListener('click', () => ctx.onModulation());
    row.appendChild(mod);
  } else {
    row.appendChild(el('span', 'radio-mod radio-mod-fixed', radio.kind === 'INTERCOM' ? 'IC' : radio.modulation));
  }
  row.appendChild(el('span', 'radio-rx', 'RX'));
  row.appendChild(el('span', 'radio-tx', 'TX'));

  const vol = slider('radio-vol', VOLUME_MIN, VOLUME_MAX, 0.1, ctx.audio.volume, 'Volume');
  const volLbl = el('span', 'radio-vol-lbl', `${ctx.audio.volume.toFixed(1)}x`);
  vol.addEventListener('input', () => { volLbl.textContent = `${Number(vol.value).toFixed(1)}x`; ctx.onAudio({ volume: Number(vol.value) }, false); });
  vol.addEventListener('change', () => ctx.onAudio({ volume: Number(vol.value) }, true));
  const pan = slider('radio-pan', PAN_MIN, PAN_MAX, 0.1, ctx.audio.pan, 'Pan (left, centre, right)');
  pan.addEventListener('input', () => ctx.onAudio({ pan: Number(pan.value) }, false));
  pan.addEventListener('change', () => ctx.onAudio({ pan: Number(pan.value) }, true));
  pan.addEventListener('dblclick', () => { pan.value = '0'; ctx.onAudio({ pan: 0 }, true); });
  const mute = el('button', 'radio-mute' + (ctx.audio.muted ? ' radio-mute-on' : ''), ctx.audio.muted ? 'MUTED' : 'MUTE', { type: 'button' });
  mute.addEventListener('click', () => ctx.onAudio({ muted: !ctx.audio.muted }, true));
  row.append(vol, volLbl, pan, mute);

  // The intercom is never linked (H183): its unit picker stands where the link menu is.
  if (radio.kind === 'INTERCOM') row.appendChild(buildIntercomUnitSelect(ctx.srsClients || [], ctx.intercomUnitId ?? null, ctx.onIntercomUnit));
  else row.appendChild(linkMenu(ctx.linkOptions, ctx.onMove, radio.receiveOnly));

  if (radio.kind === 'MANUAL' || radio.kind === 'INTERCOM') {
    const rm = el('button', 'radio-remove', '✕', { type: 'button', title: 'Remove this radio' });
    rm.addEventListener('click', () => ctx.onRemove());
    row.appendChild(rm);
  }

  const notes = [];
  if (radio.receiveOnly) notes.push(el('span', 'radio-note', 'RX ONLY (Observer)'));
  // RQ13: a radio left without an SRS slot is noted in grey; a frequency refused by a second group is amber.
  if (radio.conflict) notes.push(el('span', radio.conflict === NO_SLOT_CONFLICT ? 'radio-note' : 'radio-note radio-conflict', radio.conflict));
  if (ctx.editError) notes.push(el('span', 'radio-note radio-conflict', ctx.editError));
  if (notes.length) {
    const n = el('div', 'radio-row-notes');
    n.append(...notes);
    row.appendChild(n);
  }
  return row;
}

/** Lights RX and TX on an existing row without rebuilding it. */
export function paintRadioActivity(row, { rx, tx }) {
  row.classList.toggle('radio-row-rx', !!rx);
  row.classList.toggle('radio-row-tx', !!tx);
}
