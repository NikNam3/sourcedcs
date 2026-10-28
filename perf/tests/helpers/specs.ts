/**
 * Reads the hand-written chart specs (`extraction/specs/*.yaml`) for the tests. Only the keys the tests use
 * are checked and returned; the extractor owns the rest.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

export interface SampleProblem {
  inputs: Record<string, number | boolean>;
  expected: Record<string, number>;
}

export interface ChartSpec {
  id: string;
  figure: string;
  sheet: number | null;
  sample_problems?: SampleProblem[];
}

/** `perf/extraction/specs/`, from this file rather than the working directory (R14). */
export const SPECS_DIR = fileURLToPath(new URL('../../extraction/specs/', import.meta.url));

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sampleProblem(value: unknown, where: string): SampleProblem {
  if (!isRecord(value)) throw new Error(`${where}: not a mapping`);
  const { inputs, expected } = value;
  if (!isRecord(inputs)) throw new Error(`${where}: inputs is not a mapping`);
  if (!isRecord(expected)) throw new Error(`${where}: expected is not a mapping`);
  const outInputs: Record<string, number | boolean> = {};
  for (const [key, v] of Object.entries(inputs)) {
    if (typeof v !== 'number' && typeof v !== 'boolean') {
      throw new Error(`${where}: inputs.${key} is not a number or a boolean`);
    }
    outInputs[key] = v;
  }
  const outExpected: Record<string, number> = {};
  for (const [key, v] of Object.entries(expected)) {
    if (typeof v !== 'number') throw new Error(`${where}: expected.${key} is not a number`);
    outExpected[key] = v;
  }
  return { inputs: outInputs, expected: outExpected };
}

function chartSpec(value: unknown, file: string): ChartSpec {
  if (!isRecord(value)) throw new Error(`${file}: not a mapping`);
  const { id, figure, sheet, sample_problems: problems } = value;
  if (typeof id !== 'string' || id === '') throw new Error(`${file}: id is not a non-empty string`);
  if (typeof figure !== 'string' || figure === '') throw new Error(`${file}: figure is not a non-empty string`);
  if (sheet !== null && typeof sheet !== 'number') throw new Error(`${file}: sheet is not a number or null`);
  const spec: ChartSpec = { id, figure, sheet };
  if (problems !== undefined) {
    if (!Array.isArray(problems)) throw new Error(`${file}: sample_problems is not a list`);
    spec.sample_problems = problems.map((p, i) => sampleProblem(p, `${file}: sample_problems[${String(i)}]`));
  }
  return spec;
}

/** Every `*.yaml` in `dir`, sorted by file name; none when the directory is empty or missing. */
export function loadSpecs(dir: string = SPECS_DIR): ChartSpec[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.yaml'))
    .sort()
    .map((name) => chartSpec(parse(readFileSync(join(dir, name), 'utf8')), name));
}
