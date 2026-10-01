'use strict';

// The pure parts of e2e/tools/run-sharded.js: the split into shards, flattening a Playwright report,
// and merging shard results into one summary. The process handling is exercised by running the tool.

const test = require('node:test');
const assert = require('node:assert/strict');
const { splitShards, parseReport, mergeSummary, updateTimings, rerunCommand } = require('../e2e/tools/run-sharded');

test('split: every file lands in exactly one shard', () => {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((x) => x + '.spec.js');
  const shards = splitShards(files, 3, {});
  assert.deepEqual(shards.flatMap((s) => s.files).sort(), files);
});

test('split: without timings it balances by test count', () => {
  const counts = { 'a.spec.js': 9, 'b.spec.js': 3, 'c.spec.js': 3, 'd.spec.js': 3 };
  const shards = splitShards(Object.keys(counts), 2, {}, counts);
  assert.deepEqual(shards.map((s) => s.weight).sort(), [9, 9]);
});

test('split: with neither timings nor counts it balances by file count', () => {
  const files = Array.from({ length: 10 }, (_, i) => `s${i}.spec.js`);
  const sizes = splitShards(files, 3, {}).map((s) => s.files.length).sort();
  assert.deepEqual(sizes, [3, 3, 4]);
});

test('split: measured durations balance by time, not count', () => {
  const t = { 'big.spec.js': 100, 'a.spec.js': 30, 'b.spec.js': 30, 'c.spec.js': 30, 'd.spec.js': 10 };
  const shards = splitShards(Object.keys(t), 2, t);
  const w = shards.map((s) => s.weight).sort((x, y) => x - y);
  assert.deepEqual(w, [100, 100]);
  assert.deepEqual(shards.find((s) => s.files.includes('big.spec.js')).files, ['big.spec.js']);
});

test('split: a spec without a timing is weighted by its tests at the median seconds-per-test', () => {
  const shards = splitShards(['a.spec.js', 'b.spec.js', 'new.spec.js'], 2, { 'a.spec.js': 10, 'b.spec.js': 30 }, { 'a.spec.js': 1, 'b.spec.js': 3, 'new.spec.js': 4 });
  assert.equal(shards.reduce((a, s) => a + s.weight, 0), 10 + 30 + 40);
});

test('split: more shards than files drops the empty ones; bad n throws', () => {
  assert.equal(splitShards(['a.spec.js'], 4, {}).length, 1);
  assert.throws(() => splitShards(['a.spec.js'], 0, {}));
});

const report = {
  suites: [
    { file: 'x.spec.js', specs: [], suites: [{ title: 'grp', file: 'x.spec.js', specs: [
      { title: 't1', file: 'x.spec.js', line: 5, tests: [{ status: 'expected', results: [{ duration: 1500 }] }] },
      { title: 't2', file: 'x.spec.js', line: 9, tests: [{ status: 'unexpected', results: [{ duration: 2000, error: { message: 'boom\nstack' } }] }] },
    ] }] },
    { file: 'y.spec.js', specs: [
      { title: 't3', file: 'y.spec.js', line: 3, tests: [{ status: 'flaky', results: [{ duration: 500 }, { duration: 500 }] }] },
      { title: 't4', file: 'y.spec.js', line: 4, tests: [{ status: 'skipped', results: [] }] },
    ] },
  ],
};

test('parseReport flattens nested suites into one row per test', () => {
  const rows = parseReport(report);
  assert.deepEqual(rows.map((r) => [r.file, r.line, r.status]), [['x.spec.js', 5, 'passed'], ['x.spec.js', 9, 'failed'], ['y.spec.js', 3, 'flaky'], ['y.spec.js', 4, 'skipped']]);
  assert.equal(rows[1].error, 'boom');
  assert.equal(rows[2].seconds, 1);
});

test('mergeSummary counts, lists failures and finds files that never reported', () => {
  const rows = parseReport(report);
  const sum = mergeSummary([
    { lane: 7, files: ['x.spec.js'], rows: rows.filter((r) => r.file === 'x.spec.js'), crashed: false },
    { lane: 8, files: ['y.spec.js', 'z.spec.js'], rows: rows.filter((r) => r.file === 'y.spec.js'), crashed: true },
  ]);
  assert.deepEqual(sum.totals, { tests: 4, passed: 1, failed: 1, flaky: 1, skipped: 1 });
  assert.equal(sum.failures.length, 1);
  assert.deepEqual(sum.missing, [{ file: 'z.spec.js', lane: 8 }]);
  assert.deepEqual(sum.crashedLanes, [8]);
  assert.equal(rerunCommand(7, sum.failures[0]), 'E2E_LANE=7 npx playwright test e2e/x.spec.js:9');
});

test('updateTimings overlays fresh durations and keeps the rest', () => {
  assert.deepEqual(updateTimings({ 'a.spec.js': 5, 'b.spec.js': 6 }, [{ file: 'a.spec.js', seconds: 7.04 }]), { 'a.spec.js': 7, 'b.spec.js': 6 });
});
