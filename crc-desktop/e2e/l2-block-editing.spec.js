'use strict';

/* Lane 2 — Block editing and the expanded view.
 *
 * F-201..F-208 (docs/ui-findings/lane2.md) are fixed, so most of this file is
 * ordinary passing tests and a failure in one is a regression. THREE keep
 * their test.fail(), and none of the three is an open bug — each says at its
 * own site what decision it is recording: the ⌿ and * touch targets are
 * deliberate chip-layout exceptions, and F-208's Block-Map-order rows are the
 * finding's own "taste or workflow, not a defect".
 *
 * The Board is shared across every test in a run (one crc-sync), so each test
 * seeds its own callsigns — reusing one makes stripByCallsign() pick up a
 * Strip left behind by an earlier test.
 *
 * Most of the keyboard findings shared one mechanism, worth knowing before
 * reading them one at a time:
 *   - the Strip element has its own keydown handler (_onStripKeydown) that
 *     preventDefault()s Space and Enter and toggles selection, and nothing
 *     inside the Strip stopped those keys bubbling to it;
 *   - renderBay() used to end by re-focusing the STRIP element that contained
 *     document.activeElement — so any render while a Block input had focus
 *     moved focus off the input onto the Strip.
 */

const { test, expect } = require('@playwright/test');
const { openPanel, seedStrip, stripByCallsign, expectTouchTarget, startAction } = require('./helpers/app');

// Candidate for the shared helper: what has keyboard focus, as tag.class.
const focused = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return a ? `${a.tagName.toLowerCase()}.${String(a.className).split(/\s+/)[0]}` : null;
});

// Candidate for the shared helper: a SetBlock through the page's own send
// function, reading the live Strip for its rev.
async function setBlockVia(page, stripId, blockId, value, acting = 'OPS') {
  await page.evaluate(([id, b, v, a]) => {
    window.sendEfspMutation(a, window.getEfspStrip(id), { kind: 'SetBlock', blockId: b, value: v });
  }, [stripId, blockId, value, acting]);
}

// Somewhere inside the panel that is not a control — a click here blurs
// whatever is focused without starting anything else.
const clickAway = (page) => page.locator('#efsp-bay-content').click({ position: { x: 5, y: 5 } });

// ── F-201 ────────────────────────────────────────────────────────────────

test('F-201: a space can be typed into a free-text Block', async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  const s = await seedStrip(page, { callsign: 'SPC201' });
  await s.locator('.efsp-block-9').click();
  const input = s.locator('input.efsp-block-input');
  await expect(input).toBeFocused();
  await page.keyboard.type('DCT ALPHA DCT');
  // Measured: "DCTALP" — the space is swallowed, focus lands on the Strip one
  // frame later, and everything typed after that goes nowhere.
  await expect(input).toHaveValue('DCT ALPHA DCT', { timeout: 1000 });
});

test('F-201: a space can be typed into a text input inside a Strip popover', async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  const s = await seedStrip(page, { callsign: 'SPC202' });
  await seedStrip(page, { callsign: 'SPC203' });
  await startAction(s, 'MARSA…');
  const note = page.locator('.efsp-marsa-popover input').first();
  await note.focus();
  await page.keyboard.type('AR TRACK');
  // Measured: "AR".
  await expect(note).toHaveValue('AR TRACK', { timeout: 1000 });
});

// ── F-202 ────────────────────────────────────────────────────────────────

test('F-202: a half-typed Block keeps focus when another controller updates a different Strip', async ({ page, browser }) => {
  await openPanel(page, { held: ['OPS'] });
  const mine = await seedStrip(page, { callsign: 'FOC201' });
  const other = await seedStrip(page, { callsign: 'FOC202' });
  const otherId = await other.getAttribute('data-strip-id');

  // A second controller at CD, in its own browser context — the case a real
  // Board produces constantly, and the DOM-stub suite cannot reach. (A second
  // holder of OPS is not Primary and every edit it sends is refused.)
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  try {
    await openPanel(page2, { held: ['CD'], controller: 'e2e-second' });
    // Hand FOC202 to CD, so the update below is to a Strip this controller
    // is not even looking at any more.
    await page.evaluate((i) => window.sendEfspMutation('OPS', window.getEfspStrip(i), { kind: 'InvokeNla' }), otherId);
    await expect.poll(() => page2.evaluate((i) => (window.getEfspStrip(i) || {}).ownerPositionId, otherId)).toBe('CD');

    await mine.locator('.efsp-block-7').click();
    const input = mine.locator('input.efsp-block-input');
    await page.keyboard.type('FL3');

    await setBlockVia(page2, otherId, '8', 'LTAG', 'CD');
    await expect.poll(() => page.evaluate((i) => window.getEfspFdr(window.getEfspStrip(i).fdrId).filed.departureAirport, otherId)).toBe('LTAG');
    await page.waitForTimeout(100); // one rAF for the batched render

    // Measured: focus is now div.efsp-strip — FOC201's own Strip element.
    expect(await focused(page), 'focus left the input on an unrelated update').toBe('input.efsp-block-input');
    await page.keyboard.type('50');
    await expect(input).toHaveValue('FL350', { timeout: 1000 });
  } finally {
    await ctx2.close();
  }
});

// ── F-203 ────────────────────────────────────────────────────────────────

test('F-203: Enter commits the Block and does nothing else to the Strip', async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  const s = await seedStrip(page, { callsign: 'ENT201' });
  await expect(s).not.toHaveClass(/efsp-strip-selected/);
  await s.locator('.efsp-block-7').click();
  await page.keyboard.type('FL350');
  await page.keyboard.press('Enter');
  await expect(s.locator('.efsp-block-7')).toHaveText('FL350');
  // Measured: the Strip is now selected — Enter bubbled to _onStripKeydown.
  await expect(s).not.toHaveClass(/efsp-strip-selected/, { timeout: 1000 });
});

// ── F-204 ────────────────────────────────────────────────────────────────

test('F-204: a Strip with an abandoned Block edit still shows other changes to it', async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  const s = await seedStrip(page, { callsign: 'FRZ201' });
  const id = await s.getAttribute('data-strip-id');
  await s.locator('.efsp-block-7').click();
  await page.keyboard.type('FL3');
  await clickAway(page);
  // Blur correctly does not commit — and the input stays open indefinitely.
  await expect(s.locator('input.efsp-block-input')).toHaveCount(1);

  await setBlockVia(page, id, '8', 'LTAG');
  await expect.poll(() => page.evaluate((i) => window.getEfspFdr(window.getEfspStrip(i).fdrId).filed.departureAirport, id)).toBe('LTAG');
  // Measured: DEP stays blank; data-rev on the element stays at the old rev.
  await expect(s.locator('.efsp-block-8')).toHaveText('LTAG', { timeout: 2000 });
});

test('F-204: a Strip with an abandoned Block edit leaves the Bay when it is transferred', async ({ page }) => {
  await openPanel(page, { held: ['OPS', 'CD'] });
  const s = await seedStrip(page, { callsign: 'FRZ202' });
  const id = await s.getAttribute('data-strip-id');
  await s.locator('.efsp-block-7').click();
  await page.keyboard.type('FL3');
  await clickAway(page);

  await page.evaluate((i) => window.sendEfspMutation('OPS', window.getEfspStrip(i), { kind: 'InvokeNla' }), id);
  await expect.poll(() => page.evaluate((i) => window.getEfspStrip(i).bayId, id)).toBe('cd-pending-clearance');
  // Measured: still drawn in ops-proposed, still offering "Send to Clearance",
  // and pressing it comes back STALE_REV.
  await expect(page.locator(`#efsp-bay-content .efsp-strip[data-strip-id="${id}"]`)).toHaveCount(0, { timeout: 2000 });
});

test('F-204: starting a second Block edit closes the first', async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  const s = await seedStrip(page, { callsign: 'FRZ203' });
  await s.locator('.efsp-block-7').click();
  await s.locator('.efsp-block-8').click();
  // _buildBlockCell's comment says starting a new edit reverts any other.
  // Measured: 2.
  await expect(s.locator('input.efsp-block-input')).toHaveCount(1, { timeout: 1000 });
});

// ── the rule that holds (§3.7 rule 5 / §7.4 rule 2) ──────────────────────

test('blur neither commits nor reverts a free-text Block', async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  const s = await seedStrip(page, { callsign: 'BLR201' });
  await page.evaluate(() => {
    window.__l2Sent = [];
    const orig = window.sendEfspMutation;
    window.sendEfspMutation = (...a) => { window.__l2Sent.push(a[2]); return orig(...a); };
  });
  await s.locator('.efsp-block-7').click();
  await page.keyboard.type('FL350');
  await clickAway(page);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__l2Sent), 'blur sent a Mutation').toEqual([]);
  await expect(s.locator('input.efsp-block-input'), 'blur reverted the edit').toHaveValue('FL350');
  // (That the input then stays open, and what that costs, is F-204.)
});

// ── F-205 ────────────────────────────────────────────────────────────────

test('F-205: arrowing through an enum Block does not commit until the controller chooses', async ({ page }) => {
  // A CTR arrival: 5A and RADAR are CTR's fields, not OPS's (docs/adr/0056).
  await openPanel(page, { held: ['CTR'], facilityId: 'CENTER', controller: 'ctr-controller' });
  const s = await seedStrip(page, { callsign: 'ENM201', actingPositionId: 'CTR', bayId: 'ctr-enroute', role: 'ARRIVAL', facilityId: 'CENTER' });
  await page.evaluate(() => {
    window.__l2Sent = [];
    const orig = window.sendEfspMutation;
    window.sendEfspMutation = (...a) => { window.__l2Sent.push(a[2]); return orig(...a); };
  });
  await s.locator('.efsp-block-5A').click();
  await expect(s.locator('select.efsp-block-enum-select')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  // Measured: [{kind:'SetBlock', blockId:'5A', value:'CST'}] — sent on the
  // first arrow press, and the select is gone.
  expect(await page.evaluate(() => window.__l2Sent)).toEqual([]);
});

test('F-205: Space opens the enum select rather than leaving it', async ({ page }) => {
  // A CTR arrival: 5A and RADAR are CTR's fields, not OPS's (docs/adr/0056).
  await openPanel(page, { held: ['CTR'], facilityId: 'CENTER', controller: 'ctr-controller' });
  const s = await seedStrip(page, { callsign: 'ENM202', actingPositionId: 'CTR', bayId: 'ctr-enroute', role: 'ARRIVAL', facilityId: 'CENTER' });
  await s.locator('.efsp-block-5A').click();
  await expect(s.locator('select.efsp-block-enum-select')).toBeFocused();
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  // Measured: the select is gone and focus is on the Strip.
  await expect(s.locator('select.efsp-block-enum-select')).toBeFocused({ timeout: 1000 });
});

// ── F-206 ────────────────────────────────────────────────────────────────

test('F-206: choosing "—" on a set enum Block clears it', async ({ page }) => {
  // A CTR arrival: 5A and RADAR are CTR's fields, not OPS's (docs/adr/0056).
  await openPanel(page, { held: ['CTR'], facilityId: 'CENTER', controller: 'ctr-controller' });
  const s = await seedStrip(page, { callsign: 'ENM203', actingPositionId: 'CTR', bayId: 'ctr-enroute', role: 'ARRIVAL', facilityId: 'CENTER' });
  // RADAR, not 5A. The original walk used 5A and could never have passed:
  // strip-template.js's ENUM_CLEARABLE_BLOCKS carries the SERVER's per-Block
  // answer to "may this be cleared", and 5A's cleared value is the option
  // NONE — so "—" is correctly not offered on it once it has a value. RSVC and
  // SREG are the two Blocks where blank is a real state the server accepts
  // (setTofi normalizes the '' a <select> sends to null). RSVC rather than
  // SREG because clearing SREG is refused while an ACTIVE MARSA relation
  // holds the flight, which is a different finding's business.
  await s.locator('.efsp-block-RSVC').click();
  await s.locator('select.efsp-block-enum-select').selectOption('ACTIVE');
  await expect(s.locator('.efsp-block-RSVC')).toHaveText('ACTIVE');

  await s.locator('.efsp-block-RSVC').click();
  // Measured before the fix: nothing sent, the select closed, the Block still
  // read ACTIVE — the change handler returned early on an empty value, so "—"
  // was an enabled choice that did nothing (standing rule 1).
  await s.locator('select.efsp-block-enum-select').selectOption('');
  await expect(s.locator('.efsp-block-RSVC')).toHaveText('', { timeout: 2000 });
});

// ── F-207 (extends F-103) ────────────────────────────────────────────────

test('F-207: a refused Block edit keeps what was typed and marks the Block', async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  const s = await seedStrip(page, { callsign: 'REF201' });
  // Block 6 (PROP DEP), not 9F: 9F became a picker of the configured routes
  // (crc-sync's docs/adr/0073), so nothing can be typed into it. Since F4 a
  // time Block refuses anything that is not HHMM, which keeps this finding's
  // meaning — a refused free-text edit on the OPS face.
  await s.locator('.efsp-block-6').click();
  await page.keyboard.type('NOSUCH');
  await page.keyboard.press('Enter');
  await expect(page.locator('#efsp-mutation-error')).toContainText('proposed departure time must be a UTC time as HHMM');
  // Measured before the fix: the input closed on Enter before the reply; the
  // Block read "" with no marker, and NOSUCH existed nowhere on screen.
  //
  // The refused text now comes back in a REOPENED editor, so it lives in an
  // <input value> — which textContent cannot see, and toContainText() reads
  // textContent. Asking the input for its value is the same claim ("NOSUCH is
  // still on screen where the controller left it") measured where it now is.
  //
  // The chip is found by its LABEL, not by `has: .efsp-block-6`: the reopened
  // editor replaces that span with the <input>, so a locator that filters on
  // the span matches no chip at all once the fix works.
  const chip = s.locator('.efsp-block-chip', { has: page.locator('.efsp-block-label', { hasText: /^PROP DEP$/ }) });
  await expect(chip.locator('input.efsp-block-input')).toHaveValue('NOSUCH', { timeout: 1000 });
  // And the Strip carries the refusal, so the banner does not have to be
  // matched to a Rack by eye (F-103). The CELL mark lives on the span the
  // reopened editor is standing in for, so it is the Strip outline that is on
  // screen while the controller is looking at what they typed.
  await expect(s).toHaveClass(/efsp-strip-refused/);
});

// ── extends F-105 — the two KNOWN, DELIBERATE exceptions ─────────────────
//
// These two stay test.fail() with F-105 landed, and the annotation is the
// record of a decision rather than of an open bug. Both controls live INSIDE a
// Block chip, 2 px from the editable value cell they belong to; grown to a
// full 44 in the dimension that is short, each would overlap that cell and
// start swallowing clicks meant to open its editor — trading a control that is
// small for a control that steals another one's presses, which is worse.
//
// Closing them needs the chip layout to change (the value cell and its chip
// actions would have to stop sharing a line), which is a design change, not a
// size tweak. Until that happens these are exceptions, and expectTouchTarget
// enforces the real 44x44 on everything else. Do NOT relax the assertion to
// make them green: the measurement is the record.

test.fail('extends F-105: the ⌿ confirm-vacated button meets the touch floor', async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  const s = await seedStrip(page, { callsign: 'TCH201' });
  await setBlockVia(page, await s.getAttribute('data-strip-id'), '21', '5000');
  const btn = s.locator('.efsp-confirm-vacated-btn');
  await expect(btn).toBeVisible();
  // It works (walked by hand: one press strikes the entry); size is the finding.
  // Measured: 20x20 before F-105, 32x44 after — still 12 px short on width,
  // deliberately, because 44 would reach onto Block 21's value cell.
  await expectTouchTarget(btn, '⌿');
});

test.fail('extends F-105: the * history overflow meets the touch floor', async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  const s = await seedStrip(page, { callsign: 'TCH202' });
  const id = await s.getAttribute('data-strip-id');
  for (const v of ['1000', '2000', '3000', '4000']) {
    await setBlockVia(page, id, '21', v);
    await expect(s.locator('.efsp-block-21')).toHaveText(v);
  }
  const star = s.locator('.efsp-annotation-overflow');
  await expect(star).toBeVisible();
  // Measured: 14x22 before F-105, 26x32 after — short in both dimensions, for
  // the same reason as ⌿ above and pending the same chip-layout change.
  await expectTouchTarget(star, '*');
});

// ── F-208 ────────────────────────────────────────────────────────────────

// STILL test.fail(), and deliberately so: this one records a NON-DEFECT.
//
// The three Block-Map-order rows it objects to (26 NLA, 2 REV, 4A RMV) were
// reviewed with the rest of F-208 and the finding itself settles it as "taste
// or workflow, not a defect" — the expanded view is the Block Map, and a row
// that is a label with its control living on the Strip is still the Map saying
// that Block exists. So the code was deliberately left alone, and the
// annotation stays as the record of that call, not as an open bug. Its sibling
// below (the collapse control) WAS a defect and is fixed.
test.fail('F-208: the expanded view lists only Blocks it can show something for', async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  const s = await seedStrip(page, { callsign: 'EXP201' });
  await s.locator('.efsp-expand-btn').click();
  const exp = s.locator('.efsp-strip-expanded');
  await expect(exp).toBeVisible();
  // Block 26 is the NLA button, already on the Strip; its row is a label
  // with nothing beside it. Measured: present, and intended to be.
  await expect(exp.locator('[data-expanded-block="26"]')).toHaveCount(0, { timeout: 1000 });
});

test('F-208: the collapse control is reachable while reading the bottom of the expanded view', async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  const s = await seedStrip(page, { callsign: 'EXP202' });
  await s.locator('.efsp-expand-btn').click();
  const last = s.locator('.efsp-expanded-row').last();
  await last.scrollIntoViewIfNeeded();
  const bay = await page.locator('#efsp-bay-content').boundingBox();
  const btn = await s.locator('.efsp-expand-btn').boundingBox();
  // Measured at 1600x1000: Strip 140px -> 684px expanded, Bay viewport 201px,
  // and the ▲ sits in the actions row ABOVE the 22 expanded rows.
  expect(btn.y >= bay.y && btn.y + btn.height <= bay.y + bay.height,
    `▲ at y=${Math.round(btn.y)}, Bay viewport y=${Math.round(bay.y)}..${Math.round(bay.y + bay.height)}`).toBe(true);
});
