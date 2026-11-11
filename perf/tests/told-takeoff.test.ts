/**
 * The takeoff chain (`told/takeoff.ts`, TOLD 1.7 "Chains"), MIL and MAX AB: the rounding points, the manual's samples
 * through the chain, B2-4's wiring, the check distance rule, the CG range of B2-2, a negative exact drag index (Q1,
 * Review Focus 3), and B2-4's out-of-chart path. The conservative search is in told-takeoff-conservative.test.ts.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { evaluate, runExact } from '../src/core/ctx.ts';
import { panel } from '../src/core/data/panel.ts';
import { accelCheckSpeed } from '../src/core/figures/b2-4.ts';
import { curveFamily } from '../src/core/read/curve-family.ts';
import { guidelinePanel } from '../src/core/read/guideline-panel.ts';
import type { Read } from '../src/core/result.ts';
import { checkDistanceFor, TAKEOFF_FIELDS, TAKEOFF_KINDS, takeoffChain } from '../src/core/told/takeoff.ts';

import { exactOf } from './helpers/chain.ts';
import { loadFigure } from './helpers/data.ts';
import { at, BRANCH, factorId, MODES, OFF_STEP, SAMPLE, TAKEOFF_FIGURES } from './helpers/takeoff.ts';

const figures = TAKEOFF_FIGURES;
const b24 = loadFigure('B2-4');

function valueOf(read: Read<number>): number {
  assert.ok(read.ok, read.ok ? '' : JSON.stringify(read.error));
  return read.value;
}

/** Within `pct` % of `expected`. */
function within(actual: number, expected: number, pct: number, what: string): void {
  assert.ok(
    Math.abs(actual - expected) <= (expected * pct) / 100,
    `${what}: ${String(actual)} not within ${String(pct)} % of ${String(expected)}`,
  );
}

describe('takeoff chain', () => {
  test('TAKEOFF_FIELDS names the derived inputs the chain reads', () => {
    assert.deepEqual(
      [...TAKEOFF_FIELDS],
      ['paFt', 'tempC', 'takeoffGwLb', 'cgPct', 'headwindKt', 'slopePct', 'runwayFt', 'rcrDry', 'rcrWet'],
    );
  });

  test('rounding points pinned', () => {
    const mil = evaluate(takeoffChain(figures, SAMPLE, 'mil'), TAKEOFF_KINDS).roundingPoints;
    assert.deepEqual(mil, [
      'input.pa',
      'input.temp',
      'input.gw',
      'input.cg',
      'input.di',
      'input.wind',
      'input.slope',
      'input.rcr_dry',
      'input.rcr_wet',
      'b2-1.tofMil',
      'b2-1.tofAb',
      'b2-2.vto35',
      'b2-3.gw',
      'b2-3.cg',
      'b2-3.di',
      'b2-3.slope',
      'b2-3.wind',
      'b2-4.distance',
      'b2-4.gw',
      'b2-4.di',
      'b2-4.wind',
      'b2-4.slope',
      'b2-5.sh1.runway',
      'b2-5.sh1.wind',
      'b2-5.sh1.slope',
      'b2-5.dry',
      'b2-5.sh2.runway',
      'b2-5.sh2.wind',
      'b2-5.sh2.slope',
      'b2-5.wet',
    ]);
    const ab = evaluate(takeoffChain(figures, SAMPLE, 'ab'), TAKEOFF_KINDS).roundingPoints;
    assert.deepEqual(ab, [
      'input.pa',
      'input.temp',
      'input.gw',
      'input.cg',
      'input.di',
      'input.wind',
      'input.slope',
      'input.rcr_dry',
      'input.rcr_wet',
      'b2-1.tofMil',
      'b2-1.tofAb',
      'b2-2.vto35',
      'b2-3.gw',
      'b2-3.cg',
      'b2-3.di',
      'b2-3.slope',
      'b2-3.wind',
      'b2-4.distance',
      'b2-4.gw',
      'b2-4.di',
      'b2-4.wind',
      'b2-4.slope',
      'b2-6.sh1.runway',
      'b2-6.sh1.wind',
      'b2-6.sh1.slope',
      'b2-6.dry',
      'b2-6.sh2.runway',
      'b2-6.sh2.wind',
      'b2-6.sh2.slope',
      'b2-6.wet',
    ]);
  });

  test('samples through the chain within 2 %', () => {
    const mil = runExact(takeoffChain(figures, SAMPLE, 'mil')).run;
    const ab = runExact(takeoffChain(figures, SAMPLE, 'ab')).run;
    // B2-2 (p278): 168 KIAS takeoff, rotation 158 MIL, 153 AB.
    within(valueOf(mil.outputs.takeoffSpeed), 168, 2, 'MIL takeoff speed');
    within(valueOf(mil.outputs.rotation), 158, 2, 'MIL rotation');
    within(valueOf(ab.outputs.rotation), 153, 2, 'AB rotation');
    // B2-3 (p279): 4,243 ft MIL, 2,384 ft AB.
    within(valueOf(mil.outputs.distance), 4243, 2, 'MIL distance');
    within(valueOf(ab.outputs.distance), 2384, 2, 'AB distance');
    // B2-6 sheet 1 (p280): 153 KIAS dry, MAX AB, runway 6,000 ft.
    within(valueOf(ab.outputs.refusalDry), 153, 2, 'AB refusal dry');
    // B2-4's 129 KIAS is read at a 1,500 ft check distance, which the chain never picks (1,000 or 2,000 ft): the
    // sample's inputs do not fit the chain. The chain's own pick brackets it: 2,384 ft AB is under 2,500, so 1,000 ft.
    assert.deepEqual(ab.side, { checkDistanceFt: 1000 });
    assert.deepEqual(mil.side, { checkDistanceFt: 2000 });
    // The sample's 129 KIAS at 1,500 ft lies between B2-4's 1,000 ft and 2,000 ft reads at the same inputs.
    const b24At = (checkDistanceFt: number): number =>
      valueOf(
        exactOf((ctx) =>
          accelCheckSpeed(ctx, b24, {
            takeoffFactor: 1.85,
            checkDistanceFt,
            grossWeightLb: 33000,
            dragIndex: 150,
            headwindKt: 10,
            slopePct: 1,
          }),
        ).outputs.accelCheckKias,
      );
    assert.ok(b24At(1000) < 129 && 129 < b24At(2000), `${String(b24At(1000))} < 129 < ${String(b24At(2000))}`);
  });

  for (const mode of MODES) {
    test(`the chain's acceleration check is B2-4 at its own factor and check distance (${mode})`, () => {
      for (const values of [SAMPLE, OFF_STEP, BRANCH]) {
        const { run, trace } = runExact(takeoffChain(figures, values, mode));
        const factor = trace.find((t) => t.id === factorId(mode));
        assert.ok(factor !== undefined && run.side.checkDistanceFt !== null);
        const direct = exactOf((ctx) =>
          accelCheckSpeed(ctx, b24, {
            takeoffFactor: factor.value,
            checkDistanceFt: run.side.checkDistanceFt ?? NaN,
            grossWeightLb: values.grossWeightLb,
            dragIndex: values.dragIndex.exact,
            headwindKt: values.headwindKt,
            slopePct: values.slopePct,
          }),
        ).outputs.accelCheckKias;
        assert.equal(valueOf(run.outputs.accelCheck), valueOf(direct));
      }
    });
  }

  test('check distance: 1,000 ft under 2,500 ft of takeoff distance, 2,000 ft from 2,500 ft; none out of chart', () => {
    assert.equal(checkDistanceFor({ ok: true, value: 2499.99 }), 1000);
    assert.equal(checkDistanceFor({ ok: true, value: 2500 }), 2000);
    assert.equal(
      checkDistanceFor({
        ok: false,
        error: { kind: 'outOfChart', figure: 'B2-3', input: 'drag_index', value: -4, drawnRange: [0, 400] },
      }),
      null,
    );
  });

  test('CG 41: rotation and takeoff speed OutOfChart on B2-2 cg, the range B2-3 draws (30 to 40)', () => {
    for (const mode of MODES) {
      const { run, trace } = runExact(takeoffChain(figures, at({ cgPct: 41 }), mode));
      for (const k of ['rotation', 'takeoffSpeed'] as const) {
        const read = run.outputs[k];
        assert.ok(!read.ok);
        assert.equal(read.error.figure, 'B2-2');
        assert.equal(read.error.input, 'cg');
        assert.equal(read.error.value, 41);
        const range = read.error.drawnRange;
        assert.ok(range !== null && Math.abs(range[0] - 30) < 0.01 && Math.abs(range[1] - 40) < 0.01);
      }
      assert.ok(!trace.some((t) => t.id === 'b2-2.vto35'), 'B2-2 is not read with a CG outside its range');
    }
    // 40 itself is in range (the drawn end 39.99 keeps the data's edge tolerance).
    assert.ok(runExact(takeoffChain(figures, at({ cgPct: 40 }), 'mil')).run.outputs.rotation.ok);
  });

  test('negative exact drag index (Q1, Review Focus 3): clean, no tip missiles, DI -4 exact and 4 conservative', () => {
    const clean = at({ dragIndex: { exact: -4, conservative: 4 } });
    for (const mode of MODES) {
      const { cells } = evaluate(takeoffChain(figures, clean, mode), TAKEOFF_KINDS);
      for (const k of ['distance', 'accelCheck'] as const) {
        const exact = cells[k].exact;
        assert.ok(!exact.ok, `${k} exact`);
        assert.equal(exact.error.figure, 'B2-3');
        assert.equal(exact.error.input, 'drag_index');
        assert.equal(exact.error.value, -4);
        assert.ok(cells[k].conservative.ok, `${k} conservative computed`);
      }
      assert.equal(cells.accelCheck.exactSide.checkDistanceFt, null);
      assert.notEqual(cells.accelCheck.conservativeSide.checkDistanceFt, null);
      for (const k of ['rotation', 'takeoffSpeed', 'refusalDry', 'refusalWet'] as const) {
        assert.ok(cells[k].exact.ok && cells[k].conservative.ok, `${k} computed`);
      }
    }
  });
});

describe('B2-4 out of chart adds nothing (deferred minor)', () => {
  const base = {
    takeoffFactor: 1.85,
    checkDistanceFt: 1500,
    grossWeightLb: 33000,
    dragIndex: 150,
    headwindKt: 10,
    slopePct: 1,
  };

  test('a guideline panel out of chart is returned as the panel gives it', () => {
    const inWind = { ...base, headwindKt: 80 };
    const { outputs, trace } = exactOf((ctx) => accelCheckSpeed(ctx, b24, inWind));
    const entry = trace.find((t) => t.id === 'b2-4.di');
    assert.ok(entry !== undefined);
    const own = guidelinePanel(panel(b24, 'wind', 'guideline_panel'), 'B2-4', 'headwind', entry.value, 80);
    assert.ok(!own.ok);
    assert.deepEqual(outputs.accelCheckKias, own);
  });

  test('the first panel out of chart is returned as the panel gives it', () => {
    const { outputs } = exactOf((ctx) => accelCheckSpeed(ctx, b24, { ...base, checkDistanceFt: 12000 }));
    const own = curveFamily(panel(b24, 'distance', 'curve_family'), 'B2-4', 1.85, 12000);
    assert.ok(!own.ok);
    assert.deepEqual(outputs.accelCheckKias, own);
  });
});
