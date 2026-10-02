'use strict';

/* Formation Split / Join (crc-sync docs/adr/0099): split a 4-ship, see two Strips; join, see one. */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, stripByCallsign, startAction, dropStrips } = require('./helpers/app');

const CALLSIGNS = ['FORMA1', 'FORMB3', 'FORMC5'];

// The Strip's own click can land on a Block (an editor), so select through the Bay view.
async function select(page, callsign) {
  await page.evaluate((cs) => {
    const s = crc.state.getAllEfspStrips().find((x) => x.state !== 'DROPPED' && crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs);
    if (crc.bayView.getSelectedEfspStripId() !== s.stripId) crc.bayView.selectEfspStripById(s.stripId);
  }, callsign);
}

test.beforeEach(async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS'] });
});

test.afterEach(async ({ page }) => {
  await dropStrips(page, CALLSIGNS);
});

test('Split… turns a 4-ship into 2+2, Join formation… turns it back into one', async ({ page }) => {
  // A DEPARTURE in PROPOSED is on the ground, so no assignment is asked for.
  const lead = await seedStrip(page, { callsign: 'FORMA1', flightData: { flightSize: 4 } });
  await startAction(lead, 'Split…');
  const form = page.locator('.efsp-formation-popover[data-formation="split"]');
  await expect(form).toBeVisible();
  await expect(form.locator('.efsp-formation-assignment')).toHaveCount(0);
  await form.locator('.efsp-formation-size').fill('2');
  await expect(form.locator('.efsp-formation-remainder')).toHaveText('of 4, 2 remain');
  await form.locator('.efsp-formation-send').click();
  await expect(form.locator('.efsp-formation-error')).toHaveText('type the departing part\'s callsign');
  await form.locator('.efsp-formation-callsign').fill('formb3');
  await form.locator('.efsp-formation-send').click();

  const part = stripByCallsign(page, 'FORMB3');
  await expect(part).toBeVisible({ timeout: 10000 });
  await expect(part.locator('.efsp-split-chip')).toHaveText('SPLIT');
  await expect(part.locator('.efsp-split-chip')).toHaveAttribute('title', /split from FORMA1 at \d{4}Z/);
  expect(await page.evaluate(() => crc.state.getAllEfspStrips().filter((s) => s.state !== 'DROPPED'
    && ['FORMA1', 'FORMB3'].includes(crc.state.getEfspFlightData(s.flightDataId).identity.callsign)).length)).toBe(2);

  // Join the part back into the lead: one click, no confirm.
  await startAction(part, 'Join formation…');
  const picker = page.locator('.efsp-formation-popover[data-formation="join"]');
  await expect(picker).toBeVisible();
  await picker.locator('.efsp-formation-lead', { hasText: 'FORMA1 (2)' }).click();
  await expect.poll(() => page.evaluate(() => crc.state.getAllEfspStrips().filter((s) => s.state !== 'DROPPED'
    && ['FORMA1', 'FORMB3'].includes(crc.state.getEfspFlightData(s.flightDataId).identity.callsign)).length)).toBe(1);
  expect(await page.evaluate(() => {
    const s = crc.state.getAllEfspStrips().find((x) => x.state !== 'DROPPED' && crc.state.getEfspFlightData(x.flightDataId).identity.callsign === 'FORMA1');
    return crc.state.getEfspFlightData(s.flightDataId).identity.flightSize;
  })).toBe(4);
});

test('.split and .join on the selected Strip', async ({ page }) => {
  const lead = await seedStrip(page, { callsign: 'FORMC5', flightData: { flightSize: 3 } });
  await select(page, 'FORMC5');
  const input = page.locator('#efsp-dot-command-input');
  await input.fill('.split 1 formb3');
  await input.press('Enter');
  const part = stripByCallsign(page, 'FORMB3');
  await expect(part).toBeVisible({ timeout: 10000 });
  await select(page, 'FORMB3');
  await input.fill('.join FORMC5');
  await input.press('Enter');
  await expect(stripByCallsign(page, 'FORMB3')).toHaveCount(0, { timeout: 10000 });
});
