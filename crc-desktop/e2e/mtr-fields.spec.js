'use strict';

/* L2 — §9.4 MTR fields on the Strip (crc-sync's docs/adr/0062), in a real
 * browser: the conditional MTR row on Layout C's field grid, its column-1
 * row start (a `:has()` rule — asserted by x-coordinate, not by existence),
 * the refusal at the cell, the lost-comms note in ▼, and narrow Bays.
 *
 * Screenshots land in docs/wip/L2/ for the wave-1 merge (H9).
 *
 * The Board persists across tests in a run, so every callsign is unique.
 */

const path = require('path');
const { test, expect } = require('@playwright/test');
const { openPanel, seedStrip, stripByCallsign, expectRefusalIsVisible } = require('./helpers/app');

test.describe.configure({ timeout: 60000 });

const SHOTS = path.join(__dirname, '..', '..', 'docs', 'wip', 'L2');
const shot = (name) => path.join(SHOTS, name);

async function goBay(page, positionId, bayId) {
  await page.locator(`#efsp-position-tabs .efsp-position-tab[data-position-id="${positionId}"]`).click();
  await page.locator(`#efsp-bay-tabs .efsp-bay-tab[data-bay-id="${bayId}"]`).click();
}

/** Click a value cell, type, Enter — the ordinary click-to-edit path. */
async function edit(scope, blockId, text) {
  await scope.locator(`.efsp-block-${blockId}`).first().click();
  const input = scope.locator('input.efsp-block-input');
  await expect(input).toBeFocused();
  await input.fill(text);
  await input.press('Enter');
}

/** The field chips on a Strip's face, in DOM order, by Block id. */
const faceIds = (strip) => strip.locator('.efsp-strip-fields [data-block]').evaluateAll(
  (els) => els.map((e) => e.dataset.block));

/** Hide every Strip but these, so screenshots show just the one(s) being described. */
async function only(page, callsigns) {
  await page.evaluate((keep) => {
    for (const s of document.querySelectorAll('.efsp-strip')) {
      const cs = s.querySelector('.efsp-block-1');
      s.style.display = cs && keep.includes(cs.textContent.trim()) ? '' : 'none';
    }
  }, callsigns);
}

const OVF = { departureAirport: 'LTAC', destinationAirport: 'LTAI', route: 'DCT' };

async function ctrOverflight(page, callsign, fdr = {}) {
  return seedStrip(page, {
    callsign, actingPositionId: 'CTR', bayId: 'ctr-overflight', role: 'OVERFLIGHT', facilityId: 'CENTER',
    fdr: { ...OVF, ...fdr },
  });
}

test('CTR overflight: no MTR row until MTR data is posted, then the full group on its own row, M11 first', async ({ page }) => {
  await openPanel(page, { held: ['CTR'], facilityId: 'CENTER' });
  await goBay(page, 'CTR', 'ctr-overflight');
  const strip = await ctrOverflight(page, 'MTR101');
  await only(page, ['MTR101']);

  for (const id of ['9G-MTR', '9H-EXIT', '9H-TIME', '9H-ALT', '9G-ENTRY', '9G-TIME']) {
    await expect(strip.locator(`.efsp-strip-fields .efsp-block-${id}`)).toHaveCount(0);
  }
  await strip.screenshot({ path: shot('mtr-01-quiet.png') });

  // Post the designator through ▼, where it is the only way to reach it.
  await strip.locator('.efsp-expand-btn').click();
  await edit(strip.locator('[data-expanded-block="9G-MTR"]'), '9G-MTR', 'ir107');
  await expect(strip.locator('.efsp-strip-fields .efsp-block-9G-MTR')).toHaveText('IR107');
  await strip.locator('.efsp-expand-btn').click(); // collapse

  const ids = await faceIds(strip);
  const mtr = ids.slice(ids.indexOf('9G-MTR'));
  expect(mtr).toEqual(['9G-MTR', '9H-EXIT', '9H-TIME', '9H-ALT', '9G-ENTRY', '9G-TIME']);

  // Its own row: the 9G-MTR chip's left edge is the grid's left edge.
  const x = await strip.evaluate((el) => {
    const grid = el.querySelector('.efsp-strip-fields').getBoundingClientRect().left;
    const chip = el.querySelector('.efsp-strip-fields .efsp-block-9G-MTR').closest('.efsp-field').getBoundingClientRect().left;
    return { grid: Math.round(grid), chip: Math.round(chip) };
  });
  expect(x.chip, 'the MTR group does not start its own row').toBe(x.grid);

  await edit(strip, '9H-EXIT', 'f');
  await expect(strip.locator('.efsp-block-9H-EXIT')).toHaveText('F');
  await edit(strip, '9H-TIME', '14:32z');
  await expect(strip.locator('.efsp-block-9H-TIME')).toHaveText('1432');
  await edit(strip, '9H-ALT', 'fl190');
  await expect(strip.locator('.efsp-block-9H-ALT')).toHaveText('FL190');
  await edit(strip, '9G-ENTRY', 'a');
  await edit(strip, '9G-TIME', '1405');
  await expect(strip.locator('.efsp-block-9G-TIME')).toHaveText('1405');

  // Stored as an instant on the flight, shown as HHMM.
  const stored = await page.evaluate((cs) => {
    const s = [...efspStrips.values()].find(x => (efspFdrs.get(x.fdrId) || {}).identity?.callsign === cs);
    return efspFdrs.get(s.fdrId).military.mtr.exitEstimateUtc;
  }, 'MTR101');
  expect(typeof stored).toBe('number');
  expect(new Date(stored).getUTCHours() * 100 + new Date(stored).getUTCMinutes()).toBe(1432);

  // No tint: the MTR fields look like every other field.
  const colours = await strip.evaluate((el) => ['9G-MTR', '9H-EXIT', '1'].map((id) => {
    const chip = el.querySelector(`.efsp-strip-fields .efsp-block-${id}`).closest('.efsp-field');
    return getComputedStyle(chip).backgroundColor;
  }));
  expect(new Set(colours).size, `MTR fields are tinted: ${colours.join(' / ')}`).toBe(1);

  await strip.screenshot({ path: shot('mtr-02-posted.png') });
});

test('the chip labels on every row of an MTR Strip line up', async ({ page }) => {
  await openPanel(page, { held: ['CTR'], facilityId: 'CENTER' });
  await goBay(page, 'CTR', 'ctr-overflight');
  const strip = await ctrOverflight(page, 'MTR102');
  await strip.locator('.efsp-expand-btn').click();
  await edit(strip.locator('[data-expanded-block="9H-EXIT"]'), '9H-EXIT', 'E');
  await strip.locator('.efsp-expand-btn').click();
  await expect(strip.locator('.efsp-strip-fields .efsp-block-9H-EXIT')).toHaveText('E');

  const rows = await strip.evaluate((el) => {
    const byRow = new Map();
    for (const chip of el.querySelectorAll('.efsp-strip-fields .efsp-block-chip')) {
      const row = Math.round(chip.getBoundingClientRect().bottom / 12);
      const label = chip.querySelector('.efsp-block-label');
      if (!label) continue;
      const tops = byRow.get(row) || new Set();
      tops.add(Math.round(label.getBoundingClientRect().top));
      byRow.set(row, tops);
    }
    return [...byRow.values()].map((s) => [...s]);
  });
  for (const tops of rows) expect(tops.length, `label tops on one row: ${tops.join(', ')}`).toBe(1);
});

test('two MTR Strips in one Bay with different wrapping above: the MTR group sits at the same x', async ({ page }) => {
  await openPanel(page, { held: ['CTR'], facilityId: 'CENTER' });
  await goBay(page, 'CTR', 'ctr-overflight');
  const a = await ctrOverflight(page, 'MTR103');
  const b = await ctrOverflight(page, 'MTR104', {
    route: 'LTAC DCT KONYA DCT ADANA DCT UMRUN DCT GAZIANTEP DCT HATAY DCT DIYARBAKIR DCT BATMAN DCT LTAI',
  });
  for (const s of [a, b]) {
    await s.locator('.efsp-expand-btn').click();
    await edit(s.locator('[data-expanded-block="9G-MTR"]'), '9G-MTR', 'IR107');
    await s.locator('.efsp-expand-btn').click();
    await expect(s.locator('.efsp-strip-fields .efsp-block-9G-MTR')).toHaveText('IR107');
  }
  await edit(b, '9H-EXIT', 'F');
  await only(page, ['MTR103', 'MTR104']);
  const left = (s) => s.locator('.efsp-strip-fields .efsp-block-9G-MTR').evaluate((e) => Math.round(e.closest('.efsp-field').getBoundingClientRect().left));
  expect(await left(a)).toBe(await left(b));
  await page.locator('#efsp-bay-content').screenshot({ path: shot('mtr-03-two-strips.png') });
});

test('a bad exit estimate is refused, and the refusal is legible at the cell', async ({ page }) => {
  await openPanel(page, { held: ['CTR'], facilityId: 'CENTER' });
  await goBay(page, 'CTR', 'ctr-overflight');
  const strip = await ctrOverflight(page, 'MTR105');
  await strip.locator('.efsp-expand-btn').click();
  await edit(strip.locator('[data-expanded-block="9H-EXIT"]'), '9H-EXIT', 'F');
  await strip.locator('.efsp-expand-btn').click();
  await expect(strip.locator('.efsp-strip-fields .efsp-block-9H-TIME')).toHaveCount(1);

  await edit(strip, '9H-TIME', '2460');
  const text = await expectRefusalIsVisible(page, '9H-TIME 2460');
  expect(text).toMatch(/HHMM/);
  // F-207: the cell reopens on the text that was refused, marked.
  const cell = strip.locator('.efsp-strip-fields .efsp-block-refused');
  await expect(cell).toHaveCount(1);
  await only(page, ['MTR105']);
  await page.locator('#efsp-panel').screenshot({ path: shot('mtr-04-refused.png') });
});

test('the lost-comms advisory: a grey note in ▼ naming the ALT clearance, nothing on the collapsed face', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1600 });
  await openPanel(page, { held: ['CTR'], facilityId: 'CENTER' });
  await goBay(page, 'CTR', 'ctr-overflight');
  const strip = await ctrOverflight(page, 'MTR106');
  const reasonsBefore = await strip.locator('.efsp-strip-reason').count();
  await edit(strip, '7A', 'FL180');
  await strip.locator('.efsp-expand-btn').click();
  await expect(strip.locator('.efsp-mtr-lostcomms')).toHaveCount(0);
  await edit(strip.locator('[data-expanded-block="9G-MTR"]'), '9G-MTR', 'IR107');
  await edit(strip, '9H-ALT', 'FL230');

  const note = strip.locator('.efsp-strip-expanded .efsp-mtr-lostcomms');
  await expect(note).toHaveCount(1);
  await expect(note).toContainText('FL180');
  await expect(note).toContainText('not available in this system');
  await expect(note).not.toContainText('FL230');
  const colour = await note.evaluate((e) => getComputedStyle(e).color);
  expect(colour, 'the advisory is amber — it is not a warning').not.toBe('rgb(255, 224, 168)');
  await only(page, ['MTR106']);
  await strip.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const box = await strip.boundingBox();
  await page.screenshot({ path: shot('mtr-05-advisory.png'), clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 360) } });

  await strip.locator('.efsp-expand-btn').click(); // collapse
  await expect(strip.locator('.efsp-mtr-lostcomms')).toHaveCount(0);
  expect(await strip.locator('.efsp-strip-reason').count()).toBe(reasonsBefore);
  // …and the rule is on EXIT ALT's label for a hover.
  const title = await strip.locator('.efsp-strip-fields .efsp-field', { has: page.locator('.efsp-block-9H-ALT') })
    .locator('.efsp-block-label').getAttribute('title');
  expect(title).toMatch(/Lost comms \(§9\.4\).*FL180/s);
});

test('APP arrival: the M11 group only — no entry fields on the face', async ({ page }) => {
  await openPanel(page, { held: ['APP'] });
  await goBay(page, 'APP', 'app-inbound');
  const strip = await seedStrip(page, {
    callsign: 'MTR107', actingPositionId: 'APP', bayId: 'app-inbound', role: 'ARRIVAL',
    fdr: { originAirport: 'LTAG', destinationAirport: 'LTAG', route: 'DCT' },
  });
  await strip.locator('.efsp-expand-btn').click();
  await edit(strip.locator('[data-expanded-block="9H-EXIT"]'), '9H-EXIT', 'E');
  await strip.locator('.efsp-expand-btn').click();
  await edit(strip, '9G-MTR', 'IR107');
  await edit(strip, '9H-TIME', '1440');
  await edit(strip, '9H-ALT', 'FL210');
  const ids = await faceIds(strip);
  expect(ids.slice(ids.indexOf('9G-MTR'))).toEqual(['9G-MTR', '9H-EXIT', '9H-TIME', '9H-ALT']);
  await only(page, ['MTR107']);
  await strip.screenshot({ path: shot('mtr-06-arrival.png') });
});

test('narrow Bays (480 and 320 px): no field under 66 px, nothing overflows the Strip', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1600 });
  await openPanel(page, { held: ['CTR'], facilityId: 'CENTER' });
  await goBay(page, 'CTR', 'ctr-overflight');
  const strip = await ctrOverflight(page, 'MTR108');
  await strip.locator('.efsp-expand-btn').click();
  await edit(strip.locator('[data-expanded-block="9G-MTR"]'), '9G-MTR', 'IR107');
  await strip.locator('.efsp-expand-btn').click();
  await edit(strip, '9H-EXIT', 'F');
  await edit(strip, '9H-TIME', '1432');
  await edit(strip, '9H-ALT', 'FL190');
  await only(page, ['MTR108']);

  for (const width of [480, 320]) {
    await page.evaluate((w) => { document.querySelector('#efsp-bay-content').style.width = `${w}px`; }, width);
    await page.waitForTimeout(100);
    const m = await strip.evaluate((el) => ({
      narrowest: Math.min(...[...el.querySelectorAll('.efsp-strip-fields > .efsp-field')].map((f) => f.getBoundingClientRect().width)),
      overflow: el.scrollWidth - el.clientWidth,
      mtrLeft: Math.round(el.querySelector('.efsp-strip-fields .efsp-block-9G-MTR').closest('.efsp-field').getBoundingClientRect().left),
      gridLeft: Math.round(el.querySelector('.efsp-strip-fields').getBoundingClientRect().left),
    }));
    expect(m.narrowest, `${width}px: a field is ${m.narrowest}px`).toBeGreaterThanOrEqual(65.5);
    expect(m.overflow, `${width}px: the Strip scrolls sideways by ${m.overflow}px`).toBeLessThanOrEqual(0);
    expect(m.mtrLeft, `${width}px: the MTR group is not at column 1`).toBe(m.gridLeft);
  }
  await page.evaluate(() => { document.querySelector('#efsp-bay-content').style.width = '480px'; });
  await page.waitForTimeout(100);
  await strip.screenshot({ path: shot('mtr-07-narrow-480.png') });
  await page.evaluate(() => { document.querySelector('#efsp-bay-content').style.width = '320px'; });
  await page.waitForTimeout(100);
  await strip.screenshot({ path: shot('mtr-07-narrow-320.png') });
});

