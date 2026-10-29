/**
 * Figure B2-4, Acceleration Check Speed, on the extracted data: the rounding ids, interpolation between check
 * distances, the signed wind and slope, and OutOfChart at every drawn edge (rulings P9, P11).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { runExact } from '../src/core/ctx.ts';
import { accelCheckSpeed } from '../src/core/figures/b2-4.ts';
import type { Read } from '../src/core/result.ts';

import { loadFigure } from './helpers/data.ts';

const b24 = loadFigure('B2-4');

/** The value of an ok read; fails the test on an OutOfChart. */
function valueOf(read: Read<number>): number {
  assert.ok(read.ok, read.ok ? '' : JSON.stringify(read.error));
  return read.value;
}

/** Fails unless `read` is an OutOfChart of B2-4 on `input`. */
function assertOutOfChart(read: Read<number>, input: string): void {
  assert.ok(!read.ok, `expected OutOfChart on ${input}, got ${read.ok ? String(read.value) : ''}`);
  assert.equal(read.error.figure, 'B2-4');
  assert.equal(read.error.input, input);
}

/** A trace's value at `id`; fails when the trace has no such id. */
function traced(trace: readonly { id: string; value: number }[], id: string): number {
  const point = trace.find((t) => t.id === id);
  assert.ok(point !== undefined, `trace has no ${id}`);
  return point.value;
}

type AccelInputs = Parameters<typeof accelCheckSpeed>[2];

/** The manual's sample problem (p279-280): 129 KIAS. */
const SAMPLE: AccelInputs = {
  takeoffFactor: 1.85,
  checkDistanceFt: 1500,
  grossWeightLb: 33000,
  dragIndex: 150,
  headwindKt: 10,
  slopePct: 1,
};
const TRACE_IDS = ['b2-4.distance', 'b2-4.gw', 'b2-4.di', 'b2-4.wind', 'b2-4.slope'];

const accel = (i: AccelInputs) => runExact((ctx) => accelCheckSpeed(ctx, b24, i));
const kias = (i: AccelInputs): number => valueOf(accel(i).outputs.accelCheckKias);

describe('B2-4 acceleration check speed', () => {
  test('runExact on the sample yields the five panel ids in order', () => {
    const { outputs, trace } = accel(SAMPLE);
    assert.deepEqual(
      trace.map((t) => t.id),
      TRACE_IDS,
    );
    assert.equal(traced(trace, 'b2-4.slope'), valueOf(outputs.accelCheckKias));
  });

  test('a check distance of 1,750 ft reads between the 1,500 and 2,000 ft results', () => {
    const mid = kias({ ...SAMPLE, checkDistanceFt: 1750 });
    const low = kias({ ...SAMPLE, checkDistanceFt: 1500 });
    const high = kias({ ...SAMPLE, checkDistanceFt: 2000 });
    assert.ok(low < mid && mid < high, `${String(low)} < ${String(mid)} < ${String(high)}`);
  });

  test('a check distance under the first curve (500 ft) or over the last (11,000 ft) is OutOfChart on check_distance', () => {
    for (const checkDistanceFt of [400, 11500]) {
      const { outputs, trace } = accel({ ...SAMPLE, checkDistanceFt });
      assertOutOfChart(outputs.accelCheckKias, 'check_distance');
      assert.deepEqual(trace, []);
    }
  });

  test('the takeoff factor is read only where the curves are drawn: [1.09, 6.0], the 500 ft curve from 1.18 (ruling P11)', () => {
    assertOutOfChart(accel({ ...SAMPLE, takeoffFactor: 1.0 }).outputs.accelCheckKias, 'takeoff_factor');
    assertOutOfChart(accel({ ...SAMPLE, takeoffFactor: 6.1 }).outputs.accelCheckKias, 'takeoff_factor');
    const level = { ...SAMPLE, dragIndex: 0, headwindKt: 0, slopePct: 0 };
    valueOf(accel({ ...level, takeoffFactor: 1.12, checkDistanceFt: 1000 }).outputs.accelCheckKias);
    assertOutOfChart(
      accel({ ...level, takeoffFactor: 1.12, checkDistanceFt: 500 }).outputs.accelCheckKias,
      'takeoff_factor',
    );
  });

  test('wind 0 and slope 0 read their ids with the value unchanged', () => {
    const { outputs, trace } = accel({ ...SAMPLE, headwindKt: 0, slopePct: 0 });
    assert.deepEqual(
      trace.map((t) => t.id),
      TRACE_IDS,
    );
    const di = traced(trace, 'b2-4.di');
    assert.equal(traced(trace, 'b2-4.wind'), di);
    assert.equal(traced(trace, 'b2-4.slope'), di);
    assert.equal(valueOf(outputs.accelCheckKias), di);
  });

  test('a headwind or downhill raises the speed, a tailwind or uphill lowers it', () => {
    const level = { ...SAMPLE, headwindKt: 0, slopePct: 0 };
    const calm = kias(level);
    assert.ok(kias({ ...level, headwindKt: 10 }) > calm, '10 kt headwind');
    assert.ok(kias({ ...level, headwindKt: -10 }) < calm, '10 kt tailwind');
    assert.ok(kias({ ...level, slopePct: -1 }) > calm, '1 % downhill');
    assert.ok(kias({ ...level, slopePct: 1 }) < calm, '1 % uphill');
  });

  // Each value just past the panel's drawn range; the wind and slope ones are signed (a tailwind and a downhill
  // are negative), so "below" is beyond the drawn tailwind or downhill lines.
  const beyond: readonly { input: string; key: keyof AccelInputs; values: readonly number[]; ids: number }[] = [
    { input: 'gross_weight', key: 'grossWeightLb', values: [17000, 49000], ids: 1 },
    { input: 'drag_index', key: 'dragIndex', values: [-10, 310], ids: 2 },
    { input: 'wind', key: 'headwindKt', values: [-25, 45], ids: 3 },
    { input: 'slope', key: 'slopePct', values: [-3.5, 3.5], ids: 4 },
  ];
  for (const { input, key, values, ids } of beyond) {
    test(`${input} below and above its drawn range is OutOfChart on ${input} and stops the figure there`, () => {
      for (const value of values) {
        const { outputs, trace } = accel({ ...SAMPLE, [key]: value });
        assertOutOfChart(outputs.accelCheckKias, input);
        assert.deepEqual(
          trace.map((t) => t.id),
          TRACE_IDS.slice(0, ids),
        );
      }
    });
  }

  test('under 60 KIAS with a drag index is OutOfChart on the speed: the DI panel has no line below 60 kt (ruling P9)', () => {
    const slow = {
      takeoffFactor: 4,
      checkDistanceFt: 500,
      grossWeightLb: 43000,
      dragIndex: 0,
      headwindKt: 0,
      slopePct: 0,
    };
    const gw = traced(accel(slow).trace, 'b2-4.gw');
    assert.ok(gw < 60, `GW panel gives ${String(gw)} KIAS`);
    assert.equal(kias(slow), gw);
    const { outputs, trace } = accel({ ...slow, dragIndex: 50 });
    assertOutOfChart(outputs.accelCheckKias, 'accel_check_speed');
    assert.deepEqual(
      trace.map((t) => t.id),
      TRACE_IDS.slice(0, 2),
    );
  });
});
