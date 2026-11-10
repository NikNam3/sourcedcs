// The radio panel's preferences (docs/adr/0158 §2): app/public/js/radio/radio-prefs.js. Kept per radio identity, so a
// retune keeps them; persisted through the storage the panel binds.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../app/public/js/radio/radio-prefs.js';
import { buildRadioSet } from '../app/public/js/radio/radio-set.js';

test('nothing stored: the defaults', () => {
  assert.deepEqual(P.normalizeRadioPrefs(null), {
    audio: {}, membership: {}, groups: [], manual: [],
    devices: { inputId: null, outputId: null }, pttKey: 'Space', pttMaxTxS: null, pttTargetId: null,
  });
  assert.deepEqual(P.normalizeRadioPrefs('junk'), P.normalizeRadioPrefs(undefined));
});

test('a hand-edited or broken store is cleaned, not trusted', () => {
  const p = P.normalizeRadioPrefs({
    audio: { a: { volume: 99, pan: -7, muted: 1 }, b: 'x' },
    membership: { a: 'G1', b: 3, c: '' },
    groups: [{ id: 'G1', name: 'A' }, { id: 2 }, null],
    manual: [{ id: 'm1', mhz: 251 }, { id: 'm2', mhz: 'x' }],
    devices: { inputId: 7, outputId: 'spk' },
    pttKey: '', pttMaxTxS: 'x',
  });
  assert.deepEqual(p.audio.a, { volume: 5, pan: -1, muted: true });
  assert.deepEqual(p.audio.b, { volume: 1, pan: 0, muted: false });
  assert.deepEqual(p.membership, { a: 'G1' });
  assert.deepEqual(p.groups, [{ id: 'G1', name: 'A' }]);
  assert.deepEqual(p.manual, [{ id: 'm1', label: '', mhz: 251 }]);
  assert.deepEqual(p.devices, { inputId: null, outputId: 'spk' });
  assert.equal(p.pttKey, 'Space');
  assert.equal(p.pttMaxTxS, null);
});

test('volume, pan and mute are per radio identity and survive a retune', () => {
  let p = P.normalizeRadioPrefs(null);
  assert.deepEqual(P.radioAudioOf(p, 'POSITION:P1:UHF'), P.DEFAULT_AUDIO);
  p = P.withRadioAudio(p, 'POSITION:P1:UHF', { volume: 2.5 });
  p = P.withRadioAudio(p, 'POSITION:P1:UHF', { pan: -0.5, muted: true });
  assert.deepEqual(P.radioAudioOf(p, 'POSITION:P1:UHF'), { volume: 2.5, pan: -0.5, muted: true });
  assert.deepEqual(P.radioAudioOf(p, 'POSITION:P1:VHF'), P.DEFAULT_AUDIO);
  const row = (mhz) => [{ facilityId: 'F', kind: 'POSITION', positionId: 'P1', label: 'TWR', mhz }];
  const before = buildRadioSet({ staffed: [{ facilityId: 'F', positionId: 'P1' }], rows: row(275.8) }).radios[0];
  const after = buildRadioSet({ staffed: [{ facilityId: 'F', positionId: 'P1' }], rows: row(280.0) }).radios[0];
  assert.equal(before.id, after.id);
  assert.equal(P.radioAudioOf(p, after.id).volume, 2.5);
});

test('manual radios: add, retune, relabel, remove; removing forgets its audio, group and PTT target', () => {
  let p = P.normalizeRadioPrefs(null);
  let r = P.addManualRadio(p, { label: ' tac ', mhz: 251 });
  assert.equal(r.id, 'm1');
  p = r.prefs;
  r = P.addManualRadio(p, { mhz: 124.5 });
  assert.equal(r.id, 'm2');
  p = r.prefs;
  p = P.retuneManualRadio(p, 'm1', { mhz: 252.5 });
  p = P.retuneManualRadio(p, 'm2', { label: 'twr' });
  assert.deepEqual(p.manual, [{ id: 'm1', label: 'TAC', mhz: 252.5 }, { id: 'm2', label: 'TWR', mhz: 124.5 }]);
  p = P.withRadioAudio(p, 'MANUAL:m1', { muted: true });
  p = P.withMembership(p, { 'MANUAL:m1': 'G1', 'GUARD:UHF': 'G1' });
  p = P.withPttTarget(p, 'MANUAL:m1');
  p = P.removeManualRadio(p, 'm1');
  assert.deepEqual(p.manual, [{ id: 'm2', label: 'TWR', mhz: 124.5 }]);
  assert.deepEqual(p.audio, {});
  assert.deepEqual(p.membership, { 'GUARD:UHF': 'G1' });
  assert.equal(p.pttTargetId, null);
  assert.equal(P.addManualRadio(p, { mhz: 300 }).id, 'm1'); // the freed id is reused
});

test('devices, PTT key, maximum transmit time, PTT target', () => {
  let p = P.normalizeRadioPrefs(null);
  p = P.withDevices(p, { inputId: 'mic1' });
  p = P.withDevices(p, { outputId: 'spk1' });
  assert.deepEqual(p.devices, { inputId: 'mic1', outputId: 'spk1' });
  assert.equal(P.withPttKey(p, 'KeyT').pttKey, 'KeyT');
  assert.equal(P.withPttKey(p, '').pttKey, 'Space');
  assert.equal(P.withPttMaxTx(p, 45).pttMaxTxS, 45);
  assert.equal(P.withPttTarget(p, 'GUARD:VHF').pttTargetId, 'GUARD:VHF');
  assert.deepEqual(P.withGroups(p, [{ id: 'G1', name: 'A', radioIds: ['x'] }]).groups, [{ id: 'G1', name: 'A' }]);
});

test('the store: loads from its storage, saves every update, tells its listeners', () => {
  P._resetRadioPrefsForTest();
  let saved = null;
  P.bindRadioPrefsStorage({ load: () => ({ pttKey: 'KeyR' }), save: (x) => { saved = x; } });
  assert.equal(P.getRadioPrefs().pttKey, 'KeyR');
  const heard = [];
  const off = P.onRadioPrefsChanged((x) => heard.push(x.pttTargetId));
  P.updateRadioPrefs(p => P.withPttTarget(p, 'GUARD:UHF'));
  assert.equal(saved.pttTargetId, 'GUARD:UHF');
  assert.equal(P.getRadioPrefs().pttTargetId, 'GUARD:UHF');
  off();
  P.updateRadioPrefs(p => P.withPttTarget(p, null));
  assert.deepEqual(heard, ['GUARD:UHF']);
  // what is saved is the normalized object, so a saved store loads back to the same prefs
  assert.deepEqual(P.normalizeRadioPrefs(JSON.parse(JSON.stringify(saved))), P.normalizeRadioPrefs(saved));
  P._resetRadioPrefsForTest();
});
