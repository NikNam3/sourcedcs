import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncedStore } from '../src/efsp/synced-store.js';

// The bookkeeping the six sequenced stores share (ARCH-S #6): seq/epoch, the rev bump, the backstop and the audit line.

const silent = { error() {} };
const mk = (mutationLog = null) => new SyncedStore({ clock: { now: () => 1234 }, mutationLog });

test('seq starts at 0, _bump moves the record rev and the seq together, and the epoch is a lifetime name', () => {
  const s = mk();
  assert.equal(s.currentSeq, 0);
  assert.equal(typeof s.epoch, 'string');
  const rec = { rev: 4 };
  assert.equal(s._bump(rec), rec);
  assert.deepEqual([rec.rev, s.currentSeq], [5, 1]);
  assert.notEqual(mk().epoch, s.epoch);
});

test('_guarded: a throw before any write is a plain INTERNAL_ERROR, one after a write is partial', () => {
  const s = mk();
  const plain = s._guarded('x op', silent, () => { throw new Error('boom'); });
  assert.deepEqual(plain, { ok: false, reason: 'INTERNAL_ERROR', detail: 'internal error processing x op' });
  const partial = s._guarded('x op', silent, () => { s._bump({ rev: 0 }); throw new Error('late'); });
  assert.equal(partial.partial, true);
  assert.equal(partial.internalError, 'late');
  assert.deepEqual(s._guarded('x op', silent, () => ({ ok: true })), { ok: true });
});

test('_writeAudit: common keys in the stores\' order, `after` only for an ok or partial result, and nothing without a log', () => {
  const lines = [];
  const s = mk({ record: (l) => lines.push(l) });
  const args = { subject: { thingId: 't1', facilityId: null }, actingPositionId: 'AP', by: 'c1', before: { a: 1 } };
  s._writeAudit({ clientMutationId: 'm1', op: { kind: 'Do' } }, { ...args, result: { ok: true }, after: () => ({ a: 2 }) });
  s._writeAudit({ clientMutationId: 'm2', op: { kind: 'Do' } }, { ...args, result: { ok: false, reason: 'STALE_REV', detail: 'd' }, after: () => { throw new Error('not for a refusal'); } });
  assert.deepEqual(Object.keys(lines[0]).filter((k) => lines[0][k] !== undefined),
    ['clientMutationId', 'op', 'thingId', 'facilityId', 'actingPositionId', 'actorId', 'at', 'ok', 'before', 'after']);
  assert.equal(lines[0].at, 1234);
  assert.deepEqual([lines[1].ok, lines[1].reason, lines[1].after], [false, 'STALE_REV', undefined]);
  assert.doesNotThrow(() => mk()._writeAudit({}, { ...args, result: { ok: true }, after: () => { throw new Error('unreached'); } }));
});
