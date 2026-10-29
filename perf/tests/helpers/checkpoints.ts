/**
 * Reads the hand-read checkpoints (`extraction/checkpoints/<spec id>.yaml`): for a chart with no sample problem,
 * values a person read off the printed page, each with the tolerance of that reading. The file name is the spec id;
 * each file is a non-empty list of checkpoints in the format below, and any other key, a missing key or a
 * non-finite number throws naming the file.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { exactKeys, isFiniteNumber, isRecord } from './specs.ts';

export interface Checkpoint {
  /** Sample-runner input keys (`takeoff_factor`, `gross_weight_lb`, …). */
  inputs: Record<string, number>;
  /** Sample-runner output keys (`refusal_rcr23_kias`, …). */
  expected: Record<string, number>;
  /** How far the computed value may lie from `expected`, in kt. */
  tolerance_kias: number;
  source: 'hand';
  read_by: string;
  /** YYYY-MM-DD. */
  date: string;
}

/** `perf/extraction/checkpoints/`, from this file rather than the working directory (R14). */
export const CHECKPOINTS_DIR = fileURLToPath(new URL('../../extraction/checkpoints/', import.meta.url));

const KEYS = ['inputs', 'expected', 'tolerance_kias', 'source', 'read_by', 'date'] as const;

function numbers(value: unknown, where: string): Record<string, number> {
  if (!isRecord(value) || Object.keys(value).length === 0) throw new Error(`${where} is not a non-empty mapping`);
  const out: Record<string, number> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!isFiniteNumber(v)) throw new Error(`${where}.${key} is not a finite number`);
    out[key] = v;
  }
  return out;
}

function checkpointOf(value: unknown, where: string): Checkpoint {
  if (!isRecord(value)) throw new Error(`${where}: not a mapping`);
  exactKeys(value, KEYS, where);
  const { tolerance_kias: tolerance, source, read_by: readBy, date } = value;
  if (!isFiniteNumber(tolerance) || tolerance <= 0) {
    throw new Error(`${where}: tolerance_kias is not a positive finite number`);
  }
  if (source !== 'hand') throw new Error(`${where}: source is not hand`);
  if (typeof readBy !== 'string' || readBy.trim() === '')
    throw new Error(`${where}: read_by is not a non-empty string`);
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`${where}: date is not YYYY-MM-DD`);
  }
  return {
    inputs: numbers(value.inputs, `${where}: inputs`),
    expected: numbers(value.expected, `${where}: expected`),
    tolerance_kias: tolerance,
    source,
    read_by: readBy,
    date,
  };
}

/**
 * Every `*.yaml` in `dir`, sorted by file name, keyed by spec id (the file name without `.yaml`); none when the
 * directory is missing.
 */
export function loadCheckpoints(dir: string = CHECKPOINTS_DIR): Map<string, Checkpoint[]> {
  const out = new Map<string, Checkpoint[]>();
  if (!existsSync(dir)) return out;
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.yaml'))
    .sort();
  for (const file of files) {
    const raw: unknown = parse(readFileSync(join(dir, file), 'utf8'));
    if (!Array.isArray(raw) || raw.length === 0) throw new Error(`${file}: not a non-empty list`);
    out.set(
      file.slice(0, -'.yaml'.length),
      raw.map((entry, i) => checkpointOf(entry, `${file}: checkpoint ${String(i)}`)),
    );
  }
  return out;
}
