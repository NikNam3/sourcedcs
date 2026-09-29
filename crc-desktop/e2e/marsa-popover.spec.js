'use strict';

/* The MARSA popover, reported as "vanishing behind other strips".
 *
 * This is the bug class the DOM-stub suite is structurally blind to: those
 * tests assert the popover element exists and dispatches the right op, and it
 * does both while being painted underneath everything around it.
 *
 * FIXED — all three are ordinary passing tests now and a failure here is a
 * regression. The measured cause, kept because it explains the shape of the
 * fix and what to check if this ever comes back:
 *
 *   .efsp-strip carries `contain: layout style`, and `contain: layout`
 *   CREATES A STACKING CONTEXT. So .efsp-coordinate-popover's `z-index: 50`
 *   competed only INSIDE its own Strip; the Strip itself is `z-index: auto`,
 *   so anything outside it painted on top. Measured: the popover sat at
 *   y=430..492 and #efsp-dot-command-input (y=456..500, full width) was what
 *   document.elementFromPoint returned at its centre.
 *
 * The CSS comment on that rule records `contain: paint` being dropped because
 * it CLIPPED popovers. That fixed the visible half and left this one: the
 * popover was no longer clipped, just underneath. It affected all six
 * popovers, not only MARSA, and the popovers are portalled out of the Strip
 * now (bay-view.js's _mountPopover).
 */

const { test, expect } = require('@playwright/test');
const { openPanel, seedStrip, stripByCallsign, expectOnTop, expectDoesSomething, startAction } = require('./helpers/app');

/** The stripIds THIS test seeded — what afterEach is allowed to retire. */
let seeded = [];

test.beforeEach(async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  // Three Strips, because one Strip cannot be behind anything. The reported
  // symptom needs a neighbour below it in the same Rack.
  const before = await page.evaluate(() => getAllEfspStrips().map((s) => s.stripId));
  await seedStrip(page, { callsign: 'SHELL71' });
  await seedStrip(page, { callsign: 'VIPER11' });
  await seedStrip(page, { callsign: 'VIPER12' });
  // Read back by DIFFERENCE rather than by callsign: stripByCallsign() takes
  // .first(), and l1-touch-targets.spec.js has its own VIPER11 sitting earlier
  // in this Bay, so a callsign lookup would hand back its Strip instead.
  seeded = await page.evaluate((had) => getAllEfspStrips()
    .filter((s) => !had.includes(s.stripId)).map((s) => s.stripId), before);
});

// The Board is one crc-sync for the whole RUN. The declare test below leaves a
// MARSA relation ACTIVE on two of these three, and a relation left standing is
// visible to every spec file that runs after this one — dropping the Strips
// retires it (board-store's _retireStrip releases the FDR, which ends the
// relation with it). Same reason l4-drag.spec.js drops what it creates.
//
// By stripId, not by callsign: l1-touch-targets.spec.js seeds its own VIPER11
// into the same Bay, and a callsign-matched cleanup would retire another spec
// file's Strip — the exact leak this hook exists to stop, pointed the other way.
test.afterEach(async ({ page }) => {
  await page.evaluate((ids) => {
    for (const id of ids) {
      const s = getEfspStrip(id);
      if (!s || s.state === 'DROPPED') continue;
      sendEfspMutation(s.ownerPositionId, s, { kind: 'DropStrip', reason: 'e2e cleanup' });
    }
  }, seeded);
  await page.waitForTimeout(400);
});

test('the MARSA popover is on top of the Strips below it', async ({ page }) => {
  const tanker = stripByCallsign(page, 'SHELL71');
  await startAction(tanker, 'MARSA…');

  const popover = page.locator('.efsp-marsa-popover');
  await expect(popover).toBeVisible();
  // toBeVisible() only means "has a box and is not hidden" — it passes
  // happily on an element rendered underneath another. This asks the document
  // what is actually at the popover's centre.
  await expectOnTop(page, popover, 'the MARSA popover');
});

test('every control inside the MARSA popover is reachable, not just present', async ({ page }) => {
  const tanker = stripByCallsign(page, 'SHELL71');
  await startAction(tanker, 'MARSA…');
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

test('declaring MARSA from the popover actually declares it', async ({ page }) => {
  const tanker = stripByCallsign(page, 'SHELL71');
  await startAction(tanker, 'MARSA…');
  const popover = page.locator('.efsp-marsa-popover');
  await expect(popover).toBeVisible();

  await popover.locator('input.efsp-coordinate-note').fill('SHELL71');
  // Pick the receiver rather than take whatever the form defaults to.
  // _marsaCandidates offers EVERY live flight on the Board, and the Board is
  // one crc-sync for the whole run — so the first candidate is some other spec
  // file's Strip, quite possibly in a Bay this page is not even showing.
  await popover.locator('select').first().selectOption({ label: 'VIPER12' });

  await expectDoesSomething(page, popover.getByRole('button', { name: 'Declare' }), 'MARSA Declare');

  // And the relation lands on BOTH participants — §9.2 rule 5's whole point.
  //
  // Asserted on those two Strips, not as a page-wide count. Any relation
  // another spec file left ACTIVE is still drawn here, so a board-wide
  // toHaveCount(2) was counting four badges the moment l4-badges.spec.js ran
  // first — and the run order is not fixed.
  await expect(stripByCallsign(page, 'SHELL71').locator('.efsp-marsa-badge'),
    'the tanker carries no MARSA badge').toHaveCount(1, { timeout: 5000 });
  await expect(stripByCallsign(page, 'VIPER12').locator('.efsp-marsa-badge'),
    'the receiver carries no MARSA badge').toHaveCount(1, { timeout: 5000 });
});
