import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// SYNC W5-4: the Board's sync mechanism as found at 2b055d4, pinned before it moves. No golden reaches seq ~109,
// so the ring prune (2,000 -> 1,000), the per-id dedupe of a delta and the epoch rules are pinned here.
const require = createRequire(import.meta.url);
const crypto = require('crypto');
const { BoardState } = require('../src/efsp/board/board-state.js');
const { BoardStore } = require('../src/efsp/board-store.js');

const clock = { now: () => 1000 };
function kernel() {
  const touched = [];
  const state = new BoardState({ clock, touch: (id) => { touched.push(id); state.recordTouch(id); } });
  return { state, touched };
}

test('every ring entry takes one seq; the ring keeps 2,000 entries and prunes to the last 1,000 on the 2,001st', () => {
  const { state } = kernel();
  for (let i = 0; i < 2000; i++) state.recordTouch(`s${i}`);
  assert.equal(state.seq, 2000);
  assert.equal(state.log.length, 2000);
  state.recordTouch('s2000');
  assert.equal(state.seq, 2001);
  assert.equal(state.log.length, 1000);
  assert.equal(state.log[0].seq, 1002);
  assert.equal(state.log[0].id, 's1001');
  const delta = state.getDeltaSince(0);
  assert.equal(delta.seq, 2001);
  assert.equal(delta.updated.length, 0);
  assert.equal(delta.gone.length, 1000, 'ids the ring no longer holds are not reported');
  assert.equal(delta.gone[0], 's1001');
});

test('a gone entry advances the seq like a touch, is pruned like one, and is not a touch', () => {
  const { state } = kernel();
  state.recordTouch('a');
  state.logGone('b');
  assert.equal(state.seq, 2);
  assert.deepEqual(state.log.map(e => [e.seq, e.type, e.id]), [[1, 'update', 'a'], [2, 'gone', 'b']]);
  assert.deepEqual(state.drainTouched(), ['a']);
  assert.deepEqual(state.drainTouched(), []);
  for (let i = 0; i < 1999; i++) state.logGone(`g${i}`);
  assert.equal(state.log.length, 1000);
});

test('a delta names each id once, in first-appearance order, and reads the record as it is now', () => {
  const { state } = kernel();
  const strip = (id) => ({ stripId: id, rev: 0 });
  state.insert(strip('a'));
  state.insert(strip('b'));
  state.recordTouch('a');
  state.recordTouch('c');
  state.logGone('d');
  state.recordTouch('b');
  const delta = state.getDeltaSince(1);
  assert.deepEqual(delta.updated.map(s => s.stripId), ['b', 'a']);
  assert.deepEqual(delta.gone, ['c', 'd']);
  assert.equal(delta.seq, 6);
  assert.deepEqual(state.getDeltaSince(6), { updated: [], gone: [], seq: 6 });
  assert.deepEqual(state.getDeltaSince(99), { updated: [], gone: [], seq: 6 });
  assert.deepEqual(state.drainTouched(), ['a', 'b', 'c'], 'first-touch order; gone is not a touch');
});

test('the epoch is minted once on construction and once per newEpoch(); newEpoch() changes nothing else (W5-3)', () => {
  const orig = crypto.randomUUID;
  let n = 0;
  crypto.randomUUID = () => `uuid-${++n}`;
  try {
    const { state } = kernel();
    assert.equal(n, 1);
    assert.equal(state.epoch, 'uuid-1');
    state.recordTouch('a');
    state.recordTouch('b');
    state.newEpoch();
    assert.equal(n, 2);
    assert.equal(state.epoch, 'uuid-2');
    assert.equal(state.seq, 2);
    assert.equal(state.log.length, 2);
    assert.deepEqual(state.getDeltaSince(0).gone, ['a', 'b']);
    assert.deepEqual(state.drainTouched(), ['a', 'b']);
  } finally {
    crypto.randomUUID = orig;
  }
});

test('a Board restore mints a new epoch, keeps the seq, and replays nothing from before', () => {
  const orig = crypto.randomUUID;
  let n = 0;
  crypto.randomUUID = () => `uuid-${++n}`;
  try {
    const board = new BoardStore({ getFdr: () => null }, {}, { clock });
    assert.equal(n, 1, 'one randomUUID per Board construction');
    board.restore({ strips: [], cidSeq: 0 });
    assert.equal(n, 2, 'one per restore');
    assert.equal(board.currentSeq, 0);
  } finally {
    crypto.randomUUID = orig;
  }
});

test('the Board idempotency cache: 5,000 records, oldest out first; cmid-less never cached; persisted window 10 min; restore loads every pair', () => {
  const realNow = Date.now;
  let wall = 1_000_000;
  Date.now = () => wall;
  try {
    const board = new BoardStore({ getFdr: () => null }, { resolveBlockTarget: () => null }, { clock });
    const miss = (cmid) => board.applyMutation({ clientMutationId: cmid, stripId: 'nope', baseRev: 0, op: { kind: 'SetFlag', flag: 'attention', value: true } }, 'OPS', 'c');
    const first = miss('m-0');
    assert.equal(first.ok, false);
    assert.equal(board.hasApplied('m-0'), true);
    const replay = miss('m-0');
    assert.equal(replay.replayed, true);
    assert.equal(replay.reason, first.reason);
    miss('');
    miss(undefined);
    assert.equal(board.hasApplied(''), false);
    for (let i = 1; i < 5000; i++) { wall += 1; miss(`m-${i}`); }
    assert.equal(board.hasApplied('m-0'), true, '5,000 held');
    wall += 1; miss('m-5000');
    assert.equal(board.hasApplied('m-0'), false, 'the oldest goes on the 5,001st');
    assert.equal(board.hasApplied('m-1'), true);
    // The persisted window: records with appliedWallAt >= now - 10 min, in insertion order.
    wall += 10 * 60 * 1000 - 4000;
    const snap = board.snapshot();
    assert.deepEqual(Object.keys(snap), ['strips', 'cidSeq', 'replay', 'droppedWallAt']);
    assert.equal(snap.replay[0][0], 'm-1000');
    assert.equal(snap.replay.length, 4001);
    assert.deepEqual(Object.keys(snap.replay[0][1]), ['ok', 'reason', 'detail', 'warning', 'routedTo', 'selfCoordinated', 'stripId', 'fdrId', 'peerFacilityId', 'peerStripId', 'appliedWallAt']);
    assert.equal(snap.replay[0][1].warning, null, 'absent fields are null in a Board record');
    // Restore loads every pair with a string cmid and an object record, no cap, no window.
    const many = [];
    for (let i = 0; i < 6000; i++) many.push([`r-${i}`, { ok: true, appliedWallAt: 0 }]);
    many.push(['', { ok: true }], [7, { ok: true }], ['bad', null]);
    board.restore({ strips: [], cidSeq: 0, replay: many });
    assert.equal(board.hasApplied('r-0'), true);
    assert.equal(board.hasApplied('r-5999'), true);
    assert.equal(board.hasApplied(''), true, 'restore keeps an empty-string cmid (applyMutation never consults it)');
    assert.equal(board.hasApplied('bad'), false);
    assert.equal(board.snapshot().replay.length, 0, 'all outside the window');
  } finally {
    Date.now = realNow;
  }
});

test('the families\' replay cache: kind|cmid keys, unknown kind throws, absent fields stay undefined, id null, cap evicts oldest', () => {
  const { ReplayCache } = require('../src/efsp/replay-cache.js');
  const cache = new ReplayCache({ cap: 2 });
  assert.equal(cache.get('nonsense', ''), null, 'an empty cmid returns before the kind check');
  cache.set('nonsense', '', { ok: true });
  assert.throws(() => cache.get('nonsense', 'x'), /unknown kind nonsense/);
  assert.throws(() => cache.set('nonsense', 'x', { ok: true }), /unknown kind nonsense/);
  cache.set('airspace', 'x', { ok: 1, reason: undefined, extra: 'dropped' });
  const rec = cache.get('airspace', 'x');
  assert.deepEqual(Object.keys(rec), ['ok', 'reason', 'detail', 'warning', 'id']);
  assert.equal(rec.ok, true);
  assert.equal(rec.reason, undefined);
  assert.equal(rec.id, null);
  assert.ok(Object.isFrozen(rec));
  assert.equal(JSON.stringify(rec), '{"ok":true,"id":null}');
  assert.equal(cache.get('marsa', 'x'), null, 'kinds do not share a cmid');
  cache.set('marsa', 'x', { ok: false, reason: 'R', id: 'i' });
  cache.set('sfa', 'y', { ok: true });
  assert.equal(cache.size, 2);
  assert.equal(cache.get('airspace', 'x'), null, 'the oldest went');
  assert.equal(cache.get('marsa', 'x').id, 'i');
});
