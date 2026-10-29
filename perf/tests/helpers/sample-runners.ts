/**
 * One runner per chart spec with sample problems: it maps the spec's snake_case sample inputs to the figure call,
 * runs it in `runExact`, and maps the figure's outputs to the spec's expected keys. An input key the runner does not
 * know, or a missing one, throws: a sample must not be checked against inputs nobody passed.
 */
import { runExact } from '../../src/core/ctx.ts';
import { takeoffFactor } from '../../src/core/figures/b2-1.ts';
import { takeoffSpeed } from '../../src/core/figures/b2-2.ts';
import { takeoffDistance } from '../../src/core/figures/b2-3.ts';
import { landingSpeed } from '../../src/core/figures/b7-1.ts';
import { groundRollCorrected, groundRollUncorrected } from '../../src/core/figures/b7-2.ts';
import type { Read } from '../../src/core/result.ts';

import { loadFigure } from './data.ts';
import type { SampleProblem } from './specs.ts';

type Inputs = SampleProblem['inputs'];
type Runner = (inputs: Inputs) => Record<string, Read<number>>;

/** Reads the sample's inputs: `numbers` required, `flags` optional (false when absent); any other key throws. */
function inputsOf<N extends string, F extends string>(
  spec: string,
  inputs: Inputs,
  numbers: readonly N[],
  flags: readonly F[] = [],
): Record<N, number> & Record<F, boolean> {
  const known: readonly string[] = [...numbers, ...flags];
  for (const key of Object.keys(inputs)) {
    if (!known.includes(key)) throw new Error(`${spec} sample: unknown input ${key}`);
  }
  const out: Record<string, number | boolean> = {};
  for (const key of numbers) {
    const value = inputs[key];
    if (typeof value !== 'number') throw new Error(`${spec} sample: input ${key} is not a number`);
    out[key] = value;
  }
  for (const key of flags) {
    const value = inputs[key] ?? false;
    if (typeof value !== 'boolean') throw new Error(`${spec} sample: input ${key} is not a boolean`);
    out[key] = value;
  }
  return out as Record<N, number> & Record<F, boolean>;
}

export const SAMPLE_RUNNERS: Readonly<Record<string, Runner>> = Object.freeze({
  'B2-1': (inputs: Inputs) => {
    const i = inputsOf('B2-1', inputs, ['temp_c', 'pa_ft']);
    const fig = loadFigure('B2-1');
    const { outputs } = runExact((ctx) => takeoffFactor(ctx, fig, { tempC: i.temp_c, paFt: i.pa_ft }));
    return { tof_mil: outputs.tofMil, tof_ab: outputs.tofAb };
  },
  'B2-2': (inputs: Inputs) => {
    const i = inputsOf('B2-2', inputs, ['gross_weight_lb', 'cg_pct'], ['pitch_8deg']);
    const fig = loadFigure('B2-2');
    const { outputs } = runExact((ctx) =>
      takeoffSpeed(ctx, fig, { grossWeightLb: i.gross_weight_lb, cgPct: i.cg_pct, pitch8: i.pitch_8deg }),
    );
    return {
      vto_35_kias: outputs.vto35Kias,
      vto_kias: outputs.vtoKias,
      vr_mil_kias: outputs.vrMilKias,
      vr_ab_kias: outputs.vrAbKias,
    };
  },
  'B2-3': (inputs: Inputs) => {
    const i = inputsOf(
      'B2-3',
      inputs,
      ['takeoff_factor', 'gross_weight_lb', 'cg_pct', 'drag_index', 'slope_pct', 'headwind_kt'],
      ['pitch_8deg'],
    );
    const fig = loadFigure('B2-3');
    const { outputs } = runExact((ctx) =>
      takeoffDistance(ctx, fig, {
        takeoffFactor: i.takeoff_factor,
        grossWeightLb: i.gross_weight_lb,
        cgPct: i.cg_pct,
        dragIndex: i.drag_index,
        slopePct: i.slope_pct,
        headwindKt: i.headwind_kt,
        pitch8: i.pitch_8deg,
      }),
    );
    return { distance_ft: outputs.distanceFt };
  },
  'B7-1': (inputs: Inputs) => {
    const i = inputsOf('B7-1', inputs, ['gross_weight_lb']);
    const fig = loadFigure('B7-1');
    const { outputs } = runExact((ctx) => landingSpeed(ctx, fig, { grossWeightLb: i.gross_weight_lb }));
    return { final_approach_kias: outputs.finalApproachKias, touchdown_kias: outputs.touchdownKias };
  },
  'B7-2.sh1': (inputs: Inputs) => {
    const i = inputsOf('B7-2.sh1', inputs, ['pa_ft', 'temp_c', 'gross_weight_lb']);
    const fig = loadFigure('B7-2.sh1');
    const { outputs } = runExact((ctx) => ({
      rollFt: groundRollUncorrected(ctx, fig, { paFt: i.pa_ft, tempC: i.temp_c, grossWeightLb: i.gross_weight_lb })
        .rollFt,
    }));
    return { ground_roll_ft: outputs.rollFt };
  },
  'B7-2.sh2': (inputs: Inputs) => {
    const i = inputsOf('B7-2.sh2', inputs, ['uncorrected_ft', 'rcr', 'headwind_kt', 'slope_pct'], ['wet']);
    const fig = loadFigure('B7-2.sh2');
    const { outputs } = runExact((ctx) =>
      groundRollCorrected(ctx, fig, {
        uncorrectedFt: i.uncorrected_ft,
        rcr: i.rcr,
        wet: i.wet,
        headwindKt: i.headwind_kt,
        slopePct: i.slope_pct,
      }),
    );
    return { ground_roll_ft: outputs.rollFt };
  },
});
