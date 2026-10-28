'use strict';

/* Terrain from DCS, cached per map (crc-sync docs/adr/0133). The REAL crc-sync loads a synthetic Syria grid from the
 * harness's terrain directory when helpers/fake-dcs.js gives it a Syria mission, serves it at GET /api/terrain/grid through
 * the local server's proxy, and the client traces contours from it: nothing goes to MapTiler for terrain (the harness
 * answers every MapTiler URL 403, and no terrain-rgb URL may even be asked). Run on E2E_LANE=8.
 *
 * The grid is a 3,000 m cone over a small box far from Incirlik, so a sight line anywhere else leaves the grid and fails
 * open exactly as with no cache; the file is removed again in afterAll.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { test, expect } = require('./helpers/test');
const { openPanel } = require('./helpers/app');
const { startFakeDcs, fakeDcsPort } = require('./helpers/fake-dcs');

const syncRequire = createRequire(path.join(__dirname, '..', '..', 'crc-sync', 'package.json'));
const { planGrid, encodeGrid, cacheFileName, FORMAT } = syncRequire('./src/terrain-grid.js');

test.describe.configure({ timeout: 90000 });
test.use({ resetScope: 'file' });

const LANE = Number(process.env.E2E_LANE || 0);
const DIR = path.join(process.env.E2E_STATE_DIR, 'terrain');
const FILE = path.join(DIR, cacheFileName('Syria', 1000));
const CONE = { lat: 33.5, lon: 38.5 };

function writeGrid() {
  const plan = planGrid({ latMin: 33.3, latMax: 33.7, lonMin: 38.3, lonMax: 38.7 }, 1000);
  const heights = new Int16Array(plan.rows * plan.cols);
  for (let r = 0; r < plan.rows; r++) for (let c = 0; c < plan.cols; c++) {
    const dKm = Math.hypot((plan.latMin + r * plan.latStep - CONE.lat) * 111.32, (plan.lonMin + c * plan.lonStep - CONE.lon) * 92.8);
    heights[r * plan.cols + c] = Math.max(0, Math.round(3000 - dKm * 150));
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, encodeGrid({ format: FORMAT, theater: 'Syria', spacingM: 1000, ...plan, builtAt: '2026-10-21T00:00:00.000Z', dcsVersion: 'e2e' }, heights));
}

let fake;
test.beforeAll(async () => { writeGrid(); fake = await startFakeDcs(fakeDcsPort(3010 + LANE)); });
test.afterAll(async () => { if (fake) await fake.stop(); fs.rmSync(FILE, { force: true }); });

test('the contour overlay is traced from the DCS grid crc-sync serves, with no MapTiler terrain request', async ({ page }) => {
  const terrainUrls = [];
  page.on('request', (r) => { if (/terrain-rgb|\/api\/terrain\//.test(r.url())) terrainUrls.push(r.url()); });
  await openPanel(page);
  await page.waitForFunction(() => crc.mapHandle.mapReady === true, null, { timeout: 20000 });
  await expect.poll(() => page.evaluate(() => crc.terrainGrid.terrainGridState()), { timeout: 30000, message: 'the grid arrives with the theater' })
    .toMatchObject({ loaded: true, theater: 'Syria', status: 'loaded' });
  expect(await page.evaluate(([lat, lon]) => crc.terrainGrid.terrainHeightAt(lat, lon), [CONE.lat, CONE.lon])).toBeGreaterThan(2900);

  await page.evaluate(([lat, lon]) => {
    crc.settings.settings.showElevation = true;
    crc.mapHandle.map.jumpTo({ center: [lon, lat], zoom: 10 });
    return crc.elevation.updateElevationContours();
  }, [CONE.lat, CONE.lon]);
  const features = await page.evaluate(() => crc.mapHandle.map.getSource('elevation-contours')._data.features.length);
  expect(features, 'contour levels traced around the cone').toBeGreaterThan(5);

  expect(terrainUrls.filter((u) => /terrain-rgb/.test(u)), 'nothing asks MapTiler for terrain').toEqual([]);
  expect(terrainUrls.filter((u) => /\/api\/terrain\/grid/.test(u)).length, 'one grid fetch').toBe(1);
});
