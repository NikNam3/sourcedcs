'use strict';

// What the radio panel draws, from the radio set (radio-set.js), as plain data: the sections in order, the link menu,
// the lit RX/TX state and the grey note for rows outside both bands. Pure and DOM-free, so node:test reads it; the
// DOM files (radio-panel.js, radio-row.js, link-group-editor.js) only turn it into elements.

import { frequencyText } from '../panels/efsp/frequency-state.js';

/**
 * The panel's sections, in order: the automatic group, then the controller's groups, then the unlinked radios
 * (a radio whose group was refused for its frequency is drawn there, with its conflict).
 * `[{ key, group: { id, name, auto } | null, radios: [radio] }]`; the unlinked section is left out when empty.
 */
export function panelSections(set) {
  const byId = new Map(set.radios.map(r => [r.id, r]));
  const out = set.groups.map(g => ({
    key: g.id, group: { id: g.id, name: g.name, auto: !!g.auto }, radios: g.radioIds.map(id => byId.get(id)).filter(Boolean),
  }));
  const unlinked = set.radios.filter(r => !r.groupId);
  if (unlinked.length) out.push({ key: 'UNLINKED', group: null, radios: unlinked });
  return out;
}

/** The link menu of a radio: every group, with the one it is in (or asked to be in) marked, then "unlink". */
export function linkMenuOptions(set, radio, intendedGroupId = radio.groupId) {
  const opts = set.groups.map(g => ({ groupId: g.id, label: g.name, current: g.id === intendedGroupId }));
  opts.push({ groupId: null, label: 'UNLINK', current: !intendedGroupId });
  return opts;
}

/** `{ rx, tx }` for a radio, from the engine state. */
export function radioActivity(engineState, radioId) {
  const s = engineState || {};
  return { rx: (s.rxRadioIds || []).includes(radioId), tx: (s.txRadioIds || []).includes(radioId) };
}

/** `275.800`; `--` for no frequency. */
export function radioFrequencyText(radio) { return frequencyText(radio.mhz); }

/** The band cell: `UHF`, `VHF`, or `--` for a manual radio outside both. */
export function radioBandText(radio) { return radio.band || '--'; }

/** The one grey line for staffed Positions' rows outside both bands: `no radio: P3 FM 40.500 (outside VHF and UHF)`. */
export function outOfBandNote(rows = []) {
  if (!rows.length) return '';
  const what = rows.map(r => `${r.positionId} ${r.label} ${frequencyText(r.mhz)}`).join(', ');
  return `no radio: ${what} (outside VHF and UHF)`;
}

/** One grey line per staffed Position with no frequency row (S-RADIO-2 RQ15): `AP: no frequency (FREQUENCIES panel)`. */
export function noRowNotes(positions = []) {
  return positions.map(p => `${p.positionId}: no frequency (FREQUENCIES panel)`);
}

/** The engine line: empty while all is well (dark cockpit), else what is wrong. `{ text, problem }`. */
export function engineLine(engineState) {
  const s = engineState || {};
  if (s.opusSupported === false) return { text: 'this machine cannot encode Opus: the radio transmits nothing', problem: true };
  if (s.error) return { text: String(s.error), problem: true };
  if (!s.connected) return { text: 'radio not connected', problem: true };
  return { text: '', problem: false };
}

/**
 * The signature of what the rows show apart from the lit state and the sliders: when it is unchanged, the panel only
 * repaints RX/TX in place, so a slider being dragged is not rebuilt under the pointer.
 */
export function structureKey(set, { pttTarget, editing } = {}) {
  return JSON.stringify([
    set.radios.map(r => [r.id, r.mhz, r.modulation, r.band, r.label, r.groupId, r.conflict, r.receiveOnly]),
    set.groups.map(g => [g.id, g.name]),
    pttTarget || null,
    editing || null,
  ]);
}
