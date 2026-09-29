'use strict';

/* The departure clearance chain, walked the way a controller walks it.
 *
 * Each test below was a catalogued finding in docs/ui-findings/lane1.md —
 * F-101 to F-104. All four are fixed and none is annotated test.fail() any
 * more, so a failure here is a regression.
 *
 * Callsigns are unique per test: the Board lives for the whole run, so a reused
 * callsign can find an earlier test's Strip.
 */

const { test, expect } = require('@playwright/test');
const { openPanel, seedStrip, stripByCallsign, expectRefusalIsVisible } = require('./helpers/app');

/** The Strip's server-side placement, read from the page's own state. */
const placement = (page, callsign) => page.evaluate((cs) => {
  const s = [...efspStrips.values()].find(x => efspFdrs.get(x.fdrId).identity.callsign === cs);
  return s ? { bayId: s.bayId, state: s.state } : null;
}, callsign);

async function goBay(page, positionId, bayId) {
  await page.locator(`#efsp-position-tabs .efsp-position-tab[data-position-id=\"${positionId}\"]`).click();
  await page.locator(`#efsp-bay-tabs .efsp-bay-tab[data-bay-id=\"${bayId}\"]`).click();
}

/** Fills one Block through its chip — click, type, Enter — as a controller does. */
async function fillChip(page, strip, label, value) {
  const chip = strip.locator('.efsp-block-chip', { has: page.locator('.efsp-block-label', { hasText: new RegExp(`^${label}$`) }) });
  await chip.locator('.efsp-block').first().click({ timeout: 3000 });
  const input = strip.locator('input.efsp-block-input');
  await input.fill(value);
  await input.press('Enter');
  await expect(chip).toContainText(value);
}

// F-101
test('a double-tap on NLA moves only the Strip that was tapped', async ({ page }) => {
  await openPanel(page, { held: ['OPS', 'CD'] });
  await seedStrip(page, { callsign: 'DTA101', role: 'DEPARTURE' });
  await seedStrip(page, { callsign: 'DTB101', role: 'DEPARTURE' });

  // ops-proposed is shared with every other spec file in the run and the Bay
  // is 269 px tall, so a Strip seeded at the end of a long Rack is below the
  // fold. boundingBox() answers for an off-screen element just the same, and
  // page.mouse.click() then presses whatever is really at those coordinates —
  // which reads as "the tap did nothing" rather than as the aiming error it
  // is. Scroll it into view first, and check the aim before trusting the
  // result. Same reason l3-coordination.spec.js scrolls before it taps.
  const btn = stripByCallsign(page, 'DTA101').locator('.efsp-nla-btn');
  await btn.scrollIntoViewIfNeeded();
  const box = await btn.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  expect(await page.evaluate(([px, py]) => {
    const hit = document.elementFromPoint(px, py);
    return !!hit && !!hit.closest('.efsp-nla-btn');
  }, [x, y]), 'precondition: the tap point is on DTA101\'s NLA button').toBe(true);
  // Two taps at one point, well inside the 400 ms window the guide calls a
  // double-tap. The first Strip transfers away and the Rack reflows under
  // the pointer, which is the whole of the bug.
  await page.mouse.click(x, y);
  await page.waitForTimeout(150);
  await page.mouse.click(x, y);
  await page.waitForTimeout(500);

  expect((await placement(page, 'DTA101')).state).toBe('PENDING_CLEARANCE');
  expect((await placement(page, 'DTB101')).state, 'DTB101 was never tapped').toBe('PROPOSED');
});

// F-102
test('after each NLA the Strip sits in the Bay for its new state', async ({ page }) => {
  await openPanel(page, { held: ['OPS', 'CD'] });
  await seedStrip(page, { callsign: 'VPR102', role: 'DEPARTURE' });
  await stripByCallsign(page, 'VPR102').locator('.efsp-nla-btn').click();
  await expect.poll(async () => (await placement(page, 'VPR102')).state).toBe('PENDING_CLEARANCE');

  await goBay(page, 'CD', 'cd-pending-clearance');
  const strip = stripByCallsign(page, 'VPR102');
  for (const [label, value] of [['ALT', 'FL250'], ['DEP', 'LTAG'], ['DEST', 'LTAG'], ['RTE', 'DCT']]) {
    await fillChip(page, strip, label, value);
  }
  await strip.getByRole('button', { name: 'Mark Cleared' }).click();
  await expect.poll(async () => (await placement(page, 'VPR102')).state).toBe('CLEARED');

  // facility-config.js: cd-cleared { impliesState: 'CLEARED' }.
  expect((await placement(page, 'VPR102')).bayId).toBe('cd-cleared');
});

// F-103
test('a refusal names the Strip it refused', async ({ page }) => {
  // Provoked with a refused SetBlock, not a refused NLA.
  //
  // The original walk pressed Send to Clearance with CD unheld. That route is
  // gone: the server now publishes `strip.nla` ahead of the press, and the
  // panel renders the inhibit reason and DISABLES the button (F-408), so the
  // refusal this test needs can never be raised — the press never happens, and
  // the spec sat on a 20 s timeout, which test.fail() does not convert.
  //
  // A free-text Block is the refusal a controller can still walk into: nothing
  // client-side knows which stereo route names crc-sync has configured, so
  // typing one it does not have is refused on arrival. The finding is
  // unchanged — ATTRIBUTION. Two Strips on screen, one of them refused, and
  // the panel has to say which.
  await openPanel(page, { held: ['OPS'] });
  await seedStrip(page, { callsign: 'RFA103', role: 'DEPARTURE' });
  await seedStrip(page, { callsign: 'RFB103', role: 'DEPARTURE' });
  const refused = stripByCallsign(page, 'RFB103');
  await refused.locator('.efsp-block-9F').click();
  await page.keyboard.type('NOSUCH');
  await page.keyboard.press('Enter');

  await expect(page.locator('#efsp-mutation-error')).not.toBeEmpty();
  const said = await expectRefusalIsVisible(page, 'a STEREO route crc-sync does not have');
  expect(said, 'two Strips on screen, and the refusal does not say which').toContain('RFB103');
  // And on the Board itself, not only in the banner: matching a banner to a
  // Strip by reading callsigns back off the Rack is the work the mark removes.
  await expect(refused).toHaveClass(/efsp-strip-refused/, { timeout: 2000 });
  await expect(stripByCallsign(page, 'RFA103'),
    'a refusal about one Strip marked its neighbour too').not.toHaveClass(/efsp-strip-refused/);
});

// F-104
test("Mark Cleared's refusal names the missing fields", async ({ page }) => {
  await openPanel(page, { held: ['OPS', 'CD'] });
  await seedStrip(page, { callsign: 'VPR104', role: 'DEPARTURE' });
  await stripByCallsign(page, 'VPR104').locator('.efsp-nla-btn').click();
  await expect.poll(async () => (await placement(page, 'VPR104')).state).toBe('PENDING_CLEARANCE');
  await goBay(page, 'CD', 'cd-pending-clearance');

  // The walk changed with F-408, and this reads the answer where it now is.
  //
  // The original press produced a refusal saying only "flight plan
  // incomplete", and the finding was that it never said WHICH fields. That
  // wording is fixed — and the same wording now arrives BEFORE the press:
  // crc-sync publishes `strip.nla`, so the panel disables Mark Cleared and
  // renders the reason rather than letting a controller press a button whose
  // answer is already known. So there is no refusal left to provoke, and the
  // spec asks the same question of the inhibit reason instead.
  //
  // §3.5 rule 2: on the STRIP, not only in the button's `title` — a tooltip
  // has no touch equivalent, and CD works this Bay on a touchscreen.
  const strip = stripByCallsign(page, 'VPR104');
  const nla = strip.getByRole('button', { name: 'Mark Cleared' });
  await expect(nla, 'an empty flight plan cannot be cleared, so this must not look pressable').toBeDisabled();

  const said = (await strip.locator('.efsp-nla-inhibit-reason').textContent() || '').trim();
  expect(said, 'Mark Cleared is inhibited and the Strip does not say why').not.toBe('');
  // Any of the four REQUIRED_FOR_CLEARANCE fields, by field or chip name.
  expect(said).toMatch(/route|RTE|altitude|ALT|departure|DEP|destination|DEST/i);
});
