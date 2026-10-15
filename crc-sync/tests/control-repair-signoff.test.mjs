import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prologue, makeWorld, exchange, holders } from './helpers/control-release-fixture.mjs';

// B2 (docs/wip/SERVER-BUGS.md): a control repair made by a sign-off is persisted, and a repair on the OTHER Facility's
// Board reaches that Facility's sessions in the same round trip.

prologue('control-repair-signoff-');
const { createEfsp } = await import('../src/efsp/index.js');
const helpers = await import('./helpers/efsp-scenario.mjs');
const { mustAct, hold } = helpers;

function repairMode(fn) {
  const prev = process.env.CRCSYNC_CONTROL_INVARIANT;
  process.env.CRCSYNC_CONTROL_INVARIANT = 'repair';
  try { return fn(); } finally { if (prev === undefined) delete process.env.CRCSYNC_CONTROL_INVARIANT; else process.env.CRCSYNC_CONTROL_INVARIANT = prev; }
}

function signOffWorld() {
  const w = makeWorld(createEfsp, helpers);
  const ex = exchange(w, helpers, 'B2SIGN');
  mustAct(w.efsp, w.c.AP, 'AP', ex.R(), { kind: 'HANDOFF', action: 'CHECKED_IN' });
  return { w, ex };
}

test('B2 a repair made at sign-off is persisted: a restart still has the repaired holder', () => repairMode(() => {
  const { w, ex } = signOffWorld();
  const tId = ex.T().stripId;
  const reply = hold(w.efsp, w.c.AP.session, 'INCIRLIK', []);
  assert.ok(reply.ack);
  assert.equal(holders(ex).control, 'TRANSFERRING', 'repaired in memory');
  const w2 = { efsp: createEfsp() };
  const T = w2.efsp.boardStoreFor('CENTER').getStrip(tId);
  assert.equal(T.coordination.control.holder, 'TRANSFERRING', 'and on disk');
  assert.equal(T.coordination.comms.transferred, false);
}));

test('B2 a repair on the other Facility\'s Board is broadcast in the same round trip', () => repairMode(() => {
  const { w, ex } = signOffWorld();
  const tId = ex.T().stripId;
  const reply = hold(w.efsp, w.c.AP.session, 'INCIRLIK', []);
  const peer = reply.broadcasts.filter(f => f.type === 'efsp-board-delta' && f.facilityId === 'CENTER');
  assert.equal(peer.length, 1, 'one board-delta for CENTER');
  const sent = peer[0].strips.updated.find(s => s.stripId === tId);
  assert.ok(sent, 'it carries the repaired Strip');
  assert.equal(sent.coordination.control.holder, 'TRANSFERRING');
  assert.equal(sent.rev, ex.T().rev);
  assert.equal(peer[0].boardSeq, w.efsp.boardStoreFor('CENTER').currentSeq);
}));
