/**
 * The takeoff chain, one per TOLD column (MIL, MAX AB; TOLD 1.7 "Chains"): B2-1 takeoff factor, B2-2 rotation and
 * takeoff speed, B2-3 distance, B2-4 acceleration check, then refusal speed dry and wet at the column's RCRs
 * (`rcr.ts`, B2-5 MIL, B2-6 MAX AB). Each figure is called at most once per run. 8° pitch is not an input in step 1.
 */
import { STEPS } from '../ctx.ts';
import type { Chain, OutputKind } from '../ctx.ts';
import { figure } from '../data/figure-set.ts';
import type { FigureSet } from '../data/figure-set.ts';
import { panel } from '../data/panel.ts';
import type { FigureFile } from '../data/types.ts';
import { takeoffFactor } from '../figures/b2-1.ts';
import { takeoffSpeed } from '../figures/b2-2.ts';
import { takeoffDistance } from '../figures/b2-3.ts';
import { accelCheckSpeed } from '../figures/b2-4.ts';
import type { DerivedInputs } from '../inputs/derive.ts';
import { clampWithin, drawnRange, edgeTolerance, unionRange } from '../read/interp.ts';
import { outOfChart } from '../result.ts';
import type { Read } from '../result.ts';

import { refusalByRcr } from './rcr.ts';

export type TakeoffKey = 'rotation' | 'takeoffSpeed' | 'distance' | 'accelCheck' | 'refusalDry' | 'refusalWet';

export const TAKEOFF_KINDS: Readonly<Record<TakeoffKey, OutputKind>> = Object.freeze({
  rotation: 'speed',
  takeoffSpeed: 'speed',
  distance: 'distance',
  accelCheck: 'accelCheckSpeed',
  refusalDry: 'refusalSpeed',
  refusalWet: 'refusalSpeed',
});

/** The chain's values, from `DerivedInputs` (`TAKEOFF_FIELDS`) and the drag index builder. */
export interface TakeoffValues {
  paFt: number;
  tempC: number;
  grossWeightLb: number;
  cgPct: number;
  /** Two-valued: no tip missile is −4 each exact and 0 conservative (5.2). */
  dragIndex: { exact: number; conservative: number };
  /** > 0 headwind, < 0 tailwind. */
  headwindKt: number;
  /** > 0 uphill. */
  slopePct: number;
  /** The length available; not rounded. */
  runwayFt: number;
  rcrDry: number;
  rcrWet: number;
}

/** The run's check distance for B2-4; null when the takeoff distance is out of chart. */
export interface TakeoffSide {
  readonly checkDistanceFt: 1000 | 2000 | null;
}

/** The derived inputs the chain needs (the drag index is the builder's, parsed by Task 7). */
export const TAKEOFF_FIELDS: readonly (keyof DerivedInputs)[] = Object.freeze([
  'paFt',
  'tempC',
  'takeoffGwLb',
  'cgPct',
  'headwindKt',
  'slopePct',
  'runwayFt',
  'rcrDry',
  'rcrWet',
] as const);

/** Under this takeoff distance the acceleration check is at 1,000 ft, from it at 2,000 ft. */
const SHORT_TAKEOFF_FT = 2500;

/** The check distance for this run's takeoff distance; null when that distance is out of chart. */
export function checkDistanceFor(distanceFt: Read<number>): 1000 | 2000 | null {
  if (!distanceFt.ok) return null;
  return distanceFt.value < SHORT_TAKEOFF_FT ? 1000 : 2000;
}

/**
 * The CG range B2-2's correction may be applied over: B2-2 draws none of its own, so it is the range B2-3's `cg`
 * panel draws (30 to 40 % MAC), with that panel's edge tolerance.
 */
function cgRange(b23: FigureFile): { range: [number, number]; tolerance: number } {
  const lines = Object.values(panel(b23, 'cg', 'guideline_panel').families).flat();
  const range = unionRange(lines.map((line) => drawnRange(line)));
  return { range, tolerance: edgeTolerance(range) };
}

/**
 * The takeoff chain for one column. Rounding points, in order: `input.pa`, `input.temp`, `input.gw`, `input.cg`,
 * `input.di` (two-valued), `input.wind`, `input.slope`, `input.rcr_dry`, `input.rcr_wet`; then the figures' own ids
 * (B2-1 → B2-2 → B2-3 → B2-4 → refusal dry → refusal wet). MIL uses `tofMil` and `vrMilKias`, MAX AB `tofAb` and
 * `vrAbKias`. A CG outside B2-3's drawn CG range makes rotation and takeoff speed OutOfChart on B2-2 `cg` (B2-2 is
 * then not read). An out-of-chart takeoff factor is the error of every output that reads it. The check distance is
 * this run's: 1,000 ft under 2,500 ft of takeoff distance, else 2,000 ft (a branch the conservative search re-tests);
 * a takeoff distance out of chart is the acceleration check's error too, with no check distance.
 */
export function takeoffChain(figures: FigureSet, v: TakeoffValues, mode: 'mil' | 'ab'): Chain<TakeoffKey, TakeoffSide> {
  const b21 = figure(figures, 'B2-1');
  const b22 = figure(figures, 'B2-2');
  const b23 = figure(figures, 'B2-3');
  const b24 = figure(figures, 'B2-4');
  const cg = cgRange(b23);

  return (ctx) => {
    const paFt = ctx.read('input.pa', v.paFt, STEPS.pressureAltitudeFt);
    const tempC = ctx.read('input.temp', v.tempC, STEPS.temperatureC);
    const grossWeightLb = ctx.read('input.gw', v.grossWeightLb, STEPS.grossWeightLb);
    const cgPct = ctx.read('input.cg', v.cgPct, STEPS.cgPct);
    const dragIndex = ctx.input('input.di', v.dragIndex, STEPS.dragIndex);
    const headwindKt = ctx.read('input.wind', v.headwindKt, STEPS.windKt);
    const slopePct = ctx.read('input.slope', v.slopePct, STEPS.slopePct);
    const rcrDry = ctx.read('input.rcr_dry', v.rcrDry, STEPS.rcr);
    const rcrWet = ctx.read('input.rcr_wet', v.rcrWet, STEPS.rcr);

    const factors = takeoffFactor(ctx, b21, { tempC, paFt });
    const tof = mode === 'mil' ? factors.tofMil : factors.tofAb;

    let rotation: Read<number>;
    let speed: Read<number>;
    if (clampWithin(cg.range, cgPct, cg.tolerance) === undefined) {
      rotation = speed = outOfChart('B2-2', 'cg', cgPct, cg.range);
    } else {
      const speeds = takeoffSpeed(ctx, b22, { grossWeightLb, cgPct, pitch8: false });
      rotation = mode === 'mil' ? speeds.vrMilKias : speeds.vrAbKias;
      speed = speeds.vtoKias;
    }

    if (!tof.ok) {
      return {
        outputs: { rotation, takeoffSpeed: speed, distance: tof, accelCheck: tof, refusalDry: tof, refusalWet: tof },
        side: { checkDistanceFt: null },
      };
    }
    const takeoffFactorValue = tof.value;

    const { distanceFt } = takeoffDistance(ctx, b23, {
      takeoffFactor: takeoffFactorValue,
      grossWeightLb,
      cgPct,
      dragIndex,
      slopePct,
      headwindKt,
      pitch8: false,
    });
    const checkDistanceFt = checkDistanceFor(distanceFt);
    const accelCheck =
      checkDistanceFt === null
        ? distanceFt
        : accelCheckSpeed(ctx, b24, {
            takeoffFactor: takeoffFactorValue,
            checkDistanceFt,
            grossWeightLb,
            dragIndex,
            headwindKt,
            slopePct,
          }).accelCheckKias;

    const refusal = { takeoffFactor: takeoffFactorValue, grossWeightLb, runwayFt: v.runwayFt, headwindKt, slopePct };
    return {
      outputs: {
        rotation,
        takeoffSpeed: speed,
        distance: distanceFt,
        accelCheck,
        refusalDry: refusalByRcr(ctx, figures, mode, 'dry', rcrDry, refusal),
        refusalWet: refusalByRcr(ctx, figures, mode, 'wet', rcrWet, refusal),
      },
      side: { checkDistanceFt },
    };
  };
}
