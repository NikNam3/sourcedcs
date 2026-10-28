import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * The extractor (Python) checks every guide line and scale range against the reader's edge
 * tolerance (ruling R1) with its own hand copy of the constant. Both copies must stay equal.
 */
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

function constant(text: string, pattern: RegExp, file: string): number {
  const matches = [...text.matchAll(pattern)];
  assert.equal(matches.length, 1, `${file}: expected exactly one EDGE_TOLERANCE definition`);
  return Number(matches[0]?.[1]);
}

test('EDGE_TOLERANCE in extraction/panels.py equals the one in src/core/read/interp.ts', () => {
  const ts = constant(
    read('../src/core/read/interp.ts'),
    /^export const EDGE_TOLERANCE = ([0-9.eE+-]+);$/gm,
    'interp.ts',
  );
  const py = constant(read('../extraction/panels.py'), /^EDGE_TOLERANCE = ([0-9.eE+-]+)\s*$/gm, 'panels.py');
  assert.ok(Number.isFinite(ts) && ts > 0, `interp.ts EDGE_TOLERANCE is ${String(ts)}`);
  assert.equal(py, ts);
});
