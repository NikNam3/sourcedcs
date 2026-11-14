/**
 * The manual's worked examples, run on the extracted data: step 0's gate (TOLD.md 0.6). Every expected value of
 * every spec's sample problems, after the documented errata, must come out of the data within 2 %.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { applyErrata, loadErrata } from './helpers/errata.ts';
import { SAMPLE_RUNNERS } from './helpers/sample-runners.ts';
import { loadSpecs } from './helpers/specs.ts';

const TOLERANCE = 0.02;

const specs = loadSpecs().filter((spec) => (spec.sample_problems?.length ?? 0) > 0);
const errata = loadErrata();

// Update this pinned list when a spec gains sample_problems.
test('the specs with sample problems are pinned', () => {
  assert.deepEqual(
    specs.map((spec) => spec.id),
    ['B2-1', 'B2-2', 'B2-3', 'B2-4', 'B2-6.sh1', 'B7-1', 'B7-2.sh1', 'B7-2.sh2'],
  );
});

describe('sample problems within 2 % of the manual', () => {
  for (const spec of specs) {
    applyErrata(spec, errata).forEach((problem, index) => {
      test(`${spec.id} sample ${String(index)}: ${JSON.stringify(problem.inputs)}`, (t) => {
        const runner = SAMPLE_RUNNERS[spec.id];
        assert.ok(runner !== undefined, `${spec.id} has sample problems but no runner in SAMPLE_RUNNERS`);
        const outputs = runner(problem.inputs);
        for (const [key, expected] of Object.entries(problem.expected)) {
          const read = outputs[key];
          assert.ok(read !== undefined, `${spec.id} runner has no output ${key}`);
          assert.ok(read.ok, `${spec.id} ${key}: ${read.ok ? '' : JSON.stringify(read.error)}`);
          const error = (read.value - expected) / expected;
          t.diagnostic(`${key}: ${read.value.toFixed(3)} vs ${String(expected)} (${(error * 100).toFixed(2)} %)`);
          assert.ok(
            Math.abs(error) <= TOLERANCE,
            `${spec.id} ${key}: ${String(read.value)} is ${(error * 100).toFixed(2)} % from ${String(expected)}`,
          );
        }
      });
    });
  }
});
