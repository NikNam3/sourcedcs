// The intercom PTT key (docs/adr/0166 §1): radio-ptt-arbiter.js (which of the two PTTs transmits), radio-ptt.js's two
// controllers on the window keys, and ptt-key-button.js (the SETUP chooser), on the DOM stub and a fake engine.
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPttArbiter } from '../app/public/js/radio/radio-ptt-arbiter.js';
import { createRadioPtt, setRadioPanelIsClient } from '../app/public/js/radio/radio-ptt.js';
import { buildPttKeyButton } from '../app/public/js/radio/ptt-key-button.js';
import { _resetRadioPrefsForTest, getRadioPrefs, updateRadioPrefs, withIntercomPttKey } from '../app/public/js/radio/radio-prefs.js';

function arbiterRig(targets = { ptt: 'POSITION:P1:UHF', intercom: 'INTERCOM' }) {
  const calls = [];
  const a = createPttArbiter({ engine: { setPtt: (down, id) => calls.push([down, id]) }, targetOf: (c) => targets[c] });
  return { a, calls, targets };
}

test('arbiter: each key keys its own radio; the intercom key keys the intercom whatever the PTT target is', () => {
  const r = arbiterRig();
  r.a.start('intercom'); r.a.start('intercom'); r.a.stop('intercom');
  r.a.start('ptt'); r.a.stop('ptt');
  assert.deepEqual(r.calls, [[true, 'INTERCOM'], [true, 'INTERCOM'], [false, 'INTERCOM'], [true, 'POSITION:P1:UHF'], [false, 'POSITION:P1:UHF']]);
});

test('arbiter: both held, the first keeps transmitting; the other starts when the first is let go', () => {
  const r = arbiterRig();
  r.a.start('ptt');
  r.a.start('intercom'); // waits: never cuts the transmission going out
  r.a.start('intercom'); // its repeat: still waiting
  assert.deepEqual(r.calls, [[true, 'POSITION:P1:UHF']]);
  r.a.stop('ptt');
  assert.deepEqual(r.calls.slice(1), [[false, 'POSITION:P1:UHF'], [true, 'INTERCOM']]);
  assert.equal(r.a.active(), 'intercom');
  r.a.stop('intercom');
  assert.equal(r.a.active(), null);
  r.a.stop('ptt'); // a stray release keys nothing
  assert.equal(r.calls.length, 4);
});

test('arbiter: a channel let go while waiting does not start later', () => {
  const r = arbiterRig();
  r.a.start('intercom');
  r.a.start('ptt'); r.a.stop('ptt');
  r.a.stop('intercom');
  assert.deepEqual(r.calls, [[true, 'INTERCOM'], [false, 'INTERCOM']]);
});

test('arbiter: a channel with no radio keys nothing and does not hold the other back', () => {
  const r = arbiterRig({ ptt: 'POSITION:P1:UHF', intercom: null });
  r.a.start('intercom');
  r.a.start('ptt');
  assert.deepEqual(r.calls, [[true, 'POSITION:P1:UHF']]);
});

test('arbiter: the radio keyed is the one released, even when the target moves meanwhile', () => {
  const r = arbiterRig();
  r.a.start('ptt');
  r.targets.ptt = 'MANUAL:m1';
  r.a.start('ptt');
  r.a.stop('ptt');
  assert.deepEqual(r.calls, [[true, 'POSITION:P1:UHF'], [true, 'POSITION:P1:UHF'], [false, 'POSITION:P1:UHF']]);
});

function keyRig({ controllers = true } = {}) {
  _resetRadioPrefsForTest();
  setRadioPanelIsClient(true);
  const listeners = {};
  document.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  document.removeEventListener = (type, fn) => { listeners[type] = (listeners[type] || []).filter(f => f !== fn); };
  const calls = [];
  const ptt = controllers && createRadioPtt({
    engine: { setPtt: (down, id) => calls.push([down, id]) },
    getTarget: () => 'POSITION:P1:UHF', getIntercomTarget: () => 'INTERCOM', setActive: () => {},
  });
  const key = (type, code) => { for (const fn of listeners[type] || []) fn({ type, code, repeat: false, preventDefault() {}, stopPropagation() {} }); };
  return { ptt, calls, key, listeners };
}

test('window keys: no intercom key until set; then it keys only the intercom, the PTT key its target', (t) => {
  const r = keyRig();
  t.after(() => { r.ptt.up(); r.ptt.intercom.up(); r.key('keyup', 'Space'); r.key('keyup', 'KeyI'); });
  r.key('keydown', 'KeyI'); r.key('keyup', 'KeyI');
  assert.deepEqual(r.calls, []);
  updateRadioPrefs(p => withIntercomPttKey(p, 'KeyI'));
  r.key('keydown', 'KeyI');
  assert.deepEqual(r.calls, [[true, 'INTERCOM']]);
  r.key('keydown', 'Space'); // held too: waits for the intercom
  r.key('keyup', 'KeyI');
  assert.deepEqual(r.calls.slice(1), [[false, 'INTERCOM'], [true, 'POSITION:P1:UHF']]);
  r.key('keyup', 'Space');
  assert.deepEqual(r.calls.at(-1), [false, 'POSITION:P1:UHF']);
});

test('the key chooser: Escape keeps it, CLEAR clears it, the PTT key is refused with a note', (t) => {
  const r = keyRig({ controllers: false }); // in the app the chooser's capture-phase listener stops the key there
  t.after(() => b.dispose());
  const b = buildPttKeyButton({
    current: () => getRadioPrefs().intercomPttKey, clearable: true, refusedText: 'That is the PTT key.',
    choose: (code) => {
      if (code && code === getRadioPrefs().pttKey) return false;
      updateRadioPrefs(p => withIntercomPttKey(p, code));
      return true;
    },
  });
  const [button, clear] = b.controls;
  assert.equal(button.textContent, 'none');
  const press = (code) => { button._listeners.click[0](); r.key('keydown', code); };
  press('KeyI');
  assert.equal(getRadioPrefs().intercomPttKey, 'KeyI');
  assert.equal(button.textContent, 'I');
  press('Escape');
  assert.equal(getRadioPrefs().intercomPttKey, 'KeyI');
  press('Space');
  assert.equal(getRadioPrefs().intercomPttKey, 'KeyI');
  assert.equal(b.note.hidden, false);
  assert.equal(b.note.textContent, 'That is the PTT key.');
  clear._listeners.click[0]();
  assert.equal(getRadioPrefs().intercomPttKey, null);
  assert.equal(button.textContent, 'none');
  assert.equal(b.note.hidden, true);
});
