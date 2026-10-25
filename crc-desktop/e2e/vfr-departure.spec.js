'use strict';

/* U-VFR-MTMA (crc-sync docs/adr/0143, H166): the VFR departure at CD. The toolbar's VFR… form makes, in one action, the
 * flight data (callsign, type, direction of flight, runway), a discrete code and a DEPARTURE Strip in CD's Cleared Bay,
 * and shows the code to read out; DIR (Block 9K) is on the Strip's face. `.vfr` is the keyboard path; Undo takes it back.
 * Callsigns are unique per test: the Board lives for the whole run. */

const { test, expect } = require('./helpers/test');
const { openPanel, stripByCallsign } = require('./helpers/app');

test.describe.configure({ timeout: 60000 });
test.use({ viewport: { width: 1500, height: 1000 } });

let seq = 0;
const uniqueCallsign = (prefix) => `${prefix}${(Date.now() + seq++) % 10000}`;

const recordFor = (page, callsign) => page.evaluate((cs) => {
  const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === cs);
  if (!s) return null;
  const fd = crc.state.getEfspFlightData(s.flightDataId);
  return { stripType: s.stripType, state: s.state, bayId: s.bayId, owner: s.ownerPositionId, code: fd.identity.beaconAssigned,
    dir: fd.filed.directionOfFlight, route: fd.filed.route, alt: fd.filed.requestedAltitude };
}, callsign);

async function goBay(page, positionId, bayId) {
  await page.locator(`#efsp-position-tabs .efsp-position-tab[data-position-id="${positionId}"]`).click();
  await page.locator(`#efsp-bay-tabs .efsp-bay-tab[data-bay-id="${bayId}"]`).click();
}

test('CD makes a VFR departure from the toolbar: a code to read out, a DEPARTURE Strip in Cleared with its direction', async ({ page }) => {
  await openPanel(page, { signedOn: ['CD'], controller: 'vfr-dep-1' });
  const callsign = uniqueCallsign('VD');
  const btn = page.locator('#efsp-vfr-departure-btn');
  await expect(btn).toBeVisible();
  await btn.click();
  const form = page.locator('[data-testid="vfr-departure-form"]');
  await expect(form).toBeVisible();
  await form.locator('[data-field="callsign"]').fill(callsign);
  await form.locator('[data-field="aircraftData"]').fill('2/F16');
  await form.locator('[data-field="direction"]').selectOption('NW');
  await form.locator('.efsp-vfr-create-btn').click();
  await expect.poll(() => recordFor(page, callsign)).not.toBe(null);
  const r = await recordFor(page, callsign);
  expect(r).toMatchObject({ stripType: 'DEPARTURE', state: 'CLEARED', bayId: 'cd-cleared', owner: 'CD', dir: 'NW', route: '', alt: '' });
  await expect(form.locator('.efsp-vfr-msg')).toHaveText(`${callsign}, squawk ${r.code}, maintain VFR`);
  await goBay(page, 'CD', 'cd-cleared');
  const strip = stripByCallsign(page, callsign);
  const dirChip = strip.locator('.efsp-block-chip', { has: page.locator('.efsp-block-label', { hasText: /^DIR$/ }) });
  await expect(dirChip).toContainText('NW');
  await page.screenshot({ path: test.info().outputPath('01-vfr-departure.png') });

  // A refusal is shown in the form, in the error colour.
  await form.locator('[data-field="callsign"]').fill(uniqueCallsign('VE'));
  await form.locator('[data-field="aircraftData"]').fill('F16');
  await form.locator('[data-field="direction"]').selectOption('N');
  await form.locator('[data-field="runway"]').fill('17');
  await form.locator('.efsp-vfr-create-btn').click();
  await expect(form.locator('.efsp-vfr-msg')).toContainText('runway 17 is not a runway of this airfield');
  await expect(form.locator('.efsp-vfr-msg')).toHaveClass(/efsp-msg-error/);
});

test('.vfr makes one from the keyboard, and Undo takes it back', async ({ page }) => {
  await openPanel(page, { signedOn: ['CD'], controller: 'vfr-dep-2' });
  const callsign = uniqueCallsign('VK');
  const input = page.locator('#efsp-dot-command-input');
  await input.fill(`.vfr ${callsign} C172 se 23`);
  await input.press('Enter');
  await expect.poll(() => recordFor(page, callsign)).not.toBe(null);
  expect(await recordFor(page, callsign)).toMatchObject({ state: 'CLEARED', dir: 'SE' });
  await input.fill('.undo');
  await input.press('Enter');
  await expect.poll(() => recordFor(page, callsign)).toBe(null);
});

test('the VFR… button is only at a Position that makes VFR departures', async ({ page }) => {
  await openPanel(page, { signedOn: ['GC'], controller: 'vfr-dep-3' });
  await expect(page.locator('#efsp-vfr-departure-btn')).toBeHidden();
});
