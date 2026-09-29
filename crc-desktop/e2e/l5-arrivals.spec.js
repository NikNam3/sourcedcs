'use strict';

/* A Strip arriving in a Bay (docs/adr/0057): the Bay tab counts, the amber
 * "+N" on a Bay the controller is not looking at, the arrivals line, and the
 * Strip's own amber edge, "from" line and single flash.
 *
 * Two controllers, because the rule is about somebody ELSE handing a Strip
 * over: a Strip a controller moves between their own Positions is never
 * announced.
 */

const { test, expect } = require('@playwright/test');
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
  const s = getAllEfspStrips().find((x) => getEfspFdr(x.fdrId).identity.callsign === cs);
  return s && s.state;
}, cs);

/** OPS files it, CD clears it, GND taxis it and hands it to Tower — all through the page's own NLA. */
async function taxiToTower(page, cs) {
  for (let i = 0; i < 5; i++) {
    const before = await stateOf(page, cs);
    await page.evaluate((cs) => _invokeNla(getAllEfspStrips().find((x) => getEfspFdr(x.fdrId).identity.callsign === cs)), cs);
    await expect.poll(() => stateOf(page, cs), { timeout: 3000 }).not.toBe(before);
    await page.waitForTimeout(450); // the server's per-Strip double-tap guard
  }
}

test('a Strip handed over while you look elsewhere lights its Bay tab and the arrivals line', async ({ browser }) => {
  const twr = await controller(browser, { held: ['TWR'], controller: 'twr-ctl' });
  const ground = await controller(browser, { held: ['OPS', 'CD', 'GND'], controller: 'gnd-ctl' });
  await goBay(twr, 'TWR', 'twr-airborne');

  // The Board is shared across spec files, so the Bay may already hold Strips:
  // the count has to go up by exactly one, whatever it started at.
  const queueTab = twr.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="twr-runway-queue"]');
  const countBefore = Number(await queueTab.locator('.efsp-tab-count').textContent());

  await seedStrip(ground, { callsign: 'ARV501', role: 'DEPARTURE', fdr: FDR });
  await taxiToTower(ground, 'ARV501');

  await expect(queueTab.locator('.efsp-tab-new'), 'no +1 on the Bay it landed in').toHaveText('+1');
  await expect(queueTab.locator('.efsp-tab-count')).toHaveText(String(countBefore + 1));
  await expect(twr.locator('#efsp-position-tabs .efsp-position-tab[data-position-id="TWR"] .efsp-tab-new-dot')).toHaveCount(1);
  const row = twr.locator('#efsp-arrivals-line .efsp-arrival-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('ARV501');
  await expect(row).toContainText('from GND');

  // Clicking the line opens the Bay: the tab and the line clear, the Strip keeps its mark.
  await row.click();
  await expect(queueTab).toHaveClass(/active/);
  await expect(queueTab.locator('.efsp-tab-new')).toHaveCount(0);
  await expect(twr.locator('#efsp-arrivals-line')).toBeHidden();
  await expect(twr.locator('#efsp-position-tabs .efsp-position-tab[data-position-id="TWR"] .efsp-tab-new-dot'),
    'the Position tab still says there is something unseen').toHaveCount(0);
  const s = stripByCallsign(twr, 'ARV501');
  await expect(s).toHaveClass(/efsp-strip-arrived/);
  await expect(s.locator('.efsp-strip-from')).toHaveText('from GND');

  // Touching it is noticing it.
  await s.locator('.efsp-strip-tab-role').click();
  await expect(s).not.toHaveClass(/efsp-strip-arrived/);
});

test('opening the Bay from its tab clears the Bay tab and the Position tab', async ({ browser }) => {
  const twr = await controller(browser, { held: ['TWR'], controller: 'twr-ctl-3' });
  const ground = await controller(browser, { held: ['OPS', 'CD', 'GND'], controller: 'gnd-ctl-3' });
  await goBay(twr, 'TWR', 'twr-airborne');
  await seedStrip(ground, { callsign: 'ARV551', role: 'DEPARTURE', fdr: FDR });
  await taxiToTower(ground, 'ARV551');
  const dot = twr.locator('#efsp-position-tabs .efsp-position-tab[data-position-id="TWR"] .efsp-tab-new-dot');
  await expect(dot).toHaveCount(1);
  await twr.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="twr-runway-queue"]').click();
  await expect(dot).toHaveCount(0);
  await expect(twr.locator('#efsp-arrivals-line')).toBeHidden();
});

test('a Strip arriving in the Bay on screen flashes once, and is not listed on the arrivals line', async ({ browser }) => {
  const twr = await controller(browser, { held: ['TWR'], controller: 'twr-ctl-2' });
  const ground = await controller(browser, { held: ['OPS', 'CD', 'GND'], controller: 'gnd-ctl-2' });
  await goBay(twr, 'TWR', 'twr-runway-queue');

  await seedStrip(ground, { callsign: 'ARV601', role: 'DEPARTURE', fdr: FDR });
  await taxiToTower(ground, 'ARV601');
  const first = stripByCallsign(twr, 'ARV601');
  await expect(first).toHaveClass(/efsp-strip-arrived-flash/);
  await expect(twr.locator('#efsp-arrivals-line')).toBeHidden();
  await expect(twr.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="twr-runway-queue"] .efsp-tab-new')).toHaveCount(0);

  // A second Strip arrives in the same Bay. The Bay re-renders; the first
  // Strip must NOT replay its flash.
  await seedStrip(ground, { callsign: 'ARV602', role: 'DEPARTURE', fdr: FDR });
  await taxiToTower(ground, 'ARV602');
  await expect(stripByCallsign(twr, 'ARV602')).toHaveClass(/efsp-strip-arrived-flash/);
  // Force a rebuild of ARV601 by something unrelated to its arrival.
  await twr.evaluate((cs) => {
    const s = getAllEfspStrips().find((x) => getEfspFdr(x.fdrId).identity.callsign === cs);
    applyEfspDelta({ fdrs: { updated: [{ ...getEfspFdr(s.fdrId), rev: getEfspFdr(s.fdrId).rev + 100 }] } });
    renderAllOpenEfspBays();
  }, 'ARV601');
  const rebuilt = stripByCallsign(twr, 'ARV601');
  await expect(rebuilt).toHaveClass(/efsp-strip-arrived/);
  await expect(rebuilt).not.toHaveClass(/efsp-strip-arrived-flash/);
});

test('working several Positions, your own hand-off to a Bay you are not looking at is announced too', async ({ page }) => {
  await openPanel(page, { held: ['OPS', 'CD', 'GND', 'TWR'], controller: 'solo-ctl' });
  await seedStrip(page, { callsign: 'ARV701', role: 'DEPARTURE', fdr: FDR });
  await goBay(page, 'TWR', 'twr-airborne');
  await taxiToTower(page, 'ARV701');
  const queueTab = page.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="twr-runway-queue"]');
  await expect(queueTab.locator('.efsp-tab-new')).toHaveText('+1');
  await expect(page.locator('#efsp-arrivals-line .efsp-arrival-row')).toContainText('from GND');
});

test('creating a Strip yourself is not announced', async ({ page }) => {
  await openPanel(page, { held: ['OPS'], controller: 'solo-ctl-2' });
  await goBay(page, 'OPS', 'ops-proposed');
  await seedStrip(page, { callsign: 'ARV801', role: 'DEPARTURE', fdr: FDR });
  await expect(page.locator('#efsp-bay-tabs .efsp-tab-new')).toHaveCount(0);
  await expect(page.locator('#efsp-arrivals-line')).toBeHidden();
  await expect(page.locator('.efsp-strip-arrived')).toHaveCount(0);
});
