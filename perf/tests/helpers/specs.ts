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

/** A finite number: YAML's `.nan` and `.inf` are numbers too, and no chart value is either. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Throws naming `where` and the key when `entry` lacks one of `keys` or has any other key. */
export function exactKeys(entry: Record<string, unknown>, keys: readonly string[], where: string): void {
  for (const key of keys) if (!(key in entry)) throw new Error(`${where}: missing ${key}`);
  for (const key of Object.keys(entry)) if (!keys.includes(key)) throw new Error(`${where}: unknown key ${key}`);
}

/** `sheet` is null (a one-sheet figure) or a 1-based sheet number. */
export function isSheet(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 1);
}

function sampleProblem(value: unknown, where: string): SampleProblem {
  if (!isRecord(value)) throw new Error(`${where}: not a mapping`);
  const { inputs, expected } = value;
  if (!isRecord(inputs)) throw new Error(`${where}: inputs is not a mapping`);
  if (!isRecord(expected)) throw new Error(`${where}: expected is not a mapping`);
  const outInputs: Record<string, number | boolean> = {};
  for (const [key, v] of Object.entries(inputs)) {
    if (!isFiniteNumber(v) && typeof v !== 'boolean') {
      throw new Error(`${where}: inputs.${key} is not a finite number or a boolean`);
    }
    outInputs[key] = v;
  }
  const outExpected: Record<string, number> = {};
  for (const [key, v] of Object.entries(expected)) {
    if (!isFiniteNumber(v)) throw new Error(`${where}: expected.${key} is not a finite number`);
    outExpected[key] = v;
  }
  return { inputs: outInputs, expected: outExpected };
}

function chartSpec(value: unknown, file: string): ChartSpec {
  if (!isRecord(value)) throw new Error(`${file}: not a mapping`);
  const { id, figure, sheet, sample_problems: problems } = value;
  const fileId = file.slice(0, -'.yaml'.length);
  if (id !== fileId) throw new Error(`${file}: id is not the file name ${fileId}`);
  if (typeof figure !== 'string' || figure === '') throw new Error(`${file}: figure is not a non-empty string`);
  if (!isSheet(sheet)) throw new Error(`${file}: sheet is not null or a positive integer`);
  const spec: ChartSpec = { id: fileId, figure, sheet };
  if (problems !== undefined) {
    if (!Array.isArray(problems)) throw new Error(`${file}: sample_problems is not a list`);
    spec.sample_problems = problems.map((p, i) => sampleProblem(p, `${file}: sample_problems[${String(i)}]`));
  }
  return spec;
}

/**
 * Every `*.yaml` in `dir`, sorted by file name; none when the directory is empty or missing. A spec's id
 * must be its file name without `.yaml`, so no two spec files share an id.
 */
export function loadSpecs(dir: string = SPECS_DIR): ChartSpec[] {
  if (!existsSync(dir)) return [];
  const specs = readdirSync(dir)
    .filter((name) => name.endsWith('.yaml'))
    .sort()
    .map((name) => chartSpec(parse(readFileSync(join(dir, name), 'utf8')), name));
  const seen = new Set<string>();
  for (const { id } of specs) {
    // Unreachable while the id is the file name; kept so a looser id rule cannot let two files collide.
    if (seen.has(id)) throw new Error(`${dir}: two spec files have the id ${id}`);
    seen.add(id);
  }
  return specs;
}
