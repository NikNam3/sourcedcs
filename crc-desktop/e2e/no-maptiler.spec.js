'use strict';

/* U-GLYPHS: nothing the controller needs depends on MapTiler. The harness answers every api.maptiler.com URL with 403
 * (no key, as an exhausted or refused key looks) and every tiles.openfreemap.org URL with 503 (e2e/helpers/test.js),
 * so nothing leaves the machine.
 *  - a track's symbol and data block render with no key: the glyphs come from the bundled local server (app/glyph-route.js);
 *  - a glyph range nobody ships answers an empty 200 and the label's tile still loads;
 *  - the basemap falls back to OpenFreeMap when MapTiler refuses it, stays there, and goes back when a key arrives. */

const { test, expect } = require('./helpers/test');
const { openPanel } = require('./helpers/app');

test.describe.configure({ timeout: 60000 });

const BASEMAP = 'maptiler_planet';
const sourceUrl = (page) => page.evaluate((id) => {
  const s = crc.mapHandle.map.getSource(id);
  return { url: s.url || null, tiles: s._options.tiles || null, attribution: s.attribution || '' };
}, BASEMAP);
const notice = (page) => page.locator('#basemap-notice');

test('with no MapTiler key a track draws its symbol and its data block', async ({ page }) => {
  let maptilerFonts = 0;
  page.on('request', (r) => { if (/^https:\/\/api\.maptiler\.com\/fonts\//.test(r.url())) maptilerFonts += 1; });
  await openPanel(page, { signedOn: ['OPS'] });
  await page.waitForFunction(() => crc.mapHandle.mapReady);

  // A contact at the centre of the scope, kept illuminated (the harness's empty picture would otherwise fade it).
  await page.evaluate(() => {
    const c = crc.mapHandle.map.getCenter();
    const put = () => {
      const t = { id: 'ng1', domain: 'AIR', lon: c.lng, lat: c.lat, label: { callsign: null, source: null, trackNumber: 'T0042' },
        altitude: { ft: 18000, ref: 'QNH', source: 'MODE_C' }, ssr: null, illuminatedAt: Date.now() };
      crc.picture.latestFromServer.set(t.id, t);
      crc.picture.tracks.set(t.id, t);
      crc.picture.lastSweepMs.set(t.id, t.illuminatedAt);
      crc.geojson.updateMap();
    };
    put();
    window.__ngTimer = setInterval(put, 250);
  });

  const rendered = () => page.evaluate(() => {
    const map = crc.mapHandle.map;
    const ids = (layers) => layers.filter((l) => map.getLayer(l));
    const symbol = map.queryRenderedFeatures({ layers: ids(['unit-squares', 'atc-symbols', 'atc-targets']) }).filter((f) => f.properties.id === 'ng1');
    const label = map.queryRenderedFeatures({ layers: ids(['unit-labels', 'atc-labels']) }).filter((f) => f.properties.id === 'ng1');
    const errored = ['units', 'labels'].flatMap((s) => {
      const cache = map.style.sourceCaches[s];
      return cache ? cache.getIds().map((id) => cache.getTileByID(id).state).filter((st) => st === 'errored') : [];
    });
    return { symbol: symbol.length, label: label.length, errored: errored.length };
  });
  await expect.poll(async () => { const r = await rendered(); return r.symbol > 0 && r.label > 0; },
    { message: 'the track symbol and its label are drawn', timeout: 15000 }).toBe(true);
  expect((await rendered()).errored).toBe(0);
  expect(maptilerFonts, 'no glyph request goes to MapTiler').toBe(0);
  await page.evaluate(() => clearInterval(window.__ngTimer));
});

test('a glyph range the client does not ship answers empty and does not error the tile', async ({ page }) => {
  const glyphAnswers = [];
  page.on('response', (r) => { if (/\/fonts\/.+\/1280-1535\.pbf$/.test(r.url())) glyphAnswers.push(r.status()); });
  await openPanel(page, { signedOn: ['OPS'] });
  await page.waitForFunction(() => crc.mapHandle.mapReady);
  // Hebrew (U+05D0..) is in no shipped range; Latin is. The label still draws, and its tile loads.
  await page.evaluate(() => {
    const map = crc.mapHandle.map;
    const c = map.getCenter();
    map.addSource('ng-unshipped', { type: 'geojson', data: { type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: { name: 'TAG \u05D0\u05D1' } }] } });
    map.addLayer({ id: 'ng-unshipped', type: 'symbol', source: 'ng-unshipped',
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Roboto Regular', 'Noto Sans Regular'] } });
  });
  const state = () => page.evaluate(() => {
    const map = crc.mapHandle.map;
    const cache = map.style.sourceCaches['ng-unshipped'];
    return { tiles: cache ? cache.getIds().map((id) => cache.getTileByID(id).state) : [],
      drawn: map.queryRenderedFeatures({ layers: ['ng-unshipped'] }).length };
  });
  await expect.poll(async () => (await state()).drawn, { message: 'the label draws' }).toBeGreaterThan(0);
  expect((await state()).tiles).not.toContain('errored');
  expect(glyphAnswers.length, 'the unshipped range was asked for').toBeGreaterThan(0);
  expect(glyphAnswers.every((s) => s === 200)).toBe(true);
});

test('the basemap falls back to OpenFreeMap without a key and returns to MapTiler when one arrives', async ({ page }) => {
  // The fallback answers with a TileJSON and empty tiles; MapTiler answers keyed tiles with an empty tile.
  let fallbackTiles = 0;
  let keyedTiles = 0;
  await page.route(/^https:\/\/tiles\.openfreemap\.org\//, (route) => {
    const url = route.request().url();
    if (/\/planet$/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/planet/e2e/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 }) });
    }
    fallbackTiles += 1;
    return route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) });
  });
  let giveKey = false;
  await page.route(/^https:\/\/api\.maptiler\.com\/tiles\//, (route) => {
    if (/[?&]key=e2e-key/.test(route.request().url())) { keyedTiles += 1; return route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) }); }
    return route.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"Invalid key"}' });
  });
  await page.route('**/api/client-config', (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ maptilerKey: giveKey ? 'e2e-key' : null }) }));
  await openPanel(page, { signedOn: ['OPS'] });
  await page.waitForFunction(() => crc.mapHandle.mapReady);

  await expect.poll(async () => (await sourceUrl(page)).url, { message: 'switched to the fallback TileJSON' }).toBe('https://tiles.openfreemap.org/planet');
  expect((await sourceUrl(page)).tiles).toBe(null);
  expect((await sourceUrl(page)).attribution).toContain('OpenFreeMap');
  await expect(notice(page)).toHaveText('FALLBACK BASEMAP');
  // Dark cockpit: a grey note, no colour.
  expect(await notice(page).evaluate((el) => getComputedStyle(el).color)).toBe('rgb(138, 138, 138)');
  await expect.poll(() => fallbackTiles, { message: 'fallback tiles are asked for' }).toBeGreaterThan(0);

  // No flapping: the MapTiler 403s still in flight when it switched did not switch it again.
  expect((await sourceUrl(page)).url).toBe('https://tiles.openfreemap.org/planet');
  expect(await page.evaluate(() => crc.mapSetup.basemapState())).toBe('fallback');

  giveKey = true;
  expect(await page.evaluate(() => crc.maptilerKey.loadMaptilerKey('e2e-token'))).toBe('e2e-key');
  await expect.poll(async () => (await sourceUrl(page)).tiles, { message: 'back on MapTiler' }).toEqual(['https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf']);
  expect((await sourceUrl(page)).url).toBe(null);
  await expect(notice(page)).toHaveCount(0);
  await expect.poll(() => keyedTiles, { message: 'keyed MapTiler tiles are asked for' }).toBeGreaterThan(0);
  expect((await sourceUrl(page)).url, 'stale keyless 403s do not send it back').toBe(null);
  expect(await page.evaluate(() => crc.mapSetup.basemapState())).toBe('maptiler');
});
