import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crcLog from '../src/log.js';

/* Terrain masking, server-side (docs/adr/0044, 0133).
 *
 * The first half is crc-desktop/tests/los-math.test.mjs, moved here with the
 * math it covers. The second half covers the cache file the build command
 * writes (src/terrain-grid.js) and the store that reads it: header strictness,
 * bilinear lookup, and LOS over a synthetic ridge.
 */

const {
  EFFECTIVE_EARTH_RADIUS_M, losSightLineHeightM, losProfileBlocked,
  TerrainStore, bearingDeg, projectPos, LOS_SAMPLE_COUNT,
} = await import('../src/terrain.js');
const {
  planGrid, encodeGrid, decodeGrid, cacheFileName, findCacheFile, UNSAMPLED, FORMAT,
} = await import('../src/terrain-grid.js');

// ── losSightLineHeightM (ported) ───────────────────────────────────────────


test('losSightLineHeightM: at the radar itself (d=0), height equals radar altitude', () => {
  assert.equal(losSightLineHeightM(100, 500, 0, 10000), 100);
});

test('losSightLineHeightM: at the target itself (d=D), height equals target altitude', () => {
  assert.equal(losSightLineHeightM(100, 500, 10000, 10000), 500);
});

test('losSightLineHeightM: midpoint of equal-altitude endpoints dips below the straight average by the earth-curvature bulge', () => {
  const D = 100000;
  const straightAvg = 50;
  const expectedBulge = ((D / 2) * (D / 2)) / (2 * EFFECTIVE_EARTH_RADIUS_M);
  const height = losSightLineHeightM(50, 50, D / 2, D);
  assert.ok(Math.abs(height - (straightAvg - expectedBulge)) < 1e-6);
  assert.ok(height < straightAvg, 'curvature must pull the sight line below the flat-earth average');
});

test('losSightLineHeightM: D=0 (radar and target at the same point) returns radar altitude', () => {
  assert.equal(losSightLineHeightM(250, 999, 0, 0), 250);
});

// ── losProfileBlocked (ported) ─────────────────────────────────────────────

test('losProfileBlocked: flat terrain well below the sight line is never blocked', () => {
  const samples = [{ d: 5000, terrainM: 50 }, { d: 10000, terrainM: 50 }, { d: 15000, terrainM: 50 }];
  assert.equal(losProfileBlocked(samples, 500, 500, 20000), false);
});

test('losProfileBlocked: a ridge poking above the sight line partway along the path blocks it', () => {
  const samples = [{ d: 5000, terrainM: 100 }, { d: 10000, terrainM: 800 }, { d: 15000, terrainM: 100 }];
  assert.equal(losProfileBlocked(samples, 500, 500, 20000), true);
});

test('losProfileBlocked: terrain just under the sight line stays clear', () => {
  assert.equal(losProfileBlocked([{ d: 10000, terrainM: 490 }], 500, 500, 20000), false);
});

test('losProfileBlocked: long-range curvature alone blocks flat terrain with low-altitude endpoints', () => {
  const D = 500000;
  assert.equal(losProfileBlocked([{ d: D / 2, terrainM: 0 }], 15, 15, D), true);
});

test('losProfileBlocked: short range keeps the same low-altitude endpoints clear', () => {
  const D = 5000;
  assert.equal(losProfileBlocked([{ d: D / 2, terrainM: 0 }], 15, 15, D), false);
});

test('losProfileBlocked: no samples means nothing can block the path', () => {
  assert.equal(losProfileBlocked([], 100, 100, 10000), false);
});

// ── the cache file ─────────────────────────────────────────────────────────

const BOX = { latMin: 36.5, latMax: 37.5, lonMin: 34.5, lonMax: 36.5 };

function makeGrid({ spacingM = 2000, theater = 'Syria', heightAt = () => 0 } = {}) {
  const plan = planGrid(BOX, spacingM);
  const heights = new Int16Array(plan.rows * plan.cols);
  for (let r = 0; r < plan.rows; r++) {
    for (let c = 0; c < plan.cols; c++) heights[r * plan.cols + c] = heightAt(plan.latMin + r * plan.latStep, plan.lonMin + c * plan.lonStep);
  }
  const header = { format: FORMAT, theater, spacingM, ...plan, builtAt: '2026-10-21T00:00:00Z', dcsVersion: '2.9.test' };
  return { header, heights, buf: encodeGrid(header, heights) };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'terrain-'));
}

test('planGrid: the spacing is metres at the middle latitude, and the grid covers the box', () => {
  const p = planGrid(BOX, 500);
  assert.ok(Math.abs(p.latStep * 111320 - 500) < 1e-6);
  assert.ok(Math.abs(p.lonStep * 111320 * Math.cos((37 * Math.PI) / 180) - 500) < 1e-6);
  assert.ok(p.latMin + (p.rows - 1) * p.latStep >= BOX.latMax);
  assert.ok(p.lonMin + (p.cols - 1) * p.lonStep >= BOX.lonMax);
  assert.throws(() => planGrid(BOX, 0), /spacing/);
  assert.throws(() => planGrid({ ...BOX, latMax: 36 }, 500), /extent/);
});

test('encodeGrid/decodeGrid: a file reads back to the same header and heights', () => {
  const { header, heights, buf } = makeGrid({ heightAt: (lat, lon) => Math.round(lat * 10 + lon) });
  const g = decodeGrid(buf, { theater: 'Syria' });
  assert.deepEqual(g.header, header);
  assert.deepEqual([...g.heights], [...heights]);
});

test('decodeGrid: strict, every malformed file is refused with its reason', () => {
  const { header, heights, buf } = makeGrid();
  assert.throws(() => decodeGrid(Buffer.from('nonsense file')), /magic/);
  assert.throws(() => decodeGrid(buf, { theater: 'Caucasus' }), /for Syria, not Caucasus/);
  assert.throws(() => decodeGrid(buf.subarray(0, buf.length - 2)), /size/);
  assert.throws(() => decodeGrid(Buffer.concat([buf, Buffer.alloc(2)])), /size/);
  const holed = Int16Array.from(heights); holed[5] = UNSAMPLED;
  assert.throws(() => decodeGrid(encodeGrid(header, holed)), /never written/);
  // A header with an extra key cannot even be written, so patch the bytes: same length, renamed key.
  const renamed = Buffer.from(buf); const at = renamed.indexOf('dcsVersion'); renamed.write('dcsVersioX', at);
  assert.throws(() => decodeGrid(renamed), /unknown header key\(s\): dcsVersioX/);
  const badFormat = Buffer.from(buf); badFormat.write('int16-x', badFormat.indexOf(FORMAT));
  assert.throws(() => decodeGrid(badFormat), /format/);
  assert.throws(() => encodeGrid({ ...header, extra: 1 }, heights), /header keys/);
});

test('findCacheFile: the finest spacing for the theater, other theaters ignored', () => {
  const dir = tmpDir();
  for (const n of [cacheFileName('Syria', 1000), cacheFileName('Syria', 500), cacheFileName('Caucasus', 250), 'Syria-500m.terrain.partial', 'notes.txt']) fs.writeFileSync(path.join(dir, n), '');
  assert.deepEqual(findCacheFile(dir, 'Syria'), { file: path.join(dir, 'Syria-500m.terrain'), spacingM: 500 });
  assert.equal(findCacheFile(dir, 'Nevada'), null);
  assert.equal(findCacheFile(path.join(dir, 'missing'), 'Syria'), null);
});

test('heightAt: bilinear between the four surrounding samples, null outside the grid', () => {
  // h = 1000 * column index, so along a row the height is linear and bilinear must reproduce it exactly.
  const plan = planGrid(BOX, 2000);
  const { buf } = makeGrid({ heightAt: (lat, lon) => Math.round(((lon - plan.lonMin) / plan.lonStep) * 10) });
  const g = decodeGrid(buf);
  const lon = plan.lonMin + 3.25 * plan.lonStep, lat = plan.latMin + 2.5 * plan.latStep;
  assert.ok(Math.abs(g.heightAt(lat, lon) - 32.5) < 1e-9);
  assert.equal(g.heightAt(plan.latMin, plan.lonMin), 0);
  assert.equal(g.heightAt(BOX.latMin - 0.01, lon), null);
  assert.equal(g.heightAt(lat, BOX.lonMax + 1), null);
  // The far edges are inside.
  assert.notEqual(g.heightAt(plan.latMin + (plan.rows - 1) * plan.latStep, plan.lonMin + (plan.cols - 1) * plan.lonStep), null);
});

// ── TerrainStore ───────────────────────────────────────────────────────────

const RIDGE_LON = 35.5;
const ridge = (lat, lon) => (Math.abs(lon - RIDGE_LON) < 0.05 ? 2000 : 0);

function storeWith(files) {
  const dir = tmpDir();
  for (const [name, buf] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), buf);
  return new TerrainStore({ cacheDir: dir });
}

test('TerrainStore: with no cache for the theater, every sight line is unknown (fail open) and it is logged once', (t) => {
  const cap = crcLog.capture(); t.after(() => cap.stop());
  const store = storeWith({});
  assert.equal(store.loadTheater('Syria'), null);
  store.loadTheater('Syria');
  assert.equal(store.hasLineOfSight(37, 35, 100, 37, 36, 500), 'unknown');
  assert.equal(store.elevationAt(35, 37), null);
  assert.equal(store.status().available, false);
  assert.equal(cap.lines.filter((l) => /no terrain cache/.test(l)).length, 1);
});

test('TerrainStore: a ridge between radar and target blocks a low target and not a high one', (t) => {
  const cap = crcLog.capture(); t.after(() => cap.stop());
  const store = storeWith({ [cacheFileName('Syria', 2000)]: makeGrid({ heightAt: ridge }).buf });
  assert.ok(store.loadTheater('Syria'));
  assert.equal(store.hasLineOfSight(37, 35, 100, 37, 36, 500), false);
  assert.equal(store.hasLineOfSight(37, 35, 100, 37, 36, 9000), true);
  // Both on one side of the ridge: clear.
  assert.equal(store.hasLineOfSight(37, 34.7, 100, 37, 35.3, 500), true);
  assert.equal(store.elevationAt(RIDGE_LON, 37), 2000);
  assert.equal(store.status().available, true);
  assert.equal(store.status().spacingM, 2000);
});

test('TerrainStore: a path leaving the grid is unknown, not blocked', (t) => {
  const cap = crcLog.capture(); t.after(() => cap.stop());
  const store = storeWith({ [cacheFileName('Syria', 2000)]: makeGrid({ heightAt: ridge }).buf });
  store.loadTheater('Syria');
  assert.equal(store.hasLineOfSight(37, 35, 100, 37, 38, 500), 'unknown');
});

test('TerrainStore: a bad file is not used, logged once, and the store fails open', (t) => {
  const cap = crcLog.capture(); t.after(() => cap.stop());
  const store = storeWith({ [cacheFileName('Syria', 500)]: Buffer.from('garbage') });
  assert.equal(store.loadTheater('Syria'), null);
  store.loadTheater('Syria');
  assert.equal(store.hasLineOfSight(37, 35, 100, 37, 36, 500), 'unknown');
  assert.match(store.status().reason, /magic/);
  assert.equal(cap.lines.filter((l) => /terrain cache not used/.test(l)).length, 1);
});

test('TerrainStore: another theater drops the old grid; the cache is re-read at each mission load', (t) => {
  const cap = crcLog.capture(); t.after(() => cap.stop());
  const dir = tmpDir();
  const store = new TerrainStore({ cacheDir: dir });
  assert.equal(store.loadTheater('Syria'), null);
  fs.writeFileSync(path.join(dir, cacheFileName('Syria', 2000)), makeGrid({ heightAt: ridge }).buf);
  assert.ok(store.loadTheater('Syria'), 'a file built while crc-sync runs is read at the next mission load');
  assert.equal(store.loadTheater('Caucasus'), null);
  assert.equal(store.elevationAt(RIDGE_LON, 37), null);
  assert.equal(store.loadTheater(null), null);
});

test('projectPos/bearingDeg: a projected point bears back along the bearing', () => {
  const [lat, lon] = projectPos(37, 35, 70, 50000);
  assert.ok(Math.abs(bearingDeg(37, 35, lat, lon) - 70) < 0.01);
  assert.equal(LOS_SAMPLE_COUNT, 24);
});
