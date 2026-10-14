'use strict';

/* The airspaces panel's JURISDICTION section (crc-sync docs/adr/0125) against the REAL crc-sync: the shipped Syria areas
 * (the LTAG control zone, the Incirlik RAPCON, the CVN-72 carrier area) are listed; AP edits RAPCON's ceiling and the server
 * acks it; a Position without the right has no Edit and is refused by the server when it sends one anyway. The overlap
 * refusal: the shipped areas cannot be made to overlap from the panel (RAPCON excludes the control zone, the carrier may
 * overlap anything, and no Position creates a jurisdiction area), so that test injects crc-sync's refusal into the form's own
 * ack path; crc-sync's half is tests/airspace-jurisdiction.test.mjs ("an edit that makes two static areas share volume").
 * Run on E2E_LANE=8.
 */

const { test, expect } = require('./helpers/test');
const { openPanel } = require('./helpers/app');
const { startFakeDcs, fakeDcsPort } = require('./helpers/fake-dcs');

test.describe.configure({ timeout: 90000 });

const LANE = Number(process.env.E2E_LANE || 0);
let fake;
test.beforeAll(async () => { fake = await startFakeDcs(fakeDcsPort(3010 + LANE)); });
test.afterAll(async () => { if (fake) await fake.stop(); });

async function open(page, { signedOn, facilityId = 'INCIRLIK', controller = 'e2e-jurisdiction' }) {
  const errors = (await openPanel(page, { signedOn, facilityId, controller })).consoleErrors;
  await page.evaluate(() => { if (!crc.dock.isDockPanelOpen('airspace')) crc.dock.toggleDockPanel('airspace', true); });
  await expect(page.locator('#airspace-panel')).toBeVisible({ timeout: 10000 });
  await page.evaluate(() => {
    window.__acks = [];
    crc.app._ws.addEventListener('message', (ev) => {
      try { const m = JSON.parse(ev.data); if (m.type === 'efsp-airspace-ack') window.__acks.push(m); } catch (_) { /* not JSON */ }
    });
  });
  await expect.poll(() => page.evaluate(() => crc.airspaceLayer.currentTheater()), { timeout: 20000 }).toBe('Syria');
  return errors;
}
const area = (page, id) => page.locator(`.jurisdiction-card[data-jurisdiction-id="${id}"]`);
const lastAck = (page) => page.evaluate(() => window.__acks[window.__acks.length - 1] || null);
const record = (page, id) => page.evaluate((i) => crc.state.getEfspAirspace(i), id);

test('the panel lists the tower, RAPCON and carrier areas in their own section, not as airspace cards', async ({ page }) => {
  const errors = await open(page, { signedOn: ['AP'] });
  const section = page.locator('[data-testid="jurisdiction-section"]');
  await expect(section).toBeVisible();
  await expect(section.locator('.airspace-group')).toHaveText('JURISDICTION · 3');
  await expect(area(page, 'LTAG-CZ').locator('.airspace-name')).toHaveText('LTAG CTR (control zone)');
  await expect(area(page, 'LTAG-CZ')).toContainText('Class D');
  await expect(area(page, 'LTAG-CZ')).toContainText('INCIRLIK · LC, GC');
  await expect(area(page, 'LTAG-CZ')).toContainText('SFC–3000');
  await expect(area(page, 'LTAG-RAPCON')).toContainText('AP, PAR');
  await expect(area(page, 'LTAG-RAPCON')).toContainText('Excludes LTAG-CZ');
  await expect(area(page, 'CVN-72-CCA')).toContainText('on the hull CVN-72 (follows the ship)');
  await expect(page.locator('.airspace-card[data-airspace-id="LTAG-RAPCON"]'), 'not an ordinary card').toHaveCount(0);
  expect(errors.filter(e => !/MapTiler|403|tile|glyph|Failed to load resource/i.test(e))).toEqual([]);
});

test('AP edits RAPCON\'s ceiling: crc-sync acks it and the registry holds the new limit', async ({ page }) => {
  await open(page, { signedOn: ['AP'] });
  const before = await record(page, 'LTAG-RAPCON');
  expect(before.definition.altUpperFt).toBe(28000);
  await area(page, 'LTAG-RAPCON').locator('.jurisdiction-edit-btn').click();
  const form = area(page, 'LTAG-RAPCON').locator('.jurisdiction-editor');
  await expect(form).toBeVisible();
  await expect(form).toContainText('Editing as AP');
  await form.locator('[data-field="altUpperFt"]').fill('FL270');
  await expect(form.locator('.airspace-editor-status')).toContainText('1 field changed');
  await form.locator('.airspace-save-btn').click();
  await expect.poll(() => lastAck(page).then(a => a && a.ok)).toBe(true);
  await expect(form).toHaveCount(0);
  await expect.poll(() => record(page, 'LTAG-RAPCON').then(r => r.definition.altUpperFt)).toBe(27000);
  expect((await record(page, 'LTAG-RAPCON')).defRev).toBe(before.defRev + 1);
  await expect(area(page, 'LTAG-RAPCON')).toContainText('SFC–FL270');
});

test('a Position without the right has no Edit, and crc-sync refuses the edit when sent anyway', async ({ page }) => {
  await open(page, { signedOn: ['LC'] });
  // LC edits its own control zone, not RAPCON (AP's) nor the carrier area.
  await expect(area(page, 'LTAG-CZ').locator('.jurisdiction-edit-btn')).toBeEnabled();
  await expect(area(page, 'LTAG-RAPCON').locator('.jurisdiction-edit-btn')).toBeDisabled();
  await expect(area(page, 'LTAG-RAPCON')).toContainText('Edited by AP');
  await expect(area(page, 'CVN-72-CCA').locator('.jurisdiction-edit-btn')).toBeDisabled();
  const r = await record(page, 'LTAG-RAPCON');
  await page.evaluate(([rev, defRev]) => crc.ws.sendEfspAirspaceMutation('LC', 'LTAG-RAPCON', rev, { kind: 'EditAirspace', patch: { altUpperFt: 20000 } }, { baseDefRev: defRev }), [r.rev, r.defRev]);
  await expect.poll(() => lastAck(page).then(a => a && a.ok === false && a.reason)).toBe('PERMISSION_DENIED');
  expect((await record(page, 'LTAG-RAPCON')).definition.altUpperFt).toBe(r.definition.altUpperFt);
});

test('an edit crc-sync refuses for overlap shows its reason in the form and keeps it open', async ({ page }) => {
  await open(page, { signedOn: ['AP'] });
  // The sender is replaced for this one send: the form's ack path gets crc-sync's overlap refusal (see the file comment).
  await page.evaluate(() => {
    crc.ws.setEfspSender('sendEfspAirspaceMutation', (positionId, airspaceId, baseRev, op, extra, { onAck } = {}) => {
      setTimeout(() => onAck({ type: 'efsp-airspace-ack', ok: false, reason: 'VALIDATION_ERROR',
        detail: 'LTAG-RAPCON and ZZ-TEST share airspace: two jurisdiction areas may not overlap (only a carrier area may)' }), 0);
      return 'stub-1';
    });
  });
  await area(page, 'LTAG-RAPCON').locator('.jurisdiction-edit-btn').click();
  const form = area(page, 'LTAG-RAPCON').locator('.jurisdiction-editor');
  await form.locator('[data-field="radiusNm"]').fill('80');
  await form.locator('.airspace-save-btn').click();
  await expect(form.locator('.airspace-editor-status')).toHaveText(/LTAG-RAPCON and ZZ-TEST share airspace/);
  await expect(form.locator('.airspace-editor-status')).toHaveClass(/airspace-status-bad/);
  await expect(form).toBeVisible();
});

test('the map draws a jurisdiction area as a thin grey outline once its kind is on (off by default)', async ({ page }) => {
  await open(page, { signedOn: ['AP'] });
  await page.waitForFunction(() => crc.mapHandle.mapReady === true, null, { timeout: 20000 });
  const ids = () => page.evaluate(() => crc.airspaceLayer.lastAirspaceFeatures().outlines.features.filter(f => f.properties.jurisdiction).map(f => f.properties.id));
  await page.evaluate(() => crc.airspaceLayer.refreshAirspaceLayers());
  expect(await ids()).toEqual([]);
  await page.evaluate(() => { const m = crc.airspaceLayer.currentMenu(); m.kinds.JURISDICTION = true; crc.airspaceLayer.applyMenu(m); });
  // The carrier circle is not drawn: the fake DCS has no ship, so the hull is not found.
  await expect.poll(async () => (await ids()).sort()).toEqual(['LTAG-CZ', 'LTAG-RAPCON']);
  const props = await page.evaluate(() => crc.airspaceLayer.lastAirspaceFeatures().outlines.features.find(f => f.properties.id === 'LTAG-CZ').properties);
  expect(props).toMatchObject({ thin: true, dashed: false });
});
