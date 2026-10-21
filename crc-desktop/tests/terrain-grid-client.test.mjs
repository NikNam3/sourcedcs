/* The client's terrain grid (crc-sync docs/adr/0133): it decodes the file crc-sync's own encoder writes, interpolates
 * like the server, loads once per theater with no per-tick retry (S-ARCH-77), and the contours trace it. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import './helpers/client-env.mjs';

import {
  decodeTerrainGrid, heightInGrid, loadTerrainGrid, terrainGrid, terrainHeightAt, terrainGridState, onTerrainGrid, _resetTerrainGridForTest,
} from '../app/public/js/terrain-grid.js';
import { elevTraceBlock, elevBlocksFor, elevStrideFor } from '../app/public/js/elevation.js';
import { countMaptilerRequest, maptilerRequestCount, transformMaptilerRequest, _resetMaptilerKeyForTest } from '../app/public/js/maptiler-key.js';

const require = createRequire(import.meta.url);
const server = require('../../crc-sync/src/terrain-grid.js');

// A cone 3,000 m high at (35.1, 36.1) over a 0.2 x 0.2 degree box, 500 m spacing.
const BOX = { latMin: 35, latMax: 35.2, lonMin: 36, lonMax: 36.2 };
function serverFile({ theater = 'Syria', spacingM = 500 } = {}) {
  const plan = server.planGrid(BOX, spacingM);
  const heights = new Int16Array(plan.rows * plan.cols);
  for (let r = 0; r < plan.rows; r++) for (let c = 0; c < plan.cols; c++) {
    const lat = plan.latMin + r * plan.latStep, lon = plan.lonMin + c * plan.lonStep;
    const dKm = Math.hypot((lat - 35.1) * 111.32, (lon - 36.1) * 111.32 * Math.cos(35.1 * Math.PI / 180));
    heights[r * plan.cols + c] = Math.max(0, Math.round(3000 - dKm * 300));
  }
  const header = { format: server.FORMAT, theater, spacingM, ...plan, builtAt: '2026-10-21T00:00:00.000Z', dcsVersion: 't' };
  const buf = server.encodeGrid(header, heights);
  return { buf, ab: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), grid: server.decodeGrid(buf) };
}
const response = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => body, headers: { get: (h) => headers[h.toLowerCase()] ?? null } });

test('parity: the client decodes crc-sync\'s file and interpolates exactly as the server does', () => {
  const { ab, grid } = serverFile();
  const g = decodeTerrainGrid(ab);
  assert.deepEqual(g.header, grid.header);
  for (const [lat, lon] of [[35.1, 36.1], [35.0123, 36.177], [35.2, 36.2], [34.9, 36.1], [35.1, 36.25]]) {
    assert.equal(heightInGrid(g, lat, lon), grid.heightAt(lat, lon), `${lat},${lon}`);
  }
  assert.throws(() => decodeTerrainGrid(new ArrayBuffer(20)), /magic/);
  assert.throws(() => decodeTerrainGrid(ab.slice(0, ab.byteLength - 2)), /size/);
});

test('loadTerrainGrid: loads once per theater, 304 keeps it, 404 is remembered, another theater drops it', async () => {
  _resetTerrainGridForTest();
  const { ab } = serverFile();
  const calls = [];
  let answer = () => response(200, ab, { etag: '"e1"' });
  const fetchFn = async (url, opts) => { calls.push(opts.headers); return answer(); };
  let changes = 0; onTerrainGrid(() => { changes += 1; });
  assert.ok(await loadTerrainGrid('Syria', { Authorization: 'Bearer t' }, { fetchFn }));
  assert.equal(calls[0].Authorization, 'Bearer t');
  assert.ok(terrainHeightAt(35.1, 36.1) > 2900);
  answer = () => response(304, null);
  await loadTerrainGrid('Syria', {}, { fetchFn });
  assert.equal(calls[1]['If-None-Match'], '"e1"');
  assert.ok(terrainGrid(), 'a 304 keeps the grid');
  answer = () => response(404, null);
  await loadTerrainGrid('Caucasus', {}, { fetchFn });
  assert.equal(terrainGrid(), null, 'another theater never shows this one\'s heights');
  assert.equal(terrainGridState().status, 'absent');
  assert.equal(changes, 2);
});

test('loadTerrainGrid: a failure waits a back-off before the next theater message may try again', async (t) => {
  _resetTerrainGridForTest();
  const warn = console.warn; console.warn = () => {}; t.after(() => { console.warn = warn; });
  let n = 0, clock = 1000;
  const fetchFn = async () => { n += 1; return response(503, null); };
  await loadTerrainGrid('Syria', {}, { fetchFn, now: () => clock });
  await loadTerrainGrid('Syria', {}, { fetchFn, now: () => clock });
  assert.equal(n, 1, 'no retry inside the back-off');
  clock += 60000;
  await loadTerrainGrid('Syria', {}, { fetchFn, now: () => clock });
  assert.equal(n, 2);
  clock += 60000;
  await loadTerrainGrid('Syria', {}, { fetchFn, now: () => clock });
  assert.equal(n, 2, 'the back-off doubled');
  assert.equal(terrainGridState().backoffMs, 240000);
});

test('contours: a cone gives closed rings at its levels, placed on the grid, and the blocks cover the view', () => {
  const { ab } = serverFile();
  const g = decodeTerrainGrid(ab);
  const { lines, labels } = elevTraceBlock(g, 1, 0, 0, 1000);
  assert.equal(lines.length, 9, '1000 ft to 9000 ft (the cone is 9,843 ft)');
  for (const f of lines) for (const seg of f.geometry.coordinates) for (const [lon, lat] of seg) {
    assert.ok(lon >= BOX.lonMin && lon <= BOX.lonMax + 0.01 && lat >= BOX.latMin && lat <= BOX.latMax + 0.01);
  }
  assert.deepEqual(labels.map((l) => l.properties.text), ["5000'"]);
  assert.deepEqual(elevBlocksFor(g, 1, 36, 35, 36.2, 35.2), [[0, 0]]);
  assert.deepEqual(elevBlocksFor(g, 1, 40, 40, 41, 41), [], 'outside the grid');
  assert.equal(elevStrideFor(14, 35, 500), 1);
  assert.equal(elevStrideFor(6, 35, 500), 16);
});

test('MapTiler requests are counted at the one place they pass', () => {
  _resetMaptilerKeyForTest();
  transformMaptilerRequest('https://api.maptiler.com/tiles/v3/1/1/1.pbf');
  transformMaptilerRequest('/fonts/x.pbf');
  assert.equal(maptilerRequestCount(), 1);
  const info = console.info; const lines = []; console.info = (l) => lines.push(l);
  _resetMaptilerKeyForTest();
  try { countMaptilerRequest(0); countMaptilerRequest(3600000); } finally { console.info = info; }
  assert.ok(lines.some((l) => /MapTiler requests in the last/.test(l)));
});
