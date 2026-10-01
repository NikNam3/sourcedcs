'use strict';

/* U6 — a block altitude in the ALT field (docs/adr/0091). A CTR arrival: its Block 7 is the
 * assigned ALT (docs/adr/0058). */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, dropStrips } = require('./helpers/app');

const CS = 'U6BLK1';

test('ALT takes FL220B240, shows it as FL220-FL240, refuses a reversed block, and a single altitude replaces it', async ({ page }) => {
  await openPanel(page, { held: ['CTR'], facilityId: 'CENTER', controller: 'u6-ctr' });
  try {
    const s = await seedStrip(page, { callsign: CS, actingPositionId: 'CTR', bayId: 'ctr-enroute', role: 'ARRIVAL', facilityId: 'CENTER' });
    const id = await s.getAttribute('data-strip-id');
    const stored = () => page.evaluate((i) => {
      const fdr = getEfspFdr(getEfspStrip(i).fdrId);
      const e = fdr.clearance.altitude.entries.filter(x => x.status === 'ACTIVE').at(-1);
      return e ? { value: e.value, parsed: e.parsed, block: e.block } : null;
    }, id);
    const type = async (text) => {
      await page.locator(`.efsp-strip[data-strip-id="${id}"] .efsp-block-7`).click();
      await page.keyboard.press('Control+A');
      await page.keyboard.type(text);
      await page.keyboard.press('Enter');
    };
    const cell = page.locator(`.efsp-strip[data-strip-id="${id}"] .efsp-block-7`);

    await type('fl220b240');
    await expect.poll(stored).toEqual({ value: 'FL220-FL240', parsed: null, block: { lowFt: 22000, highFt: 24000 } });
    await expect(cell).toHaveText('FL220-FL240');

    // A reversed block is refused and the stored one stays.
    await type('FL240-FL220');
    await page.waitForTimeout(700);
    expect((await stored()).value).toBe('FL220-FL240');
    // The refusal is on screen, and the editor stays open on what was typed so it can be fixed.
    await expect(page.getByText(/write the lower altitude first/).first()).toBeVisible();
    const input = page.locator(`.efsp-strip[data-strip-id="${id}"] input.efsp-block-input`);
    await expect(input).toHaveValue('FL240-FL220');
    await input.fill('FL180');
    await input.press('Enter');
    await expect.poll(stored).toEqual({ value: 'FL180', parsed: 18000, block: null });
    await expect(cell).toHaveText('FL180');
  } finally {
    await dropStrips(page, [CS]);
  }
});
