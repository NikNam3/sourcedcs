'use strict';

/* The server's NLA double-tap guard (crc-sync board/ops/invoke-nla.js, guide §3.5 rule 3), the one place the harness keeps it.
 *
 * Every other spec runs against a crc-sync started with CRCSYNC_NLA_GUARD_MS=0 (playwright.config.js), so two presses never
 * depend on how late the server read the first. This spec turns a guard back on through the test hook (POST /__test/nla-guard,
 * crc-sync/src/test-reset.js) and sends two InvokeNla frames over the wire, straight past the client's own window: the second
 * is a silent no-op success. It always puts 0 back.
 *
 * The window here is GUARD_MS, longer than the shipped 400 ms, on purpose: the second frame goes out when the first one's ack
 * arrives, and that round trip measured 330 ms on a busy machine, which would put the second press outside a 400 ms window
 * and make the assertion fail for load, the very race this lane removes. That the shipped value is 400 ms is asserted by
 * crc-sync's tests/efsp-board-store.test.mjs (399 ms later, swallowed, on an injected clock).
 */
const GUARD_MS = 5000;

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, lapseNlaGuard, settle, serverTicks } = require('./helpers/app');

const SYNC = `http://127.0.0.1:${3010 + Number(process.env.E2E_LANE || 0)}`;
const CS = 'GUARD01';

async function setGuard(ms) {
  const r = await fetch(`${SYNC}/__test/nla-guard`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ms }) });
  if (!r.ok) throw new Error(`nla-guard hook: HTTP ${r.status}`);
}

// Two InvokeNla frames over the wire, the second sent the moment the first one's ack has changed its state (so it carries the
// fresh rev and only the guard can refuse it); the client's own board-wide window is not in the way because the frames go
// straight to the socket. In the page, so the gap is one round trip rather than a Playwright round trip.
const pressTwice = (page) => page.evaluate(async (cs) => {
  const find = () => crc.state.getAllEfspStrips().find((x) => x.state !== 'DROPPED' && crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs);
  const first = find();
  crc.ws.sendEfspMutation(first.ownerPositionId, first, { kind: 'InvokeNla' });
  const deadline = Date.now() + 15000;
  while (find().state === first.state && Date.now() < deadline) await new Promise((r) => setTimeout(r, 2));
  const next = find();
  crc.ws.sendEfspMutation(next.ownerPositionId, next, { kind: 'InvokeNla' });
  return next.state;
}, CS);

const stateOf = (page) => page.evaluate((cs) => crc.state.getAllEfspStrips().find((x) => x.state !== 'DROPPED' && crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs).state, CS);

// The latch covers an NLA that stays with its Position (a transfer-shaped one is guarded by the client only), so walk the
// departure to LUAW at LC first (l19-surveillance-hints does the same); Airborne from there is the pair under test.
async function openAtLuaw(page) {
  await open(page);
  for (let i = 0; i < 6; i++) {
    const before = await stateOf(page);
    await page.evaluate((cs) => crc.bayView._invokeNla(crc.state.getAllEfspStrips().find((x) => x.state !== 'DROPPED' && crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs)), CS);
    await expect.poll(() => stateOf(page), { message: `stuck at ${before}` }).not.toBe(before);
    await lapseNlaGuard(page);
  }
  expect(await stateOf(page)).toBe('LUAW');
}

async function open(page) {
  await openPanel(page, { signedOn: ['OPS', 'CD', 'GC', 'LC', 'AP'] });
  await page.locator('#efsp-position-tabs .efsp-position-tab[data-position-id="OPS"]').click();
  await page.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="ops-proposed"]').click();
  await seedStrip(page, { callsign: CS, stripType: 'DEPARTURE', flightData: { route: 'DCT', requestedAltitude: 'FL250', departureAirport: 'LTAG', destinationAirport: 'LTAF' } });
}

test.afterEach(async () => { await setGuard(0); });


test('with the guard on, a second InvokeNla on the same Strip is swallowed', async ({ page }) => {
  await openAtLuaw(page);
  await setGuard(GUARD_MS);
  const afterFirst = await pressTwice(page);
  // The negative half: give the second frame time to have been answered; it must not have moved the Strip again.
  await settle(page);
  await serverTicks(page, 2); // the second frame has been answered by now
  expect(await stateOf(page), 'only the first press applied').toBe(afterFirst);
});

test('with the harness guard (0 ms), the second InvokeNla applies too', async ({ page }) => {
  await openAtLuaw(page);
  const afterFirst = await pressTwice(page);
  await expect.poll(() => stateOf(page)).not.toBe(afterFirst);
});
