import test from 'node:test';
import assert from 'node:assert/strict';

import { normDeg, reciprocal, angularDiff, gridToTrue, toMagnetic } from '../src/efsp/carrier/angles.js';

// Carrier model, pure (WP7A, guide §9.12, docs/adr/0064): angles and ship state.

// ── angles.js ────────────────────────────────────────────────────────────────

test('normDeg: wraps negatives, 360 is 0, non-finite is null', () => {
  assert.equal(normDeg(-10), 350);
  assert.equal(normDeg(-370), 350);
  assert.equal(normDeg(360), 0);
  assert.equal(normDeg(-360), 0);
  assert.ok(Object.is(normDeg(-360), 0), 'never -0');
  assert.equal(normDeg(725), 5);
  assert.equal(normDeg(NaN), null);
  assert.equal(normDeg(Infinity), null);
  assert.equal(normDeg(null), null);
  assert.equal(normDeg('90'), null);
});

test('reciprocal: 0 → 180, 270 → 90, unknown → null', () => {
  assert.equal(reciprocal(0), 180);
  assert.equal(reciprocal(270), 90);
  assert.equal(reciprocal(180), 0);
  assert.equal(reciprocal(null), null);
});

test('angularDiff: smallest difference across the wrap', () => {
  assert.equal(angularDiff(350, 10), 20);
  assert.equal(angularDiff(10, 350), 20);
  assert.equal(angularDiff(0, 180), 180);
  assert.equal(angularDiff(90, 90), 0);
  assert.equal(angularDiff(null, 90), null);
});

test('gridToTrue and toMagnetic convert only with an injected value (decisions H15, S-W3)', () => {
  assert.equal(gridToTrue(100, 2), 102);
  assert.equal(gridToTrue(359, 2), 1);
  assert.equal(gridToTrue(100, null), null, 'unknown convergence is not guessed');
  // magnetic = true − east variation
  assert.equal(toMagnetic(100, 5), 95);
  assert.equal(toMagnetic(2, 5), 357);
  assert.equal(toMagnetic(100, -3), 103);
  assert.equal(toMagnetic(100, undefined), null, 'unknown variation is not guessed');
});
