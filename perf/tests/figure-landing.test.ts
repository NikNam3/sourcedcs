/**
 * Figures B7-1 (landing speed) and B7-2 sheets 1 and 2 (short field landing distance) on the extracted data: trace
 * ids, the carried line, the limit lines (ruling P7), the two RCR families (ruling P2) and every panel input's drawn
 * range.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { runExact } from '../src/core/ctx.ts';
import type { Ctx } from '../src/core/ctx.ts';
import { panel } from '../src/core/data/panel.ts';
import { landingSpeed } from '../src/core/figures/b7-1.ts';
import { groundRollCorrected, groundRollUncorrected } from '../src/core/figures/b7-2.ts';
import type { Read } from '../src/core/result.ts';

import { loadFigure } from './helpers/data.ts';

const b71 = loadFigure('B7-1');
const b72s1 = loadFigure('B7-2.sh1');
const b72s2 = loadFigure('B7-2.sh2');

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

describe('B7-1 landing speed', () => {
  const speeds = (grossWeightLb: number) => runExact((ctx) => landingSpeed(ctx, b71, { grossWeightLb }));

  test('reads b7-1.final then b7-1.touchdown', () => {
    const { outputs, trace } = speeds(20000);
    assert.deepEqual(
      trace.map((t) => t.id),
      ['b7-1.final', 'b7-1.touchdown'],
    );
    assert.equal(trace[0]?.value, valueOf(outputs.finalApproachKias));
    assert.equal(trace[1]?.value, valueOf(outputs.touchdownKias));
  });

  test("final approach is above touchdown at every 1,000 lb over the shorter curve's drawn range", () => {
    const final = panel(b71, 'final_approach', 'single_curve').points;
    const touchdown = panel(b71, 'touchdown', 'single_curve').points;
    const first = Math.max(final[0]?.[0] ?? NaN, touchdown[0]?.[0] ?? NaN);
    const last = Math.min(final.at(-1)?.[0] ?? NaN, touchdown.at(-1)?.[0] ?? NaN);
    let checked = 0;
    for (let gw = Math.ceil(first); gw <= Math.floor(last); gw++) {
      const { outputs } = speeds(gw * 1000);
      const above = valueOf(outputs.finalApproachKias) - valueOf(outputs.touchdownKias);
      assert.ok(above > 0, `GW ${String(gw)},000 lb: final approach ${String(above)} kt above touchdown`);
      checked++;
    }
    assert.equal(checked, 32, 'GW 17,000 to 48,000 lb');
  });

  test('GW below and above the drawn curves is OutOfChart on gross_weight for both and reads nothing', () => {
    for (const gw of [16000, 49000]) {
      const { outputs, trace } = speeds(gw);
      assertOutOfChart(outputs.finalApproachKias, 'B7-1', 'gross_weight');
      assertOutOfChart(outputs.touchdownKias, 'B7-1', 'gross_weight');
      assert.deepEqual(trace, []);
    }
  });
});

interface UncorrectedInputs {
  paFt: number;
  tempC: number;
  grossWeightLb: number;
}

const SH1_SAMPLE: UncorrectedInputs = { paFt: 2000, tempC: 40, grossWeightLb: 28000 };

/** The exact pass: every read exact. */
const exactCtx: Ctx = { read: (_id, value) => value };

/** The roll in runExact (its trace) and the exact pass's limit verdicts. */
const uncorrected = (i: UncorrectedInputs) => ({
  ...runExact((ctx) => ({ rollFt: groundRollUncorrected(ctx, b72s1, i).rollFt })),
  limits: groundRollUncorrected(exactCtx, b72s1, i).limits,
});

describe('B7-2 sheet 1 uncorrected ground roll', () => {
  test('reads only b7-2.sh1.roll: the carried line is not a rounding point', () => {
    const { outputs, trace } = uncorrected(SH1_SAMPLE);
    assert.deepEqual(
      trace.map((t) => t.id),
      ['b7-2.sh1.roll'],
    );
    assert.equal(trace[0]?.value, valueOf(outputs.rollFt));
  });

  test('the sample is below the brake energy line and left of both tire lines (ruling P7)', () => {
    assert.deepEqual(uncorrected(SH1_SAMPLE).limits, { brakeEnergy: false, mlgTire: null, nlgTire: null });
  });

  test('8,000 ft, 40 C, 46,000 lb is beyond all three lines', () => {
    const { outputs, limits } = uncorrected({ paFt: 8000, tempC: 40, grossWeightLb: 46000 });
    valueOf(outputs.rollFt);
    assert.deepEqual(limits, { brakeEnergy: true, mlgTire: true, nlgTire: true });
  });

  test('6,000 ft, 40 C, 44,000 lb is beyond the brake energy line only', () => {
    const { outputs, limits } = uncorrected({ paFt: 6000, tempC: 40, grossWeightLb: 44000 });
    valueOf(outputs.rollFt);
    assert.deepEqual(limits, { brakeEnergy: true, mlgTire: false, nlgTire: false });
  });

  test('the limits judge the roll the run reports, after ctx.read', () => {
    const fixed = (ft: number): Ctx => ({ read: () => ft });
    assert.equal(groundRollUncorrected(fixed(20000), b72s1, SH1_SAMPLE).limits?.brakeEnergy, true);
    assert.equal(groundRollUncorrected(fixed(1000), b72s1, SH1_SAMPLE).limits?.brakeEnergy, false);
  });

  test('a carried line the GW curves do not reach (8,000 ft, 50 C) is OutOfChart on temperature, no range', () => {
    const { outputs, trace, limits } = uncorrected({ paFt: 8000, tempC: 50, grossWeightLb: 46000 });
    assert.deepEqual(outputs.rollFt, {
      ok: false,
      error: { kind: 'outOfChart', figure: 'B7-2.sh1', input: 'temperature', value: 50, drawnRange: null },
    });
    assert.equal(limits, null);
    assert.deepEqual(trace, []);
  });

  test('temperature, altitude and GW below and above their drawn ranges are OutOfChart on that input', () => {
    const cases: [Partial<UncorrectedInputs>, string][] = [
      [{ tempC: -41 }, 'temperature'],
      [{ tempC: 51 }, 'temperature'],
      [{ paFt: -100 }, 'altitude'],
      [{ paFt: 8100 }, 'altitude'],
      [{ grossWeightLb: 19000 }, 'gross_weight'],
      [{ grossWeightLb: 49000 }, 'gross_weight'],
    ];
    for (const [change, input] of cases) {
      const { outputs, trace, limits } = uncorrected({ ...SH1_SAMPLE, ...change });
      assertOutOfChart(outputs.rollFt, 'B7-2.sh1', input);
      assert.equal(limits, null);
      assert.deepEqual(trace, []);
    }
  });

  test('the drawn ends read: 0 and 8,000 ft, -40 and 50 C, 20,000 and 48,000 lb', () => {
    valueOf(uncorrected({ paFt: 0, tempC: -40, grossWeightLb: 20000 }).outputs.rollFt);
    valueOf(uncorrected({ paFt: 8000, tempC: 40, grossWeightLb: 48000 }).outputs.rollFt);
    valueOf(uncorrected({ paFt: 0, tempC: 50, grossWeightLb: 48000 }).outputs.rollFt);
  });
});

interface CorrectedInputs {
  uncorrectedFt: number;
  rcr: number;
  wet: boolean;
  headwindKt: number;
  slopePct: number;
}

const SH2_SAMPLE: CorrectedInputs = { uncorrectedFt: 3902, rcr: 16, wet: false, headwindKt: 10, slopePct: 1 };
const CALM_LEVEL = { headwindKt: 0, slopePct: 0 };

const corrected = (i: CorrectedInputs) => runExact((ctx) => groundRollCorrected(ctx, b72s2, i));
const correctedFt = (i: CorrectedInputs): number => valueOf(corrected(i).outputs.rollFt);

describe('B7-2 sheet 2 corrected ground roll', () => {
  test('reads b7-2.sh2.rcr, b7-2.sh2.wind, b7-2.sh2.slope in order', () => {
    const { outputs, trace } = corrected(SH2_SAMPLE);
    assert.deepEqual(
      trace.map((t) => t.id),
      ['b7-2.sh2.rcr', 'b7-2.sh2.wind', 'b7-2.sh2.slope'],
    );
    assert.equal(trace[2]?.value, valueOf(outputs.rollFt));
  });

  test('zero wind and slope skip their panels but read their ids', () => {
    const { outputs, trace } = corrected({ ...SH2_SAMPLE, ...CALM_LEVEL });
    assert.deepEqual(
      trace.map((t) => t.id),
      ['b7-2.sh2.rcr', 'b7-2.sh2.wind', 'b7-2.sh2.slope'],
    );
    const rcr = trace[0]?.value;
    assert.equal(trace[1]?.value, rcr);
    assert.equal(valueOf(outputs.rollFt), rcr);
  });

  test('RCR 23 is the identity line', () => {
    assert.ok(Math.abs(correctedFt({ ...SH2_SAMPLE, rcr: 23, ...CALM_LEVEL }) - 3902) < 10);
  });

  test('an RCR between two printed curves interpolates linearly within its family', () => {
    const at = (rcr: number, wet: boolean) => correctedFt({ ...SH2_SAMPLE, rcr, wet, ...CALM_LEVEL });
    const dry12 = at(12, false);
    const [dry8, dry16] = [at(8, false), at(16, false)];
    assert.ok(
      dry12 < dry8 && dry12 > dry16,
      `dry RCR 12 ${String(dry12)} between ${String(dry8)} and ${String(dry16)}`,
    );
    assert.ok(Math.abs(dry12 - (dry8 + dry16) / 2) < 1e-9);
    const wet15 = at(15, true);
    const [wet12, wet18] = [at(12, true), at(18, true)];
    assert.ok(
      wet15 < wet12 && wet15 > wet18,
      `wet RCR 15 ${String(wet15)} between ${String(wet12)} and ${String(wet18)}`,
    );
    assert.ok(Math.abs(wet15 - (wet12 + wet18) / 2) < 1e-9);
  });

  test('the wet flag picks the family: RCR 12 wet is not RCR 12 dry', () => {
    const dry = correctedFt({ ...SH2_SAMPLE, rcr: 12, wet: false, ...CALM_LEVEL });
    const wet = correctedFt({ ...SH2_SAMPLE, rcr: 12, wet: true, ...CALM_LEVEL });
    assert.ok(Math.abs(dry - wet) > 100, `dry ${String(dry)}, wet ${String(wet)}`);
  });

  test('an RCR outside the chosen family is OutOfChart on rcr: dry 4-23, wet 10-18', () => {
    for (const [rcr, wet] of [
      [3, false],
      [24, false],
      [9, true],
      [19, true],
      [23, true],
      [4, true],
    ] as const) {
      const { outputs, trace } = corrected({ ...SH2_SAMPLE, rcr, wet });
      assertOutOfChart(outputs.rollFt, 'B7-2.sh2', 'rcr');
      assert.deepEqual(trace, []);
    }
  });

  test('an uncorrected roll below and above the drawn curves is OutOfChart on uncorrected_roll', () => {
    for (const [uncorrectedFt, rcr, wet] of [
      [-100, 16, false],
      [12100, 16, false],
      [5000, 4, false],
      [100, 18, true],
      [7000, 18, true],
    ] as const) {
      const { outputs, trace } = corrected({ ...SH2_SAMPLE, uncorrectedFt, rcr, wet });
      assertOutOfChart(outputs.rollFt, 'B7-2.sh2', 'uncorrected_roll');
      assert.deepEqual(trace, []);
    }
  });

  test('a headwind shortens and a tailwind lengthens; uphill shortens and downhill lengthens', () => {
    const calm = correctedFt({ ...SH2_SAMPLE, ...CALM_LEVEL });
    assert.ok(correctedFt({ ...SH2_SAMPLE, ...CALM_LEVEL, headwindKt: 10 }) < calm, '10 kt headwind');
    assert.ok(correctedFt({ ...SH2_SAMPLE, ...CALM_LEVEL, headwindKt: -10 }) > calm, '10 kt tailwind');
    assert.ok(correctedFt({ ...SH2_SAMPLE, ...CALM_LEVEL, slopePct: 1 }) < calm, '1 % uphill');
    assert.ok(correctedFt({ ...SH2_SAMPLE, ...CALM_LEVEL, slopePct: -1 }) > calm, '1 % downhill');
  });

  test('wind and slope beyond their drawn lines either way are OutOfChart on that input', () => {
    const cases: [Partial<CorrectedInputs>, string, string[]][] = [
      [{ headwindKt: 41 }, 'wind', ['b7-2.sh2.rcr']],
      [{ headwindKt: -41 }, 'wind', ['b7-2.sh2.rcr']],
      [{ slopePct: 3.1 }, 'slope', ['b7-2.sh2.rcr', 'b7-2.sh2.wind']],
      [{ slopePct: -3.1 }, 'slope', ['b7-2.sh2.rcr', 'b7-2.sh2.wind']],
    ];
    for (const [change, input, ids] of cases) {
      const { outputs, trace } = corrected({ ...SH2_SAMPLE, ...change });
      assertOutOfChart(outputs.rollFt, 'B7-2.sh2', input);
      assert.deepEqual(
        trace.map((t) => t.id),
        ids,
      );
    }
  });

  test('40 kt either way and 3 % either way read', () => {
    for (const change of [{ headwindKt: 40 }, { headwindKt: -40 }, { slopePct: 3 }, { slopePct: -3 }]) {
      valueOf(corrected({ ...SH2_SAMPLE, ...change }).outputs.rollFt);
    }
  });
});
