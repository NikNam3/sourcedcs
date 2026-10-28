/**
 * Linear interpolation over a drawn polyline, and the edge tolerance every building block shares.
 * Points are [input, output], sorted by input, ascending.
 */

type Points = readonly (readonly [number, number])[];

/**
 * Extracted curves stop a hair inside the frame (B2-1 starts at -39.9996 C, tailwind lines end at
 * 19.989 kt). An input this fraction of the panel's drawn input span beyond a drawn end reads the
 * end value; further out is OutOfChart (ruling R1).
 */
export const EDGE_TOLERANCE = 0.002;

/** Linear between the drawn points; undefined outside [first input, last input], and for NaN. */
export function interp(points: Points, x: number): number | undefined {
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (point === undefined || !(x >= point[0])) return undefined;
    const next = points[i + 1];
    if (x === point[0]) return point[1];
    if (next !== undefined && x <= next[0]) {
      return point[1] + ((next[1] - point[1]) * (x - point[0])) / (next[0] - point[0]);
    }
  }
  return undefined;
}

/** The first and last drawn input. No points is a data defect. */
export function drawnRange(points: Points): [number, number] {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) throw new Error('a drawn line has no points');
  return [first[0], last[0]];
}

/** The smallest range holding every given range. No ranges is a data defect. */
export function unionRange(ranges: readonly (readonly [number, number])[]): [number, number] {
  if (ranges.length === 0) throw new Error('a panel has no drawn lines');
  return [Math.min(...ranges.map((range) => range[0])), Math.max(...ranges.map((range) => range[1]))];
}

/** EDGE_TOLERANCE of a drawn span. */
export function edgeTolerance(span: readonly [number, number]): number {
  return EDGE_TOLERANCE * (span[1] - span[0]);
}

/** x clamped into [lo, hi] when it lies within `tolerance` beyond an end; undefined further out or for NaN. */
export function clampWithin(range: readonly [number, number], x: number, tolerance: number): number | undefined {
  if (!(x >= range[0] - tolerance && x <= range[1] + tolerance)) return undefined;
  return Math.min(Math.max(x, range[0]), range[1]);
}

/** interp, reading the end value for an x within `tolerance` beyond a drawn end. */
export function interpWithin(points: Points, x: number, tolerance: number): number | undefined {
  const clamped = clampWithin(drawnRange(points), x, tolerance);
  return clamped === undefined ? undefined : interp(points, clamped);
}
