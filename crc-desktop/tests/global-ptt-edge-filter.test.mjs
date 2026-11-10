// S-RO-1 RO14: crc-desktop/global-ptt/edge-filter.js, on a fake clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createEdgeFilter, SILENCE_MS } = require('../global-ptt/edge-filter.js');

function rig(releaseHoldMs = 0) {
  const edges = [], timers = new Map();
  let now = 0, id = 0;
  const f = createEdgeFilter({
    emit: (d) => edges.push(d), releaseHoldMs,
    setTimeout: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; }, clearTimeout: (t) => timers.delete(t),
  });
  const advance = (ms) => {
    now += ms;
    for (const [k, t] of [...timers]) if (t.at <= now) { timers.delete(k); t.fn(); }
  };
  return { f, edges, advance, timers };
}

test('repeats are dropped, and a release with nothing down is nothing', () => {
  const r = rig();
  r.f.release();
  r.f.press(); r.f.press(); r.f.press(); r.f.release(); r.f.release();
  assert.deepEqual(r.edges, [true, false]);
});

test('X11: a release answered by a press inside the window never happened', () => {
  const r = rig(15);
  r.f.press();
  r.f.release(); r.advance(5); r.f.press();
  r.advance(100);
  assert.deepEqual(r.edges, [true]);
});

test('X11: a real release lands after the window', () => {
  const r = rig(15);
  r.f.press(); r.f.release();
  assert.deepEqual(r.edges, [true]);
  r.advance(15);
  assert.deepEqual(r.edges, [true, false]);
});

test('after the fuse, repeats stay latched and a release ends it', () => {
  const r = rig();
  r.f.press(); r.f.fuse();
  for (let i = 0; i < 5; i++) { r.advance(SILENCE_MS - 1); r.f.press(); }
  assert.deepEqual(r.edges, [true]);
  r.f.release();
  assert.deepEqual(r.edges, [true, false]);
  assert.equal(r.timers.size, 0);
  r.f.press();
  assert.deepEqual(r.edges, [true, false, true]);
});

test('a missed release: silence reports it, so the next real press works', () => {
  const r = rig();
  r.f.press(); r.f.fuse();
  r.advance(SILENCE_MS);
  assert.deepEqual(r.edges, [true, false]);
  r.f.press();
  assert.deepEqual(r.edges, [true, false, true]);
});

test('X11 pairs do not break the latch', () => {
  const r = rig(15);
  r.f.press(); r.f.fuse();
  r.f.release(); r.advance(5); r.f.press();
  assert.deepEqual(r.edges, [true]);
  r.advance(SILENCE_MS);
  assert.deepEqual(r.edges, [true, false]);
});

test('the fuse with nothing down does nothing', () => {
  const r = rig();
  r.f.fuse();
  r.f.press();
  assert.deepEqual(r.edges, [true]);
});

test('reset releases and clears', () => {
  const r = rig(15);
  r.f.press(); r.f.fuse(); r.f.reset();
  assert.deepEqual(r.edges, [true, false]);
  assert.equal(r.timers.size, 0);
});
