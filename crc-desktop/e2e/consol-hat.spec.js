'use strict';

/* CONSOL-C (crc-sync docs/adr/0110, H111): consolidation means the next controller takes the hat. Nothing moves when a Position
 * is left; the server keeps a standing offer on the Position entries (`hatOffers`) and the snapshot says who "I" am (`self`).
 * Two controllers: one leaves LC with a Strip, the other (AP) is offered LC. */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, lapseNlaGuard } = require('./helpers/app');

test.describe.configure({ timeout: 120000 });

const FLIGHT_DATA = { route: 'DCT', requestedAltitude: 'FL250', departureAirport: 'LTAG', destinationAirport: 'LTAF' };
const _contexts = [];
test.afterEach(async () => { while (_contexts.length) await _contexts.pop().close().catch(() => {}); });

async function controller(browser, opts) {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1600, height: 1200 } });
  _contexts.push(ctx);
  const page = await ctx.newPage();
  await openPanel(page, opts);
  return page;
}

const stateOf = (page, cs) => page.evaluate((cs) => {
  const s = crc.state.getAllEfspStrips().find((x) => crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs);
  return s && s.state;
}, cs);
const ownerOf = (page, cs) => page.evaluate((cs) => {
  const s = crc.state.getAllEfspStrips().find((x) => crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs);
  return s && s.ownerPositionId;
}, cs);

/** OPS files it, CD clears it, GC taxis it and hands it to Tower, all through the page's own NLA: it ends owned by LC. */
async function taxiToTower(page, cs) {
  for (let i = 0; i < 5; i++) {
    const before = await stateOf(page, cs);
    await page.evaluate((cs) => crc.dispatch._invokeNla(crc.state.getAllEfspStrips().find((x) => crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs)), cs);
    await expect.poll(() => stateOf(page, cs), { timeout: 10000 }).not.toBe(before);
    await lapseNlaGuard(page);
  }
  await expect.poll(() => ownerOf(page, cs)).toBe('LC');
}

const declare = (page, positions) => page.evaluate((p) => crc.ws.sendEfspSetPositions('INCIRLIK', p), positions);
const offerRow = (page, positionId) => page.locator(`#efsp-combination .efsp-position-offer[data-offer-for="${positionId}"]`);

/** A holds everything and puts one departure at LC; returns A's page. */
async function tower(browser, callsign) {
  const a = await controller(browser, { signedOn: ['OPS', 'CD', 'GC', 'LC'], controller: 'consol-tower' });
  await seedStrip(a, { callsign, stripType: 'DEPARTURE', flightData: FLIGHT_DATA });
  await taxiToTower(a, callsign);
  return a;
}

test('LC signs off with a Strip: AP is offered LC, takes it, and the combination line shows', async ({ browser }) => {
  const a = await tower(browser, 'HAT101');
  const ap = await controller(browser, { signedOn: ['AP'], controller: 'consol-ap' });
  await expect(offerRow(ap, 'LC'), 'LC is staffed: no offer').toHaveCount(0);

  const acks = [];
  a.on('websocket', (ws) => ws.on('framereceived', (f) => { try { const m = JSON.parse(f.payload); if (m.type === 'efsp-positions-ack') acks.push(m); } catch (_) { /* not JSON */ } }));
  await a.evaluate(() => crc.app._ws.close()); // a fresh socket, so the next ack is seen by the listener above
  await expect.poll(() => acks.length, { timeout: 15000 }).toBeGreaterThanOrEqual(1);
  await declare(a, ['OPS', 'CD', 'GC']);
  const row = offerRow(ap, 'LC');
  await expect(row).toContainText('LC is unstaffed with 1 Strip');
  await expect(row).toContainText('HAT101');
  await expect(row).toContainText('Take LC as well?');
  await expect(row).toContainText('¶2-6-12');
  // Nothing moved: the Strip is still LC's, and the leaver was told who is offered it.
  expect(await ownerOf(a, 'HAT101')).toBe('LC');
  await expect.poll(() => acks.some(m => (m.warnings || []).some(w => w.positionId === 'LC' && w.offeredTo === 'AP' && !w.routedTo))).toBe(true);
  await ap.screenshot({ path: test.info().outputPath('consol-offer.png') });

  await row.locator('.efsp-offer-take').click();
  await expect(ap.locator('#efsp-combination .efsp-combination-line').first()).toContainText('COMBINED LC + AP');
  await expect(offerRow(ap, 'LC')).toHaveCount(0);
  expect(await ap.evaluate(() => crc.ws.getActingPositions('INCIRLIK').sort())).toEqual(['AP', 'LC']);
});

test('a controller who signs on LATER sees the standing offer, and a reload shows it again', async ({ browser }) => {
  const a = await tower(browser, 'HAT201');
  await declare(a, ['OPS', 'CD', 'GC']);
  await expect.poll(() => a.evaluate(() => crc.ws.getAckedPositions('INCIRLIK').sort().join())).toBe('CD,GC,OPS');
  const ap = await controller(browser, { signedOn: ['AP'], controller: 'consol-ap-late' });
  await expect(offerRow(ap, 'LC')).toContainText('LC is unstaffed with 1 Strip');

  // A reload is a reconnect: the offer comes back with the snapshot (hatOffers on the Position entry, `self` beside it).
  await openPanel(ap, { signedOn: ['AP'], controller: 'consol-ap-late' });
  await expect(offerRow(ap, 'LC')).toContainText('LC is unstaffed with 1 Strip');
});

test('"Not now" hides the row until a Strip is handed to the empty Position', async ({ browser }) => {
  const a = await tower(browser, 'HAT301');
  const ap = await controller(browser, { signedOn: ['AP'], controller: 'consol-ap-notnow' });
  await declare(a, ['OPS', 'CD', 'GC']);
  await expect(offerRow(ap, 'LC')).toBeVisible();
  await offerRow(ap, 'LC').locator('.efsp-offer-dismiss').click();
  await expect(offerRow(ap, 'LC')).toHaveCount(0);

  // A second departure reaches LC while it is empty: delivered there (UNSTAFFED_RECEIVER), the count grows, the row is back.
  await seedStrip(a, { callsign: 'HAT302', stripType: 'DEPARTURE', flightData: FLIGHT_DATA });
  await taxiToTower(a, 'HAT302');
  await expect(offerRow(ap, 'LC')).toContainText('LC is unstaffed with 2 Strips');
});

test('an Observer of a Position that lost its Primary is asked "Take it?" and becomes Primary', async ({ browser }) => {
  const a = await tower(browser, 'HAT401');
  const b = await controller(browser, { signedOn: ['LC'], controller: 'consol-observer' });
  expect(await b.evaluate(() => crc.ws.isObserverAt('INCIRLIK', 'LC'))).toBe(true);
  await expect(b.locator('#efsp-combination .efsp-position-offer')).toHaveCount(0);

  await declare(a, ['OPS', 'CD', 'GC']);
  const row = offerRow(b, 'LC');
  await expect(row).toContainText('LC has no Primary and 1 Strip');
  await row.locator('.efsp-offer-take').click();
  await expect(offerRow(b, 'LC')).toHaveCount(0);
  await expect.poll(() => b.evaluate(() => crc.ws.isObserverAt('INCIRLIK', 'LC'))).toBe(false);
  expect(await b.evaluate(() => crc.ws.getActingPositions('INCIRLIK'))).toContain('LC');
});
