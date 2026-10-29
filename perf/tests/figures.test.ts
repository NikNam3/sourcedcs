/**
 * Figures B2-1 to B2-3 on the extracted data: ranges, edges, corrections, trace ids, and the conservative value of
 * B2-3 against the exhaustive oracle (spec 5.2, ruling R10).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { evaluate, roundTo, runExact, STEPS } from '../src/core/ctx.ts';
import type { Chain } from '../src/core/ctx.ts';
import { takeoffFactor } from '../src/core/figures/b2-1.ts';
import { takeoffSpeed } from '../src/core/figures/b2-2.ts';
import { takeoffDistance } from '../src/core/figures/b2-3.ts';
import type { Read } from '../src/core/result.ts';

import { planCtx, singlePointBound } from './helpers/bound.ts';
import { loadFigure } from './helpers/data.ts';
import { evaluateExhaustive } from './helpers/exhaustive.ts';

const b21 = loadFigure('B2-1');
const b22 = loadFigure('B2-2');
const b23 = loadFigure('B2-3');

/** The value of an ok read; fails the test on an OutOfChart. */
function valueOf(read: Read<number>): number {
  assert.ok(read.ok, read.ok ? '' : JSON.stringify(read.error));
  return read.value;
}

/** Fails unless `read` is an OutOfChart of `figure` on `input`. */
function assertOutOfChart(read: Read<number>, figure: string, input: string): void {
  assert.ok(!read.ok, `expected OutOfChart on ${input}, got ${read.ok ? String(read.value) : ''}`);
  assert.equal(read.error.figure, figure);
  assert.equal(read.error.input, input);
}

/** A trace's value at `id`; fails when the trace has no such id. */
function traced(trace: readonly { id: string; value: number }[], id: string): number {
  const point = trace.find((t) => t.id === id);
  assert.ok(point !== undefined, `trace has no ${id}`);
  return point.value;
}

const tof = (tempC: number, paFt: number) => runExact((ctx) => takeoffFactor(ctx, b21, { tempC, paFt }));

describe('B2-1 takeoff factor', () => {
  test('reads tofMil then tofAb', () => {
    const { outputs, trace } = tof(40, 2000);
    assert.deepEqual(
      trace.map((t) => t.id),
      ['b2-1.tofMil', 'b2-1.tofAb'],
    );
    assert.equal(traced(trace, 'b2-1.tofMil'), valueOf(outputs.tofMil));
    assert.equal(traced(trace, 'b2-1.tofAb'), valueOf(outputs.tofAb));
  });

  test('PA -1,000 ft at -10 C reads between the -2,000 ft and sea level values', () => {
    const mid = tof(-10, -1000).outputs;
    const low = tof(-10, -2000).outputs;
    const high = tof(-10, 0).outputs;
    for (const key of ['tofMil', 'tofAb'] as const) {
      const value = valueOf(mid[key]);
      assert.ok(value > valueOf(low[key]) && value < valueOf(high[key]), `${key} ${String(value)}`);
    }
  });

  test('PA 10,000 ft reads; PA 10,100 ft is OutOfChart on pressure_altitude for both outputs', () => {
    valueOf(tof(20, 10000).outputs.tofMil);
    const { outputs, trace } = tof(20, 10100);
    assertOutOfChart(outputs.tofMil, 'B2-1', 'pressure_altitude');
    assertOutOfChart(outputs.tofAb, 'B2-1', 'pressure_altitude');
    assert.deepEqual(trace, []);
  });

  test('-40 C reads (the curves start at -39.9996, ruling R1); -41 C is OutOfChart on temperature', () => {
    valueOf(tof(-40, 0).outputs.tofMil);
    assertOutOfChart(tof(-41, 0).outputs.tofMil, 'B2-1', 'temperature');
  });

  test('tofAb is OutOfChart beyond the drawn AB scale while tofMil reads (ruling R2)', () => {
    const { outputs, trace } = tof(50, 10000);
    assert.ok(valueOf(outputs.tofMil) > 6.8);
    assertOutOfChart(outputs.tofAb, 'B2-1', 'tof_ab');
    assert.deepEqual(
      trace.map((t) => t.id),
      ['b2-1.tofMil'],
    );
  });

  test('tofAb comes from the unrounded MIL reading', () => {
    const exact = tof(40, 2000).outputs;
    const rounded = takeoffFactor(planCtx(new Map([['b2-1.tofMil', 'up']])), b21, { tempC: 40, paFt: 2000 });
    assert.equal(valueOf(rounded.tofMil), roundTo(valueOf(exact.tofMil), STEPS.takeoffFactor, 'up'));
    assert.equal(valueOf(rounded.tofAb), valueOf(exact.tofAb));
  });
});

describe('B2-2 takeoff speed', () => {
  const speed = (grossWeightLb: number, cgPct: number, pitch8: boolean) =>
    runExact((ctx) => takeoffSpeed(ctx, b22, { grossWeightLb, cgPct, pitch8 }));

  test('reads vto35 once; the corrections are exact', () => {
    const { outputs, trace } = speed(33000, 37, false);
    assert.deepEqual(
      trace.map((t) => t.id),
      ['b2-2.vto35'],
    );
    const vto35 = valueOf(outputs.vto35Kias);
    const vto = vto35 - 0.8 * 2;
    assert.equal(valueOf(outputs.vtoKias), vto);
    assert.equal(valueOf(outputs.vrMilKias), vto - 10);
    assert.equal(valueOf(outputs.vrAbKias), vto - 15);
  });

  test('8 deg pitch multiplies the CG-corrected speed by 1.08 before the rotation decrements', () => {
    const level = speed(33000, 37, false).outputs;
    const { outputs, trace } = speed(33000, 37, true);
    assert.equal(trace.length, 1);
    assert.equal(valueOf(outputs.vto35Kias), valueOf(level.vto35Kias));
    const vto = valueOf(level.vtoKias) * 1.08;
    assert.equal(valueOf(outputs.vtoKias), vto);
    assert.equal(valueOf(outputs.vrMilKias), vto - 10);
    assert.equal(valueOf(outputs.vrAbKias), vto - 15);
  });

  test('the corrections start from the rounded vto35', () => {
    const exact = valueOf(speed(33000, 37, false).outputs.vto35Kias);
    const up = takeoffSpeed(planCtx(new Map([['b2-2.vto35', 'up']])), b22, {
      grossWeightLb: 33000,
      cgPct: 37,
      pitch8: false,
    });
    assert.equal(valueOf(up.vto35Kias), roundTo(exact, STEPS.speedKt, 'up'));
    assert.equal(valueOf(up.vtoKias), roundTo(exact, STEPS.speedKt, 'up') - 1.6);
  });

  test('GW 50,000 lb is OutOfChart on gross_weight for every output', () => {
    const { outputs, trace } = speed(50000, 35, false);
    for (const read of Object.values(outputs)) assertOutOfChart(read, 'B2-2', 'gross_weight');
    assert.deepEqual(trace, []);
  });
});

interface DistanceInputs {
  takeoffFactor: number;
  grossWeightLb: number;
  cgPct: number;
  dragIndex: number;
  slopePct: number;
  headwindKt: number;
  pitch8: boolean;
}

const MIL_SAMPLE: DistanceInputs = {
  takeoffFactor: 3.16,
  grossWeightLb: 33000,
  cgPct: 37,
  dragIndex: 150,
  slopePct: 1,
  headwindKt: 10,
  pitch8: false,
};
const BASELINES = { cgPct: 35, dragIndex: 0, slopePct: 0, headwindKt: 0, pitch8: false };
const TRACE_IDS = ['b2-3.gw', 'b2-3.cg', 'b2-3.di', 'b2-3.slope', 'b2-3.wind'];

const distance = (i: DistanceInputs) => runExact((ctx) => takeoffDistance(ctx, b23, i));
const distanceFt = (i: DistanceInputs): number => valueOf(distance(i).outputs.distanceFt);

describe('B2-3 takeoff distance', () => {
  test('runExact on the MIL sample yields the five panel ids in order', () => {
    const { outputs, trace } = distance(MIL_SAMPLE);
    assert.deepEqual(
      trace.map((t) => t.id),
      TRACE_IDS,
    );
    assert.equal(traced(trace, 'b2-3.wind'), valueOf(outputs.distanceFt));
  });

  test('zero slope and zero wind skip their panels but read their ids: the distance is the b2-3.di value', () => {
    const { outputs, trace } = distance({ ...MIL_SAMPLE, slopePct: 0, headwindKt: 0 });
    assert.deepEqual(
      trace.map((t) => t.id),
      TRACE_IDS,
    );
    const di = traced(trace, 'b2-3.di');
    assert.equal(traced(trace, 'b2-3.slope'), di);
    assert.equal(valueOf(outputs.distanceFt), di);
  });

  test('DI 0 and CG 35 leave the GW panel distance unchanged', () => {
    const { trace } = distance({ ...MIL_SAMPLE, dragIndex: 0, cgPct: 35 });
    const gw = traced(trace, 'b2-3.gw');
    assert.equal(traced(trace, 'b2-3.cg'), gw);
    assert.equal(traced(trace, 'b2-3.di'), gw);
  });

  test('a tailwind lengthens and a headwind shortens; downhill shortens and uphill lengthens', () => {
    const level = { ...MIL_SAMPLE, slopePct: 0, headwindKt: 0 };
    const calm = distanceFt(level);
    assert.ok(distanceFt({ ...level, headwindKt: -5 }) > calm, '5 kt tailwind');
    assert.ok(distanceFt({ ...level, headwindKt: 5 }) < calm, '5 kt headwind');
    assert.ok(distanceFt({ ...level, slopePct: -1 }) < calm, '1 % downhill');
    assert.ok(distanceFt({ ...level, slopePct: 1 }) > calm, '1 % uphill');
  });

  test('8 deg pitch multiplies the final distance by 1.18 and reads no further id', () => {
    const level = distance(MIL_SAMPLE);
    const { outputs, trace } = distance({ ...MIL_SAMPLE, pitch8: true });
    assert.deepEqual(trace, level.trace);
    assert.equal(valueOf(outputs.distanceFt), valueOf(level.outputs.distanceFt) * 1.18);
  });

  test('GW 52,000 lb is OutOfChart on gross_weight and reads nothing', () => {
    const { outputs, trace } = distance({ ...MIL_SAMPLE, grossWeightLb: 52000 });
    assertOutOfChart(outputs.distanceFt, 'B2-3', 'gross_weight');
    assert.deepEqual(trace, []);
  });

  test('TOF 7.00 with GW 20,000 lb reads (the curves end at 6.9996, ruling R1); TOF 7.1 does not', () => {
    valueOf(distance({ takeoffFactor: 7, grossWeightLb: 20000, ...BASELINES }).outputs.distanceFt);
    assertOutOfChart(
      distance({ takeoffFactor: 7.1, grossWeightLb: 20000, ...BASELINES }).outputs.distanceFt,
      'B2-3',
      'takeoff_factor',
    );
  });

  test('under 1,000 ft is OutOfChart at the next panel that moves it (ruling R11)', () => {
    const short = { takeoffFactor: 1, grossWeightLb: 20000, ...BASELINES };
    const gw = traced(distance(short).trace, 'b2-3.gw');
    assert.ok(gw < 1000, `GW panel gives ${String(gw)} ft`);
    // No panel moves it: the GW panel's distance stands.
    assert.equal(distanceFt(short), gw);
    // The CG panel moves it.
    const cg = distance({ ...short, cgPct: 37 });
    assertOutOfChart(cg.outputs.distanceFt, 'B2-3', 'distance');
    assert.deepEqual(
      cg.trace.map((t) => t.id),
      ['b2-3.gw'],
    );
    // CG at its baseline: the DI panel is the next that moves it.
    const di = distance({ ...short, dragIndex: 50 });
    assertOutOfChart(di.outputs.distanceFt, 'B2-3', 'distance');
    assert.deepEqual(
      di.trace.map((t) => t.id),
      ['b2-3.gw', 'b2-3.cg'],
    );
  });

  test('a later panel out of chart stops the figure there: a 15 kt tailwind past the 10,000 ft line', () => {
    const long = { takeoffFactor: 4.6, grossWeightLb: 40000, ...BASELINES };
    const calm = traced(distance(long).trace, 'b2-3.slope');
    assert.ok(calm > 10000 && calm < 11000, `calm distance ${String(calm)} ft`);
    const { outputs, trace } = distance({ ...long, headwindKt: -15 });
    assertOutOfChart(outputs.distanceFt, 'B2-3', 'distance');
    assert.deepEqual(
      trace.map((t) => t.id),
      TRACE_IDS.slice(0, 4),
    );
  });
});

// --- Oracle agreement on real data (spec 5.2, ruling R10) ---

/** mulberry32: a small seeded PRNG, so the 50 input sets are the same on every run. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type OracleSet = Omit<DistanceInputs, 'pitch8'>;

/** B2-3 with its six inputs read as rounding points, as a takeoff chain reads them. */
function distanceChain(set: OracleSet): Chain<'distanceFt'> {
  return (ctx) =>
    takeoffDistance(ctx, b23, {
      takeoffFactor: ctx.read('input.takeoffFactor', set.takeoffFactor, STEPS.takeoffFactor),
      grossWeightLb: ctx.read('input.grossWeightLb', set.grossWeightLb, STEPS.grossWeightLb),
      cgPct: ctx.read('input.cgPct', set.cgPct, STEPS.cgPct),
      dragIndex: ctx.read('input.dragIndex', set.dragIndex, STEPS.dragIndex),
      slopePct: ctx.read('input.slopePct', set.slopePct, STEPS.slopePct),
      headwindKt: ctx.read('input.headwindKt', set.headwindKt, STEPS.windKt),
      pitch8: false,
    });
}

const SETS = 50;
const MAX_ATTEMPTS = 2000;

test('B2-3 conservative distance: never shorter than exact, within the single-point bound of the exhaustive one', (t) => {
  const random = prng(0x0b23);
  const between = (lo: number, hi: number): number => lo + random() * (hi - lo);
  const seen = { slope: new Set<number>(), wind: new Set<number>() };
  let largest = { gap: 0, bound: 0, set: undefined as OracleSet | undefined };
  let maxRatio = 0;
  let positiveGaps = 0;
  let errored = 0;
  const bounds: number[] = [];
  let sets = 0;
  let attempts = 0;
  for (; sets < SETS; attempts++) {
    assert.ok(attempts < MAX_ATTEMPTS, `only ${String(sets)} sets with an ok exact distance in ${String(attempts)}`);
    const set: OracleSet = {
      takeoffFactor: between(1, 5),
      grossWeightLb: between(20000, 40000),
      cgPct: between(30, 40),
      dragIndex: between(0, 300),
      slopePct: random() < 0.2 ? 0 : between(-2, 2),
      headwindKt: random() < 0.2 ? 0 : between(-20, 40),
    };
    const chain = distanceChain(set);
    const exact = runExact(chain);
    if (!exact.outputs.distanceFt.ok) continue;
    sets++;
    seen.slope.add(Math.sign(set.slopePct));
    seen.wind.add(Math.sign(set.headwindKt));

    const conservative = evaluate(chain, { distanceFt: 'distance' }).cells.distanceFt.conservative;
    const exhaustive = evaluateExhaustive(chain, { distanceFt: 'distance' }).cells.distanceFt.conservative;
    const where = JSON.stringify(set);
    if (!conservative.ok || !exhaustive.ok) {
      assert.ok(!conservative.ok && !exhaustive.ok, `one search errored and the other did not: ${where}`);
      assert.equal(conservative.error.kind, exhaustive.error.kind);
      assert.equal(conservative.error.figure, exhaustive.error.figure, where);
      assert.equal(conservative.error.input, exhaustive.error.input, where);
      errored++;
      continue;
    }
    const exactFt = exact.outputs.distanceFt.value;
    assert.ok(conservative.value >= exactFt, `conservative ${String(conservative.value)} < exact ${String(exactFt)}`);
    const gap = Math.abs(exhaustive.value - conservative.value);
    const bound = singlePointBound(
      chain,
      'distanceFt',
      exact.trace.map((p) => p.id),
    );
    assert.ok(gap <= bound + 1e-9, `gap ${String(gap)} ft over the bound ${String(bound)} ft: ${where}`);
    bounds.push(bound);
    if (gap > 0) positiveGaps++;
    if (bound > 0) maxRatio = Math.max(maxRatio, gap / bound);
    if (gap > largest.gap) largest = { gap, bound, set };
  }
  assert.deepEqual(
    [...seen.slope].sort((a, b) => a - b),
    [-1, 0, 1],
    'both slope signs and zero',
  );
  assert.deepEqual(
    [...seen.wind].sort((a, b) => a - b),
    [-1, 0, 1],
    'both wind signs and zero',
  );
  bounds.sort((a, b) => a - b);
  const ratio = largest.bound > 0 ? largest.gap / largest.bound : 0;
  t.diagnostic(
    `${String(sets)} sets in ${String(attempts)} attempts: ${String(errored)} out of chart in both searches, ` +
      `${String(positiveGaps)} with a gap to the exhaustive value`,
  );
  t.diagnostic(
    `largest gap ${largest.gap.toFixed(3)} ft, its bound ${largest.bound.toFixed(3)} ft, ratio ${ratio.toFixed(4)}` +
      (largest.set === undefined ? '' : `: ${JSON.stringify(largest.set)}`),
  );
  t.diagnostic(`largest ratio of gap to bound ${maxRatio.toFixed(4)}`);
  t.diagnostic(
    `bound (ft): min ${(bounds[0] ?? NaN).toFixed(1)}, median ${(bounds[bounds.length >> 1] ?? NaN).toFixed(1)}, ` +
      `max ${(bounds[bounds.length - 1] ?? NaN).toFixed(1)}`,
  );
  // The B2-3 regression check for the direction choice: evaluate must equal evaluateExhaustive on every set. The
  // bound check alone would pass a wrong final-run direction, since cellOf also takes the worst single-point run.
  // B2-3 qualifies because each of its readings is monotone in entry and target, so the per-point directions combined
  // are the maximum over all combinations. A legitimate future gap needs a spec 5.2 decision, not a looser test.
  assert.equal(positiveGaps, 0, 'evaluate and evaluateExhaustive differ on B2-3');
});
