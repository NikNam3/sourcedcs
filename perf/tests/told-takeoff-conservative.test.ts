/**
 * The takeoff chain's conservative cells (TOLD 5.2): no better than exact, within the 5.2 criterion of the exhaustive
 * oracle on reduced chains (the full chain is 2^30 runs), and the check distance branch (Review Focus 1).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { evaluate, WORSE } from '../src/core/ctx.ts';
import type { Read } from '../src/core/result.ts';
import { TAKEOFF_KINDS, takeoffChain } from '../src/core/told/takeoff.ts';
import type { TakeoffKey, TakeoffValues } from '../src/core/told/takeoff.ts';

import { singlePointBound } from './helpers/bound.ts';
import { evaluateExhaustive } from './helpers/exhaustive.ts';
import {
  BRANCH,
  factorId,
  MODES,
  OFF_STEP,
  reduced,
  refusalPrefix,
  SAMPLE,
  TAKEOFF_FIGURES,
} from './helpers/takeoff.ts';
import type { Mode } from './helpers/takeoff.ts';

const figures = TAKEOFF_FIGURES;
const KEYS = Object.keys(TAKEOFF_KINDS) as TakeoffKey[];

function valueOf(read: Read<number>): number {
  assert.ok(read.ok, read.ok ? '' : JSON.stringify(read.error));
  return read.value;
}

const B23 = ['b2-3.gw', 'b2-3.cg', 'b2-3.di', 'b2-3.slope', 'b2-3.wind'];
const B24 = ['b2-4.distance', 'b2-4.gw', 'b2-4.di', 'b2-4.wind', 'b2-4.slope'];

interface Group {
  readonly name: string;
  readonly values: TakeoffValues;
  readonly keep: (mode: Mode) => string[];
  readonly keys: readonly TakeoffKey[];
  /** Outputs where the single-point search and the oracle coincide (5.2: "B2-3 is on this side"): equal, not bounded. */
  readonly equal: readonly TakeoffKey[];
}

/** Each reduced chain keeps one output group's own points, and only the mode's own takeoff factor. */
const GROUPS: readonly Group[] = [
  {
    name: 'distance and accelCheck, inputs off step (inputs, factor, B2-3)',
    values: OFF_STEP,
    keep: (m) => [
      'input.pa',
      'input.temp',
      'input.gw',
      'input.cg',
      'input.di',
      'input.wind',
      'input.slope',
      factorId(m),
      ...B23,
    ],
    keys: ['distance', 'accelCheck'],
    equal: ['distance'],
  },
  {
    name: 'distance and accelCheck, sample inputs (factor, B2-3, B2-4)',
    values: SAMPLE,
    keep: (m) => [factorId(m), ...B23, ...B24],
    keys: ['distance', 'accelCheck'],
    equal: ['distance'],
  },
  {
    name: 'refusal dry and wet, inputs off step, RCR between printed values',
    values: OFF_STEP,
    keep: (m) => {
      const r = refusalPrefix(m);
      return [
        'input.gw',
        'input.wind',
        'input.slope',
        'input.rcr_dry',
        'input.rcr_wet',
        factorId(m),
        `${r}.sh1.runway`,
        `${r}.sh1.wind`,
        `${r}.sh1.slope`,
        `${r}.dry`,
        `${r}.sh2.runway`,
        `${r}.sh2.wind`,
        `${r}.sh2.slope`,
        `${r}.wet`,
      ];
    },
    keys: ['refusalDry', 'refusalWet'],
    equal: [],
  },
  {
    name: 'rotation and takeoff speed, inputs off step',
    values: OFF_STEP,
    keep: () => ['input.gw', 'input.cg', 'b2-2.vto35'],
    keys: ['rotation', 'takeoffSpeed'],
    equal: [],
  },
];

/** Fails unless `evaluate` is within the 5.2 criterion of the oracle for `keys`, and equal to it for `equal`. */
function compare(chain: ReturnType<typeof reduced>, keys: readonly TakeoffKey[], equal: readonly TakeoffKey[]): void {
  const fast = evaluate(chain, TAKEOFF_KINDS);
  const oracle = evaluateExhaustive(chain, TAKEOFF_KINDS);
  for (const k of keys) {
    const mine = valueOf(fast.cells[k].conservative);
    const best = valueOf(oracle.cells[k].conservative);
    if (equal.includes(k)) {
      assert.ok(Math.abs(mine - best) < 1e-9, `${k}: ${String(mine)} differs from the oracle's ${String(best)}`);
      continue;
    }
    const bound = singlePointBound(chain, k, fast.roundingPoints);
    assert.ok(
      Math.abs(mine - best) <= bound + 1e-9,
      `${k}: gap ${String(Math.abs(mine - best))} over ${String(bound)}`,
    );
  }
}

describe('takeoff chain, conservative cells', () => {
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

    for (const group of GROUPS) {
      test(`within the 5.2 criterion of the exhaustive search: ${group.name} (${mode})`, () => {
        compare(reduced(takeoffChain(figures, group.values, mode), group.keep(mode)), group.keys, group.equal);
      });
    }
  }

  test('check distance branch (Review Focus 1): exact just under 2,500 ft, the conservative run crosses it', () => {
    const { cells } = evaluate(takeoffChain(figures, BRANCH, 'ab'), TAKEOFF_KINDS);
    const exactFt = valueOf(cells.distance.exact);
    assert.ok(exactFt < 2500 && exactFt > 2480, `exact distance ${String(exactFt)}`);
    assert.ok(valueOf(cells.distance.conservative) >= 2500);
    assert.equal(cells.accelCheck.exactSide.checkDistanceFt, 1000);
    assert.equal(cells.accelCheck.conservativeSide.checkDistanceFt, 2000);
    assert.ok(valueOf(cells.accelCheck.conservative) > valueOf(cells.accelCheck.exact));
    // The oracle on the factor, B2-3 and B2-4 points: the same branch, distance equal, accelCheck within the bound.
    const chain = reduced(takeoffChain(figures, BRANCH, 'ab'), [factorId('ab'), ...B23, ...B24]);
    compare(chain, ['distance', 'accelCheck'], ['distance']);
    const oracle = evaluateExhaustive(chain, TAKEOFF_KINDS);
    assert.equal(oracle.cells.accelCheck.exactSide.checkDistanceFt, 1000);
    assert.equal(oracle.cells.accelCheck.conservativeSide.checkDistanceFt, 2000);
  });
});
