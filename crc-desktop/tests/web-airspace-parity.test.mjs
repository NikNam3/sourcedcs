// The sourcedcs-web airspace admin form and booking rules are hand copies of crc-desktop's / crc-sync's.
// This runs the same input tables through both so a drift fails here (ARCH-W §1.2, B11).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parsePair, parseCoord, parsePoints } from '../app/public/js/coords.js';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WebCoords = require(path.join(root, 'sourcedcs-web/public/js/airspace-coords.js'));
const bookings = require(path.join(root, 'sourcedcs-web/airspace-bookings.js'));
const schema = require(path.join(root, 'crc-sync/src/efsp/airspace-schema.js'));

const PAIRS = [
  '36.2083, 36.75', '-36.5 36.75', '36 12.5 36 45.0', '-36 12.5 -36 45.0', '36 12 30 036 45 00',
  '36 12.5 N 036 45.0 E', 'N36°12\'30" E036°45\'00"', '36 12 30 N 036 45 00 E', '36S XC 12345 12345',
  '36 12 36', '36 12.5 36 75.0', '91 0', '0 181', 'N36 12 N 036 45', '36 12.5 36 45.0 1', 'hello', '',
  '36 60 36 45', '36 12 61 036 45 00', '36,12.5,36,45.0',
];
const COORDS = [['36.5', 'lat'], ['-36.5', 'lat'], ['S36 30', 'lat'], ['036:45:00E', 'lon'], ['91', 'lat'], ['181', 'lon'], ['36 30 00 E', 'lat'], ['x', 'lon']];

test('web and desktop read every coordinate pair the same way', () => {
  for (const t of PAIRS) assert.deepEqual(WebCoords.parsePair(t), parsePair(t), JSON.stringify(t));
});

test('degrees plus decimal minutes without hemisphere letters is accepted by both', () => {
  assert.deepEqual(WebCoords.parsePair('36 12.5 36 45.0'), [36.208333, 36.75]);
});

test('web and desktop read every single coordinate the same way', () => {
  for (const [t, axis] of COORDS) assert.equal(WebCoords.parseCoord(t, axis), parseCoord(t, axis), `${t} ${axis}`);
});

test('web and desktop agree on which lines of a table are bad', () => {
  const text = PAIRS.join('\n');
  assert.deepEqual(WebCoords.parsePoints(text), parsePoints(text));
});

test('the web booking altitude rule is the schema rule', () => {
  assert.equal(bookings.MIN_ALTITUDE_FT, schema.MIN_ALTITUDE_FT);
  assert.equal(bookings.MAX_ALTITUDE_FT, schema.MAX_ALTITUDE_FT);
  for (const v of [-1, 0, 1, 1500.5, 99999, 100000, 100001, 1e9, NaN, Infinity, '5', null, undefined, true]) {
    assert.equal(bookings.isValidAltitude(v), schema.isValidAltitude(v), String(v));
  }
});
