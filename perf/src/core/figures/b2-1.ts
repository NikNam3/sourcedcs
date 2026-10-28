/**
 * Figure B2-1, Takeoff Factor (F110-GE-129): runway temperature and pressure altitude give the MIL takeoff factor;
 * the MAX AB factor is the scale printed beside it.
 */
import { STEPS } from '../ctx.ts';
import type { Ctx } from '../ctx.ts';
import { panel } from '../data/panel.ts';
import type { FigureFile } from '../data/types.ts';
import { curveFamily } from '../read/curve-family.ts';
import { scalePair } from '../read/scale-pair.ts';
import { ok } from '../result.ts';
import type { Read } from '../result.ts';

/**
 * Reads `b2-1.tofMil`, then `b2-1.tofAb`: the AB scale beside the unrounded MIL reading, read as a rounding point of
 * its own. A MIL reading out of chart gives both outputs its OutOfChart and reads nothing; a MIL reading beyond the
 * drawn AB scale gives tofAb alone an OutOfChart.
 */
export function takeoffFactor(
  ctx: Ctx,
  fig: FigureFile,
  i: { tempC: number; paFt: number },
): { tofMil: Read<number>; tofAb: Read<number> } {
  const mil = curveFamily(panel(fig, 'pa', 'curve_family'), fig.id, i.tempC, i.paFt);
  if (!mil.ok) return { tofMil: mil, tofAb: mil };
  const tofMil = ok(ctx.read('b2-1.tofMil', mil.value, STEPS.takeoffFactor));
  const ab = scalePair(panel(fig, 'ab', 'scale_pair'), fig.id, mil.value);
  if (!ab.ok) return { tofMil, tofAb: ab };
  return { tofMil, tofAb: ok(ctx.read('b2-1.tofAb', ab.value, STEPS.takeoffFactor)) };
}
