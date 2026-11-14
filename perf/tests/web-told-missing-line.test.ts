/** The "Fill in to compute" line under the TOLD tables (missing-line.ts). */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';

import { DEFAULT_INPUTS } from '../src/core/inputs/inputs.ts';
import type { Inputs } from '../src/core/inputs/inputs.ts';
import { computeTold } from '../src/core/told/told.ts';
import { DEFAULT_LOADOUT } from '../src/core/dragindex/loadout-row.ts';
import { computeInputs } from '../src/web/inputs.ts';
import { missingLines } from '../src/web/told/missing-line.ts';

import { DATASET_DIR, loadFigureSet } from './helpers/data.ts';

const FIGURES = loadFigureSet(
  readdirSync(DATASET_DIR)
    .filter((name) => name.endsWith('.json') && name !== 'manifest.json')
    .map((name) => name.slice(0, -'.json'.length)),
);

const FILLED: Inputs = {
  ...DEFAULT_INPUTS,
  takeoffGwLb: '30000',
  landingGwLb: '24000',
  runway: '09',
  headingDeg: '090',
  lengthFt: '9000',
  nearElevFt: '100',
  farElevFt: '100',
  altimeterInHg: '29.92',
  tempC: '15',
  wind: '090/05',
};

function lines(typed: Inputs): { takeoff: string[]; landing: string[] } {
  const told = computeTold(FIGURES, computeInputs(typed), DEFAULT_LOADOUT);
  const { normal, heavy } = told.landing;
  return {
    takeoff: missingLines([told.takeoff.mil, told.takeoff.ab], typed).map((l) => l.text),
    landing: missingLines([normal.dry, normal.wet, heavy.dry, heavy.wet], typed).map((l) => l.text),
  };
}

test('every field filled: no line', () => {
  assert.deepEqual(lines(FILLED), { takeoff: [], landing: [] });
});

test('only the far-end elevation empty: both tables name it', () => {
  const out = lines({ ...FILLED, farElevFt: '' });
  assert.deepEqual(out.takeoff, ['Fill in to compute: far-end elevation']);
  assert.deepEqual(out.landing, ['Fill in to compute: far-end elevation']);
});

test('a fresh page names the empty fields in page order', () => {
  const out = lines(DEFAULT_INPUTS);
  assert.equal(out.takeoff.length, 1);
  assert.match(
    out.takeoff[0] ?? '',
    /^Fill in to compute: takeoff GW, .*far-end elevation, altimeter, temperature, wind$/,
  );
});

test('a filled field that does not parse is not named (it is underlined)', () => {
  assert.deepEqual(lines({ ...FILLED, tempC: '4o' }).takeoff, []);
});
