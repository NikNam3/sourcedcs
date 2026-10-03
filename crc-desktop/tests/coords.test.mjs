import test from 'node:test';
import assert from 'node:assert/strict';
import { toMgrs, fromMgrs, toUtm, formatPair, parsePair, parsePoints, formatComponent, coordFormatOf } from '../app/public/js/coords.js';

const near = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('UTM reference points', () => {
  const eq = toUtm(0, 3);
  near(eq.easting, 500000, 1e-3); near(eq.northing, 0, 1e-3); assert.equal(eq.zone, 31);
  const p45 = toUtm(45, 3);
  near(p45.easting, 500000, 1e-3); near(p45.northing, 4982950.4, 0.1); // meridian arc to 45 deg x k0
  const s = toUtm(-33.8688, 151.2093); // Sydney: 56H 334 ~ 6252 (Sydney 56H, easting about 334368)
  assert.equal(s.zone, 56); assert.equal(s.hemisphere, 'S');
  near(s.easting, 334368, 5);
});

test('MGRS reference points', () => {
  assert.equal(toMgrs(0, 3), '31N EA 00000 00000');
  assert.equal(toMgrs(45, 3), '31T EK 00000 82950');
  assert.match(toMgrs(-33.8688, 151.2093), /^56H [KL][CH] \d{5} \d{5}$/);
  assert.equal(toMgrs(37.0021, 35.4259).slice(0, 4), '36S ');
  assert.equal(toMgrs(85, 0), null);
});

test('MGRS round trips within a metre, both hemispheres, even and odd zones', () => {
  const pts = [[37.0021, 35.4259], [36.5, 35.5], [43.1, 41.2], [36.2, -115.0], [13.5, 144.8], [25.1, 55.2], [-51.8, -58.4], [-33.8, 151.2], [0.5, 3], [70, 25]];
  for (const [lat, lon] of pts) {
    const back = fromMgrs(toMgrs(lat, lon));
    assert.ok(back, `${lat},${lon}`);
    near(back[0], lat, 2e-5); near(back[1], lon, 2e-5);
  }
});

test('MGRS parse: spaces optional, coarser precision, junk refused', () => {
  const full = toMgrs(37.0021, 35.4259);
  assert.deepEqual(fromMgrs(full.replace(/ /g, '')), fromMgrs(full));
  const coarse = fromMgrs(toMgrs(37.0021, 35.4259, 3));
  near(coarse[0], 37.0021, 0.01);
  assert.equal(fromMgrs('36S'), null);
  assert.equal(fromMgrs('36S XC 123'), null);
  assert.equal(fromMgrs('99S XC 1 1'), null);
  assert.equal(fromMgrs('hello'), null);
});

test('DM and DMS text', () => {
  assert.equal(formatComponent(37.35, 'lat', 'DM'), 'N37 21.0');
  assert.equal(formatComponent(35.35, 'lon', 'DM'), 'E035 21.0');
  assert.equal(formatComponent(-35.35, 'lon', 'DMS'), 'W035 21 00.0');
  assert.equal(formatComponent(36.99999999, 'lat', 'DM'), 'N37 00.0');
  assert.equal(formatPair(37.35, 35.35, 'DM'), 'N37 21.0 E035 21.0');
});

test('parsePair accepts decimal, DM, DMS and MGRS whatever was displayed', () => {
  const want = [37.35, 35.35];
  assert.deepEqual(parsePair('37.35, 35.35'), want);
  assert.deepEqual(parsePair('N37 21.0 E035 21.0'), want);
  assert.deepEqual(parsePair('N37 21 00 E035 21 00'), want);
  assert.deepEqual(parsePair('37°21\'00"N 035°21\'00"E'), want);
  const m = parsePair(toMgrs(37.35, 35.35));
  near(m[0], 37.35, 2e-5); near(m[1], 35.35, 2e-5);
  assert.equal(parsePair('N91 00.0 E035 00.0'), null);
  assert.equal(parsePair(''), null);
});

test('formatPair MGRS round-trips through parsePair; falls back to DM at the poles', () => {
  const t = formatPair(36.5, 35.5, 'MGRS'); near(parsePair(t)[0], 36.5, 2e-5);
  assert.match(formatPair(85, 10, 'MGRS'), /^N85/);
});

test('parsePoints reports bad lines', () => {
  const r = parsePoints('37 35\n\nnope\n36.5 35.5');
  assert.equal(r.points.length, 2); assert.deepEqual(r.badLines, [3]);
});

test('coordFormatOf', () => { assert.equal(coordFormatOf('MGRS'), 'MGRS'); assert.equal(coordFormatOf('x'), 'DM'); });
