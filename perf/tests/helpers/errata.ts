/**
 * Reads `extraction/manual-errata.yaml`, the manual's known misprints, and applies the ones that change a
 * sample problem's expected value.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { isRecord, type ChartSpec, type SampleProblem } from './specs.ts';

export interface Erratum {
  figure: string;
  sheet: number | null;
  where: string;
  printed: string;
  correct: string;
  reason: string;
  affects: { spec: string; sample: number; key: string; value: number } | null;
}

/** `perf/extraction/manual-errata.yaml`, from this file rather than the working directory (R14). */
export const ERRATA_PATH = fileURLToPath(new URL('../../extraction/manual-errata.yaml', import.meta.url));

const KEYS = ['figure', 'sheet', 'where', 'printed', 'correct', 'reason', 'affects'] as const;
const TEXT_KEYS = ['figure', 'where', 'printed', 'correct', 'reason'] as const;
const AFFECTS_KEYS = ['spec', 'sample', 'key', 'value'] as const;

function nonEmpty(entry: Record<string, unknown>, key: string, where: string): string {
  const value = entry[key];
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${where}: ${key} is not a non-empty string`);
  return value;
}

function exactKeys(entry: Record<string, unknown>, keys: readonly string[], where: string): void {
  for (const key of keys) if (!(key in entry)) throw new Error(`${where}: missing ${key}`);
  for (const key of Object.keys(entry)) if (!keys.includes(key)) throw new Error(`${where}: unknown key ${key}`);
}

function affectsOf(value: unknown, where: string): Erratum['affects'] {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error(`${where}: affects is not null or a mapping`);
  exactKeys(value, AFFECTS_KEYS, `${where}: affects`);
  const { sample, value: replacement } = value;
  if (typeof sample !== 'number' || !Number.isInteger(sample) || sample < 0) {
    throw new Error(`${where}: affects.sample is not a 0-based index`);
  }
  if (typeof replacement !== 'number') throw new Error(`${where}: affects.value is not a number`);
  return {
    spec: nonEmpty(value, 'spec', `${where}: affects`),
    sample,
    key: nonEmpty(value, 'key', `${where}: affects`),
    value: replacement,
  };
}

function erratumOf(value: unknown, where: string): Erratum {
  if (!isRecord(value)) throw new Error(`${where}: not a mapping`);
  exactKeys(value, KEYS, where);
  const [figure, whereText, printed, correct, reason] = TEXT_KEYS.map((key) => nonEmpty(value, key, where)) as [
    string,
    string,
    string,
    string,
    string,
  ];
  const { sheet } = value;
  if (sheet !== null && typeof sheet !== 'number') throw new Error(`${where}: sheet is not a number or null`);
  return { figure, sheet, where: whereText, printed, correct, reason, affects: affectsOf(value.affects, where) };
}

/** The errata list; throws naming the entry when one lacks a key, has an unknown key or an empty string. */
export function loadErrata(path: string = ERRATA_PATH): Erratum[] {
  const raw: unknown = parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(raw)) throw new Error(`${path}: not a list`);
  return raw.map((entry, i) => erratumOf(entry, `${path}: entry ${String(i)}`));
}

/**
 * Copies of `spec`'s sample problems with every expected value an erratum names replaced; `spec` is left
 * unchanged. Throws when an erratum for this spec names a sample that does not exist or a key that sample
 * does not already expect (a typo must not add an expected value nobody checks).
 */
export function applyErrata(spec: ChartSpec, errata: readonly Erratum[]): SampleProblem[] {
  const problems = (spec.sample_problems ?? []).map((p) => ({ inputs: { ...p.inputs }, expected: { ...p.expected } }));
  for (const { affects } of errata) {
    if (affects?.spec !== spec.id) continue;
    const problem = problems[affects.sample];
    if (problem === undefined) {
      throw new Error(`erratum for ${spec.id}: sample ${String(affects.sample)} does not exist`);
    }
    if (!(affects.key in problem.expected)) {
      throw new Error(`erratum for ${spec.id}: sample ${String(affects.sample)} has no expected ${affects.key}`);
    }
    problem.expected[affects.key] = affects.value;
  }
  return problems;
}
