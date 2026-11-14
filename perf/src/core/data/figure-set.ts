import type { FigureFile } from './types.ts';

/** The figure files a computation reads, by figure id (`B2-3`, `B2-5.sh1`). The app loads them; core never does. */
export type FigureSet = Readonly<Record<string, FigureFile>>;

/** The figure with this id. A missing id is a data defect and throws. */
export function figure(set: FigureSet, id: string): FigureFile {
  const found = Object.hasOwn(set, id) ? set[id] : undefined;
  if (found === undefined) throw new Error(`the figure set has no figure "${id}"`);
  return found;
}
