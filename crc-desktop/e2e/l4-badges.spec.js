'use strict';

/* Lane 4 — badges and chip layout. docs/ui-findings/lane4.md:
 * "Extends F-305", "Extends F-002", F-407.
 *
 * The obligation alert is delivered by calling the page's own handler pair,
 * exactly as app.js's `efsp-obligation-alert` case does
 * (applyEfspObligationAlert + renderAllOpenEfspBays). Getting crc-sync to
 * raise a real one needs a void time to expire; what is under test is the
 * render path after the message lands, and that is identical either way.
 */

const { test, expect } = require('@playwright/test');
const { openPanel, seedStrip } = require('./helpers/app');

function stripIdOf(page, callsign) {
  return page.evaluate((cs) => getAllEfspStrips().find((s) => getEfspFdr(s.fdrId).identity.callsign === cs).stripId, callsign);
}

async function raiseObligation(page, callsign) {
  const stripId = await stripIdOf(page, callsign);
  await page.evaluate((stripId) => {
    applyEfspObligationAlert({ stripId, facilityId: 'INCIRLIK', obligationType: 'VOID_TIME_EXPIRED', dueAt: Date.now(), severity: 'OVERDUE' });
    renderAllOpenEfspBays();
  }, stripId);
}

/**
 * Retires the Strips a test created, and with them anything hanging off them.
 *
 * The Board is one crc-sync for the whole RUN, not per spec file, so a MARSA
 * relation left ACTIVE here is still ACTIVE when another file counts
 * `.efsp-marsa-badge` — marsa-popover.spec.js's "exactly 2 participants" was
 * counting four. Dropping the Strips is enough on its own: _retireStrip
 * releases the FDR and board-store's retireMarsaForFdr ends the relation with
 * it, which is the same shape l4-drag.spec.js's dropAll has.
 */
async function dropAll(page, callsigns) {
  await page.evaluate((cs) => {
    for (const s of getAllEfspStrips()) {
      const fdr = getEfspFdr(s.fdrId);
      if (!fdr || !cs.includes(fdr.identity.callsign) || s.state === 'DROPPED') continue;
      sendEfspMutation(s.ownerPositionId, s, { kind: 'DropStrip', reason: 'e2e cleanup' });
    }
  }, callsigns);
  await page.waitForTimeout(400);
}

// Extends F-305 — was a catalogued finding, now fixed.
test('an obligation alert shows on the Strip without anything else happening', async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  const strip = await seedStrip(page, { callsign: 'L4O1', role: 'DEPARTURE' });
  await raiseObligation(page, 'L4O1');
  await expect(strip.locator('.efsp-obligation-badge')).toHaveCount(1, { timeout: 2000 });
});

// Extends F-305 — was a catalogued finding, now fixed.
test('declaring MARSA updates the badge on the participants', async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  const tanker = await seedStrip(page, { callsign: 'L4M1', role: 'DEPARTURE' });
  await seedStrip(page, { callsign: 'L4M2', role: 'DEPARTURE' });
  try {
    // Sent through the page's own MARSA sender, not the popover — the popover
    // is F-001's, and this is about what happens after the relation exists.
    await page.evaluate(() => {
      const f = (cs) => getAllEfspStrips().find((s) => getEfspFdr(s.fdrId).identity.callsign === cs);
      sendEfspMarsaMutation('OPS', undefined, undefined, {
        kind: 'DeclareMarsa', participants: [f('L4M1').fdrId, f('L4M2').fdrId],
        startEvent: 'LOCAL_DECLARATION', endCondition: 'ATC_SEPARATION_ESTABLISHED', declaringCallsign: 'L4M1',
      });
    });
    await expect.poll(() => page.evaluate(() => getAllEfspMarsa().some((m) => m.state === 'ACTIVE')),
      { timeout: 3000, message: 'precondition: the relation is ACTIVE on the page' }).toBe(true);
    await expect(tanker.locator('.efsp-marsa-badge, .efsp-marsa-btn')).not.toHaveText('MARSA…', { timeout: 2000 });
  } finally {
    // The relation must not outlive this test — see dropAll.
    await dropAll(page, ['L4M1', 'L4M2']);
  }
});

// Extends F-002 — fixed. Every Strip-level badge used to land under the actions row.
test('an obligation badge does not push the Strip onto another row', async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  const strip = await seedStrip(page, { callsign: 'L4O2', role: 'DEPARTURE' });
  const before = (await strip.boundingBox()).height;
  await raiseObligation(page, 'L4O2');
  // No click to force a rebuild any more. It was here because F-305 hid the
  // badge until something else rebuilt the Strip; F-305 is fixed, so the badge
  // arrives on its own — and the click had become actively harmful. Playwright
  // measures `position` from the PADDING box, so (5,5) resolved to absolute
  // x=17, which after F-105's 44x44 targets is inside the CALLSIGN cell. The
  // click opened the Block editor, .efsp-block-1 became an <input> with no
  // text, and stripByCallsign() stopped resolving the Strip at all.
  await expect(strip.locator('.efsp-obligation-badge')).toHaveCount(1, { timeout: 2000 });
  // Indicators are drawn only when there is something wrong (docs/adr/0058), so
  // the first one adds the indicator row inside the body zone: the Strip may
  // grow by that one row, never by a row under the actions column (F-002).
  const after = (await strip.boundingBox()).height;
  expect(after, `Strip ${before}px -> ${after}px with one badge`).toBeLessThanOrEqual(before + 28);
  const inBody = await strip.locator('.efsp-obligation-badge').evaluate((b) => !!b.closest('.efsp-strip-slots'));
  expect(inBody, 'the badge is in the indicator row').toBe(true);
});

// F-407 — was a catalogued finding, now fixed.
test('the chip labels on one row line up', async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  const strip = await seedStrip(page, { callsign: 'L4L1', role: 'DEPARTURE' });
  const rows = await strip.evaluate((el) => {
    const byRow = new Map();
    for (const chip of el.querySelectorAll('.efsp-block-chip')) {
      const row = Math.round(chip.getBoundingClientRect().bottom / 12);
      const label = chip.querySelector('.efsp-block-label');
      if (!label) continue;
      const tops = byRow.get(row) || new Set();
      tops.add(Math.round(label.getBoundingClientRect().top));
      byRow.set(row, tops);
    }
    return [...byRow.values()].map((s) => [...s].sort((a, b) => a - b));
  });
  for (const tops of rows) expect(tops.length, `label tops on one row: ${tops.join(', ')}`).toBe(1);
});
