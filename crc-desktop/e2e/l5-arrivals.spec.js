'use strict';

/* A Strip arriving in a Bay (docs/adr/0057): the Bay tab counts, the amber
 * "+N" on a Bay the controller is not looking at, the arrivals line, and the
 * Strip's own amber edge, "from" line and single flash.
 *
 * Two controllers, because the rule is about somebody ELSE handing a Strip
 * over: a Strip a controller moves between their own Positions is never
 * announced.
 */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, stripByCallsign } = require('./helpers/app');

test.describe.configure({ timeout: 90000 });

const FDR = { route: 'DCT', requestedAltitude: 'FL250', departureAirport: 'LTAG', destinationAirport: 'LTAF' };
const _contexts = [];
test.afterEach(async () => { while (_contexts.length) await _contexts.pop().close().catch(() => {}); });

async function controller(browser, opts) {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1600, height: 1200 } });
  _contexts.push(ctx);
  const page = await ctx.newPage();
  await openPanel(page, opts);
  return page;
}

async function goBay(page, positionId, bayId) {
  await page.locator(`#efsp-position-tabs .efsp-position-tab[data-position-id="${positionId}"]`).click();
  await page.locator(`#efsp-bay-tabs .efsp-bay-tab[data-bay-id="${bayId}"]`).click();
}

const stateOf = (page, cs) => page.evaluate((cs) => {
  const s = crc.state.getAllEfspStrips().find((x) => crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs);
  return s && s.state;
}, cs);

/** OPS files it, CD clears it, GC taxis it and hands it to Tower — all through the page's own NLA. */
async function taxiToTower(page, cs) {
  for (let i = 0; i < 5; i++) {
    const before = await stateOf(page, cs);
    await page.evaluate((cs) => crc.bayView._invokeNla(crc.state.getAllEfspStrips().find((x) => crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs)), cs);
    // 10 s: one Mutation round trip, measured over 3 s under load. The spec's budget is 90 s.
    await expect.poll(() => stateOf(page, cs), { timeout: 10000 }).not.toBe(before);
    await page.waitForTimeout(450); // the server's per-Strip double-tap guard
  }
}

test('a Strip handed over while you look elsewhere lights its Bay tab and the arrivals line', async ({ browser }) => {
  const twr = await controller(browser, { signedOn: ['LC'], controller: 'twr-ctl' });
  const ground = await controller(browser, { signedOn: ['OPS', 'CD', 'GC'], controller: 'gnd-ctl' });
  await goBay(twr, 'LC', 'lc-airborne');

  // The Board is shared across spec files, so the Bay may already hold Strips:
  // the count has to go up by exactly one, whatever it started at.
  const queueTab = twr.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="lc-runway-queue"]');
  const countBefore = Number(await queueTab.locator('.efsp-tab-count').textContent());

  await seedStrip(ground, { callsign: 'ARV501', stripType: 'DEPARTURE', flightData: FDR });
  await taxiToTower(ground, 'ARV501');

  await expect(queueTab.locator('.efsp-tab-new'), 'no +1 on the Bay it landed in').toHaveText('+1');
  await expect(queueTab.locator('.efsp-tab-count')).toHaveText(String(countBefore + 1));
  await expect(twr.locator('#efsp-position-tabs .efsp-position-tab[data-position-id="LC"] .efsp-tab-new-dot')).toHaveCount(1);
  const row = twr.locator('#efsp-arrivals-line .efsp-arrival-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('ARV501');
  await expect(row).toContainText('from GC');

  // Clicking the line opens the Bay: the tab and the line clear, the Strip keeps its mark.
  await row.click();
  await expect(queueTab).toHaveClass(/active/);
  await expect(queueTab.locator('.efsp-tab-new')).toHaveCount(0);
  await expect(twr.locator('#efsp-arrivals-line')).toBeHidden();
  await expect(twr.locator('#efsp-position-tabs .efsp-position-tab[data-position-id="LC"] .efsp-tab-new-dot'),
    'the Position tab still says there is something unseen').toHaveCount(0);
  const s = stripByCallsign(twr, 'ARV501');
  await expect(s).toHaveClass(/efsp-strip-arrived/);
  await expect(s.locator('.efsp-strip-from')).toHaveText('from GC');

  // Touching it is noticing it.
  await s.locator('.efsp-strip-tab-type').click();
  await expect(s).not.toHaveClass(/efsp-strip-arrived/);
});

test('opening the Bay from its tab clears the Bay tab and the Position tab', async ({ browser }) => {
  const twr = await controller(browser, { signedOn: ['LC'], controller: 'twr-ctl-3' });
  const ground = await controller(browser, { signedOn: ['OPS', 'CD', 'GC'], controller: 'gnd-ctl-3' });
  await goBay(twr, 'LC', 'lc-airborne');
  await seedStrip(ground, { callsign: 'ARV551', stripType: 'DEPARTURE', flightData: FDR });
  await taxiToTower(ground, 'ARV551');
  const dot = twr.locator('#efsp-position-tabs .efsp-position-tab[data-position-id="LC"] .efsp-tab-new-dot');
  await expect(dot).toHaveCount(1);
  await twr.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="lc-runway-queue"]').click();
  await expect(dot).toHaveCount(0);
  await expect(twr.locator('#efsp-arrivals-line')).toBeHidden();
});

test('a Strip arriving in the Bay on screen flashes once, and is not listed on the arrivals line', async ({ browser }) => {
  const twr = await controller(browser, { signedOn: ['LC'], controller: 'twr-ctl-2' });
  const ground = await controller(browser, { signedOn: ['OPS', 'CD', 'GC'], controller: 'gnd-ctl-2' });
  await goBay(twr, 'LC', 'lc-runway-queue');

  await seedStrip(ground, { callsign: 'ARV601', stripType: 'DEPARTURE', flightData: FDR });
  await taxiToTower(ground, 'ARV601');
  const first = stripByCallsign(twr, 'ARV601');
  await expect(first).toHaveClass(/efsp-strip-arrived-flash/);
  await expect(twr.locator('#efsp-arrivals-line')).toBeHidden();
  await expect(twr.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="lc-runway-queue"] .efsp-tab-new')).toHaveCount(0);

  // A second Strip arrives in the same Bay. The Bay re-renders; the first
  // Strip must NOT replay its flash.
  await seedStrip(ground, { callsign: 'ARV602', stripType: 'DEPARTURE', flightData: FDR });
  await taxiToTower(ground, 'ARV602');
  await expect(stripByCallsign(twr, 'ARV602')).toHaveClass(/efsp-strip-arrived-flash/);
  // Force a rebuild of ARV601 by something unrelated to its arrival.
  await twr.evaluate((cs) => {
    const s = crc.state.getAllEfspStrips().find((x) => crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs);
    crc.state.applyEfspDelta({ flightDataList: { updated: [{ ...crc.state.getEfspFlightData(s.flightDataId), rev: crc.state.getEfspFlightData(s.flightDataId).rev + 100 }] } });
    crc.bayView.renderAllOpenEfspBays();
  }, 'ARV601');
  const rebuilt = stripByCallsign(twr, 'ARV601');
  await expect(rebuilt).toHaveClass(/efsp-strip-arrived/);
  await expect(rebuilt).not.toHaveClass(/efsp-strip-arrived-flash/);
});

test('working several Positions, your own hand-off to a Bay you are not looking at is announced too', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS', 'CD', 'GC', 'LC'], controller: 'solo-ctl' });
  await seedStrip(page, { callsign: 'ARV701', stripType: 'DEPARTURE', flightData: FDR });
  await goBay(page, 'LC', 'lc-airborne');
  await taxiToTower(page, 'ARV701');
  const queueTab = page.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="lc-runway-queue"]');
  await expect(queueTab.locator('.efsp-tab-new')).toHaveText('+1');
  await expect(page.locator('#efsp-arrivals-line .efsp-arrival-row')).toContainText('from GC');
});

test('creating a Strip yourself is not announced', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS'], controller: 'solo-ctl-2' });
  await goBay(page, 'OPS', 'ops-proposed');
  await seedStrip(page, { callsign: 'ARV801', stripType: 'DEPARTURE', flightData: FDR });
  await expect(page.locator('#efsp-bay-tabs .efsp-tab-new')).toHaveCount(0);
  await expect(page.locator('#efsp-arrivals-line')).toBeHidden();
  await expect(page.locator('.efsp-strip-arrived')).toHaveCount(0);
});
