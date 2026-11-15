'use strict';

/* U-SCOPE-GESTURES (docs/adr/0164): Ctrl + drag from an owned contact assigns a heading; Alt + wheel over it moves a
 * preview of the assigned altitude, sent once when Alt is released. Both write the Strip's own cell through the label
 * menu's SetBlock (docs/adr/0140). A contact this controller may not assign keeps the map's own gestures.
 *
 * The Strip is a real one on the harness crc-sync; the contact and its correlation are injected client-side, as
 * u-label-menu.spec.js does.
 */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, settle } = require('./helpers/app');

test.describe.configure({ timeout: 60000 });

let seq = 0;
const uniqueCallsign = (prefix) => `${prefix}${(Date.now() + seq++) % 10000}`;
const CONTACT = { lat: 37.30, lon: 35.90 };

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
    // A known variation (0°): the heading drawn due east is 090 magnetic.
    crc.magnetic.applyTheaterFacts({ ...(crc.magnetic.currentTheaterFacts() || {}), magnetic: { fixedDeg: 0 } });
    crc.picture.labelOffsets.clear();
    crc.mapHandle.map.jumpTo({ center: [c.lon, c.lat], zoom: 9 });
    crc.geojson.updateMap();
  }, [callsign, trackId, CONTACT]);
}

/** Viewport points: the contact's symbol, and one on its label (found by asking the map). */
async function contactPoints(page, trackId) {
  await page.waitForFunction(() => crc.mapHandle.map.loaded());
  let pts = null;
  await expect.poll(async () => {
    pts = await page.evaluate((tid) => {
      const map = crc.mapHandle.map;
      const layers = ['unit-labels', 'atc-labels'].filter(l => map.getLayer(l));
      const c = map.project([35.90, 37.30]);
      const r = map.getCanvas().getBoundingClientRect();
      for (let dy = -40; dy <= 60; dy += 3) {
        for (let dx = -20; dx <= 160; dx += 3) {
          if (map.queryRenderedFeatures([c.x + dx, c.y + dy], { layers }).some(f => String(f.properties.id) === tid)) {
            return { dot: { x: r.left + c.x, y: r.top + c.y }, label: { x: r.left + c.x + dx, y: r.top + c.y + dy } };
          }
        }
      }
      return null;
    }, trackId);
    return pts;
  }, { message: 'the label is drawn' }).not.toBe(null);
  return pts;
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

const asgnLine = (page, tid) => page.evaluate((id) => {
  const f = crc.geojson.buildLabels().features.find(x => String(x.properties.id) === id);
  return f ? (f.properties.asgnLine || '') : null;
}, tid);

/** The strip's text for feet, at the theater's transition altitude (gesture-values.js altitudeEndText). */
const altText = (page, ft) => page.evaluate((v) => {
  const ta = crc.settings.settings.transitionAltFt;
  return v >= ta ? `FL${String(v / 100).padStart(3, '0')}` : String(v);
}, ft);

async function ctrlDrag(page, from, to) {
  await page.keyboard.down('Control');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: 'right' }); // Ctrl + RIGHT drag (the human 2026-11-15)
  await page.mouse.move(to.x, to.y, { steps: 8 });
  return async () => { await page.mouse.up({ button: 'right' }); await page.keyboard.up('Control'); };
}

test('Ctrl + drag from the dot or the label assigns the heading, overwriting the last one; Esc and a short drag send nothing', async ({ page }) => {
  await openCtr(page, `usg-hdg-${Date.now()}`);
  const callsign = uniqueCallsign('SGH');
  await seedStrip(page, { callsign, actingPositionId: 'CTR', bayId: 'ctr-enroute', stripType: 'ARRIVAL', facilityId: 'CENTER' });
  await putContact(page, callsign, 'usg-1');
  const { dot, label } = await contactPoints(page, 'usg-1');
  const zoom = await page.evaluate(() => crc.mapHandle.map.getZoom());
  const bearing = await page.evaluate(() => crc.mapHandle.map.getBearing());

  // From the dot, due east: 090. The live readout runs while dragging.
  let release = await ctrlDrag(page, dot, { x: dot.x + 200, y: dot.y });
  await expect.poll(() => page.evaluate(() => crc.hdgDrag.hdgDragState())).toEqual({ trackId: 'usg-1', heading: 90 });
  await page.screenshot({ path: test.info().outputPath('hdg-drag.png'), clip: { x: dot.x - 40, y: dot.y - 80, width: 320, height: 160 } });
  await release();
  await expect.poll(() => activeClearance(page, callsign, 'heading')).toBe('090');
  await settle(page);

  // From the label, due south (the line is from the contact, not the label): 180 overwrites 090.
  release = await ctrlDrag(page, label, { x: dot.x, y: dot.y + 200 });
  await release();
  await expect.poll(() => activeClearance(page, callsign, 'heading')).toBe('180');
  await settle(page);

  // Esc cancels.
  release = await ctrlDrag(page, dot, { x: dot.x - 200, y: dot.y });
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => crc.hdgDrag.hdgDragState())).toBe(null);
  await release();
  // Shorter than the drag threshold: nothing.
  release = await ctrlDrag(page, dot, { x: dot.x + 4, y: dot.y });
  await release();
  await settle(page);
  expect(await page.evaluate(() => crc.state.getPendingMutations().length)).toBe(0);
  expect(await activeClearance(page, callsign, 'heading')).toBe('180');
  // The map neither panned, zoomed nor rotated.
  expect(await page.evaluate(() => crc.mapHandle.map.getZoom())).toBeCloseTo(zoom, 5);
  expect(await page.evaluate(() => crc.mapHandle.map.getBearing())).toBe(bearing);
});

test('Alt + wheel previews the altitude on the block and sends it once on Alt release; a block moves whole; Esc cancels', async ({ page }) => {
  await openCtr(page, `usg-alt-${Date.now()}`);
  const callsign = uniqueCallsign('SGA');
  await seedStrip(page, { callsign, actingPositionId: 'CTR', bayId: 'ctr-enroute', stripType: 'ARRIVAL', facilityId: 'CENTER' });
  await putContact(page, callsign, 'usg-2');
  const { dot, label } = await contactPoints(page, 'usg-2');
  const zoom = await page.evaluate(() => crc.mapHandle.map.getZoom());

  // Nothing assigned: from Mode C 12,000, two notches up.
  await page.mouse.move(dot.x, dot.y);
  await page.keyboard.down('Alt');
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, -100);
  await expect.poll(() => asgnLine(page, 'usg-2')).toBe('A140?');
  expect(await page.evaluate(() => crc.state.getPendingMutations().length)).toBe(0);
  await page.screenshot({ path: test.info().outputPath('alt-preview.png'), clip: { x: dot.x - 40, y: dot.y - 80, width: 320, height: 160 } });
  await page.keyboard.up('Alt');
  await expect.poll(() => activeClearance(page, callsign, 'altitude')).toBe(await altText(page, 14000));
  await settle(page);
  expect(await page.evaluate(() => crc.mapHandle.map.getZoom())).toBeCloseTo(zoom, 5);

  // From the assigned 14,000 on the label: Shift for 100 ft, down three.
  await page.mouse.move(label.x, label.y);
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 100);
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');
  await expect.poll(() => activeClearance(page, callsign, 'altitude')).toBe(await altText(page, 13700));
  await settle(page);

  // A block (typed on the label menu) moves as a whole.
  await page.mouse.click(label.x, label.y);
  const alt = page.locator('.label-menu .label-menu-input[data-field="altitude"]');
  await alt.fill('080B120');
  await page.keyboard.press('Enter');
  await expect.poll(() => activeClearance(page, callsign, 'altitude')).toContain('-');
  await settle(page);
  await page.mouse.move(dot.x, dot.y);
  await page.keyboard.down('Alt');
  await page.mouse.wheel(0, -100);
  await expect.poll(() => asgnLine(page, 'usg-2')).toBe('A090B130?');
  await page.keyboard.up('Alt');
  await expect.poll(() => activeClearance(page, callsign, 'altitude')).toBe(`${await altText(page, 9000)}-${await altText(page, 13000)}`);
  await settle(page);

  // Esc throws the preview away.
  await page.keyboard.down('Alt');
  await page.mouse.wheel(0, -100);
  await expect.poll(() => asgnLine(page, 'usg-2')).toContain('?');
  await page.keyboard.press('Escape');
  await page.keyboard.up('Alt');
  await settle(page);
  expect(await asgnLine(page, 'usg-2')).not.toContain('?');
  expect(await page.evaluate(() => crc.state.getPendingMutations().length)).toBe(0);
});

test('not the owner: Ctrl + drag and Alt + wheel are the map\'s, nothing is sent', async ({ page }) => {
  await openCtr(page, `usg-other-${Date.now()}`);
  const callsign = uniqueCallsign('SGN');
  await seedStrip(page, { callsign, actingPositionId: 'CTR', bayId: 'ctr-enroute', stripType: 'ARRIVAL', facilityId: 'CENTER' });
  await page.evaluate(() => crc.ws.sendEfspSetPositions('INCIRLIK', ['AP']));
  await page.waitForFunction(() => crc.ws.getAckedPositions('INCIRLIK').includes('AP'));
  await page.evaluate(() => crc.ws.sendEfspSetPositions('CENTER', []));
  await page.waitForFunction(() => crc.ws.getAckedPositions('CENTER').length === 0);
  await putContact(page, callsign, 'usg-3');
  const { dot } = await contactPoints(page, 'usg-3');

  const release = await ctrlDrag(page, dot, { x: dot.x + 200, y: dot.y });
  expect(await page.evaluate(() => crc.hdgDrag.hdgDragState())).toBe(null);
  await release();

  const zoom = await page.evaluate(() => crc.mapHandle.map.getZoom());
  await page.mouse.move(dot.x, dot.y);
  await page.keyboard.down('Alt');
  await page.mouse.wheel(0, -300);
  expect(await page.evaluate(() => crc.altWheel.altWheelState())).toBe(null);
  await page.keyboard.up('Alt');
  await expect.poll(() => page.evaluate(() => crc.mapHandle.map.getZoom())).not.toBeCloseTo(zoom, 3);
  await settle(page);
  expect(await activeClearance(page, callsign, 'heading')).toBe(null);
  expect(await activeClearance(page, callsign, 'altitude')).toBe(null);
});
