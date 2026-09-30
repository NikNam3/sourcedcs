import test from 'node:test';
import assert from 'node:assert/strict';

import { normDeg, reciprocal, angularDiff, gridToTrue, toMagnetic } from '../src/efsp/carrier/angles.js';
import {
  ANGLED_DECK_BY_TYPE, DEFAULT_HULL, validateHullConfig, matchHullTrack, hullMatchProblem,
  computeFinalBearing, inHgFromPa, buildShipState, staleFrom, shipStateChanged,
  defaultShipInputs, applyShipStateInput, normalizeShipInputs, displayBearing,
} from '../src/efsp/carrier/ship-state.js';

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

// ── ship-state.js ────────────────────────────────────────────────────────────


const NOW = Date.UTC(2026, 8, 30, 14, 0, 0);
const BLUE = 3;
const RED = 2;

function ship(over = {}) {
  return { id: 101, name: 'UNION', type: 'CVN_72', coalition: BLUE, category: 4, lat: 34.5, lon: 34.0,
    heading: 123.6, groundSpeed: 15.4333, ...over };
}

test('DEFAULT_HULL is CVN-72 unit UNION (decisions H13/H26) and validates', () => {
  assert.equal(DEFAULT_HULL.hullId, 'CVN-72');
  assert.equal(DEFAULT_HULL.match.unitName, 'UNION');
  assert.equal(DEFAULT_HULL.match.type, 'CVN_72');
  assert.equal(validateHullConfig(DEFAULT_HULL).ok, true);
  assert.equal(ANGLED_DECK_BY_TYPE.CVN_72, 9);
});

test('validateHullConfig refusals', () => {
  assert.equal(validateHullConfig(null).ok, false);
  assert.equal(validateHullConfig({ hullId: '', match: { type: 'CVN_72' } }).ok, false);
  assert.match(validateHullConfig({ hullId: 'X', match: {} }).detail, /never a track id/);
  assert.equal(validateHullConfig({ hullId: 'X', match: { type: 'CVN_72', coalition: 'blue' } }).ok, false);
  assert.equal(validateHullConfig({ hullId: 'X', match: { type: 'CVN_72' }, angledDeckDeg: -1 }).ok, false);
  assert.equal(validateHullConfig({ hullId: 'X', match: { type: 'CVN_72' }, angledDeckDeg: 8.5 }).ok, true);
});

test('computeFinalBearing: BRC − angled deck, with the wrap (BRC 5, offset 9 → 356)', () => {
  assert.equal(computeFinalBearing(124, 9), 115);
  assert.equal(computeFinalBearing(5, 9), 356);
  assert.equal(computeFinalBearing(124, null), null);
  assert.equal(computeFinalBearing(null, 9), null);
});

test('buildShipState from a CVN_72 track: BRC 124, FB 115, 30 kt, labelled GRID without a convergence', () => {
  const s = buildShipState({ hull: DEFAULT_HULL, track: ship(), now: NOW });
  assert.equal(s.brcDeg, 124);
  assert.equal(s.finalBearingDeg, 115);
  assert.equal(s.finalBearingUnavailable, null);
  assert.equal(s.speedKt, 30);
  assert.equal(s.headingRef, 'GRID');
  assert.equal(s.angledDeckSource, 'TYPE_DEFAULT');
  assert.equal(s.atUtc, NOW);
  assert.equal(s.stale, false);
  assert.equal(s.found, true);
  assert.equal(s.unitName, 'UNION');
});

test('buildShipState converts grid → true with an injected convergence (decisions H15)', () => {
  const s = buildShipState({ hull: DEFAULT_HULL, track: ship({ heading: 123.6 }), now: NOW, gridConvergenceDeg: -2 });
  assert.equal(s.headingRef, 'TRUE');
  assert.equal(s.brcDeg, 122);
  assert.equal(s.finalBearingDeg, 113);
});

test('buildShipState: unknown type → FB null with a reason; a hull override supplies it', () => {
  const s = buildShipState({ hull: { hullId: 'CV', match: { type: 'CV_59' } }, track: ship({ type: 'CV_59' }), now: NOW });
  assert.equal(s.finalBearingDeg, null);
  assert.equal(s.finalBearingUnavailable, 'angled deck not configured for CV_59');
  const o = buildShipState({ hull: { hullId: 'CV', match: { type: 'CV_59' }, angledDeckDeg: 10 }, track: ship({ type: 'CV_59' }), now: NOW });
  assert.equal(o.finalBearingDeg, 114);
  assert.equal(o.angledDeckSource, 'HULL');
});

test('buildShipState: no track → not found, FB unavailable; null groundSpeed → null speed', () => {
  const s = buildShipState({ hull: DEFAULT_HULL, track: null, now: NOW });
  assert.equal(s.found, false);
  assert.equal(s.finalBearingUnavailable, 'no ship track');
  assert.equal(buildShipState({ hull: DEFAULT_HULL, track: ship({ groundSpeed: null }), now: NOW }).speedKt, null);
});

test('buildShipState altimeter: controller input wins, else theater weather, else null', () => {
  assert.equal(buildShipState({ hull: DEFAULT_HULL, track: ship(), now: NOW, weatherPa: 101325 }).altimeterInHg, 29.92);
  assert.equal(buildShipState({ hull: DEFAULT_HULL, track: ship(), now: NOW, weatherPa: 101325 }).altimeterSource, 'THEATER_WEATHER');
  const set = buildShipState({ hull: DEFAULT_HULL, track: ship(), now: NOW, weatherPa: 101325, inputs: { altimeterInHg: 30.12 } });
  assert.equal(set.altimeterInHg, 30.12);
  assert.equal(set.altimeterSource, 'SET');
  assert.equal(buildShipState({ hull: DEFAULT_HULL, track: ship(), now: NOW }).altimeterInHg, null);
});

test('inHgFromPa(101325) ≈ 29.92', () => {
  assert.equal(inHgFromPa(101325), 29.92);
  assert.equal(inHgFromPa(null), null);
  assert.equal(inHgFromPa(-1), null);
});

test('matchHullTrack: by unit name, by type, ambiguous type → null, non-ships ignored, own coalition', () => {
  const union = ship();
  const other = ship({ id: 102, name: 'CARL', type: 'CVN_72' });
  const plane = ship({ id: 103, name: 'UNION', category: 0 });
  const red = ship({ id: 104, name: 'UNION', coalition: RED });
  assert.equal(matchHullTrack(DEFAULT_HULL, [plane, other, union, red], { ownCoalition: BLUE }), union, 'unit name first');
  const byType = { hullId: 'H', match: { type: 'CVN_72' } };
  assert.equal(matchHullTrack(byType, [union], { ownCoalition: BLUE }), union);
  assert.equal(matchHullTrack(byType, [union, other], { ownCoalition: BLUE }), null, 'ambiguous → no guess');
  assert.equal(hullMatchProblem(byType, [union, other], { ownCoalition: BLUE }), 'hull ambiguous — configure unitName');
  // unit name missing → falls back to a unique type
  assert.equal(matchHullTrack(DEFAULT_HULL, [other], { ownCoalition: BLUE }), other);
  assert.equal(matchHullTrack(DEFAULT_HULL, [plane], { ownCoalition: BLUE }), null, 'category 4 only');
  assert.equal(matchHullTrack(DEFAULT_HULL, [red], { ownCoalition: BLUE }), null, 'own coalition only');
  assert.equal(matchHullTrack(DEFAULT_HULL, [union], {}), null, 'unknown own coalition matches nothing');
  assert.equal(hullMatchProblem(DEFAULT_HULL, [union], {}), 'own coalition unknown');
  const any = { hullId: 'H', match: { unitName: 'UNION', coalition: 'any' } };
  assert.equal(matchHullTrack(any, [red], {}), red);
  assert.equal(matchHullTrack(DEFAULT_HULL, new Map([[1, union]]).values(), { ownCoalition: BLUE }), union, 'any iterable');
  assert.equal(hullMatchProblem(DEFAULT_HULL, [], { ownCoalition: BLUE }), 'hull not found');
  assert.equal(hullMatchProblem(DEFAULT_HULL, [union], { ownCoalition: BLUE }), null);
});

test('staleFrom keeps the last-known banner, marks it stale, keeps atUtc', () => {
  const s = buildShipState({ hull: DEFAULT_HULL, track: ship(), now: NOW });
  const st = staleFrom(s, NOW + 5000);
  assert.equal(st.stale, true);
  assert.equal(st.atUtc, NOW);
  assert.equal(st.staleSinceUtc, NOW + 5000);
  assert.equal(st.brcDeg, 124);
  assert.equal(staleFrom(st, NOW + 9000).staleSinceUtc, NOW + 5000, 'stays stale since the first time');
  assert.equal(s.stale, false, 'input not mutated');
  assert.equal(staleFrom(null, NOW), null);
});

test('shipStateChanged: a sub-degree turn is not a change; 1° is', () => {
  const a = buildShipState({ hull: DEFAULT_HULL, track: ship({ heading: 123.6 }), now: NOW });
  const b = buildShipState({ hull: DEFAULT_HULL, track: ship({ heading: 124.3 }), now: NOW + 1000 });
  const c = buildShipState({ hull: DEFAULT_HULL, track: ship({ heading: 125.2 }), now: NOW + 2000 });
  assert.equal(shipStateChanged(a, b), false, 'both round to 124; time alone is not a change');
  assert.equal(shipStateChanged(a, c), true);
  assert.equal(shipStateChanged(a, c, { headingStepDeg: 2 }), false);
  assert.equal(shipStateChanged(a, staleFrom(a, NOW)), true);
  assert.equal(shipStateChanged(null, a), true);
  const slow = buildShipState({ hull: DEFAULT_HULL, track: ship({ groundSpeed: 5 }), now: NOW });
  assert.equal(shipStateChanged(a, slow), true);
});

test('applyShipStateInput accepts the altimeter only', () => {
  const r = applyShipStateInput(defaultShipInputs(), { altimeterInHg: 29.87 });
  assert.equal(r.ok, true);
  assert.equal(r.inputs.altimeterInHg, 29.87);
  assert.equal(applyShipStateInput(r.inputs, { altimeterInHg: null }).inputs.altimeterInHg, null);
  for (const k of ['finalBearingDeg', 'brcDeg', 'headingDeg', 'speedKt', 'lat', 'lon']) {
    const bad = applyShipStateInput(defaultShipInputs(), { [k]: 200 });
    assert.equal(bad.ok, false, k);
    assert.equal(bad.reason, 'VALIDATION_ERROR');
    assert.match(bad.detail, /final bearing is computed from ship heading \(§9\.12 rule 5\)/);
  }
  assert.equal(applyShipStateInput(defaultShipInputs(), { altimeterInHg: 35 }).ok, false);
  assert.equal(applyShipStateInput(defaultShipInputs(), { altimeterInHg: '29.92' }).ok, false);
  assert.equal(applyShipStateInput(defaultShipInputs(), {}).ok, false);
  assert.equal(applyShipStateInput(defaultShipInputs(), null).ok, false);
  assert.deepEqual(normalizeShipInputs({ altimeterInHg: 99, junk: 1 }), { altimeterInHg: null });
  assert.deepEqual(normalizeShipInputs({ altimeterInHg: 30.01 }), { altimeterInHg: 30.01 });
});

test('displayBearing: magnetic with a variation, labelled T or G otherwise (decisions H15)', () => {
  assert.deepEqual(displayBearing(115, { ref: 'TRUE', magneticVariationDeg: 5 }), { value: 110, ref: 'M' });
  assert.deepEqual(displayBearing(2, { ref: 'TRUE', magneticVariationDeg: 5 }), { value: 357, ref: 'M' });
  assert.deepEqual(displayBearing(115, { ref: 'TRUE' }), { value: 115, ref: 'T' });
  assert.deepEqual(displayBearing(115.4, { ref: 'GRID', magneticVariationDeg: 5 }), { value: 115, ref: 'G' });
  assert.deepEqual(displayBearing(null), { value: null, ref: null });
});
