// Global PTT's SETUP section (docs/adr/0161 §3, S-RO-1 RO11-13), on the DOM stub and a fake preload bridge.
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGlobalPttSetup } from '../app/public/js/radio/global-ptt-setup.js';
import { setRadioPanelIsClient } from '../app/public/js/radio/radio-ptt.js';
import { _resetRadioPrefsForTest, getRadioPrefs, updateRadioPrefs, withGlobalPtt } from '../app/public/js/radio/radio-prefs.js';

const flush = () => new Promise(res => setImmediate(res));
const row = (label, ...controls) => ({ label, controls });
const F13 = { type: 'key', keycode: 91, label: 'F13' };

async function rig(status, capture = async () => null) {
  _resetRadioPrefsForTest();
  setRadioPanelIsClient(true);
  const bridge = { status: async () => status, capture, cancelCapture() { bridge.cancelled = true; } };
  const s = buildGlobalPttSetup(row, bridge);
  const seen = [];
  s.element.replaceChildren = (...kids) => { seen.splice(0, seen.length, ...kids); };
  await flush();
  const rows = seen.filter(k => k.label);
  const note = seen.find(k => !k.label);
  return { s, seen, note, enable: rows[0]?.controls[0], name: rows[1]?.controls[0], bind: rows[1]?.controls[1], bridge };
}
const UIOHOOK = { available: true, kind: 'uiohook' };
const PORTAL = { available: true, kind: 'portal' };
const click = (b) => b._listeners.click[0]();

test('no listener: one grey line with the reason, and no controls', async (t) => {
  const r = await rig({ available: false, reason: 'no-portal' });
  t.after(() => r.s.dispose());
  assert.equal(r.seen.length, 1);
  assert.match(r.seen[0].textContent, /no global shortcuts portal/);
});

test('not the radio client: the section is hidden', () => {
  _resetRadioPrefsForTest();
  setRadioPanelIsClient(false);
  assert.equal(buildGlobalPttSetup(row, {}).element.hidden, true);
});

test('off by default: the capture button is disabled and nothing is asked', async (t) => {
  const r = await rig(UIOHOOK);
  t.after(() => r.s.dispose());
  assert.equal(r.enable.checked, false);
  assert.equal(r.bind.disabled, true);
  assert.equal(r.note.hidden, true);
});

test('on with no key: one grey line asks for one', async (t) => {
  const r = await rig(UIOHOOK);
  t.after(() => r.s.dispose());
  updateRadioPrefs(p => withGlobalPtt(p, { enabled: true }));
  assert.equal(r.bind.disabled, false);
  assert.match(r.note.textContent, /Choose a key/);
});

test('the bound input shows by name', async (t) => {
  const r = await rig(UIOHOOK);
  t.after(() => r.s.dispose());
  updateRadioPrefs(p => withGlobalPtt(p, { enabled: true, uiohook: F13 }));
  assert.equal(r.name.textContent, 'F13');
  assert.equal(r.bind.textContent, 'PRESS A KEY');
  assert.equal(r.note.hidden, true);
});

test('a capture stores what it got under this listener', async (t) => {
  const r = await rig(UIOHOOK, async () => F13);
  t.after(() => r.s.dispose());
  updateRadioPrefs(p => withGlobalPtt(p, { enabled: true }));
  click(r.bind);
  await flush();
  assert.deepEqual(getRadioPrefs().globalPtt.uiohook, F13);
  assert.equal(getRadioPrefs().globalPtt.portal, null);
});

test('a refused input stores nothing and says what is allowed', async (t) => {
  const r = await rig(UIOHOOK, async () => ({ refused: true }));
  t.after(() => r.s.dispose());
  updateRadioPrefs(p => withGlobalPtt(p, { enabled: true }));
  click(r.bind);
  await flush();
  assert.equal(getRadioPrefs().globalPtt.uiohook, null);
  assert.match(r.note.textContent, /F1 to F24/);
});

test('portal: CONFIGURE, and a line that the desktop owns the key', async (t) => {
  const r = await rig(PORTAL);
  t.after(() => r.s.dispose());
  updateRadioPrefs(p => withGlobalPtt(p, { enabled: true }));
  assert.equal(r.bind.textContent, 'CONFIGURE');
  assert.match(r.note.textContent, /desktop owns this key/);
});

test('a listener that failed to start says so', async (t) => {
  const r = await rig({ ...UIOHOOK, failed: true });
  t.after(() => r.s.dispose());
  updateRadioPrefs(p => withGlobalPtt(p, { enabled: true, uiohook: F13 }));
  await flush();
  assert.match(r.note.textContent, /could not start/);
});
