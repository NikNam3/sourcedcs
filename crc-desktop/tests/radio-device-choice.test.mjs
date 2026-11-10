// Which device a saved choice means (S-RADIO-1 RQ9): app/public/js/radio/device-choice.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDevice, devicesByKind, deviceSelection } from '../app/public/js/radio/device-choice.js';

const mics = [{ deviceId: 'a1', label: 'USB mic' }, { deviceId: 'a2', label: 'Headset' }];

test('no saved choice: the default, nothing missing', () => {
  assert.deepEqual(resolveDevice(null, mics), { deviceId: null, missing: false });
});

test('found by id, else by label, else the default and missing', () => {
  assert.deepEqual(resolveDevice({ deviceId: 'a2', label: 'x' }, mics), { deviceId: 'a2', missing: false });
  assert.deepEqual(resolveDevice({ deviceId: 'old', label: 'USB mic' }, mics), { deviceId: 'a1', missing: false });
  assert.deepEqual(resolveDevice({ deviceId: 'old', label: '' }, [{ deviceId: 'z', label: '' }]), { deviceId: null, missing: true });
  assert.deepEqual(resolveDevice({ deviceId: 'old', label: 'Gone' }, mics), { deviceId: null, missing: true });
});

test('the browser list is split by kind, without its default and communications entries', () => {
  const list = [
    { kind: 'audioinput', deviceId: 'default', label: 'Default' }, { kind: 'audioinput', deviceId: 'a1', label: 'USB mic' },
    { kind: 'audiooutput', deviceId: 'communications', label: 'Comms' }, { kind: 'audiooutput', deviceId: 'o1', label: '' },
    { kind: 'videoinput', deviceId: 'v1', label: 'Cam' },
  ];
  assert.deepEqual(devicesByKind(list), { inputs: [{ deviceId: 'a1', label: 'USB mic' }], outputs: [{ deviceId: 'o1', label: '' }] });
});

test('the engine selection and the grey notes', () => {
  const sel = deviceSelection({ input: { deviceId: 'gone', label: 'Gone' }, output: null }, { inputs: mics, outputs: [] });
  assert.deepEqual(sel.engine, { inputId: null, outputId: null });
  assert.deepEqual(sel.notes, ['saved microphone not present: using the default']);
});
