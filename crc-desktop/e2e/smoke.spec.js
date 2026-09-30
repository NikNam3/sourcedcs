'use strict';

/* Does the rig work at all?
 *
 * Deliberately the first spec and deliberately dull: it proves the page loads,
 * authenticates, connects to crc-sync, holds a Position and can put a Strip on
 * the Board. Every other spec assumes all five, so when one of them fails this
 * is the one that says which.
 */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, stripByCallsign } = require('./helpers/app');

test('the panel loads, connects, and a seeded Strip appears', async ({ page }) => {
  const { consoleErrors } = await openPanel(page, { held: ['OPS'] });

  await seedStrip(page, { callsign: 'SMOKE1' });
  await expect(stripByCallsign(page, 'SMOKE1')).toBeVisible();

  // Not a strict gate yet — this prints what the page complains about on a
  // clean run, which is worth knowing before any spec starts asserting on it.
  if (consoleErrors.length) console.log('console errors on a clean load:\n  ' + consoleErrors.join('\n  '));
});
