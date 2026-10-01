'use strict';

/* Lane 4 — Bay density. docs/ui-findings/lane4.md, "Extends F-003" and F-401.
 *
 * The first test is a MEASUREMENT, not an assertion about what the number
 * should be — docs/efsp-wp6-plan.md owns that decision. It passes, and writes
 * the numbers into the test's annotations so a run reports them.
 *
 * Isolation: the crc-sync Board is shared by every spec in a run, and other
 * specs seed Strips into ops-proposed. "Six Strips in the Bay" is only true if
 * the others are out of the way, so they are hidden (display:none) for the
 * measurement. That changes nothing about the six being measured.
 */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip } = require('./helpers/app');

/** Hide every Strip not in `keep`, then count how many of `keep` fit in the Bay. */
async function visibleCount(page, keep) {
  return page.evaluate((keep) => {
    const content = document.querySelector('#efsp-bay-content');
    content.scrollTop = 0;
    const cr = content.getBoundingClientRect();
    let full = 0; let partial = 0; let height = 0;
    for (const el of content.querySelectorAll('.efsp-strip')) {
      const cs = el.querySelector('.efsp-block-1').textContent.trim();
      if (!keep.includes(cs)) { el.style.display = 'none'; continue; }
      el.style.display = '';
    }
    for (const el of content.querySelectorAll('.efsp-strip')) {
      if (el.style.display === 'none') continue;
      const r = el.getBoundingClientRect();
      height = Math.round(r.height);
      if (r.top >= cr.top && r.bottom <= cr.bottom) full++;
      else if (r.top < cr.bottom && r.bottom > cr.top) partial++;
    }
    return { full, partial, stripHeight: height, bayHeight: content.clientHeight };
  }, keep);
}

test('six DEPARTURE Strips: how many are visible, with and without 20/21', async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });

  const shipped = ['L4D1', 'L4D2', 'L4D3', 'L4D4', 'L4D5', 'L4D6'];
  for (const cs of shipped) await seedStrip(page, { callsign: cs, role: 'DEPARTURE' });
  const a = await visibleCount(page, shipped);

  // Strips built from here on use the compact list without 20/21. Existing
  // elements are not rebuilt, which is why this is a second set of six rather
  // than the same six re-measured.
  await page.evaluate(() => {
    COMPACT_BLOCKS_BY_ROLE.DEPARTURE = COMPACT_BLOCKS_BY_ROLE.DEPARTURE.filter((b) => b !== '20' && b !== '21');
  });
  const trimmed = ['L4E1', 'L4E2', 'L4E3', 'L4E4', 'L4E5', 'L4E6'];
  for (const cs of trimmed) await seedStrip(page, { callsign: cs, role: 'DEPARTURE' });
  const b = await visibleCount(page, trimmed);

  const note = (label, m) => `${label}: ${m.full} fully + ${m.partial} partly visible of 6 (Strip ${m.stripHeight}px, Bay ${m.bayHeight}px)`;
  test.info().annotations.push(
    { type: 'density', description: note('as shipped', a) },
    { type: 'density', description: note('without 20/21', b) },
  );
  console.log(note('as shipped', a));
  console.log(note('without 20/21', b));
  expect(a.stripHeight).toBeGreaterThan(0);
  expect(b.stripHeight).toBeGreaterThan(0);
});

// F-401 — fixed. Five status surfaces used to reserve 68px while empty.
test('an empty status line takes no height', async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  const reserved = await page.evaluate(() => [
    '#efsp-connection-banner', '#efsp-correlation-rate', '#efsp-mutation-error',
    '#efsp-mutation-warning', '#efsp-dot-command-preview',
  ].map((sel) => {
    const el = document.querySelector(sel);
    return { sel, text: (el.textContent || '').trim(), h: Math.round(el.getBoundingClientRect().height) };
  }).filter((x) => x.text === '' && x.h > 0));
  expect(reserved, `empty but taking height: ${JSON.stringify(reserved)}`).toEqual([]);
});
