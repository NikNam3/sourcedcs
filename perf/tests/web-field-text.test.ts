/** The page's typed text → the core's Inputs (TOLD 1.8 "The TOLD page"). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_INPUTS } from '../src/core/inputs/inputs.ts';
import type { Inputs } from '../src/core/inputs/inputs.ts';
import { blankDefaults, computeInputs, joinRcr, plainNumber, plainWind, splitRcr } from '../src/web/told/field-text.ts';

const EMPTY: Inputs = {
  takeoffGwLb: '',
  landingGwLb: '',
  cgPct: '',
  additionalDragIndex: '',
  runway: '',
  headingDeg: '',
  lengthFt: '',
  nearElevFt: '',
  farElevFt: '',
  altimeterInHg: '',
  tempC: '',
  wind: '',
  rcrDry: '',
  rcrWet: '',
};

test('plainNumber strips thousands separators', () => {
  for (const [typed, plain] of [
    ['37,240', '37240'],
    ['37,', '37'],
    ['1,980.5', '1980.5'],
    ['', ''],
    ['-1,2', '-12'],
    ['abc', 'abc'],
  ] as const) {
    assert.equal(plainNumber(typed), plain, typed);
  }
});

test('plainWind removes every space', () => {
  for (const [typed, plain] of [
    ['230 / 08 G15', '230/08G15'],
    ['230/08', '230/08'],
    [' 230 / 0', '230/0'],
    ['230 /', '230/'],
    ['', ''],
  ] as const) {
    assert.equal(plainWind(typed), plain, typed);
  }
});

test('splitRcr: split at the first /, parts trimmed, an empty part means the default', () => {
  for (const [typed, dry, wet] of [
    ['23 / 18', '23', '18'],
    ['23/8', '23', '8'],
    ['/ 8', '', '8'],
    ['8', '8', ''],
    ['8 /', '8', ''],
    ['', '', ''],
    ['  ', '', ''],
    ['23 / 18 / 4', '23', '18 / 4'],
  ] as const) {
    assert.deepEqual(splitRcr(typed), { dry, wet }, typed);
  }
});

test('joinRcr is the field text for the two parts, and splits back', () => {
  for (const [dry, wet, text] of [
    ['23', '18', '23 / 18'],
    ['', '8', '/ 8'],
    ['8', '', '8'],
    ['', '', ''],
  ] as const) {
    assert.equal(joinRcr(dry, wet), text);
    assert.deepEqual(splitRcr(text), { dry, wet });
  }
});

test('computeInputs: numbers without separators, wind without spaces, empty defaulted fields take the default', () => {
  const typed: Inputs = {
    ...EMPTY,
    takeoffGwLb: '37,240',
    landingGwLb: '28,000',
    runway: '21 L',
    lengthFt: '5,900',
    wind: '230 / 08 G15',
    rcrWet: ' 8 ',
  };
  assert.deepEqual(computeInputs(typed), {
    ...EMPTY,
    takeoffGwLb: '37240',
    landingGwLb: '28000',
    cgPct: DEFAULT_INPUTS.cgPct,
    additionalDragIndex: DEFAULT_INPUTS.additionalDragIndex,
    runway: '21 L',
    lengthFt: '5900',
    wind: '230/08G15',
    rcrDry: DEFAULT_INPUTS.rcrDry,
    rcrWet: ' 8 ',
  });
});

test('computeInputs: an empty field without a default stays empty; a blank defaulted one takes the default', () => {
  const out = computeInputs({ ...EMPTY, cgPct: '  ', tempC: '  ' });
  assert.equal(out.cgPct, '35');
  assert.equal(out.tempC, '  ');
});

test('blankDefaults empties the fields with a default, so they show their placeholder', () => {
  assert.deepEqual(blankDefaults(DEFAULT_INPUTS), EMPTY);
  assert.equal(blankDefaults({ ...DEFAULT_INPUTS, tempC: '38.4' }).tempC, '38.4');
});
