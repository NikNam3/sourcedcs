'use strict';

/* The MARSHAL panel, the recovery board (crc-sync docs/adr/0114; mockup docs/mockups/marshal-stack-panel.html, revision 7), in the
 * situations the mockup walks: a recovery in order, a low state, a flight past its EAT, a Delta, a bolter and Back to stack. One
 * controller signed on as the Marshal and both approach lanes. The Board lives for the whole run, so every test drops what it made
 * and clears the ramp time; side numbers are unique per test.
 */

const { test, expect } = require('./helpers/test');
const { openPanel, lapseNlaGuard } = require('./helpers/app');

test.use({ viewport: { width: 1400, height: 1000 } });
test.setTimeout(90000);

let seq = 0;
const unique = () => String((Date.now() + seq++) % 100000);
const _contexts = [];
test.afterEach(async () => { while (_contexts.length) await _contexts.pop().close().catch(() => {}); });

async function marshalPage(browser, baseURL, name) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1400, height: 1000 } });
  _contexts.push(context);
  const page = await context.newPage();
  await openPanel(page, { signedOn: ['CV_MARSHAL', 'CV_APP1', 'CV_APP2', 'CV_PRIFLY'], facilityId: 'CARRIER', controller: name });
  await page.waitForFunction(() => typeof crc.carrier.getEfspCarrier === 'function' && !!crc.carrier.getEfspCarrier());
  await page.evaluate(() => {
    const p = crc.dock.dock.api.getPanel('marshal');
    if (p) crc.dock.dock.api.removePanel(p);
    crc.dock.dock.addPanel({ id: 'marshal', component: 'marshal', title: crc.dock.PANEL_TITLES.marshal, position: { referencePanel: 'efsp', direction: 'right' } });
    crc.dock.dock.api.getPanel('efsp').api.setActive();
  });
  await expect(page.locator('#marshal-panel')).toBeVisible({ timeout: 10000 });
  return page;
}

const stripOf = (page, callsign) => page.evaluate((c) => {
  const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
  return s ? { stripId: s.stripId, flightDataId: s.flightDataId, stripType: s.stripType, state: s.state, ownerPositionId: s.ownerPositionId } : null;
}, callsign);
const waitStrip = (page, callsign, pred, what) => expect.poll(async () => { const s = await stripOf(page, callsign); return !!s && pred(s); }, { message: what, timeout: 10000 }).toBe(true);
const typeState = (page, field, value) => page.evaluate(([f, v]) => crc.ws.sendEfspCarrierMutation('CV_PRIFLY', undefined, undefined, { kind: 'SetCarrierState', field: f, value: v }), [field, value]);

/** Checks a flight in and types its side number, fuel and bingo, as the Marshal does. */
async function flight(page, { side, fuel, bingo, turn }) {
  const callsign = `Z${side}`;
  await page.evaluate((c) => crc.ws.sendEfspCreateStrip('CV_MARSHAL', {
    kind: 'CreateStrip', bayId: 'cv-marshal-stack', rackId: 'main', stripType: 'MARSHAL', flightData: { callsign: c, aircraftType: 'F-18C' },
  }, 'CARRIER'), callsign);
  await waitStrip(page, callsign, s => s.state === 'IN_STACK', `${callsign} checked in`);
  const blocks = [['C18', side]];
  if (fuel != null) blocks.push(['C12', String(fuel)]);
  if (bingo != null) blocks.push(['C14', String(bingo)]);
  if (turn != null) blocks.push(['C19', String(turn)]);
  for (const [blockId, value] of blocks) {
    await page.evaluate(([c, b, v]) => {
      const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
      crc.ws.sendEfspMutation('CV_MARSHAL', s, { kind: 'SetBlock', blockId: b, value: v });
    }, [callsign, blockId, value]);
    await expect.poll(() => page.evaluate(([c, b]) => {
      const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
      const f = crc.state.getEfspFlightData(s.flightDataId);
      return f.military && f.military.carrier ? f.military.carrier : null;
    }, [callsign, blockId])).not.toBeNull();
  }
  await expect(page.locator(`#marshal-panel [data-cell="side"]`, { hasText: side })).toBeVisible();
  return callsign;
}

/** The ramp time as a HHMM Zulu string `minutes` from now on the mission clock (the harness has no DCS, so it is the wall clock). */
const rampIn = (minutes) => {
  const d = new Date(Date.now() + minutes * 60_000);
  return String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0');
};

async function cleanUp(page) {
  await page.evaluate(() => {
    for (const s of crc.state.getAllEfspStrips()) {
      if (s.state !== 'DROPPED' && s.facilityId === 'CARRIER') {
        const own = crc.ws.getActingPositions('CARRIER');
        if (own.includes(s.ownerPositionId)) crc.ws.sendEfspMutation(s.ownerPositionId, s, { kind: 'DropStrip', reason: 'e2e cleanup' });
      }
    }
  });
  await expect.poll(() => page.evaluate(() => crc.state.getAllEfspStrips().filter(s => s.state !== 'DROPPED' && s.facilityId === 'CARRIER').length)).toBe(0);
  await typeState(page, 'rampTime', null);
}

const panelOf = (page) => page.locator('#marshal-panel');
const row = (page, side) => panelOf(page).locator('tr.mb-row', { has: page.locator('[data-cell="side"]', { hasText: side }) });

test('01 a recovery in order: landing order, side numbers, HOLD, Commence on the next flight only, TO GO, all grey', async ({ browser, baseURL }) => {
  const page = await marshalPage(browser, baseURL, 'e2e-mb1');
  const [s1, s2, s3] = [`1${unique()}`, `2${unique()}`, `3${unique()}`];
  await typeState(page, 'rampTime', rampIn(30));
  await flight(page, { side: s1, fuel: 7200, bingo: 4000 });
  await flight(page, { side: s2, fuel: 8300, bingo: 4500 });
  await flight(page, { side: s3, fuel: 6100, bingo: 3000 });
  const p = panelOf(page);
  await expect(p.locator('tr.mb-row')).toHaveCount(3);
  await expect(p.locator('tr.mb-row').nth(0)).toContainText(s1);
  await expect(row(page, s2).locator('[data-cell="status"]')).toHaveText('HOLD');
  await expect(row(page, s1).locator('[data-cell="ang"]')).toHaveText('6');
  await expect(row(page, s3).locator('[data-cell="ang"]')).toHaveText('8');
  await expect(row(page, s1).locator('[data-part="fuel"]')).toHaveText('7.2');
  await expect(p.locator('[data-marshal-action="commence"]')).toHaveCount(1);
  await expect(row(page, s1).locator('[data-marshal-action="commence"]')).toBeVisible();
  await expect(p.locator('[data-marshal="togo"]')).toHaveText('3');
  await expect(p.locator('[data-marshal="case"]')).toHaveText('III');
  await expect(p.locator('.mb-chg, .mb-late, .mb-fuel-attn, .mb-fuel-danger')).toHaveCount(0);
  await expect(p.locator('[data-marshal="picture"]')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('01-in-order.png') });
  await cleanUp(page);
});

test('02 low state: amber within the margin of bingo, red at bingo, and the margin is the controller\'s setting', async ({ browser, baseURL }) => {
  const page = await marshalPage(browser, baseURL, 'e2e-mb2');
  const [a, b, c] = [`4${unique()}`, `5${unique()}`, `6${unique()}`];
  await flight(page, { side: a, fuel: 4800, bingo: 3500 });   // 1.3 above
  await flight(page, { side: b, fuel: 4200, bingo: 3500 });   // 0.7 above
  await flight(page, { side: c, fuel: 3400, bingo: 3500 });   // below bingo
  const p = panelOf(page);
  await expect(row(page, a).locator('[data-part="fuel"]')).not.toHaveClass(/mb-fuel/);
  await expect(row(page, b).locator('[data-part="fuel"]')).toHaveClass(/mb-fuel-attn/);
  await expect(row(page, c).locator('[data-part="fuel"]')).toHaveClass(/mb-fuel-danger/);
  await expect(p.locator('.mp-fixlabel.mp-attn')).toHaveCount(1);
  await expect(p.locator('.mp-fixlabel.mp-danger')).toHaveCount(1);
  await page.evaluate(() => crc.settingsRegistry.setSetting('marshalLowStateMarginKlb', 2));
  await expect(row(page, a).locator('[data-part="fuel"]')).toHaveClass(/mb-fuel-attn/);
  await page.evaluate(() => crc.settingsRegistry.setSetting('marshalLowStateMarginKlb', 1));
  await page.screenshot({ path: test.info().outputPath('02-low-state.png') });
  await cleanUp(page);
});

test('03 past EAT and not pushed: amber on that flight\'s EAT only', async ({ browser, baseURL }) => {
  const page = await marshalPage(browser, baseURL, 'e2e-mb3');
  const [a, b] = [`7${unique()}`, `8${unique()}`];
  // the ramp time is a quarter of an hour ago, so both EATs have passed and nobody has pushed
  await typeState(page, 'rampTime', rampIn(-15));
  await flight(page, { side: a, fuel: 7000, bingo: 4000 });
  await flight(page, { side: b, fuel: 7000, bingo: 4000 });
  await expect(row(page, a).locator('[data-part="eat"]')).toHaveClass(/mb-late/);
  await expect(row(page, b).locator('[data-part="eat"]')).toHaveClass(/mb-late/);
  // Commence clears it for that flight
  await row(page, a).locator('[data-marshal-action="commence"]').click();
  await expect(row(page, a).locator('[data-cell="status"]')).toHaveText('COMM');
  await expect(row(page, a).locator('[data-part="eat"]')).not.toHaveClass(/mb-late/);
  await page.screenshot({ path: test.info().outputPath('03-past-eat.png') });
  await cleanUp(page);
});

test('04 Delta: even minutes from four; the holding flights\' EATs move and show amber until the row is clicked', async ({ browser, baseURL }) => {
  const page = await marshalPage(browser, baseURL, 'e2e-mb4');
  const [a, b] = [`9${unique()}`, `1${unique()}`];
  await typeState(page, 'rampTime', rampIn(30));
  await flight(page, { side: a, fuel: 7000, bingo: 4000 });
  await flight(page, { side: b, fuel: 7000, bingo: 4000 });
  const p = panelOf(page);
  const minutes = async (side) => Number(await row(page, side).locator('[data-part="eat"]').textContent());
  const before = await minutes(a);
  await p.locator('[data-marshal-action="delta-open"]').click();
  await p.locator('[data-marshal-input="delta"]').fill('3');
  await p.locator('[data-marshal-action="delta-send"]').click();
  await expect(p.locator('[data-marshal="delta-note"]')).toContainText('even minutes');
  expect(await minutes(a)).toBe(before);
  await p.locator('[data-marshal-input="delta"]').fill('4');
  await p.locator('[data-marshal-action="delta-send"]').click();
  await expect.poll(() => minutes(a)).toBe((before + 4) % 60);
  await expect(row(page, a).locator('[data-part="eat"]')).toHaveClass(/mb-chg/);
  await expect(row(page, b).locator('[data-part="eat"]')).toHaveClass(/mb-chg/);
  await page.screenshot({ path: test.info().outputPath('04-delta.png') });
  await row(page, a).locator('[data-cell="side"]').click();
  await expect(row(page, a).locator('[data-part="eat"]')).not.toHaveClass(/mb-chg/);
  await expect(row(page, b).locator('[data-part="eat"]')).toHaveClass(/mb-chg/);
  await cleanUp(page);
});

test('05 a bolter: BOLTER on the board, and the picture draws the bolter racetrack', async ({ browser, baseURL }) => {
  const page = await marshalPage(browser, baseURL, 'e2e-mb5');
  const a = `2${unique()}`;
  await typeState(page, 'rampTime', rampIn(30));
  const cs = await flight(page, { side: a, fuel: 7000, bingo: 4000, turn: 8 });
  const p = panelOf(page);
  await row(page, a).locator('[data-marshal-action="commence"]').click();
  await waitStrip(page, cs, s => s.state === 'COMMENCED', 'commenced');
  await expect(row(page, a).locator('[data-cell="status"]')).toHaveText('COMM');
  await lapseNlaGuard(page);
  await page.evaluate((c) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
    crc.ws.sendEfspMutation(s.ownerPositionId, s, { kind: 'InvokeNla' });
  }, cs);
  await waitStrip(page, cs, s => s.state === 'ON_FINAL', 'radar contact');
  await expect(row(page, a).locator('[data-cell="status"]')).toHaveText(/^APP [AB]$/);
  await page.evaluate((c) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
    crc.ws.sendEfspMutation(s.ownerPositionId, s, { kind: 'SetState', toState: 'BOLTER_WAVEOFF' });
  }, cs);
  await waitStrip(page, cs, s => s.state === 'BOLTER_WAVEOFF', 'bolter');
  await expect(row(page, a).locator('[data-cell="status"]')).toHaveText('BOLTER');
  await expect(row(page, a).locator('[data-marshal-action="back-to-stack"]')).toHaveCount(0);
  // no radar contact in the harness, so nothing is placed by DME; the reference racetrack is drawn at the default turn-in
  await expect(p.locator('.mp-bolter')).toHaveCount(1);
  await expect(p.locator('.mp-bolter')).toHaveAttribute('data-turn-nm', '6');
  await page.screenshot({ path: test.info().outputPath('05-bolter.png') });
  await cleanUp(page);
});

test('06 Back to stack: the commenced flight returns at the top with new angels and EAT, amber until passed', async ({ browser, baseURL }) => {
  const page = await marshalPage(browser, baseURL, 'e2e-mb6');
  const [a, b, c] = [`3${unique()}`, `4${unique()}`, `5${unique()}`];
  await typeState(page, 'rampTime', rampIn(30));
  const csA = await flight(page, { side: a, fuel: 7000, bingo: 4000 });
  await flight(page, { side: b, fuel: 7000, bingo: 4000 });
  await flight(page, { side: c, fuel: 7000, bingo: 4000 });
  const p = panelOf(page);
  await row(page, a).locator('[data-marshal-action="commence"]').click();
  await waitStrip(page, csA, s => s.state === 'COMMENCED', 'commenced');
  await expect(row(page, a).locator('[data-cell="status"]')).toHaveText('COMM');
  await expect(p.locator('tr.mb-row').nth(0)).toContainText(a); // the commenced flight is ahead of the holding ones
  await row(page, a).locator('[data-marshal-action="back-to-stack"]').click();
  await waitStrip(page, csA, s => s.state === 'IN_STACK' && s.ownerPositionId === 'CV_MARSHAL', 'back in the stack');
  await expect(row(page, a).locator('[data-cell="status"]')).toHaveText('HOLD');
  await expect(p.locator('tr.mb-row').last()).toContainText(a);
  await expect(row(page, a).locator('[data-cell="ang"]')).toHaveText('9');
  await expect(row(page, a).locator('[data-cell="ang"]')).toHaveClass(/mb-chg/);
  await expect(row(page, a).locator('[data-part="eat"]')).toHaveClass(/mb-chg/);
  await expect(row(page, b).locator('[data-part="eat"]')).not.toHaveClass(/mb-chg/);
  await page.screenshot({ path: test.info().outputPath('06-back-to-stack.png') });
  await row(page, a).locator('[data-cell="side"]').click();
  await expect(row(page, a).locator('[data-cell="ang"]')).not.toHaveClass(/mb-chg/);
  await cleanUp(page);
});
