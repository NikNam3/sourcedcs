/**
 * Refusal speed at the column's RCR (TOLD 1.7, ruling 1). The refusal charts print six RCRs: dry 23 and 16 (sheet 1),
 * 8 (snow) and 4 (icy) on sheet 3, wet 18 and 12 (sheet 2). A printed RCR reads its own sheet only; an RCR between two
 * printed ones of its surface is linear in RCR over the bracketing pair. Outside the surface's family (dry 4 to 23,
 * wet 12 to 18) there is no chart: OutOfChart on `rcr`, never a borrowed sheet (a wet runway never reads sheet 3).
 */
import { STEPS } from '../ctx.ts';
import type { Ctx } from '../ctx.ts';
import { figure } from '../data/figure-set.ts';
import type { FigureSet } from '../data/figure-set.ts';
import { refusalNonAbDry, refusalNonAbWet } from '../figures/b2-5.ts';
import { refusalAbDry, refusalAbWet } from '../figures/b2-6.ts';
import { refusalSpeed } from '../figures/refusal-speed.ts';
import type { RefusalInputs } from '../figures/refusal-speed.ts';
import { ok, outOfChart } from '../result.ts';
import type { Read } from '../result.ts';

type Mode = 'mil' | 'ab';
/** One read of a chart: sheet 1 or 2 (each gives both its RCRs), or one of sheet 3's two charts. */
type Chart = 'sh1' | 'sh2' | 'snow' | 'icy';

const FIGURE: Readonly<Record<Mode, { readonly id: string; readonly prefix: string }>> = {
  mil: { id: 'B2-5', prefix: 'b2-5' },
  ab: { id: 'B2-6', prefix: 'b2-6' },
};

/** A printed RCR: the chart that draws it, and its figure's sheet. */
interface PrintedRcr {
  readonly rcr: number;
  readonly chart: Chart;
  readonly sheet: 'sh1' | 'sh2' | 'sh3';
}

/** The printed RCRs of each surface, highest first (the sheets' order). */
const PRINTED: Readonly<Record<'dry' | 'wet', readonly PrintedRcr[]>> = {
  dry: [
    { rcr: 23, chart: 'sh1', sheet: 'sh1' },
    { rcr: 16, chart: 'sh1', sheet: 'sh1' },
    { rcr: 8, chart: 'snow', sheet: 'sh3' },
    { rcr: 4, chart: 'icy', sheet: 'sh3' },
  ],
  wet: [
    { rcr: 18, chart: 'sh2', sheet: 'sh2' },
    { rcr: 12, chart: 'sh2', sheet: 'sh2' },
  ],
};

/** Reads one chart: the speed of each printed RCR it draws. */
function readChart(
  ctx: Ctx,
  figures: FigureSet,
  mode: Mode,
  chart: Chart,
  i: RefusalInputs,
): ReadonlyMap<number, Read<number>> {
  const { id, prefix } = FIGURE[mode];
  switch (chart) {
    case 'sh1': {
      const r = (mode === 'mil' ? refusalNonAbDry : refusalAbDry)(ctx, figure(figures, `${id}.sh1`), i);
      return new Map([
        [23, r.rcr23Kias],
        [16, r.rcr16Kias],
      ]);
    }
    case 'sh2': {
      const r = (mode === 'mil' ? refusalNonAbWet : refusalAbWet)(ctx, figure(figures, `${id}.sh2`), i);
      return new Map([
        [18, r.rcr18Kias],
        [12, r.rcr12Kias],
      ]);
    }
    case 'snow':
    case 'icy':
      // Sheet 3's charts one at a time, so a printed 8 does not read the icy chart (nor 4 the snow chart).
      return new Map([
        [chart === 'snow' ? 8 : 4, refusalSpeed(ctx, figure(figures, `${id}.sh3`), `${prefix}.sh3`, chart, i)],
      ]);
  }
}

/** The printed RCRs the speed at `rcr` is read from: one on a printed value, else the bracketing pair, high first. */
function bracket(family: readonly PrintedRcr[], rcr: number): readonly PrintedRcr[] {
  const on = family.find((p) => p.rcr === rcr);
  if (on !== undefined) return [on];
  for (let k = 0; k + 1 < family.length; k++) {
    const hi = family[k];
    const lo = family[k + 1];
    if (hi !== undefined && lo !== undefined && rcr < hi.rcr && rcr > lo.rcr) return [hi, lo];
  }
  return [];
}

/**
 * The refusal speed (KIAS) at `rcr` on a `surface` runway: MIL reads B2-5, MAX AB B2-6. Rounding points: the sheets'
 * own ids (`b2-5.sh1.runway`, …, `b2-5.sh3.snow.slope`), then `<b2-5|b2-6>.<dry|wet>`, the speed at the column's RCR
 * (STEPS.speedKt), read on a printed RCR too. A sheet out of chart stops the read: its OutOfChart is the result and no
 * later id is read. An RCR outside the family reads nothing: OutOfChart on `rcr` naming the sheet at that end of the
 * family (dry above 23 sheet 1, below 4 sheet 3; wet sheet 2), with the family's range.
 */
export function refusalByRcr(
  ctx: Ctx,
  figures: FigureSet,
  mode: Mode,
  surface: 'dry' | 'wet',
  rcr: number,
  i: RefusalInputs,
): Read<number> {
  const family = PRINTED[surface];
  const highest = family[0];
  const lowest = family[family.length - 1];
  if (highest === undefined || lowest === undefined) throw new Error(`no printed RCR for ${surface}`);
  const pair = bracket(family, rcr);
  if (pair.length === 0) {
    const end = rcr > highest.rcr ? highest : lowest;
    return outOfChart(`${FIGURE[mode].id}.${end.sheet}`, 'rcr', rcr, [lowest.rcr, highest.rcr]);
  }

  // A chart is read once even when both its RCRs bracket the value (dry 16 to 23 reads sheet 1 once).
  const charts = new Map<Chart, ReadonlyMap<number, Read<number>>>();
  const speeds: { rcr: number; kias: number }[] = [];
  for (const printed of pair) {
    const readings = charts.get(printed.chart) ?? readChart(ctx, figures, mode, printed.chart, i);
    charts.set(printed.chart, readings);
    const read = readings.get(printed.rcr);
    if (read === undefined) throw new Error(`unreachable: chart ${printed.chart} draws RCR ${String(printed.rcr)}`);
    if (!read.ok) return read;
    speeds.push({ rcr: printed.rcr, kias: read.value });
  }
  const [hi, lo] = speeds;
  if (hi === undefined) throw new Error('unreachable: a bracket holds one or two RCRs');
  const kias = lo === undefined ? hi.kias : lo.kias + ((rcr - lo.rcr) / (hi.rcr - lo.rcr)) * (hi.kias - lo.kias);
  return ok(ctx.read(`${FIGURE[mode].prefix}.${surface}`, kias, STEPS.speedKt));
}
