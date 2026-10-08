'use strict';

/* SETTINGS-TABS: the Settings panel has one tab per panel; a panel registers its own through settings-registry.js.
   Opens every built-in tab, then registers one and checks it appears, edits and persists. Run on E2E_LANE=3. */

const { test, expect } = require('./helpers/test');
const { openPanel } = require('./helpers/app');

test('every Settings tab opens; a registered tab appears, edits and persists', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS'] });
  await page.evaluate(() => crc.dock.toggleDockPanel('settings', true));
  const panel = page.locator('#settings-panel');
  await expect(panel).toBeVisible();

  for (const pane of ['general', 'colors', 'radar', 'srs', 'tools']) {
    await panel.locator(`.stab[data-pane="${pane}"]`).click();
    await expect(panel.locator(`#stab-${pane}`)).toBeVisible();
    await expect(panel.locator('.stab-pane:visible')).toHaveCount(1);
  }

  await page.evaluate(() => crc.settingsRegistry.registerSettingsTab('spec', [
    { key: 'specAuto', type: 'toggle', label: 'Autoscale', default: true },
    { key: 'specGpa', type: 'number', label: 'Glideslope', unit: '°', default: 3.06, min: 2, max: 4, step: 0.01 },
  ], { label: 'Spec' }));
  const tab = panel.locator('.stab[data-pane="spec"]');
  await expect(tab).toHaveText('SPEC');
  await tab.click();
  await expect(panel.locator('#stab-spec')).toBeVisible();
  await expect(panel.locator('#set-specGpa')).toHaveValue('3.06');

  await panel.locator('#set-specGpa').fill('3.5');
  await panel.locator('#set-specGpa').blur();
  await panel.locator('#set-specAuto').evaluate(el => el.click());
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('crc-desktop-settings')));
  expect(saved.specGpa).toBe(3.5);
  expect(saved.specAuto).toBe(false);

  await panel.locator('.stab[data-pane="general"]').click();
  await expect(panel.locator('#stab-spec')).toBeHidden();
});
