import { test } from 'node:test';
import assert from 'node:assert/strict';
import par from '../src/surveillance/par.js';

// docs/adr/0112: the PAR sample's geometry (surveillance/par.js). Range along the final approach course from the
// reference point, height above TDZE, the glidepath through TCH over the reference point at the GPA.

const FT_PER_NM = 6076.12;
const M_PER_FT = 0.3048;
const RWY = { refLat: 36.99444, refLon: 35.41157, courseTrueDeg: 56, tdzeFt: 238, tchFt: 50, gpaDeg: 3.06 };
const COV = { rangeNm: 20, azimuthHalfDeg: 15, elevationMinDeg: -1, elevationMaxDeg: 7, apexBeyondNm: 0.5 };

/** An aircraft `nm` before the reference point on the course, `rightFt` right of it (as the pilot sees it), at `heightFt` above TDZE. */
function at(g, nm, { rightFt = 0, heightFt = null } = {}) {
  const back = par.offsetPoint(g.refLat, g.refLon, (g.courseTrueDeg + 180) % 360, nm * 1852);
  const p = rightFt ? par.offsetPoint(back.lat, back.lon, (g.courseTrueDeg + 90) % 360, Math.abs(rightFt) * M_PER_FT * Math.sign(rightFt)) : back;
  const h = heightFt === null ? g.tchFt + nm * FT_PER_NM * Math.tan(g.gpaDeg * Math.PI / 180) : heightFt;
  return { lat: p.lat, lon: p.lon, altFt: g.tdzeFt + h, gsMs: 72, vsMs: -3.8 };
}

test('on the glidepath and on course: range along the course, deviations zero, height exact (not the 100 ft SSR rounding)', () => {
  const p = par.measure(RWY, at(RWY, 3));
  assert.equal(p.rangeNm, 3);
  assert.equal(p.elevDevDeg, 0);
  assert.equal(p.elevDevFt, 0);
  assert.equal(p.azDevFt, 0);
  assert.equal(p.azDeg, 0);
  assert.equal(p.elevDeg, 3.06);
  assert.equal(p.heightFt, 1024, '50 + 3 NM * tan 3.06 = 1024 ft, to the foot');
  assert.notEqual(p.heightFt % 100, 0);
  assert.equal(p.gsKt, 140);
  assert.equal(p.vsFpm, -750);
});

test('above and right of course: positive elevation and azimuth deviations, in feet and degrees', () => {
  const p = par.measure(RWY, at(RWY, 4, { rightFt: 300, heightFt: 50 + 4 * FT_PER_NM * Math.tan(3.56 * Math.PI / 180) }));
  assert.equal(p.rangeNm, 4);
  assert.ok(Math.abs(p.elevDevDeg - 0.5) < 0.02, `elevDevDeg ${p.elevDevDeg}`);
  assert.ok(p.elevDevFt > 200 && p.elevDevFt < 220, `elevDevFt ${p.elevDevFt}`);
  assert.ok(Math.abs(p.azDevFt - 300) <= 1, `azDevFt ${p.azDevFt}`);
  assert.ok(Math.abs(p.azDeg - Math.atan2(300, 4 * FT_PER_NM) * 180 / Math.PI) < 0.02);
  const left = par.measure(RWY, at(RWY, 4, { rightFt: -300 }));
  assert.ok(left.azDevFt < 0 && left.azDeg < 0, 'left of course is negative');
});

test('the reciprocal end measures from its own threshold and course', () => {
  const g23 = { ...RWY, refLat: 37.00976, refLon: 35.44003, courseTrueDeg: 236 };
  const p = par.measure(g23, at(g23, 5, { rightFt: 120 }));
  assert.equal(p.rangeNm, 5);
  assert.ok(Math.abs(p.azDevFt - 120) <= 1);
  // the same aircraft measured against runway 05 is behind it, and far off its course
  assert.ok(par.measure(RWY, at(g23, 5)).rangeNm < -1);
});

test('below DA the sample is the same arithmetic (no tolerance applies there, H116: the client decides)', () => {
  const p = par.measure(RWY, at(RWY, 0.4, { heightFt: 120 }));
  assert.equal(p.rangeNm, 0.4);
  assert.equal(p.heightFt, 120);
  assert.ok(p.elevDevFt < 0);
});

test('over or past the threshold: feet against TCH, no angles', () => {
  const p = par.measure(RWY, at(RWY, -0.1, { heightFt: 30 }));
  assert.ok(p.rangeNm < 0);
  assert.equal(p.elevDeg, null);
  assert.equal(p.azDeg, null);
  assert.equal(p.elevDevFt, -20);
});

test('no course: straight-line range, no azimuth; no TDZE: no height', () => {
  const p = par.measure({ ...RWY, courseTrueDeg: null }, at(RWY, 2, { rightFt: 500 }));
  assert.ok(p.rangeNm >= 2 && p.rangeNm < 2.01);
  assert.equal(p.azDevFt, null);
  const q = par.measure({ ...RWY, tdzeFt: null }, at(RWY, 2));
  assert.equal(q.heightFt, null);
  assert.equal(q.elevDevDeg, null);
  assert.equal(q.azDevFt, 0);
});

test('coverage: 20 NM, 15 degrees either side, -1 to +7 degrees from an antenna 0.5 NM beyond the threshold', () => {
  assert.equal(par.inCoverage(RWY, at(RWY, 10), COV), true);
  assert.equal(par.inCoverage(RWY, at(RWY, 0.2, { heightFt: 60 }), COV), true, 'short final is covered');
  assert.equal(par.inCoverage(RWY, at(RWY, 21), COV), false, 'beyond range');
  assert.equal(par.inCoverage(RWY, at(RWY, 5, { rightFt: 5 * FT_PER_NM * Math.tan(20 * Math.PI / 180) }), COV), false, 'outside azimuth');
  assert.equal(par.inCoverage(RWY, at(RWY, 2, { heightFt: 2.5 * FT_PER_NM * Math.tan(8 * Math.PI / 180) }), COV), false, 'a missed approach climbing out above 7 degrees');
  assert.equal(par.inCoverage(RWY, at(RWY, -3), COV), false, 'behind the antenna');
});

test('validateParApproaches: every key checked, ends must exist, null TDZE and null GPA allowed', () => {
  const ok = { label: 'PAR RWY 05', thresholdLat: 37, thresholdLon: 35, courseTrueDeg: 56, tdzeFt: null, tchFt: 50, decisionHeightFt: 200, glideslopeDeg: null };
  assert.equal(par.validateParApproaches({ _comment: 'x', '05': ok }, ['05', '23']), null);
  assert.equal(par.validateParApproaches({ '05': { ...ok, tdzeFt: 238, glideslopeDeg: 3 } }, ['05']), null);
  assert.match(par.validateParApproaches({ '09': ok }, ['05', '23']), /no runway end 09/);
  assert.match(par.validateParApproaches({ '05': { ...ok, gpa: 3 } }, ['05']), /unknown key gpa/);
  assert.match(par.validateParApproaches({ '05': { ...ok, glideslopeDeg: 5 } }, ['05']), /glideslopeDeg/);
  assert.match(par.validateParApproaches({ '05': { ...ok, courseTrueDeg: 360 } }, ['05']), /courseTrueDeg/);
  assert.match(par.validateParApproaches({ '05': { ...ok, thresholdLat: undefined } }, ['05']), /thresholdLat/);
  assert.match(par.validateParApproaches([], ['05']), /object keyed by runway end/);
});

test('the shipped Incirlik facility config validates with its parApproaches, and a broken one is refused', async () => {
  const { validateFacilityConfig } = await import('../src/efsp/facility-schema.js');
  const fs = await import('fs');
  const cfg = JSON.parse(fs.readFileSync(new URL('../config/efsp-facility-incirlik.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(cfg.parApproaches).filter(k => !k.startsWith('_')).sort(), ['05', '23']);
  assert.equal(validateFacilityConfig(cfg, 'INCIRLIK').ok, true);
  const bad = { ...cfg, parApproaches: { ...cfg.parApproaches, '05': { ...cfg.parApproaches['05'], tchFt: -1 } } };
  assert.match(validateFacilityConfig(bad, 'INCIRLIK').detail, /parApproaches\.05\.tchFt/);
});
