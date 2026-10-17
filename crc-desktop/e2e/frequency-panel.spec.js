'use strict';

/* The FREQUENCIES panel (crc-sync docs/adr/0131, H154) in a real browser: a controller sets GND in place, another sees it
 * at once with a grey SET mark, a refused value stays in the row with its reason, RESET returns the default, and the SFA
 * pool's new frequency reaches the SFA Bay. Run on E2E_LANE=9. Screenshots go to test-results/.
 */

const { test, expect } = require('./helpers/test');
const { openPanel } = require('./helpers/app');

test.describe.configure({ mode: 'serial', timeout: 120000 });
test.use({ resetScope: 'file' });

const shot = (page, name) => page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: false });

const _contexts = [];
test.afterEach(async () => {
  while (_contexts.length) await _contexts.pop().close().catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
});

async function controller(browser, signedOn, name) {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1600, height: 1000 } });
  _contexts.push(ctx);
  const page = await ctx.newPage();
  const { consoleErrors } = await openPanel(page, { signedOn, controller: name });
  return { page, consoleErrors };
}

/** Opens FREQUENCIES the way a controller does: its row in the PANELS list. */
async function openFrequencies(page) {
  if (!(await page.evaluate(() => crc.dock.isDockPanelOpen('radars')))) await page.locator('#btn-radars').click();
  await page.evaluate(() => crc.dock.dock.api.getPanel('radars').api.setActive());
  await page.locator('#panel-controls .panel-ctrl-label', { hasText: /^FREQUENCIES/ }).click();
  await expect(page.locator('#frequency-panel')).toBeVisible();
}

const rowOf = (page, key) => page.locator(`#frequency-panel .freq-row[data-key="${key}"]`);
const appErrors = (errors) => errors.filter(t => !/^Failed to load resource/.test(t));

test('set GND in place; the other controller sees it, SET in grey; a bad value is refused in the row; RESET', async ({ browser }) => {
  const gc = await controller(browser, ['GC'], 'freq-gc');
  const lc = await controller(browser, ['LC'], 'freq-lc');
  await openFrequencies(gc.page);
  await openFrequencies(lc.page);

  const gnd = rowOf(gc.page, 'INCIRLIK/GC/GND');
  await expect(gnd.locator('.freq-value')).toHaveText('275.800');
  await expect(gnd.locator('.freq-set-mark')).toHaveCount(0);
  await expect(rowOf(gc.page, 'INCIRLIK/SFA/freq-2').locator('.freq-name')).toHaveText('freq-2 ROTATION');

  // An off-grid value: refused in the row before any round trip, the typed text kept.
  await gnd.locator('.freq-value').click();
  const input = gnd.locator('.freq-input');
  await expect(input).toBeFocused();
  await input.fill('275.81');
  await input.press('Enter');
  await expect(gnd.locator('.freq-error')).toContainText('25 kHz');
  await expect(input).toHaveValue('275.81');
  await shot(gc.page, 'freq-refused');

  await input.fill('275.925');
  await input.press('Enter');
  await expect(gnd.locator('.freq-value')).toHaveText('275.925');
  await expect(gnd.locator('.freq-set-mark')).toHaveText('SET');
  await expect(gnd.locator('.freq-note')).toContainText('default 275.800');
  await expect(gnd.locator('.freq-note')).toContainText('freq-gc');

  // The other controller, at once; and its Position data carries the new value.
  const lcGnd = rowOf(lc.page, 'INCIRLIK/GC/GND');
  await expect(lcGnd.locator('.freq-value')).toHaveText('275.925');
  await expect(lcGnd.locator('.freq-set-mark')).toHaveText('SET');
  await expect.poll(() => lc.page.evaluate(() => crc.state.getEfspPosition('GC').frequencies[0].mhz)).toBe(275.925);
  // Grey, not a colour: the SET mark is the muted text token.
  const color = await lcGnd.locator('.freq-set-mark').evaluate(el => getComputedStyle(el).color);
  expect(color).toBe('rgb(140, 154, 166)');
  await shot(lc.page, 'freq-set-seen');

  await lcGnd.locator('.freq-reset').click();
  await expect(gnd.locator('.freq-value')).toHaveText('275.800');
  await expect(gnd.locator('.freq-set-mark')).toHaveCount(0);

  expect(appErrors(gc.consoleErrors)).toEqual([]);
  expect(appErrors(lc.consoleErrors)).toEqual([]);
});

test('an SFA pool frequency set in the panel reaches the SFA Bay', async ({ browser }) => {
  const ap = await controller(browser, ['AP'], 'freq-ap');
  await openFrequencies(ap.page);
  const row = rowOf(ap.page, 'INCIRLIK/SFA/freq-5');
  await row.locator('.freq-value').click();
  // A frequency another pool Rack has is refused here.
  await row.locator('.freq-input').fill('233.100');
  await row.locator('.freq-input').press('Enter');
  await expect(row.locator('.freq-error')).toContainText('already freq-2');
  await row.locator('.freq-input').fill('241.000');
  await row.locator('.freq-input').press('Enter');
  await expect(row.locator('.freq-value')).toHaveText('241.000');
  await expect.poll(() => ap.page.evaluate(() => crc.state.getEfspBays().find(b => b.view === 'sfa-freqs').sfaPool.find(p => p.rackId === 'freq-5').mhz)).toBe(241);
  await shot(ap.page, 'freq-sfa-set');
  await row.locator('.freq-reset').click();
  await expect(row.locator('.freq-value')).toHaveText('236.100');
  expect(appErrors(ap.consoleErrors)).toEqual([]);
});
