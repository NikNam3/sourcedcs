'use strict';

/* The MARSA popover, reported as "vanishing behind other strips".
 *
 * This is the bug class the DOM-stub suite is structurally blind to: those
 * tests assert the popover element exists and dispatches the right op, and it
 * does both while being painted underneath everything around it.
 *
 * KNOWN FAILING, deliberately. These are marked test.fail() so the suite is
 * green and honest rather than green and quiet — when the bug is fixed,
 * Playwright reports "expected to fail but passed" and these annotations come
 * off. Measured cause:
 *
 *   .efsp-strip carries `contain: layout style`, and `contain: layout`
 *   CREATES A STACKING CONTEXT. So .efsp-coordinate-popover's `z-index: 50`
 *   competes only INSIDE its own Strip; the Strip itself is `z-index: auto`,
 *   so anything outside it paints on top. Measured: the popover sits at
 *   y=430..492 and #efsp-dot-command-input (y=456..500, full width) is what
 *   document.elementFromPoint returns at its centre.
 *
 * The CSS comment on that rule records `contain: paint` being dropped because
 * it CLIPPED popovers. That fixed the visible half and left this one: the
 * popover is no longer clipped, it is just underneath. Affects all six
 * popovers, not only MARSA.
 */

const { test, expect } = require('@playwright/test');
const { openPanel, seedStrip, stripByCallsign, expectOnTop, expectDoesSomething } = require('./helpers/app');

test.beforeEach(async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  // Three Strips, because one Strip cannot be behind anything. The reported
  // symptom needs a neighbour below it in the same Rack.
  await seedStrip(page, { callsign: 'SHELL71' });
  await seedStrip(page, { callsign: 'VIPER11' });
  await seedStrip(page, { callsign: 'VIPER12' });
});

test.fail('the MARSA popover is on top of the Strips below it', async ({ page }) => {
  const tanker = stripByCallsign(page, 'SHELL71');
  await tanker.getByRole('button', { name: 'MARSA…' }).click();

  const popover = page.locator('.efsp-marsa-popover');
  await expect(popover).toBeVisible();
  // toBeVisible() only means "has a box and is not hidden" — it passes
  // happily on an element rendered underneath another. This asks the document
  // what is actually at the popover's centre.
  await expectOnTop(page, popover, 'the MARSA popover');
});

test.fail('every control inside the MARSA popover is reachable, not just present', async ({ page }) => {
  const tanker = stripByCallsign(page, 'SHELL71');
  await tanker.getByRole('button', { name: 'MARSA…' }).click();
  const popover = page.locator('.efsp-marsa-popover');
  await expect(popover).toBeVisible();

  for (const sel of ['select', 'input', 'button']) {
    const items = popover.locator(sel);
    const n = await items.count();
    for (let i = 0; i < n; i++) {
      await expectOnTop(page, items.nth(i), `MARSA popover ${sel} #${i}`);
    }
  }
});

test.fail('declaring MARSA from the popover actually declares it', async ({ page }) => {
  const tanker = stripByCallsign(page, 'SHELL71');
  await tanker.getByRole('button', { name: 'MARSA…' }).click();
  const popover = page.locator('.efsp-marsa-popover');
  await expect(popover).toBeVisible();

  await popover.locator('input.efsp-coordinate-note').fill('SHELL71');
  await expectDoesSomething(page, popover.getByRole('button', { name: 'Declare' }), 'MARSA Declare');

  // And the relation lands on BOTH participants — §9.2 rule 5's whole point.
  await expect(page.locator('.efsp-marsa-badge, [data-marsa-id]')).toHaveCount(2, { timeout: 5000 });
});
