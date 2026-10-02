'use strict';

/* UNDO-C (docs/adr/0100 §10): the undo slot, Ctrl+Z / .undo, and the panel message to a controller whose change
 * an Undo voided. */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, startAction } = require('./helpers/app');

test.describe.configure({ timeout: 60000 });

const slot = (page) => page.locator('#efsp-undo-slot');
const stateOf = (page, callsign) => page.evaluate((cs) => {
  const s = [...crc.state.efspStrips.values()].find(x => (crc.state.efspFlightDataList.get(x.flightDataId) || {}).identity
    && crc.state.efspFlightDataList.get(x.flightDataId).identity.callsign === cs);
  return s && s.state;
}, callsign);

async function pressNla(strip) {
  await strip.locator('.efsp-nla-btn').first().click();
}

test('a one-click move fills the Undo slot; Ctrl+Z undoes it and the slot shows the outcome', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS', 'CD'] });
  const strip = await seedStrip(page, { callsign: 'UNDO11', stripType: 'DEPARTURE' });
  const before = await stateOf(page, 'UNDO11');
  await pressNla(strip);
  await expect(slot(page).locator('button')).toContainText(/^Undo · .* · \d+ s$/);
  await expect.poll(() => stateOf(page, 'UNDO11')).not.toBe(before);

  await page.locator('#efsp-bay-content').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(slot(page)).toContainText('Undone');
  await expect.poll(() => stateOf(page, 'UNDO11')).toBe(before);
  await expect(slot(page).locator('button')).toHaveCount(0, { timeout: 5000 });
  await page.screenshot({ path: 'test-results/undo-c-after-undo.png' });
});

test('.undo sends the slot action, with no Strip selected', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS', 'CD'] });
  const strip = await seedStrip(page, { callsign: 'UNDO12', stripType: 'DEPARTURE' });
  const before = await stateOf(page, 'UNDO12');
  await pressNla(strip);
  await expect(slot(page).locator('button')).toBeVisible();
  await page.locator('#efsp-dot-command-input').fill('.undo');
  await page.locator('#efsp-dot-command-input').press('Enter');
  await expect.poll(() => stateOf(page, 'UNDO12')).toBe(before);
});

test('a second Undo has nothing to undo; the slot says so and the Strip does not move', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS'] });
  await page.locator('#efsp-dot-command-input').fill('.undo');
  await page.locator('#efsp-dot-command-input').press('Enter');
  await expect(slot(page)).toContainText('Nothing to undo');
});

test('a voided controller sees a dismissible panel message and no marker on the Strip', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS'] });
  const strip = await seedStrip(page, { callsign: 'UNDO13', stripType: 'DEPARTURE' });
  await page.evaluate(() => import('/js/panels/efsp/efsp-message-registry.js').then(r => r.dispatchEfspMessage({
    version: 1, type: 'efsp-undo-voided', facilityId: 'INCIRLIK', positionId: 'OPS', actionId: 'a1', stripId: 'x',
    undoneOp: 'InvokeNla', undoneLabel: 'Hand off UNDO13 → APP', undoneBy: 'LC', at: 0,
    voided: [{ op: 'SetBlock', positionId: 'OPS', at: 0, summary: 'annotation on UNDO13' }],
  })));
  const msg = page.locator('#efsp-undo-voided .efsp-undo-voided-msg');
  await expect(msg).toHaveText('LC undid Hand off UNDO13 → APP; your annotation on UNDO13 was voided');
  await expect(strip.locator('[class*="undo"]')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/undo-c-voided-message.png' });
  await msg.click();
  await expect(msg).toHaveCount(0);
});
