/**
 * The landing chain (TOLD 1.7, chains): B7-1, B7-2 sheet 1 and sheet 2 behind the rounded inputs, dry and wet, with
 * sheet 1's limit verdicts as side data per run (ruling 2). Checked against the manual's samples and the exhaustive
 * oracle.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { evaluate, runExact } from '../src/core/ctx.ts';
import type { FigureSet } from '../src/core/data/figure-set.ts';
import type { Read } from '../src/core/result.ts';
import { LANDING_FIELDS, LANDING_KINDS, landingChain } from '../src/core/told/landing.ts';
import type { LandingKey, LandingValues } from '../src/core/told/landing.ts';

import { singlePointBound } from './helpers/bound.ts';
import { loadFigure } from './helpers/data.ts';
import { evaluateExhaustive } from './helpers/exhaustive.ts';

const FIGURES: FigureSet = Object.freeze({
  'B7-1': loadFigure('B7-1'),
  'B7-2.sh1': loadFigure('B7-2.sh1'),
  'B7-2.sh2': loadFigure('B7-2.sh2'),
});

const KEYS = Object.keys(LANDING_KINDS) as LandingKey[];

/** The value of an ok read; fails the test on an OutOfChart. */
function valueOf(read: Read<number>): number {
  assert.ok(read.ok, read.ok ? '' : JSON.stringify(read.error));
  return read.value;
}

function within2Pct(actual: number, expected: number, what: string): void {
  assert.ok(Math.abs(actual - expected) <= 0.02 * expected, `${what}: ${String(actual)}, expected ${String(expected)}`);
}

/** Sheet 1's and sheet 2's samples (2,000 ft, 40 C, 28,000 lb; RCR 16 dry, 10 kt headwind, 1 % uphill). */
const SAMPLE: LandingValues = { paFt: 2000, tempC: 40, grossWeightLb: 28000, headwindKt: 10, slopePct: 1, rcr: 16 };

const ROUNDING_POINTS = [
  'input.pa',
  'input.temp',
  'input.gw',
  'input.rcr',
  'input.wind',
  'input.slope',
  'b7-1.final',
  'b7-1.touchdown',
  'b7-2.sh1.roll',
  'b7-2.sh2.rcr',
  'b7-2.sh2.wind',
  'b7-2.sh2.slope',
];

describe('landing chain', () => {
  test('LANDING_KINDS: two speeds and a distance', () => {
    assert.deepEqual(LANDING_KINDS, { finalApproach: 'speed', touchdown: 'speed', distance: 'distance' });
  });

  test('LANDING_FIELDS: normal reads landing GW, heavy takeoff GW; dry and wet their own RCR', () => {
    const common = ['paFt', 'tempC', 'headwindKt', 'slopePct', 'runwayFt'];
    for (const [weight, gw] of [
      ['normal', 'landingGwLb'],
      ['heavy', 'takeoffGwLb'],
    ] as const) {
      for (const [surface, rcr] of [
        ['dry', 'rcrDry'],
        ['wet', 'rcrWet'],
      ] as const) {
        assert.deepEqual(
          [...LANDING_FIELDS[weight][surface]].sort(),
          [...common, gw, rcr].sort(),
          `${weight} ${surface}`,
        );
      }
    }
  });

  test('rounding points pinned, dry and wet', () => {
    for (const surface of ['dry', 'wet'] as const) {
      const values = surface === 'dry' ? SAMPLE : { ...SAMPLE, rcr: 12 };
      const { roundingPoints } = evaluate(landingChain(FIGURES, values, surface), LANDING_KINDS);
      assert.deepEqual(roundingPoints, ROUNDING_POINTS, surface);
    }
  });

  test('a figure missing from the set throws when the chain is built', () => {
    const rest = Object.fromEntries(Object.entries(FIGURES).filter(([id]) => id !== 'B7-2.sh2'));
    assert.throws(() => landingChain(rest, SAMPLE, 'dry'), /no figure "B7-2.sh2"/);
  });

  test('samples through the chain: B7-1 136 / 125 KIAS at 20,000 lb, B7-2 3,375 ft (RCR 16, dry), within 2 %', () => {
    const speeds = evaluate(landingChain(FIGURES, { ...SAMPLE, grossWeightLb: 20000 }, 'dry'), LANDING_KINDS).cells;
    within2Pct(valueOf(speeds.finalApproach.exact), 136, 'final approach');
    within2Pct(valueOf(speeds.touchdown.exact), 125, 'touchdown');
    const roll = evaluate(landingChain(FIGURES, SAMPLE, 'dry'), LANDING_KINDS).cells.distance;
    within2Pct(valueOf(roll.exact), 3375, 'distance');
    assert.ok(valueOf(roll.conservative) >= valueOf(roll.exact));
  });

  test('the wet chain reads the wet family: RCR 12 wet is longer than RCR 12 dry', () => {
    const at = (surface: 'dry' | 'wet') =>
      valueOf(evaluate(landingChain(FIGURES, { ...SAMPLE, rcr: 12 }, surface), LANDING_KINDS).cells.distance.exact);
    assert.ok(Math.abs(at('wet') - at('dry')) > 100, `dry ${String(at('dry'))}, wet ${String(at('wet'))}`);
  });

  test('wet RCR 9: distance OutOfChart on rcr (wet family 10 to 18), the speeds still computed', () => {
    const { cells } = evaluate(landingChain(FIGURES, { ...SAMPLE, rcr: 9 }, 'wet'), LANDING_KINDS);
    for (const read of [cells.distance.exact, cells.distance.conservative]) {
      assert.ok(!read.ok);
      assert.equal(read.error.figure, 'B7-2.sh2');
      assert.equal(read.error.input, 'rcr');
    }
    valueOf(cells.finalApproach.conservative);
    valueOf(cells.touchdown.conservative);
  });

  test('an uncorrected roll out of chart stops the distance and gives no limits', () => {
    const { cells } = evaluate(landingChain(FIGURES, { ...SAMPLE, paFt: 8000, tempC: 50 }, 'dry'), LANDING_KINDS);
    assert.ok(!cells.distance.exact.ok);
    assert.equal(cells.distance.exact.error.figure, 'B7-2.sh1');
    assert.equal(cells.distance.exactSide.limits, null);
  });
});

/** Input sets off every step, one with a headwind and uphill, one with a tailwind and downhill. */
const ORACLE_SETS: readonly { name: string; values: LandingValues; wetRcr: number }[] = [
  {
    name: 'A',
    values: { paFt: 2340, tempC: 31.6, grossWeightLb: 28370, headwindKt: 7.4, slopePct: 0.63, rcr: 16.4 },
    wetRcr: 14.3,
  },
  {
    name: 'B',
    values: { paFt: 5210, tempC: 12.3, grossWeightLb: 35480, headwindKt: -4.6, slopePct: -0.84, rcr: 19.5 },
    wetRcr: 16.5,
  },
];

/** Which outputs equal the exhaustive oracle exactly, per surface and set; the others meet the 5.2 criterion. */
const ORACLE_EQUAL: Readonly<Record<string, readonly LandingKey[]>> = {
  'dry A': ['finalApproach', 'touchdown', 'distance'],
  'wet A': ['finalApproach', 'touchdown', 'distance'],
  'dry B': ['finalApproach', 'touchdown', 'distance'],
  'wet B': ['finalApproach', 'touchdown', 'distance'],
};

describe('landing chain against the exhaustive oracle', () => {
  for (const surface of ['dry', 'wet'] as const) {
    for (const set of ORACLE_SETS) {
      const label = `${surface} ${set.name}`;
      const equal = ORACLE_EQUAL[label] ?? [];
      const within = KEYS.filter((k) => !equal.includes(k));
      const list = (keys: readonly LandingKey[]): string => (keys.length === 0 ? 'none' : keys.join(', '));
      test(`${label}: ${list(equal)} equal the oracle; ${list(within)} within 5.2`, () => {
        const values = surface === 'dry' ? set.values : { ...set.values, rcr: set.wetRcr };
        const chain = landingChain(FIGURES, values, surface);
        const ours = evaluate(chain, LANDING_KINDS).cells;
        const oracle = evaluateExhaustive(chain, LANDING_KINDS).cells;
        const ids = runExact(chain).trace.map((t) => t.id);
        for (const k of KEYS) {
          const mine = valueOf(ours[k].conservative);
          const theirs = valueOf(oracle[k].conservative);
          if (equal.includes(k)) {
            assert.equal(mine, theirs, `${k}: evaluate ${String(mine)}, oracle ${String(theirs)}`);
          } else {
            assert.ok(mine >= valueOf(ours[k].exact), `${k}: no better than exact`);
            const gap = Math.abs(theirs - mine);
            const bound = singlePointBound(chain, k, ids);
            assert.ok(gap <= bound, `${k}: gap ${String(gap)} > bound ${String(bound)}`);
          }
        }
      });
    }
  }
});

/**
 * A dry landing just short of the brake energy line (found by a scan): the distance's deciding run rounds PA, temperature
 * and GW up and crosses it.
 */
const NEAR_LINE: LandingValues = { ...SAMPLE, paFt: 6030, tempC: 29.6, grossWeightLb: 41290 };

describe('limit verdicts per run (ruling 2)', () => {
  const cellsOf = (values: LandingValues) => evaluate(landingChain(FIGURES, values, 'dry'), LANDING_KINDS).cells;

  test('6,000 ft, 40 C, 44,000 lb: beyond the brake energy line', () => {
    const { distance } = cellsOf({ ...SAMPLE, paFt: 6000, tempC: 40, grossWeightLb: 44000 });
    assert.equal(distance.exactSide.limits?.brakeEnergy, true);
  });

  test('the sheet 1 sample: brake energy false, both tire lines null (not judged)', () => {
    const { distance } = cellsOf(SAMPLE);
    assert.deepEqual(distance.exactSide.limits, { brakeEnergy: false, mlgTire: null, nlgTire: null });
  });

  test('near the brake energy line: the conservative run is beyond, the exact is not', () => {
    const { distance } = cellsOf(NEAR_LINE);
    assert.equal(distance.exactSide.limits?.brakeEnergy, false);
    assert.equal(distance.conservativeSide.limits?.brakeEnergy, true);
  });
});
