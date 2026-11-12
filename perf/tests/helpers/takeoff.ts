/**
 * Shared fixtures of the takeoff chain tests: the figure set, the manual's sample, off-step inputs, the check distance
 * branch inputs, and a reduced chain small enough for the exhaustive oracle.
 */
import type { Chain, Ctx } from '../../src/core/ctx.ts';
import type { TakeoffKey, TakeoffSide, TakeoffValues } from '../../src/core/told/takeoff.ts';

import { loadFigureSet } from './data.ts';

export const TAKEOFF_FIGURES = loadFigureSet([
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

export const MODES = ['mil', 'ab'] as const;
export type Mode = (typeof MODES)[number];

/** The mode's own takeoff factor id (the other one is read but feeds nothing in this mode). */
export const factorId = (mode: Mode): string => (mode === 'mil' ? 'b2-1.tofMil' : 'b2-1.tofAb');
/** The mode's refusal figure id prefix. */
export const refusalPrefix = (mode: Mode): string => (mode === 'mil' ? 'b2-5' : 'b2-6');

/**
 * The manual's takeoff sample (pp. 278 to 280): 2,000 ft, 40 °C (takeoff factor 3.16 MIL, 1.85 AB), 33,000 lb, CG 37,
 * DI 150, 10 kt headwind, 1 % uphill, a 6,000 ft runway; the RCRs are the defaults.
 */
export const SAMPLE: TakeoffValues = {
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
export const at = (change: Partial<TakeoffValues>): TakeoffValues => ({ ...SAMPLE, ...change });

/**
 * MAX AB at 33,700 lb, the sample otherwise: exact takeoff distance 2,491.8 ft (check at 1,000 ft); a rounding step up
 * at any B2-3 panel crosses 2,500 ft (check at 2,000 ft). Found on the data.
 */
export const BRANCH: TakeoffValues = at({ grossWeightLb: 33700 });

/** Off every step, wind and slope unequal (a swapped pair would show): every input point is a rounding point. */
export const OFF_STEP: TakeoffValues = at({
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

/**
 * The chain with every rounding point outside `keep` read unrounded and not passed to the search: a reduced chain over
 * the same code, small enough for the exhaustive oracle (2^n runs).
 */
export function reduced(
  chain: Chain<TakeoffKey, TakeoffSide>,
  keep: readonly string[],
): Chain<TakeoffKey, TakeoffSide> {
  return (ctx) => {
    const frozen: Ctx = {
      read: (id, value, step) => (keep.includes(id) ? ctx.read(id, value, step) : value),
      input: (id, value, step) => (keep.includes(id) ? ctx.input(id, value, step) : value.conservative),
      mark: (m) => {
        ctx.mark(m);
      },
    };
    return chain(frozen);
  };
}
