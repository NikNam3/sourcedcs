import test from 'node:test';
import assert from 'node:assert/strict';
import { atisFreqProblem, atisFrequenciesHz, atisInUseElsewhere, atisInUseText } from '../app/public/js/panels/aprt-atis-freqs.js';

// crc-sync docs/adr/0158 §5: the APRT panel's ATIS on its UHF frequency and an optional VHF one.

test('atisFreqProblem: empty is fine, a value outside its band or not a number is wrong', () => {
  assert.equal(atisFreqProblem('', 'VHF'), null);
  assert.equal(atisFreqProblem('  ', 'UHF'), null);
  assert.equal(atisFreqProblem('121.500', 'VHF'), null);
  assert.equal(atisFreqProblem('118', 'VHF'), null);
  assert.equal(atisFreqProblem('136.975', 'VHF'), null);
  assert.equal(atisFreqProblem('251.000', 'UHF'), null);
  assert.match(atisFreqProblem('251.000', 'VHF'), /VHF band/);
  assert.match(atisFreqProblem('121.500', 'UHF'), /UHF band/);
  assert.match(atisFreqProblem('137.000', 'VHF'), /VHF band/);
  assert.match(atisFreqProblem('abc', 'VHF'), /Not a frequency/);
  assert.match(atisFreqProblem('1e2', 'VHF'), /Not a frequency/);
});

test('atisFrequenciesHz: the UHF input, then a valid VHF one, without repeats', () => {
  assert.deepEqual(atisFrequenciesHz('251.000', ''), [251000000]);
  assert.deepEqual(atisFrequenciesHz('251.000', '121.500'), [251000000, 121500000]);
  assert.deepEqual(atisFrequenciesHz('251.000', '251.000'), [251000000], 'a VHF value outside VHF is not transmitted');
  assert.deepEqual(atisFrequenciesHz('121.500', '121.500'), [121500000], 'an old VHF value in the UHF input still transmits, once');
  assert.deepEqual(atisFrequenciesHz('', '121.500'), [121500000]);
  assert.deepEqual(atisFrequenciesHz('', ''), []);
  assert.deepEqual(atisFrequenciesHz('305.275', '118.025'), [305275000, 118025000], 'no float drift into the Hz');
});

test('atisInUseElsewhere: another owner on either frequency, never our own', () => {
  const active = [{ frequency: 121500000, ownerId: 'b' }, { frequency: 251000000, ownerId: 'me' }];
  assert.equal(atisInUseElsewhere(active, [251000000, 121500000], 'me'), 121500000);
  assert.equal(atisInUseElsewhere(active, [251000000], 'me'), null);
  assert.equal(atisInUseElsewhere([], [251000000], 'me'), null);
  assert.equal(atisInUseText(121500000), 'IN USE 121.500 (another client)');
});
