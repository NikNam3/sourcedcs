'use strict';

/* Lane 4, beyond its scope at the coordinator's request — the departure
 * clearance chain past Mark Cleared. docs/ui-findings/lane4.md:
 * "Extends F-101", "Extends F-102" (walked, confirmed), F-408.
 *
 * Setup advances Strips with the page's own _invokeNla — the same function the
 * NLA button calls — so each test starts at the step it is about. The step
 * under test is always a real pointer press on the rendered button.
 *
 * The Board is shared across a run, so the double-tap assertion does not
 * assume which Strip is below: it requires that NOTHING but the tapped Strip
 * changed state.
 */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, stripByCallsign, lapseNlaGuard } = require('./helpers/app');

const FLIGHT_DATA = { route: 'DCT', requestedAltitude: 'FL250', departureAirport: 'LTAG', destinationAirport: 'LTAF' };
const ALL = ['OPS', 'CD', 'GC', 'LC', 'AP'];

const stripOf = (cs) => crc.state.getAllEfspStrips().find((x) => crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs);
const info = (page, cs) => page.evaluate((cs) => {
  const s = crc.state.getAllEfspStrips().find((x) => crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs);
  return s && { owner: s.ownerPositionId, bay: s.bayId, state: s.state };
}, cs);
const allStates = (page) => page.evaluate(() => Object.fromEntries(crc.state.getAllEfspStrips().map((s) => [crc.state.getEfspFlightData(s.flightDataId).identity.callsign, s.state])));

async function advance(page, cs, n) {
  for (let i = 0; i < n; i++) {
    const before = (await info(page, cs)).state;
    await page.evaluate((cs) => crc.bayView._invokeNla(crc.state.getAllEfspStrips().find((x) => crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs)), cs);
    await expect.poll(async () => (await info(page, cs)).state, {
      timeout: 3000,
      message: `setup: ${cs} stuck at ${before}: ${await page.locator('#efsp-mutation-error').textContent()}`,
    }).not.toBe(before);
    // The client swallows a second advancing press inside its 400 ms window — setup must not outrun it.
    await lapseNlaGuard(page);
  }
}

async function show(page, cs) {
  const { owner, bay } = await info(page, cs);
  await page.locator(`#efsp-position-tabs .efsp-position-tab[data-position-id=\"${owner}\"]`).click();
  await page.locator(`#efsp-bay-tabs .efsp-bay-tab[data-bay-id=\"${bay}\"]`).click();
  await page.waitForTimeout(250);
}

// Extends F-101 — used to fail at every transfer-shaped step after Send to Clearance; fixed.
//
// The claim is about a second tap that lands INSIDE the 400 ms window
// (DOUBLE_TAP_MS). Two `page.mouse.click`s with 150 ms between them reach the
// page 220–370 ms apart on a typical run, and occasionally 400–700 ms apart when
// the machine stalls — at which point it is not a double tap at all, and the
// guard correctly lets it through. Measured the same on the old and new Strip
// layouts. So the gap is measured page-side: an attempt whose taps landed
// outside the window proves nothing and is retried with a fresh pair, and the
// test fails loudly if the harness cannot produce a double tap at all.
const DOUBLE_TAP_MS = 400;
for (const [label, n, tag] of [['Approve Pushback', 2, 'P'], ['To Runway Queue', 4, 'Q'], ['Hand Off to AP', 7, 'H']]) {
  test(`a double-tap on ${label} moves only the Strip that was tapped`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 1600, height: 1600 });
    await openPanel(page, { signedOn: ALL });

    for (let attempt = 0; attempt < 3; attempt++) {
      const pair = [`L4${tag}${attempt}A`, `L4${tag}${attempt}B`];
      await page.locator('#efsp-position-tabs .efsp-position-tab[data-position-id="OPS"]').click();
      await page.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="ops-proposed"]').click();
      for (const c of pair) { await seedStrip(page, { callsign: c, stripType: 'DEPARTURE', flightData: FLIGHT_DATA }); await advance(page, c, n); }
      await show(page, pair[0]);

      // Tap whichever of ours is higher, so the other is the one that slides up.
      const order = await page.evaluate(() => [...document.querySelectorAll('#efsp-bay-content .efsp-block-1')].map((e) => e.textContent.trim()));
      const tapped = order.find((c) => pair.includes(c));
      const btn = stripByCallsign(page, tapped).locator('.efsp-nla-btn');
      await expect(btn).toHaveText(label);
      const before = await allStates(page);

      await page.evaluate(() => {
        window.__tapTimes = [];
        document.addEventListener('pointerdown', () => window.__tapTimes.push(performance.now()), true);
      });
      const box = await btn.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(150);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(800);

      const taps = await page.evaluate(() => window.__tapTimes);
      const gap = taps.length > 1 ? taps[1] - taps[0] : Infinity;
      if (gap >= DOUBLE_TAP_MS) {
        test.info().annotations.push({ type: 'retried', description: `attempt ${attempt}: taps landed ${Math.round(gap)} ms apart — not a double tap` });
        continue;
      }
      const after = await allStates(page);
      const changed = Object.keys(after).filter((c) => c !== tapped && before[c] !== after[c]).map((c) => `${c} ${before[c]} -> ${after[c]}`);
      expect(changed, `tapped ${tapped} twice, ${Math.round(gap)} ms apart`).toEqual([]);
      return;
    }
    throw new Error(`three attempts, and the harness never delivered two taps inside ${DOUBLE_TAP_MS} ms`);
  });
}

// F-408 — was a catalogued finding, now fixed.
test('an NLA the server will refuse says so before it is pressed', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1600, height: 1600 });
  await openPanel(page, { signedOn: ALL });
  await seedStrip(page, { callsign: 'L4X1', stripType: 'DEPARTURE', flightData: FLIGHT_DATA });
  await advance(page, 'L4X1', 7); // DEPARTED, next is Hand Off to AP
  // Release AP. Nothing else covers it, so the server will now inhibit.
  await page.evaluate((h) => crc.ws.sendEfspSetPositions('INCIRLIK', h), ALL.filter((p) => p !== 'AP'));
  await page.waitForFunction(() => !crc.ws.getActingPositions('INCIRLIK').includes('AP'));
  await show(page, 'L4X1');
  await page.waitForTimeout(500);

  const btn = stripByCallsign(page, 'L4X1').locator('.efsp-nla-btn');
  const pre = { enabled: await btn.isEnabled(), title: await btn.getAttribute('title'), strip: await stripByCallsign(page, 'L4X1').innerText() };
  expect(pre.enabled && !pre.title && !/no receiving Position/i.test(pre.strip),
    `Hand Off to AP looks pressable: enabled=${pre.enabled} title=${pre.title}`).toBe(false);
});
