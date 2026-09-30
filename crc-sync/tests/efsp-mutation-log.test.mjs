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
  const [{ atSource, wallAt, ...rest }] = log.readAll();
  assert.deepEqual(rest, entry);
});

test('record() says which clock `at` came from, and adds the real time it was written (docs/adr/0079)', () => {
  const clock = { now: () => 1466476800000, source: 'MISSION' };
  const log = new MutationLog(tmpLogPath(), { clock });
  const before = Date.now();
  log.record({ op: 'CreateStrip', at: clock.now() });
  const [entry] = log.readAll();
  assert.equal(entry.at, 1466476800000, 'the store-stamped mission time is kept as-is');
  assert.equal(entry.atSource, 'MISSION');
  assert.ok(entry.wallAt >= before && entry.wallAt <= Date.now());
});

test('record() marks `at` as WALL when the log was built without a mission clock', () => {
  const log = new MutationLog(tmpLogPath());
  log.record({ op: 'CreateStrip', at: 1 });
  assert.equal(log.readAll()[0].atSource, 'WALL');
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

// ── retention and rotation (guide §11.3, docs/adr/0065) ─────────────────────
// Every test drives an injected wall clock; days are wall-clock UTC days.

const DAY = 24 * 60 * 60 * 1000;
const D = Date.UTC(2026, 8, 1, 12, 0, 0); // 2026-09-01T12:00Z
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

function clockAt(ms) {
  const c = { t: ms };
  c.now = () => c.t;
  return c;
}

function listDir(p) { return fs.readdirSync(path.dirname(p)).sort(); }

test('appending on day D and then D+1 rotates D into its own segment; readAll returns both days in order', () => {
  const p = tmpLogPath();
  const wall = clockAt(D);
  const log = new MutationLog(p, { wallNow: wall.now, retentionDays: 30 });
  log.record({ op: 'CreateStrip', at: 1 });
  log.record({ op: 'MoveStrip', at: 2 });
  wall.t = D + DAY;
  log.record({ op: 'SetBlock', at: 3 });

  assert.deepEqual(listDir(p), ['efsp-mutations.2026-09-01.jsonl', 'efsp-mutations.jsonl']);
  assert.deepEqual(log.readAll().map(e => e.op), ['CreateStrip', 'MoveStrip', 'SetBlock']);
  assert.deepEqual(new MutationLog(p, { wallNow: wall.now }).readAll().map(e => e.at), [1, 2, 3], 'a fresh instance reads the same');
});

test('with retentionDays 30 a segment for day D is kept at D+30 and deleted at D+31', () => {
  const p = tmpLogPath();
  const wall = clockAt(D);
  const log = new MutationLog(p, { wallNow: wall.now, retentionDays: 30 });
  log.record({ op: 'CreateStrip', at: 1 });
  wall.t = D + 30 * DAY;
  log.record({ op: 'MoveStrip', at: 2 }); // rotates D out, prunes: D is exactly 30 days old — kept
  assert.ok(listDir(p).includes('efsp-mutations.2026-09-01.jsonl'));

  wall.t = D + 31 * DAY;
  log.record({ op: 'MoveStrip', at: 3 }); // rotates D+30 out, prunes D
  const files = listDir(p);
  assert.ok(!files.includes('efsp-mutations.2026-09-01.jsonl'), 'D is gone at D+31');
  assert.ok(files.includes(`efsp-mutations.${dayOf(D + 30 * DAY)}.jsonl`));
  assert.deepEqual(log.readAll().map(e => e.at), [2, 3]);
});

test('LEGACY: a live file spanning D-20..D is rotated under D (its newest entry) and survives until D+31 (T9)', () => {
  const p = tmpLogPath();
  // An old, never-rotated file: entries from twenty days, last written on D.
  const lines = [];
  for (let i = 20; i >= 0; i--) lines.push(JSON.stringify({ op: 'MoveStrip', at: D - i * DAY, wallAt: D - i * DAY }));
  fs.writeFileSync(p, lines.join('\n') + '\n');
  fs.utimesSync(p, new Date(D), new Date(D));

  const wall = clockAt(D + 5 * DAY);
  const log = new MutationLog(p, { wallNow: wall.now, retentionDays: 30 });
  log.record({ op: 'CreateStrip', at: 99 });
  assert.ok(listDir(p).includes('efsp-mutations.2026-09-01.jsonl'), 'named by its NEWEST entry, not its oldest');
  assert.equal(log.readAll().length, 22, 'nothing lost: its oldest entry is 25 days old, but the segment is not');

  wall.t = D + 30 * DAY;
  log.prune();
  assert.ok(listDir(p).includes('efsp-mutations.2026-09-01.jsonl'), 'kept at D+30 even though it holds D-20');
  wall.t = D + 31 * DAY;
  log.prune();
  assert.ok(!listDir(p).includes('efsp-mutations.2026-09-01.jsonl'));
});

test('a same-day segment name collision gets .1, and readAll keeps the order', () => {
  const p = tmpLogPath();
  const seg = path.join(path.dirname(p), 'efsp-mutations.2026-09-01.jsonl');
  fs.writeFileSync(seg, JSON.stringify({ op: 'First', at: 0 }) + '\n');
  const wall = clockAt(D);
  const log = new MutationLog(p, { wallNow: wall.now, retentionDays: 30 });
  log.record({ op: 'Second', at: 1 });
  wall.t = D + DAY;
  log.record({ op: 'Third', at: 2 });
  assert.deepEqual(listDir(p), ['efsp-mutations.2026-09-01.1.jsonl', 'efsp-mutations.2026-09-01.jsonl', 'efsp-mutations.jsonl']);
  assert.deepEqual(log.readAll().map(e => e.op), ['First', 'Second', 'Third']);
});

test('pruning touches only files with THIS log\'s base name (T10)', () => {
  const p = tmpLogPath();
  const dir = path.dirname(p);
  for (const name of ['other.2020-01-01.jsonl', 'efsp-mutations-x.2020-01-01.jsonl', 'efsp-mutations.2020-01-01.json', 'notes.txt']) {
    fs.writeFileSync(path.join(dir, name), 'x\n');
  }
  fs.writeFileSync(path.join(dir, 'efsp-mutations.2020-01-01.jsonl'), '{}\n');
  new MutationLog(p, { wallNow: () => D, retentionDays: 30 });
  assert.deepEqual(listDir(p), ['efsp-mutations-x.2020-01-01.jsonl', 'efsp-mutations.2020-01-01.json', 'notes.txt', 'other.2020-01-01.jsonl']);
});

test('the constructor prunes at boot, so an idle server still ages its log out', () => {
  const p = tmpLogPath();
  const dir = path.dirname(p);
  fs.writeFileSync(path.join(dir, `efsp-mutations.${dayOf(D - 40 * DAY)}.jsonl`), '{}\n');
  fs.writeFileSync(path.join(dir, `efsp-mutations.${dayOf(D - 10 * DAY)}.jsonl`), '{}\n');
  new MutationLog(p, { wallNow: () => D, retentionDays: 30 });
  assert.deepEqual(listDir(p), [`efsp-mutations.${dayOf(D - 10 * DAY)}.jsonl`]);
});

test('retention defaults to the configured 30 days', () => {
  assert.equal(new MutationLog(tmpLogPath()).retentionDays, 30);
});

test('onRecord: once per successful append with the stamped entry; a throwing listener stops neither record() nor the next listener', () => {
  const log = new MutationLog(tmpLogPath());
  const seen = [];
  const orig = console.warn;
  console.warn = () => {};
  try {
    log.onRecord(() => { throw new Error('boom'); });
    const off = log.onRecord((e) => seen.push(e));
    log.record({ op: 'CreateStrip', at: 1 });
    log.record({ op: 'MoveStrip', at: 2 });
    off();
    log.record({ op: 'SetBlock', at: 3 });
  } finally { console.warn = orig; }
  assert.deepEqual(seen.map(e => e.op), ['CreateStrip', 'MoveStrip']);
  assert.ok(Number.isFinite(seen[0].wallAt) && seen[0].atSource === 'WALL', 'the listener sees the entry as written');
  assert.equal(log.readAll().length, 3);
});

test('onRecord: a failed append (the log path is under a FILE) notifies nobody', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-mutation-log-test-'));
  const blocker = path.join(dir, 'blocker');
  fs.writeFileSync(blocker, 'i am a file');
  const log = new MutationLog(path.join(blocker, 'efsp-mutations.jsonl'));
  let calls = 0;
  log.onRecord(() => { calls++; });
  const orig = console.warn;
  console.warn = () => {};
  try { log.record({ op: 'CreateStrip', at: 1 }); } finally { console.warn = orig; }
  assert.equal(calls, 0);
});

test('readSince skips segments from before the given day', () => {
  const p = tmpLogPath();
  const wall = clockAt(D);
  const log = new MutationLog(p, { wallNow: wall.now, retentionDays: 30 });
  log.record({ op: 'A', at: 1 });
  wall.t = D + DAY;
  log.record({ op: 'B', at: 2 });
  wall.t = D + 2 * DAY;
  log.record({ op: 'C', at: 3 });
  assert.deepEqual(log.readSince(D + DAY).map(e => e.op), ['B', 'C']);
  assert.deepEqual(log.readSince(D + 2 * DAY).map(e => e.op), ['C']);
  assert.deepEqual(log.readSince(-Infinity).map(e => e.op), ['A', 'B', 'C']);
});
