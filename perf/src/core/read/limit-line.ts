import type { LimitLine } from '../data/types.ts';
import { drawnRange, edgeTolerance, interpWithin } from './interp.ts';

/**
 * Whether (input, output) lies beyond the limit line, on its `beyond` side. A point exactly on the line is not
 * beyond it. An input outside the line's drawn range (with the edge tolerance), or no number, is not judged: null.
 */
export function beyondLimit(p: LimitLine, input: number, output: number): boolean | null {
  const line = interpWithin(p.points, input, edgeTolerance(drawnRange(p.points)));
  if (line === undefined || Number.isNaN(output)) return null;
  return p.beyond === 'above' ? output > line : output < line;
}
