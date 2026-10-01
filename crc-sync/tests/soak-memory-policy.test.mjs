import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { memoryPolicy, RETENTION_MIN, MEMORY_MIN_RUN_MIN } = require('../tools/soak/report.js');
const { ARCHIVE_AFTER_MS } = require('../src/efsp/archiver.js');

test('retention is read from the archiver, not hard-coded', () => {
  assert.equal(RETENTION_MIN, ARCHIVE_AFTER_MS / 60000);
});

test('runs under 3 h are not judged, with a reason', () => {
  for (const minutes of [10, 20, 60, 179]) {
    const p = memoryPolicy({ minutes });
    assert.equal(p.judged, false);
    assert.match(p.reason, /heap still filling/);
  }
});

test('a 3 h+ run defaults its warm-up to the retention and is judged', () => {
  for (const minutes of [180, 240, 600]) {
    const p = memoryPolicy({ minutes });
    assert.equal(p.judged, true);
    assert.ok(p.warmup >= RETENTION_MIN);
    assert.ok(p.warmup < minutes);
  }
});

test('--warmup-min stays an explicit override; too short a warm-up is not judged', () => {
  const p = memoryPolicy({ minutes: 240, warmupMin: 30 });
  assert.equal(p.warmup, 30);
  assert.equal(p.judged, false);
  assert.match(p.reason, /warm-up/);
  assert.equal(memoryPolicy({ minutes: 240, warmupMin: RETENTION_MIN }).judged, true);
});

test('--judge-memory forces the gate on a short run (detector proofs)', () => {
  const p = memoryPolicy({ minutes: MEMORY_MIN_RUN_MIN - 160, judgeMemory: true });
  assert.equal(p.judged, true);
  assert.equal(p.reason, null);
});
