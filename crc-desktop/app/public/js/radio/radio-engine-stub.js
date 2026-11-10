'use strict';

// A stand-in for RADIO-CORE's radio-engine.js (docs/parallel/radio/README.md, the contract), with the same exports, so
// the new radio panel can be built and driven before the two lanes are joined. It makes no sound and opens no socket:
// it keeps what it is told and reports a state as the real engine would. The supervisor deletes this file at
// integration and points radio-panel.js at radio-engine.js. A leaf.

let _radios = [];
let _txIds = [];
let _rxIds = [];
const _audio = new Map();
let _devices = { inputId: null, outputId: null };
let _options = null;
let _micTests = 0;
let _intercomUnit = null;
let _srsClients = [];
const _listeners = new Set();

function state() {
  return { connected: false, error: 'radio engine not joined yet (stub)', rxRadioIds: [..._rxIds], txRadioIds: [..._txIds], opusSupported: true, srsClients: _srsClients.map(c => ({ ...c })) };
}
function emit() { const s = state(); for (const fn of [..._listeners]) fn(s); }

/** The radio set's `radios`, whole, every time it changes. */
export function setRadios(radios) {
  _radios = Array.isArray(radios) ? radios.map(r => ({ ...r })) : [];
  const live = new Set(_radios.map(r => r.id));
  _txIds = _txIds.filter(id => live.has(id));
  _rxIds = _rxIds.filter(id => live.has(id));
  emit();
}

/** Transmit on radioId's whole group (or radioId alone if unlinked); `down` false releases. */
export function setPtt(down, radioId) {
  let next = [];
  if (down) {
    const r = _radios.find(x => x.id === radioId);
    if (r && !r.receiveOnly) next = r.groupId ? _radios.filter(x => x.groupId === r.groupId && !x.receiveOnly).map(x => x.id) : [r.id];
  }
  if (next.join('|') === _txIds.join('|')) return; // the PTT controller repeats a held key; only a change is news
  _txIds = next;
  emit();
}

export function setRadioAudio(radioId, { volume, pan, muted }) { _audio.set(radioId, { volume, pan, muted }); }

export function setDevices({ inputId, outputId }) { _devices = { inputId: inputId || null, outputId: outputId || null }; }

/** S-RADIO-2 RQ18: `{ inputGain, outputGain, soundSet, noise }`. A no-op here. */
export function setAudioOptions(options) { _options = { ...options }; }

/** S-RADIO-2 RQ18: record a moment and play it back. A no-op here. */
export function testMic() { _micTests++; }

/** H183: the intercom joins SRS unit `unitId`, or the shared (non-DCS) intercom with null. A no-op here. */
export function setIntercomUnit(unitId) { _intercomUnit = unitId == null ? null : unitId; }

/** `fn(state)` now and on every change. Returns the unsubscribe. */
export function onState(fn) { _listeners.add(fn); fn(state()); return () => _listeners.delete(fn); }

/** Tests and hand checks only: what the stub was told, and a received transmission on some radios. */
export function _stubInspect() { return { radios: _radios, txRadioIds: [..._txIds], audio: Object.fromEntries(_audio), devices: { ..._devices }, options: _options, micTests: _micTests, intercomUnit: _intercomUnit }; }
/** Tests only: the SRS clients the state lists (`[{ name, unitId }]`), for the intercom unit picker. */
export function _stubSrsClients(list) { _srsClients = list.map(c => ({ ...c })); emit(); }
export function _stubReceive(radioIds) { _rxIds = [...radioIds]; emit(); }
