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

const { test, expect } = require('@playwright/test');
const { openPanel, seedStrip, stripByCallsign } = require('./helpers/app');

const FDR = { route: 'DCT', requestedAltitude: 'FL250', departureAirport: 'LTAG', destinationAirport: 'LTAF' };
const ALL = ['OPS', 'CD', 'GND', 'TWR', 'APP'];

const stripOf = (cs) => getAllEfspStrips().find((x) => getEfspFdr(x.fdrId).identity.callsign === cs);
const info = (page, cs) => page.evaluate((cs) => {
  const s = getAllEfspStrips().find((x) => getEfspFdr(x.fdrId).identity.callsign === cs);
  return s && { owner: s.ownerPositionId, bay: s.bayId, state: s.state };
}, cs);
const allStates = (page) => page.evaluate(() => Object.fromEntries(getAllEfspStrips().map((s) => [getEfspFdr(s.fdrId).identity.callsign, s.state])));

async function advance(page, cs, n) {
  for (let i = 0; i < n; i++) {
    const before = (await info(page, cs)).state;
    await page.evaluate((cs) => _invokeNla(getAllEfspStrips().find((x) => getEfspFdr(x.fdrId).identity.callsign === cs)), cs);
    await expect.poll(async () => (await info(page, cs)).state, {
      timeout: 3000,
      message: `setup: ${cs} stuck at ${before}: ${await page.locator('#efsp-mutation-error').textContent()}`,
    }).not.toBe(before);
    // The server drops a second NLA on the same Strip inside 400 ms, silently
    // (board-store.js's double-tap guard) — so setup must not outrun it.
    await page.waitForTimeout(450);
  }
}

async function show(page, cs) {
  const { owner, bay } = await info(page, cs);
  await page.locator('#efsp-position-tabs .efsp-position-tab', { hasText: new RegExp(`^${owner}$`) }).click();
  await page.locator('#efsp-bay-tabs .efsp-bay-tab', { hasText: new RegExp(`^${bay}$`) }).click();
  await page.waitForTimeout(250);
}

// Extends F-101 — used to fail at every transfer-shaped step after Send to Clearance; fixed.
for (const [label, n, tag] of [['Approve Pushback', 2, 'P'], ['To Runway Queue', 4, 'Q'], ['Hand Off to APP', 7, 'H']]) {
  test(`a double-tap on ${label} moves only the Strip that was tapped`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1600, height: 1600 });
    await openPanel(page, { held: ALL });
    const pair = [`L4${tag}1`, `L4${tag}2`];
    for (const c of pair) { await seedStrip(page, { callsign: c, role: 'DEPARTURE', fdr: FDR }); await advance(page, c, n); }
    await show(page, pair[0]);

    // Tap whichever of ours is higher, so the other is the one that slides up.
    const order = await page.evaluate(() => [...document.querySelectorAll('#efsp-bay-content .efsp-block-1')].map((e) => e.textContent.trim()));
    const tapped = order.find((c) => pair.includes(c));
    const btn = stripByCallsign(page, tapped).locator('.efsp-nla-btn');
    await expect(btn).toHaveText(label);
    const before = await allStates(page);

    const box = await btn.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(150);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(800);

    const after = await allStates(page);
    const changed = Object.keys(after).filter((c) => c !== tapped && before[c] !== after[c]).map((c) => `${c} ${before[c]} -> ${after[c]}`);
    expect(changed, `tapped ${tapped} twice`).toEqual([]);
  });
}

// F-408 — was a catalogued finding, now fixed.
test('an NLA the server will refuse says so before it is pressed', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1600, height: 1600 });
  await openPanel(page, { held: ALL });
  await seedStrip(page, { callsign: 'L4X1', role: 'DEPARTURE', fdr: FDR });
  await advance(page, 'L4X1', 7); // DEPARTED, next is Hand Off to APP
  // Release APP. Nothing else covers it, so the server will now inhibit.
  await page.evaluate((h) => window.sendEfspSetPositions('INCIRLIK', h), ALL.filter((p) => p !== 'APP'));
  await page.waitForFunction(() => !getActingPositions('INCIRLIK').includes('APP'));
  await show(page, 'L4X1');
  await page.waitForTimeout(500);

  const btn = stripByCallsign(page, 'L4X1').locator('.efsp-nla-btn');
  const pre = { enabled: await btn.isEnabled(), title: await btn.getAttribute('title'), strip: await stripByCallsign(page, 'L4X1').innerText() };
  expect(pre.enabled && !pre.title && !/no receiving Position/i.test(pre.strip),
    `Hand Off to APP looks pressable: enabled=${pre.enabled} title=${pre.title}`).toBe(false);
});
