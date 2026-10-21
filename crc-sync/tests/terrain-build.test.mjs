import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakeDcs } from './helpers/fake-dcs-terrain.mjs';

/* The human-run terrain commands (docs/adr/0133), against a fake Eval over a synthetic terrain: chunking, resume, the
 * Lua's output parsing, the theater checks and the validate table. */

const { buildTerrain } = await import('../tools/terrain/build-core.js');
const { validateTerrain, makePairs } = await import('../tools/terrain/validate-core.js');
const { heightsLua, parseHeights, probeLua, parseProbe, visibilityLua, parseVisibility, num } = await import('../tools/terrain/lua.js');
const { parseArgs } = await import('../tools/terrain/cli.js');
const { decodeGrid, cacheFileName } = await import('../src/terrain-grid.js');
const { TerrainStore } = await import('../src/terrain.js');
const { loadTheaters } = await import('../src/theaters.js');

// A 40 x 30 km map rectangle; at 2 km that is ~21 x 16 samples, small enough to build many times.
const EXTENT = { xMin: 0, xMax: 30000, zMin: 0, zMax: 40000 };
const hills = (lat, lon) => Math.round(300 + 250 * Math.sin(lat * 90) * Math.cos(lon * 70));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'terrain-build-'));
const quiet = () => {};
const noSleep = async () => {};

function run(o) {
  return buildTerrain({ theater: 'Syria', extent: EXTENT, spacingM: 2000, chunkPoints: 50, pauseMs: 10, sleep: noSleep, print: quiet, retryBaseMs: 1, ...o });
}

test('lua: numbers are plain decimals and the scripts call the DCS functions they are meant to', () => {
  assert.equal(num(0.0000001), '0.000000100000');
  assert.equal(num(-3.5), '-3.5');
  assert.throws(() => num(NaN));
  const h = heightsLua({ latMin: 35, lonMin: 36, latStep: 0.0045, lonStep: 0.0055, cols: 10 }, 4, 2);
  assert.match(h, /coord\.LLtoLO/);
  assert.match(h, /land\.getHeight/);
  assert.match(h, /local R0, NR, NC = 4, 2, 10/);
  assert.match(probeLua(EXTENT), /coord\.LOtoLL/);
  assert.match(visibilityLua([{ rLat: 1, rLon: 2, rAgl: 3, tLat: 4, tLon: 5, tAgl: 6 }], [[1, 2]]), /land\.isVisible/);
});

test('lua parsers: strict on rows, count, theater and values', () => {
  const ok = { theatre: 'Syria', r0: 0, rows: 1, cols: 3, ms: 2, h: '1,-2,40000' };
  assert.deepEqual([...parseHeights(ok, { theater: 'Syria', row0: 0, rows: 1, cols: 3 }).heights], [1, -2, 32767]);
  assert.throws(() => parseHeights({ ...ok, h: '1,2' }, { theater: 'Syria', row0: 0, rows: 1, cols: 3 }), /expected 3 heights/);
  assert.throws(() => parseHeights({ ...ok, h: '1,x,3' }, { theater: 'Syria', row0: 0, rows: 1, cols: 3 }), /height 1/);
  assert.throws(() => parseHeights({ ...ok, r0: 1 }, { theater: 'Syria', row0: 0, rows: 1, cols: 3 }), /asked rows/);
  assert.throws(() => parseHeights({ ...ok, theatre: 'Caucasus' }, { theater: 'Syria', row0: 0, rows: 1, cols: 3 }), /stopped/);
  assert.deepEqual(parseProbe({ theatre: 'Syria', version: 'v', pts: '35,36;36,37.5' }).bbox, { latMin: 35, latMax: 36, lonMin: 36, lonMax: 37.5 });
  assert.throws(() => parseProbe({ pts: '35,x' }), /bad point/);
  assert.throws(() => parseVisibility({ theatre: 'Syria', pairs: '1,2,1', points: '' }, { theater: 'Syria', pairCount: 2, pointCount: 0 }), /expected 2 pairs/);
});

test('build: samples the whole grid in chunks of whole rows, pauses between them, and writes a strict cache file', async () => {
  const dir = tmp();
  const dcs = fakeDcs({ heightAt: hills });
  const sleeps = [];
  const out = await run({ evalLua: dcs.evalLua, outDir: dir, sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(out.done, true);
  assert.equal(out.file, path.join(dir, cacheFileName('Syria', 2000)));
  const grid = decodeGrid(fs.readFileSync(out.file), { theater: 'Syria' });
  const { rows, cols, latMin, lonMin, latStep, lonStep, dcsVersion } = grid.header;
  assert.equal(dcsVersion, '2.9.fake');
  const rowsPerChunk = Math.floor(50 / cols);
  assert.equal(dcs.calls.heights.length, Math.ceil(rows / rowsPerChunk));
  assert.deepEqual(sleeps, Array(dcs.calls.heights.length - 1).fill(10), 'a pause after every chunk but the last');
  for (const [r, c] of [[0, 0], [rows - 1, cols - 1], [7, 3]]) {
    assert.equal(grid.heights[r * cols + c], Math.floor(hills(latMin + r * latStep, lonMin + c * lonStep) + 0.5));
  }
  assert.deepEqual(fs.readdirSync(dir), [cacheFileName('Syria', 2000)], 'no partial or progress file left behind');
  // The server reads what the build wrote.
  const store = new TerrainStore({ cacheDir: dir });
  assert.ok(store.loadTheater('Syria'));
  // A second run has nothing to do and asks DCS nothing.
  const again = fakeDcs({ heightAt: hills });
  assert.equal((await run({ evalLua: again.evalLua, outDir: dir })).chunks, 0);
  assert.equal(again.calls.probe + again.calls.heights.length, 0);
});

test('build: an interrupted run resumes where it stopped and never asks for a row twice', async () => {
  const dir = tmp();
  const first = fakeDcs({ heightAt: hills });
  const part = await run({ evalLua: first.evalLua, outDir: dir, maxChunks: 2 });
  assert.equal(part.done, false);
  assert.ok(fs.existsSync(path.join(dir, `${cacheFileName('Syria', 2000)}.progress.json`)));
  const second = fakeDcs({ heightAt: hills });
  const lines = [];
  const done = await run({ evalLua: second.evalLua, outDir: dir, print: (l) => lines.push(l) });
  assert.equal(done.done, true);
  assert.ok(lines.some((l) => /resuming at row/.test(l)));
  const asked = [...first.calls.heights, ...second.calls.heights];
  assert.equal(new Set(asked).size, asked.length, 'no chunk asked twice');
  // Same heights as one uninterrupted build.
  const whole = await run({ evalLua: fakeDcs({ heightAt: hills }).evalLua, outDir: tmp() });
  assert.deepEqual([...decodeGrid(fs.readFileSync(done.file)).heights], [...decodeGrid(fs.readFileSync(whole.file)).heights]);
});

test('build: progress for another grid is refused, naming the files to delete', async () => {
  const dir = tmp();
  await run({ evalLua: fakeDcs({ heightAt: hills }).evalLua, outDir: dir, maxChunks: 1 });
  await assert.rejects(run({ evalLua: fakeDcs({ heightAt: hills }).evalLua, outDir: dir, extent: { ...EXTENT, xMax: 50000 } }), /different grid.*delete/);
});

test('build: refuses a theater with no extent, and a DCS running another map', async () => {
  await assert.rejects(run({ evalLua: fakeDcs().evalLua, outDir: tmp(), extent: undefined }), /no terrainExtent for Syria/);
  await assert.rejects(run({ evalLua: fakeDcs({ theatre: 'Caucasus' }).evalLua, outDir: tmp() }), /DCS is running "Caucasus", not Syria/);
});

test('build: a failed Eval is retried with back-off; a mission change stops the build, and a re-run continues it', async () => {
  const dir = tmp();
  let failures = 0;
  const flaky = fakeDcs({ heightAt: hills, fail: (calls, lua) => (lua.includes('land.getHeight') && calls.heights.length === 1 && failures++ < 2 ? new Error('UNAVAILABLE') : null) });
  const waits = [];
  const out = await run({ evalLua: flaky.evalLua, outDir: dir, sleep: async (ms) => { waits.push(ms); } });
  assert.equal(out.done, true);
  assert.deepEqual(waits.filter((ms) => ms !== 10), [1, 2], 'two retries, doubling');

  const dir2 = tmp();
  let n = 0;
  const switching = fakeDcs({ heightAt: hills });
  const evalLua = async (lua) => { const r = await switching.evalLua(lua); if (lua.includes('land.getHeight') && ++n === 3) r.theatre = 'Caucasus'; return r; };
  await assert.rejects(run({ evalLua, outDir: dir2 }), /now running "Caucasus".*re-run the same command/);
  assert.equal((await run({ evalLua: fakeDcs({ heightAt: hills }).evalLua, outDir: dir2 })).done, true);
});

test('validate: prints agreement per spacing; on smooth terrain "direct" and the grids agree with isVisible', async () => {
  const lines = [];
  const dcs = fakeDcs({ heightAt: (lat, lon) => 400 * Math.sin(lat * 40) * Math.sin(lon * 40) + 400 });
  const big = { xMin: 0, xMax: 200000, zMin: 0, zMax: 200000 };
  const r = await validateTerrain({ evalLua: dcs.evalLua, theater: 'Syria', extent: big, pairs: 40, pairsPerEval: 10, sleep: noSleep, print: (l) => lines.push(l), minRangeM: 5000, maxRangeM: 60000 });
  assert.equal(r.pairs, 40);
  assert.equal(dcs.calls.visibility, 4);
  assert.deepEqual(r.rows.map((x) => x.source), ['direct', '1000 m', '500 m', '250 m']);
  for (const row of r.rows) assert.ok(row.flat >= 34, `${row.source}: ${row.flat}/40 agree`);
  assert.ok(lines.some((l) => /^source/.test(l)));
  assert.deepEqual(makePairs({ latMin: 35, latMax: 37, lonMin: 36, lonMax: 38 }, { seed: 7, pairs: 5, radarAglM: 20, minRangeM: 1e4, maxRangeM: 5e4, maxTargetAglM: 1500 }),
    makePairs({ latMin: 35, latMax: 37, lonMin: 36, lonMax: 38 }, { seed: 7, pairs: 5, radarAglM: 20, minRangeM: 1e4, maxRangeM: 5e4, maxTargetAglM: 1500 }), 'seeded');
});

test('cli: arguments', () => {
  assert.deepEqual(parseArgs(['--theater', 'Syria', '--spacing=250', '--pause', '0']), { theater: 'Syria', spacing: '250', pause: '0' });
  assert.throws(() => parseArgs(['Syria']), /unexpected/);
});

test('theaters.json: Syria and Caucasus ship a terrain extent; a malformed one is dropped with a warning', async (t) => {
  const crcLog = (await import('../src/log.js')).default;
  const cap = crcLog.capture(); t.after(() => cap.stop());
  const shipped = loadTheaters(path.join(path.dirname(new URL(import.meta.url).pathname), '../config/theaters.json'));
  assert.deepEqual(shipped.Syria.terrainExtent, { xMin: -320000, xMax: 300000, zMin: -579986, zMax: 579998 });
  assert.ok(shipped.Caucasus.terrainExtent);
  const f = path.join(tmp(), 'theaters.json');
  fs.writeFileSync(f, JSON.stringify({ theaters: { A: { utcOffsetHours: 0, terrainExtent: { xMin: 1, xMax: 0, zMin: 0, zMax: 1 } }, B: { utcOffsetHours: 0, terrainExtent: { xMin: 0, xMax: 1, zMin: 0, zMax: 1, y: 2 } } } }));
  const t2 = loadTheaters(f);
  assert.equal(t2.A.terrainExtent, undefined);
  assert.equal(t2.B.terrainExtent, undefined);
  assert.equal(cap.lines.filter((l) => /terrainExtent/.test(l)).length, 2);
});
