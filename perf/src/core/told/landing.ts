/**
 * The landing chain (TOLD 1.7, chains): one per landing column, normal weight or heavyweight, dry or wet. B7-1 gives
 * the final approach and touchdown speeds, B7-2 sheet 1 the uncorrected roll and the limit verdicts, B7-2 sheet 2 the
 * roll corrected for RCR, wind and slope. The verdicts are side data, so each cell carries those of the run that
 * decided it (ruling 2). The speeds do not depend on the surface; each chain computes them anyway.
 */
import { STEPS } from '../ctx.ts';
import type { Chain, OutputKind } from '../ctx.ts';
import { figure } from '../data/figure-set.ts';
import type { FigureSet } from '../data/figure-set.ts';
import { landingSpeed } from '../figures/b7-1.ts';
import { groundRollCorrected, groundRollUncorrected } from '../figures/b7-2.ts';
import type { LimitVerdicts } from '../figures/b7-2.ts';
import type { DerivedInputs } from '../inputs/derive.ts';

export type LandingKey = 'finalApproach' | 'touchdown' | 'distance';

export const LANDING_KINDS: Readonly<Record<LandingKey, OutputKind>> = Object.freeze({
  finalApproach: 'speed',
  touchdown: 'speed',
  distance: 'distance',
});

/**
 * One column's chart inputs. The caller picks the weight (normal: landing GW, heavy: takeoff GW) and the RCR (the dry
 * or the wet input). Headwind negative is a tailwind; slope uphill positive.
 */
export interface LandingValues {
  paFt: number;
  tempC: number;
  grossWeightLb: number;
  headwindKt: number;
  slopePct: number;
  rcr: number;
}

/** Sheet 1's limit verdicts of the run; null when the uncorrected roll is out of chart (nothing judged). */
export interface LandingSide {
  readonly limits: LimitVerdicts | null;
}

type Fields = readonly (keyof DerivedInputs)[];

const fieldsOf = (gw: keyof DerivedInputs, rcr: keyof DerivedInputs): Fields =>
  Object.freeze(['paFt', 'tempC', gw, rcr, 'headwindKt', 'slopePct', 'runwayFt']);

/** The derived inputs each landing column needs; `runwayFt` is for the runway rules, not the charts. */
export const LANDING_FIELDS: Readonly<Record<'normal' | 'heavy', Readonly<Record<'dry' | 'wet', Fields>>>> =
  Object.freeze({
    normal: Object.freeze({ dry: fieldsOf('landingGwLb', 'rcrDry'), wet: fieldsOf('landingGwLb', 'rcrWet') }),
    heavy: Object.freeze({ dry: fieldsOf('takeoffGwLb', 'rcrDry'), wet: fieldsOf('takeoffGwLb', 'rcrWet') }),
  });

/**
 * Reads `input.pa`, `input.temp`, `input.gw`, `input.rcr`, `input.wind`, `input.slope`, then B7-1, B7-2 sheet 1 and
 * sheet 2 (`wet` when `surface` is wet). An uncorrected roll out of chart is the distance's OutOfChart and sheet 2
 * reads nothing. A figure missing from `figures` throws here, before any run.
 */
export function landingChain(
  figures: FigureSet,
  v: LandingValues,
  surface: 'dry' | 'wet',
): Chain<LandingKey, LandingSide> {
  const b71 = figure(figures, 'B7-1');
  const sheet1 = figure(figures, 'B7-2.sh1');
  const sheet2 = figure(figures, 'B7-2.sh2');
  return (ctx) => {
    const paFt = ctx.read('input.pa', v.paFt, STEPS.pressureAltitudeFt);
    const tempC = ctx.read('input.temp', v.tempC, STEPS.temperatureC);
    const grossWeightLb = ctx.read('input.gw', v.grossWeightLb, STEPS.grossWeightLb);
    const rcr = ctx.read('input.rcr', v.rcr, STEPS.rcr);
    const headwindKt = ctx.read('input.wind', v.headwindKt, STEPS.windKt);
    const slopePct = ctx.read('input.slope', v.slopePct, STEPS.slopePct);

    const speeds = landingSpeed(ctx, b71, { grossWeightLb });
    const uncorrected = groundRollUncorrected(ctx, sheet1, { paFt, tempC, grossWeightLb });
    const distance = uncorrected.rollFt.ok
      ? groundRollCorrected(ctx, sheet2, {
          uncorrectedFt: uncorrected.rollFt.value,
          rcr,
          wet: surface === 'wet',
          headwindKt,
          slopePct,
        }).rollFt
      : uncorrected.rollFt;
    return {
      outputs: { finalApproach: speeds.finalApproachKias, touchdown: speeds.touchdownKias, distance },
      side: { limits: uncorrected.limits },
    };
  };
}
