/**
 * Figure B2-3, Takeoff Distance (10 deg pitch attitude): takeoff factor and gross weight give a distance, which the
 * CG, drag index, slope and wind guideline panels then move in turn. The chart reads in 1000 ft; every rounding point
 * is in ft.
 */
import { STEPS } from '../ctx.ts';
import type { Ctx } from '../ctx.ts';
import { panel } from '../data/panel.ts';
import type { FigureFile } from '../data/types.ts';
import { guidelineMark } from '../path/mark.ts';
import { curveFamily } from '../read/curve-family.ts';
import { guidelinePanel } from '../read/guideline-panel.ts';
import { ok } from '../result.ts';
import type { Read } from '../result.ts';

/** The printed correction: distance x 1.18 at 8 deg pitch attitude. */
const PITCH_8_FACTOR = 1.18;
const FT_PER_CHART_UNIT = 1000;

/**
 * Reads `b2-3.gw`, `b2-3.cg`, `b2-3.di`, `b2-3.slope` and `b2-3.wind`, each the distance in ft after that panel
 * (STEPS.distanceFt); each panel enters with the previous read value. Slope and wind are drawn as magnitudes: the sign
 * picks the family (uphill / downhill, headwind / tailwind) and the panel reads `Math.abs` (ruling R8). A zero slope
 * or wind skips its panel but still reads its id. The first panel out of chart stops the figure: the distance is its
 * OutOfChart and no later id is read. A distance under the guideline panels' lowest line (1,000 ft) is out of chart
 * at the next panel that moves it (ruling R11). x 1.18 at 8 deg is a correction, not a rounding point. Marks each
 * panel it reads after its read, in order (TOLD 1.8): a skipped panel is not marked, nor one out of chart.
 */
export function takeoffDistance(
  ctx: Ctx,
  fig: FigureFile,
  i: {
    takeoffFactor: number;
    grossWeightLb: number;
    cgPct: number;
    dragIndex: number;
    slopePct: number;
    headwindKt: number;
    pitch8: boolean;
  },
): { distanceFt: Read<number> } {
  const gw = i.grossWeightLb / 1000;
  const chart = curveFamily(panel(fig, 'gw', 'curve_family'), fig.id, i.takeoffFactor, gw);
  if (!chart.ok) return { distanceFt: chart };
  let ft = ctx.read('b2-3.gw', chart.value * FT_PER_CHART_UNIT, STEPS.distanceFt);
  ctx.mark({
    kind: 'curve_family',
    figure: fig.id,
    panel: 'gw',
    input: i.takeoffFactor,
    param: gw,
    output: chart.value,
  });

  const steps: readonly { id: string; panel: string; family: string; target: number; skip: boolean }[] = [
    { id: 'b2-3.cg', panel: 'cg', family: 'all', target: i.cgPct, skip: false },
    { id: 'b2-3.di', panel: 'di', family: 'all', target: i.dragIndex, skip: false },
    {
      id: 'b2-3.slope',
      panel: 'slope',
      family: i.slopePct > 0 ? 'uphill' : 'downhill',
      target: Math.abs(i.slopePct),
      skip: i.slopePct === 0,
    },
    {
      id: 'b2-3.wind',
      panel: 'wind',
      family: i.headwindKt > 0 ? 'headwind' : 'tailwind',
      target: Math.abs(i.headwindKt),
      skip: i.headwindKt === 0,
    },
  ];
  for (const step of steps) {
    if (!step.skip) {
      const p = panel(fig, step.panel, 'guideline_panel');
      const entry = ft / FT_PER_CHART_UNIT;
      const moved = guidelinePanel(p, fig.id, step.family, entry, step.target);
      if (!moved.ok) return { distanceFt: moved };
      ctx.mark(guidelineMark(fig.id, p, step.family, entry, step.target, moved.value));
      ft = moved.value * FT_PER_CHART_UNIT;
    }
    ft = ctx.read(step.id, ft, STEPS.distanceFt);
  }
  return { distanceFt: ok(i.pitch8 ? ft * PITCH_8_FACTOR : ft) };
}
