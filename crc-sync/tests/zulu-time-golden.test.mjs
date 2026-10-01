import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/* S-14: zulu-time.js's answers on a broad input table, captured from the code
 * BEFORE the typed-time wrapper moved into it from fdr-store.js. Any change
 * to what a typed time resolves to fails here. */
const here = path.dirname(fileURLToPath(import.meta.url));
const g = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/zulu-time-golden.json'), 'utf8'));
const { parseZuluHhmm, resolveZuluHhmm, resolveZuluHhmmAfter, formatZuluHhmm } = await import('../src/efsp/zulu-time.js');
const { normalizeMtrValue } = await import('../src/efsp/fdr-store.js');

// The fixture is JSON, which has no undefined / NaN / Infinity.
const un = (v) => (v && typeof v === 'object' && 'undef' in v ? undefined : v && typeof v === 'object' && 'num' in v ? Number(v.num) : v);

test('parseZuluHhmm answers as captured', () => {
  for (const c of g.parse) assert.deepEqual(parseZuluHhmm(un(c.in)), c.out, JSON.stringify(c.in));
});
test('resolveZuluHhmm answers as captured', () => {
  for (const c of g.resolve) assert.equal(resolveZuluHhmm(un(c.text), un(c.now)), c.out, JSON.stringify(c));
});
test('resolveZuluHhmmAfter answers as captured', () => {
  for (const c of g.after) assert.equal(resolveZuluHhmmAfter(un(c.text), un(c.after)), c.out, JSON.stringify(c));
});
test('formatZuluHhmm answers as captured', () => {
  for (const c of g.format) assert.equal(formatZuluHhmm(un(c.ms)), c.out, JSON.stringify(c));
});
test('a typed MTR time (the fdr-store typed-time wrapper) answers as captured', () => {
  for (const c of g.mtr) assert.deepEqual(normalizeMtrValue(c.path, c.value, c.now), c.out, JSON.stringify(c));
});
