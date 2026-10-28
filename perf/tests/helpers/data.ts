/**
 * Loads the extracted chart data for the tests. The app fetches the same files; src/core/ never reads them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { FigureFile } from '../../src/core/data/types.ts';

/** `perf/data/f16c-f110-129/`, from this file rather than the working directory. */
export const DATASET_DIR = fileURLToPath(new URL('../../data/f16c-f110-129/', import.meta.url));

/**
 * `perf/data/f16c-f110-129/<id>.json`. The data is checked against its schema by `npm run data:check`; this only
 * checks that the file is the figure asked for.
 */
export function loadFigure(id: string): FigureFile {
  const figure = JSON.parse(readFileSync(`${DATASET_DIR}${id}.json`, 'utf8')) as FigureFile;
  if (figure.id !== id) throw new Error(`${id}.json holds figure ${figure.id}`);
  return figure;
}
