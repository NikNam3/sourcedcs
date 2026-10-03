'use strict';

/* GCLC (crc-sync docs/adr/0105, H104): a tower controller takes ground by combining. LC with GC shows the COMBINED line
 * with both frequencies, the Position tabs carry their frequencies, and a sign-off of GC offers GC to LC's Primary. */

const { test, expect } = require('./helpers/test');
const { openPanel } = require('./helpers/app');

test.describe.configure({ timeout: 60000 });

test('LC with GC: the COMBINED line names both frequencies and the tabs carry theirs', async ({ page }) => {
  await openPanel(page, { signedOn: ['LC', 'GC'] });
  const line = page.locator('#efsp-combination .efsp-combination-line');
  await expect(line).toContainText('COMBINED LC + GC');
  await expect(line).toContainText('LC TWR 251.0');
  await expect(line).toContainText('GC GND 275.8');
  await expect(page.locator('.efsp-position-tab[data-position-id="GC"] .efsp-tab-freq')).toHaveText('GND 275.8');
  await expect(page.locator('.efsp-position-tab[data-position-id="LC"]')).toHaveClass(/efsp-position-tab-combined/);
  await page.screenshot({ path: 'test-results/gclc-combined-line.png' });
});

test('LC alone has no COMBINED line; an offer to take GC signs the controller on to GC', async ({ page }) => {
  await openPanel(page, { signedOn: ['LC'] });
  await expect(page.locator('#efsp-combination .efsp-combination-line')).toHaveCount(0);
  await page.evaluate(() => import('/js/panels/efsp/efsp-message-registry.js').then(r => r.dispatchEfspMessage({
    version: 1, type: 'efsp-position-offer', facilityId: 'INCIRLIK', positionId: 'LC', offer: 'GC', count: 3,
  })));
  const offer = page.locator('#efsp-combination .efsp-position-offer');
  await expect(offer).toContainText('GC is unstaffed with 3 Strips. Take GC as well?');
  await page.screenshot({ path: 'test-results/gclc-offer.png' });
  await offer.locator('.efsp-offer-take').click();
  await expect(page.locator('#efsp-combination .efsp-combination-line')).toContainText('COMBINED LC + GC');
  await expect(offer).toHaveCount(0);
});
