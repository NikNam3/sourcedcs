'use strict';

// The radio panel's SETUP section, ported from the old panel's SRS settings tab (S-RADIO-2 RQ18, everything but
// intercom): microphone and speaker (with TEST), input and output gain, the PTT key, the intercom PTT key (none until
// set, docs/adr/0166 §1) and the maximum transmit time, the TX sound set and the background noise. Built once per mount and kept (the rows above it are rebuilt, this is not),
// so a select being used is never redrawn under the pointer. The device list is refreshed on `devicechange`.

import { el } from './radio-dom.js';
import { devicesByKind, deviceSelection, resolveDevice } from './device-choice.js';
import {
  GAIN_MAX, GAIN_MIN, SOUND_SETS, getRadioPrefs, onRadioPrefsChanged, updateRadioPrefs, withAudioOptions, withDevices,
  withIntercomPttKey, withMaxTx, withPttKey,
} from './radio-prefs.js';
import { buildGlobalPttSetup } from './global-ptt-setup.js';
import { buildPttKeyButton } from './ptt-key-button.js';
import { PTT_MAX_TX_DEFAULT_S, PTT_MAX_TX_MAX_S, PTT_MAX_TX_MIN_S, clampMaxTxSeconds } from '../ptt-controller.js';

function settingRow(label, ...controls) {
  const row = el('div', 'radio-setup-row');
  row.appendChild(el('span', 'radio-setup-label', label));
  const c = el('span', 'radio-setup-controls');
  c.append(...controls);
  row.appendChild(c);
  return row;
}

function gainControl(value, onChange) {
  const s = el('input', 'radio-gain', null, { type: 'range', min: GAIN_MIN, max: GAIN_MAX, step: 0.1, value });
  const lbl = el('span', 'radio-vol-lbl', `${Number(value).toFixed(1)}x`);
  s.addEventListener('input', () => { lbl.textContent = `${Number(s.value).toFixed(1)}x`; });
  s.addEventListener('change', () => onChange(Number(s.value)));
  return [s, lbl];
}

/**
 * @param {object} engine  setDevices, setAudioOptions, testMic
 * @returns {{ element: HTMLElement, dispose(): void }}
 */
export function buildRadioSetup(engine) {
  const root = el('div', 'radio-setup');
  const prefs = getRadioPrefs();
  let present = { inputs: [], outputs: [] };
  const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;

  const mic = el('select', 'radio-select', null, { 'aria-label': 'Microphone' });
  const spk = el('select', 'radio-select', null, { 'aria-label': 'Speaker' });
  const notes = el('div', 'radio-setup-notes');
  const test = el('button', 'radio-small-btn', 'TEST', { type: 'button', title: 'Record a moment and play it back' });
  test.addEventListener('click', () => engine.testMic());

  function fill(sel, list, saved) {
    sel.replaceChildren(el('option', null, 'default', { value: '' }), ...list.map(d => el('option', null, d.label || d.deviceId.slice(0, 12), { value: d.deviceId })));
    sel.value = resolveDevice(saved, list).deviceId || '';
  }
  function applyDevices() {
    const p = getRadioPrefs();
    fill(mic, present.inputs, p.devices.input);
    fill(spk, present.outputs, p.devices.output);
    const sel = deviceSelection(p.devices, present);
    notes.replaceChildren(...sel.notes.map(t => el('div', 'radio-note', t)));
    engine.setDevices(sel.engine);
  }
  async function refresh() {
    if (!media || !media.enumerateDevices) { applyDevices(); return; }
    try { present = devicesByKind(await media.enumerateDevices()); } catch { present = { inputs: [], outputs: [] }; }
    applyDevices();
  }
  const pick = (sel, list, key) => () => {
    const d = list().find(x => x.deviceId === sel.value);
    updateRadioPrefs(p => withDevices(p, { [key]: d ? { deviceId: d.deviceId, label: d.label } : null }));
    applyDevices();
  };
  mic.addEventListener('change', pick(mic, () => present.inputs, 'input'));
  spk.addEventListener('change', pick(spk, () => present.outputs, 'output'));
  if (media && media.addEventListener) media.addEventListener('devicechange', refresh);

  const [inGain, inLbl] = gainControl(prefs.inputGain, v => updateRadioPrefs(p => withAudioOptions(p, { inputGain: v })));
  const [outGain, outLbl] = gainControl(prefs.outputGain, v => updateRadioPrefs(p => withAudioOptions(p, { outputGain: v })));

  // The PTT key keys the PTT target; the intercom PTT key only the intercom. One key is never both: the main key taking
  // the intercom's clears the intercom's (radio-prefs.js), the intercom key is refused the main one.
  const pttKey = buildPttKeyButton({
    current: () => getRadioPrefs().pttKey, title: 'Click, then press the PTT key',
    choose: (code) => { updateRadioPrefs(p => withPttKey(p, code)); return true; },
  });
  const icKey = buildPttKeyButton({
    current: () => getRadioPrefs().intercomPttKey, clearable: true, title: 'Click, then press the key that keys only the intercom',
    refusedText: 'That is the PTT key. Choose another for the intercom.',
    choose: (code) => {
      if (code && code === getRadioPrefs().pttKey) return false;
      updateRadioPrefs(p => withIntercomPttKey(p, code));
      return true;
    },
  });
  const offKeys = onRadioPrefsChanged(() => { pttKey.refresh(); icKey.refresh(); });

  const maxTx = el('input', 'radio-number', null, {
    type: 'number', min: PTT_MAX_TX_MIN_S, max: PTT_MAX_TX_MAX_S, step: 1, value: clampMaxTxSeconds(prefs.maxTxS ?? PTT_MAX_TX_DEFAULT_S),
    title: 'Longest continuous transmission, seconds',
  });
  maxTx.addEventListener('change', () => {
    const v = clampMaxTxSeconds(Number(maxTx.value));
    maxTx.value = String(v);
    updateRadioPrefs(p => withMaxTx(p, v));
  });

  const globalPtt = buildGlobalPttSetup(settingRow);

  const sound = el('select', 'radio-select', null, { 'aria-label': 'TX sound set' });
  sound.append(...SOUND_SETS.map(s => el('option', null, s, { value: s })));
  sound.value = prefs.soundSet;
  sound.addEventListener('change', () => updateRadioPrefs(p => withAudioOptions(p, { soundSet: sound.value })));
  const noise = el('input', null, null, { type: 'checkbox', 'aria-label': 'Background noise' });
  noise.checked = prefs.noise;
  noise.addEventListener('change', () => updateRadioPrefs(p => withAudioOptions(p, { noise: noise.checked })));

  root.append(
    settingRow('Microphone', mic, test),
    settingRow('Input gain', inGain, inLbl),
    settingRow('Speaker', spk),
    settingRow('Output gain', outGain, outLbl),
    notes,
    settingRow('PTT key', ...pttKey.controls),
    settingRow('Intercom PTT', ...icKey.controls),
    icKey.note,
    globalPtt.element,
    settingRow('Max transmit (s)', maxTx),
    settingRow('TX sound', sound),
    settingRow('Background noise', noise),
  );
  refresh();

  return {
    element: root,
    dispose() {
      pttKey.dispose(); icKey.dispose(); offKeys();
      globalPtt.dispose();
      if (media && media.removeEventListener) media.removeEventListener('devicechange', refresh);
    },
  };
}
