import type { SingleCurve } from '../data/types.ts';
import { ok, outOfChart, type Read } from '../result.ts';
import { drawnRange, edgeTolerance, interpWithin } from './interp.ts';

/** The curve's output at `input`; OutOfChart on the input beyond its drawn ends (with the edge tolerance). */
export function singleCurve(p: SingleCurve, figure: string, input: number): Read<number> {
  const range = drawnRange(p.points);
  const value = interpWithin(p.points, input, edgeTolerance(range));
  return value === undefined ? outOfChart(figure, p.input.name, input, range) : ok(value);
}
