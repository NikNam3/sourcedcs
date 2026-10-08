/* SETTINGS-TABS: the Settings panel's tab registry (settings-registry.js). Registration, validation, defaults and the
   persistence round-trip through the one localStorage settings object. */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, settings } from '../app/public/js/settings.js';
import { getSetting, onSettingsTabsChanged, registerSettingsTab, setSetting, settingsTabs } from '../app/public/js/settings-registry.js';

const FIELDS = [
  { key: 'tAuto', type: 'toggle', label: 'Autoscale', default: true },
  { key: 'tGpa', type: 'number', label: 'Glideslope', unit: '°', default: 3.06, min: 2, max: 4, step: 0.01 },
  { key: 'tMode', type: 'select', label: 'Mode', default: 'a', options: [['a', 'A'], ['b', 'B']] },
];

test('a registered tab is listed with its label and fields, and notifies the panel', () => {
  let n = 0;
  onSettingsTabsChanged(() => n++);
  registerSettingsTab('t1', FIELDS, { label: 'Test' });
  assert.equal(n, 1);
  const t = settingsTabs().find(x => x.id === 't1');
  assert.equal(t.label, 'TEST');
  assert.deepEqual(t.fields.map(f => f.key), ['tAuto', 'tGpa', 'tMode']);
});

test('defaults apply until a value is set; values are validated and clamped', () => {
  assert.equal(getSetting('tAuto'), true);
  assert.equal(getSetting('tGpa'), 3.06);
  assert.equal(setSetting('tGpa', '9'), 4);
  assert.equal(setSetting('tGpa', 'abc'), 4);        // a bad number keeps the old value
  assert.equal(setSetting('tMode', 'zzz'), 'a');     // an unknown option is refused
  assert.equal(setSetting('tMode', 'b'), 'b');
  assert.equal(setSetting('tAuto', false), false);
});

test('persistence round-trip: the values survive a reload of the settings object', () => {
  setSetting('tGpa', 3.5); setSetting('tMode', 'b'); setSetting('tAuto', false);
  for (const k of ['tGpa', 'tMode', 'tAuto']) delete settings[k];
  assert.equal(getSetting('tGpa'), 3.06);            // wiped from memory: default again
  loadSettings();                                    // reads localStorage 'crc-desktop-settings'
  assert.equal(getSetting('tGpa'), 3.5);
  assert.equal(getSetting('tMode'), 'b');
  assert.equal(getSetting('tAuto'), false);
});

test('onChange fires with the stored value', () => {
  let seen;
  registerSettingsTab('t2', [{ key: 'tOn', type: 'number', default: 1, onChange: v => { seen = v; } }]);
  setSetting('tOn', 7);
  assert.equal(seen, 7);
});

test('registration is validated; re-registering a tab replaces it, a clashing key throws', () => {
  assert.throws(() => registerSettingsTab('Bad Id', []), /id/);
  assert.throws(() => registerSettingsTab('t3', [{ key: 'x', type: 'colour', default: 1 }]), /type/);
  assert.throws(() => registerSettingsTab('t3', [{ key: 'x', type: 'toggle' }]), /default/);
  assert.throws(() => registerSettingsTab('t3', [{ key: 'tAuto', type: 'toggle', default: true }]), /already registered/);
  registerSettingsTab('t1', [{ key: 'tAuto', type: 'toggle', default: true }]);   // same tab: replaces
  assert.equal(settingsTabs().filter(x => x.id === 't1').length, 1);
  assert.throws(() => setSetting('nope', 1), /no registered/);
});
