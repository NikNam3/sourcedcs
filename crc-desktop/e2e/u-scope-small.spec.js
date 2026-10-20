'use strict';

/* U-SCOPE-SMALL (live test 2026-10-20): Settings → Declutter's "DCS drawings" and "Airport surface" switches, and the
 * airspace editor picker's drawing highlight. Run on E2E_LANE=3.
 *
 * As in airspace-geometry.spec.js the rig has no DCS mission: the drawings arrive as the `init` frame through the page's
 * own WebSocket handler. The basemap has no tiles here (the harness blocks both sources), but its style layers exist,
 * so the airport surface switch is checked on their visibility. */

const { test, expect } = require('./helpers/test');
const { openPanel } = require('./helpers/app');

const pts = (a) => a.map(([lat, lon]) => ({ lat, lon }));
const MISSION = () => ({
  type: 'init', version: 1, missionId: 'm-scope-small', bullseye: {}, airports: [], theatre: 'Syria', waypoints: [],
  drawings: [
    { primitiveType: 'Polygon', polygonMode: 'free', closed: true, name: 'ADANA SOUTH MOA', layerName: 'Common', points: pts([[36.2, 35.2], [36.2, 35.8], [36.7, 35.8], [36.7, 35.2]]) },
    { primitiveType: 'Polyline', polygonMode: '', closed: false, name: 'INGRESS PINK', layerName: 'Blue', points: pts([[36, 35], [37, 36]]) },
    // Far out of view of the scope's start position (35.43E 37.00N, zoom 7): "show" brings it in.
    { primitiveType: 'Polygon', polygonMode: 'free', closed: true, name: 'FAR BOX', layerName: 'Author', points: pts([[33.0, 30.0], [33.0, 30.5], [33.5, 30.5], [33.5, 30.0]]) },
  ],
});

const SURFACE = ['Airport pavement', 'Taxiway', 'Runway designators', 'Taxiway labels', 'Apron labels', 'Airport gate'];
const drawingData = (page) => page.evaluate(() => {
  const d = crc.mapHandle.map.getSource('drawings')._data;
  return (typeof d === 'string' ? [] : d.features).map(f => f.properties.idx);
});
const highlighted = (page) => page.evaluate(() => crc.drawingHighlight.highlightedDrawing());
const highlightData = (page) => page.evaluate(() => crc.mapHandle.map.getSource('drawing-highlight')._data.features.length);

async function boot(page) {
  await openPanel(page, { signedOn: ['AP'], facilityId: 'INCIRLIK' });
  await page.waitForFunction(() => crc.mapHandle.mapReady === true, null, { timeout: 20000 });
  await page.evaluate((m) => crc.app._ws.onmessage({ data: JSON.stringify(m) }), MISSION());
}
async function declutter(page) {
  await page.evaluate(() => crc.dock.toggleDockPanel('settings', true));
  const panel = page.locator('#settings-panel');
  await panel.locator('.stab[data-pane="radar"]').click();
  await expect(panel.locator('#stab-radar')).toBeVisible();
  return panel;
}

test('DCS drawings: on by default; the switch hides and shows the drawing layers\' data', async ({ page }) => {
  await boot(page);
  await expect.poll(() => drawingData(page)).toEqual([0, 1, 2]);
  const panel = await declutter(page);
  const sw = panel.locator('#set-drawings');
  await expect(sw).toBeChecked();
  await expect(panel.locator('#stab-radar #set-text-marks')).toHaveCount(1); // moved next to it
  await sw.evaluate(el => el.click());
  await expect.poll(() => drawingData(page)).toEqual([]);
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('crc-desktop-settings')))).drawingsEnabled).toBe(false);
  await sw.evaluate(el => el.click());
  await expect.poll(() => drawingData(page)).toEqual([0, 1, 2]);
});

test('Airport surface: on by default; the switch sets the surface layers\' visibility, the runways stay', async ({ page }) => {
  await boot(page);
  const vis = () => page.evaluate((ids) => ids.map(id => crc.mapHandle.map.getLayoutProperty(id, 'visibility') || 'visible'), SURFACE);
  await expect.poll(vis).toEqual(SURFACE.map(() => 'visible'));
  const panel = await declutter(page);
  const sw = panel.locator('#set-airport-surface');
  await expect(sw).toBeChecked();
  await sw.evaluate(el => el.click());
  await expect.poll(vis).toEqual(SURFACE.map(() => 'none'));
  expect(await page.evaluate(() => crc.mapHandle.map.getLayoutProperty('Aeroway', 'visibility') || 'visible')).toBe('visible');
  await sw.evaluate(el => el.click());
  await expect.poll(vis).toEqual(SURFACE.map(() => 'visible'));
});

test('picker: hovering or focusing an entry highlights its drawing, with the drawings switched off too; picking or closing clears it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { crc.settings.settings.drawingsEnabled = false; });
  await page.evaluate(() => { if (!crc.dock.isDockPanelOpen('airspace')) crc.dock.toggleDockPanel('airspace', true); });
  await expect(page.locator('#airspace-panel')).toBeVisible({ timeout: 10000 });
  await page.locator('.airspace-new-btn').click();
  const outline = page.locator('.airspace-card-new .airspace-editor .asg-area');
  await outline.locator('#asg-pick').click();
  const picker = outline.locator('.asg-picker');
  const row = (name) => picker.locator('.asg-drawing', { hasText: name });

  await row('ADANA SOUTH MOA').hover();
  await expect.poll(() => highlighted(page)).toBe(0);
  expect(await highlightData(page)).toBe(1);
  // above the drawings and the airspace outlines
  const order = await page.evaluate(() => crc.mapHandle.map.getStyle().layers.map(l => l.id));
  expect(order.indexOf('drawing-highlight-line')).toBeGreaterThan(order.indexOf('airspace-outline-solid'));
  expect(order.indexOf('drawing-highlight-line')).toBeGreaterThan(order.indexOf('drawing-lines'));

  // the open line is not pickable, but it is highlighted
  await row('INGRESS PINK').hover();
  await expect.poll(() => highlighted(page)).toBe(1);

  // a plain hover never moves the map; "show" does, for a drawing out of view
  const centre = () => page.evaluate(() => { const c = crc.mapHandle.map.getCenter(); return [+c.lng.toFixed(3), +c.lat.toFixed(3)]; });
  const before = await centre();
  await row('FAR BOX').hover();
  await expect.poll(() => highlighted(page)).toBe(2);
  expect(await centre()).toEqual(before);
  await row('FAR BOX').locator('.asg-drawing-show').click();
  await expect.poll(async () => (await centre())[1] < 34).toBe(true);

  // keyboard: focus highlights; leaving the picker with the mouse keeps the focused one
  await page.mouse.move(0, 0);
  await row('ADANA SOUTH MOA').focus();
  await expect.poll(() => highlighted(page)).toBe(0);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => highlighted(page)).toBe(1);

  // closing the picker clears it
  await outline.locator('#asg-pick').click();
  await expect.poll(() => highlighted(page)).toBe(null);
  expect(await highlightData(page)).toBe(0);

  // picking an entry (Enter) clears it
  await outline.locator('#asg-pick').click();
  await row('ADANA SOUTH MOA').focus();
  await expect.poll(() => highlighted(page)).toBe(0);
  await page.keyboard.press('Enter');
  await expect(outline.locator('.asg-chip')).toHaveText('DCS DRAWING');
  await expect.poll(() => highlighted(page)).toBe(null);

  // closing the panel clears it
  await outline.locator('#asg-pick').click();
  await row('FAR BOX').hover();
  await expect.poll(() => highlighted(page)).toBe(2);
  await page.evaluate(() => crc.dock.toggleDockPanel('airspace', false));
  await expect.poll(() => highlighted(page)).toBe(null);
});
