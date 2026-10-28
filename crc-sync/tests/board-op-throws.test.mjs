import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import crypto from 'crypto';
import { prologue, makeWorld, exchange } from './helpers/control-release-fixture.mjs';

// B3 (docs/wip/SERVER-BUGS.md): an op that throws after it wrote. The write stays on the Board, so it is audited and
// persisted (never left only in memory), broadcast, and the retry is answered with the same refusal, not run again.

prologue('board-op-throws-');
const { createEfsp } = await import('../src/efsp/index.js');
const helpers = await import('./helpers/efsp-scenario.mjs');

test('B3 a throw after a partial write: INTERNAL_ERROR, persisted, audited, broadcast, and a retry does not run the op twice', () => {
  const w = makeWorld(createEfsp, helpers);
  const ex = exchange(w, helpers, 'B3THROW', { accept: false });
  const board = w.efsp.boardStoreFor('CENTER');
  const base = w.efsp.mutationLog.readAll().length;
  const strip = { ...ex.T() };
  // The op body runs and commits; the audit-field lookup after it throws.
  const real = board._stripOps.auditFieldsFor;
  board._stripOps.auditFieldsFor = () => { throw new Error('boom after the write'); };
  const msg = {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), facilityId: 'CENTER', actingPositionId: 'CTR',
    stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'SetBlock', blockId: '7', value: '240' },
  };
  let reply;
  try { reply = w.efsp.handleMessage(w.c.CTR.session, msg); } finally { board._stripOps.auditFieldsFor = real; }
  assert.equal(reply.ack.ok, false);
  assert.equal(reply.ack.reason, 'INTERNAL_ERROR');
  const written = board.getStrip(strip.stripId);
  assert.ok(written.rev > strip.rev, 'the partial write is on the Board (the premise)');

  // broadcast
  const delta = reply.broadcasts.find(f => f.type === 'efsp-board-delta' && f.facilityId === 'CENTER');
  assert.ok(delta && delta.strips.updated.some(s => s.stripId === strip.stripId), 'what it touched is broadcast');

  // audited
  const entries = w.efsp.mutationLog.readAll().slice(base).filter(e => e.clientMutationId === msg.clientMutationId);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].partial, true);
  assert.equal(entries[0].outcome, 'INTERNAL_ERROR');
  assert.equal(entries[0].after.rev, written.rev);

  // persisted: the snapshot on disk holds the written rev
  const snap = JSON.parse(fs.readFileSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, 'utf8'));
  const onDisk = snap.boards.CENTER.strips.find(s => s.stripId === strip.stripId);
  assert.equal(onDisk.rev, written.rev);

  // the retry is answered from the replay cache and does not apply the op again
  const retry = w.efsp.handleMessage(w.c.CTR.session, msg);
  assert.equal(retry.ack.reason, 'INTERNAL_ERROR');
  assert.equal(board.getStrip(strip.stripId).rev, written.rev);
});

test('B3 a throw before any write is a plain refusal: no partial audit line', () => {
  const w = makeWorld(createEfsp, helpers);
  const ex = exchange(w, helpers, 'B3CLEAN', { accept: false });
  const board = w.efsp.boardStoreFor('CENTER');
  const base = w.efsp.mutationLog.readAll().length;
  const real = board._stripOps.dispatch;
  board._stripOps.dispatch = () => { throw new Error('before any write'); };
  const strip = ex.T();
  let reply;
  try {
    reply = w.efsp.handleMessage(w.c.CTR.session, { version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), facilityId: 'CENTER', actingPositionId: 'CTR', stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'SetBlock', blockId: '7', value: '240' } });
  } finally { board._stripOps.dispatch = real; }
  assert.equal(reply.ack.reason, 'INTERNAL_ERROR');
  assert.equal(w.efsp.mutationLog.readAll().length, base);
});
