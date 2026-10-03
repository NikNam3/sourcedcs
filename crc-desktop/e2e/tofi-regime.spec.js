'use strict';

/* TOFI-C (crc-sync docs/adr/0102): the separation regime picked at TOFI accept waits for the airspace. CTR (CENTER)
 * proposes TOFI ENTRY to TAC_C2 (TACTICAL); the MRU accepts with a regime, sees it pending, and marks Entered by hand
 * (the flight is not inside any active airspace here, so the warning shows). Run on E2E_LANE=5. */

const path = require('path');
const fs = require('fs');
const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, startAction } = require('./helpers/app');

test.describe.configure({ timeout: 60000 });

const SHOTS = path.join(__dirname, '..', '..', 'docs', 'wip', 'TOFI-C');
fs.mkdirSync(SHOTS, { recursive: true });
const _contexts = [];
test.afterEach(async () => { while (_contexts.length) await _contexts.pop().close().catch(() => {}); });

async function controller(browser, opts) {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1600, height: 1000 } });
  _contexts.push(ctx);
  const page = await ctx.newPage();
  await openPanel(page, opts);
  return page;
}
const ctr = (b) => controller(b, { signedOn: ['CTR'], facilityId: 'CENTER', controller: 'ctr-controller' });
const tacC2 = (b) => controller(b, { signedOn: ['TAC_C2'], facilityId: 'TACTICAL', controller: 'tac-c2-controller' });
const strip = (page, callsign) => page.locator('.efsp-strip', { has: page.getByText(callsign, { exact: true }) }).first();
const goBay = async (page, positionId, bayId) => {
  await page.locator(`#efsp-position-tabs .efsp-position-tab[data-position-id="${positionId}"]`).click();
  await page.locator(`#efsp-bay-tabs .efsp-bay-tab[data-bay-id="${bayId}"]`).click();
};
const regimeOf = (page, cs) => page.evaluate((c) => {
  const f = [...crc.state.efspFlightDataList.values()].find(x => x.identity && x.identity.callsign === c);
  return f && f.tofi ? { effective: f.tofi.separationRegime, pending: f.tofi.pendingSeparationRegime || null } : null;
}, cs);

test('a regime picked at accept waits; Entered makes it effective and warns outside an airspace', async ({ browser }) => {
  const a = await ctr(browser);
  const b = await tacC2(browser);
  const s = await seedStrip(a, { callsign: 'TOFIC1', actingPositionId: 'CTR', bayId: 'ctr-enroute', stripType: 'ARRIVAL', facilityId: 'CENTER' });
  await startAction(s, 'TOFI…');
  const popover = a.locator('.efsp-tofi-popover');
  await popover.getByTestId('tofi-counterpart').selectOption({ label: 'TAC_C2 (TACTICAL)' });
  await popover.getByRole('button', { name: 'Send TOFI' }).dispatchEvent('click');

  await goBay(b, 'TAC_C2', 'tac-c2-coordination');
  const mission = strip(b, 'TOFIC1');
  await mission.locator('select.efsp-tofi-regime-select').selectOption('USING_AGENCY');
  await mission.getByRole('button', { name: 'Accept TOFI Entry' }).click({ timeout: 5000 });

  await expect.poll(() => regimeOf(b, 'TOFIC1')).toEqual({ effective: 'ATC', pending: 'USING_AGENCY' });
  await expect.poll(() => regimeOf(a, 'TOFIC1')).toEqual({ effective: 'ATC', pending: 'USING_AGENCY' });
  await goBay(b, 'TAC_C2', 'tac-c2-tasked');
  await expect(mission.locator('.efsp-x-regime-pending')).toContainText('USING_AGENCY');
  await expect(s.locator('.efsp-sreg-pending'), 'CTR sees what is waiting beside SEP REG').toContainText('USING_AGENCY');

  await mission.getByRole('button', { name: 'Transfer Comms' }).click({ timeout: 5000 });
  await mission.getByRole('button', { name: 'Entered' }).click({ timeout: 5000 });
  await expect(b.locator('#efsp-mutation-warning')).toContainText('not inside an airspace');
  await expect.poll(() => regimeOf(b, 'TOFIC1')).toEqual({ effective: 'USING_AGENCY', pending: null });
  await expect(mission.getByRole('button', { name: 'Entered' })).toHaveCount(0);
  await expect(s.locator('.efsp-sreg-pending')).toHaveCount(0);
  await b.screenshot({ path: path.join(SHOTS, 'tofi-c.png') });
});
