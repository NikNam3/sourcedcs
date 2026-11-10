// Radio identity <-> SRS slot mapping (app/srs/radio-slots.js, ADR 0158 §1, §4; S-RADIO-1 RQ5, RQ13).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSlots, matchRadioIds, txChannels, selectedSlot, mhzToHz } = require('../app/srs/radio-slots');

const R = (id, mhz, extra = {}) => ({ id, mhz, modulation: 'AM', label: id, ...extra });

test('radios on one frequency and modulation share a slot; slots keep the order sent', () => {
  const { slots, invalid, error } = buildSlots([R('GUARD:UHF', 243), R('A', 251), R('M', 243), R('F', 243, { modulation: 'FM' }), R('A', 300)]);
  assert.equal(error, null);
  assert.deepEqual(slots.map(s => s.radioIds), [['GUARD:UHF', 'M'], ['A'], ['F']]);
  assert.deepEqual(invalid, []);
});

test('a bad frequency or an unknown modulation is invalid', () => {
  const { invalid } = buildSlots([R('Z', 0), R('H', 251, { modulation: 'HAVEQUICK' }), R('X', 'abc')]);
  assert.deepEqual(invalid, ['Z', 'H', 'X']);
});

test('the intercom takes slot 0 at 100 Hz; a second one is invalid; it never rides with other radios (H183)', () => {
  const { slots, invalid } = buildSlots([R('A', 251), R('IC', 0, { modulation: 'INTERCOM' }), R('IC2', 0, { modulation: 'INTERCOM' })]);
  assert.deepEqual(slots.map(s => [s.radioIds[0], s.hz, s.modulation]), [['IC', 100, 2], ['A', 251e6, 0]]);
  assert.deepEqual(invalid, ['IC2']);
  assert.deepEqual(txChannels(slots, ['A', 'IC']).radioIds, ['A']);
  assert.deepEqual(txChannels(slots, ['IC']).frequencies, [100]);
  assert.deepEqual(matchRadioIds(slots, [100], [2], [0]), ['IC']);
});

test('past eleven distinct channels the first eleven are tuned and the rest reported', () => {
  // Twelve radios, two of them on 243: eleven channels, which fit.
  const eleven = buildSlots(Array.from({ length: 12 }, (_, i) => R(`M${i}`, i < 2 ? 243 : 250 + i)));
  assert.equal(eleven.slots.length, 11);
  assert.equal(eleven.error, null);
  const twelve = buildSlots(Array.from({ length: 13 }, (_, i) => R(`M${i}`, 250 + i)));
  assert.equal(twelve.slots.length, 11);
  assert.deepEqual(twelve.overflow, ['M11', 'M12']);
  assert.match(twelve.error, /11 radio slots; not tuned: M11, M12/);
});

test('MHz to Hz rounds away float noise and tunes a channel name literally', () => {
  assert.equal(mhzToHz(122.1), 122100000);
  assert.equal(mhzToHz('305.500'), 305500000);
  assert.equal(mhzToHz(122.105), 122105000);
});

test('a packet is heard on every radio of a matching slot; modulation counts; encrypted segments do not', () => {
  const { slots } = buildSlots([R('A', 251), R('B', 122.1), R('C', 251), R('D', 251, { modulation: 'FM' })]);
  assert.deepEqual(matchRadioIds(slots, [251e6], [0], [0]), ['A', 'C']);
  assert.deepEqual(matchRadioIds(slots, [243e6, 122100000.4], [0, 0], [0, 0]), ['B']);
  assert.deepEqual(matchRadioIds(slots, [251e6], [1], [0]), ['D']);
  assert.deepEqual(matchRadioIds(slots, [251e6], [0], [3]), []);
  assert.deepEqual(matchRadioIds(slots, [251.0083e6], [0], [0]), [], '8.33 kHz away is another channel');
});

test('a group transmits one entry per slot it holds', () => {
  const { slots } = buildSlots([R('A', 251), R('B', 122.1), R('C', 251), R('G', 243)]);
  const tx = txChannels(slots, ['A', 'B', 'C', 'X']);
  assert.deepEqual(tx.frequencies, [251e6, 122.1e6]);
  assert.deepEqual(tx.modulations, [0, 0]);
  assert.deepEqual(tx.encryptions, [0, 0]);
  assert.deepEqual(tx.radioIds, ['A', 'C', 'B']);
  assert.equal(selectedSlot(slots, ['B']), 1);
  assert.equal(selectedSlot(slots, []), 0);
});
