'use strict';

// The radio panel's preferences (docs/adr/0158 §2): per radio identity (never per frequency, so a retune keeps them)
// the volume, pan and mute; the link-group membership and the controller's groups; the manual radios; the devices; the
// PTT key, its maximum transmit time and the PTT target. A leaf: it imports nothing. It persists through whatever
// `bindRadioPrefsStorage` gives it (the panel binds settings.js's `settings.radio` + `saveSettings`), so node:test drives
// it with a plain object.
//
// The updaters are pure (`prefs -> prefs`); `updateRadioPrefs(fn)` applies one, saves, and tells the listeners.

export const VOLUME_MIN = 0;
export const VOLUME_MAX = 5;      // the old panel's per-radio range (0.0x to 5.0x), kept
export const VOLUME_DEFAULT = 1;
export const PAN_MIN = -1;
export const PAN_MAX = 1;
export const PTT_KEY_DEFAULT = 'Space';

const clamp = (v, lo, hi, dflt) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v ? v : null);

/** The audio of a radio with no saved setting. */
export const DEFAULT_AUDIO = Object.freeze({ volume: VOLUME_DEFAULT, pan: 0, muted: false });

function normalizeAudio(a) {
  return { volume: clamp(a && a.volume, VOLUME_MIN, VOLUME_MAX, VOLUME_DEFAULT), pan: clamp(a && a.pan, PAN_MIN, PAN_MAX, 0), muted: !!(a && a.muted) };
}

/** A whole, valid prefs object from whatever was stored (anything: null, an old shape, a hand edit). */
export function normalizeRadioPrefs(raw) {
  const r = isObj(raw) ? raw : {};
  const audio = {};
  if (isObj(r.audio)) for (const [id, a] of Object.entries(r.audio)) audio[id] = normalizeAudio(a);
  const membership = {};
  if (isObj(r.membership)) for (const [id, g] of Object.entries(r.membership)) if (str(g)) membership[id] = g;
  const groups = Array.isArray(r.groups) ? r.groups.filter(g => isObj(g) && str(g.id) && str(g.name)).map(g => ({ id: g.id, name: g.name })) : [];
  const manual = Array.isArray(r.manual)
    ? r.manual.filter(m => isObj(m) && str(m.id) && Number.isFinite(m.mhz)).map(m => ({ id: m.id, label: typeof m.label === 'string' ? m.label : '', mhz: m.mhz }))
    : [];
  const d = isObj(r.devices) ? r.devices : {};
  return {
    audio, membership, groups, manual,
    devices: { inputId: str(d.inputId), outputId: str(d.outputId) },
    pttKey: str(r.pttKey) || PTT_KEY_DEFAULT,
    pttMaxTxS: Number.isFinite(r.pttMaxTxS) ? r.pttMaxTxS : null, // null: ptt-controller.js's default
    pttTargetId: str(r.pttTargetId),
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
export function withDevices(prefs, patch) { return { ...prefs, devices: { ...prefs.devices, ...patch } }; }
export function withPttKey(prefs, code) { return { ...prefs, pttKey: str(code) || PTT_KEY_DEFAULT }; }
export function withPttMaxTx(prefs, seconds) { return { ...prefs, pttMaxTxS: Number.isFinite(seconds) ? seconds : null }; }
export function withPttTarget(prefs, radioId) { return { ...prefs, pttTargetId: str(radioId) }; }

function nextManualId(manual) {
  const used = new Set(manual.map(m => m.id));
  for (let i = 1; ; i++) if (!used.has(`m${i}`)) return `m${i}`;
}

/** Adds a manual radio. `{ prefs, id }`; `id` is the manual id (the radio is `MANUAL:<id>`). */
export function addManualRadio(prefs, { label = '', mhz }) {
  const id = nextManualId(prefs.manual);
  return { prefs: { ...prefs, manual: [...prefs.manual, { id, label: String(label).trim().toUpperCase(), mhz }] }, id };
}

/** Retunes (and optionally relabels) manual radio `id`; its identity, audio and group stay. */
export function retuneManualRadio(prefs, id, { mhz, label } = {}) {
  return {
    ...prefs,
    manual: prefs.manual.map(m => (m.id !== id ? m : {
      ...m, ...(Number.isFinite(mhz) ? { mhz } : {}), ...(label != null ? { label: String(label).trim().toUpperCase() } : {}),
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
    pttTargetId: prefs.pttTargetId === radioId ? null : prefs.pttTargetId,
  };
}

// ── the store ────────────────────────────────────────────────────────────────

let _storage = { load: () => null, save: () => {} };
let _prefs = normalizeRadioPrefs(null);
const _listeners = new Set();

/** Where the prefs live: `{ load(): raw, save(prefs) }`. Loads at once. */
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
