'use strict';

/* U-LABEL-MENU (H164 FT-Q4 a, docs/adr/0140): a click on a contact's data block, by the controller who owns its
 * correlated Strip, opens HDG / SPEED / ALT. Enter sends the Strip cell's own SetBlock to crc-sync, so the value lands on
 * the flight's clearance exactly as typed on the Strip. Not the owner: today's click, the track panel (H71 default 7);
 * Shift+click and the menu's TRACK item reach it too.
 *
 * The Strip is a real one on the harness crc-sync; the contact and its correlation are injected client-side (the rig has
 * no DCS), as lt-ui.spec.js does.
 */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, settle } = require('./helpers/app');

test.describe.configure({ timeout: 60000 });

let seq = 0;
const uniqueCallsign = (prefix) => `${prefix}${(Date.now() + seq++) % 10000}`;
const CONTACT = { lat: 37.30, lon: 35.90 };

/** The contact on the scope, correlated client-side to the flight `callsign`. */
async function putContact(page, callsign, trackId) {
  await page.evaluate(([cs, tid, c]) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs);
    crc.app.applySnapshot([{
      id: tid, ...c, domain: 'AIR', onGround: false, illuminatedAt: Date.now(), sources: ['PRIMARY', 'SSR'], iffState: 'neutral', iffOverride: null,
      label: { callsign: cs, source: 'FLIGHT_DATA', tag: null, trackNumber: `T${tid}` }, type: 'F16',
      ssr: { code: '4521', ident: false, emergency: null }, altitude: { ft: 12000, ref: 'QNH', source: 'MODE_C' }, dl: null, scheme: 'TACTICAL',
    }]);
    crc.state.applyEfspCorrelationDelta({ correlations: { updated: [{
      flightDataId: s.flightDataId, rev: 99, state: 'CORRELATED', trackId: tid, matchedBy: 'BINDING', confidence: null,
      binding: null, warning: null, observedBeacon: null, transitions: [],
    }] } });
    crc.picture.labelOffsets.clear();
    crc.mapHandle.map.jumpTo({ center: [c.lon, c.lat], zoom: 9 });
    crc.geojson.updateMap();
  }, [callsign, trackId, CONTACT]);
}

/** A viewport point on the contact's rendered label, found by asking the map (the label sits off the symbol). */
async function labelPoint(page, trackId) {
  await page.waitForFunction(() => crc.mapHandle.map.loaded());
  let pt = null;
  await expect.poll(async () => {
    pt = await page.evaluate((tid) => {
      const map = crc.mapHandle.map;
      const layers = ['unit-labels', 'atc-labels'].filter(l => map.getLayer(l));
      const c = map.project([35.90, 37.30]);
      for (let dy = -40; dy <= 60; dy += 3) {
        for (let dx = -20; dx <= 160; dx += 3) {
          const hit = map.queryRenderedFeatures([c.x + dx, c.y + dy], { layers }).some(f => String(f.properties.id) === tid);
          if (hit) {
            const r = map.getCanvas().getBoundingClientRect();
            return { x: r.left + c.x + dx, y: r.top + c.y + dy };
          }
        }
      }
      return null;
    }, trackId);
    return pt;
  }, { message: 'the label is drawn' }).not.toBe(null);
  return pt;
}

async function openCtr(page, controller) {
  await openPanel(page, { signedOn: ['CTR'], facilityId: 'CENTER', controller });
  await page.locator('#efsp-position-tabs .efsp-position-tab[data-position-id="CTR"]').click();
  await page.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="ctr-enroute"]').click();
}

const activeClearance = (page, callsign, field) => page.evaluate(([cs, f]) => {
  const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs);
  const cell = crc.state.getEfspFlightData(s.flightDataId).clearance[f];
  const active = cell && cell.entries.find(e => e.status === 'ACTIVE');
  return active ? active.value : null;
}, [callsign, field]);

test('the owner assigns heading and altitude from the label; the values land on the flight\'s clearance', async ({ page }) => {
  await openCtr(page, `ulm-owner-${Date.now()}`);
  const callsign = uniqueCallsign('LBM');
  await seedStrip(page, { callsign, actingPositionId: 'CTR', bayId: 'ctr-enroute', stripType: 'ARRIVAL', facilityId: 'CENTER' });
  await putContact(page, callsign, 'ulm-1');
  const pt = await labelPoint(page, 'ulm-1');
  await page.mouse.click(pt.x, pt.y);

  const menu = page.locator('.label-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.label-menu-name')).toHaveText(['HDG', 'SPEED', 'ALT']);
  await expect(menu.locator('.label-menu-head')).toContainText(`${callsign} CTR`);
  // Typing starts in HDG; Tab to ALT; Enter sends both.
  await page.keyboard.type('250');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.type('080');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect.poll(() => activeClearance(page, callsign, 'heading')).toBe('250');
  await expect.poll(() => activeClearance(page, callsign, 'altitude')).toBe('080');
  await settle(page);
  // The Strip's own cells show them: it is the same cell.
  const strip = page.locator('.efsp-strip', { hasText: callsign });
  await expect(strip.locator('[data-block="9A-VECTOR"]')).toContainText('250');

  // Esc closes and sends nothing.
  await page.mouse.click(pt.x, pt.y);
  await expect(menu).toBeVisible();
  await expect(menu.locator('.label-menu-input').first()).toHaveValue('250');
  await page.keyboard.type('1');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  expect(await page.evaluate(() => crc.state.getPendingMutations().length)).toBe(0);

  // The TRACK item and Shift+click are today's click.
  await page.mouse.click(pt.x, pt.y);
  await menu.locator('.label-menu-track').click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator('#tp-callsign')).toContainText(callsign);
  await page.evaluate(() => crc.trackPanel.closeTrackPanel());
  await page.keyboard.down('Shift');
  await page.mouse.click(pt.x, pt.y);
  await page.keyboard.up('Shift');
  await expect(menu).toHaveCount(0);
});

test('not the owner: the label click opens the track panel, no menu', async ({ page }) => {
  await openCtr(page, `ulm-other-${Date.now()}`);
  const callsign = uniqueCallsign('LBN');
  await seedStrip(page, { callsign, actingPositionId: 'CTR', bayId: 'ctr-enroute', stripType: 'ARRIVAL', facilityId: 'CENTER' });
  // Hand the controller to another Facility's Position: the Strip is still CTR's.
  await page.evaluate(() => crc.ws.sendEfspSetPositions('INCIRLIK', ['AP']));
  await page.waitForFunction(() => crc.ws.getAckedPositions('INCIRLIK').includes('AP'));
  await page.evaluate(() => crc.ws.sendEfspSetPositions('CENTER', []));
  await page.waitForFunction(() => crc.ws.getAckedPositions('CENTER').length === 0);
  await putContact(page, callsign, 'ulm-2');
  const pt = await labelPoint(page, 'ulm-2');
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator('#tp-callsign')).toContainText(callsign);
  await expect(page.locator('.label-menu')).toHaveCount(0);
});
