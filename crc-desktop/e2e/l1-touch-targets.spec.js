'use strict';

/* Touch-target sizes on a Strip — WP3's 44x44 CSS px criterion, measured.
 *
 * F-105 in docs/ui-findings/lane1.md, fixed: trailing-row controls have a real
 * 44x44 border box now, and expectTouchTarget enforces the criterion it names
 * — both dimensions, at 44, rather than the 32-on-height tripwire it started
 * as. The two chip-internal controls still under it (⌿ and *) are deliberate
 * exceptions and keep their annotations in l2-block-editing.spec.js.
 */

const { test } = require('@playwright/test');
const { openPanel, seedStrip, expectTouchTarget, stripMenuItem } = require('./helpers/app');

// Layout C (docs/adr/0056): MARSA… is a ⋯ menu item now, so both the opener
// and the item it leads to have to meet the floor.
test('the ⋯ menu and its MARSA… item meet the touch-target floor', async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  const strip = await seedStrip(page, { callsign: 'VIPER11', role: 'DEPARTURE' });
  await expectTouchTarget(strip.locator('.efsp-strip-menu-btn'), '⋯');
  await expectTouchTarget(await stripMenuItem(strip, 'MARSA…'), 'MARSA… (⋯ menu item)');
});
