'use strict';

/* L28 (docs/adr/0087): an overflight's four states on screen, CTR to AP.
 * Every Strip the test makes is dropped at its end (the Board lives for the whole run). */

const path = require('path');
const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, stripByCallsign, startAction, dropStrips, lapseNlaGuard } = require('./helpers/app');

test.describe.configure({ timeout: 90000 });
test.use({ viewport: { width: 1500, height: 1000 } });

let seq = 0;
const cs = (p) => `${p}${(Date.now() + seq++) % 10000}`;
const _contexts = [];
test.afterEach(async () => { while (_contexts.length) await _contexts.pop().close().catch(() => {}); });

async function controller(browser, opts) {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1500, height: 1000 } });
  _contexts.push(ctx);
  const page = await ctx.newPage();
  await openPanel(page, opts);
  return page;
}

const records = (page, callsign) => page.evaluate((c) => [...crc.state.efspStrips.values()]
  .filter(s => (crc.state.efspFlightDataList.get(s.flightDataId) || {}).identity && crc.state.efspFlightDataList.get(s.flightDataId).identity.callsign === c && s.state !== 'DROPPED')
  .map(s => ({ facilityId: s.facilityId, owner: s.ownerPositionId, bayId: s.bayId, state: s.state, stripType: s.stripType })), callsign);
const stateAt = async (page, callsign, facilityId) => ((await records(page, callsign)).find(r => r.facilityId === facilityId) || {}).state || null;
const shot = (page, name) => page.screenshot({ path: test.info().outputPath(`${name}.png`) });
const nla = (page, callsign) => stripByCallsign(page, callsign).locator('.efsp-nla-btn');
async function press(page, callsign) { // the 400 ms double-tap guard is per Strip
  await lapseNlaGuard(page);
  await nla(page, callsign).click();
}
async function goBay(page, positionId, bayId) {
  await page.locator(`#efsp-position-tabs .efsp-position-tab[data-position-id="${positionId}"]`).click();
  await page.locator(`#efsp-bay-tabs .efsp-bay-tab[data-bay-id="${bayId}"]`).click();
}

test('an overflight walks INBOUND, IN_SECTOR, is handed CTR to AP, and is dropped at AP', async ({ browser }) => {
  const ctr = await controller(browser, { signedOn: ['CTR'], facilityId: 'CENTER', controller: 'l28-ctr' });
  const ap = await controller(browser, { signedOn: ['AP'], facilityId: 'INCIRLIK', controller: 'l28-ap' });
  const callsign = cs('OVF');
  try {
    // 1. CTR creates it: INBOUND, in CTR's overflight Bay, Radar Contact on offer.
    await goBay(ctr, 'CTR', 'ctr-overflight'); // the Strip count the seed waits on is the visible Bay's
    await seedStrip(ctr, { callsign, actingPositionId: 'CTR', bayId: 'ctr-overflight', stripType: 'OVERFLIGHT', facilityId: 'CENTER' });
    await expect(nla(ctr, callsign)).toHaveText(/Radar Contact/);
    expect((await records(ctr, callsign))[0]).toMatchObject({ state: 'INBOUND', bayId: 'ctr-overflight', stripType: 'OVERFLIGHT' });
    await shot(ctr, '01-ctr-creates-inbound');

    // 2. Radar Contact: IN_SECTOR, and the NLA now says what it does ("leaves our airspace"); Coordinate is on the menu.
    await press(ctr, callsign);
    await expect.poll(() => stateAt(ctr, callsign, 'CENTER')).toBe('IN_SECTOR');
    await expect(nla(ctr, callsign)).toHaveText(/Leaves Sector/);
    await stripByCallsign(ctr, callsign).locator('.efsp-strip-menu-btn').click();
    await expect(ctr.locator('.efsp-strip-menu').getByRole('menuitem', { name: 'Coordinate…', exact: true }), 'an IN_SECTOR overflight can coordinate (F14)').toBeVisible();
    await shot(ctr, '02-in-sector');
    await ctr.keyboard.press('Escape');

    // 3. HANDOFF to AP: the replica reaches AP INBOUND, in a coordination Bay.
    await startAction(stripByCallsign(ctr, callsign), 'Coordinate…');
    const popover = ctr.locator('.efsp-coordinate-popover');
    await popover.locator('.efsp-coordinate-primitive-select').selectOption('HANDOFF');
    await popover.getByRole('button', { name: 'Send' }).dispatchEvent('click');
    await expect.poll(() => stateAt(ap, callsign, 'INCIRLIK')).toBe('INBOUND');
    expect((await records(ap, callsign)).find(r => r.facilityId === 'INCIRLIK')).toMatchObject({ stripType: 'OVERFLIGHT', owner: 'AP' });
    await ap.locator('#efsp-position-tabs .efsp-position-tab[data-position-id="AP"]').click();
    await ap.locator('#efsp-bay-tabs .efsp-bay-tab.efsp-tab-has-arrival').click();
    await expect(ap.locator('.efsp-strip', { hasText: callsign }).first()).toBeVisible();
    await shot(ap, '03-handoff-to-app');

    // 4. AP accepts: it lands in AP's overflight Bay (not ARRIVAL's inbound Bay), the sender is HANDED_OFF with Drop on offer.
    await ap.locator('.efsp-strip', { hasText: callsign }).first().getByRole('button', { name: /accept/i }).first().click();
    await expect.poll(async () => ((await records(ap, callsign)).find(r => r.facilityId === 'INCIRLIK') || {}).bayId).toBe('ap-overflight');
    await expect.poll(() => stateAt(ctr, callsign, 'CENTER')).toBe('HANDED_OFF');
    await expect(nla(ctr, callsign)).toHaveText(/Drop/);
    await shot(ctr, '04-accepted');

    // 5. AP walks it: Radar Contact, then it is AP's flight to hand off or drop; CTR drops its own.
    await goBay(ap, 'AP', 'ap-overflight');
    await expect(nla(ap, callsign)).toHaveText(/Radar Contact/);
    await press(ap, callsign);
    await expect.poll(() => stateAt(ap, callsign, 'INCIRLIK')).toBe('IN_SECTOR');
    await press(ap, callsign);
    await expect.poll(() => stateAt(ap, callsign, 'INCIRLIK')).toBe('HANDED_OFF');
    await press(ap, callsign);
    await expect.poll(() => stateAt(ap, callsign, 'INCIRLIK')).toBeNull();
    await shot(ap, '05-app-walks-it');
    await press(ctr, callsign);
    await expect.poll(() => records(ctr, callsign)).toEqual([]);
  } finally {
    await dropStrips(ctr, [callsign]);
    await dropStrips(ap, [callsign]);
  }
});

test('an overflight that leaves our airspace goes IN_SECTOR to HANDED_OFF with no transfer, then is dropped', async ({ browser }) => {
  const ctr = await controller(browser, { signedOn: ['CTR'], facilityId: 'CENTER', controller: 'l28-ctr2' });
  const callsign = cs('LVE');
  try {
    await goBay(ctr, 'CTR', 'ctr-overflight'); // the Strip count the seed waits on is the visible Bay's
    await seedStrip(ctr, { callsign, actingPositionId: 'CTR', bayId: 'ctr-overflight', stripType: 'OVERFLIGHT', facilityId: 'CENTER' });
    await press(ctr, callsign);
    await expect.poll(() => stateAt(ctr, callsign, 'CENTER')).toBe('IN_SECTOR');
    await press(ctr, callsign);
    await expect.poll(() => stateAt(ctr, callsign, 'CENTER')).toBe('HANDED_OFF');
    const rec = (await records(ctr, callsign))[0];
    expect(rec, 'still CTR\'s, still in its overflight Bay: nothing was transferred').toMatchObject({ owner: 'CTR', bayId: 'ctr-overflight' });
    await expect(ctr.locator('.efsp-strip', { hasText: callsign }).locator('.efsp-strip-menu-btn')).toBeVisible();
    await expect(nla(ctr, callsign)).toHaveText(/Drop/);
    await shot(ctr, '06-leaves-our-airspace');
    await press(ctr, callsign);
    await expect.poll(() => records(ctr, callsign)).toEqual([]);
  } finally {
    await dropStrips(ctr, [callsign]);
  }
});
