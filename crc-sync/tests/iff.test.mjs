import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAutoIff, resolveIff } from '../src/surveillance/iff.js';
import { checkOnGround } from '../src/geo.js';

// Default server coalition is BLUE (3) unless CRCSYNC_COALITION=2 is set.

test('computeAutoIff: own-coalition AI unit is always friendly', () => {
  const track = { coalition: 3, player: null, category: 1, lat: 0, lon: 0, alt: 3000 };
  assert.equal(computeAutoIff(track, null, false), 'friendly');
});

test('computeAutoIff: own-coalition player with transponder on is friendly', () => {
  const track = { coalition: 3, player: 'Pilot', category: 1, lat: 0, lon: 0, alt: 3000 };
  assert.equal(computeAutoIff(track, null, true), 'friendly');
});

test('computeAutoIff: own-coalition player without transponder, airborne, is bogey', () => {
  const track = { coalition: 3, player: 'Pilot', category: 1, lat: 0, lon: 0, alt: 3000 };
  assert.equal(computeAutoIff(track, null, false), 'bogey');
});

test('computeAutoIff: enemy airborne is bogey, enemy on the ground is invisible', () => {
  // checkOnGround skips an airport at exactly lat/lon 0 (a harmless quirk: no
  // DCS theater airport sits there), so use real-looking coordinates.
  const missionData = { airports: [{ lat: 36.0, lon: 35.0, elev: 0 }] };
  const airborne = { coalition: 2, player: 'Pilot', category: 1, lat: 10, lon: 10, alt: 3000 };
  assert.equal(computeAutoIff(airborne, missionData, false), 'bogey');
  const onGround = { coalition: 2, player: 'Pilot', category: 1, lat: 36.001, lon: 35.001, alt: 10 };
  assert.equal(computeAutoIff(onGround, missionData, false), 'invisible');
});

test('computeAutoIff: neutral coalition is always neutral', () => {
  assert.equal(computeAutoIff({ coalition: 1, player: null, category: 1, lat: 0, lon: 0, alt: 3000 }, null, false), 'neutral');
});

test("resolveIff: a controller's declaration beats the automatic answer", () => {
  const track = { coalition: 3, player: null, category: 1, lat: 0, lon: 0, alt: 3000 };
  assert.equal(resolveIff(track, { iff: { state: 'hostile' } }, null, false), 'hostile');
  assert.equal(resolveIff(track, null, null, false), 'friendly');
});

test('checkOnGround requires both proximity and low AGL', () => {
  const missionData = { airports: [{ lat: 36.0, lon: 35.0, elev: 500 }] };
  assert.equal(checkOnGround({ category: 1, lat: 36.001, lon: 35.001, alt: 5000 }, missionData), false);
  assert.equal(checkOnGround({ category: 1, lat: 36.001, lon: 35.001, alt: 520 }, missionData), true);
});
