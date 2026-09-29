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
  store.update(unit(1, { somethingElse: 'ignored' }));
  const [track] = store.getAll();
  assert.deepEqual(Object.keys(track).sort(), [
    'alt', 'callsign', 'category', 'coalition', 'course', 'firstSeenAt', 'groundSpeed', 'heading', 'id', 'lat', 'lon',
    'name', 'player', 'type', 'verticalSpeed',
  ]);
});

test('velocity from DCS is carried, null when absent, and firstSeenAt survives updates (docs/adr/0058)', () => {
  const store = new TrackStore();
  store.update(unit(1));
  assert.equal(store.get(1).course, null);
  assert.equal(store.get(1).verticalSpeed, null);
  const first = store.get(1).firstSeenAt;
  store.update(unit(1, { course: 50, groundSpeed: 200, verticalSpeed: 12.5 }));
  assert.equal(store.get(1).course, 50);
  assert.equal(store.get(1).groundSpeed, 200);
  assert.equal(store.get(1).verticalSpeed, 12.5);
  assert.equal(store.get(1).firstSeenAt, first);
});

test('a missing heading defaults to zero rather than undefined', () => {
  const store = new TrackStore();
  store.update(unit(1, { heading: undefined }));
  assert.equal(store.get(1).heading, 0);
});

test('get tolerates a number or a string id, which is what the ws hub joins on', () => {
  const store = new TrackStore();
  store.update(unit(7));
  assert.ok(store.get(7));
  assert.ok(store.get('7'));
  assert.equal(store.get(8), null);
});

test('an update to a known id replaces the record rather than adding a second', () => {
  const store = new TrackStore();
  store.update(unit(1, { alt: 1000 }));
  store.update(unit(1, { alt: 9000 }));
  assert.equal(store.getAll().length, 1);
  assert.equal(store.get(1).alt, 9000);
});

// ── the delta log ──────────────────────────────────────────────────────────

test('removing a track that is not there does nothing', () => {
  const store = new TrackStore();
  store.update(unit(1));
  store.remove(99);
  assert.equal(store.getAll().length, 1);
});

// ── the two ways an identity disappears — what WP5 has to survive ──────────

test('clear empties the store, which is what a mission reload does to the picture', () => {
  const store = new TrackStore();
  store.update(unit(1));
  store.update(unit(2));
  store.clear();
  assert.deepEqual(store.getAll(), []);
});

test('the same aircraft after a reload is a different id, and the store has no memory of the old one', () => {
  // This is defect D1 in its most brutal form: nothing about the airframe
  // changed, and every id did.
  const store = new TrackStore();
  store.update(unit(101));
  store.clear();
  store.update(unit(500, { callsign: 'T101' }));

  assert.equal(store.get(101), null);
  assert.equal(store.get(500).callsign, 'T101', 'only what the aircraft says about itself survived');
});

test('expireStale removes only tracks older than the stale window, and reports how many', () => {
  const store = new TrackStore();
  store.update(unit(1));
  assert.equal(store.expireStale(), 0, 'a fresh track is not stale');

  // Reach into the last-seen map rather than waiting 12 real seconds.
  store._lastSeen.set(1, Date.now() - 60000);
  store.update(unit(2));

  assert.equal(store.expireStale(), 1);
  assert.equal(store.get(1), null);
  assert.ok(store.get(2), 'the fresh track is untouched');
});

test('an expired track that comes back carries a new id, and its old id stays gone', () => {
  const store = new TrackStore();
  store.update(unit(101));
  store._lastSeen.set(101, Date.now() - 60000);
  store.expireStale();

  store.update(unit(777, { callsign: 'T101' }));

  assert.equal(store.get(101), null);
  assert.deepEqual(store.getAll().map(t => t.id), [777]);
});
