'use strict';

/* Lane 1 — MARSA behaviour: declaring, the void interlock, the participant
 * highlight, and what SEP REG says about any of it.
 *
 * RECONSTRUCTED. The original lane-1 file was lost when the machine shut down;
 * docs/ui-findings/lane1.md survived with full event traces, and this is built
 * back from them. Every assertion here restates a measurement recorded in that
 * file rather than a fresh claim.
 *
 * All five were catalogued findings and all five are fixed, so nothing here is
 * annotated test.fail() any more and a failure is a regression:
 *   F-110          every click inside the MARSA popover rebuilt it empty
 *                  (the declarer-input half only; see lane1.md on the picker)
 *   F-111          SEP REG never showed MARSA; the server had it, clients did not
 *   extends F-305  the void and the participant highlight were never drawn
 *
 * Runs at 1600x2400, and the F-110 tests open the popover on the LAST Strip
 * in the Bay, so that it is NOT covered. Opened on the first of two Strips,
 * the second Strip's Blocks intercept the click and it times out as F-001 —
 * and a timeout is not converted by test.fail(), so the test would report a
 * failure about the wrong bug.
 *
 * Callsigns are unique per test: the Board lives for the whole run (one
 * crc-sync per run), so a reused callsign finds an earlier test's Strip.
 */

const { test, expect } = require('@playwright/test');
const { openPanel, seedStrip, stripByCallsign } = require('./helpers/app');

test.use({ viewport: { width: 1600, height: 2400 } });

let seq = 0;
const uniqueCallsign = (prefix) => `${prefix}${(Date.now() + seq++) % 10000}`;

/** Two live Strips in the same Bay — the minimum a relation needs. */
async function seedPair(page) {
  const a = uniqueCallsign('TNK');
  const b = uniqueCallsign('VPR');
  await seedStrip(page, { callsign: a, role: 'DEPARTURE' });
  await seedStrip(page, { callsign: b, role: 'DEPARTURE' });
  return { a, b };
}

/** The relation this page's own store holds for a callsign, if any. */
const relationFor = (page, callsign) => page.evaluate((cs) => {
  const strip = [...efspStrips.values()].find(s => efspFdrs.get(s.fdrId).identity.callsign === cs);
  if (!strip) return null;
  const rel = typeof marsaForStrip === 'function' ? marsaForStrip(strip) : null;
  return rel && { state: rel.state, reason: rel.voidReason || null, declaringCallsign: rel.declaringCallsign };
}, callsign);

/** Declare through the page's own send function — the popover cannot (F-110). */
async function declareVia(page, aCallsign, bCallsign, declaringCallsign) {
  await page.evaluate(([csA, csB, declarer]) => {
    const byCs = (cs) => [...efspStrips.values()].find(s => efspFdrs.get(s.fdrId).identity.callsign === cs);
    window.sendEfspMarsaMutation('OPS', undefined, undefined, {
      kind: 'DeclareMarsa',
      participants: [byCs(csA).fdrId, byCs(csB).fdrId],
      startEvent: 'TANKER_ACCEPTED',
      endCondition: 'VERTICALLY_POSITIONED',
      declaringCallsign: declarer,
    });
  }, [aCallsign, bCallsign, declaringCallsign]);
  await expect.poll(() => relationFor(page, aCallsign).then(r => r && r.state)).toBe('ACTIVE');
}

// ── F-110 ────────────────────────────────────────────────────────────────
//
// _openMarsaPopover(strip, anchorEl) does anchorEl.appendChild(popover), and
// anchorEl is the MARSA… <button> whose own click handler opens it. A click
// anywhere inside the popover bubbles to that button, re-runs the handler, and
// builds a fresh empty form. The popover's pointerdown stopPropagation() does
// not help: the rebuild is driven by `click`, not pointerdown.

test('F-110: clicking into the declarer field replaces the field', async ({ page }) => {
  await openPanel(page);
  const { b } = await seedPair(page);

  await stripByCallsign(page, b).locator('.efsp-marsa-btn').click();
  const input = page.locator('.efsp-marsa-popover input.efsp-coordinate-note');
  await expect(input).toBeVisible();

  // Identity, not just value: the finding measured the <input> afterwards as a
  // DIFFERENT element, which is what makes typing land nowhere.
  const same = await input.evaluate((el) => { window.__marsaInput = el; return true; });
  expect(same).toBe(true);
  await input.click();
  const stillSameElement = await page.evaluate(() =>
    window.__marsaInput === document.querySelector('.efsp-marsa-popover input.efsp-coordinate-note'));

  expect(stillSameElement, 'the declarer input was replaced by the click that focused it').toBe(true);
});

test('F-110: typing the declarer leaves the field empty', async ({ page }) => {
  await openPanel(page);
  const { b } = await seedPair(page);

  await stripByCallsign(page, b).locator('.efsp-marsa-btn').click();
  const input = page.locator('.efsp-marsa-popover input.efsp-coordinate-note');
  await input.click();
  await page.keyboard.type('SHELL71');

  await expect(page.locator('.efsp-marsa-popover input.efsp-coordinate-note'))
    .toHaveValue('SHELL71');
});

// ── F-111 ────────────────────────────────────────────────────────────────
//
// Declaring writes separationRegime = 'MARSA' server-side via fdrStore.setTofi
// (plan §1c). The delta does not carry it, so every connected client holds
// null until a reload. Guide §4.8.3's "they inherit a lie", in the direction
// it warns about: the Strip says nothing about who is separating the aircraft.

test('F-111: declaring MARSA puts MARSA in SEP REG on this page', async ({ page }) => {
  await openPanel(page);
  const { a, b } = await seedPair(page);
  await declareVia(page, a, b, 'SHELL71');

  const regime = await page.evaluate((cs) => {
    const strip = [...efspStrips.values()].find(s => efspFdrs.get(s.fdrId).identity.callsign === cs);
    return efspFdrs.get(strip.fdrId).tofi && efspFdrs.get(strip.fdrId).tofi.separationRegime;
  }, a);

  expect(regime, 'the server wrote MARSA; this client was never told').toBe('MARSA');
});

// ── extends F-305 ────────────────────────────────────────────────────────
//
// _stripElNeedsRebuild looks only at the Strip's own rev. Two more surfaces of
// that mechanism, and the first is a WP6 acceptance line.

test('extends F-305: the void reaches the declaring controller\'s own Strip', async ({ page }) => {
  await openPanel(page);
  const { a, b } = await seedPair(page);
  await declareVia(page, a, b, 'SHELL71');

  // The interlock: a controller altitude change on a participant before
  // rendezvous voids the relation (plan §13's acceptance line).
  await page.evaluate((cs) => {
    const strip = [...efspStrips.values()].find(s => efspFdrs.get(s.fdrId).identity.callsign === cs);
    // sendEfspMutation is (actingPositionId, strip, op) — three arguments, and
    // the second is the Strip RECORD, which is where the rev is read from. The
    // reconstruction called it with (acting, stripId, rev, op); the op landed
    // in the rev slot, so no SetBlock was ever sent and the interlock never
    // fired. The assertion below was then measuring a relation that was still
    // ACTIVE for the most ordinary reason.
    window.sendEfspMutation('OPS', strip, { kind: 'SetBlock', blockId: '21', value: '5000' });
  }, a);

  await expect.poll(() => relationFor(page, a).then(r => r && r.state)).toBe('VOIDED');

  // A was rebuilt by its own SetBlock ack, BEFORE the efsp-marsa-delta
  // carrying the void arrived — so its badge still reads as armed. Measured at
  // +0.8s, +3s and +8s; it only corrects when something else selects a Strip.
  await page.waitForTimeout(3000);
  const badge = stripByCallsign(page, a).locator('.efsp-marsa-badge');
  await expect(badge, 'the Strip that issued the clearance still says MARSA armed')
    .not.toHaveText(/MARSA\s*⚠/);
});

test('extends F-305: the participant highlight is drawn on the other Strip', async ({ page }) => {
  await openPanel(page);
  const { a, b } = await seedPair(page);
  await declareVia(page, a, b, 'SHELL71');

  await stripByCallsign(page, a).click();

  // §9.2 rule 5. getMarsaHighlightStripIds() holds B's id, but B's element
  // never gets the class: the highlight is client-local state of exactly the
  // kind selection and expansion were given dataset entries for, and has none.
  const held = await page.evaluate((cs) => {
    const strip = [...efspStrips.values()].find(s => efspFdrs.get(s.fdrId).identity.callsign === cs);
    return window.getMarsaHighlightStripIds().includes(strip.stripId);
  }, b);
  expect(held, 'precondition: the highlight set should hold the peer').toBe(true);

  await expect(stripByCallsign(page, b)).toHaveClass(/efsp-strip-marsa-participant/);
});
