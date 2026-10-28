import type { GuidelinePanel } from '../data/types.ts';
import { ok, outOfChart, type Read } from '../result.ts';
import { drawnRange, edgeTolerance, interpWithin, unionRange } from './interp.ts';

/**
 * Moves `entry` (an output value at the panel's baseline) to `target` along the guide lines of one
 * family, keeping its fraction between the two bracketing lines.
 *
 * - `target === baseline` returns `entry` before any line check (ruling R1).
 * - A line is usable when it draws both baseline and target, within the edge tolerance of the
 *   panel's param span (all lines of all families); a read beyond a drawn end clamps to it.
 * - Fewer than two usable lines: OutOfChart on the input (the param), with the range over which at
 *   least two lines that draw the baseline also draw the target (null when there is none).
 * - An entry outside the outermost usable lines at the baseline: OutOfChart on the output.
 *
 * An unknown family is a data defect and throws.
 */
export function guidelinePanel(
  p: GuidelinePanel,
  figure: string,
  family: string,
  entry: number,
  target: number,
): Read<number> {
  if (target === p.baseline) return ok(entry);
  const lines = Object.hasOwn(p.families, family) ? p.families[family] : undefined;
  if (lines === undefined) throw new Error(`guideline panel "${p.id}" has no family "${family}"`);

  const tolerance = edgeTolerance(
    unionRange(
      Object.values(p.families)
        .flat()
        .map((line) => drawnRange(line)),
    ),
  );
  const usable: { atBaseline: number; atTarget: number }[] = [];
  const throughBaseline: [number, number][] = [];
  for (const line of lines) {
    const atBaseline = interpWithin(line, p.baseline, tolerance);
    if (atBaseline === undefined) continue;
    throughBaseline.push(drawnRange(line));
    const atTarget = interpWithin(line, target, tolerance);
    if (atTarget !== undefined) usable.push({ atBaseline, atTarget });
  }

  if (usable.length < 2) return outOfChart(figure, p.input.name, target, twoLineRange(throughBaseline));

  usable.sort((a, b) => a.atBaseline - b.atBaseline);
  const lowest = usable[0];
  const highest = usable[usable.length - 1];
  if (lowest === undefined || highest === undefined) throw new Error('unreachable: two usable lines');
  if (!(entry >= lowest.atBaseline && entry <= highest.atBaseline)) {
    return outOfChart(figure, p.output.name, entry, [lowest.atBaseline, highest.atBaseline]);
  }

  let below = lowest;
  let above = lowest;
  for (let i = 0; i < usable.length - 1; i++) {
    below = usable[i] ?? lowest;
    above = usable[i + 1] ?? highest;
    if (entry <= above.atBaseline) break;
  }
  const span = above.atBaseline - below.atBaseline;
  const fraction = span === 0 ? 0 : (entry - below.atBaseline) / span;
  return ok(below.atTarget + fraction * (above.atTarget - below.atTarget));
}

/**
 * Where at least two of these lines are drawn. Each holds the baseline, so on either side of it the
 * second-widest end bounds the reach of two lines: [second-lowest start, second-highest end].
 */
function twoLineRange(ranges: readonly [number, number][]): [number, number] | null {
  const starts = ranges.map((range) => range[0]).sort((a, b) => a - b);
  const ends = ranges.map((range) => range[1]).sort((a, b) => b - a);
  const start = starts[1];
  const end = ends[1];
  return start === undefined || end === undefined ? null : [start, end];
}
