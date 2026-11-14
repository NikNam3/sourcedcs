/** The reason lines (TOLD 1.8 "Reason lines"), on the real figure data. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FigureSet } from '../src/core/data/figure-set.ts';
import type { Reason } from '../src/core/told/column.ts';
import { reasonText } from '../src/web/reasons.ts';

import { loadFigureSet } from './helpers/data.ts';

const FIGURES: FigureSet = loadFigureSet([
  'B2-1',
  'B2-2',
  'B2-3',
  'B2-4',
  'B2-5.sh1',
  'B2-6.sh2',
  'B2-6.sh3',
  'B7-2.sh1',
]);
const NO_SIGNS = { headwindKt: null, slopePct: null };

function reason(
  figure: string,
  input: string,
  value: number,
  drawnRange: readonly [number, number] | null,
  cell: 'exact' | 'conservative' = 'exact',
): Reason {
  return { cell, error: { kind: 'outOfChart', figure, input, value, drawnRange } };
}

test('a value in 1000 lb is shown in lb, with the drawn range', () => {
  assert.deepEqual(reasonText(reason('B2-3', 'gross_weight', 52, [20, 48]), FIGURES, NO_SIGNS), {
    figure: 'B2-3',
    text: 'gross weight 52,000 lb outside the drawn range 20,000–48,000 lb',
  });
});

test('a drawn range in lb or ft is rounded inward to whole numbers; other units keep their decimals', () => {
  assert.equal(
    reasonText(reason('B7-1', 'gross_weight', 50, [17, 48.0042]), FIGURES, NO_SIGNS).text,
    'gross weight 50,000 lb outside the drawn range 17,000–48,004 lb',
  );
  assert.equal(
    reasonText(reason('B7-1', 'gross_weight', 10, [16.9996, 48]), FIGURES, NO_SIGNS).text,
    'gross weight 10,000 lb outside the drawn range 17,000–48,000 lb',
  );
  assert.equal(
    reasonText(reason('B2-3', 'gross_weight', 52, [0.3, 48]), FIGURES, NO_SIGNS).text,
    'gross weight 52,000 lb outside the drawn range 300–48,000 lb',
  );
});

test('a conservative reason says "conservative" before the name; the sheet as "sh. n"', () => {
  assert.deepEqual(
    reasonText(reason('B2-6.sh2', 'gross_weight', 37.3, [20, 37.25], 'conservative'), FIGURES, NO_SIGNS),
    {
      figure: 'B2-6 sh. 2',
      text: 'conservative gross weight 37,300 lb outside the drawn range 20,000–37,250 lb',
    },
  );
});

test('no drawn range: outside the drawn chart', () => {
  assert.deepEqual(reasonText(reason('B7-2.sh1', 'temperature', 50, null), FIGURES, NO_SIGNS), {
    figure: 'B7-2 sh. 1',
    text: 'temperature 50 °C outside the drawn chart',
  });
});

test('a negative bound gets a true minus', () => {
  assert.equal(
    reasonText(reason('B2-4', 'temperature', 38.4, [-20, 35]), FIGURES, NO_SIGNS).text,
    'temperature 38.4 °C outside the drawn range −20–35 °C',
  );
});

test('wind gets its side from the signed headwind', () => {
  const tail = reason('B2-6.sh3', 'wind', 20, [0, 18.75]);
  assert.deepEqual(reasonText(tail, FIGURES, { headwindKt: -20, slopePct: null }), {
    figure: 'B2-6 sh. 3',
    text: 'tailwind 20 kt outside the drawn range 0–18.75 kt',
  });
  assert.equal(
    reasonText(tail, FIGURES, { headwindKt: 20, slopePct: null }).text,
    'headwind 20 kt outside the drawn range 0–18.75 kt',
  );
  assert.equal(reasonText(tail, FIGURES, NO_SIGNS).text, 'wind 20 kt outside the drawn range 0–18.75 kt');
  assert.equal(
    reasonText(reason('B2-6.sh3', 'wind', 20, [0, 18.75], 'conservative'), FIGURES, { headwindKt: -20, slopePct: 0 })
      .text,
    'conservative tailwind 20 kt outside the drawn range 0–18.75 kt',
  );
});

test('slope gets its side from the signed slope', () => {
  const r = reason('B2-3', 'slope', 2.1, [0, 2]);
  assert.equal(
    reasonText(r, FIGURES, { headwindKt: null, slopePct: 2.1 }).text,
    'uphill slope 2.1 % outside the drawn range 0–2 %',
  );
  assert.equal(
    reasonText(r, FIGURES, { headwindKt: null, slopePct: -2.1 }).text,
    'downhill slope 2.1 % outside the drawn range 0–2 %',
  );
  assert.equal(reasonText(r, FIGURES, NO_SIGNS).text, 'slope 2.1 % outside the drawn range 0–2 %');
});

test('a value in 1000 ft is shown in ft', () => {
  assert.equal(
    reasonText(reason('B2-3', 'distance', 9.5, [1, 9]), FIGURES, NO_SIGNS).text,
    'distance 9,500 ft outside the drawn range 1,000–9,000 ft',
  );
});

test('KIAS and a plain ft unit are shown as given', () => {
  assert.equal(
    reasonText(reason('B2-5.sh1', 'refusal_speed', 200, [80, 180]), FIGURES, NO_SIGNS).text,
    'refusal speed 200 KIAS outside the drawn range 80–180 KIAS',
  );
  assert.equal(
    reasonText(reason('B2-5.sh1', 'runway_length', 16000, [6000, 14000]), FIGURES, NO_SIGNS).text,
    'runway length 16,000 ft outside the drawn range 6,000–14,000 ft',
  );
});

test('a value not in a table: NaN', () => {
  assert.equal(
    reasonText(reason('B2-3', 'gross_weight', NaN, null), FIGURES, NO_SIGNS).text,
    'gross weight not in the table',
  );
});

test('a quantity not on the error figure takes its unit from another figure (B2-2 cg, from B2-3); CG in capitals', () => {
  assert.deepEqual(reasonText(reason('B2-2', 'cg', 45, [20, 40]), FIGURES, NO_SIGNS), {
    figure: 'B2-2',
    text: 'CG 45 % MAC outside the drawn range 20–40 % MAC',
  });
});

test('RCR in capitals; the takeoff factors by mode', () => {
  assert.equal(
    reasonText(reason('B2-5.sh1', 'rcr', 5, [8, 16]), FIGURES, NO_SIGNS).text,
    'RCR 5 outside the drawn range 8–16',
  );
  assert.equal(
    reasonText(reason('B2-1', 'tof_ab', 0.2, [0.5, 3]), FIGURES, NO_SIGNS).text,
    'MAX AB takeoff factor 0.2 outside the drawn range 0.5–3',
  );
});

test('a dimensionless quantity has no unit', () => {
  assert.equal(
    reasonText(reason('B2-3', 'takeoff_factor', 4.25, [0.5, 4]), FIGURES, NO_SIGNS).text,
    'takeoff factor 4.25 outside the drawn range 0.5–4',
  );
});

test('a quantity no figure knows: its own name, no unit; a figure not in the set still gives a line', () => {
  assert.deepEqual(reasonText(reason('B9-9.sh4', 'mystery_value', 3, [1, 2]), FIGURES, NO_SIGNS), {
    figure: 'B9-9 sh. 4',
    text: 'mystery value 3 outside the drawn range 1–2',
  });
});
