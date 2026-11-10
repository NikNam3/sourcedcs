// The radio panel's preferences (docs/adr/0158 §2): app/public/js/radio/radio-prefs.js. Kept per radio identity, so a
// retune keeps them; persisted through the storage the panel binds.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../app/public/js/radio/radio-prefs.js';
import { buildRadioSet } from '../app/public/js/radio/radio-set.js';

test('nothing stored: the defaults', () => {
  assert.deepEqual(P.normalizeRadioPrefs(null), {
    audio: {}, groups: [], membership: {}, manual: [],
    devices: { input: null, output: null }, intercom: null, pttKey: 'Space', maxTxS: null, pttTarget: null,
    soundSet: 'RADIO_TRANS', noise: true, inputGain: 0.5, outputGain: 1,
  });
  assert.deepEqual(P.normalizeRadioPrefs('junk'), P.normalizeRadioPrefs(undefined));
});

test('a hand-edited or broken store is cleaned, not trusted', () => {
  const p = P.normalizeRadioPrefs({
    audio: { a: { volume: 99, pan: -7, muted: 1 }, b: 'x' },
    membership: { a: 'G1', b: 3, c: '', d: null },
    groups: [{ id: 'G1', name: 'A' }, { id: 2 }, null],
    manual: [{ id: 'm1', mhz: 251 }, { id: 'm2', mhz: 'x' }, { id: 'm3', mhz: 40, modulation: 'FM' }],
    devices: { input: { deviceId: 7 }, output: { deviceId: 'spk', label: 'Speakers' } },
    pttKey: '', maxTxS: 'x', soundSet: 'NOPE', noise: 0, inputGain: 9, outputGain: -1,
  });
  assert.deepEqual(p.audio.a, { volume: 5, pan: -1, muted: true });
  assert.deepEqual(p.audio.b, { volume: 1, pan: 0, muted: false });
  assert.deepEqual(p.membership, { a: 'G1', d: null }); // an explicit null is "unlinked" and is kept
  assert.deepEqual(p.groups, [{ id: 'G1', name: 'A' }]);
  assert.deepEqual(p.manual, [{ id: 'm1', mhz: 251, modulation: 'AM', label: '' }, { id: 'm3', mhz: 40, modulation: 'FM', label: '' }]);
  assert.deepEqual(p.devices, { input: null, output: { deviceId: 'spk', label: 'Speakers' } });
  assert.equal(p.pttKey, 'Space');
  assert.equal(p.maxTxS, null);
  assert.equal(p.soundSet, 'RADIO_TRANS');
  assert.equal(p.noise, true); // only an explicit false turns the noise off
  assert.equal(p.inputGain, 5);
  assert.equal(p.outputGain, 0);
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
  p = P.retuneManualRadio(p, 'm2', { label: 'twr', modulation: 'FM' });
  p = P.retuneManualRadio(p, 'm2', { modulation: 'INTERCOM' }); // not a modulation a manual radio may have
  assert.deepEqual(p.manual, [{ id: 'm1', mhz: 252.5, modulation: 'AM', label: 'TAC' }, { id: 'm2', mhz: 124.5, modulation: 'FM', label: 'TWR' }]);
  p = P.withRadioAudio(p, 'MANUAL:m1', { muted: true });
  p = P.withMembership(p, { 'MANUAL:m1': 'G1', 'GUARD:UHF': 'G1' });
  p = P.withPttTarget(p, 'MANUAL:m1');
  p = P.removeManualRadio(p, 'm1');
  assert.deepEqual(p.manual.map(m => m.id), ['m2']);
  assert.deepEqual(p.audio, {});
  assert.deepEqual(p.membership, { 'GUARD:UHF': 'G1' });
  assert.equal(p.pttTarget, null);
  assert.equal(P.addManualRadio(p, { mhz: 300 }).id, 'm1'); // the freed id is reused
});

test('devices, PTT key, maximum transmit time, PTT target, audio options', () => {
  let p = P.normalizeRadioPrefs(null);
  p = P.withDevices(p, { input: { deviceId: 'mic1', label: 'USB mic' } });
  p = P.withDevices(p, { output: { deviceId: 'spk1', label: 'Speakers' } });
  assert.deepEqual(p.devices, { input: { deviceId: 'mic1', label: 'USB mic' }, output: { deviceId: 'spk1', label: 'Speakers' } });
  assert.equal(P.withDevices(p, { input: null }).devices.input, null);
  assert.equal(P.withPttKey(p, 'KeyT').pttKey, 'KeyT');
  assert.equal(P.withPttKey(p, '').pttKey, 'Space');
  assert.equal(P.withMaxTx(p, 45).maxTxS, 45);
  assert.equal(P.withPttTarget(p, 'GUARD:VHF').pttTarget, 'GUARD:VHF');
  const a = P.normalizeRadioPrefs(P.withAudioOptions(p, { soundSet: 'MIDS', noise: false, inputGain: 1.5 }));
  assert.deepEqual(P.audioOptionsOf(a), { inputGain: 1.5, outputGain: 1, soundSet: 'MIDS', noise: false });
  assert.deepEqual(P.withGroups(p, [{ id: 'G1', name: 'A', radioIds: ['x'] }]).groups, [{ id: 'G1', name: 'A' }]);
});

test('the store: loads from its storage, saves every update, tells its listeners', () => {
  P._resetRadioPrefsForTest();
  let saved = null;
  P.bindRadioPrefsStorage({ load: () => ({ pttKey: 'KeyR' }), save: (x) => { saved = x; } });
  assert.equal(P.getRadioPrefs().pttKey, 'KeyR');
  const heard = [];
  const off = P.onRadioPrefsChanged((x) => heard.push(x.pttTarget));
  P.updateRadioPrefs(p => P.withPttTarget(p, 'GUARD:UHF'));
  assert.equal(saved.pttTarget, 'GUARD:UHF');
  assert.equal(P.getRadioPrefs().pttTarget, 'GUARD:UHF');
  off();
  P.updateRadioPrefs(p => P.withPttTarget(p, null));
  assert.deepEqual(heard, ['GUARD:UHF']);
  // what is saved is the normalized object, so a saved store loads back to the same prefs
  assert.deepEqual(P.normalizeRadioPrefs(JSON.parse(JSON.stringify(saved))), P.normalizeRadioPrefs(saved));
  P._resetRadioPrefsForTest();
});

test('first load: the old panel\'s PTT key and maximum transmit time carry over, nothing else', () => {
  const p = P.seedFromOldPanel(P.normalizeRadioPrefs(null), { pttKey: 'KeyF', maxTxS: 60 });
  assert.equal(p.pttKey, 'KeyF');
  assert.equal(p.maxTxS, 60);
  assert.deepEqual(p.manual, []); // RQ19: no manual radios are seeded
  const none = P.seedFromOldPanel(P.normalizeRadioPrefs(null), { pttKey: null, maxTxS: null });
  assert.deepEqual(none, P.normalizeRadioPrefs(null));
});
