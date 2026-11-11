/**
 * The takeoff chain (`told/takeoff.ts`, TOLD 1.7 "Chains"), MIL and MAX AB: the rounding points, the manual's samples
 * through the chain, the conservative search against the exhaustive oracle (5.2), the check distance branch (Review
 * Focus 1), the CG range of B2-2, a negative exact drag index (Q1, Review Focus 3), and B2-4's out-of-chart path.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { evaluate, runExact, WORSE } from '../src/core/ctx.ts';
import type { Chain, Ctx } from '../src/core/ctx.ts';
import { panel } from '../src/core/data/panel.ts';
import { accelCheckSpeed } from '../src/core/figures/b2-4.ts';
import { curveFamily } from '../src/core/read/curve-family.ts';
import { guidelinePanel } from '../src/core/read/guideline-panel.ts';
import type { Read } from '../src/core/result.ts';
import { checkDistanceFor, TAKEOFF_FIELDS, TAKEOFF_KINDS, takeoffChain } from '../src/core/told/takeoff.ts';
import type { TakeoffKey, TakeoffSide, TakeoffValues } from '../src/core/told/takeoff.ts';

import { singlePointBound } from './helpers/bound.ts';
import { exactOf } from './helpers/chain.ts';
import { loadFigure, loadFigureSet } from './helpers/data.ts';
import { evaluateExhaustive } from './helpers/exhaustive.ts';

const figures = loadFigureSet([
  'B2-1',
  'B2-2',
  'B2-3',
  'B2-4',
  'B2-5.sh1',
  'B2-5.sh2',
  'B2-5.sh3',
  'B2-6.sh1',
  'B2-6.sh2',
  'B2-6.sh3',
]);
const MODES = ['mil', 'ab'] as const;
const KEYS = Object.keys(TAKEOFF_KINDS) as TakeoffKey[];

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

/**
 * The manual's takeoff sample (pp. 278 to 280): 2,000 ft, 40 °C (takeoff factor 3.16 MIL, 1.85 AB), 33,000 lb, CG 37,
 * DI 150, 10 kt headwind, 1 % uphill, a 6,000 ft runway; the RCRs are the defaults.
 */
const SAMPLE: TakeoffValues = {
  paFt: 2000,
  tempC: 40,
  grossWeightLb: 33000,
  cgPct: 37,
  dragIndex: { exact: 150, conservative: 150 },
  headwindKt: 10,
  slopePct: 1,
  runwayFt: 6000,
  rcrDry: 23,
  rcrWet: 18,
};
const at = (change: Partial<TakeoffValues>): TakeoffValues => ({ ...SAMPLE, ...change });

/**
 * MAX AB at 33,700 lb, the sample otherwise: exact takeoff distance 2,491.8 ft (check at 1,000 ft); a rounding step up
 * at any B2-3 panel crosses 2,500 ft (check at 2,000 ft). Found on the data.
 */
const BRANCH: Partial<TakeoffValues> = { grossWeightLb: 33700 };

/** Off every step: every input point is a rounding point that matters. */
const OFF_STEP = at({
  paFt: 2150,
  tempC: 31.4,
  grossWeightLb: 31240,
  cgPct: 36.3,
  dragIndex: { exact: 97.3, conservative: 97.3 },
  headwindKt: 7.6,
  slopePct: 0.83,
  runwayFt: 6800,
  rcrDry: 19.5,
  rcrWet: 14.3,
});

const INPUT_IDS = [
  'input.pa',
  'input.temp',
  'input.gw',
  'input.cg',
  'input.di',
  'input.wind',
  'input.slope',
  'input.rcr_dry',
  'input.rcr_wet',
];
const figureIds = (refusal: string): string[] => [
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
  `${refusal}.sh1.runway`,
  `${refusal}.sh1.wind`,
  `${refusal}.sh1.slope`,
  `${refusal}.dry`,
  `${refusal}.sh2.runway`,
  `${refusal}.sh2.wind`,
  `${refusal}.sh2.slope`,
  `${refusal}.wet`,
];

/**
 * The chain with every rounding point outside `keep` read unrounded and not passed to the search: a reduced chain over
 * the same code, small enough for the exhaustive oracle (2^n runs).
 */
function reduced(chain: Chain<TakeoffKey, TakeoffSide>, keep: readonly string[]): Chain<TakeoffKey, TakeoffSide> {
  return (ctx) => {
    const frozen: Ctx = {
      read: (id, value, step) => (keep.includes(id) ? ctx.read(id, value, step) : value),
      input: (id, value, step) => (keep.includes(id) ? ctx.input(id, value, step) : value.conservative),
    };
    return chain(frozen);
  };
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
    assert.deepEqual(mil, [...INPUT_IDS, ...figureIds('b2-5')]);
    assert.deepEqual(ab, [...INPUT_IDS, ...figureIds('b2-6')]);
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
  });

  for (const mode of MODES) {
    test(`conservative no better than exact for every output (${mode})`, () => {
      const { cells } = evaluate(takeoffChain(figures, OFF_STEP, mode), TAKEOFF_KINDS);
      for (const k of KEYS) {
        const exact = valueOf(cells[k].exact);
        const conservative = valueOf(cells[k].conservative);
        const worseOrEqual = WORSE[TAKEOFF_KINDS[k]] === 'higher' ? conservative >= exact : conservative <= exact;
        assert.ok(worseOrEqual, `${k}: conservative ${String(conservative)} better than exact ${String(exact)}`);
      }
    });
  }

  // The exhaustive oracle on the full chain is 2^30 runs; each reduced chain keeps one output group's own points.
  const GROUPS: readonly {
    name: string;
    values: TakeoffValues;
    keep: (refusal: string) => string[];
    keys: TakeoffKey[];
  }[] = [
    {
      name: 'distance and accelCheck (B2-1, B2-3, B2-4; sample inputs, on step)',
      values: SAMPLE,
      keep: () => [
        'b2-1.tofMil',
        'b2-1.tofAb',
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
      ],
      keys: ['distance', 'accelCheck'],
    },
    {
      name: 'refusal dry and wet (inputs off step, RCR between printed values)',
      values: OFF_STEP,
      keep: (r) => [
        'input.rcr_dry',
        'input.rcr_wet',
        'b2-1.tofMil',
        'b2-1.tofAb',
        `${r}.sh1.runway`,
        `${r}.sh1.wind`,
        `${r}.sh1.slope`,
        `${r}.dry`,
        `${r}.sh2.runway`,
        `${r}.sh2.wind`,
        `${r}.sh2.slope`,
        `${r}.wet`,
      ],
      keys: ['refusalDry', 'refusalWet'],
    },
    {
      name: 'rotation and takeoff speed (inputs off step)',
      values: OFF_STEP,
      keep: () => ['input.gw', 'input.cg', 'b2-2.vto35'],
      keys: ['rotation', 'takeoffSpeed'],
    },
  ];
  for (const mode of MODES) {
    for (const group of GROUPS) {
      test(`within the 5.2 criterion of the exhaustive search: ${group.name} (${mode})`, () => {
        const chain = reduced(takeoffChain(figures, group.values, mode), group.keep(mode === 'mil' ? 'b2-5' : 'b2-6'));
        const fast = evaluate(chain, TAKEOFF_KINDS);
        const oracle = evaluateExhaustive(chain, TAKEOFF_KINDS);
        for (const k of group.keys) {
          const gap = Math.abs(valueOf(fast.cells[k].conservative) - valueOf(oracle.cells[k].conservative));
          const bound = singlePointBound(chain, k, fast.roundingPoints);
          assert.ok(gap <= bound + 1e-9, `${k}: gap ${String(gap)} over the bound ${String(bound)}`);
        }
      });
    }
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

  test('check distance branch (Review Focus 1): exact just under 2,500 ft, the conservative run crosses it', () => {
    const values = at(BRANCH);
    const { cells } = evaluate(takeoffChain(figures, values, 'ab'), TAKEOFF_KINDS);
    const exactFt = valueOf(cells.distance.exact);
    assert.ok(exactFt < 2500 && exactFt > 2480, `exact distance ${String(exactFt)}`);
    assert.ok(valueOf(cells.distance.conservative) >= 2500);
    assert.equal(cells.accelCheck.exactSide.checkDistanceFt, 1000);
    assert.equal(cells.accelCheck.conservativeSide.checkDistanceFt, 2000);
    assert.ok(valueOf(cells.accelCheck.conservative) > valueOf(cells.accelCheck.exact));
    // The exhaustive oracle on the distance group's points takes the same branch.
    const keep = GROUPS[0]?.keep('b2-6') ?? assert.fail('no distance group');
    const oracle = evaluateExhaustive(reduced(takeoffChain(figures, values, 'ab'), keep), TAKEOFF_KINDS);
    assert.equal(oracle.cells.accelCheck.exactSide.checkDistanceFt, 1000);
    assert.equal(oracle.cells.accelCheck.conservativeSide.checkDistanceFt, 2000);
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
  const b24 = loadFigure('B2-4');
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
