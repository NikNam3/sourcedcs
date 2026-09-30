'use strict';

/* L12 — hung ordnance on the Strip (guide §9.5, crc-sync's docs/adr/0069),
 * in a real browser against a real crc-sync. Screenshots go to docs/wip/L12/
 * and are described in docs/wip/L12.md.
 *
 * Client field state (getEfspFieldState) is L1b's, built in the same wave.
 * The first test runs without it — what ships if L12 merges first: the chip
 * and the generic sentence. The pilot walks install a stand-in with L1b's
 * contract (the record crc-sync's getFieldState puts on the wire), so the
 * full sentence can be seen; that stand-in is the only thing faked.
 */

const path = require('path');
const fs = require('fs');
const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, stripByCallsign } = require('./helpers/app');

test.describe.configure({ timeout: 120000 });

const SHOTS = path.join(__dirname, '..', '..', 'docs', 'wip', 'L12');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, name);

const GENERIC = 'Hung ordnance. The hot cargo pad is shown when field state is available.';

async function goBay(page, positionId, bayId) {
  await page.locator(`#efsp-position-tabs .efsp-position-tab[data-position-id="${positionId}"]`).click();
  await page.locator(`#efsp-bay-tabs .efsp-bay-tab[data-bay-id="${bayId}"]`).click();
}

const stateOf = (page, cs) => page.evaluate((cs) => {
  const s = getAllEfspStrips().find((x) => getEfspFdr(x.fdrId).identity.callsign === cs);
  return s && s.state;
}, cs);
const ordnanceOf = (page, cs) => page.evaluate((cs) => {
  const s = getAllEfspStrips().find((x) => getEfspFdr(x.fdrId).identity.callsign === cs);
  return s && getEfspFdr(s.fdrId).military.ordnanceState;
}, cs);

/** Press the Strip's own NLA button, then wait out the server's double-tap guard. */
async function pressNla(page, strip, cs, expected) {
  const btn = strip.locator('.efsp-nla-btn');
  await expect(btn, `the NLA button toward ${expected} is enabled`).toBeEnabled();
  await btn.click();
  await expect.poll(() => stateOf(page, cs), { timeout: 3000 }).toBe(expected);
  await page.waitForTimeout(450);
}

/** Show only this Strip, so a screenshot describes one thing. */
async function only(page, cs) {
  await page.evaluate((cs) => {
    for (const s of document.querySelectorAll('.efsp-strip')) s.style.display = s.textContent.includes(cs) ? '' : 'none';
  }, cs);
}

async function setOrdnance(strip, value) {
  await strip.locator('.efsp-block-3G').first().click();
  await strip.locator('select.efsp-block-enum-select').selectOption(value);
}

/** Open ▼, pick a value in the expanded ORDNANCE row, close ▼ again. */
async function recordFromExpanded(strip, value) {
  await strip.locator('.efsp-expand-btn').click();
  await setOrdnance(strip.locator('[data-expanded-block="3G"]'), value);
  await expect(strip.locator('[data-slot="ord"]')).toHaveCount(value === 'HUNG' ? 1 : 0);
  await strip.locator('.efsp-expand-btn').click();
}

/** L1b's contract, stood in: the INCIRLIK record as crc-sync's getFieldState shapes it. */
async function standInFieldState(page) {
  await page.evaluate(() => {
    const record = {
      facilityId: 'INCIRLIK', activeRunway: '05',
      runways: [{ runwayId: '05/23', ends: ['05', '23'], rackIds: { '05': 'rwy-05', '23': 'rwy-23' }, status: 'OPEN', arrestingGear: [] }],
      hotCargoPad: { name: 'Hot cargo pad', occupied: false, occupantFdrId: null },
      alertPad: { name: 'Alert pad', occupied: false, occupantFdrId: null },
    };
    window.getEfspFieldState = (id) => (id === 'INCIRLIK' ? record : null);
    renderAllOpenEfspBays();
  });
}

// The hermetic rig answers map/terrain fetches with 503s (no network, no DCS);
// those are the rig's, not this feature's. Script errors stay a hard failure.
const scriptErrors = (errors) => errors.filter((e) => !/Failed to load resource/.test(e));

const ARR_FDR = { originAirport: 'LTAG', destinationAirport: 'LTAG', route: 'DCT' };

test('HUNG: APP records it, TWR sees it, the flight lands normally, CLEAN clears it', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1200 });
  const { consoleErrors } = await openPanel(page, { held: ['TWR', 'APP', 'GND'] });
  const CS = 'HUNG11';

  await goBay(page, 'APP', 'app-inbound');
  const strip = await seedStrip(page, { callsign: CS, actingPositionId: 'APP', bayId: 'app-inbound', role: 'ARRIVAL', fdr: ARR_FDR });
  await expect(strip.locator('[data-slot="ord"]'), 'a CLEAN Strip draws nothing (docs/adr/0058)').toHaveCount(0);

  // H55: the pilot reports it to approach, inbound. S-L12: while CLEAN, ORDNANCE
  // is not on APP's face — it is one tap away in the expanded view.
  await expect(strip.locator('.efsp-strip-fields .efsp-block-3G'), 'a CLEAN ORDNANCE costs APP no Strip height').toHaveCount(0);
  await only(page, CS);
  await strip.screenshot({ path: shot('02a-app-clean.png') });
  await recordFromExpanded(strip, 'HUNG');
  await expect(strip.locator('.efsp-strip-fields .efsp-block-3G'), 'once set, it is on the face').toHaveText('HUNG');
  await expect.poll(() => ordnanceOf(page, CS)).toBe('HUNG');
  const chip = strip.locator('[data-slot="ord"]');
  await expect(chip).toHaveText('HUNG');
  await expect(chip).toHaveClass(/efsp-ind-attn/);
  await expect(strip.locator('.efsp-strip-reason', { hasText: GENERIC })).toBeVisible();
  await only(page, CS);
  await strip.screenshot({ path: shot('02-app-sees-it.png') });

  // To tower: the chip travels with the flight, on TWR's Strip too.
  await pressNla(page, strip, CS, 'HANDED_TO_TOWER');
  await goBay(page, 'TWR', 'twr-arrivals');
  const twr = stripByCallsign(page, CS);
  await expect(twr.locator('[data-slot="ord"]')).toHaveText('HUNG');
  await only(page, CS);
  await twr.screenshot({ path: shot('01-hung-chip.png') });

  // Never an inhibit: FINAL, LANDED, TAXI_IN exactly as for a CLEAN flight.
  await pressNla(page, twr, CS, 'FINAL');
  await goBay(page, 'TWR', 'twr-final');
  await pressNla(page, stripByCallsign(page, CS), CS, 'LANDED');
  await goBay(page, 'TWR', 'twr-landed');
  const landed = stripByCallsign(page, CS);
  await expect(landed.locator('[data-slot="ord"]')).toHaveText('HUNG');
  await expect(landed.locator('.efsp-nla-btn')).toBeEnabled();
  await only(page, CS);
  await landed.screenshot({ path: shot('03-lands-normally.png') });
  await pressNla(page, landed, CS, 'TAXI_IN');

  // "Ordnance safe" at the pad: GND has no 3G on its grid, so the expanded view.
  await goBay(page, 'GND', 'gnd-taxi-in');
  const gnd = stripByCallsign(page, CS);
  await expect(gnd.locator('[data-slot="ord"]')).toHaveText('HUNG');
  await gnd.locator('.efsp-expand-btn').click();
  await setOrdnance(gnd.locator('[data-expanded-block="3G"]'), 'CLEAN');
  await expect.poll(() => ordnanceOf(page, CS)).toBe('CLEAN');
  await expect(gnd.locator('[data-slot="ord"]')).toHaveCount(0);
  await expect(gnd.locator('.efsp-strip-reason', { hasText: 'Hung ordnance' })).toHaveCount(0);
  await gnd.locator('.efsp-expand-btn').click();
  await only(page, CS);
  await gnd.screenshot({ path: shot('04-cleared.png') });

  expect(scriptErrors(consoleErrors), consoleErrors.join('\n')).toEqual([]);
});

test('pilot walks with field state: the pad by name, a runway request re-stated, an aborted departure', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1200 });
  const { consoleErrors } = await openPanel(page, { held: ['TWR', 'APP', 'GND', 'OPS'] });
  await standInFieldState(page);

  // "Request runway 23 for hot cargo" — TWR edits 8B; the advisory re-states the runway, recommends none.
  const CS = 'HUNG21';
  await goBay(page, 'APP', 'app-inbound');
  let strip = await seedStrip(page, { callsign: CS, actingPositionId: 'APP', bayId: 'app-inbound', role: 'ARRIVAL', fdr: ARR_FDR });
  await recordFromExpanded(strip, 'HUNG');
  await expect(strip.locator('.efsp-strip-reason', { hasText: 'taxi to Hot cargo pad' }))
    .toHaveText('Hung ordnance. SOURCE practice: after landing, taxi to Hot cargo pad; the runway is the controller\'s call. Runway 05/23 (05) assigned.');
  await only(page, CS);
  await strip.screenshot({ path: shot('06-pad-named.png') });
  await pressNla(page, strip, CS, 'HANDED_TO_TOWER');
  await goBay(page, 'TWR', 'twr-arrivals');
  strip = stripByCallsign(page, CS);
  await strip.locator('.efsp-block-8B').first().click();
  const input = strip.locator('input.efsp-block-input');
  await input.fill('23');
  await input.press('Enter');
  const reason = strip.locator('.efsp-strip-reason', { hasText: 'Hung ordnance' });
  await expect(reason).toContainText('Runway 05/23 (23) assigned.');
  await expect(reason).not.toContainText(/prefer|recommend|closer|nearer|use runway/i);
  await only(page, CS);
  await strip.screenshot({ path: shot('07-runway-23-requested.png') });
  // "Ordnance safe now" (de-armed): EXPENDED clears it too.
  await setOrdnance(strip, 'EXPENDED');
  await expect(strip.locator('[data-slot="ord"]')).toHaveCount(0);

  // A departure that aborts and returns with a hung store.
  const DEP = 'HUNG31';
  await goBay(page, 'OPS', 'ops-proposed');
  const dep = await seedStrip(page, { callsign: DEP, actingPositionId: 'OPS', role: 'DEPARTURE',
    fdr: { departureAirport: 'LTAG', destinationAirport: 'LTAG', route: 'DCT', requestedAltitude: '250' } });
  await dep.locator('.efsp-expand-btn').click();
  await setOrdnance(dep.locator('[data-expanded-block="3G"]'), 'HUNG');
  await expect(dep.locator('.efsp-strip-reason', { hasText: 'Hung ordnance' })).toContainText('if it returns, taxi to Hot cargo pad');
  await dep.locator('.efsp-expand-btn').click();
  await only(page, DEP);
  await dep.screenshot({ path: shot('08-departure-returns.png') });
  await dep.locator('.efsp-expand-btn').click();
  await setOrdnance(dep.locator('[data-expanded-block="3G"]'), 'CLEAN');
  await expect(dep.locator('[data-slot="ord"]')).toHaveCount(0);

  expect(scriptErrors(consoleErrors), consoleErrors.join('\n')).toEqual([]);
});
