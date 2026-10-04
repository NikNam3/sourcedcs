import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { memoryPolicy, RETENTION_MIN, MEMORY_MIN_RUN_MIN, PRODUCTION_RETENTION_MS } = require('../tools/soak/report.js');
const { describeRetention, retentionMinFromEnv, ENV_KEY } = require('../tools/soak/retention.js');

test('the soak judges against its own 2 h retention, not production\'s 12 h (ADR 0107)', () => {
  assert.equal(RETENTION_MIN, 120);
  assert.equal(PRODUCTION_RETENTION_MS, 12 * 3600 * 1000);
  assert.equal(memoryPolicy({ minutes: 240 }).judged, true, 'a 4 h run is still judged');
  assert.equal(describeRetention(120, PRODUCTION_RETENTION_MS), 'soak retention 2 h (production 12 h)');
});

test('--retention-min travels by environment and drives the policy', () => {
  assert.equal(retentionMinFromEnv({}), 120);
  assert.equal(retentionMinFromEnv({ [ENV_KEY]: '45' }), 45);
  assert.equal(retentionMinFromEnv({ [ENV_KEY]: 'x' }), 120);
  const p = memoryPolicy({ minutes: 240, retentionMin: 200 });
  assert.equal(p.judged, true);
  assert.ok(p.warmup >= 200);
  assert.equal(memoryPolicy({ minutes: 240, warmupMin: 100, retentionMin: 200 }).judged, false);
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
