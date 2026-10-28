'use strict';

/* The FREQUENCIES panel (crc-sync docs/adr/0131, H154) in a real browser: a controller sets GND in place, another sees it
 * at once with a grey SET mark, a refused value stays in the row with its reason, RESET returns the default, and the SFA
 * pool's new frequency reaches the SFA Bay. Rows added and removed at run time, and another Facility's rows read-only
 * (crc-sync docs/adr/0138). Run on one E2E_LANE. Screenshots go to test-results/.
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

async function controller(browser, signedOn, name, facilityId = 'INCIRLIK') {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1600, height: 1000 } });
  _contexts.push(ctx);
  const page = await ctx.newPage();
  const { consoleErrors } = await openPanel(page, { signedOn, controller: name, facilityId });
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

test('a Position frequency is added and removed; another Facility\'s controller sees it read-only', async ({ browser }) => {
  const gc = await controller(browser, ['GC'], 'freq-add-gc');
  const ctr = await controller(browser, ['CTR'], 'freq-add-ctr', 'CENTER');
  await openFrequencies(gc.page);
  await openFrequencies(ctr.page);

  const box = gc.page.locator('#frequency-panel .freq-facility[data-facility-id="INCIRLIK"]');
  await box.locator('.freq-add').click();
  await box.locator('.freq-add-where').selectOption('CD');
  await expect(box.locator('.freq-add-label')).toBeFocused();
  await box.locator('.freq-add-label').fill('clr');
  await box.locator('.freq-add-mhz').fill('251.66');
  await box.locator('.freq-add-mhz').press('Enter');
  await expect(box.locator('.freq-add-line .freq-error')).toContainText('25 kHz');
  await box.locator('.freq-add-mhz').fill('251.650');
  await box.locator('.freq-add-mhz').press('Enter');
  await expect(box.locator('.freq-add-line')).toHaveCount(0);

  const clr = rowOf(gc.page, 'INCIRLIK/CD/CLR');
  await expect(clr.locator('.freq-value')).toHaveText('251.650');
  await expect(clr.locator('.freq-set-mark')).toHaveText('SET');
  await expect(clr.locator('.freq-note')).toContainText('added');
  await expect(clr.locator('.freq-remove')).toHaveText('REMOVE');
  await expect.poll(() => gc.page.evaluate(() => crc.state.getEfspPosition('CD').frequencies)).toEqual([{ label: 'CLR', mhz: 251.65 }]);
  await shot(gc.page, 'freq-added');

  // CENTER's controller sees INCIRLIK's new row, with no way to edit, add or remove it, and no text saying why.
  const seen = rowOf(ctr.page, 'INCIRLIK/CD/CLR');
  await expect(seen.locator('.freq-value')).toHaveText('251.650');
  await expect(ctr.page.locator('#frequency-panel .freq-facility[data-facility-id="INCIRLIK"] button')).toHaveCount(0);
  await expect(ctr.page.locator('#frequency-panel .freq-readonly')).toHaveCount(0);
  // Its own Facility, with no frequencies yet, can be added to.
  await expect(ctr.page.locator('#frequency-panel .freq-facility[data-facility-id="CENTER"] .freq-add')).toBeVisible();
  await shot(ctr.page, 'freq-other-facility');

  // A shipped row offers RESET only once set, never REMOVE.
  await expect(rowOf(gc.page, 'INCIRLIK/GC/GND').locator('.freq-remove')).toHaveCount(0);
  await clr.locator('.freq-remove').click();
  await expect(clr).toHaveCount(0);
  await expect(seen).toHaveCount(0);
  await expect.poll(() => gc.page.evaluate(() => crc.state.getEfspPosition('CD').frequencies)).toEqual([]);
  expect(appErrors(gc.consoleErrors)).toEqual([]);
  expect(appErrors(ctr.consoleErrors)).toEqual([]);
});

test('an SFA frequency added in the panel is a new Rack of the SFA Bay, and goes with REMOVE', async ({ browser }) => {
  const ap = await controller(browser, ['AP'], 'freq-add-ap');
  await openFrequencies(ap.page);
  const box = ap.page.locator('#frequency-panel .freq-facility[data-facility-id="INCIRLIK"]');
  await box.locator('.freq-add').click();
  await box.locator('.freq-add-where').selectOption('');
  await expect(box.locator('.freq-add-label')).toBeHidden();
  await box.locator('.freq-add-mhz').fill('233.100');
  await box.locator('.freq-add-mhz').press('Enter');
  await expect(box.locator('.freq-add-line .freq-error')).toContainText('already freq-2');
  await box.locator('.freq-add-mhz').fill('237.100');
  await box.locator('.freq-add-mhz').press('Enter');
  const row = rowOf(ap.page, 'INCIRLIK/SFA/freq-6');
  await expect(row.locator('.freq-name')).toHaveText('freq-6 SPARE');
  await expect(row.locator('.freq-value')).toHaveText('237.100');
  await expect.poll(() => ap.page.evaluate(() => crc.state.getEfspBays().find(b => b.view === 'sfa-freqs').rackIds)).toContain('freq-6');
  await shot(ap.page, 'freq-sfa-added');
  await row.locator('.freq-remove').click();
  await expect(row).toHaveCount(0);
  await expect.poll(() => ap.page.evaluate(() => crc.state.getEfspBays().find(b => b.view === 'sfa-freqs').rackIds)).not.toContain('freq-6');
  expect(appErrors(ap.consoleErrors)).toEqual([]);
});
