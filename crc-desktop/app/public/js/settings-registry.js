'use strict';
// The Settings panel's tab registry. A panel that has settings registers a tab here; the Settings panel
// (panels/settings-panel.js) draws every registered tab and never needs editing for a new one. A leaf: it imports only
// settings.js (itself a leaf), so a panel module can register at load without a cycle.
//
//   registerSettingsTab('par', [
//     { key: 'parAutoscale', type: 'toggle', label: 'Autoscale', default: true },
//     { key: 'parGpa', type: 'number', label: 'Default glideslope', unit: '°', default: 3.06, min: 2, max: 4, step: 0.01 },
//     { key: 'parMode', type: 'select', label: 'Mode', default: 'a', options: [['a', 'A'], ['b', 'B']] },
//   ], { label: 'PAR' });
//   getSetting('parGpa')   // the controller's value, or the default
//
// Values live in the one `settings` object, so they persist per controller where every other setting does
// (localStorage 'crc-desktop-settings', never synced). A field key is global: prefix it with the panel's name.

import { settings, saveSettings } from './settings.js';

const TYPES = new Set(['toggle', 'number', 'select']);
const tabs = new Map();      // id -> { id, label, fields }
const listeners = new Set();

export function registerSettingsTab(id, fields, opts = {}) {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`settings tab id "${id}" must be lowercase letters, digits, hyphens`);
  if (!Array.isArray(fields)) throw new Error(`settings tab "${id}": fields must be an array`);
  const owned = new Set();
  for (const [tid, t] of tabs) if (tid !== id) for (const f of t.fields) owned.add(f.key);
  const seen = new Set();
  for (const f of fields) {
    if (!f || typeof f.key !== 'string' || !f.key) throw new Error(`settings tab "${id}": a field has no key`);
    if (!TYPES.has(f.type)) throw new Error(`settings field "${f.key}": type must be toggle, number or select`);
    if (!('default' in f)) throw new Error(`settings field "${f.key}": no default`);
    if (f.type === 'select' && !Array.isArray(f.options)) throw new Error(`settings field "${f.key}": select needs options`);
    if (owned.has(f.key) || seen.has(f.key)) throw new Error(`settings field "${f.key}" is already registered`);
    seen.add(f.key);
  }
  tabs.set(id, { id, label: String(opts.label || id).toUpperCase(), fields: fields.map(f => ({ ...f })) });
  for (const cb of listeners) cb();
}

export function settingsTabs() { return [...tabs.values()]; }

export function onSettingsTabsChanged(cb) { listeners.add(cb); return () => listeners.delete(cb); }

function fieldOf(key) {
  for (const t of tabs.values()) for (const f of t.fields) if (f.key === key) return f;
  return null;
}

export function getSetting(key) {
  const f = fieldOf(key);
  const v = settings[key];
  return v === undefined || v === null ? (f ? f.default : undefined) : v;
}

// Validates against the field, persists, returns the stored value. A bad number keeps the old value.
export function setSetting(key, value) {
  const f = fieldOf(key);
  if (!f) throw new Error(`no registered setting "${key}"`);
  let v = value;
  if (f.type === 'toggle') v = !!value;
  else if (f.type === 'number') {
    v = typeof value === 'number' ? value : parseFloat(value);
    if (!Number.isFinite(v)) return getSetting(key);
    if (typeof f.min === 'number') v = Math.max(f.min, v);
    if (typeof f.max === 'number') v = Math.min(f.max, v);
  } else if (!f.options.some(o => String(Array.isArray(o) ? o[0] : o) === String(value))) return getSetting(key);
  settings[key] = v;
  saveSettings();
  if (typeof f.onChange === 'function') f.onChange(v);
  return v;
}
