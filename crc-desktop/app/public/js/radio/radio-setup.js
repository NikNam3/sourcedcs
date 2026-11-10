'use strict';

// The radio panel's SETUP section, ported from the old panel's SRS settings tab (S-RADIO-2 RQ18, everything but
// intercom): microphone and speaker (with TEST), input and output gain, the PTT key and its maximum transmit time, the
// TX sound set and the background noise. Built once per mount and kept (the rows above it are rebuilt, this is not),
// so a select being used is never redrawn under the pointer. The device list is refreshed on `devicechange`.

import { el } from './radio-dom.js';
import { devicesByKind, deviceSelection, resolveDevice } from './device-choice.js';
import {
  GAIN_MAX, GAIN_MIN, SOUND_SETS, getRadioPrefs, updateRadioPrefs, withAudioOptions, withDevices, withMaxTx, withPttKey,
} from './radio-prefs.js';
import { PTT_MAX_TX_DEFAULT_S, PTT_MAX_TX_MAX_S, PTT_MAX_TX_MIN_S, clampMaxTxSeconds } from '../ptt-controller.js';

function keyLabel(code) { return code === 'Space' ? 'Space' : String(code).replace(/^Key/, '').replace(/^Digit/, ''); }

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

  // The PTT key: click, then press the key (capture phase, before any PTT handler sees it).
  const pttKey = el('button', 'radio-small-btn radio-ptt-key', keyLabel(prefs.pttKey), { type: 'button', title: 'Click, then press the PTT key' });
  let listening = false;
  const onKey = (e) => {
    if (!listening) return;
    e.preventDefault(); e.stopPropagation();
    listening = false;
    pttKey.classList.remove('radio-listening');
    if (e.code !== 'Escape') updateRadioPrefs(p => withPttKey(p, e.code));
    pttKey.textContent = keyLabel(getRadioPrefs().pttKey);
  };
  pttKey.addEventListener('click', () => { listening = true; pttKey.textContent = 'press a key'; pttKey.classList.add('radio-listening'); });
  document.addEventListener('keydown', onKey, true);

  const maxTx = el('input', 'radio-number', null, {
    type: 'number', min: PTT_MAX_TX_MIN_S, max: PTT_MAX_TX_MAX_S, step: 1, value: clampMaxTxSeconds(prefs.maxTxS ?? PTT_MAX_TX_DEFAULT_S),
    title: 'Longest continuous transmission, seconds',
  });
  maxTx.addEventListener('change', () => {
    const v = clampMaxTxSeconds(Number(maxTx.value));
    maxTx.value = String(v);
    updateRadioPrefs(p => withMaxTx(p, v));
  });

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
    settingRow('PTT key', pttKey),
    settingRow('Max transmit (s)', maxTx),
    settingRow('TX sound', sound),
    settingRow('Background noise', noise),
  );
  refresh();

  return {
    element: root,
    dispose() {
      document.removeEventListener('keydown', onKey, true);
      if (media && media.removeEventListener) media.removeEventListener('devicechange', refresh);
    },
  };
}
