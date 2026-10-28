/* The client's jurisdiction outline maths is a hand copy of crc-sync's src/efsp/airspace/jurisdiction.js (crc-sync
   docs/adr/0125): the same geometries go through both and the rings must be equal. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as client from '../app/public/js/panels/efsp/jurisdiction-geometry.js';

const require = createRequire(import.meta.url);
const server = require('../../crc-sync/src/efsp/airspace/jurisdiction.js');

const hull = (id) => (id === 'CVN-72' ? { lat: 36.3, lon: 34.6 } : null);
const GEOMETRIES = {
  'the control zone (circle with a cut)': { source: 'CIRCLE', centre: { lat: 37.003333, lon: 35.425 }, radiusNm: 5, cut: { from: [36.985, 35.323611], to: [37.075556, 35.476944] } },
  'a plain circle': { source: 'CIRCLE', centre: { lat: 36.998889, lon: 35.433056 }, radiusNm: 50, cut: null },
  'a circle on a hull': { source: 'CIRCLE', centre: { hullId: 'CVN-72' }, radiusNm: 50, cut: null },
  'a circle on an unknown hull': { source: 'CIRCLE', centre: { hullId: 'CVN-99' }, radiusNm: 50, cut: null },
  'a polygon': { source: 'POLYGON', points: [[36, 35], [36, 36], [37, 36]] },
  'nothing': null,
};

for (const [name, g] of Object.entries(GEOMETRIES)) {
  test(`ringOf parity: ${name}`, () => {
    assert.deepEqual(client.ringOf(g, hull), server.ringOf(g, hull));
  });
}

test('constants and the hull test agree', () => {
  assert.equal(client.RING_POINTS, server.RING_POINTS);
  for (const g of Object.values(GEOMETRIES)) {
    assert.equal(client.isHullAnchored({ geometry: g }), server.isHullAnchored({ geometry: g }));
  }
});
