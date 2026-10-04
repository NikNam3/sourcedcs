'use strict';

/* L19 (crc-sync docs/adr/0076) — surveillance informs, the controller advances (§10.3, §10.4).
 *
 * The harness runs crc-sync with no DCS, so there is no contact for the server's monitor to
 * detect. What this proves is the half a browser is needed for: given the hint the server states
 * (the `surveillance` slice of efsp-alerts, injected here through the page's own applyEfspAlerts),
 * the chip is drawn on the Strip, drawing it moves nothing, ONE real click advances the flight
 * through the controller's own SetState, the server stamps the takeoff time, and the staleness
 * badge is quiet. The server half is crc-sync/tests/efsp-surveillance-hints.test.mjs.
 */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, stripByCallsign, lapseNlaGuard, settle, serverTicks } = require('./helpers/app');

const FLIGHT_DATA = { route: 'DCT', requestedAltitude: 'FL250', departureAirport: 'LTAG', destinationAirport: 'LTAF' };
const ALL = ['OPS', 'CD', 'GC', 'LC', 'AP'];
const CS = 'L19AIR1';

const info = (page) => page.evaluate((cs) => {
  const s = crc.state.getAllEfspStrips().find((x) => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || {}).identity && crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs);
  return s && { stripId: s.stripId, flightDataId: s.flightDataId, owner: s.ownerPositionId, bay: s.bayId, state: s.state, rev: s.rev, takeoff: (crc.state.getEfspFlightData(s.flightDataId).timeInputs || {}).takeoffStampedUtc };
}, CS);

test.afterEach(async ({ page }) => {
  await page.evaluate((cs) => {
    for (const s of crc.state.getAllEfspStrips()) {
      const flightData = crc.state.getEfspFlightData(s.flightDataId);
      if (!flightData || flightData.identity.callsign !== cs || s.state === 'DROPPED') continue;
      crc.ws.sendEfspMutation(s.ownerPositionId, s, { kind: 'DropStrip', reason: 'e2e cleanup' });
    }
  }, CS).catch(() => {});
  await settle(page).catch(() => {});
});

test('the suggestion chip: drawn, moves nothing, one click advances the flight and stamps the takeoff', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1600, height: 1400 });
  await openPanel(page, { signedOn: ALL });
  await page.locator('#efsp-position-tabs .efsp-position-tab[data-position-id="OPS"]').click();
  await page.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="ops-proposed"]').click();
  await seedStrip(page, { callsign: CS, stripType: 'DEPARTURE', flightData: FLIGHT_DATA });

  // To LUAW, with the page's own NLA, as l4-chain does.
  for (let i = 0; i < 6; i++) {
    const before = (await info(page)).state;
    await page.evaluate((cs) => crc.dispatch._invokeNla(crc.state.getAllEfspStrips().find((x) => x.state !== 'DROPPED' && crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs)), CS);
    await expect.poll(async () => (await info(page)).state, { timeout: 5000, message: `stuck at ${before}` }).not.toBe(before);
    await lapseNlaGuard(page); // the client's double-tap window
  }
  const at = await info(page);
  expect(at.state).toBe('LUAW');
  expect(at.takeoff ?? null).toBeNull();
  await page.locator(`#efsp-position-tabs .efsp-position-tab[data-position-id="${at.owner}"]`).click();
  await page.locator(`#efsp-bay-tabs .efsp-bay-tab[data-bay-id="${at.bay}"]`).click();

  // The server states the hint; the client draws it.
  const hint = { stripId: at.stripId, flightDataId: at.flightDataId, facilityId: 'INCIRLIK', kind: 'AIRBORNE_ADVANCE', stripState: 'LUAW', contactPhase: 'AIRBORNE', since: 1, toState: 'DEPARTED' };
  const inject = (h) => page.evaluate((hh) => {
    crc.state.applyEfspAlerts({ conformance: [], conflictAlert: [], obligations: [], surveillance: hh });
    crc.bayView.renderAllOpenEfspBays();
  }, h);
  await inject([hint]);
  const strip = stripByCallsign(page, CS);
  const chip = strip.locator('[data-slot="hint"]');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('AIRBORNE');

  // Nothing moves by itself.
  await serverTicks(page, 3); // the server's monitor has run a few more times
  expect((await info(page)).state).toBe('LUAW');

  // One input.
  await inject([hint]);
  await chip.click();
  await expect.poll(async () => (await info(page)).state, { timeout: 5000 }).toBe('DEPARTED');
  const after = await info(page);
  expect(after.takeoff).toBeGreaterThan(0);

  // The hint was about LUAW; the Strip has moved on, so it is gone with no help from the server.
  await expect(strip.locator('[data-slot="hint"]')).toHaveCount(0);
});

test('the staleness badge is quiet: low severity, no reason line, no alert styling', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1400 });
  await openPanel(page, { signedOn: ['OPS'] });
  await seedStrip(page, { callsign: CS, stripType: 'DEPARTURE', flightData: FLIGHT_DATA });
  const at = await info(page);
  await page.evaluate(([h]) => { crc.state.applyEfspAlerts({ surveillance: [h] }); crc.bayView.renderAllOpenEfspBays(); }, [
    { stripId: at.stripId, flightDataId: at.flightDataId, facilityId: 'INCIRLIK', kind: 'STALE', stripState: at.state, contactPhase: 'ON_GROUND', since: 1, afterSec: 120 },
  ]);
  const strip = stripByCallsign(page, CS);
  const badge = strip.locator('[data-slot="stale"]');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('STALE');
  await expect(strip).not.toHaveClass(/efsp-strip-alert/);
  await expect(strip.locator('.efsp-alert-reason')).toHaveCount(0);
});
