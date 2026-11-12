/**
 * The smoke spec (TOLD 1.8 "Testing and CI"): the three pages load in light and dark, the manual's B2-3 sample typed
 * into the TOLD page gives its MIL takeoff distance, a bad field is underlined, a reload keeps the state, a link from
 * another version is refused with its note, a "Fig." link opens the figure view with its paths, and the TOLD page
 * and a three-sheet figure view each print on exactly one A4 and one Letter page. No page logs a console error or throws.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const TOLD = '/f16/';

/** Console errors and uncaught exceptions of a page; every test asserts the list stays empty. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

const field = (page: Page, name: string): Locator => page.locator(`input[data-field="${name}"]`);

/** The TOLD page loaded: its data is in and the takeoff table has rows. */
async function openTold(page: Page, hash = ''): Promise<void> {
  await page.goto(`${TOLD}${hash}`);
  await expect(page.locator('#takeoff-rows tr').first()).toBeVisible();
}

/** A row of a TOLD table by its label; its cells after label and "Fig." are MIL/dry exact, cons., then MAX AB/wet. */
const row = (page: Page, table: 'takeoff' | 'landing', label: string): Locator =>
  page.locator(`#${table}-rows tr`).filter({ has: page.locator('td.row-label', { hasText: label }) });

/**
 * The manual's takeoff sample (pp. 278 to 280): pressure altitude 2,000 ft, 40 °C, 33,000 lb, CG 37, DI 150, 10 kt
 * headwind, 1 % uphill, a 6,000 ft runway. The empty loadout is the basic aircraft's 4; Additional 146 makes 150.
 */
async function typeSample(page: Page): Promise<void> {
  const values: readonly (readonly [string, string])[] = [
    ['takeoffGwLb', '33,000'],
    ['cgPct', '37'],
    ['runway', '36'],
    ['headingDeg', '360'],
    ['lengthFt', '6000'],
    ['nearElevFt', '2000'],
    ['farElevFt', '2060'],
    ['altimeterInHg', '29.92'],
    ['tempC', '40'],
    ['wind', '360 / 10'],
  ];
  for (const [name, value] of values) await field(page, name).fill(value);
  await page.locator('#drag-index input').fill('146');
}

/** The PDF's page objects (`/Type /Page`, not the `/Pages` tree node). */
const pageCount = (pdf: Buffer): number => (pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;

test('the TOLD page computes the B2-3 sample, underlines a bad field and keeps its state over a reload', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await openTold(page);
  await typeSample(page);

  const distance = row(page, 'takeoff', 'Takeoff distance').locator('td');
  // Cells: label, Fig., MIL exact, MIL cons., MAX AB exact, MAX AB cons. The manual gives 4,243 ft MIL (within 2 %).
  await expect(distance.nth(2)).toHaveText('4,228');
  const milFt = Number((await distance.nth(2).innerText()).replace(/,/g, ''));
  expect(Math.abs(milFt - 4243) / 4243).toBeLessThan(0.02);
  await expect(page.locator('#derived')).toContainText('slope 1.0 % uphill');

  await field(page, 'tempC').fill('4o');
  await expect(field(page, 'tempC')).toHaveClass(/\bunparsed\b/);
  await expect(distance.nth(2)).toHaveText('—');
  await field(page, 'tempC').fill('40');
  await expect(field(page, 'tempC')).not.toHaveClass(/\bunparsed\b/);

  await page.reload();
  await expect(page.locator('#takeoff-rows tr').first()).toBeVisible();
  await expect(field(page, 'takeoffGwLb')).toHaveValue('33,000');
  await expect(field(page, 'wind')).toHaveValue('360 / 10');
  await expect(page.locator('#drag-index input')).toHaveValue('146');
  await expect(row(page, 'takeoff', 'Takeoff distance').locator('td').nth(2)).toHaveText('4,228');
  expect(errors).toEqual([]);
});

test('a link from another version is refused with its note and the page still loads', async ({ page }) => {
  const errors = watchErrors(page);
  await openTold(page, '#v=2&tgw=33000');
  await expect(page.locator('#page-notes .page-note')).toHaveText(
    'This link is from another version of the calculator and was not loaded.',
  );
  await expect(field(page, 'takeoffGwLb')).toHaveValue('');
  expect(errors).toEqual([]);
});

test('a "Fig." link opens the figure view with its paths', async ({ page }) => {
  const errors = watchErrors(page);
  await openTold(page);
  await typeSample(page);
  await row(page, 'takeoff', 'Takeoff distance').locator('a.figure-link', { hasText: 'B2-3' }).click();
  await expect(page).toHaveURL(/\/f16\/figure\.html#v=1&.*&fig=B2-3&view=takeoff$/);
  const paths = page.locator('#figure-view svg polyline');
  await expect(paths.first()).toBeVisible();
  expect(await paths.count()).toBeGreaterThanOrEqual(2); // MIL and MAX AB
  await page.locator('#back').click();
  await expect(field(page, 'takeoffGwLb')).toHaveValue('33,000');
  expect(errors).toEqual([]);
});

test('the TOLD page prints on exactly one A4 page and one Letter page', async ({ page }) => {
  const errors = watchErrors(page);
  await openTold(page);
  await typeSample(page);
  await field(page, 'landingGwLb').fill('28000');
  for (const format of ['A4', 'Letter'] as const) {
    const pdf = await page.pdf({ format, printBackground: true });
    expect(pageCount(pdf), `${format} pages`).toBe(1);
  }
  expect(errors).toEqual([]);
});

test('a figure view with three stacked sheets prints on exactly one A4 page and one Letter page', async ({ page }) => {
  const errors = watchErrors(page);
  await openTold(page);
  await typeSample(page);
  // A dry RCR of 12 lies between the refusal chart's RCR 16 and 8 sheets: B2-5 draws three sheets, the tight case.
  await field(page, 'rcr').fill('12');
  const state = new URL(page.url()).hash.slice(1);
  await page.goto(`${TOLD}figure.html#${state}&fig=B2-5&view=takeoff`);
  await expect(page.locator('#figure-view svg polyline').first()).toBeVisible();
  await expect(page.locator('#figure-view img.figure-image')).toHaveCount(3);
  for (const format of ['A4', 'Letter'] as const) {
    const pdf = await page.pdf({ format, printBackground: true });
    expect(pageCount(pdf), `${format} pages`).toBe(1);
  }
  expect(errors).toEqual([]);
});

test.describe('dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('the three pages load without errors', async ({ page }) => {
    const errors = watchErrors(page);
    await openTold(page);
    await typeSample(page);
    const paper = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    expect(paper).toBe('rgb(0, 0, 0)');

    await row(page, 'takeoff', 'Takeoff distance').locator('a.figure-link', { hasText: 'B2-3' }).click();
    await expect(page.locator('#figure-view svg polyline').first()).toBeVisible();

    await page.goto(`${TOLD}limitations.html`);
    await expect(page.locator('#data-version')).toHaveText(/^\d+$/);
    expect(errors).toEqual([]);
  });
});

test('the figure and Limitations pages load in light mode without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${TOLD}figure.html#v=1&fig=B7-2&view=normal`);
  await expect(page.locator('#figure-view')).not.toBeEmpty();
  await page.goto(`${TOLD}limitations.html`);
  await expect(page.locator('#data-version')).toHaveText(/^\d+$/);
  expect(errors).toEqual([]);
});
