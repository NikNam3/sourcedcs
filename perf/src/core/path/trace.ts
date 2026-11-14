/**
 * The exact paths of a chain (TOLD 1.8): the exact pass run once, as `runExact` runs it (every input at `exact`,
 * nothing rounded), with a ctx that records the figure functions' marks in order. Exact only (ruling of 12 Nov 2026):
 * the figure page draws no conservative path.
 */
import { runExact } from '../ctx.ts';
import type { Chain, ChainRun } from '../ctx.ts';

import type { PathMark } from './mark.ts';

export interface PathTrace<K extends string, S> {
  readonly run: ChainRun<K, S>;
  readonly marks: readonly PathMark[];
}

export function tracePaths<K extends string, S>(chain: Chain<K, S>): PathTrace<K, S> {
  const marks: PathMark[] = [];
  const { run } = runExact(chain, (m) => {
    marks.push(m);
  });
  return { run, marks };
}
