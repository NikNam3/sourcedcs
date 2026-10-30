/**
 * The refusal speed charts on the extracted data: B2-5 (non-AB) and B2-6 (AB) sheets 1 to 3 through the shared
 * reader `refusalSpeed`. Trace ids, the printed RCR decrements, tailwind and downhill (Review Focus 1), the icy GW curves that
 * meet and cross (Review Focus 2, ruling P10), a carried line the runway lines do not draw (Review Focus 3), and the
 * drawn ranges of every pilot input (ruling P11).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { evaluate, runExact } from '../src/core/ctx.ts';
import { refusalNonAbDry, refusalNonAbSnowIcy, refusalNonAbWet } from '../src/core/figures/b2-5.ts';
import { refusalAbDry, refusalAbSnowIcy, refusalAbWet } from '../src/core/figures/b2-6.ts';
import type { RefusalInputs } from '../src/core/figures/refusal-speed.ts';
import { curveFamily } from '../src/core/read/curve-family.ts';
import { panel } from '../src/core/data/panel.ts';
import type { Read } from '../src/core/result.ts';

import { loadFigure } from './helpers/data.ts';

const sh1 = loadFigure('B2-5.sh1');
const sh2 = loadFigure('B2-5.sh2');
const sh3 = loadFigure('B2-5.sh3');

/** The value of an ok read; fails the test on an OutOfChart. */
function valueOf(read: Read<number>): number {
  assert.ok(read.ok, read.ok ? '' : JSON.stringify(read.error));
  return read.value;
}

/** Fails unless `read` is an OutOfChart of `figure` on `input`; returns its drawn range. */
function assertOutOfChart(read: Read<number>, figure: string, input: string): readonly [number, number] | null {
  assert.ok(!read.ok, `expected OutOfChart on ${input}, got ${read.ok ? String(read.value) : ''}`);
  assert.equal(read.error.figure, figure);
  assert.equal(read.error.input, input);
  return read.error.drawnRange;
}

/** A mid-chart entry on every sheet: calm, level. */
const BASE: RefusalInputs = { takeoffFactor: 4, grossWeightLb: 32000, runwayFt: 8000, headwindKt: 0, slopePct: 0 };
const at = (change: Partial<RefusalInputs>): RefusalInputs => ({ ...BASE, ...change });

const dry = (i: RefusalInputs) => runExact((ctx) => refusalNonAbDry(ctx, sh1, i));
const wet = (i: RefusalInputs) => runExact((ctx) => refusalNonAbWet(ctx, sh2, i));
const snowIcy = (i: RefusalInputs) => runExact((ctx) => refusalNonAbSnowIcy(ctx, sh3, i));

/**
 * Each sheet's first output (the one the chart draws), for the tests that hold on every sheet. `midTof` enters the
 * wind panel (runway 8,000 ft, GW 32,000 lb) where both wind families draw to their ends: between 60 and 140 KIAS,
 * and on sheet 3 above 80 KIAS, since its tailwind line from 60 KIAS stops at 19.81 kt.
 */
const SHEETS = [
  { name: 'sheet 1 (RCR 23)', figure: 'B2-5.sh1', midTof: 5, speed: (i: RefusalInputs) => dry(i).outputs.rcr23Kias },
  { name: 'sheet 2 (RCR 18)', figure: 'B2-5.sh2', midTof: 5, speed: (i: RefusalInputs) => wet(i).outputs.rcr18Kias },
  {
    name: 'sheet 3 snow (RCR 8)',
    figure: 'B2-5.sh3',
    midTof: 5,
    speed: (i: RefusalInputs) => snowIcy(i).outputs.rcr8Kias,
  },
  {
    name: 'sheet 3 icy (RCR 4)',
    figure: 'B2-5.sh3',
    midTof: 3,
    speed: (i: RefusalInputs) => snowIcy(i).outputs.rcr4Kias,
  },
] as const;

describe('B2-5 refusal speed (non-AB)', () => {
  test('each sheet reads runway, wind and slope, in that order; sheet 3 the snow set then the icy set', () => {
    const windy = at({ headwindKt: 10, slopePct: 1 });
    assert.deepEqual(
      dry(windy).trace.map((t) => t.id),
      ['b2-5.sh1.runway', 'b2-5.sh1.wind', 'b2-5.sh1.slope'],
    );
    assert.deepEqual(
      wet(windy).trace.map((t) => t.id),
      ['b2-5.sh2.runway', 'b2-5.sh2.wind', 'b2-5.sh2.slope'],
    );
    assert.deepEqual(
      snowIcy(windy).trace.map((t) => t.id),
      [
        'b2-5.sh3.snow.runway',
        'b2-5.sh3.snow.wind',
        'b2-5.sh3.snow.slope',
        'b2-5.sh3.icy.runway',
        'b2-5.sh3.icy.wind',
        'b2-5.sh3.icy.slope',
      ],
    );
  });

  test('calm and level skip the wind and slope panels but read their ids: the speed is the runway reading', () => {
    const { outputs, trace } = dry(BASE);
    assert.deepEqual(
      trace.map((t) => t.id),
      ['b2-5.sh1.runway', 'b2-5.sh1.wind', 'b2-5.sh1.slope'],
    );
    const runway = trace[0]?.value;
    assert.ok(runway !== undefined);
    assert.ok(trace.every((t) => t.value === runway));
    assert.equal(valueOf(outputs.rcr23Kias), runway);
  });

  test('the printed decrements: RCR 16 is RCR 23 - 4 and RCR 12 is RCR 18 - 9 KIAS (corrections, not reads)', () => {
    const d = dry(at({ headwindKt: 10, slopePct: 1 }));
    assert.equal(valueOf(d.outputs.rcr16Kias), valueOf(d.outputs.rcr23Kias) - 4);
    assert.equal(d.trace.length, 3);
    const w = wet(at({ headwindKt: -10, slopePct: -1 }));
    assert.equal(valueOf(w.outputs.rcr12Kias), valueOf(w.outputs.rcr18Kias) - 9);
    assert.equal(w.trace.length, 3);
  });

  test('an OutOfChart RCR 23 or 18 reading is the RCR 16 or 12 value too', () => {
    const d = dry(at({ runwayFt: 1000 }));
    assert.deepEqual(d.outputs.rcr16Kias, d.outputs.rcr23Kias);
    const w = wet(at({ runwayFt: 1000 }));
    assert.deepEqual(w.outputs.rcr12Kias, w.outputs.rcr18Kias);
  });

  for (const sheet of SHEETS) {
    test(`${sheet.name}: a 10 kt tailwind and a 1 % downhill each lower the speed; headwind and uphill raise it (Review Focus 1)`, () => {
      const calm = valueOf(sheet.speed(BASE));
      assert.ok(valueOf(sheet.speed(at({ headwindKt: -10 }))) < calm, 'tailwind');
      assert.ok(valueOf(sheet.speed(at({ slopePct: -1 }))) < calm, 'downhill');
      assert.ok(valueOf(sheet.speed(at({ headwindKt: 10 }))) > calm, 'headwind');
      assert.ok(valueOf(sheet.speed(at({ slopePct: 1 }))) > calm, 'uphill');
    });

    test(`${sheet.name}: a longer runway and a lighter aircraft give a higher speed`, () => {
      const base = valueOf(sheet.speed(at({ takeoffFactor: 3 })));
      assert.ok(valueOf(sheet.speed(at({ takeoffFactor: 3, runwayFt: 10000 }))) > base, 'runway');
      if (sheet.name !== 'sheet 3 icy (RCR 4)') {
        assert.ok(valueOf(sheet.speed(at({ takeoffFactor: 3, grossWeightLb: 24000 }))) > base, 'gross weight');
      }
    });

    test(`${sheet.name}: takeoff factor, wind and slope outside their drawn ranges are OutOfChart naming them`, () => {
      const lowTof = assertOutOfChart(sheet.speed(at({ takeoffFactor: 2.05 })), sheet.figure, 'takeoff_factor');
      assertOutOfChart(sheet.speed(at({ takeoffFactor: 6.85 })), sheet.figure, 'takeoff_factor');
      assert.ok(lowTof !== null && lowTof[0] > 2.09 && lowTof[0] < 2.11 && lowTof[1] > 6.77 && lowTof[1] < 6.79);
      assertOutOfChart(sheet.speed(at({ headwindKt: -25 })), sheet.figure, 'wind');
      assertOutOfChart(sheet.speed(at({ headwindKt: 45 })), sheet.figure, 'wind');
      assertOutOfChart(sheet.speed(at({ slopePct: -3.5 })), sheet.figure, 'slope');
      assertOutOfChart(sheet.speed(at({ slopePct: 3.5 })), sheet.figure, 'slope');
      assertOutOfChart(sheet.speed(at({ grossWeightLb: 17000 })), sheet.figure, 'gross_weight');
      assertOutOfChart(sheet.speed(at({ grossWeightLb: 49000 })), sheet.figure, 'gross_weight');
    });

    test(`${sheet.name}: a 20 kt tailwind, 40 kt headwind and 3 % either way read (the lines' drawn ends)`, () => {
      for (const change of [{ headwindKt: -20 }, { headwindKt: 40 }, { slopePct: -3 }, { slopePct: 3 }]) {
        valueOf(sheet.speed(at({ takeoffFactor: sheet.midTof, ...change })));
      }
    });
  }

  test('takeoff factor 2.11 and 6.77 read on every sheet: the GW curves are drawn over [2.10, 6.78] (ruling P11)', () => {
    for (const sheet of SHEETS) {
      valueOf(sheet.speed(at({ takeoffFactor: 2.11, runwayFt: 3000 })));
      valueOf(sheet.speed(at({ takeoffFactor: 6.77, runwayFt: 10000 })));
    }
  });

  test('runway 1,000 ft and 25,000 ft are OutOfChart on runway_length', () => {
    for (const sheet of SHEETS) {
      const range = assertOutOfChart(sheet.speed(at({ runwayFt: 1000 })), sheet.figure, 'runway_length');
      assertOutOfChart(sheet.speed(at({ runwayFt: 25000 })), sheet.figure, 'runway_length');
      assert.ok(range !== null);
    }
    assert.deepEqual(
      assertOutOfChart(dry(at({ runwayFt: 1000 })).outputs.rcr23Kias, 'B2-5.sh1', 'runway_length'),
      [2000, 20000],
    );
    assert.deepEqual(
      assertOutOfChart(snowIcy(at({ runwayFt: 2000 })).outputs.rcr4Kias, 'B2-5.sh3', 'runway_length'),
      [3000, 18000],
    );
  });

  test('a carried line the runway lines do not draw is OutOfChart on gross_weight with no drawn range (Review Focus 3)', () => {
    // GW 18,000 lb at takeoff factor 3 carries to about 200 pt; the 20,000 ft line leaves the top of the chart at
    // 127.6 pt (refusal speed over 200 KIAS).
    const { outputs, trace } = dry(at({ takeoffFactor: 3, grossWeightLb: 18000, runwayFt: 20000 }));
    assert.equal(assertOutOfChart(outputs.rcr23Kias, 'B2-5.sh1', 'gross_weight'), null);
    assert.ok(!outputs.rcr23Kias.ok && outputs.rcr23Kias.error.value === 18);
    assert.deepEqual(trace, []);
    // the same takeoff factor and GW on a 6,000 ft runway reads
    valueOf(dry(at({ takeoffFactor: 3, grossWeightLb: 18000, runwayFt: 6000 })).outputs.rcr23Kias);
    // and the other side: a heavy GW at a high takeoff factor carries left of where the snow chart's 2,000 ft line
    // starts on the bottom frame (72.8 pt; refusal speed under 40 KIAS)
    const { outputs: snow } = snowIcy(at({ takeoffFactor: 6.7, grossWeightLb: 48000, runwayFt: 2000 }));
    assert.equal(assertOutOfChart(snow.rcr8Kias, 'B2-5.sh3', 'gross_weight'), null);
  });

  test('a runway reading outside the wind lines is OutOfChart on refusal_speed (ruling P15)', () => {
    // headwind lines start at 40 to 180 KIAS on the baseline; this runway reading is over 180
    const entry = dry(at({ takeoffFactor: 2.2, grossWeightLb: 18000, runwayFt: 7000 }));
    assert.ok(valueOf(entry.outputs.rcr23Kias) > 181);
    assertOutOfChart(
      dry(at({ takeoffFactor: 2.2, grossWeightLb: 18000, runwayFt: 7000, headwindKt: 10 })).outputs.rcr23Kias,
      'B2-5.sh1',
      'refusal_speed',
    );
  });
});

describe('B2-5 sheet 3 icy: the 18/20 and 48 GW curves (Review Focus 2, rulings P5, P10)', () => {
  const icy = (i: RefusalInputs): number => valueOf(snowIcy(i).outputs.rcr4Kias);

  test('GW 18,000 and 48,000 lb both read, below and above the crossing at takeoff factor 4.38', () => {
    for (const takeoffFactor of [2.5, 3, 4, 5, 6]) {
      icy(at({ takeoffFactor, grossWeightLb: 18000, runwayFt: 12000 }));
      icy(at({ takeoffFactor, grossWeightLb: 48000, runwayFt: 12000 }));
    }
  });

  test('below the crossing 48,000 lb reads lower than 18,000 lb; above it, higher (the manual, p280)', () => {
    const light = at({ takeoffFactor: 3, grossWeightLb: 18000, runwayFt: 12000 });
    const heavy = at({ takeoffFactor: 3, grossWeightLb: 48000, runwayFt: 12000 });
    assert.ok(icy(heavy) < icy(light));
    assert.ok(icy({ ...heavy, takeoffFactor: 6 }) > icy({ ...light, takeoffFactor: 6 }));
  });

  test('18,000, 19,000 and 20,000 lb read the one 18/20 curve: two curves with identical points', () => {
    const gw = panel(sh3, 'gw_icy', 'curve_family');
    assert.deepEqual(
      gw.curves.map((c) => c.param),
      [18, 20, 48],
    );
    assert.deepEqual(gw.curves[0]?.points, gw.curves[1]?.points);
    for (const takeoffFactor of [2.5, 4.38, 6]) {
      const carry18 = valueOf(curveFamily(gw, sh3.id, takeoffFactor, 18));
      assert.equal(valueOf(curveFamily(gw, sh3.id, takeoffFactor, 19)), carry18);
      assert.equal(valueOf(curveFamily(gw, sh3.id, takeoffFactor, 20)), carry18);
    }
    const speed = icy(at({ takeoffFactor: 3, grossWeightLb: 18000, runwayFt: 12000 }));
    for (const grossWeightLb of [19000, 20000]) {
      assert.equal(icy(at({ takeoffFactor: 3, grossWeightLb, runwayFt: 12000 })), speed);
    }
  });

  test('the snow and icy charts read their own panels: the icy speed is the lower one', () => {
    const { outputs } = snowIcy(BASE);
    assert.ok(valueOf(outputs.rcr4Kias) < valueOf(outputs.rcr8Kias));
  });
});

test('B2-5 conservative refusal speed is never above the exact one', () => {
  const evaluation = evaluate(
    (ctx) => refusalNonAbDry(ctx, sh1, at({ takeoffFactor: 3.37, headwindKt: 7, slopePct: 0.6 })),
    {
      rcr23Kias: 'refusalSpeed',
      rcr16Kias: 'refusalSpeed',
    },
  );
  for (const cell of Object.values(evaluation.cells)) {
    assert.ok(valueOf(cell.conservative) <= valueOf(cell.exact));
  }
  assert.deepEqual(evaluation.roundingPoints, ['b2-5.sh1.runway', 'b2-5.sh1.wind', 'b2-5.sh1.slope']);
});

const ab1 = loadFigure('B2-6.sh1');
const ab2 = loadFigure('B2-6.sh2');
const ab3 = loadFigure('B2-6.sh3');

/** A mid-chart entry on every B2-6 sheet (AB takeoff factors run 1.0 to 4.0): calm, level. */
const AB_BASE: RefusalInputs = { takeoffFactor: 2.5, grossWeightLb: 32000, runwayFt: 8000, headwindKt: 0, slopePct: 0 };
const abAt = (change: Partial<RefusalInputs>): RefusalInputs => ({ ...AB_BASE, ...change });

const abDry = (i: RefusalInputs) => runExact((ctx) => refusalAbDry(ctx, ab1, i));
const abWet = (i: RefusalInputs) => runExact((ctx) => refusalAbWet(ctx, ab2, i));
const abSnowIcy = (i: RefusalInputs) => runExact((ctx) => refusalAbSnowIcy(ctx, ab3, i));

/**
 * Each B2-6 chart's first output. `midTof` enters the wind panel (runway 8,000 ft, GW 32,000 lb) where both wind
 * families draw to their ends: between 80 and 140 KIAS. `heavierFaster`: on the icy chart a heavier aircraft carries
 * further right at every takeoff factor, so its refusal speed is higher (the manual, p280).
 */
const AB_SHEETS = [
  {
    name: 'sheet 1 (RCR 23)',
    figure: 'B2-6.sh1',
    midTof: 3.5,
    heavierFaster: false,
    speed: (i: RefusalInputs) => abDry(i).outputs.rcr23Kias,
  },
  {
    name: 'sheet 2 (RCR 18)',
    figure: 'B2-6.sh2',
    midTof: 2.5,
    heavierFaster: false,
    speed: (i: RefusalInputs) => abWet(i).outputs.rcr18Kias,
  },
  {
    name: 'sheet 3 snow (RCR 8)',
    figure: 'B2-6.sh3',
    midTof: 2.5,
    heavierFaster: false,
    speed: (i: RefusalInputs) => abSnowIcy(i).outputs.rcr8Kias,
  },
  {
    name: 'sheet 3 icy (RCR 4)',
    figure: 'B2-6.sh3',
    midTof: 1.5,
    heavierFaster: true,
    speed: (i: RefusalInputs) => abSnowIcy(i).outputs.rcr4Kias,
  },
] as const;

describe('B2-6 refusal speed (AB)', () => {
  test('each sheet reads runway, wind and slope, in that order; sheet 3 the snow set then the icy set', () => {
    const windy = abAt({ headwindKt: 10, slopePct: 1 });
    assert.deepEqual(
      abDry(windy).trace.map((t) => t.id),
      ['b2-6.sh1.runway', 'b2-6.sh1.wind', 'b2-6.sh1.slope'],
    );
    assert.deepEqual(
      abWet(windy).trace.map((t) => t.id),
      ['b2-6.sh2.runway', 'b2-6.sh2.wind', 'b2-6.sh2.slope'],
    );
    assert.deepEqual(
      abSnowIcy(windy).trace.map((t) => t.id),
      [
        'b2-6.sh3.snow.runway',
        'b2-6.sh3.snow.wind',
        'b2-6.sh3.snow.slope',
        'b2-6.sh3.icy.runway',
        'b2-6.sh3.icy.wind',
        'b2-6.sh3.icy.slope',
      ],
    );
  });

  test('calm and level skip the wind and slope panels but read their ids: the speed is the runway reading', () => {
    const { outputs, trace } = abDry(AB_BASE);
    assert.deepEqual(
      trace.map((t) => t.id),
      ['b2-6.sh1.runway', 'b2-6.sh1.wind', 'b2-6.sh1.slope'],
    );
    const runway = trace[0]?.value;
    assert.ok(runway !== undefined);
    assert.ok(trace.every((t) => t.value === runway));
    assert.equal(valueOf(outputs.rcr23Kias), runway);
  });

  test('the printed decrements: RCR 16 is RCR 23 - 5 and RCR 12 is RCR 18 - 10 KIAS (corrections, not reads)', () => {
    const d = abDry(abAt({ headwindKt: 10, slopePct: 1 }));
    assert.equal(valueOf(d.outputs.rcr16Kias), valueOf(d.outputs.rcr23Kias) - 5);
    assert.equal(d.trace.length, 3);
    const w = abWet(abAt({ headwindKt: -10, slopePct: -1 }));
    assert.equal(valueOf(w.outputs.rcr12Kias), valueOf(w.outputs.rcr18Kias) - 10);
    assert.equal(w.trace.length, 3);
  });

  test('an OutOfChart RCR 23 or 18 reading is the RCR 16 or 12 value too', () => {
    const d = abDry(abAt({ runwayFt: 1000 }));
    assert.deepEqual(d.outputs.rcr16Kias, d.outputs.rcr23Kias);
    const w = abWet(abAt({ runwayFt: 1000 }));
    assert.deepEqual(w.outputs.rcr12Kias, w.outputs.rcr18Kias);
  });

  test("sheet 1's sample problem (p280): 153 KIAS within 1 %", () => {
    const sample = { takeoffFactor: 1.85, grossWeightLb: 33000, runwayFt: 6000, headwindKt: 10, slopePct: 1 };
    assert.ok(Math.abs(valueOf(abDry(sample).outputs.rcr23Kias) - 153) <= 1.53);
  });

  for (const sheet of AB_SHEETS) {
    test(`${sheet.name}: a 10 kt tailwind and a 1 % downhill each lower the speed; headwind and uphill raise it (Review Focus 1)`, () => {
      const calm = valueOf(sheet.speed(AB_BASE));
      assert.ok(valueOf(sheet.speed(abAt({ headwindKt: -10 }))) < calm, 'tailwind');
      assert.ok(valueOf(sheet.speed(abAt({ slopePct: -1 }))) < calm, 'downhill');
      assert.ok(valueOf(sheet.speed(abAt({ headwindKt: 10 }))) > calm, 'headwind');
      assert.ok(valueOf(sheet.speed(abAt({ slopePct: 1 }))) > calm, 'uphill');
    });

    test(`${sheet.name}: a longer runway gives a higher speed; a lighter aircraft ${sheet.heavierFaster ? 'a lower' : 'a higher'} one`, () => {
      const base = valueOf(sheet.speed(AB_BASE));
      assert.ok(valueOf(sheet.speed(abAt({ runwayFt: 10000 }))) > base, 'runway');
      const lighter = valueOf(sheet.speed(abAt({ grossWeightLb: 24000 })));
      assert.ok(sheet.heavierFaster ? lighter < base : lighter > base, 'gross weight');
    });

    test(`${sheet.name}: takeoff factor, GW, wind and slope outside their drawn ranges are OutOfChart naming them`, () => {
      const lowTof = assertOutOfChart(sheet.speed(abAt({ takeoffFactor: 1.15 })), sheet.figure, 'takeoff_factor');
      assertOutOfChart(sheet.speed(abAt({ takeoffFactor: 3.92 })), sheet.figure, 'takeoff_factor');
      assert.ok(lowTof !== null && lowTof[0] > 1.19 && lowTof[0] < 1.2 && lowTof[1] > 3.86 && lowTof[1] < 3.87);
      assertOutOfChart(sheet.speed(abAt({ headwindKt: -25 })), sheet.figure, 'wind');
      assertOutOfChart(sheet.speed(abAt({ headwindKt: 45 })), sheet.figure, 'wind');
      assertOutOfChart(sheet.speed(abAt({ slopePct: -3.5 })), sheet.figure, 'slope');
      assertOutOfChart(sheet.speed(abAt({ slopePct: 3.5 })), sheet.figure, 'slope');
      assertOutOfChart(sheet.speed(abAt({ grossWeightLb: 17000 })), sheet.figure, 'gross_weight');
      assertOutOfChart(sheet.speed(abAt({ grossWeightLb: 49000 })), sheet.figure, 'gross_weight');
    });

    test(`${sheet.name}: a 20 kt tailwind, 40 kt headwind and 3 % either way read (the lines' drawn ends)`, () => {
      for (const change of [{ headwindKt: -20 }, { headwindKt: 40 }, { slopePct: -3 }, { slopePct: 3 }]) {
        valueOf(sheet.speed(abAt({ takeoffFactor: sheet.midTof, ...change })));
      }
    });
  }

  test('takeoff factor 1.20 and 3.86 read on every sheet: the GW curves are drawn over [1.196, 3.866] (ruling P11)', () => {
    for (const sheet of AB_SHEETS) {
      valueOf(sheet.speed(abAt({ takeoffFactor: 1.2, runwayFt: 3000 })));
      valueOf(sheet.speed(abAt({ takeoffFactor: 3.86 })));
    }
  });

  test('runway 1,000 ft and 25,000 ft are OutOfChart on runway_length', () => {
    for (const sheet of AB_SHEETS) {
      assert.ok(assertOutOfChart(sheet.speed(abAt({ runwayFt: 1000 })), sheet.figure, 'runway_length') !== null);
      assertOutOfChart(sheet.speed(abAt({ runwayFt: 25000 })), sheet.figure, 'runway_length');
    }
    assert.deepEqual(
      assertOutOfChart(abDry(abAt({ runwayFt: 1000 })).outputs.rcr23Kias, 'B2-6.sh1', 'runway_length'),
      [2000, 20000],
    );
    assert.deepEqual(
      assertOutOfChart(abSnowIcy(abAt({ runwayFt: 2000 })).outputs.rcr4Kias, 'B2-6.sh3', 'runway_length'),
      [3000, 18000],
    );
  });

  test('a carried line the runway lines do not draw is OutOfChart on gross_weight with no drawn range (Review Focus 3)', () => {
    // GW 18,000 lb at takeoff factor 2 carries to about 185 pt; the 20,000 ft line leaves the top of the chart at
    // 128.0 pt (refusal speed over 200 KIAS).
    const { outputs, trace } = abDry(abAt({ takeoffFactor: 2, grossWeightLb: 18000, runwayFt: 20000 }));
    assert.equal(assertOutOfChart(outputs.rcr23Kias, 'B2-6.sh1', 'gross_weight'), null);
    assert.ok(!outputs.rcr23Kias.ok && outputs.rcr23Kias.error.value === 18);
    assert.deepEqual(trace, []);
    // the same takeoff factor and GW on a 6,000 ft runway reads
    valueOf(abDry(abAt({ takeoffFactor: 2, grossWeightLb: 18000, runwayFt: 6000 })).outputs.rcr23Kias);
    // the bottom side (refusal speed under 40 KIAS): the snow 2,000 ft line starts on the bottom frame at 82.8 pt,
    // the icy 3,000 ft line at 268.3 pt, and these GWs carry left of them
    const { outputs: low } = abSnowIcy(abAt({ takeoffFactor: 3.8, grossWeightLb: 18000, runwayFt: 2000 }));
    assert.equal(assertOutOfChart(low.rcr8Kias, 'B2-6.sh3', 'gross_weight'), null);
    const { outputs: icy } = abSnowIcy(abAt({ takeoffFactor: 2, grossWeightLb: 18000, runwayFt: 3000 }));
    assert.equal(assertOutOfChart(icy.rcr4Kias, 'B2-6.sh3', 'gross_weight'), null);
  });

  test('a runway reading outside the wind lines is OutOfChart on refusal_speed (ruling P15)', () => {
    // headwind lines start at 40 to 180 KIAS on the baseline; this runway reading is over 180
    assert.ok(valueOf(abDry(abAt({ takeoffFactor: 1.2 })).outputs.rcr23Kias) > 181);
    assertOutOfChart(
      abDry(abAt({ takeoffFactor: 1.2, headwindKt: 10 })).outputs.rcr23Kias,
      'B2-6.sh1',
      'refusal_speed',
    );
  });

  test('sheet 1: GW 18,000 and 20,000 lb end at one point, takeoff factor 1.20; both read there, as one', () => {
    const light = valueOf(abDry(abAt({ takeoffFactor: 1.2, grossWeightLb: 18000, runwayFt: 3000 })).outputs.rcr23Kias);
    const next = valueOf(abDry(abAt({ takeoffFactor: 1.2, grossWeightLb: 20000, runwayFt: 3000 })).outputs.rcr23Kias);
    assert.ok(Math.abs(light - next) < 0.5);
  });
});

describe('B2-6 sheet 3: GW curves that cross and reverse (Review Focus 2, ruling P10)', () => {
  const snow = (i: RefusalInputs): number => valueOf(abSnowIcy(i).outputs.rcr8Kias);
  const icy = (i: RefusalInputs): number => valueOf(abSnowIcy(i).outputs.rcr4Kias);
  const light = (takeoffFactor: number) => abAt({ takeoffFactor, grossWeightLb: 18000, runwayFt: 10000 });
  const heavy = (takeoffFactor: number) => abAt({ takeoffFactor, grossWeightLb: 48000, runwayFt: 10000 });

  test('snow: GW 18,000 and 48,000 lb both read; below the crossing at takeoff factor 3.54 48,000 lb reads lower, above it higher', () => {
    for (const takeoffFactor of [1.5, 2.5, 3]) assert.ok(snow(heavy(takeoffFactor)) < snow(light(takeoffFactor)));
    assert.ok(snow(heavy(3.8)) > snow(light(3.8)));
  });

  test('icy: GW 18,000 and 48,000 lb both read, and 48,000 lb reads higher at every takeoff factor', () => {
    for (const takeoffFactor of [1.2, 1.5, 2.5, 3.5, 3.86]) {
      assert.ok(icy(heavy(takeoffFactor)) > icy(light(takeoffFactor)));
    }
  });

  test('icy: the GW curves are 18, 20, 24 and 48, heavier further right', () => {
    const gw = panel(ab3, 'gw_icy', 'curve_family');
    assert.deepEqual(
      gw.curves.map((c) => c.param),
      [18, 20, 24, 48],
    );
    const carries = [18, 20, 24, 48].map((g) => valueOf(curveFamily(gw, ab3.id, 2.5, g)));
    assert.deepEqual(
      carries,
      [...carries].sort((a, b) => a - b),
    );
  });

  test('the snow and icy charts read their own panels: the icy speed is the lower one', () => {
    const { outputs } = abSnowIcy(AB_BASE);
    assert.ok(valueOf(outputs.rcr4Kias) < valueOf(outputs.rcr8Kias));
  });
});

test('B2-6 conservative refusal speed is never above the exact one', () => {
  const evaluation = evaluate(
    (ctx) => refusalAbDry(ctx, ab1, abAt({ takeoffFactor: 2.37, headwindKt: 7, slopePct: 0.6 })),
    {
      rcr23Kias: 'refusalSpeed',
      rcr16Kias: 'refusalSpeed',
    },
  );
  for (const cell of Object.values(evaluation.cells)) {
    assert.ok(valueOf(cell.conservative) <= valueOf(cell.exact));
  }
  assert.deepEqual(evaluation.roundingPoints, ['b2-6.sh1.runway', 'b2-6.sh1.wind', 'b2-6.sh1.slope']);
});
