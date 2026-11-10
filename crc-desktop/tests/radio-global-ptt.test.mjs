// The renderer's half of Global PTT (docs/adr/0161 §3): radio-ptt.js's wiring, on a fake preload bridge.
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setRadioPanelIsClient, wireGlobalPtt } from '../app/public/js/radio/radio-ptt.js';
import { _resetRadioPrefsForTest, updateRadioPrefs, withGlobalPtt } from '../app/public/js/radio/radio-prefs.js';

const F13 = { type: 'key', code: 91, name: 'F13' };

function rig({ client = true } = {}) {
  _resetRadioPrefsForTest();
  setRadioPanelIsClient(client);
  const configured = [], calls = [];
  let edge = null;
  const bridge = { onEdge: (cb) => { edge = cb; return () => { edge = null; }; }, configure: (cfg) => { configured.push(cfg); return Promise.resolve({ binding: cfg.binding }); } };
  const controller = { globalDown: () => calls.push('down'), globalUp: () => calls.push('up') };
  const off = wireGlobalPtt(controller, bridge);
  return { configured, calls, edge: (d) => edge(d), off, hasEdge: () => !!edge };
}

test('no bridge (a plain browser): nothing happens', () => {
  assert.doesNotThrow(() => wireGlobalPtt({}, null)());
});

test('off by default in the full app: the main process is told to listen for nothing', (t) => {
  const r = rig();
  t.after(r.off);
  assert.deepEqual(r.configured, [{ enabled: false, binding: null }]);
});

test('enabling and binding reach the main process, once each', (t) => {
  const r = rig();
  t.after(r.off);
  updateRadioPrefs(p => withGlobalPtt(p, { enabled: true }));
  updateRadioPrefs(p => withGlobalPtt(p, { binding: F13 }));
  updateRadioPrefs(p => ({ ...p, noise: false })); // an unrelated pref sends nothing
  assert.deepEqual(r.configured.slice(1), [{ enabled: true, binding: null }, { enabled: true, binding: F13 }]);
});

test('not the radio client: never enabled, and a press does not key', (t) => {
  const r = rig({ client: false });
  t.after(r.off);
  updateRadioPrefs(p => withGlobalPtt(p, { enabled: true, binding: F13 }));
  assert.ok(r.configured.every(c => c.enabled === false));
  r.edge(true);
  assert.deepEqual(r.calls, []);
});

test('edges drive the controller; a release passes even when no longer the client', (t) => {
  const r = rig();
  t.after(r.off);
  r.edge(true);
  setRadioPanelIsClient(false);
  r.edge(false);
  assert.deepEqual(r.calls, ['down', 'up']);
});

test('the unsubscribe drops the edge listener', () => {
  const r = rig();
  r.off();
  assert.equal(r.hasEdge(), false);
});
