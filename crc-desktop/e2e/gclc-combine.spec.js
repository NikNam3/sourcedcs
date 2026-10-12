'use strict';

/* GCLC (crc-sync docs/adr/0105, H104): a tower controller takes ground by combining. LC with GC shows the COMBINED line
 * with both frequencies, the Position tabs carry their frequencies, and a sign-off of GC with Strips leaves GC offered to LC's Primary (standing, ADR 0110). */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, lapseNlaGuard } = require('./helpers/app');

test.describe.configure({ timeout: 60000 });

test('LC with GC: the line names both frequencies, a click acknowledges it, and the tabs carry theirs', async ({ page }) => {
  await openPanel(page, { signedOn: ['LC', 'GC'] });
  const line = page.locator('#efsp-combination .efsp-combination-line');
  // T26: only the frequencies to monitor, no rule text.
  await expect(line).toHaveText('Monitor TWR 251.0, GND 275.8');
  await expect(line).not.toHaveClass(/efsp-combination-severe/);
  await expect(page.locator('.efsp-position-tab[data-position-id="GC"] .efsp-tab-freq')).toHaveText('GND 275.8');
  await expect(page.locator('.efsp-position-tab[data-position-id="LC"]')).toHaveClass(/efsp-position-tab-combined/);
  await page.screenshot({ path: test.info().outputPath('gclc-combined-line.png') });
  // T26: a click acknowledges it, and it stays away while the combination stands (a re-render does not bring it back).
  await line.click();
  await expect(line).toHaveCount(0);
  await page.evaluate(() => crc.changeBus.markEfspChanged('positions'));
  await expect(line).toHaveCount(0);
  // The combination changes (GC released, then taken again): the line is back.
  await page.evaluate(() => crc.ws.sendEfspSetPositions('INCIRLIK', ['LC']));
  await expect.poll(() => page.evaluate(() => crc.ws.getAckedPositions('INCIRLIK').sort().join())).toBe('LC');
  await page.evaluate(() => crc.ws.sendEfspSetPositions('INCIRLIK', ['LC', 'GC']));
  await expect(line).toHaveText('Monitor TWR 251.0, GND 275.8');
});

const stripOwner = (page, cs) => page.evaluate((cs) => {
  const s = crc.state.getAllEfspStrips().find((x) => crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs);
  return s && s.ownerPositionId;
}, cs);

test('LC alone has no combination line; the standing offer to take GC signs the controller on to GC', async ({ browser, page }) => {
  // crc-sync docs/adr/0110: the offer is standing server state (hatOffers), not a one-shot frame. A holds OPS, CD, GC, files a departure
  // and clears it until GC owns it, then leaves GC; LC's Primary is offered GC.
  await openPanel(page, { signedOn: ['LC'], controller: 'gclc-lc' });
  await expect(page.locator('#efsp-combination .efsp-combination-line')).toHaveCount(0);
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1600, height: 1200 } });
  try {
    const a = await ctx.newPage();
    await openPanel(a, { signedOn: ['OPS', 'CD', 'GC'], controller: 'gclc-ground' });
    await seedStrip(a, { callsign: 'GCL101', stripType: 'DEPARTURE', flightData: { route: 'DCT', requestedAltitude: 'FL250', departureAirport: 'LTAG', destinationAirport: 'LTAF' } });
    for (let i = 0; i < 6 && (await stripOwner(a, 'GCL101')) !== 'GC'; i++) {
      await a.evaluate((cs) => crc.dispatch._invokeNla(crc.state.getAllEfspStrips().find((x) => crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs)), 'GCL101');
      await lapseNlaGuard(a);
      await expect.poll(() => a.evaluate(() => crc.state.getPendingMutations().length)).toBe(0);
    }
    expect(await stripOwner(a, 'GCL101')).toBe('GC');
    await a.evaluate(() => crc.ws.sendEfspSetPositions('INCIRLIK', ['OPS', 'CD']));

    const offer = page.locator('#efsp-combination .efsp-position-offer');
    await expect(offer).toContainText('GC is unstaffed with 1 Strip');
    await expect(offer).toContainText('Take GC as well?');
    await expect(offer).not.toContainText('¶'); // T26: no rule text
    await page.screenshot({ path: test.info().outputPath('gclc-offer.png') });
    await offer.locator('.efsp-offer-take').click();
    await expect(page.locator('#efsp-combination .efsp-combination-line').first()).toHaveText('Monitor TWR 251.0, GND 275.8');
    await expect(offer).toHaveCount(0);
  } finally { await ctx.close().catch(() => {}); }
});
