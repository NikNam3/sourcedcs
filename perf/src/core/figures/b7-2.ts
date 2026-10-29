/**
 * Figure B7-2, Short Field Landing Distance, sheets 1 and 2. Sheet 1 (uncorrected): altitude to the temperature line,
 * down a line the chart prints no scale for (the carried position, page points) to the gross weight curve, then to the
 * uncorrected ground roll; three limit lines lie over the gross weight panel. Sheet 2 (corrected): the uncorrected
 * roll through an RCR curve, then the wind and slope guide lines. The charts read in 1000 ft; every rounding point is
 * in ft.
 */
import { STEPS } from '../ctx.ts';
import type { Ctx } from '../ctx.ts';
import { panel } from '../data/panel.ts';
import type { FigureFile } from '../data/types.ts';
import { curveFamily } from '../read/curve-family.ts';
import { guidelinePanel } from '../read/guideline-panel.ts';
import { beyondLimit } from '../read/limit-line.ts';
import { ok, outOfChart } from '../result.ts';
import type { Read } from '../result.ts';

const FT_PER_CHART_UNIT = 1000;

/**
 * Whether a sheet 1 point lies beyond each limit line: maximum brake energy, MLG tire limit speed (225 KTS) and NLG
 * tire limit speed (217 KTS). null for a line whose drawn range does not hold the point's carried position: nothing is
 * judged there.
 */
export type LimitVerdicts = Readonly<Record<'brakeEnergy' | 'mlgTire' | 'nlgTire', boolean | null>>;

const LIMIT_PANELS: Readonly<Record<keyof LimitVerdicts, string>> = Object.freeze({
  brakeEnergy: 'brake_energy',
  mlgTire: 'mlg_tire',
  nlgTire: 'nlg_tire',
});

/**
 * Reads `b7-2.sh1.roll`, the uncorrected ground roll in ft (STEPS.distanceFt). The carried position is passed from the
 * temperature panel to the gross weight panel as is, never through `ctx.read`: a pilot does not read or round a line
 * carried across.
 *
 * - An altitude or temperature the temperature lines do not draw: OutOfChart on `altitude` or `temperature`.
 * - A gross weight outside the curves: OutOfChart on `gross_weight`.
 * - A carried position the gross weight curves do not reach (hot and high: 8,000 ft at 50 C): OutOfChart on
 *   `temperature` with no drawn range, since the pilot's inputs have no single range there; never on the unscaled
 *   carried axis (Review Focus 3).
 *
 * `limits` judges this run's carried position and its read roll (after `ctx.read`), so the exact and the conservative
 * pass each get their own; it is null when the roll is out of chart.
 */
export function groundRollUncorrected(
  ctx: Ctx,
  fig: FigureFile,
  i: { paFt: number; tempC: number; grossWeightLb: number },
): { rollFt: Read<number>; limits: LimitVerdicts | null } {
  const carry = curveFamily(panel(fig, 'temp', 'curve_family'), fig.id, i.paFt, i.tempC);
  if (!carry.ok) return { rollFt: carry, limits: null };
  const gw = panel(fig, 'gw', 'curve_family');
  const chart = curveFamily(gw, fig.id, carry.value, i.grossWeightLb / 1000);
  if (!chart.ok) {
    const rollFt = chart.error.input === gw.input.name ? outOfChart(fig.id, 'temperature', i.tempC, null) : chart;
    return { rollFt, limits: null };
  }
  const ft = ctx.read('b7-2.sh1.roll', chart.value * FT_PER_CHART_UNIT, STEPS.distanceFt);
  const judge = (key: keyof LimitVerdicts): boolean | null =>
    beyondLimit(panel(fig, LIMIT_PANELS[key], 'limit_line'), carry.value, ft / FT_PER_CHART_UNIT);
  return {
    rollFt: ok(ft),
    limits: { brakeEnergy: judge('brakeEnergy'), mlgTire: judge('mlgTire'), nlgTire: judge('nlgTire') },
  };
}

/**
 * Reads `b7-2.sh2.rcr`, `b7-2.sh2.wind` and `b7-2.sh2.slope`, each the ground roll in ft after that panel
 * (STEPS.distanceFt); each panel enters with the previous read value.
 *
 * - The RCR panel is the wet family (RCR 10, 12, 18) when `wet`, else the dry one (4, 8, 16, 23), as Part 7
 *   interpolates them (ruling P2). An RCR outside the chosen family's curves: OutOfChart on `rcr`; an uncorrected
 *   roll that family does not draw: OutOfChart on `uncorrected_roll`.
 * - Wind and slope are drawn as magnitudes: the sign picks the family (headwind / tailwind, uphill / downhill) and the
 *   panel reads `Math.abs` (ruling R8). A zero wind or slope skips its panel but still reads its id.
 *
 * The first panel out of chart stops the figure: the roll is its OutOfChart and no later id is read.
 */
export function groundRollCorrected(
  ctx: Ctx,
  fig: FigureFile,
  i: { uncorrectedFt: number; rcr: number; wet: boolean; headwindKt: number; slopePct: number },
): { rollFt: Read<number> } {
  const rcr = panel(fig, i.wet ? 'rcr_wet' : 'rcr_dry', 'curve_family');
  const chart = curveFamily(rcr, fig.id, i.uncorrectedFt / FT_PER_CHART_UNIT, i.rcr);
  if (!chart.ok) return { rollFt: chart };
  let ft = ctx.read('b7-2.sh2.rcr', chart.value * FT_PER_CHART_UNIT, STEPS.distanceFt);

  const steps: readonly { id: string; panel: string; family: string; target: number; skip: boolean }[] = [
    {
      id: 'b7-2.sh2.wind',
      panel: 'wind',
      family: i.headwindKt > 0 ? 'headwind' : 'tailwind',
      target: Math.abs(i.headwindKt),
      skip: i.headwindKt === 0,
    },
    {
      id: 'b7-2.sh2.slope',
      panel: 'slope',
      family: i.slopePct > 0 ? 'uphill' : 'downhill',
      target: Math.abs(i.slopePct),
      skip: i.slopePct === 0,
    },
  ];
  for (const step of steps) {
    if (!step.skip) {
      const p = panel(fig, step.panel, 'guideline_panel');
      const moved = guidelinePanel(p, fig.id, step.family, ft / FT_PER_CHART_UNIT, step.target);
      if (!moved.ok) return { rollFt: moved };
      ft = moved.value * FT_PER_CHART_UNIT;
    }
    ft = ctx.read(step.id, ft, STEPS.distanceFt);
  }
  return { rollFt: ok(ft) };
}
