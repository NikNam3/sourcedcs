import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { MutationLog } = await import('../src/efsp/mutation-log.js');

function tmpLogPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-mutation-log-test-'));
  return path.join(dir, 'efsp-mutations.jsonl');
}

test('readAll on a log file that does not exist yet returns an empty array, not a throw', () => {
  const log = new MutationLog(tmpLogPath());
  assert.deepEqual(log.readAll(), []);
});

test('record() appends one JSON line per call, readAll() returns them in append order', () => {
  const log = new MutationLog(tmpLogPath());
  log.record({ stripId: 's1', op: 'CreateStrip', at: 1 });
  log.record({ stripId: 's1', op: 'MoveStrip', at: 2 });
  log.record({ stripId: 's2', op: 'CreateStrip', at: 3 });

  const entries = log.readAll();
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map(e => e.op), ['CreateStrip', 'MoveStrip', 'CreateStrip']);
  assert.deepEqual(entries.map(e => e.at), [1, 2, 3]);
});

test('record() preserves full entry shape including nested before/after objects', () => {
  const log = new MutationLog(tmpLogPath());
  const entry = {
    clientMutationId: 'cmid-1',
    op: 'SetBlock',
    stripId: 's1',
    actingPositionId: 'GND',
    actorId: 'controller-1',
    at: 12345,
    before: { state: 'PROPOSED' },
    after: { state: 'PENDING_CLEARANCE' },
  };
  log.record(entry);
  assert.deepEqual(log.readAll(), [entry]);
});

test('the log is append-only across multiple MutationLog instances pointed at the same file (simulates a restart)', () => {
  const filePath = tmpLogPath();
  const log1 = new MutationLog(filePath);
  log1.record({ op: 'CreateStrip', at: 1 });

  const log2 = new MutationLog(filePath); // simulates a fresh process re-opening the same file
  log2.record({ op: 'MoveStrip', at: 2 });

  assert.equal(new MutationLog(filePath).readAll().length, 2);
});

test('record() never throws even if the target directory does not exist', () => {
  const log = new MutationLog('/nonexistent-dir-xyz/efsp-mutations.jsonl');
  assert.doesNotThrow(() => log.record({ op: 'CreateStrip', at: 1 }));
});
