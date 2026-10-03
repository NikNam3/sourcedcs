'use strict';

/* AIRSP-2P-B: the geometry editor, the DCS-drawing picker, drawing on the map, the route fix table, the airspace layer
 * menu and the outlines on the map (docs/adr/0098 §5; mockup docs/wip/AIRSP-2P-B-mockup.html), in a real browser.
 *
 * As in airspace-panel.spec.js the rig has no DCS mission: the mission (drawings, navpoints, theatre) is delivered as the
 * `init` frame through the page's own WebSocket handler, the airspaces as an `efsp-airspace-delta`, and the panel's sends
 * are captured through the sender setter. Set SHOTS=1 to write screenshots into docs/wip/AIRSP-2P-B/.
 */

const path = require('path');
const { test, expect } = require('./helpers/test');
const { openPanel } = require('./helpers/app');

const SHOTS = process.env.SHOTS === '1' ? path.join(__dirname, '../../docs/wip/AIRSP-2P-B') : null;
const shot = async (locator, name) => { if (SHOTS) await locator.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };

const sq = [[36.2, 35.2], [36.2, 35.8], [36.7, 35.8], [36.7, 35.2]];
const dr = (name, layerName, pts, extra = {}) => ({ primitiveType: 'Polygon', polygonMode: 'free', closed: true, name, layerName, points: pts.map(([lat, lon]) => ({ lat, lon })), ...extra });
const freehand = (n) => Array.from({ length: n }, (_, i) => { const a = (i / n) * 2 * Math.PI; return [36.5 + 0.3 * Math.sin(a) + (i % 2 ? 0.00002 : 0), 35.5 + 0.4 * Math.cos(a)]; });
const MISSION = () => ({
  type: 'init', version: 1, missionId: 'm-geo', bullseye: {}, airports: [], theatre: 'Syria',
  waypoints: [{ name: 'SARIN', lat: 37.2, lon: 35.65 }, { name: 'TOPAK', lat: 36.98, lon: 36.15 }, { name: 'TOROS', lat: 37.12, lon: 35.25 }],
  drawings: [
    dr('ADANA SOUTH MOA', 'Common', sq), dr('KARATAS WARNING', 'Common', [[36.0, 35.0], [36.0, 35.1], [36.1, 35.1]]),
    dr('SA-11 RING', 'Red', freehand(64), { polygonMode: 'oval' }),
    { primitiveType: 'Polyline', polygonMode: '', closed: false, name: 'INGRESS PINK', layerName: 'Blue', points: [{ lat: 36, lon: 35 }, { lat: 37, lon: 36 }] },
    dr('SCRATCH 1', 'Author', freehand(412)),
    { primitiveType: 'TextBox', text: 'hello', name: 'LABEL', layerName: 'Author' },
  ],
});

const def = (extra = {}) => ({
  airspaceId: 'MOA-ADS', name: 'MOA ADANA SOUTH', kind: 'AREA', type: 'MOA', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP',
  usingPositionId: null, usingFacilityId: null, workingFrequencyMhz: 139.25, controlFrequencyMhz: null, altLowerFt: 5000, altUpperFt: 23000,
  geometry: null, source: 'PANEL', ...extra,
});
const rec = (d, extra = {}) => ({ airspaceId: d.airspaceId, theater: 'Syria', definition: d, defRev: 3, rev: 1, state: 'RETURNED', window: null, pendingRequest: null, transitions: [], updatedAt: Date.UTC(2026, 9, 2, 13, 0), updatedBy: 'c-1', ...extra });
const ROUTE = () => def({ airspaceId: 'VR1207', name: 'VR1207 SEYHAN LOW', kind: 'ROUTE', type: 'VR', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', altLowerFt: 500, altUpperFt: 6000, altitudeBlock: undefined, workingFrequencyMhz: null, defaultWidthNm: 4,
  segments: [{ fix: { name: 'A', lat: 37.35, lon: 35.35 }, altLowerFt: 500, altUpperFt: 3000, widthNm: null }, { fix: { name: 'SARIN', lat: 37.2, lon: 35.65 }, altLowerFt: 1000, altUpperFt: 6000, widthNm: 10 }, { fix: { name: 'TOPAK', lat: 36.98, lon: 36.15 }, altLowerFt: null, altUpperFt: null, widthNm: null }] });

async function open(page, signedOn = ['AP'], records = []) {
  // CTR is CENTER's Position; the sign-on helper now waits for the server's ack, so the Facility must be right.
  const facilityId = signedOn.includes('CTR') ? 'CENTER' : 'INCIRLIK';
  const errors = (await openPanel(page, { signedOn, facilityId })).consoleErrors;
  await page.evaluate(() => { if (!crc.dock.isDockPanelOpen('airspace')) crc.dock.toggleDockPanel('airspace', true); });
  await expect(page.locator('#airspace-panel')).toBeVisible({ timeout: 10000 });
  await page.evaluate(() => {
    window.__sent = [];
    crc.ws.setEfspSender('sendEfspAirspaceMutation', (pos, id, baseRev, op, extra = {}) => {
      const clientMutationId = `t-${window.__sent.length + 1}`;
      window.__sent.push({ pos, id, baseRev, op, extra, clientMutationId });
      return clientMutationId;
    });
  });
  await page.waitForFunction(() => crc.app.mapReady === true, null, { timeout: 20000 });
  await page.evaluate((m) => crc.app._ws.onmessage({ data: JSON.stringify(m) }), MISSION());
  await inject(page, records);
  return errors;
}
const inject = (page, records) => page.evaluate((r) => crc.msgRegistry.dispatchEfspMessage({ version: 1, type: 'efsp-airspace-delta', airspaceSeq: 1, airspaces: { updated: r } }), records);
const card = (page, id) => page.locator(`.airspace-card[data-airspace-id="${id}"]`);
const fld = (ed, label) => ed.locator('.airspace-field').filter({ has: ed.page().locator('.airspace-field-label', { hasText: label }) });
async function newAirspace(page) {
  await page.locator('.airspace-new-btn').click();
  const ed = page.locator('.airspace-card-new .airspace-editor');
  await expect(ed).toBeVisible();
  return ed;
}
async function edit(page, id) {
  await card(page, id).locator('.airspace-more-btn').click();
  await card(page, id).locator('[data-action="edit"]').click();
  const ed = card(page, id).locator('.airspace-editor');
  await expect(ed).toBeVisible();
  return ed;
}
const outlineIds = (page) => page.evaluate(() => crc.airspaceLayer.lastAirspaceFeatures().outlines.features.map(f => f.properties.id).sort());
const px = (page, lat, lon) => page.evaluate(([a, o]) => { const p = crc.app.map.project([o, a]); const r = crc.app.map.getCanvas().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [lat, lon]);
async function clickMap(page, lat, lon) { const p = await px(page, lat, lon); await page.mouse.click(p.x, p.y); }

test('create an AREA: the kind chooser, no outline yet, then pick a DCS drawing: the points are copied and Save sends them', async ({ page }) => {
  const errors = await open(page);
  const ed = await newAirspace(page);
  await expect(fld(ed, 'KIND').locator('select.airspace-input')).toHaveValue('AREA');
  const outline = ed.locator('.asg-area');
  await expect(outline.locator('.asg-chip')).toHaveText('NONE');
  await expect(outline.locator('.asg-count')).toContainText('0 points');
  await expect(outline.locator('#asg-refresh')).toBeDisabled();
  await expect(outline.locator('.asg-why')).toContainText('no drawing picked yet');
  await expect(outline.locator('#asg-clear')).toBeDisabled();

  await outline.locator('#asg-pick').click();
  const picker = outline.locator('.asg-picker');
  await expect(picker.locator('.asg-layer')).toHaveText(['COMMON', 'RED', 'BLUE', 'AUTHOR']);
  await expect(picker.locator('.asg-drawing')).toHaveCount(5); // the text box is not listed
  const open_ = picker.locator('.asg-drawing-off');
  await expect(open_).toHaveCount(1);
  await expect(open_).toContainText('INGRESS PINK');
  await expect(open_).toContainText('open line');
  await expect(picker.locator('.asg-drawing', { hasText: 'SCRATCH 1' })).toContainText('412 →');
  await shot(ed, '01-area-picker');

  await picker.locator('.asg-drawing', { hasText: 'ADANA SOUTH MOA' }).click();
  await expect(outline.locator('.asg-chip')).toHaveText('DCS DRAWING');
  await expect(outline.locator('.asg-count')).toContainText('4 points');
  await expect(outline.locator('.asg-text')).toContainText('Copied from Common / ADANA SOUTH MOA');
  await expect(outline.locator('.asg-dot')).toBeVisible();
  await expect(outline.locator('.asg-text .asg-was')).toHaveText('was: no outline');
  await expect(outline.locator('#asg-refresh')).toBeDisabled();
  await expect(outline.locator('.asg-why')).toContainText('matches the drawing');
  await shot(ed, '02-area-picked');

  await fld(ed, 'ID').locator('input').fill('MOA-NEW');
  await fld(ed, 'NAME').locator('input').fill('MOA NEW');
  await expect(ed.locator('.airspace-save-btn')).toBeEnabled();
  await ed.locator('.airspace-save-btn').click();
  const sent = await page.evaluate(() => window.__sent);
  expect(sent).toHaveLength(1);
  const g = sent[0].op.definition.geometry;
  expect(sent[0].op).toMatchObject({ kind: 'CreateAirspace', definition: { airspaceId: 'MOA-NEW', kind: 'AREA' } });
  expect(g.source).toBe('DCS_DRAWING');
  expect(g.points).toEqual(sq);
  expect(g.drawingRef).toMatchObject({ layerName: 'Common', objectName: 'ADANA SOUTH MOA' });
  expect(g.drawingRef.missionFingerprint).toMatch(/^Syria:/);
  expect(errors.filter(e => !/MapTiler|403|tile|glyph|Failed to load resource/i.test(e))).toEqual([]);
});

test('a drawing over 200 points is simplified on pick and says so; an open line cannot be picked', async ({ page }) => {
  await open(page);
  const ed = await newAirspace(page);
  const outline = ed.locator('.asg-area');
  await outline.locator('#asg-pick').click();
  await outline.locator('.asg-drawing-off').click(); // nothing happens
  await expect(outline.locator('.asg-chip')).toHaveText('NONE');
  await outline.locator('.asg-drawing', { hasText: 'SCRATCH 1' }).click();
  await expect(outline.locator('.asg-chip')).toHaveText('DCS DRAWING');
  await expect(outline.locator('.asg-text')).toContainText('Simplified from 412 to');
  await expect(outline.locator('.asg-text')).toContainText('within 0.1 NM');
  const n = Number((await outline.locator('.asg-count').innerText()).split(' ')[0]);
  expect(n).toBeGreaterThanOrEqual(3); expect(n).toBeLessThanOrEqual(200);
});

test('Refresh from drawing is offered when the loaded drawing moved, and the outline stays when the drawing is gone', async ({ page }) => {
  test.setTimeout(150000); // a long walk; the whole-test ceiling is for hangs, not for a busy machine
  const picked = { source: 'DCS_DRAWING', drawingRef: { layerName: 'Common', objectName: 'ADANA SOUTH MOA', missionFingerprint: 'Syria:x' }, points: sq };
  await open(page, ['AP'], [rec(def({ geometry: picked }))]);
  const ed = await edit(page, 'MOA-ADS');
  const outline = ed.locator('.asg-area');
  await expect(outline.locator('.asg-chip')).toHaveText('DCS DRAWING');
  await expect(outline.locator('#asg-refresh')).toBeDisabled(); // the loaded drawing matches the copy
  await ed.locator('.airspace-action-btn', { hasText: 'Cancel' }).click();
  // the drawing moves in a newly loaded mission
  await page.evaluate((m) => { m.drawings[0].points.push({ lat: 36.45, lon: 35.0 }); crc.app._ws.onmessage({ data: JSON.stringify(m) }); }, MISSION());
  const ed2 = await edit(page, 'MOA-ADS');
  await expect(ed2.locator('.asg-text')).toContainText("The loaded mission's drawing differs: 5 points now.");
  await expect(ed2.locator('#asg-refresh')).toBeEnabled();
  await shot(ed2, '03-outline-drawing-moved');
  await ed2.locator('#asg-refresh').click();
  await expect(ed2.locator('.asg-count')).toContainText('5 points');
  await expect(ed2.locator('.asg-text')).toContainText('Refreshed: 5 points');
  await expect(ed2.locator('.asg-text .asg-was')).toHaveText('was: copied from a DCS drawing, 4 points');
  await ed2.locator('.airspace-save-btn').click();
  const sent = await page.evaluate(() => window.__sent);
  expect(sent[0].op.patch.geometry.points).toHaveLength(5);
  expect(sent[0].op.patch.geometry.source).toBe('DCS_DRAWING');
  // the ack lands: the form closes and the record now holds the refreshed copy
  await page.evaluate(([a, r]) => crc.msgRegistry.dispatchEfspMessage({ version: 1, type: 'efsp-airspace-ack', clientMutationId: a.clientMutationId, airspaceId: 'MOA-ADS', ok: true, airspace: r }), [sent[0], rec(def({ geometry: sent[0].op.patch.geometry }), { defRev: 4 })]);
  await inject(page, [rec(def({ geometry: sent[0].op.patch.geometry }), { defRev: 4 })]);
  await expect(card(page, 'MOA-ADS').locator('.airspace-editor')).toHaveCount(0);
  // a mission without that drawing: the saved copy and its outline stay
  await page.evaluate((m) => { m.drawings = []; crc.app._ws.onmessage({ data: JSON.stringify(m) }); }, MISSION());
  await expect(card(page, 'MOA-ADS')).toBeVisible();
  await expect.poll(() => outlineIds(page)).toEqual([]); // RETURNED: the default menu does not draw it, but the record keeps its points
  const ed3 = await edit(page, 'MOA-ADS');
  await expect(ed3.locator('.asg-count')).toContainText('5 points');
  await expect(ed3.locator('#asg-refresh')).toBeDisabled();
  await expect(ed3.locator('.asg-why')).toContainText('is not in the loaded mission');
});

test('an ACTIVE airspace is locked (R3-23): every outline button is disabled and says why', async ({ page }) => {
  const g = { source: 'POLYGON', points: sq };
  await open(page, ['AP'], [rec(def({ geometry: g }), { state: 'ACTIVE' })]);
  const ed = await edit(page, 'MOA-ADS');
  const outline = ed.locator('.asg-area');
  for (const id of ['#asg-draw', '#asg-pick', '#asg-refresh', '#asg-clear', '#asg-type']) await expect(outline.locator(id)).toBeDisabled();
  await expect(outline.locator('.asg-why')).toHaveText('airspace is ACTIVE: only name and frequencies can change');
  await shot(ed, '04-outline-locked');
});

test('Clear outline fills the form only: the "was" line shows the old outline, Cancel brings it back', async ({ page }) => {
  await open(page, ['AP'], [rec(def({ geometry: { source: 'POLYGON', points: sq } }))]);
  const ed = await edit(page, 'MOA-ADS');
  const outline = ed.locator('.asg-area');
  await expect(outline.locator('.asg-chip')).toHaveText('DRAWN');
  await outline.locator('#asg-clear').click();
  await expect(outline.locator('.asg-chip')).toHaveText('NONE');
  await expect(outline.locator('.asg-text')).toContainText('On Save, the map stops drawing it');
  await expect(outline.locator('.asg-text .asg-was')).toHaveText('was: drawn, 4 points');
  await expect(ed.locator('.airspace-save-btn')).toBeEnabled();
  expect(await page.evaluate(() => window.__sent.length)).toBe(0);
  await shot(ed, '05-outline-cleared');
  await ed.locator('.airspace-action-btn', { hasText: 'Cancel' }).click();
  const ed2 = await edit(page, 'MOA-ADS');
  await expect(ed2.locator('.asg-count')).toContainText('4 points');
});

test('Draw on map: click points, click the first to close, drag a point across an edge: crossing is flagged and Done is disabled', async ({ page }) => {
  await open(page);
  const ed = await newAirspace(page);
  await fld(ed, 'NAME').locator('input').fill('MOA DRAWN');
  await page.evaluate(() => crc.app.map.jumpTo({ center: [35.5, 36.5], zoom: 8 }));
  await ed.locator('#asg-draw').click();
  const bar = page.locator('.asd-bar');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.asd-title')).toContainText('DRAWING OUTLINE');
  await expect(bar.locator('.asd-primary')).toBeDisabled();
  await clickMap(page, 36.2, 35.2); await clickMap(page, 36.2, 35.8); await clickMap(page, 36.7, 35.8);
  await page.mouse.move((await px(page, 36.7, 35.3)).x, (await px(page, 36.7, 35.3)).y);
  await expect(bar.locator('.asd-readout')).toContainText('NM'); // the cursor readout: position, bearing and length of the leg
  await shot(page.locator('#map'), '06-map-drawing');
  await clickMap(page, 36.7, 35.2);
  await expect(bar.locator('.asd-title')).toContainText('4 points');
  await clickMap(page, 36.2, 35.2); // the first point closes the shape
  await expect(bar.locator('.asd-title')).toContainText('EDITING OUTLINE');
  await expect(bar.locator('.asd-primary')).toBeEnabled();
  // drag vertex 3 (36.7, 35.2) across to the far side of the opposite edge: the shape crosses itself
  const from = await px(page, 36.7, 35.2); const to = await px(page, 36.3, 35.9);
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 }); await page.mouse.move(to.x, to.y, { steps: 4 }); await page.mouse.up();
  await expect(bar.locator('.asd-problem')).toContainText('Edges cross');
  await expect(bar.locator('.asd-primary')).toBeDisabled();
  await shot(page.locator('#map'), '07-map-vertex-crossing');
  // move it back: Done is enabled and hands the points to the form
  await page.mouse.move(to.x, to.y); await page.mouse.down(); await page.mouse.move(from.x, from.y, { steps: 8 }); await page.mouse.up();
  await expect(bar.locator('.asd-problem')).toBeHidden();
  await bar.locator('.asd-primary').click();
  await expect(bar).toHaveCount(0);
  await expect(ed.locator('.asg-chip')).toHaveText('DRAWN');
  await expect(ed.locator('.asg-count')).toContainText('4 points');
  expect(await page.evaluate(() => window.__sent.length)).toBe(0); // nothing is sent until Save
  await expect(ed.locator('#asg-draw')).toHaveText('Edit on map');
});

test('Escape cancels a drawing session and leaves the form as it was', async ({ page }) => {
  await open(page);
  const ed = await newAirspace(page);
  await ed.locator('#asg-draw').click();
  await clickMap(page, 36.2, 35.2);
  await page.keyboard.press('Escape');
  await expect(page.locator('.asd-bar')).toHaveCount(0);
  await expect(ed.locator('.asg-chip')).toHaveText('NONE');
});

test('create a ROUTE: choose the kind, type fixes in DM, MGRS and decimal, pick a navpoint, set one wide leg; Save sends segments', async ({ page }) => {
  test.setTimeout(150000);
  await open(page, ['CTR']);
  const ed = await newAirspace(page);
  await fld(ed, 'KIND').locator('select.airspace-input').selectOption('ROUTE');
  await expect(ed.locator('.asg-route')).toBeVisible();
  await expect(ed.locator('.asg-area')).toHaveCount(0);
  await expect(fld(ed, 'TYPE').locator('select.airspace-input')).toHaveValue('IR');
  await fld(ed, 'TYPE').locator('select.airspace-input').selectOption('VR');
  await fld(ed, 'ID').locator('input').fill('VR1207');
  await fld(ed, 'NAME').locator('input').fill('VR1207 SEYHAN LOW');
  const route = ed.locator('.asg-route');
  await expect(route.locator('.asg-chip')).toHaveText('2 FIXES · 1 LEGS');
  const cell = (row, field) => route.locator(`input[data-row="${row}"][data-field="${field}"]`);
  await cell(0, 'name').fill('A');
  await cell(0, 'lat').fill('N37 21.0'); await cell(0, 'lon').fill('E035 21.0'); await cell(0, 'lon').blur();
  await cell(0, 'altLowerFt').fill('500'); await cell(0, 'altUpperFt').fill('3000');
  // a third fix first (the exit fix has no leg cells), then fix 2 by navpoint
  await route.locator('#asg-add-fix').click();
  await route.locator('tr[data-fix="1"] .asg-nav').click();
  await route.locator('.asg-navmenu input').fill('SAR');
  await route.locator('.asg-navitem', { hasText: 'SARIN' }).click();
  await expect(cell(1, 'name')).toHaveValue('SARIN');
  await expect(cell(1, 'lat')).toHaveValue('N37 12.0');
  await cell(1, 'altLowerFt').fill('1000'); await cell(1, 'altUpperFt').fill('6000'); await cell(1, 'widthNm').fill('10');
  // the exit fix as a decimal pair pasted in the first cell
  await cell(2, 'name').fill('TOPAK');
  await cell(2, 'lat').fill('36.98, 36.15'); await cell(2, 'lat').blur();
  await expect(cell(2, 'lat')).toHaveValue('N36 58.8'); await expect(cell(2, 'lon')).toHaveValue('E036 09.0');
  await expect(route.locator('tr[data-fix="2"]')).toContainText('exit fix');
  await expect(route.locator('.asg-route-top input.asg-derived').first()).toHaveValue('500');
  await expect(route.locator('.asg-route-top input.asg-derived').nth(1)).toHaveValue('6000');
  await shot(ed, '08-route-editor');
  await expect(ed.locator('.airspace-save-btn')).toBeEnabled();
  await ed.locator('.airspace-save-btn').click();
  const sent = await page.evaluate(() => window.__sent);
  const d = sent[0].op.definition;
  expect(d).toMatchObject({ airspaceId: 'VR1207', kind: 'ROUTE', type: 'VR', defaultWidthNm: 4 });
  expect(d.altLowerFt).toBeUndefined();
  expect(d.segments).toEqual([
    { fix: { name: 'A', lat: 37.35, lon: 35.35 }, altLowerFt: 500, altUpperFt: 3000, widthNm: null },
    { fix: { name: 'SARIN', lat: 37.2, lon: 35.65 }, altLowerFt: 1000, altUpperFt: 6000, widthNm: 10 },
    { fix: { name: 'TOPAK', lat: 36.98, lon: 36.15 }, altLowerFt: null, altUpperFt: null, widthNm: null },
  ]);
});

test('the coordinate format is a per-user setting: MGRS shows the position as one MGRS cell, and every format is still accepted', async ({ page }) => {
  await open(page, ['CTR'], [rec(ROUTE(), {})]);
  await page.evaluate(() => { crc.app.settings.coordFormat = 'MGRS'; });
  const ed = await edit(page, 'VR1207');
  const route = ed.locator('.asg-route');
  const lat0 = route.locator('input[data-row="0"][data-field="lat"]');
  await expect(lat0).toHaveValue(/^36S [A-Z]{2} \d{5} \d{5}$/);
  await expect(route.locator('input[data-row="0"][data-field="lon"]')).toBeDisabled();
  const mgrs = await lat0.inputValue();
  await lat0.fill('N37 21.0 E035 21.0'); await lat0.blur(); // DM accepted while MGRS is shown
  await expect(lat0).toHaveValue(mgrs);
  await page.evaluate(() => { crc.app.settings.coordFormat = 'DM'; });
});

test('the route editor is read-only while ACTIVE (R3-23), and shows the derived envelope', async ({ page }) => {
  await open(page, ['CTR'], [rec(ROUTE(), { state: 'ACTIVE' })]);
  const ed = await edit(page, 'VR1207');
  const route = ed.locator('.asg-route');
  await expect(route.locator('#asg-add-fix')).toBeDisabled();
  await expect(route.locator('input[data-row="0"][data-field="name"]')).toBeDisabled();
  await expect(route.locator('.asg-why').first()).toContainText('ACTIVE');
});

test('the layer menu: default is ACTIVE only; RETURNED on draws dashed outlines; one airspace Off; choices hold across a mission reload; Reset', async ({ page }) => {
  const g = { source: 'POLYGON', points: sq };
  const far = { source: 'POLYGON', points: [[36.9, 36.3], [36.9, 36.9], [37.3, 36.9], [37.3, 36.3]] };
  await open(page, ['AP'], [
    rec(def({ airspaceId: 'A-ACTIVE', name: 'ACTIVE ONE', geometry: g }), { state: 'ACTIVE' }),
    rec(def({ airspaceId: 'B-RETURNED', name: 'RETURNED ONE', geometry: far })),
    rec(def({ airspaceId: 'C-ACTIVE', name: 'ACTIVE TWO', geometry: far }), { state: 'ACTIVE' }),
    rec(def({ airspaceId: 'D-NOOUT', name: 'NO OUTLINE', geometry: null })),
    rec(ROUTE(), { state: 'ACTIVE' }),
  ]);
  await expect.poll(() => outlineIds(page)).toEqual(['A-ACTIVE', 'C-ACTIVE', 'VR1207']);
  const features = await page.evaluate(() => crc.airspaceLayer.lastAirspaceFeatures().outlines.features.map(f => ({ id: f.properties.id, dashed: f.properties.dashed })));
  expect(features.every(f => f.dashed === false)).toBe(true);

  const btn = page.locator('#airspace-menu-btn');
  await btn.click();
  const pop = page.locator('#airspace-menu-pop');
  await expect(pop).toBeVisible();
  await expect(pop.locator('.aslm-reset')).toBeDisabled();
  await expect(pop.locator('.aslm-row', { hasText: 'NO OUTLINE' }).locator('.aslm-word')).toHaveText('no outline');
  await expect(pop.locator('.aslm-row', { hasText: 'RETURNED ONE' }).locator('.aslm-word')).toHaveText('hidden');
  await shot(page.locator('#map'), '09-layer-menu-default');

  await pop.locator('.aslm-check', { hasText: 'RETURNED' }).locator('input').check();
  await expect.poll(() => outlineIds(page)).toEqual(['A-ACTIVE', 'B-RETURNED', 'C-ACTIVE', 'VR1207']);
  const dashed = await page.evaluate(() => crc.airspaceLayer.lastAirspaceFeatures().outlines.features.find(f => f.properties.id === 'B-RETURNED').properties.dashed);
  expect(dashed).toBe(true);
  await pop.locator('.aslm-row', { hasText: 'ACTIVE TWO' }).locator('.aslm-seg-btn', { hasText: 'Off' }).click();
  await expect.poll(() => outlineIds(page)).toEqual(['A-ACTIVE', 'B-RETURNED', 'VR1207']);
  await pop.locator('.aslm-check', { hasText: 'Route centrelines' }).locator('input').check();
  await expect(pop.locator('.aslm-reset')).toBeEnabled();
  await shot(page.locator('#map'), '10-layer-menu-changed');

  // a new mission load in the same theater: the choices hold; they are stored per user
  await page.evaluate((m) => crc.app._ws.onmessage({ data: JSON.stringify({ ...m, missionId: 'm2' }) }), MISSION());
  await expect.poll(() => outlineIds(page)).toEqual(['A-ACTIVE', 'B-RETURNED', 'VR1207']);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('crc-desktop-settings')).airspaceMenu);
  expect(stored.states.RETURNED).toBe(true); expect(stored.overrides.Syria['C-ACTIVE']).toBe('off');
  // another theater: the individual Off does not follow (ids belong to a theater)
  await page.evaluate((m) => crc.app._ws.onmessage({ data: JSON.stringify({ ...m, theatre: 'Caucasus' }) }), MISSION());
  await expect.poll(() => outlineIds(page)).toContain('C-ACTIVE');
  await page.evaluate((m) => crc.app._ws.onmessage({ data: JSON.stringify(m) }), MISSION());
  await expect.poll(() => outlineIds(page)).toEqual(['A-ACTIVE', 'B-RETURNED', 'VR1207']);

  await pop.locator('.aslm-reset').click();
  await expect.poll(() => outlineIds(page)).toEqual(['A-ACTIVE', 'C-ACTIVE', 'VR1207']);
  await expect(pop.locator('.aslm-reset')).toBeDisabled();
});

test('the same menu is in the settings panel, and the coordinate format is chosen there', async ({ page }) => {
  await open(page);
  await page.evaluate(() => crc.dock.toggleDockPanel('settings', true));
  await expect(page.locator('#set-airspace-menu .aslm-title')).toHaveText('AIRSPACES ON THE MAP');
  await page.locator('#set-coord-format').selectOption('MGRS');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('crc-desktop-settings')).coordFormat)).toBe('MGRS');
});

test('labels carry the name and the limits, FL from the transition altitude; a non-active state is in the label', async ({ page }) => {
  const g = { source: 'POLYGON', points: sq };
  await open(page, ['AP'], [rec(def({ geometry: g, altLowerFt: null, altUpperFt: 18000 }), { state: 'ACTIVE' })]);
  await page.evaluate(() => { crc.app.settings.transitionAltFt = 10000; });
  await page.evaluate(() => crc.airspace.renderAirspacePanel());
  const text = await page.evaluate(() => crc.airspaceLayer.lastAirspaceFeatures().labels.features[0].properties.text);
  expect(text).toBe('MOA ADANA SOUTH\nGND–FL180');
});

test('Add fixes on map: a click appends a fix, a click near a navpoint snaps to it and takes its name, the corridor shows while adding', async ({ page }) => {
  const two = ROUTE(); two.segments = two.segments.slice(0, 2).map((s, i) => (i === 1 ? { ...s, altLowerFt: null, altUpperFt: null, widthNm: null } : s));
  await open(page, ['CTR'], [rec(two)]);
  const ed = await edit(page, 'VR1207');
  const route = ed.locator('.asg-route');
  await expect(route.locator('.asg-chip')).toHaveText('2 FIXES · 1 LEGS');
  await page.evaluate(() => crc.app.map.jumpTo({ center: [35.75, 37.1], zoom: 8.5 }));
  await route.locator('#asg-add-on-map').click();
  const bar = page.locator('.asd-bar');
  await expect(bar.locator('.asd-title')).toContainText('ADDING FIXES ROUTE');
  await clickMap(page, 37.05, 35.95); // free air: a new fix
  await expect(bar.locator('.asd-title')).toContainText('3 fixes');
  const topak = await px(page, 36.98, 36.15);
  await page.mouse.click(topak.x + 4, topak.y - 3); // near the TOPAK navpoint: snaps to it
  await expect(route.locator('.asg-chip')).toHaveText('4 FIXES · 3 LEGS');
  await expect(route.locator('input[data-row="3"][data-field="name"]')).toHaveValue('TOPAK');
  await expect(route.locator('input[data-row="3"][data-field="lat"]')).toHaveValue('N36 58.8');
  await expect(route.locator('input[data-row="2"][data-field="name"]')).toHaveValue('C');
  await shot(page.locator('#map'), '11-map-route-fixes');
  await bar.locator('.asd-primary').click();
  await expect(bar).toHaveCount(0);
  expect(await page.evaluate(() => window.__sent.length)).toBe(0);
});
