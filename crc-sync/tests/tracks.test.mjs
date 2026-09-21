import { test } from 'node:test';
import assert from 'node:assert/strict';
import TrackStore from '../src/tracks.js';

/* TrackStore had no test file at all.
 *
 * It is worth one now for a specific reason: `clear()` and `expireStale()` are
 * the two places a DCS track identity vanishes, and WP5's correlation binds
 * Strips to exactly these ids. The guide calls identity reconciliation between
 * the flight-data and track domains a named, measured defect class (§6.6,
 * defect D1) — so the behaviour a correlation has to survive belongs pinned
 * down here, under this store, rather than only being asserted through the
 * subsystem that consumes it.
 */

function unit(id, extra = {}) {
  return {
    id, callsign: `T${id}`, coalition: 3, type: 'F-16C_50',
    lat: 37, lon: 35, alt: 6000, heading: 90, player: 'Pilot', category: 1, ...extra,
  };
}

test('update stores the telemetry fields and nothing else', () => {
  const store = new TrackStore();
  store.update(unit(1, { somethingElse: 'ignored' }), null);
  const [track] = store.getAll();
  assert.deepEqual(Object.keys(track).sort(), [
    'alt', 'callsign', 'category', 'coalition', 'heading', 'id', 'lat', 'lon', 'player', 'type',
  ]);
});

test('a missing heading defaults to zero rather than undefined', () => {
  const store = new TrackStore();
  store.update(unit(1, { heading: undefined }), null);
  assert.equal(store.get(1).heading, 0);
});

test('transponder fields are merged only when the SRS client has them', () => {
  const store = new TrackStore();
  store.update(unit(1), { squawk: 4321, squawkStatus: 1, mode4: true });
  assert.equal(store.get(1).squawk, 4321);
  assert.equal(store.get(1).squawkStatus, 1);
  assert.equal(store.get(1).mode4, true);

  store.update(unit(2), { squawk: undefined });
  assert.equal('squawk' in store.get(2), false, 'an undefined squawk is absent, not null');

  store.update(unit(3), null);
  assert.equal('squawk' in store.get(3), false);
});

test('get tolerates a number or a string id, which is what the ws hub joins on', () => {
  const store = new TrackStore();
  store.update(unit(7), null);
  assert.ok(store.get(7));
  assert.ok(store.get('7'));
  assert.equal(store.get(8), null);
});

test('an update to a known id replaces the record rather than adding a second', () => {
  const store = new TrackStore();
  store.update(unit(1, { alt: 1000 }), null);
  store.update(unit(1, { alt: 9000 }), null);
  assert.equal(store.getAll().length, 1);
  assert.equal(store.get(1).alt, 9000);
});

// ── the delta log ──────────────────────────────────────────────────────────

test('getDeltaSince returns everything after the given sequence, and advances it', () => {
  const store = new TrackStore();
  store.update(unit(1), null);
  const first = store.getDeltaSince(0);
  assert.deepEqual(first.updated.map(t => t.id), [1]);
  assert.equal(first.seq, store.currentSeq);

  assert.deepEqual(store.getDeltaSince(first.seq).updated, [], 'a quiet interval is empty');

  store.update(unit(2), null);
  assert.deepEqual(store.getDeltaSince(first.seq).updated.map(t => t.id), [2]);
});

test('several updates to one track collapse to one delta entry, carrying the latest values', () => {
  const store = new TrackStore();
  store.update(unit(1, { alt: 100 }), null);
  const mark = store.currentSeq;
  store.update(unit(1, { alt: 200 }), null);
  store.update(unit(1, { alt: 300 }), null);
  const delta = store.getDeltaSince(mark);
  assert.equal(delta.updated.length, 1);
  assert.equal(delta.updated[0].alt, 300);
});

test('a track removed after being updated appears only as gone', () => {
  const store = new TrackStore();
  store.update(unit(1), null);
  const mark = store.currentSeq;
  store.update(unit(1, { alt: 7000 }), null);
  store.remove(1);
  const delta = store.getDeltaSince(mark);
  assert.deepEqual(delta.updated, []);
  assert.deepEqual(delta.gone, [1]);
});

test('removing a track that is not there does nothing and logs nothing', () => {
  const store = new TrackStore();
  const seq = store.currentSeq;
  store.remove(99);
  assert.equal(store.currentSeq, seq);
});

// ── the two ways an identity disappears — what WP5 has to survive ──────────

test('clear flushes every track as gone, which is what a mission reload does to the picture', () => {
  const store = new TrackStore();
  store.update(unit(1), null);
  store.update(unit(2), null);
  const mark = store.currentSeq;

  store.clear();

  assert.deepEqual(store.getAll(), []);
  assert.deepEqual(store.getDeltaSince(mark).gone.sort(), [1, 2]);
});

test('the same aircraft after a reload is a different id, and the store has no memory of the old one', () => {
  // This is defect D1 in its most brutal form: nothing about the airframe
  // changed, and every id did.
  const store = new TrackStore();
  store.update(unit(101), { squawk: 41 });
  store.clear();
  store.update(unit(500, { callsign: 'T101' }), { squawk: 41 });

  assert.equal(store.get(101), null);
  assert.equal(store.get(500).squawk, 41, 'the squawk is the only thing that survived');
});

test('expireStale removes only tracks older than the stale window, and reports how many', () => {
  const store = new TrackStore();
  store.update(unit(1), null);
  assert.equal(store.expireStale(), 0, 'a fresh track is not stale');

  // Reach into the last-seen map rather than waiting 12 real seconds.
  store._lastSeen.set(1, Date.now() - 60000);
  store.update(unit(2), null);

  assert.equal(store.expireStale(), 1);
  assert.equal(store.get(1), null);
  assert.ok(store.get(2), 'the fresh track is untouched');
});

test('an expired track that comes back carries a new id, and its old id stays gone', () => {
  const store = new TrackStore();
  store.update(unit(101), { squawk: 41 });
  store._lastSeen.set(101, Date.now() - 60000);
  store.expireStale();
  const mark = store.currentSeq;

  store.update(unit(777, { callsign: 'T101' }), { squawk: 41 });

  assert.equal(store.get(101), null);
  assert.deepEqual(store.getDeltaSince(mark).updated.map(t => t.id), [777]);
});

test('the delta log is pruned rather than growing without bound', () => {
  const store = new TrackStore();
  for (let i = 0; i < 2500; i++) store.update(unit(i), null);
  assert.ok(store._log.length <= 2000, `log grew to ${store._log.length}`);
  // And the store still answers for the tracks it holds.
  assert.equal(store.getAll().length, 2500);
});
