/**
 * Figure B2-4, Acceleration Check Speed: takeoff factor and check distance give a speed, which the GW, drag index,
 * wind and slope guideline panels then move in turn. Every rounding point is in KIAS.
 */
import { STEPS } from '../ctx.ts';
import type { Ctx } from '../ctx.ts';
import { panel } from '../data/panel.ts';
import type { FigureFile } from '../data/types.ts';
import { curveFamily } from '../read/curve-family.ts';
import { guidelinePanel } from '../read/guideline-panel.ts';
import { ok } from '../result.ts';
import type { Read } from '../result.ts';

const LB_PER_CHART_UNIT = 1000;

/**
 * Reads `b2-4.distance`, `b2-4.gw`, `b2-4.di`, `b2-4.wind` and `b2-4.slope`, each the speed in KIAS after that panel
 * (STEPS.speedKt); each panel enters with the previous read value. Wind and slope are drawn as magnitudes: the sign
 * picks the family (headwind / tailwind, uphill / downhill) and the panel reads `Math.abs` (ruling R8). A zero wind or
 * slope skips its panel but still reads its id. The first panel out of chart stops the figure: the speed is its
 * OutOfChart and no later id is read. A takeoff factor the curves do not draw ([1.09, 6.0], the 500 ft curve from
 * 1.18) is out of chart on `takeoff_factor` (ruling P11); a speed under the DI panel's lowest line (60 kt) with a drag
 * index is out of chart on the speed (ruling P9).
 */
export function accelCheckSpeed(
  ctx: Ctx,
  fig: FigureFile,
  i: {
    takeoffFactor: number;
    checkDistanceFt: number;
    grossWeightLb: number;
    dragIndex: number;
    headwindKt: number;
    slopePct: number;
  },
): { accelCheckKias: Read<number> } {
  const chart = curveFamily(panel(fig, 'distance', 'curve_family'), fig.id, i.takeoffFactor, i.checkDistanceFt);
  if (!chart.ok) return { accelCheckKias: chart };
  let kias = ctx.read('b2-4.distance', chart.value, STEPS.speedKt);

  const steps: readonly { id: string; panel: string; family: string; target: number; skip: boolean }[] = [
    { id: 'b2-4.gw', panel: 'gw', family: 'all', target: i.grossWeightLb / LB_PER_CHART_UNIT, skip: false },
    { id: 'b2-4.di', panel: 'di', family: 'all', target: i.dragIndex, skip: false },
    {
      id: 'b2-4.wind',
      panel: 'wind',
      family: i.headwindKt > 0 ? 'headwind' : 'tailwind',
      target: Math.abs(i.headwindKt),
      skip: i.headwindKt === 0,
    },
    {
      id: 'b2-4.slope',
      panel: 'slope',
      family: i.slopePct > 0 ? 'uphill' : 'downhill',
      target: Math.abs(i.slopePct),
      skip: i.slopePct === 0,
    },
  ];
  for (const step of steps) {
    if (!step.skip) {
      const moved = guidelinePanel(panel(fig, step.panel, 'guideline_panel'), fig.id, step.family, kias, step.target);
      if (!moved.ok) return { accelCheckKias: moved };
      kias = moved.value;
    }
    kias = ctx.read(step.id, kias, STEPS.speedKt);
  }
  return { accelCheckKias: ok(kias) };
}
