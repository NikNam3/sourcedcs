/**
 * Figure B2-2, Takeoff Speed (CG 35 % MAC, 10 deg pitch attitude): gross weight gives the takeoff speed at 35 %; the
 * printed corrections give the speed at the actual CG, at 8 deg pitch, and the rotation speeds.
 */
import { STEPS } from '../ctx.ts';
import type { Ctx } from '../ctx.ts';
import { panel } from '../data/panel.ts';
import type { FigureFile } from '../data/types.ts';
import { singleCurve } from '../read/single-curve.ts';
import { ok } from '../result.ts';
import type { Read } from '../result.ts';

/** The printed corrections: 0.8 kt per 1 % CG from 35 %, x 1.08 at 8 deg pitch, rotation -10 kt non-AB, -15 kt AB. */
const KT_PER_CG_PCT = 0.8;
const CG_BASELINE_PCT = 35;
const PITCH_8_FACTOR = 1.08;
const ROTATION_MIL_KT = 10;
const ROTATION_AB_KT = 15;

/**
 * Reads `b2-2.vto35` (the chart, in KIAS); the corrections are applied exactly to the read value and are not rounding
 * points. An out-of-chart gross weight gives every output its OutOfChart.
 */
export function takeoffSpeed(
  ctx: Ctx,
  fig: FigureFile,
  i: { grossWeightLb: number; cgPct: number; pitch8: boolean },
): { vto35Kias: Read<number>; vtoKias: Read<number>; vrMilKias: Read<number>; vrAbKias: Read<number> } {
  const chart = singleCurve(panel(fig, 'speed', 'single_curve'), fig.id, i.grossWeightLb / 1000);
  if (!chart.ok) return { vto35Kias: chart, vtoKias: chart, vrMilKias: chart, vrAbKias: chart };
  const vto35 = ctx.read('b2-2.vto35', chart.value, STEPS.speedKt);
  const atCg = vto35 - KT_PER_CG_PCT * (i.cgPct - CG_BASELINE_PCT);
  const vto = i.pitch8 ? atCg * PITCH_8_FACTOR : atCg;
  return {
    vto35Kias: ok(vto35),
    vtoKias: ok(vto),
    vrMilKias: ok(vto - ROTATION_MIL_KT),
    vrAbKias: ok(vto - ROTATION_AB_KT),
  };
}
