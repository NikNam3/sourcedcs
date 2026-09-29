import { test } from 'node:test';
import assert from 'node:assert/strict';

// docs/adr/0058 — short-term conflict alert.
const { findConflicts, StcaMonitor } = await import('../src/stca.js');
const { DEFAULTS } = await import('../src/alerting-config.js');

const cfg = DEFAULTS.stca;
const KT = 0.514444;
const NOW = 1_000_000;
const NM_LAT = 1 / 60; // one nautical mile of latitude, in degrees

function track(id, over) {
  return {
    id, callsign: `T${id}`, category: 1, lat: 37, lon: 35, alt: 3000,
    course: 0, groundSpeed: 400 * KT, verticalSpeed: 0, firstSeenAt: NOW - 60000, ...over,
  };
}

test('two aircraft head-on at the same level, 10 NM apart, conflict well inside two minutes', () => {
  const a = track(1, { lat: 37, course: 0 });
  const b = track(2, { lat: 37 + 10 * NM_LAT, course: 180 });
  const [c] = findConflicts([a, b], cfg, NOW);
  assert.ok(c, 'no conflict found');
  assert.equal(c.id, '1|2');
  // Closing at 800 kt, 10 NM: they meet in 45 s; the closest sampled point is at the meeting.
  assert.ok(c.timeToCpaSec >= 40 && c.timeToCpaSec <= 46, `CPA at ${c.timeToCpaSec} s`);
  assert.ok(c.minNm < 0.5);
  assert.equal(c.vertFt, 0);
  assert.ok(Math.abs(c.aAt.lat - c.bAt.lat) < 0.01, 'both predicted positions are at the meeting point');
});

test('the same geometry 2000 ft apart is separated vertically — no alert', () => {
  const a = track(1, { lat: 37, course: 0, alt: 3000 });
  const b = track(2, { lat: 37 + 10 * NM_LAT, course: 180, alt: 3000 + 2000 / 3.28084 });
  assert.deepEqual(findConflicts([a, b], cfg, NOW), []);
});

test('a climb that closes the vertical gap inside the window IS a conflict', () => {
  const a = track(1, { lat: 37, course: 0, alt: 3000, verticalSpeed: 2000 / 196.85 }); // climbing 2000 fpm
  const b = track(2, { lat: 37 + 10 * NM_LAT, course: 180, alt: 3000 + 1500 / 3.28084 });
  assert.equal(findConflicts([a, b], cfg, NOW).length, 1);
});

test('diverging, too far, too slow or too new: no alert', () => {
  const a = track(1, { lat: 37, course: 180 });
  const b = track(2, { lat: 37 + 10 * NM_LAT, course: 0 });
  assert.deepEqual(findConflicts([a, b], cfg, NOW), [], 'flying apart');
  assert.deepEqual(findConflicts([track(1, {}), track(2, { lat: 38 })], cfg, NOW), [], '60 NM in trail at the same speed');
  const taxi = track(2, { lat: 37 + 1 * NM_LAT, course: 180, groundSpeed: 20 * KT });
  assert.deepEqual(findConflicts([track(1, {}), taxi], cfg, NOW), [], 'under 50 kt');
  const young = track(2, { lat: 37 + 5 * NM_LAT, course: 180, firstSeenAt: NOW - 2000 });
  assert.deepEqual(findConflicts([track(1, {}), young], cfg, NOW), [], 'no stable course yet');
  const ship = track(2, { lat: 37 + 5 * NM_LAT, course: 180, category: 4 });
  assert.deepEqual(findConflicts([track(1, {}), ship], cfg, NOW), [], 'ships are not traffic');
});

test('a MARSA pair is suppressed; the monitor reports a change while conflicts exist and once when they clear', () => {
  const tracks = [track(1, { lat: 37, course: 0 }), track(2, { lat: 37 + 10 * NM_LAT, course: 180 })];
  const store = { getAll: () => tracks };
  const marsa = new StcaMonitor({
    trackStore: store, config: cfg,
    fdrForTrack: (id) => (String(id) === '1' ? 'fA' : 'fB'),
    activeMarsaFor: (fdrId) => ({ participants: ['fA', 'fB'] }),
  });
  assert.equal(marsa.tick(NOW), false);
  assert.deepEqual(marsa.getAll(), []);

  const plain = new StcaMonitor({ trackStore: store, config: cfg });
  assert.equal(plain.tick(NOW), true);
  assert.equal(plain.getAll().length, 1);
  tracks[1] = { ...tracks[1], alt: 9000 };
  assert.equal(plain.tick(NOW), true, 'clearing is a change');
  assert.equal(plain.tick(NOW), false, 'and quiet after that');
});

test("a track correlated to a Strip is named by the Strip's callsign", () => {
  const tracks = [track(1, { lat: 37, course: 0, callsign: 'Enfield 1-1' }), track(2, { lat: 37 + 10 * NM_LAT, course: 180 })];
  const monitor = new StcaMonitor({
    trackStore: { getAll: () => tracks }, config: cfg,
    callsignFor: (t) => (t.id === 1 ? 'VIPER11' : null),
  });
  monitor.tick(NOW);
  const [c] = monitor.getAll();
  assert.equal(c.aCallsign, 'VIPER11');
  assert.equal(c.bCallsign, 'T2', 'uncorrelated keeps its own');
});
