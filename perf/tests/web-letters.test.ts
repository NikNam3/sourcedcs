/**
 * The circled letters of a sheet (`src/web/figure/letters.ts`): one letter per reading, in chain order, and a reading
 * repeated at the same point (B7-1's two speeds from one gross weight) keeps its letter.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tracePaths } from '../src/core/path/trace.ts';
import { landingChain } from '../src/core/told/landing.ts';
import { takeoffChain } from '../src/core/told/takeoff.ts';
import { markRuns } from '../src/web/figure/geometry.ts';
import { sheetLetters } from '../src/web/figure/letters.ts';

import { loadFigureSet } from './helpers/data.ts';
import { SAMPLE, TAKEOFF_FIGURES } from './helpers/takeoff.ts';

const FIGS = { ...TAKEOFF_FIGURES, ...loadFigureSet(['B7-1', 'B7-2.sh1', 'B7-2.sh2']) };

test('B7-1: one Ⓐ for the gross weight both speeds start from, three letters at three points', () => {
  const b71 = FIGS['B7-1'];
  assert.ok(b71 !== undefined);
  const values = { paFt: 2000, tempC: 40, grossWeightLb: 33000, headwindKt: 10, slopePct: 1, rcr: 23 };
  const marks = tracePaths(landingChain(FIGS, values, 'dry')).marks.filter((m) => m.figure === 'B7-1');
  const { letters, rows } = sheetLetters('B7-1', [markRuns(b71, marks)]);
  assert.deepEqual(
    rows.map((r) => `${r.circled} ${r.label}`),
    ['Ⓐ Gross weight, lb', 'Ⓑ Final approach speed, KIAS', 'Ⓒ Touchdown speed, KIAS'],
  );
  assert.deepEqual(
    letters.map((l) => l.letter),
    ['A', 'B', 'C'],
  );
  assert.equal(new Set(letters.map((l) => l.at.join())).size, 3);
  assert.deepEqual(
    rows.map((r) => r.result),
    [false, true, true],
  );
});

test('B2-3: seven readings, Ⓐ to Ⓖ, one value per path', () => {
  const b23 = FIGS['B2-3'];
  assert.ok(b23 !== undefined);
  const runs = (['mil', 'ab'] as const).map((mode) =>
    markRuns(
      b23,
      tracePaths(takeoffChain(TAKEOFF_FIGURES, SAMPLE, mode)).marks.filter((m) => m.figure === 'B2-3'),
    ),
  );
  const { rows } = sheetLetters('B2-3', runs);
  assert.deepEqual(
    rows.map((r) => r.circled),
    ['Ⓐ', 'Ⓑ', 'Ⓒ', 'Ⓓ', 'Ⓔ', 'Ⓕ', 'Ⓖ'],
  );
  assert.equal(rows[0]?.from, 'B2-1');
  assert.ok(rows.every((r) => r.values.length === 2));
});
