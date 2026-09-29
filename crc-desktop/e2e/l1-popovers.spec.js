'use strict';

/* Lane 1 — the six Strip popovers: highlight, MARSA, coordinate, airspace
 * entry, TOFI, bind.
 *
 * Every test here was once a catalogued finding in docs/ui-findings/lane1.md —
 * extends F-001 (every popover covered), F-107 (acting after the Strip changed
 * underneath -> STALE_REV), F-108 (closing without acting leaves the Strip
 * stale), F-109 (Escape closes none of them), extends F-305 (NO TRK / Bind…
 * never appear until the Strip is touched) and extends F-201 (keystrokes into
 * a popover field). All of them are fixed, so nothing in this file is
 * annotated test.fail() any more: these are ordinary passing tests and a
 * failure here is a regression.
 *
 * Everything except the F-001 block runs at 1600x2400, so that the popover is
 * NOT covered and a failure is about the behaviour under test rather than
 * F-001 again.
 *
 * Callsigns are unique per test: the Board lives for the whole run (one
 * crc-sync per run), so a reused callsign finds an earlier test's Strip.
 */

const { test, expect } = require('@playwright/test');
const { openPanel, seedStrip, stripByCallsign, expectOnTop, startAction, stripMenuItem } = require('./helpers/app');

let seq = 0;
const uniqueCallsign = (prefix) => `${prefix}${(Date.now() + seq++) % 10000}`;

async function goBay(page, positionId, bayId) {
  await page.locator('#efsp-position-tabs .efsp-position-tab', { hasText: new RegExp(`^${positionId}$`) }).click();
  await page.locator('#efsp-bay-tabs .efsp-bay-tab', { hasText: new RegExp(`^${bayId}$`) }).click();
}

/** The server-side Strip for a callsign, as the page's own state has it. */
const serverStrip = (page, callsign) => page.evaluate((cs) => {
  const s = [...efspStrips.values()].find(x => efspFdrs.get(x.fdrId).identity.callsign === cs);
  return s && { rev: s.rev, flags: s.flags, tofi: s.tofiCoordination && s.tofiCoordination.state,
    coordination: s.coordination && s.coordination.state, airspace: s.airspaceEntry && s.airspaceEntry.airspaceId };
}, callsign);

/** Another controller's update to this Strip, through the real send path. */
const remoteOffset = (page, callsign) => page.evaluate((cs) => {
  const s = [...efspStrips.values()].find(x => efspFdrs.get(x.fdrId).identity.callsign === cs);
  sendEfspMutation(s.ownerPositionId, s, { kind: 'SetFlag', flag: 'offset', value: !s.flags.offset });
}, callsign);

// crc-sync reads airspaces once at startup and the harness seeds `[]`, with no
// runtime route to add one. The popover's layout, dismissal and dispatch are
// all client-side, so one airspace in the page's own state is enough to
// render its <select> and button. The server will not know it — any spec
// here that needs the entry APPLIED must not rely on this.
const injectAirspace = (page) => page.evaluate(() => efspAirspaces.set('R-L1', {
  airspaceId: 'R-L1', rev: 1, state: 'ACTIVE', definition: { name: 'R-L1', controlFrequencyMhz: 251.0 },
}));

const POPOVERS = {
  highlight: {
    facilityId: 'INCIRLIK', positionId: 'APP', bayId: 'app-inbound', selector: '.efsp-highlight-popover',
    open: (strip) => strip.click({ button: 'right', position: { x: 3, y: 3 } }),
    act: (pop) => pop.locator('button').first(),
  },
  MARSA: {
    facilityId: 'INCIRLIK', positionId: 'APP', bayId: 'app-inbound', selector: '.efsp-marsa-popover',
    open: (strip) => startAction(strip, 'MARSA…', { timeout: 3000 }),
  },
  coordinate: {
    facilityId: 'INCIRLIK', positionId: 'APP', bayId: 'app-inbound', selector: '.efsp-coordinate-popover',
    open: (strip) => startAction(strip, 'Coordinate…', { timeout: 3000 }),
    act: (pop) => pop.getByRole('button', { name: 'Send' }),
  },
  airspace: {
    facilityId: 'INCIRLIK', positionId: 'APP', bayId: 'app-inbound', selector: '.efsp-coordinate-popover', inject: true,
    open: (strip) => startAction(strip, 'Airspace…', { timeout: 3000 }),
    act: (pop) => pop.getByRole('button', { name: 'Approve entry' }),
  },
  TOFI: {
    facilityId: 'CENTER', positionId: 'CTR', bayId: 'ctr-enroute', selector: '.efsp-coordinate-popover',
    open: (strip) => startAction(strip, 'TOFI…', { timeout: 3000 }),
    act: (pop) => pop.getByRole('button', { name: 'Send TOFI' }),
  },
  bind: {
    facilityId: 'INCIRLIK', positionId: 'APP', bayId: 'app-inbound', selector: '.efsp-coordinate-popover',
    // Bind… is drawn from the correlation record, which arrives after the
    // Strip and does not move its rev — so the Strip is never rebuilt to show
    // it (extends F-305, tested on its own below). Selecting the Strip forces
    // the rebuild, so the popover itself can be tested past that.
    open: async (strip) => {
      await expect.poll(() => strip.evaluate((el) => {
        const s = getEfspStrip(el.dataset.stripId);
        const r = getEfspCorrelationForStrip(s);
        return r && r.state;
      }), { timeout: 10000 }).toBe('UNCORRELATED');
      await strip.click({ position: { x: 3, y: 3 } });
      await startAction(strip, 'Bind…');
    },
  },
};

/**
 * Drops every Strip left in this Bay by earlier tests that CAN be dropped.
 *
 * The Board outlives a test, so a Bay fills up across a run, and a fresh Strip
 * seeded at the END of a long Rack opens its popover off the bottom of the
 * panel — which is F-001's spill, not whatever this spec is testing. A local
 * helper rather than a shared one (lane protocol); it may belong in
 * helpers/app.js.
 *
 * It does not insist the Bay ends up EMPTY, and must not: a Strip carrying an
 * open coordination or TOFI proposal is undroppable by design (board-store.js
 * refuses "cannot drop a Strip with an open coordination proposal"), and there
 * is no withdraw — only the RECEIVING controller can resolve one, and this page
 * does not hold their Position. The F-107 coordinate case ends by pressing
 * Send, so it leaves exactly such a Strip in app-inbound; insisting on 0 then
 * failed the next two tests to use that Bay (airspace, highlight) inside this
 * helper, 20 lines before the assertion they exist to make. One leftover Strip
 * above the seeded one is harmless at this describe's 2400px viewport.
 */
async function clearBay(page, bayId) {
  await page.evaluate((bay) => {
    for (const s of efspStrips.values()) {
      if (s.bayId === bay && s.state !== 'DROPPED') sendEfspMutation(s.ownerPositionId, s, { kind: 'DropStrip', reason: 'e2e: clearing the Bay' });
    }
  }, bayId);
  await expect.poll(() => page.evaluate((bay) => {
    const openProposal = (s) => (s.coordination && s.coordination.state === 'PROPOSED')
      || (s.tofiCoordination && s.tofiCoordination.state === 'PROPOSED');
    return [...efspStrips.values()].filter(s => s.bayId === bay && s.state !== 'DROPPED' && !openProposal(s)).length;
  }, bayId)).toBe(0);
}

/** Opens the panel at the popover's Position, seeds `count` Strips, opens the popover on the first. */
async function openPopoverOn(page, name, count) {
  const P = POPOVERS[name];
  await openPanel(page, { held: [P.positionId], facilityId: P.facilityId });
  await goBay(page, P.positionId, P.bayId);
  await clearBay(page, P.bayId);
  if (P.inject) await injectAirspace(page);
  const callsigns = Array.from({ length: count }, () => uniqueCallsign('L'));
  for (const callsign of callsigns) {
    await seedStrip(page, { callsign, role: 'ARRIVAL', bayId: P.bayId, actingPositionId: P.positionId, facilityId: P.facilityId });
  }
  const strip = stripByCallsign(page, callsigns[0]);
  await P.open(strip);
  const popover = page.locator(P.selector).last();
  await expect(popover).toBeAttached();
  return { P, strip, popover, callsign: callsigns[0] };
}

// ── extends F-001 ─────────────────────────────────────────────────────────
test.describe('extends F-001', () => {
  for (const name of Object.keys(POPOVERS)) {
    test(`extends F-001: the ${name} popover is on top`, async ({ page }) => {
      // Three Strips: one Strip cannot be behind anything.
      const { popover } = await openPopoverOn(page, name, 3);
      await expectOnTop(page, popover, `the ${name} popover`);
    });
  }
});

test.describe('with room to be uncovered', () => {
  test.use({ viewport: { width: 1600, height: 2400 } });

  // ── F-109 ─────────────────────────────────────────────────────────────
  for (const name of Object.keys(POPOVERS)) {
    test(`Escape closes the ${name} popover`, async ({ page }) => {
      const { P } = await openPopoverOn(page, name, 1);
      await page.keyboard.press('Escape');
      await expect(page.locator(P.selector)).toHaveCount(0);
    });
  }

  // ── F-107 ─────────────────────────────────────────────────────────────
  for (const name of ['coordinate', 'airspace', 'TOFI', 'highlight']) {
    test(`a popover still works after its Strip changed underneath it — ${name}`, async ({ page }) => {
      const { P, popover, callsign } = await openPopoverOn(page, name, 1);
      const button = P.act(popover);
      await expectOnTop(page, button, `${name}'s action`); // not F-001: this must be reachable

      await remoteOffset(page, callsign);
      await expect.poll(async () => (await serverStrip(page, callsign)).rev).toBe(2);
      await expect(popover, 'protection keeps the popover open through the update').toBeAttached();

      await button.click({ timeout: 3000 });
      await page.waitForTimeout(600);
      const error = (await page.locator('#efsp-mutation-error').textContent()) || '';
      expect(error, `${name}: refused for acting on the rev captured when the popover opened`).not.toContain('STALE_REV');
    });
  }

  // ── F-108 ─────────────────────────────────────────────────────────────
  test('a Strip catches up once its popover closes', async ({ page }) => {
    const { P, callsign } = await openPopoverOn(page, 'highlight', 1);
    await remoteOffset(page, callsign);
    await expect.poll(async () => (await serverStrip(page, callsign)).flags.offset).toBe(true);

    await page.mouse.click(1590, 2390); // outside — close without acting
    await expect(page.locator(P.selector)).toHaveCount(0);
    await expect(stripByCallsign(page, callsign), 'still drawn un-offset after the popover closed')
      .toHaveClass(/efsp-strip-offset/, { timeout: 3000 });
  });
});

// ── extends F-305 ────────────────────────────────────────────────────────
test('extends F-305: an uncorrelated flight shows NO TRK and Bind… on its own', async ({ page }) => {
  await openPanel(page, { held: ['APP'] });
  await goBay(page, 'APP', 'app-inbound');
  await clearBay(page, 'app-inbound');
  const strip = await seedStrip(page, { callsign: uniqueCallsign('C'), role: 'ARRIVAL', bayId: 'app-inbound', actingPositionId: 'APP' });
  await expect.poll(() => strip.evaluate((el) => {
    const r = getEfspCorrelationForStrip(getEfspStrip(el.dataset.stripId));
    return r && r.state;
  }), { timeout: 10000 }).toBe('UNCORRELATED');
  // Nothing touches the Strip. The record says UNCORRELATED; the Strip must say so too.
  await expect(strip.locator('.efsp-correlation-badge'), 'NO TRK never drawn').toHaveText('NO TRK', { timeout: 3000 });
  await expect(await stripMenuItem(strip, 'Bind…'), 'bind popover has no opener').toBeEnabled();
});

// ── extends F-201 ────────────────────────────────────────────────────────
// Fields are focused programmatically, which sidesteps F-001: this is about
// where the keystrokes go, not whether the field can be clicked.
test.describe('extends F-201', () => {
  test.use({ viewport: { width: 1600, height: 2400 } });

  for (const name of ['coordinate', 'TOFI']) {
    test(`extends F-201: a space can be typed into the ${name} note`, async ({ page }) => {
      const { popover } = await openPopoverOn(page, name, 1);
      const note = popover.locator('textarea');
      await note.focus();
      await page.keyboard.type('HOLD AT ALPHA', { delay: 30 });
      await expect(note).toHaveValue('HOLD AT ALPHA');
    });
  }

  test('extends F-201: Space on a popover <select> keeps focus in the popover', async ({ page }) => {
    const { popover } = await openPopoverOn(page, 'coordinate', 1);
    const picker = popover.locator('select').first();
    await picker.focus();
    await page.keyboard.press('Space');
    // Not an immediate toBeFocused(): focus moves one render frame AFTER the
    // key (renderBay), so an instant check races it and passes.
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => getSelectedEfspStripId()), 'Space on the picker selected the Strip').toBeNull();
    await expect(picker, 'focus was taken by the Strip').toBeFocused();
  });
});
