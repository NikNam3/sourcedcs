'use strict';

/* L16 — Block 9F as a picker and §10.5's time fallbacks, in a real browser
 * (crc-sync's docs/adr/0073).
 *
 * Needs the two-route table: run with
 *   E2E_LANE=7 E2E_STEREO_ROUTES=e2e/fixtures/l16-stereo-routes.json \
 *     npx playwright test e2e/l16-picker-and-times.spec.js
 * The table is set before crc-sync starts and never changed at runtime (P5).
 */

const path = require('path');
const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, stripByCallsign } = require('./helpers/app');

test.describe.configure({ timeout: 90000 });

const SHOTS = path.join(__dirname, '..', '..', 'docs', 'wip', 'L16');

const fdrOf = (page, callsign) => page.evaluate((cs) => {
  const s = [...efspStrips.values()].find(x => (efspFdrs.get(x.fdrId) || {}).identity?.callsign === cs);
  return s ? efspFdrs.get(s.fdrId) : null;
}, callsign);

async function pick(strip, page, value) {
  await strip.locator('.efsp-block-9F').click();
  const select = strip.locator('select.efsp-block-enum-select');
  await expect(select).toBeFocused();
  await select.selectOption(value);
}

async function only(page, callsign) {
  await page.evaluate((cs) => {
    for (const s of document.querySelectorAll('.efsp-strip')) s.style.display = s.textContent.includes(cs) ? '' : 'none';
  }, callsign);
}

test('9F is a select of the configured stereo routes, never free text', async ({ page }) => {
  expect(process.env.E2E_STEREO_ROUTES, 'run with E2E_STEREO_ROUTES=e2e/fixtures/l16-stereo-routes.json').toBeTruthy();
  await openPanel(page, { held: ['OPS'] });
  await page.waitForFunction(() => typeof cachedStereoRoutesClient === 'function' && cachedStereoRoutesClient().length === 2);
  const CS = 'L16PK1';
  const s = await seedStrip(page, { callsign: CS, fdr: { route: 'LTAG DCT HAND', requestedAltitude: '120', departureAirport: 'LTAG', destinationAirport: 'LTAG' } });

  // The picker, and nothing typed.
  await s.locator('.efsp-block-9F').click();
  const select = s.locator('select.efsp-block-enum-select');
  await expect(select).toBeFocused();
  await expect(select.locator('option')).toHaveText(['—', 'PACK1', 'PACK2']);
  await expect(s.locator('input.efsp-block-input')).toHaveCount(0);
  await select.selectOption('PACK1');

  // Re-filed on screen: label, route and altitude from the table.
  await expect(s.locator('.efsp-block-9F')).toHaveText('PACK1');
  await expect(s.locator('.efsp-block-9')).toHaveText('LTAG DCT ALPHA DCT LTAG');
  await expect(s.locator('.efsp-block-7')).toHaveText('250');
  await only(page, CS);
  await page.screenshot({ path: path.join(SHOTS, 'picker-pack1.png') });
  await page.setViewportSize({ width: 480, height: 1000 });
  await s.locator('.efsp-block-9F').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, 'picker-pack1-480.png') });
  await page.setViewportSize({ width: 1600, height: 1000 });

  // Switch.
  await pick(s, page, 'PACK2');
  await expect(s.locator('.efsp-block-9F')).toHaveText('PACK2');
  await expect(s.locator('.efsp-block-9')).toHaveText('LTAG DCT BRAVO DCT LTAG');
  await expect(s.locator('.efsp-block-7')).toHaveText('180');

  // Cancel the stereo: the label goes, the route stays (0050, T2).
  await pick(s, page, '');
  await expect(s.locator('.efsp-block-9F')).toHaveText('');
  await expect(s.locator('.efsp-block-9')).toHaveText('LTAG DCT BRAVO DCT LTAG');
  expect((await fdrOf(page, CS)).filed.route).toBe('LTAG DCT BRAVO DCT LTAG');

  // A fresh page load: the Board renders before the route list lands, and the
  // Strip must still become a picker once it does.
  await openPanel(page, { held: ['OPS'] });
  await expect(stripByCallsign(page, CS).locator('.efsp-block-9F')).toHaveClass(/efsp-block-enum/);
});

test('§10.5: departure, off-block and takeoff time each follow an explicit ordered fallback, and the chosen source is visible on hover', async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  const CS = 'L16TM1';
  // A DD1801 seed with item 13's departure time, as the lookup now sends it.
  const s = await seedStrip(page, { callsign: CS, fdr: { flightPlanDepartureTimeHhmm: '1430' } });

  // P-time on the OPS face: the plan's time, upright, its source on hover.
  const p = s.locator('.efsp-block-6');
  await expect(p).toHaveText('1430');
  await expect(p).toHaveAttribute('title', /1430Z from the filed DD-1801/);
  await expect(p).not.toHaveClass(/efsp-block-estimated/);

  // TAXI and TAKEOFF are in ▼, italic estimates of the P-time.
  await s.locator('.efsp-expand-btn').click();
  const row = (id) => s.locator(`[data-expanded-block="${id}"]`);
  for (const id of ['17', '18']) {
    await expect(row(id).locator(`.efsp-block-${id}`)).toHaveText('1430');
    await expect(row(id).locator(`.efsp-block-${id}`)).toHaveClass(/efsp-block-estimated/);
    await expect(row(id).locator('.efsp-expanded-label')).toHaveAttribute('title', /estimate/);
  }
  expect(await row('17').locator('.efsp-block-17').evaluate(el => getComputedStyle(el).fontStyle)).toBe('italic');
  await expect(row('17').locator('.efsp-block-17')).toHaveAttribute('title', /~1430Z estimate: P-time, from the filed DD-1801/);
  await only(page, CS);
  await row('17').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, 'times-estimates-full.png') });
  await s.screenshot({ path: path.join(SHOTS, 'times-estimates-strip.png') });
  await page.setViewportSize({ width: 480, height: 1000 });
  await row('17').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, 'times-estimates-480.png') });
  await page.setViewportSize({ width: 1600, height: 1000 });

  // "off-block time 1425": typed, the estimate goes, TAKEOFF now follows it.
  await row('17').locator('.efsp-block-17').click();
  const input = s.locator('input.efsp-block-input');
  await input.fill('1425');
  await input.press('Enter');
  await expect(row('17').locator('.efsp-block-17')).toHaveText('1425');
  await expect(row('17').locator('.efsp-block-17')).not.toHaveClass(/efsp-block-estimated/);
  await expect(row('17').locator('.efsp-block-17')).toHaveAttribute('title', /1425Z entered by a controller\nif cleared: estimate: P-time, from the filed DD-1801 \(item 13, EOBT\), 1430Z/);
  await expect(row('18').locator('.efsp-block-18')).toHaveText('1425');
  await expect(row('18').locator('.efsp-block-18')).toHaveAttribute('title', /~1425Z estimate: off-block, entered by a controller/);

  // The chain wrote nothing: the stored actual is the controller's, takeoff still null (T5).
  const fdr = await fdrOf(page, CS);
  expect(fdr.assigned.takeoffTimeUtc).toBeNull();
  expect(fdr.filed.proposedDepartureTimeUtc).toBeNull();
});
