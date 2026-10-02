'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/js/airspace-coords.js');

test('parseCoord: decimal, signed, DMS and hemisphere forms', () => {
  assert.equal(C.parseCoord('36.5', 'lat'), 36.5);
  assert.equal(C.parseCoord('-36.5', 'lat'), -36.5);
  assert.equal(C.parseCoord('36 30 00 N', 'lat'), 36.5);
  assert.equal(C.parseCoord('N36°30\'00"', 'lat'), 36.5);
  assert.equal(C.parseCoord('S36 30', 'lat'), -36.5);
  assert.equal(C.parseCoord('036:45:00E', 'lon'), 36.75);
  assert.equal(C.parseCoord('W 36.75', 'lon'), -36.75);
});

test('parseCoord: refuses wrong axis, out of range, junk', () => {
  assert.equal(C.parseCoord('36 E', 'lat'), null);
  assert.equal(C.parseCoord('91', 'lat'), null);
  assert.equal(C.parseCoord('181', 'lon'), null);
  assert.equal(C.parseCoord('36 75 00', 'lat'), null);
  assert.equal(C.parseCoord('abc', 'lat'), null);
  assert.equal(C.parseCoord('', 'lat'), null);
});

test('parsePair: decimal, DMS paste in several shapes', () => {
  assert.deepEqual(C.parsePair('36.2083, 36.75'), [36.2083, 36.75]);
  assert.deepEqual(C.parsePair('36 12 30 N 036 45 00 E'), [36.208333, 36.75]);
  assert.deepEqual(C.parsePair('N36°12\'30" E036°45\'00"'), [36.208333, 36.75]);
  assert.deepEqual(C.parsePair('E036 45 00 N36 12 30'), [36.208333, 36.75]);
  assert.deepEqual(C.parsePair('36 12 30 036 45 00'), [36.208333, 36.75]);
  assert.deepEqual(C.parsePair('36.5S 20.25W'), [-36.5, -20.25]);
  assert.equal(C.parsePair('36 N 20 N'), null);
  assert.equal(C.parsePair('nonsense'), null);
  assert.equal(C.parsePair('95 10'), null);
});

test('parsePoints reports bad lines and skips blanks', () => {
  const r = C.parsePoints('36.1 36.1\n\nbad line\n36.2, 36.3\r\nN36 30 E037 00');
  assert.deepEqual(r.points, [[36.1, 36.1], [36.2, 36.3], [36.5, 37]]);
  assert.deepEqual(r.badLines, [3]);
});

test('outlineSvg draws a polygon or a route, nothing under two points', () => {
  assert.equal(C.outlineSvg([[1, 1]], true), '');
  assert.match(C.outlineSvg([[36, 36], [36, 37], [37, 37]], true), /<polygon/);
  assert.match(C.outlineSvg([[36, 36], [36, 37]], false), /<polyline/);
});
