'use strict';

/* U-VQ-AB (H173 VQ-A, crc-sync's docs/adr/0145): a controller suppresses one conflict alert from the alert itself. The
 * track label's menu offers SUPPRESS for a contact in a CA shown at one of the controller's Positions, Strip or not; one
 * click sends efsp-conflict-suppress for that pair at the acting Position. A suppressed alert stays, grey: the track
 * panel's row offers RESTORE.
 *
 * The rig has no DCS, so the two contacts and the alert are injected client-side (as l22-stars-scope.spec.js does) and the
 * sent frame is read off the socket; the server half is crc-sync's tests/conflict-alert-suppress.test.mjs.
 */

const { test, expect } = require('./helpers/test');
const { openPanel } = require('./helpers/app');

test.describe.configure({ timeout: 60000 });

const C = { lat: 37.30, lon: 35.90 };

const contact = (id, callsign, lat, lon) => ({
  id, lat, lon, domain: 'AIR', onGround: false, illuminatedAt: Date.now(), sources: ['PRIMARY', 'SSR'], iffState: 'neutral', iffOverride: null,
  label: { callsign, source: 'TAG', tag: callsign, trackNumber: `T${id}` }, type: 'F16',
  ssr: { code: '1200', ident: false, emergency: null }, altitude: { ft: 6500, ref: 'QNH', source: 'MODE_C' }, dl: null, scheme: 'TACTICAL',
});

/** The alert as the server would send it to this session: shown at CTR, and suppressed there when `suppressed`. */
const alertFor = (suppressed) => ({
  conformance: [], obligations: [], airspaceEntry: [],
  conflictAlert: [{
    id: 'vqa|vqb', kind: 'CA', a: 'vqa', b: 'vqb', aCallsign: 'BIRD1', bCallsign: 'BIRD2', timeToCpaSec: 45, minNm: 0.8, vertFt: 300,
    aAt: { lat: C.lat, lon: C.lon + 0.05 }, bAt: { lat: C.lat, lon: C.lon + 0.06 },
    shownAt: ['CTR'], ...(suppressed ? { suppressedAt: ['CTR'] } : {}),
  }],
});

async function scene(page, suppressed) {
  await page.evaluate(([c, a, b, alerts]) => {
    crc.app.applySnapshot([a, b]);
    crc.state.applyEfspAlerts(alerts);
    crc.picture.labelOffsets.clear();
    crc.mapHandle.map.jumpTo({ center: [c.lon, c.lat], zoom: 9 });
    crc.geojson.updateMap();
  }, [C, contact('vqa', 'BIRD1', C.lat, C.lon), contact('vqb', 'BIRD2', C.lat - 0.2, C.lon + 0.3), alertFor(suppressed)]);
}

/** A viewport point on the contact's rendered label (the label sits off the symbol). */
async function labelPoint(page, trackId) {
  await page.waitForFunction(() => crc.mapHandle.map.loaded());
  let pt = null;
  await expect.poll(async () => {
    pt = await page.evaluate(([tid, c]) => {
      const map = crc.mapHandle.map;
      const layers = ['unit-labels', 'atc-labels'].filter(l => map.getLayer(l));
      const p = map.project([c.lon, c.lat]);
      for (let dy = -40; dy <= 60; dy += 3) {
        for (let dx = -20; dx <= 160; dx += 3) {
          if (map.queryRenderedFeatures([p.x + dx, p.y + dy], { layers }).some(f => String(f.properties.id) === tid)) {
            const r = map.getCanvas().getBoundingClientRect();
            return { x: r.left + p.x + dx, y: r.top + p.y + dy };
          }
        }
      }
      return null;
    }, [trackId, C]);
    return pt;
  }, { message: 'the label is drawn' }).not.toBe(null);
  return pt;
}

test('SUPPRESS on the label menu of a contact with no Strip sends the suppress for that pair; RESTORE on the track panel', async ({ page }) => {
  const sent = [];
  page.on('websocket', ws => ws.on('framesent', f => {
    try { const m = JSON.parse(f.payload); if (m.type === 'efsp-conflict-suppress') sent.push(m); } catch { /* not JSON */ }
  }));
  await openPanel(page, { signedOn: ['CTR'], facilityId: 'CENTER', controller: `vqa-${Date.now()}` });
  await page.evaluate(() => crc.dock.toggleDockPanel && crc.dock.toggleDockPanel('efsp', false));
  await page.waitForFunction(() => typeof crc.mapHandle.mapReady !== 'undefined' && crc.mapHandle.mapReady);
  await scene(page, false);

  const pt = await labelPoint(page, 'vqa');
  await page.mouse.click(pt.x, pt.y);
  const menu = page.locator('.label-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.label-menu-suppress')).toHaveText(['SUPPRESS CA BIRD2']);
  await expect(menu.locator('.label-menu-input')).toHaveCount(0); // no Strip: nothing to assign
  await page.screenshot({ path: test.info().outputPath('ca-suppress-menu.png'), clip: { x: pt.x - 120, y: pt.y - 60, width: 320, height: 160 } });
  await menu.locator('.label-menu-suppress').click();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ conflictId: 'vqa|vqb', actingPositionId: 'CTR', suppress: true });

  // The server's answer (here injected): suppressed at CTR. No SUPPRESS left on the label; the track panel's row is grey.
  await scene(page, true);
  await page.mouse.click(pt.x, pt.y);
  await expect(menu).toHaveCount(0); // nothing left to offer: the click is the track panel
  const row = page.locator('#tp-alerts .tp-alert[data-conflict-id="vqa|vqb"]');
  await expect(row).toHaveClass(/tp-alert-off/);
  await expect(row).toContainText('Suppressed.');
  await row.locator('.tp-alert-suppress').click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toMatchObject({ conflictId: 'vqa|vqb', actingPositionId: 'CTR', suppress: false });
});
