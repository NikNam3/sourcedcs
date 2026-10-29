import type { ScalePair } from '../data/types.ts';
import { ok, outOfChart, type Read } from '../result.ts';
import { clampWithin, edgeTolerance } from './interp.ts';

/**
 * The `to` value printed beside `from`: a * from + b. Outside the drawn `to` scale (`range`, with
 * the edge tolerance of its span, clamped to its ends) it gives OutOfChart on `to` (ruling R2).
 */
export function scalePair(p: ScalePair, figure: string, from: number): Read<number> {
  const to = p.a * from + p.b;
  const value = clampWithin(p.range, to, edgeTolerance(p.range));
  return value === undefined ? outOfChart(figure, p.to.name, to, p.range) : ok(value);
}
