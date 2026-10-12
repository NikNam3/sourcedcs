'use strict';

/* The AIRSPACE panel against the REAL crc-sync: create, edit, geometry and delete each travel the wire and are answered by
 * the server's own `efsp-airspace-ack` and `efsp-airspace-delta`. airspace-panel.spec.js and airspace-geometry.spec.js stub the
 * sender and inject the acks, so they prove the panel and nothing about whether crc-sync agrees; this file is the round trip.
 *
 * crc-sync scopes the registry to the loaded mission's theater and the rig has no DCS, so this file starts helpers/fake-dcs.js
 * (GetTheatre "Syria" and one airdrome, nothing else) for crc-sync to load a mission from. Every assertion is on what the server
 * said: the ack frames the page received, and a SECOND controller's page, which learns the registry from its own snapshot and
 * deltas and never saw the first page's state. The one injected frame is the mission's drawings (the `init` frame), because the
 * fake serves none; the geometry's points and drawingRef are what the panel builds from it, and the server is what accepts them.
 * Run on E2E_LANE=2.
 */

const { test, expect } = require('./helpers/test');
const { openPanel } = require('./helpers/app');
const { startFakeDcs, fakeDcsPort } = require('./helpers/fake-dcs');

test.describe.configure({ timeout: 90000 });

const LANE = Number(process.env.E2E_LANE || 0);
let fake;
test.beforeAll(async () => { fake = await startFakeDcs(fakeDcsPort(3010 + LANE)); });
test.afterAll(async () => { if (fake) await fake.stop(); });

const _contexts = [];
test.afterEach(async () => { while (_contexts.length) await _contexts.pop().close().catch(() => {}); });

const sq = [[36.2, 35.2], [36.2, 35.8], [36.7, 35.8], [36.7, 35.2]];
const MISSION = () => ({
  type: 'init', version: 1, missionId: 'm-srv', bullseye: {}, airports: [], theatre: 'Syria', waypoints: [],
  drawings: [{ primitiveType: 'Polygon', polygonMode: 'free', closed: true, name: 'ADANA SOUTH MOA', layerName: 'Common', points: sq.map(([lat, lon]) => ({ lat, lon })) }],
});

async function open(page, { controller, withMap = false, signedOn = ['AP'], also = null } = {}) {
  const errors = (await openPanel(page, { signedOn, facilityId: 'INCIRLIK', controller })).consoleErrors;
  if (also) { // a second Facility at once (T27: OPS at INCIRLIK and CTR at CENTER), acked by the server like the first
    await page.evaluate(([f, h]) => crc.ws.sendEfspSetPositions(f, h), [also.facilityId, also.signedOn]);
    await page.waitForFunction(([f, h]) => { const a = crc.ws.getAckedPositions(f); return h.every(p => a.includes(p)); }, [also.facilityId, also.signedOn]);
  }
  await page.evaluate(() => { if (!crc.dock.isDockPanelOpen('airspace')) crc.dock.toggleDockPanel('airspace', true); });
  await expect(page.locator('#airspace-panel')).toBeVisible({ timeout: 10000 });
  await page.evaluate(() => {
    window.__acks = [];
    crc.app._ws.addEventListener('message', (ev) => {
      try { const m = JSON.parse(ev.data); if (m.type === 'efsp-airspace-ack') window.__acks.push(m); } catch (_) { /* not JSON */ }
    });
  });
  // crc-sync has loaded the fake mission once the page has been sent its theatre (the `init` frame); only then does the registry have a theater.
  await expect.poll(() => page.evaluate(() => crc.airspaceLayer.currentTheater()), { timeout: 20000 }).toBe('Syria');
  if (withMap) {
    await page.waitForFunction(() => crc.mapHandle.mapReady === true, null, { timeout: 20000 });
    await page.evaluate((m) => crc.app._ws.onmessage({ data: JSON.stringify(m) }), MISSION());
  }
  return errors;
}
async function second(browser) {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1600, height: 1000 } });
  _contexts.push(ctx);
  const page = await ctx.newPage();
  await open(page, { controller: 'e2e-observer' });
  return page;
}
const serverRecord = (page, id) => page.evaluate((i) => crc.state.getEfspAirspace(i), id);
const lastAck = (page) => page.evaluate(() => window.__acks[window.__acks.length - 1] || null);
const card = (page, id) => page.locator(`.airspace-card[data-airspace-id="${id}"]`);
const fld = (ed, label) => ed.locator('.airspace-field').filter({ has: ed.page().locator('.airspace-field-label', { hasText: label }) });
async function menuAction(page, id, action) {
  await card(page, id).locator('.airspace-more-btn').click();
  await card(page, id).locator(`[data-action="${action}"]`).click();
}
async function createAirspace(page, id, name) {
  await page.locator('.airspace-new-btn').click();
  const ed = page.locator('.airspace-card-new .airspace-editor');
  await expect(ed).toBeVisible();
  await fld(ed, 'ID').first().locator('input').fill(id);
  await fld(ed, 'NAME').locator('input').fill(name);
  return ed;
}

test('create, edit and delete reach crc-sync: each is acked by the server and a second controller sees it', async ({ page, browser }) => {
  const errors = await open(page);
  const other = await second(browser);

  // create
  const ed = await createAirspace(page, 'MOA-E2E', 'MOA E2E SERVER');
  await ed.locator('.airspace-save-btn').click();
  await expect.poll(() => lastAck(page).then(a => a && a.airspaceId)).toBe('MOA-E2E');
  const created = await lastAck(page);
  expect(created).toMatchObject({ ok: true, theater: 'Syria', airspace: { airspaceId: 'MOA-E2E', defRev: 1, definition: { name: 'MOA E2E SERVER', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP' } } });
  await expect(page.locator('.airspace-card-new')).toHaveCount(0);
  await expect(card(page, 'MOA-E2E')).toBeVisible();
  await expect(card(other, 'MOA-E2E'), 'the other controller was told by the server').toBeVisible();

  // edit
  await menuAction(page, 'MOA-E2E', 'edit');
  const edit = card(page, 'MOA-E2E').locator('.airspace-editor');
  await fld(edit, 'WORK FREQ').locator('input').fill('139.100');
  await edit.locator('.airspace-save-btn').click();
  await expect.poll(() => lastAck(page).then(a => a && a.airspace && a.airspace.defRev)).toBe(2);
  expect(await lastAck(page)).toMatchObject({ ok: true, airspace: { airspaceId: 'MOA-E2E', definition: { workingFrequencyMhz: 139.1 } } });
  await expect.poll(() => serverRecord(other, 'MOA-E2E').then(r => r && r.definition.workingFrequencyMhz)).toBe(139.1);
  expect((await serverRecord(other, 'MOA-E2E')).defRev).toBe(2);

  // delete
  await menuAction(page, 'MOA-E2E', 'delete');
  await card(page, 'MOA-E2E').locator('.airspace-delete .airspace-save-btn').click();
  await expect.poll(() => lastAck(page).then(a => a && a.removed)).toBe('MOA-E2E');
  expect(await lastAck(page)).toMatchObject({ ok: true, airspace: null });
  await expect(card(page, 'MOA-E2E')).toHaveCount(0);
  await expect(card(other, 'MOA-E2E')).toHaveCount(0);
  expect(await serverRecord(other, 'MOA-E2E')).toBeNull();
  expect(errors.filter(e => !/MapTiler|403|tile|glyph|Failed to load resource/i.test(e))).toEqual([]);
});

test('a geometry picked from a DCS drawing is accepted by crc-sync and reaches the other controller', async ({ page, browser }) => {
  await open(page, { withMap: true });
  const other = await second(browser);
  const ed = await createAirspace(page, 'MOA-GEO', 'MOA GEO SERVER');
  const outline = ed.locator('.asg-area');
  await outline.locator('#asg-pick').click();
  await outline.locator('.asg-drawing', { hasText: 'ADANA SOUTH MOA' }).click();
  await expect(outline.locator('.asg-count')).toContainText('4 points');
  await ed.locator('.airspace-save-btn').click();
  await expect.poll(() => lastAck(page).then(a => a && a.airspaceId)).toBe('MOA-GEO');
  const ack = await lastAck(page);
  expect(ack.ok, `crc-sync said ${ack.reason}: ${ack.detail}`).toBe(true);
  expect(ack.airspace.definition.geometry).toMatchObject({ source: 'DCS_DRAWING', points: sq, drawingRef: { layerName: 'Common', objectName: 'ADANA SOUTH MOA' } });
  await expect.poll(() => serverRecord(other, 'MOA-GEO').then(r => r && r.definition.geometry && r.definition.geometry.points)).toEqual(sq);

  // clearing the outline is a geometry edit the server also has to accept
  await menuAction(page, 'MOA-GEO', 'edit');
  const edit = card(page, 'MOA-GEO').locator('.airspace-editor');
  await edit.locator('#asg-clear').click();
  await edit.locator('.airspace-save-btn').click();
  await expect.poll(() => lastAck(page).then(a => a && a.airspace && a.airspace.defRev)).toBe(2);
  expect((await lastAck(page)).ok).toBe(true);
  await expect.poll(() => serverRecord(other, 'MOA-GEO').then(r => r && r.definition.geometry)).toBeFalsy();
});

test('T27: OPS + CTR combined creates a CENTER MOA, sent as CTR (the draft\'s controlling Position), and crc-sync accepts it', async ({ page }) => {
  const errors = await open(page, { signedOn: ['OPS'], also: { facilityId: 'CENTER', signedOn: ['CTR'] } });
  const ed = await createAirspace(page, 'MOA-GAZIPASA', 'GAZIPASA');
  await fld(ed, 'CTRL FACILITY').locator('select.airspace-input').selectOption('CENTER');
  await expect(fld(ed, 'CTRL POSITION').locator('select.airspace-input')).toHaveValue('CTR');
  await expect(ed.locator('.airspace-editor-as-position')).toHaveText('CTR');
  await page.evaluate(() => {
    window.__sentAirspace = [];
    const orig = crc.app._ws.send.bind(crc.app._ws);
    crc.app._ws.send = (data) => { try { const m = JSON.parse(data); if (m.type === 'efsp-airspace-mutation') window.__sentAirspace.push(m); } catch (_) { /* not JSON */ } return orig(data); };
  });
  await ed.locator('.airspace-save-btn').click();
  await expect.poll(() => lastAck(page).then(a => a && a.airspaceId)).toBe('MOA-GAZIPASA');
  const ack = await lastAck(page);
  expect(ack.ok, `crc-sync said ${ack.reason}: ${ack.detail}`).toBe(true);
  expect(ack.airspace.definition).toMatchObject({ controllingFacilityId: 'CENTER', controllingPositionId: 'CTR' });
  expect((await page.evaluate(() => window.__sentAirspace)).map(m => m.actingPositionId)).toEqual(['CTR']);

  // edit and delete act as CTR too (OPS has no say over a CENTER airspace)
  await menuAction(page, 'MOA-GAZIPASA', 'edit');
  const edit = card(page, 'MOA-GAZIPASA').locator('.airspace-editor');
  await expect(edit.locator('.airspace-editor-as-position')).toHaveText('CTR');
  await fld(edit, 'WORK FREQ').locator('input').fill('139.300');
  await edit.locator('.airspace-save-btn').click();
  await expect.poll(() => lastAck(page).then(a => a && a.airspace && a.airspace.defRev)).toBe(2);
  expect((await lastAck(page)).ok).toBe(true);
  await menuAction(page, 'MOA-GAZIPASA', 'delete');
  await card(page, 'MOA-GAZIPASA').locator('.airspace-delete .airspace-save-btn').click();
  await expect.poll(() => lastAck(page).then(a => a && a.removed)).toBe('MOA-GAZIPASA');
  expect((await page.evaluate(() => window.__sentAirspace)).map(m => m.actingPositionId)).toEqual(['CTR', 'CTR', 'CTR']);
  expect(errors.filter(e => !/MapTiler|403|tile|glyph|Failed to load resource/i.test(e))).toEqual([]);
});

test('T27: a refusal names who may do it, never "OPS of CENTER"', async ({ page }) => {
  await open(page, { signedOn: ['OPS'] });
  // OPS alone may not pick CENTER in the editor (the pickers offer only what it may create), so send the create directly
  await page.evaluate(() => crc.ws.sendEfspAirspaceMutation('OPS', 'MOA-NOPE', 0,
    { kind: 'CreateAirspace', definition: { airspaceId: 'MOA-NOPE', name: 'NOPE', kind: 'AREA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR' } }));
  await expect.poll(() => lastAck(page).then(a => a && a.airspaceId)).toBe('MOA-NOPE');
  const ack = await lastAck(page);
  expect(ack).toMatchObject({ ok: false, reason: 'PERMISSION_DENIED', detail: 'OPS may not create MOA-NOPE: only CTR may' });
});

test('T28: an airspace made from a DCS drawing is drawn instead of that drawing, and the drawing returns when the airspace is not drawn', async ({ page }) => {
  await open(page, { withMap: true });
  const ed = await createAirspace(page, 'MOA-T28', 'MOA T28');
  const outline = ed.locator('.asg-area');
  await outline.locator('#asg-pick').click();
  await outline.locator('.asg-drawing', { hasText: 'ADANA SOUTH MOA' }).click();
  await ed.locator('.airspace-save-btn').click();
  await expect.poll(() => lastAck(page).then(a => a && a.airspaceId)).toBe('MOA-T28');
  expect((await lastAck(page)).ok).toBe(true);
  // the default menu draws ACTIVE airspaces only: a RETURNED one is not drawn, so its drawing stays
  expect(await page.evaluate(() => crc.airspaceLayer.hiddenDrawingIndices())).toEqual([]);
  // draw this one (a per-airspace "on" in the layer menu): its outline replaces the drawing
  await page.evaluate(() => {
    const menu = crc.airspaceLayer.currentMenu();
    const t = crc.airspaceLayer.currentTheater();
    crc.airspaceLayer.applyMenu({ ...menu, overrides: { ...(menu.overrides || {}), [t]: { ...((menu.overrides || {})[t] || {}), 'MOA-T28': 'on' } } });
  });
  await expect.poll(() => page.evaluate(() => crc.airspaceLayer.lastAirspaceFeatures().outlines.features.map(f => f.properties.id))).toContain('MOA-T28');
  expect(await page.evaluate(() => crc.airspaceLayer.hiddenDrawingIndices())).toEqual([0]);
  expect(JSON.stringify(await page.evaluate(() => crc.mapHandle.map.getFilter('drawing-lines')))).toContain('[0]');
  // switched off again: the drawing is back
  await page.evaluate(() => {
    const menu = crc.airspaceLayer.currentMenu();
    const t = crc.airspaceLayer.currentTheater();
    crc.airspaceLayer.applyMenu({ ...menu, overrides: { ...(menu.overrides || {}), [t]: { ...((menu.overrides || {})[t] || {}), 'MOA-T28': 'off' } } });
  });
  await expect.poll(() => page.evaluate(() => crc.airspaceLayer.hiddenDrawingIndices())).toEqual([]);
});
