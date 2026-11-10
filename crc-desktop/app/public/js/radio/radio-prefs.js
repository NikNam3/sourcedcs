'use strict';

// The radio panel's preferences (docs/adr/0158 §2, the shape of S-RADIO-1 RQ17): per radio identity (never per
// frequency, so a retune keeps them) the volume, pan and mute; the link-group membership (an explicit null is
// "unlinked") and the controller's groups; the manual radios; the devices `{ deviceId, label }` (RQ9); the PTT key, its
// maximum transmit time and the PTT target; the audio options (gains, TX sound set, noise, RQ18); the intercom
// `{ unitId }` or null for none (H183: unitId null is the shared, non-DCS intercom). A leaf: it imports
// nothing. It persists through whatever `bindRadioPrefsStorage` gives it (the panel binds settings.js's one `radio`
// object + `saveSettings`), so node:test drives it with a plain object.
//
// The updaters are pure (`prefs -> prefs`); `updateRadioPrefs(fn)` applies one, saves, and tells the listeners.

export const VOLUME_MIN = 0;
export const VOLUME_MAX = 5;      // the old panel's per-radio range (0.0x to 5.0x), kept
export const VOLUME_DEFAULT = 1;
export const PAN_MIN = -1;
export const PAN_MAX = 1;
export const PTT_KEY_DEFAULT = 'Space';
export const GAIN_MIN = 0;
export const GAIN_MAX = 5;
export const INPUT_GAIN_DEFAULT = 0.5;  // lxsrs_v2's default (__main__.py), kept
export const OUTPUT_GAIN_DEFAULT = 1;
/** The TX click sounds (lxsrs_v2 effects.py TX_SOUNDS). */
export const SOUND_SETS = Object.freeze(['RADIO_TRANS', 'RADIO_TRANS_ALTERNATE', 'RADIO_TRANS_APACHE', 'MIDS', 'INTERCOM']);
const MODULATIONS = ['AM', 'FM'];

const clamp = (v, lo, hi, dflt) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v ? v : null);

/** The audio of a radio with no saved setting. */
export const DEFAULT_AUDIO = Object.freeze({ volume: VOLUME_DEFAULT, pan: 0, muted: false });

function normalizeAudio(a) {
  return { volume: clamp(a && a.volume, VOLUME_MIN, VOLUME_MAX, VOLUME_DEFAULT), pan: clamp(a && a.pan, PAN_MIN, PAN_MAX, 0), muted: !!(a && a.muted) };
}

function normalizeDevice(d) {
  return isObj(d) && str(d.deviceId) ? { deviceId: d.deviceId, label: typeof d.label === 'string' ? d.label : '' } : null;
}

/** A whole, valid prefs object from whatever was stored (anything: null, an old shape, a hand edit). */
export function normalizeRadioPrefs(raw) {
  const r = isObj(raw) ? raw : {};
  const audio = {};
  if (isObj(r.audio)) for (const [id, a] of Object.entries(r.audio)) audio[id] = normalizeAudio(a);
  const membership = {};
  if (isObj(r.membership)) for (const [id, g] of Object.entries(r.membership)) if (str(g) || g === null) membership[id] = g;
  const groups = Array.isArray(r.groups) ? r.groups.filter(g => isObj(g) && str(g.id) && str(g.name)).map(g => ({ id: g.id, name: g.name })) : [];
  const manual = Array.isArray(r.manual)
    ? r.manual.filter(m => isObj(m) && str(m.id) && Number.isFinite(m.mhz)).map(m => ({
      id: m.id, mhz: m.mhz, modulation: MODULATIONS.includes(m.modulation) ? m.modulation : 'AM', label: typeof m.label === 'string' ? m.label : '',
    }))
    : [];
  const d = isObj(r.devices) ? r.devices : {};
  return {
    audio, groups, membership, manual,
    devices: { input: normalizeDevice(d.input), output: normalizeDevice(d.output) },
    intercom: isObj(r.intercom) ? { unitId: Number.isInteger(r.intercom.unitId) && r.intercom.unitId > 0 ? r.intercom.unitId : null } : null,
    pttKey: str(r.pttKey) || PTT_KEY_DEFAULT,
    maxTxS: Number.isFinite(r.maxTxS) ? r.maxTxS : null, // null: ptt-controller.js's default; clamped where used
    pttTarget: str(r.pttTarget),
    soundSet: SOUND_SETS.includes(r.soundSet) ? r.soundSet : SOUND_SETS[0],
    noise: r.noise !== false,
    inputGain: clamp(r.inputGain, GAIN_MIN, GAIN_MAX, INPUT_GAIN_DEFAULT),
    outputGain: clamp(r.outputGain, GAIN_MIN, GAIN_MAX, OUTPUT_GAIN_DEFAULT),
  };
}

// ── pure updaters ────────────────────────────────────────────────────────────

/** A radio's volume, pan and mute (the default when none is saved). */
export function radioAudioOf(prefs, radioId) {
  return prefs.audio[radioId] ? { ...prefs.audio[radioId] } : { ...DEFAULT_AUDIO };
}

/** Sets some of a radio's `{ volume, pan, muted }`. */
export function withRadioAudio(prefs, radioId, patch) {
  return { ...prefs, audio: { ...prefs.audio, [radioId]: normalizeAudio({ ...radioAudioOf(prefs, radioId), ...patch }) } };
}

export function withMembership(prefs, membership) { return { ...prefs, membership: { ...membership } }; }
export function withGroups(prefs, groups) { return { ...prefs, groups: groups.map(g => ({ id: g.id, name: g.name })) }; }
/** `patch`: `{ input }` and/or `{ output }`, each `{ deviceId, label }` or null for the system default. */
export function withDevices(prefs, patch) { return { ...prefs, devices: { ...prefs.devices, ...patch } }; }
export function withPttKey(prefs, code) { return { ...prefs, pttKey: str(code) || PTT_KEY_DEFAULT }; }
export function withMaxTx(prefs, seconds) { return { ...prefs, maxTxS: Number.isFinite(seconds) ? seconds : null }; }
export function withPttTarget(prefs, radioId) { return { ...prefs, pttTarget: str(radioId) }; }
/** Some of `{ inputGain, outputGain, soundSet, noise }`. */
export function withAudioOptions(prefs, patch) { return { ...prefs, ...patch }; }

/** The engine's `setAudioOptions` argument. */
export function audioOptionsOf(prefs) {
  return { inputGain: prefs.inputGain, outputGain: prefs.outputGain, soundSet: prefs.soundSet, noise: prefs.noise };
}

/**
 * First load only (RQ17): the PTT key and maximum transmit time the controller set in the old panel
 * (`srs_pref_ptt_key`, `srs_pref_ptt_max_tx_s`, passed in already parsed) carry over.
 */
export function seedFromOldPanel(prefs, { pttKey, maxTxS } = {}) {
  return { ...prefs, ...(str(pttKey) ? { pttKey } : {}), ...(Number.isFinite(maxTxS) ? { maxTxS } : {}) };
}

function nextManualId(manual) {
  const used = new Set(manual.map(m => m.id));
  for (let i = 1; ; i++) if (!used.has(`m${i}`)) return `m${i}`;
}

/** Adds a manual radio. `{ prefs, id }`; `id` is the manual id (the radio is `MANUAL:<id>`). */
export function addManualRadio(prefs, { label = '', mhz, modulation = 'AM' }) {
  const id = nextManualId(prefs.manual);
  return { prefs: { ...prefs, manual: [...prefs.manual, { id, mhz, modulation, label: String(label).trim().toUpperCase() }] }, id };
}

/** Retunes (and optionally relabels or switches AM/FM) manual radio `id`; its identity, audio and group stay. */
export function retuneManualRadio(prefs, id, { mhz, label, modulation } = {}) {
  return {
    ...prefs,
    manual: prefs.manual.map(m => (m.id !== id ? m : {
      ...m, ...(Number.isFinite(mhz) ? { mhz } : {}), ...(label != null ? { label: String(label).trim().toUpperCase() } : {}),
      ...(MODULATIONS.includes(modulation) ? { modulation } : {}),
    })),
  };
}

/** Removes manual radio `id`, and everything kept for it (audio, membership, the PTT target). */
export function removeManualRadio(prefs, id) {
  const radioId = `MANUAL:${id}`;
  const audio = { ...prefs.audio };
  delete audio[radioId];
  const membership = { ...prefs.membership };
  delete membership[radioId];
  return {
    ...prefs, audio, membership,
    manual: prefs.manual.filter(m => m.id !== id),
    pttTarget: prefs.pttTarget === radioId ? null : prefs.pttTarget,
  };
}

/** Adds the intercom (one at most), on the shared unit. */
export function addIntercom(prefs) { return prefs.intercom ? prefs : { ...prefs, intercom: { unitId: null } }; }

/** Joins the intercom of SRS unit `unitId` (a positive integer), or the shared one with null. */
export function withIntercomUnit(prefs, unitId) {
  if (!prefs.intercom) return prefs;
  return { ...prefs, intercom: { unitId: Number.isInteger(unitId) && unitId > 0 ? unitId : null } };
}

/** Removes the intercom, and what is kept for it (audio, the PTT target). */
export function removeIntercom(prefs) {
  const audio = { ...prefs.audio };
  delete audio.INTERCOM;
  return { ...prefs, intercom: null, audio, pttTarget: prefs.pttTarget === 'INTERCOM' ? null : prefs.pttTarget };
}

// ── the store ────────────────────────────────────────────────────────────────

let _storage = { load: () => null, save: () => {} };
let _prefs = normalizeRadioPrefs(null);
const _listeners = new Set();

/** Where the prefs live: `{ load(): raw, save(prefs) }`. Loads at once; a first load (nothing stored) is not saved. */
export function bindRadioPrefsStorage(storage) {
  _storage = storage;
  _prefs = normalizeRadioPrefs(storage.load());
}

export function getRadioPrefs() { return _prefs; }

/** Applies `fn(prefs) -> prefs`, saves it and tells every listener. Returns the new prefs. */
export function updateRadioPrefs(fn) {
  _prefs = normalizeRadioPrefs(fn(_prefs));
  _storage.save(_prefs);
  for (const l of [..._listeners]) l(_prefs);
  return _prefs;
}

/** `fn(prefs)` after every update. Returns the unsubscribe. */
export function onRadioPrefsChanged(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }

/** Tests only. */
export function _resetRadioPrefsForTest() { _storage = { load: () => null, save: () => {} }; _prefs = normalizeRadioPrefs(null); _listeners.clear(); }
