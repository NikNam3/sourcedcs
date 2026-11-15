// The renderer's half of Global PTT (docs/adr/0161 §3): radio-ptt.js's wiring, on a fake preload bridge.
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setRadioPanelIsClient, wireGlobalPtt } from '../app/public/js/radio/radio-ptt.js';
import { _resetRadioPrefsForTest, updateRadioPrefs, withGlobalIntercomBinding, withGlobalPtt } from '../app/public/js/radio/radio-prefs.js';

const F13 = { type: 'key', keycode: 91, label: 'F13' };

async function rig({ client = true } = {}) {
  _resetRadioPrefsForTest();
  setRadioPanelIsClient(client);
  const configured = [], calls = [];
  let edge = null;
  const bridge = { status: async () => ({ available: true, kind: 'uiohook' }), onEdge: (cb) => { edge = cb; return () => { edge = null; }; }, configure: (cfg) => { configured.push(cfg); return Promise.resolve({ binding: cfg.binding }); } };
  const controller = (name) => ({ down: (s) => calls.push(`${name}down:${s}`), up: (s) => calls.push(`${name}up:${s}`) });
  const off = wireGlobalPtt({ ptt: controller(''), intercom: controller('ic:') }, bridge);
  await new Promise(res => setImmediate(res));
  return { configured, calls, edge: (d, channel) => edge(d, channel), off, hasEdge: () => !!edge };
}

test('no bridge (a plain browser): nothing happens', () => {
  assert.doesNotThrow(() => wireGlobalPtt({}, null)());
});

test('off by default in the full app: the main process is told to listen for nothing', async (t) => {
  const r = await rig();
  t.after(r.off);
  assert.deepEqual(r.configured, [{ enabled: false, binding: null, intercom: null }]);
});

test('enabling and binding reach the main process, once each', async (t) => {
  const r = await rig();
  t.after(r.off);
  updateRadioPrefs(p => withGlobalPtt(p, { enabled: true }));
  updateRadioPrefs(p => withGlobalPtt(p, { uiohook: F13 }));
  updateRadioPrefs(p => ({ ...p, noise: false })); // an unrelated pref sends nothing
  assert.deepEqual(r.configured.slice(1), [{ enabled: true, binding: null, intercom: null }, { enabled: true, binding: F13, intercom: null }]);
});

test('not the radio client: never enabled, and a press does not key', async (t) => {
  const r = await rig({ client: false });
  t.after(r.off);
  updateRadioPrefs(p => withGlobalPtt(p, { enabled: true, uiohook: F13 }));
  assert.ok(r.configured.every(c => c.enabled === false));
  r.edge(true);
  assert.deepEqual(r.calls, []);
});

test('edges drive the controller; a release passes even when no longer the client', async (t) => {
  const r = await rig();
  t.after(r.off);
  r.edge(true);
  setRadioPanelIsClient(false);
  r.edge(false);
  assert.deepEqual(r.calls, ['down:global', 'up:global']);
});

test('the intercom: its binding reaches the main process, and its edges drive the intercom controller only', async (t) => {
  const r = await rig();
  t.after(r.off);
  const F14 = { type: 'key', keycode: 92, label: 'F14' };
  updateRadioPrefs(p => withGlobalIntercomBinding(withGlobalPtt(p, { enabled: true, uiohook: F13 }), 'uiohook', F14));
  assert.deepEqual(r.configured.at(-1), { enabled: true, binding: F13, intercom: F14 });
  r.edge(true, 'intercom');
  r.edge(false, 'intercom');
  r.edge(true, 'ptt');
  assert.deepEqual(r.calls, ['ic:down:global', 'ic:up:global', 'down:global']);
});

test('the unsubscribe drops the edge listener', async () => {
  const r = await rig();
  r.off();
  assert.equal(r.hasEdge(), false);
});

test('the binding sent is the one for this session\'s listener', async (t) => {
  const r = await rig();
  t.after(r.off);
  updateRadioPrefs(p => withGlobalPtt(p, { enabled: true, portal: { shortcutId: 'crc_ptt', label: 'Meta+F' } }));
  assert.deepEqual(r.configured.at(-1), { enabled: true, binding: null, intercom: null });
});

test('no listener here: nothing is configured', async () => {
  _resetRadioPrefsForTest();
  setRadioPanelIsClient(true);
  const configured = [];
  const off = wireGlobalPtt({}, { status: async () => ({ available: false }), onEdge: () => () => {}, configure: (c) => configured.push(c) });
  await new Promise(res => setImmediate(res));
  updateRadioPrefs(p => withGlobalPtt(p, { enabled: true }));
  assert.deepEqual(configured, []);
  off();
});
