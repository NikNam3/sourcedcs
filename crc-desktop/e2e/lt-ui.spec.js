'use strict';

/* LT-UI (live test 2026-10-11): "Show on map" (T10, H129), the coordination button naming its target (T20), the stereo
 * picker with no routes (T6, H134) and the map's labels once the MapTiler key arrives (T3). T19 is in efsp-formation,
 * T21/T23/T24 in l15-metrics, T26 in gclc-combine. */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, stripByCallsign, startAction, stripMenuItem } = require('./helpers/app');

test.describe.configure({ timeout: 60000 });

let seq = 0;
const uniqueCallsign = (prefix) => `${prefix}${(Date.now() + seq++) % 10000}`;

// Close to the initial centre (inside any radar bounds the map clamps to), off screen once zoomed in to 12.
const CONTACT = [35.9258, 37.0021];

/** A contact off the zoomed-in view, and a client-side correlation of the flight `callsign` to it. */
async function correlateToFarContact(page, callsign, trackId) {
  await page.evaluate(([cs, tid, c]) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs);
    crc.picture.latestFromServer.set(tid, {
      id: tid, domain: 'AIR', lon: c[0], lat: c[1], label: { callsign: null, source: null, trackNumber: `T${tid}` },
      altitude: null, ssr: null, illuminatedAt: Date.now(),
    });
    crc.state.applyEfspCorrelationDelta({ correlations: { updated: [{
      flightDataId: s.flightDataId, rev: 1, state: 'CORRELATED', trackId: tid, matchedBy: 'BINDING', confidence: null,
      binding: { boundPositionId: 'OPS' }, warning: null, observedBeacon: null, transitions: [],
    }] } });
  }, [callsign, trackId, CONTACT]);
}

test('T10: selecting a Strip draws no ring; "Show on map" rings the contact and brings it into view', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS'] });
  const callsign = uniqueCallsign('SOM');
  // OPS PROPOSED is outside the server's correlation reconciler, so the client-side record below is not overwritten.
  const strip = await seedStrip(page, { callsign });
  await correlateToFarContact(page, callsign, 'lt-ui-1');

  await page.evaluate((cs) => {
    const s = crc.state.getAllEfspStrips().find(x => crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs);
    crc.selection.selectEfspStripById(s.stripId);
  }, callsign);
  expect(await page.evaluate(() => crc.correlation.getCorrelatedHighlightTrackId())).toBe(null);

  await page.evaluate(() => crc.mapHandle.map.jumpTo({ center: [35.4258, 37.0021], zoom: 12 }));
  const offBefore = await page.evaluate((c) => !crc.mapHandle.map.getBounds().contains(c), CONTACT);
  expect(offBefore, 'the contact starts off screen').toBe(true);
  await expect(await stripMenuItem(strip, 'Show on map')).toBeEnabled();
  await startAction(strip, 'Show on map');
  expect(await page.evaluate(() => crc.correlation.getCorrelatedHighlightTrackId())).toBe('lt-ui-1');
  await expect.poll(() => page.evaluate((c) => crc.mapHandle.map.getBounds().contains(c), CONTACT), { message: 'panned to the contact' }).toBe(true);
  // The ring is drawn from the efsp-correlation source.
  await expect.poll(() => page.evaluate(() => crc.mapHandle.map.querySourceFeatures('efsp-correlation').length)).toBeGreaterThan(0);
  // It goes by itself after RING_SHOW_MS.
  const ms = await page.evaluate(() => crc.correlation.RING_SHOW_MS);
  await expect.poll(() => page.evaluate(() => crc.correlation.getCorrelatedHighlightTrackId()), { timeout: ms + 5000 }).toBe(null);
  await page.evaluate(() => crc.picture.latestFromServer.delete('lt-ui-1'));
});

test('T10: "Show on map" is listed but disabled when the contact is outside this controller\'s picture', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS'] });
  const callsign = uniqueCallsign('SOX');
  const strip = await seedStrip(page, { callsign });
  await correlateToFarContact(page, callsign, 'lt-ui-2');
  await page.evaluate(() => crc.picture.latestFromServer.delete('lt-ui-2'));
  await page.evaluate(() => crc.changeBus.markEfspChanged('correlations'));
  await strip.locator('.efsp-strip-menu-btn').click();
  const item = page.locator('.efsp-strip-menu [data-strip-action="show-on-map"]');
  await expect(item).toBeDisabled();
  await expect(item).toContainText('outside your radar coverage');
});

test('T20: the coordination button names its target, with one candidate and with a choice', async ({ page }) => {
  await openPanel(page, { signedOn: ['CTR'], facilityId: 'CENTER', controller: 'lt-ui-ctr' });
  await page.locator('#efsp-position-tabs .efsp-position-tab[data-position-id="CTR"]').click();
  await page.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="ctr-enroute"]').click();
  const callsign = uniqueCallsign('NAM');
  const s = await seedStrip(page, { callsign, actingPositionId: 'CTR', bayId: 'ctr-enroute', stripType: 'ARRIVAL', facilityId: 'CENTER' });
  await startAction(s, 'Coordinate…');
  const popover = page.locator('.efsp-coordinate-popover');
  const send = popover.locator('.efsp-coordinate-send-btn');
  // A HANDOFF of an ARRIVAL may go to AP or to the carrier's Marshal (ADR 0101): the button follows the choice.
  await expect(send).toHaveText('Hand off to AP');
  await popover.locator('.efsp-coordinate-target-select').selectOption('CV_MARSHAL');
  await expect(send).toHaveText('Hand off to CV_MARSHAL');
  // A point-out has one candidate and no picker: the button still names it.
  await popover.locator('.efsp-coordinate-primitive-select').selectOption('POINT_OUT');
  await expect(popover.locator('.efsp-coordinate-target-select')).toBeHidden();
  await expect(send).toHaveText('Point out to AP');
  await page.screenshot({ path: test.info().outputPath('t20-point-out.png') });
  await send.dispatchEvent('click');
  await expect.poll(() => page.evaluate((cs) => {
    const x = crc.state.getAllEfspStrips().find(y => crc.state.getEfspFlightData(y.flightDataId).identity.callsign === cs);
    return x && x.coordination && `${x.coordination.primitive}:${x.coordination.peerPositionId}`;
  }, callsign)).toBe('POINT_OUT:AP');
});

test('T6: with no stereo routes the picker stays beside "+ New Strip", disabled and empty, with no text', async ({ page }) => {
  await page.route('**/api/stereo-routes', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"routes":[]}' }));
  await openPanel(page, { signedOn: ['OPS'] });
  const picker = page.locator('#efsp-create-strip-stereo');
  await expect(picker).toBeVisible();
  await expect(picker).toBeDisabled();
  await expect(picker.locator('option')).toHaveCount(0);
});

test('T3: labels draw with no MapTiler key, their glyphs come from the local server', async ({ page }) => {
  // The harness answers every MapTiler URL 403, as MapTiler does without a key (or over its quota). A failed glyph range
  // errors the whole tile of a GeoJSON source, which once hid every track; the glyphs are bundled now (app/server.js /fonts/).
  const glyphUrls = [];
  page.on('request', (r) => { if (/\/fonts\/[^/]+\/\d+-\d+\.pbf/.test(r.url())) glyphUrls.push(r.url()); });
  await page.route('**/api/client-config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ maptilerKey: null }) }));
  await openPanel(page, { signedOn: ['OPS'] });
  await page.waitForFunction(() => crc.mapHandle.mapReady);

  // A label layer in view, as the airport / track / airspace labels are.
  const tileStates = () => page.evaluate(() => {
    const cache = crc.mapHandle.map.style.sourceCaches['lt-ui-labels'];
    return cache ? cache.getIds().map((id) => cache.getTileByID(id).state) : [];
  });
  await page.evaluate(() => {
    const map = crc.mapHandle.map;
    const c = map.getCenter();
    map.addSource('lt-ui-labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: { name: 'LTAG' } }] } });
    map.addLayer({ id: 'lt-ui-labels', type: 'symbol', source: 'lt-ui-labels', layout: { 'text-field': ['get', 'name'], 'text-font': ['Roboto Mono Medium', 'Noto Sans Regular'] } });
  });
  await expect.poll(tileStates, { message: 'the label tile loads with no key' }).toEqual(expect.arrayContaining(['loaded']));
  expect(await tileStates()).not.toContain('errored');
  await expect.poll(() => page.evaluate(() => crc.mapHandle.map.queryRenderedFeatures({ layers: ['lt-ui-labels'] }).length)).toBeGreaterThan(0);
  expect(glyphUrls.length).toBeGreaterThan(0);
  expect(glyphUrls.every((u) => !u.includes('maptiler.com'))).toBe(true);
});
