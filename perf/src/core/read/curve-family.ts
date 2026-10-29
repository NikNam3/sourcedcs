import type { CurveFamily } from '../data/types.ts';
import { ok, outOfChart, type Read } from '../result.ts';
import { drawnRange, edgeTolerance, interpWithin, unionRange } from './interp.ts';

/**
 * The family's output at `input` for `param`, linear in param between the two bracketing curves
 * (the last pair when param equals the last value). A param exactly on a curve reads that curve
 * alone. A param outside the curves gives OutOfChart on the param; an input a curve it needs does
 * not draw (with the edge tolerance of the whole family's input span) gives OutOfChart on the
 * input, with that curve's range, or the two curves' common range when it interpolates.
 */
export function curveFamily(p: CurveFamily, figure: string, input: number, param: number): Read<number> {
  const first = p.curves[0];
  const last = p.curves[p.curves.length - 1];
  if (first === undefined || last === undefined) throw new Error(`curve family "${p.id}" has no curves`);
  if (!(param >= first.param && param <= last.param)) {
    return outOfChart(figure, p.param.name, param, [first.param, last.param]);
  }

  // The first pair whose upper curve is at or above param; a family of one curve pairs it with itself.
  let lo = first;
  let hi = first;
  for (let i = 0; i < p.curves.length - 1; i++) {
    const next = p.curves[i + 1];
    lo = p.curves[i] ?? first;
    hi = next ?? first;
    if (param <= hi.param) break;
  }

  const tolerance = edgeTolerance(unionRange(p.curves.map((curve) => drawnRange(curve.points))));
  // A param exactly on a curve reads that curve alone: its neighbour may be drawn shorter.
  const exact = param === lo.param ? lo : param === hi.param ? hi : undefined;
  if (exact !== undefined) {
    const value = interpWithin(exact.points, input, tolerance);
    return value === undefined ? outOfChart(figure, p.input.name, input, drawnRange(exact.points)) : ok(value);
  }
  const atLo = interpWithin(lo.points, input, tolerance);
  const atHi = interpWithin(hi.points, input, tolerance);
  if (atLo === undefined || atHi === undefined) {
    const [loRange, hiRange] = [drawnRange(lo.points), drawnRange(hi.points)];
    const common: [number, number] = [Math.max(loRange[0], hiRange[0]), Math.min(loRange[1], hiRange[1])];
    return outOfChart(figure, p.input.name, input, common[0] <= common[1] ? common : null);
  }
  const fraction = (param - lo.param) / (hi.param - lo.param);
  return ok(atLo + fraction * (atHi - atLo));
}
