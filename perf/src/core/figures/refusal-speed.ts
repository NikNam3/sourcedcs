/**
 * The refusal speed charts (B2-5 non-AB, B2-6 AB, sheets 1 to 3). Each chart turns a corner: the takeoff factor
 * enters the lower GW curves, which give a page position carried up with no printed scale (the unscaled `carry`
 * axis, page points) into the runway length lines; their reading then crosses the wind and the slope guide lines to
 * the refusal speed scale. Sheet 3 draws two such charts, snow and icy, which share the wind and slope panels.
 */
import { STEPS } from '../ctx.ts';
import type { Ctx } from '../ctx.ts';
import { panel } from '../data/panel.ts';
import type { FigureFile } from '../data/types.ts';
import { curveFamily } from '../read/curve-family.ts';
import { guidelinePanel } from '../read/guideline-panel.ts';
import { ok, outOfChart } from '../result.ts';
import type { Read } from '../result.ts';

export interface RefusalInputs {
  takeoffFactor: number;
  grossWeightLb: number;
  runwayFt: number;
  /** > 0 headwind, < 0 tailwind. */
  headwindKt: number;
  /** > 0 uphill, < 0 downhill. */
  slopePct: number;
}

const LB_PER_CHART_UNIT = 1000;

/**
 * The refusal speed in KIAS read off one chart: `chart` '' reads the panels `gw` and `runway`, 'snow' and 'icy' read
 * `gw_snow` / `runway_snow` and `gw_icy` / `runway_icy`; every chart reads the panels `wind` and `slope`.
 *
 * Rounding points, each in KIAS (STEPS.speedKt): `<p>.runway`, `<p>.wind`, `<p>.slope`, where `<p>` is `prefix`
 * (e.g. `b2-5.sh1`), or `prefix.chart` on a sheet with two charts (`b2-5.sh3.snow`). The carried position between
 * the GW curves and the runway lines has no printed scale and is never read through `ctx.read`: a pilot carries the
 * line, not a number.
 *
 * Wind and slope are drawn as magnitudes: the sign picks the family (headwind / tailwind, uphill / downhill) and the
 * panel reads `Math.abs` (ruling R8). A zero wind or slope skips its panel but still reads its id.
 *
 * The first panel out of chart stops the read, and no later id is read. Every OutOfChart names a pilot input or the
 * refusal speed, never the carried axis: a carried position the runway lines do not draw (the speed would lie off
 * the top or the bottom of the chart) is OutOfChart on the GW panel's `gross_weight`, in its chart unit (1000 lb),
 * with no drawn range, since no one range of GW holds for every takeoff factor and runway length (Review Focus 3).
 * A runway reading outside the wind or slope lines is OutOfChart on `refusal_speed` (ruling P15).
 */
export function refusalSpeed(
  ctx: Ctx,
  fig: FigureFile,
  prefix: string,
  chart: '' | 'snow' | 'icy',
  i: RefusalInputs,
): Read<number> {
  const suffix = chart === '' ? '' : `_${chart}`;
  const ids = chart === '' ? prefix : `${prefix}.${chart}`;

  const gw = panel(fig, `gw${suffix}`, 'curve_family');
  const grossWeight = i.grossWeightLb / LB_PER_CHART_UNIT;
  const carried = curveFamily(gw, fig.id, i.takeoffFactor, grossWeight);
  if (!carried.ok) return carried;

  const runway = panel(fig, `runway${suffix}`, 'curve_family');
  const entry = curveFamily(runway, fig.id, carried.value, i.runwayFt);
  if (!entry.ok) {
    return entry.error.input === runway.input.name ? outOfChart(fig.id, gw.param.name, grossWeight, null) : entry;
  }
  let kt = ctx.read(`${ids}.runway`, entry.value, STEPS.speedKt);

  const steps: readonly { id: string; panel: string; family: string; target: number; skip: boolean }[] = [
    {
      id: `${ids}.wind`,
      panel: 'wind',
      family: i.headwindKt > 0 ? 'headwind' : 'tailwind',
      target: Math.abs(i.headwindKt),
      skip: i.headwindKt === 0,
    },
    {
      id: `${ids}.slope`,
      panel: 'slope',
      family: i.slopePct > 0 ? 'uphill' : 'downhill',
      target: Math.abs(i.slopePct),
      skip: i.slopePct === 0,
    },
  ];
  for (const step of steps) {
    if (!step.skip) {
      const moved = guidelinePanel(panel(fig, step.panel, 'guideline_panel'), fig.id, step.family, kt, step.target);
      if (!moved.ok) return moved;
      kt = moved.value;
    }
    kt = ctx.read(step.id, kt, STEPS.speedKt);
  }
  return ok(kt);
}
