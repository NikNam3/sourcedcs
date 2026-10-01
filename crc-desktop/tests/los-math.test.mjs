/* Unit tests for the pure terrain-masking math in los.js (curvature/refraction
   sight-line height and the blocked/clear decision over a terrain profile).
   These are exercised directly, without Electron/DOM/network, since los.js
   guards its module.exports the same way lxsrs-setup.js does. */

import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/client-env.mjs';

import {
  EFFECTIVE_EARTH_RADIUS_M, losSightLineHeightM, losProfileBlocked,
} from '../app/public/js/los.js';

/* ══════════════════════════════════════════════════════════
   losSightLineHeightM
══════════════════════════════════════════════════════════ */

test('losSightLineHeightM: at the radar itself (d=0), height equals radar altitude', () => {
  assert.equal(losSightLineHeightM(100, 500, 0, 10000), 100);
});

test('losSightLineHeightM: at the target itself (d=D), height equals target altitude', () => {
  assert.equal(losSightLineHeightM(100, 500, 10000, 10000), 500);
});

test('losSightLineHeightM: midpoint of equal-altitude endpoints dips below the straight average by the earth-curvature bulge', () => {
  const D = 100000; // 100km
  const straightAvg = 50; // both ends at 50m
  const expectedBulge = (D / 2) * (D / 2) / (2 * EFFECTIVE_EARTH_RADIUS_M);
  const height = losSightLineHeightM(50, 50, D / 2, D);
  assert.ok(Math.abs(height - (straightAvg - expectedBulge)) < 1e-6);
  assert.ok(height < straightAvg, 'curvature must pull the sight line below the flat-earth average');
});

test('losSightLineHeightM: D=0 (radar and target at the same point) returns radar altitude', () => {
  assert.equal(losSightLineHeightM(250, 999, 0, 0), 250);
});

/* ══════════════════════════════════════════════════════════
   losProfileBlocked
══════════════════════════════════════════════════════════ */

test('losProfileBlocked: flat terrain well below the sight line is never blocked', () => {
  const D = 20000;
  const samples = [
    { d: 5000, terrainM: 50 },
    { d: 10000, terrainM: 50 },
    { d: 15000, terrainM: 50 },
  ];
  assert.equal(losProfileBlocked(samples, 500, 500, D), false);
});

test('losProfileBlocked: a ridge poking above the sight line partway along the path blocks it', () => {
  const D = 20000;
  // Sight line at d=10000 between 500m/500m endpoints (negligible bulge at this range) is ~500m.
  const samples = [
    { d: 5000, terrainM: 100 },
    { d: 10000, terrainM: 800 }, // well above the ~500m sight line here
    { d: 15000, terrainM: 100 },
  ];
  assert.equal(losProfileBlocked(samples, 500, 500, D), true);
});

test('losProfileBlocked: terrain just under the sight line stays clear', () => {
  const D = 20000;
  // Sight line at d=10000 between 500m/500m endpoints, minus the small
  // curvature bulge at this range (~5.9m) -- roughly 494m.
  const samples = [{ d: 10000, terrainM: 490 }];
  assert.equal(losProfileBlocked(samples, 500, 500, D), false);
});

test('losProfileBlocked: long-range curvature alone blocks flat terrain with low-altitude endpoints', () => {
  // Two radars/targets at 15m altitude, 500km apart: the earth-curvature
  // bulge at the midpoint dwarfs the 15m straight-line height, so even
  // perfectly flat 0m terrain there sits above the (deeply negative) sight
  // line -- this is the real-world "radar horizon" effect, not a terrain
  // feature.
  const D = 500000;
  const samples = [{ d: D / 2, terrainM: 0 }];
  assert.equal(losProfileBlocked(samples, 15, 15, D), true);
});

test('losProfileBlocked: short range keeps the same low-altitude endpoints clear', () => {
  const D = 5000; // 5km -- bulge is negligible at this range
  const samples = [{ d: D / 2, terrainM: 0 }];
  assert.equal(losProfileBlocked(samples, 15, 15, D), false);
});

test('losProfileBlocked: no samples means nothing can block the path', () => {
  assert.equal(losProfileBlocked([], 100, 100, 10000), false);
});
