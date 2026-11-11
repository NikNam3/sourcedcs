import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deriveInputs, pressureAltitudeFt, slopePercent, windComponents } from '../src/core/inputs/derive.ts';
import type { Inputs } from '../src/core/inputs/inputs.ts';
import { DEFAULT_INPUTS } from '../src/core/inputs/inputs.ts';
import { parseNumber, parseWind } from '../src/core/inputs/parse.ts';

const near = (actual: number, expected: number, tolerance: number): void => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${String(actual)} is not ${String(expected)} ± ${String(tolerance)}`,
  );
};

test('DEFAULT_INPUTS: CG 35, RCR dry 23, wet 18, additional drag index 0, the rest empty', () => {
  assert.deepEqual(DEFAULT_INPUTS, {
    takeoffGwLb: '',
    landingGwLb: '',
    cgPct: '35',
    additionalDragIndex: '0',
    runway: '',
    headingDeg: '',
    lengthFt: '',
    nearElevFt: '',
    farElevFt: '',
    altimeterInHg: '',
    tempC: '',
    wind: '',
    rcrDry: '23',
    rcrWet: '18',
  });
});

test('parseNumber reads thousands commas, surrounding spaces and a minus sign', () => {
  assert.deepEqual(parseNumber('37,240'), { ok: true, value: 37240 });
  assert.deepEqual(parseNumber(' 29.92 '), { ok: true, value: 29.92 });
  assert.deepEqual(parseNumber('-12'), { ok: true, value: -12 });
  assert.deepEqual(parseNumber('0'), { ok: true, value: 0 });
});

test('parseNumber refuses empty text, words, two decimal points and units', () => {
  for (const text of ['', '   ', 'abc', '1.2.3', '12ft', '1,23', '-']) {
    assert.deepEqual(parseNumber(text), { ok: false }, JSON.stringify(text));
  }
});

test('parseNumber refuses a number too large to be finite (400 nines), either sign', () => {
  assert.deepEqual(parseNumber('9'.repeat(400)), { ok: false });
  assert.deepEqual(parseNumber(`-${'9'.repeat(400)}`), { ok: false });
  assert.deepEqual(parseNumber('1' + '0'.repeat(300)), { ok: true, value: 1e300 });
});

test('parseWind reads ddd/ss with an optional gust, spaces allowed', () => {
  assert.deepEqual(parseWind('230/08'), { ok: true, value: { directionDeg: 230, speedKt: 8, gustKt: null } });
  assert.deepEqual(parseWind('230 / 08 G15'), { ok: true, value: { directionDeg: 230, speedKt: 8, gustKt: 15 } });
  assert.deepEqual(parseWind('230/08G15'), { ok: true, value: { directionDeg: 230, speedKt: 8, gustKt: 15 } });
  assert.deepEqual(parseWind('360/00'), { ok: true, value: { directionDeg: 360, speedKt: 0, gustKt: null } });
});

test('parseWind refuses a gust below the steady wind, a direction outside 1 to 360 and an incomplete wind', () => {
  for (const text of ['230/15G08', '000/05', '361/05', '230', '230/', '', '230/08G']) {
    assert.deepEqual(parseWind(text), { ok: false }, JSON.stringify(text));
  }
});

test('parseWind: calm is 000/00; 000 with any speed or gust stays refused', () => {
  assert.deepEqual(parseWind('000/00'), { ok: true, value: { directionDeg: 0, speedKt: 0, gustKt: null } });
  assert.deepEqual(parseWind(' 000 / 0 '), { ok: true, value: { directionDeg: 0, speedKt: 0, gustKt: null } });
  for (const text of ['000/01', '000/00G00', '000/00G05', '000/05G10']) {
    assert.deepEqual(parseWind(text), { ok: false }, JSON.stringify(text));
  }
});

test('deriveInputs: calm 000/00 gives zero headwind and crosswind', () => {
  const d = deriveInputs({ ...valid, wind: '000/00' });
  assert.ok(d.headwindKt.ok && d.crosswindKt.ok);
  assert.equal(Math.abs(d.headwindKt.value), 0);
  assert.equal(Math.abs(d.crosswindKt.value), 0);
  assert.deepEqual(d.gustKt, { ok: true, value: null });
});

test('pressureAltitudeFt: standard setting gives field elevation; hand-worked high and low settings', () => {
  near(pressureAltitudeFt(2000, 29.921), 2000, 1e-6);
  near(pressureAltitudeFt(0, 30.92), -912, 2);
  near(pressureAltitudeFt(5000, 28.92), 5939, 2);
});

test('slopePercent: uphill positive, downhill negative', () => {
  near(slopePercent(1000, 1040, 5000), 0.8, 1e-12);
  near(slopePercent(1040, 1000, 5000), -0.8, 1e-12);
});

test('windComponents: headwind from the steady wind, crosswind signed (> 0 from the right) from the gust', () => {
  near(windComponents({ directionDeg: 360, speedKt: 10, gustKt: null }, 1).headwindKt, 10, 0.01);
  near(windComponents({ directionDeg: 180, speedKt: 10, gustKt: null }, 360).headwindKt, -10, 1e-9);
  const right = windComponents({ directionDeg: 90, speedKt: 10, gustKt: null }, 360);
  near(right.headwindKt, 0, 1e-9);
  near(right.crosswindKt, 10, 1e-9);
  near(windComponents({ directionDeg: 270, speedKt: 10, gustKt: null }, 360).crosswindKt, -10, 1e-9);
  const gusty = windComponents({ directionDeg: 230, speedKt: 8, gustKt: 15 }, 220);
  const rad = (10 * Math.PI) / 180;
  near(gusty.headwindKt, 8 * Math.cos(rad), 1e-9);
  near(gusty.crosswindKt, 15 * Math.sin(rad), 1e-9);
});

const valid: Inputs = {
  takeoffGwLb: '37,240',
  landingGwLb: '28,000',
  cgPct: '35',
  additionalDragIndex: '0',
  runway: '22',
  headingDeg: '220',
  lengthFt: '10,000',
  nearElevFt: '1,000',
  farElevFt: '1,040',
  altimeterInHg: '29.921',
  tempC: '-12',
  wind: '230/08G15',
  rcrDry: '23',
  rcrWet: '18',
};

test('deriveInputs computes every field from valid inputs', () => {
  const d = deriveInputs(valid);
  assert.deepEqual(d.paFt, { ok: true, value: 1000 });
  assert.deepEqual(d.tempC, { ok: true, value: -12 });
  assert.deepEqual(d.takeoffGwLb, { ok: true, value: 37240 });
  assert.deepEqual(d.landingGwLb, { ok: true, value: 28000 });
  assert.deepEqual(d.cgPct, { ok: true, value: 35 });
  assert.deepEqual(d.gustKt, { ok: true, value: 15 });
  assert.deepEqual(d.runwayFt, { ok: true, value: 10000 });
  assert.deepEqual(d.rcrDry, { ok: true, value: 23 });
  assert.deepEqual(d.rcrWet, { ok: true, value: 18 });
  assert.ok(d.slopePct.ok);
  near(d.slopePct.value, 0.4, 1e-12);
  assert.ok(d.headwindKt.ok && d.crosswindKt.ok);
  near(d.headwindKt.value, 8 * Math.cos((10 * Math.PI) / 180), 1e-9);
  near(d.crosswindKt.value, 15 * Math.sin((10 * Math.PI) / 180), 1e-9);
});

test('deriveInputs: a steady wind gives gust null', () => {
  assert.deepEqual(deriveInputs({ ...valid, wind: '230/08' }).gustKt, { ok: true, value: null });
});

test('deriveInputs: an empty landing weight fails only landingGwLb, naming it', () => {
  const d = deriveInputs({ ...valid, landingGwLb: '' });
  assert.deepEqual(d.landingGwLb, { ok: false, fields: ['landingGwLb'] });
  for (const key of Object.keys(d) as (keyof typeof d)[]) {
    if (key !== 'landingGwLb') assert.equal(d[key].ok, true, key);
  }
});

test('deriveInputs: an unparseable altimeter fails paFt, naming altimeterInHg', () => {
  const d = deriveInputs({ ...valid, altimeterInHg: '29,92x' });
  assert.deepEqual(d.paFt, { ok: false, fields: ['altimeterInHg'] });
});

test('deriveInputs applies the physical limits: length > 0, heading 1 to 360, altimeter > 0', () => {
  assert.deepEqual(deriveInputs({ ...valid, lengthFt: '0' }).runwayFt, { ok: false, fields: ['lengthFt'] });
  assert.deepEqual(deriveInputs({ ...valid, lengthFt: '0' }).slopePct, { ok: false, fields: ['lengthFt'] });
  assert.deepEqual(deriveInputs({ ...valid, headingDeg: '0' }).headwindKt, { ok: false, fields: ['headingDeg'] });
  assert.deepEqual(deriveInputs({ ...valid, headingDeg: '361' }).crosswindKt, { ok: false, fields: ['headingDeg'] });
  assert.deepEqual(deriveInputs({ ...valid, altimeterInHg: '0' }).paFt, { ok: false, fields: ['altimeterInHg'] });
});

test('deriveInputs: a derived value that overflows (slope from two huge elevations) names all its fields', () => {
  const huge = '1' + '0'.repeat(308);
  const d = deriveInputs({ ...valid, nearElevFt: `-${huge}`, farElevFt: huge });
  assert.deepEqual(d.slopePct, { ok: false, fields: ['nearElevFt', 'farElevFt', 'lengthFt'] });
  assert.ok(d.paFt.ok, 'pressure altitude from the near elevation alone stays finite');
  assert.ok(Number.isFinite(d.paFt.value));
});

test('deriveInputs: 400 nines of takeoff weight fail takeoffGwLb, naming it', () => {
  assert.deepEqual(deriveInputs({ ...valid, takeoffGwLb: '9'.repeat(400) }).takeoffGwLb, {
    ok: false,
    fields: ['takeoffGwLb'],
  });
});

test('deriveInputs names every failing field a derived value needs', () => {
  const d = deriveInputs({ ...valid, wind: '', headingDeg: '' });
  assert.deepEqual(d.headwindKt, { ok: false, fields: ['wind', 'headingDeg'] });
  assert.deepEqual(d.gustKt, { ok: false, fields: ['wind'] });
});

test('deriveInputs on DEFAULT_INPUTS computes only the defaulted fields', () => {
  const d = deriveInputs(DEFAULT_INPUTS);
  assert.deepEqual(d.cgPct, { ok: true, value: 35 });
  assert.deepEqual(d.rcrDry, { ok: true, value: 23 });
  assert.deepEqual(d.rcrWet, { ok: true, value: 18 });
  assert.deepEqual(d.slopePct, { ok: false, fields: ['nearElevFt', 'farElevFt', 'lengthFt'] });
});
