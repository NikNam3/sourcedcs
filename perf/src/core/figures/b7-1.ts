/**
 * Figure B7-1, Landing Speed (13 deg AOA, all drag indexes, temperatures and altitudes): gross weight gives the final
 * approach and the touchdown speed, two curves over the same axes.
 */
import { STEPS } from '../ctx.ts';
import type { Ctx } from '../ctx.ts';
import { panel } from '../data/panel.ts';
import type { FigureFile } from '../data/types.ts';
import { singleCurve } from '../read/single-curve.ts';
import { ok } from '../result.ts';
import type { Read } from '../result.ts';

/**
 * Reads `b7-1.final` then `b7-1.touchdown`, each in KIAS (STEPS.speedKt). Each curve is read on its own: a gross
 * weight a curve does not draw gives that output its OutOfChart on `gross_weight` and reads nothing for it.
 */
export function landingSpeed(
  ctx: Ctx,
  fig: FigureFile,
  i: { grossWeightLb: number },
): { finalApproachKias: Read<number>; touchdownKias: Read<number> } {
  const final = singleCurve(panel(fig, 'final_approach', 'single_curve'), fig.id, i.grossWeightLb / 1000);
  const finalApproachKias = final.ok ? ok(ctx.read('b7-1.final', final.value, STEPS.speedKt)) : final;
  const touchdown = singleCurve(panel(fig, 'touchdown', 'single_curve'), fig.id, i.grossWeightLb / 1000);
  const touchdownKias = touchdown.ok ? ok(ctx.read('b7-1.touchdown', touchdown.value, STEPS.speedKt)) : touchdown;
  return { finalApproachKias, touchdownKias };
}
