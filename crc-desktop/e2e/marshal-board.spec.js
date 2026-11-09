'use strict';

/* The MARSHAL panel, the board for every arrival (crc-sync docs/adr/0114, 0156), in the situations the mockup walks: a recovery
 * in order, a flight past its EAT, a Delta and Back to stack; and
 * the "changed, not yet passed" marks, which live on the server (ADR 0115): two pages see the same mark, a reload keeps it. One
 * controller signed on as the Marshal and both approach lanes (07 adds a second controller at the carrier). The Board lives for the whole run, so every test drops what it made
 * and clears the ramp time; side numbers are unique per test.
 */

const { test, expect } = require('./helpers/test');
const { openPanel } = require('./helpers/app');

test.use({ viewport: { width: 1400, height: 1000 } });
test.setTimeout(90000);

let seq = 0;
const unique = () => String((Date.now() + seq++) % 100000);
const _contexts = [];
test.afterEach(async () => { while (_contexts.length) await _contexts.pop().close().catch(() => {}); });

const ALL_CARRIER = ['CV_MARSHAL', 'CV_APP1', 'CV_APP2', 'CV_PRIFLY'];

async function marshalPage(browser, baseURL, name, signedOn = ALL_CARRIER) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1400, height: 1000 } });
  _contexts.push(context);
  const page = await context.newPage();
  return mountMarshal(page, name, signedOn);
}

/** Signs on and docks the MARSHAL panel; also what a reload goes through (openPanel navigates afresh). */
async function mountMarshal(page, name, signedOn = ALL_CARRIER) {
  await openPanel(page, { signedOn, facilityId: 'CARRIER', controller: name });
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

/** Checks a flight in by its side number with its fuel, as the Marshal does (crc-sync docs/adr/0156); the callsign is for lookups. */
async function flight(page, { side, fuel }) {
  const callsign = `Z${side}`;
  await page.evaluate(([c, sd, f]) => crc.ws.sendEfspCreateStrip('CV_MARSHAL', {
    kind: 'CreateStrip', bayId: 'cv-marshal-stack', rackId: 'main', stripType: 'CV_RECOVERY',
    flightData: { sideNumber: sd, callsign: c, aircraftType: 'FA18C', ...(f != null ? { lowStateLb: f } : {}) },
  }, 'CARRIER'), [callsign, side, fuel]);
  await waitStrip(page, callsign, s => s.state === 'STACK', `${callsign} checked in`);
  await expect(page.locator(`#marshal-panel [data-cell="side"]`, { hasText: side })).toBeVisible();
  return callsign;
}
const advance = (page, side) => row(page, side).locator('[data-marshal-action="advance"]');
const backToStack = (page, callsign) => page.evaluate((c) => {
  const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
  crc.ws.sendEfspMutation('CV_MARSHAL', s, { kind: 'CarrierHandoff', transfer: 'RETURN_TO_STACK' });
}, callsign);

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

test('01 a recovery in order: landing order, side numbers, each row\'s button its state, the next flight\'s COMMENCE marked, TO GO, all grey', async ({ browser, baseURL }) => {
  const page = await marshalPage(browser, baseURL, 'e2e-mb1');
  const [s1, s2, s3] = [`1${unique()}`, `2${unique()}`, `3${unique()}`];
  await typeState(page, 'rampTime', rampIn(30));
  await flight(page, { side: s1, fuel: 7200 });
  await flight(page, { side: s2, fuel: 8300 });
  await flight(page, { side: s3, fuel: 6100 });
  const p = panelOf(page);
  await expect(p.locator('tr.mb-row')).toHaveCount(3);
  await expect(p.locator('tr.mb-row').nth(0)).toContainText(s1);
  await expect(advance(page, s2)).toHaveText('COMMENCE');
  await expect(row(page, s1).locator('[data-cell="ang"]')).toHaveText('6');
  await expect(row(page, s3).locator('[data-cell="ang"]')).toHaveText('8');
  await expect(row(page, s1).locator('[data-part="fuel"]')).toHaveValue('7.2');
  await expect(p.locator('.mb-commence')).toHaveCount(1);
  await expect(row(page, s1).locator('.mb-commence')).toBeVisible();
  await expect(p.locator('[data-marshal="togo"]')).toHaveText('3');
  await expect(p.locator('[data-marshal="case"]')).toHaveText('III');
  await expect(p.locator('.mb-chg, .mb-late')).toHaveCount(0);
  await expect(p.locator('[data-marshal="picture"]')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('01-in-order.png') });
  await cleanUp(page);
});

test('03 past EAT and not pushed: amber on that flight\'s EAT only', async ({ browser, baseURL }) => {
  const page = await marshalPage(browser, baseURL, 'e2e-mb3');
  const [a, b] = [`7${unique()}`, `8${unique()}`];
  // the ramp time is a quarter of an hour ago, so both EATs have passed and nobody has pushed
  await typeState(page, 'rampTime', rampIn(-15));
  await flight(page, { side: a, fuel: 7000 });
  await flight(page, { side: b, fuel: 7000 });
  await expect(row(page, a).locator('[data-part="eat"]')).toHaveClass(/mb-late/);
  await expect(row(page, b).locator('[data-part="eat"]')).toHaveClass(/mb-late/);
  // Commence clears it for that flight
  await advance(page, a).click();
  await expect(advance(page, a)).toHaveText('TO APPR');
  await expect(row(page, a).locator('[data-part="eat"]')).not.toHaveClass(/mb-late/);
  await page.screenshot({ path: test.info().outputPath('03-past-eat.png') });
  await cleanUp(page);
});

test('04 Delta: even minutes from four; the holding flights\' EATs move and show amber until the row is clicked', async ({ browser, baseURL }) => {
  const page = await marshalPage(browser, baseURL, 'e2e-mb4');
  const [a, b] = [`9${unique()}`, `1${unique()}`];
  await typeState(page, 'rampTime', rampIn(30));
  await flight(page, { side: a, fuel: 7000 });
  await flight(page, { side: b, fuel: 7000 });
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

test('06 Back to stack: the commenced flight returns at the top with new angels and EAT, amber until passed', async ({ browser, baseURL }) => {
  const page = await marshalPage(browser, baseURL, 'e2e-mb6');
  const [a, b, c] = [`3${unique()}`, `4${unique()}`, `5${unique()}`];
  await typeState(page, 'rampTime', rampIn(30));
  const csA = await flight(page, { side: a, fuel: 7000 });
  await flight(page, { side: b, fuel: 7000 });
  await flight(page, { side: c, fuel: 7000 });
  const p = panelOf(page);
  await advance(page, a).click();
  await waitStrip(page, csA, s => s.state === 'COMMENCED', 'commenced');
  await expect(advance(page, a)).toHaveText('TO APPR');
  await expect(p.locator('tr.mb-row').nth(0)).toContainText(a); // the commenced flight is ahead of the holding ones
  await backToStack(page, csA); // the Strip's "…" menu: Back to stack
  await waitStrip(page, csA, s => s.state === 'STACK' && s.ownerPositionId === 'CV_MARSHAL', 'back in the stack');
  await expect(advance(page, a)).toHaveText('COMMENCE');
  await expect(p.locator('tr.mb-row').last()).toContainText(a);
  await expect(row(page, a).locator('[data-cell="ang"]')).toHaveText('9');
  await expect(row(page, a).locator('[data-part="angels"]')).toHaveClass(/mb-chg/);
  await expect(row(page, a).locator('[data-part="eat"]')).toHaveClass(/mb-chg/);
  await expect(row(page, b).locator('[data-part="eat"]')).not.toHaveClass(/mb-chg/);
  await page.screenshot({ path: test.info().outputPath('06-back-to-stack.png') });
  await row(page, a).locator('[data-cell="side"]').click();
  await expect(row(page, a).locator('[data-part="angels"]')).not.toHaveClass(/mb-chg/);
  await cleanUp(page);
});

test('07 the marks are the server\'s: two pages see the same mark, a reload keeps it, passing it on one clears it on both', async ({ browser, baseURL }) => {
  const page = await marshalPage(browser, baseURL, 'e2e-mb7');
  // a second controller at the Marshal's Position with the board open: the Position is held, so this one is its Observer
  const other = await marshalPage(browser, baseURL, 'e2e-mb7b', ['CV_MARSHAL']);
  expect(await other.evaluate(() => crc.ws.isObserverAt('CARRIER', 'CV_MARSHAL'))).toBe(true);
  const [a, b] = [`6${unique()}`, `7${unique()}`];
  await typeState(page, 'rampTime', rampIn(30));
  await flight(page, { side: a, fuel: 7000 });
  await flight(page, { side: b, fuel: 7000 });
  for (const pg of [page, other]) {
    await expect(row(pg, a).locator('[data-part="eat"]')).not.toHaveClass(/mb-chg/);
  }
  const p = panelOf(page);
  await p.locator('[data-marshal-action="delta-open"]').click();
  await p.locator('[data-marshal-input="delta"]').fill('4');
  await p.locator('[data-marshal-action="delta-send"]').click();
  for (const pg of [page, other]) {
    await expect(row(pg, a).locator('[data-part="eat"]')).toHaveClass(/mb-chg/);
    await expect(row(pg, b).locator('[data-part="eat"]')).toHaveClass(/mb-chg/);
  }
  // the Marshal reloads: the marks are still there (they were never the window's)
  await mountMarshal(page, 'e2e-mb7');
  await expect(row(page, a).locator('[data-part="eat"]')).toHaveClass(/mb-chg/);
  await expect(row(page, b).locator('[data-part="eat"]')).toHaveClass(/mb-chg/);
  // the Marshal passes one: it clears on both pages, the other flight stays marked on both
  await row(page, a).locator('[data-cell="side"]').click();
  for (const pg of [page, other]) {
    await expect(row(pg, a).locator('[data-part="eat"]')).not.toHaveClass(/mb-chg/);
    await expect(row(pg, b).locator('[data-part="eat"]')).toHaveClass(/mb-chg/);
  }
  // the setting is this controller's: off, nothing shows here, and the mark is still on the other page
  await page.evaluate(() => crc.settingsRegistry.setSetting('marshalMarkChanged', false));
  await expect(row(page, b).locator('[data-part="eat"]')).not.toHaveClass(/mb-chg/);
  await expect(row(other, b).locator('[data-part="eat"]')).toHaveClass(/mb-chg/);
  await page.evaluate(() => crc.settingsRegistry.setSetting('marshalMarkChanged', true));
  await expect(row(page, b).locator('[data-part="eat"]')).toHaveClass(/mb-chg/);
  await page.screenshot({ path: test.info().outputPath('07-shared-marks.png') });
  await cleanUp(page);
});

test('08 the Marshal types the fuel and assigns an EAT in the panel (U22, crc-sync docs/adr/0137); clearing gives the slot\'s back', async ({ browser, baseURL }) => {
  const page = await marshalPage(browser, baseURL, 'e2e-mb8');
  const [s1, s2] = [`1${unique()}`, `2${unique()}`];
  await typeState(page, 'rampTime', rampIn(30));
  await flight(page, { side: s1, fuel: 7200 });
  const cs2 = await flight(page, { side: s2, fuel: 6000 });
  const eatOf = () => page.evaluate((c) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && crc.state.getEfspFlightData(x.flightDataId).identity.callsign === c);
    const e = crc.carrier.carrierDerivedStack().find(d => d.flightDataId === s.flightDataId);
    return e ? { t: e.pushTimeUtc, set: !!e.eatSet } : null;
  }, cs2);
  const slotEat = (await eatOf()).t;

  // fuel: typed in thousands, as spoken; it is the Strip's FUEL, a standing box on a row the Marshal holds
  const fuelIn = row(page, s2).locator('input[data-marshal-input="fuel"]');
  await expect(fuelIn).toHaveValue('6.0');
  await fuelIn.focus();
  // a figure that is not one is refused in place, marked, and Escape puts the shown fuel back
  await fuelIn.fill('4,8');
  await fuelIn.press('Enter');
  await expect(fuelIn).toHaveClass(/mb-input-bad/);
  await expect(fuelIn).toBeFocused();
  await fuelIn.press('Escape');
  await expect(fuelIn).toHaveValue('6.0');
  await fuelIn.fill('4.8');
  await fuelIn.press('Enter');
  // the row is redrawn from the Strip once the box is left; there is no fuel rule (crc-sync docs/adr/0156)
  await expect(row(page, s2).locator('input[data-marshal-input="fuel"]')).toHaveValue('4.8');
  // the type is a box too: the Strip's TYPE
  const typeIn = row(page, s2).locator('input[data-marshal-input="type"]');
  await typeIn.fill('f14b');
  await typeIn.press('Enter');
  await expect(row(page, s2).locator('input[data-marshal-input="type"]')).toHaveValue('F14B');

  // EAT: five minutes after the slot's, typed HHMM; shown set (underlined, not coloured) and amber until passed
  const hhmm = (t) => { const d = new Date(t); return String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0'); };
  const wanted = slotEat + 5 * 60_000;
  await row(page, s2).locator('[data-part="eat"]').click();
  const eatIn = panelOf(page).locator('input[data-marshal-input="eat"]');
  await eatIn.fill(hhmm(wanted));
  await eatIn.press('Enter');
  await expect.poll(eatOf).toEqual({ t: wanted, set: true });
  const eat = row(page, s2).locator('[data-part="eat"]');
  await expect(eat).toHaveText(String(new Date(wanted).getUTCMinutes()).padStart(2, '0'));
  await expect(eat).toHaveClass(/mb-eat-set/);
  await expect(eat).toHaveClass(/mb-chg/);
  await page.screenshot({ path: test.info().outputPath('08-eat-assigned.png') });
  // the other flight's minute is refused (CV NATOPS 6.4.9)
  await row(page, s1).locator('[data-part="eat"]').click();
  const otherIn = panelOf(page).locator('input[data-marshal-input="eat"]');
  await otherIn.fill(hhmm(wanted));
  await otherIn.press('Enter');
  await expect(page.locator('#efsp-mutation-error')).toContainText(/6\.4\.9|same EAT|already has that EAT/);
  // cleared: the slot's EAT again
  await row(page, s2).locator('[data-part="eat"]').click();
  const clearIn = panelOf(page).locator('input[data-marshal-input="eat"]');
  await clearIn.fill('');
  await clearIn.press('Enter');
  await expect.poll(eatOf).toEqual({ t: slotEat, set: false });
  await cleanUp(page);
});

test('09 the Marshal checks a flight in from the panel: side number and squawk; the header then reads its figures (crc-sync docs/adr/0156)', async ({ browser, baseURL }) => {
  const page = await marshalPage(browser, baseURL, 'e2e-mb9');
  const p = panelOf(page);
  const side = `4${unique()}`.slice(0, 6);
  await p.locator('[data-marshal-input="create-side"]').fill(side);
  await p.locator('[data-marshal-input="create-squawk"]').fill('4589');
  await p.locator('[data-marshal-action="create"]').click();
  await expect(p.locator('[data-marshal="create-note"]')).toContainText('0-7'); // 8 and 9 are not squawk digits
  await p.locator('[data-marshal-input="create-squawk"]').fill('4521');
  await p.locator('[data-marshal-input="create-squawk"]').press('Enter');
  await expect(row(page, side)).toBeVisible();
  const angels = await row(page, side).locator('[data-cell="ang"]').textContent();
  await expect(p.locator('[data-marshal="next-angels"]')).toHaveText(angels); // the last flight in the stack is this one
  expect(await page.evaluate((sd) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && ((crc.state.getEfspFlightData(x.flightDataId).military || {}).carrier || {}).sideNumber === sd);
    return s && crc.state.getEfspFlightData(s.flightDataId).identity.beaconAssigned;
  }, side)).toBe('4521');
  await page.screenshot({ path: test.info().outputPath('09-create-from-panel.png') });
  await cleanUp(page);
});
