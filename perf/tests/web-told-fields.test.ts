/** The TOLD page's field underline and derived line (TOLD 1.8 "The TOLD page"). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deriveInputs } from '../src/core/inputs/derive.ts';
import { DEFAULT_INPUTS } from '../src/core/inputs/inputs.ts';
import type { Inputs } from '../src/core/inputs/inputs.ts';
import { derivedLines } from '../src/web/told/derived-line.ts';
import { unparsedFields } from '../src/web/told/field-check.ts';
import { computeInputs } from '../src/web/inputs.ts';

const MOCKUP: Inputs = {
  ...DEFAULT_INPUTS,
  takeoffGwLb: '37,240',
  landingGwLb: '28,000',
  cgPct: '',
  additionalDragIndex: '',
  runway: '21',
  headingDeg: '210',
  lengthFt: '5,900',
  nearElevFt: '1,980',
  farElevFt: '2,027',
  altimeterInHg: '29.86',
  tempC: '38.4',
  wind: '230 / 08 G15',
  rcrDry: '',
  rcrWet: '',
};

const derive = (typed: Inputs) => deriveInputs(computeInputs(typed));

test('the mockup inputs: nothing underlined, both derived lines', () => {
  assert.deepEqual([...unparsedFields(MOCKUP, derive(MOCKUP), true)], []);
  assert.deepEqual(derivedLines(derive(MOCKUP)), [
    'Pressure altitude 2,036 ft · slope 0.8 % uphill',
    'Headwind 7.5 kt · crosswind 5.1 kt from the right · gust 15 kt',
  ]);
});

test('a filled field that does not parse or fails a physical limit is underlined; an empty one is not', () => {
  const typed = { ...MOCKUP, landingGwLb: '28,0O0', headingDeg: '0', lengthFt: '', wind: '230 / 0' };
  assert.deepEqual([...unparsedFields(typed, derive(typed), true)].sort(), ['headingDeg', 'landingGwLb']);
  const commas = { ...MOCKUP, altimeterInHg: '29,86', tempC: '38,4', takeoffGwLb: '37,24' };
  assert.deepEqual([...unparsedFields(commas, derive(commas), true)].sort(), ['altimeterInHg', 'takeoffGwLb', 'tempC']);
  const partial = { ...MOCKUP, wind: '230 / ' };
  assert.deepEqual([...unparsedFields(partial, derive(partial), true)], ['wind']);
});

test('the additional drag index is underlined from its own parse, only when filled', () => {
  assert.deepEqual(
    [...unparsedFields({ ...MOCKUP, additionalDragIndex: 'x' }, derive(MOCKUP), false)],
    ['additionalDragIndex'],
  );
  assert.deepEqual([...unparsedFields(MOCKUP, derive(MOCKUP), false)], []);
});

test('the derived line leaves out what does not compute, and names a tailwind, downhill and from the left', () => {
  assert.deepEqual(derivedLines(derive({ ...MOCKUP, altimeterInHg: '', wind: '' })), ['Slope 0.8 % uphill']);
  assert.deepEqual(derivedLines(derive({ ...MOCKUP, farElevFt: '1,900', wind: '050/10' })), [
    'Pressure altitude 2,036 ft · slope 1.4 % downhill',
    'Tailwind 9.4 kt · crosswind 3.4 kt from the left',
  ]);
  assert.deepEqual(derivedLines(derive({ ...MOCKUP, altimeterInHg: '', farElevFt: '1,980', wind: '030/10' })), [
    'Slope 0.0 %',
    'Tailwind 10.0 kt · crosswind 0.0 kt',
  ]);
  assert.deepEqual(derivedLines(derive({ ...DEFAULT_INPUTS })), []);
});
