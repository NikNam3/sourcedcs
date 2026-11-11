/**
 * The runway rules (`told/rules.ts`, TOLD 1.7 "Rules", 1.2 item 3): every threshold at and just over, strictly
 * greater; the exact and the conservative cell checked on their own; a null limit verdict marks nothing.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Cell } from '../src/core/ctx.ts';
import type { LimitVerdicts } from '../src/core/figures/b7-2.ts';
import { ok, outOfChart } from '../src/core/result.ts';
import type { Read } from '../src/core/result.ts';
import type { LandingSide } from '../src/core/told/landing.ts';
import { landingMarks, RULES, runwayUsedPct, takeoffMarks } from '../src/core/told/rules.ts';
import type { RuleMark } from '../src/core/told/rules.ts';
import type { TakeoffSide } from '../src/core/told/takeoff.ts';

const RUNWAY_FT = 10000;
const SIDE: TakeoffSide = { checkDistanceFt: 2000 };
const NO_LIMITS: LimitVerdicts = { brakeEnergy: false, mlgTire: false, nlgTire: false };

const takeoffCell = (exactFt: number, conservativeFt = exactFt): Cell<TakeoffSide> => ({
  exact: ok(exactFt),
  conservative: ok(conservativeFt),
  exactSide: SIDE,
  conservativeSide: SIDE,
});

const landingCell = (
  exactFt: Read<number>,
  conservativeFt: Read<number> = exactFt,
  exactLimits: LimitVerdicts | null = NO_LIMITS,
  conservativeLimits: LimitVerdicts | null = exactLimits,
): Cell<LandingSide> => ({
  exact: exactFt,
  conservative: conservativeFt,
  exactSide: { limits: exactLimits },
  conservativeSide: { limits: conservativeLimits },
});

const rules = (marks: readonly RuleMark[]): string[] => marks.map((m) => `${m.rule}:${m.cell}`);

describe('runway rules', () => {
  test('RULES: one entry per rule with its paragraph', () => {
    assert.deepEqual(RULES, [
      { id: 'mil-roll-50', paragraph: '3.6.6' },
      { id: 'takeoff-roll-80', paragraph: '3.6.3' },
      { id: 'landing-roll-80', paragraph: '3.18' },
      { id: 'landing-rcr-10', paragraph: '3.18' },
      { id: 'b7-2-limit', paragraph: 'Fig. B7-2 sh. 1' },
    ]);
  });

  test('runwayUsedPct: distance / length × 100, unrounded', () => {
    assert.equal(runwayUsedPct(5001, RUNWAY_FT), 50.01);
    assert.equal(runwayUsedPct(2950, 5900), 50);
  });

  test('MIL: 50.0 % no mark, 50.01 % mil-roll-50 (3.6.6) with its percent', () => {
    assert.deepEqual(takeoffMarks('mil', takeoffCell(5000), RUNWAY_FT), []);
    const marks = takeoffMarks('mil', takeoffCell(5001), RUNWAY_FT);
    assert.deepEqual(rules(marks), ['mil-roll-50:exact', 'mil-roll-50:conservative']);
    assert.equal(marks.at(0)?.paragraph, '3.6.6');
    assert.equal(marks.at(0)?.percent, 50.01);
  });

  test('AB: 50.01 % no mark', () => {
    assert.deepEqual(takeoffMarks('ab', takeoffCell(5001), RUNWAY_FT), []);
  });

  test('any takeoff: 80.0 % no 3.6.3 mark, 80.01 % takeoff-roll-80', () => {
    assert.deepEqual(takeoffMarks('ab', takeoffCell(8000), RUNWAY_FT), []);
    assert.deepEqual(rules(takeoffMarks('ab', takeoffCell(8001), RUNWAY_FT)), [
      'takeoff-roll-80:exact',
      'takeoff-roll-80:conservative',
    ]);
    assert.deepEqual(rules(takeoffMarks('mil', takeoffCell(8000), RUNWAY_FT)), [
      'mil-roll-50:exact',
      'mil-roll-50:conservative',
    ]);
    const mil = takeoffMarks('mil', takeoffCell(8001), RUNWAY_FT);
    assert.deepEqual(rules(mil), [
      'mil-roll-50:exact',
      'takeoff-roll-80:exact',
      'mil-roll-50:conservative',
      'takeoff-roll-80:conservative',
    ]);
    assert.equal(mil.find((m) => m.rule === 'takeoff-roll-80')?.paragraph, '3.6.3');
  });

  test('takeoff: exact under, conservative over gives one mark on the conservative cell', () => {
    const marks = takeoffMarks('mil', takeoffCell(4990, 5010), RUNWAY_FT);
    assert.deepEqual(marks, [{ rule: 'mil-roll-50', paragraph: '3.6.6', cell: 'conservative', percent: 50.1 }]);
  });

  test('takeoff: an OutOfChart cell marks nothing', () => {
    const error = outOfChart('B2-3', 'drag_index', -4, [0, 200]);
    const cell: Cell<TakeoffSide> = { ...takeoffCell(9000), exact: error };
    assert.deepEqual(rules(takeoffMarks('mil', cell, RUNWAY_FT)), [
      'mil-roll-50:conservative',
      'takeoff-roll-80:conservative',
    ]);
  });

  test('landing: 80.0 % no mark, 80.01 % landing-roll-80 (3.18)', () => {
    assert.deepEqual(landingMarks(landingCell(ok(8000)), RUNWAY_FT, 23), []);
    const marks = landingMarks(landingCell(ok(8001)), RUNWAY_FT, 23);
    assert.deepEqual(rules(marks), ['landing-roll-80:exact', 'landing-roll-80:conservative']);
    assert.equal(marks.at(0)?.paragraph, '3.18');
    assert.equal(marks.at(0)?.percent, 80.01);
  });

  test('landing: exact under, conservative over gives one mark on the conservative cell', () => {
    assert.deepEqual(landingMarks(landingCell(ok(7990), ok(8010)), RUNWAY_FT, 23), [
      { rule: 'landing-roll-80', paragraph: '3.18', cell: 'conservative', percent: 80.1 },
    ]);
  });

  test('landing-rcr-10: RCR 9.5 marks, 10 does not', () => {
    assert.deepEqual(landingMarks(landingCell(ok(3000)), RUNWAY_FT, 10), []);
    const marks = landingMarks(landingCell(ok(3000)), RUNWAY_FT, 9.5);
    assert.deepEqual(rules(marks), ['landing-rcr-10:exact', 'landing-rcr-10:conservative']);
    assert.equal(marks.at(0)?.paragraph, '3.18');
  });

  test('b7-2-limit: true in conservativeSide marks only the conservative cell, with the line', () => {
    const over: LimitVerdicts = { brakeEnergy: false, mlgTire: true, nlgTire: false };
    assert.deepEqual(landingMarks(landingCell(ok(3000), ok(3010), NO_LIMITS, over), RUNWAY_FT, 23), [
      { rule: 'b7-2-limit', paragraph: 'Fig. B7-2 sh. 1', cell: 'conservative', line: 'mlgTire' },
    ]);
  });

  test('b7-2-limit: a null verdict marks nothing, and nor does a null limits record', () => {
    const unjudged: LimitVerdicts = { brakeEnergy: null, mlgTire: null, nlgTire: null };
    assert.deepEqual(landingMarks(landingCell(ok(3000), ok(3000), unjudged), RUNWAY_FT, 23), []);
    const error = outOfChart('B7-2.sh1', 'gross_weight', 60000, [20000, 50000]);
    assert.deepEqual(landingMarks(landingCell(error, error, null), RUNWAY_FT, 23), []);
  });
});
