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
 * weight a curve does not draw gives that output its OutOfChart on `gross_weight` and reads nothing for it. Marks `final_approach`
 * then `touchdown`, each after its read and only when it read.
 */
export function landingSpeed(
  ctx: Ctx,
  fig: FigureFile,
  i: { grossWeightLb: number },
): { finalApproachKias: Read<number>; touchdownKias: Read<number> } {
  const gw = i.grossWeightLb / 1000;
  const curve = (id: 'final' | 'touchdown', panelId: string): Read<number> => {
    const read = singleCurve(panel(fig, panelId, 'single_curve'), fig.id, gw);
    if (!read.ok) return read;
    const kias = ctx.read(`b7-1.${id}`, read.value, STEPS.speedKt);
    ctx.mark({ kind: 'single_curve', figure: fig.id, panel: panelId, input: gw, output: read.value });
    return ok(kias);
  };
  const finalApproachKias = curve('final', 'final_approach');
  return { finalApproachKias, touchdownKias: curve('touchdown', 'touchdown') };
}
