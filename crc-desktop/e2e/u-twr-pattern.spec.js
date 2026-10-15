'use strict';

/* U-TWR-PATTERN (crc-sync docs/adr/0126; decisions.md H149, H150 TWR-Q1 a): no RSU, the tower works the pattern on its
 * ordinary Strips. On screen:
 *  - LC sets STR and T&G on an arrival with the P/S and OPT cells (one click per step), the final's NLA reads "Closed
 *    traffic", the Strip moves to LC's Pattern Bay and its tab says IN PATTERN; a full stop then goes to GC as always.
 *  - a local departure stays in closed traffic with LC (⋯ Closed traffic) and later leaves it (⋯ Leave pattern).
 * One controller holds OPS, CD, GC, LC and AP. Run on E2E_LANE=7. Every test drops what it made. */

const { test, expect } = require('./helpers/test');
const { openPanel, settle, lapseNlaGuard, startAction, dropStrips } = require('./helpers/app');

test.use({ viewport: { width: 1400, height: 1000 } });
test.setTimeout(90000);

let seq = 0;
const cs = (prefix) => `${prefix}${(Date.now() + seq++) % 10000}`;

const recordOf = (page, callsign) => page.evaluate((c) => {
  const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
  if (!s) return null;
  const f = crc.state.getEfspFlightData(s.flightDataId);
  return { stripType: s.stripType, state: s.state, owner: s.ownerPositionId, bayId: s.bayId, entry: f.assigned.patternEntry || null, option: f.assigned.patternOption || null };
}, callsign);
const waitFor = (page, callsign, pred, what) => expect.poll(async () => { const r = await recordOf(page, callsign); return !!r && pred(r); }, { message: what, timeout: 10000 }).toBe(true);

const send = (page, callsign, positionId, op) => page.evaluate(([c, p, o]) => {
  const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
  crc.ws.sendEfspMutation(p, s, o);
}, [callsign, positionId, op]);

async function openBay(page, positionId, bayId) {
  await page.locator(`#efsp-position-tabs .efsp-position-tab[data-position-id="${positionId}"]`).click();
  await page.locator(`#efsp-bay-tabs .efsp-bay-tab[data-bay-id="${bayId}"]`).click();
}

const stripIn = (page, callsign) => page.locator('.efsp-strip', { has: page.locator('.efsp-block-1', { hasText: callsign }) }).first();

async function pressNla(page, callsign, label) {
  const btn = stripIn(page, callsign).locator('.efsp-nla-btn');
  await expect(btn).toHaveText(label);
  await lapseNlaGuard(page);
  await btn.click();
  await settle(page);
}

async function controller(page) {
  await openPanel(page, { signedOn: ['OPS', 'CD', 'GC', 'LC', 'AP'], controller: `e2e-twr-${cs('')}` });
}

test('01 LC sets STR and T&G on an arrival; after the touch-and-go it is IN PATTERN in the Pattern Bay; a full stop goes to GC', async ({ page }) => {
  await controller(page);
  const call = cs('PAT');
  await page.evaluate((c) => crc.ws.sendEfspCreateStrip('AP', { kind: 'CreateStrip', bayId: 'ap-inbound', rackId: 'main', stripType: 'ARRIVAL',
    flightData: { callsign: c, aircraftType: 'T38', wakeCategory: 'L', originAirport: 'LTAG' } }, 'INCIRLIK'), call);
  await waitFor(page, call, r => r.owner === 'AP', 'with AP');
  send(page, call, 'AP', { kind: 'InvokeNla' });
  await waitFor(page, call, r => r.owner === 'LC' && r.state === 'HANDED_TO_TOWER', 'handed to tower');

  await openBay(page, 'LC', 'lc-arrivals');
  const strip = stripIn(page, call);
  await expect(strip).toBeVisible();
  // PAT -> STR: two clicks on the P/S cell; T&G: one click on OPT.
  const ps = strip.locator('.efsp-block-9J-ENTRY');
  await ps.click(); await settle(page);
  await expect(stripIn(page, call).locator('.efsp-block-9J-ENTRY')).toHaveText('PAT');
  await stripIn(page, call).locator('.efsp-block-9J-ENTRY').click(); await settle(page);
  await expect(stripIn(page, call).locator('.efsp-block-9J-ENTRY')).toHaveText('STR');
  await stripIn(page, call).locator('.efsp-block-9J-OPTION').click(); await settle(page);
  await expect(stripIn(page, call).locator('.efsp-block-9J-OPTION')).toHaveText('T&G');
  await waitFor(page, call, r => r.entry === 'STRAIGHT_IN' && r.option === 'TOUCH_AND_GO', 'cells on the flight data');

  await pressNla(page, call, 'On Final');
  await waitFor(page, call, r => r.state === 'FINAL', 'on final');
  await openBay(page, 'LC', 'lc-final');
  await pressNla(page, call, 'Closed traffic');
  await waitFor(page, call, r => r.state === 'TRAFFIC_PATTERN' && r.bayId === 'lc-pattern', 'in the Pattern Bay');

  await openBay(page, 'LC', 'lc-pattern');
  const inPattern = stripIn(page, call);
  await expect(inPattern).toHaveClass(/efsp-strip-in-pattern/);
  await expect(inPattern.locator('.efsp-strip-tab-type')).toHaveText('ARR · IN PATTERN');
  const markColour = await inPattern.locator('.efsp-strip-tab-type').evaluate(el => getComputedStyle(el).color);
  const otherTabColour = await page.evaluate(() => {
    const el = document.createElement('div'); el.className = 'efsp-strip-tab-type'; document.body.appendChild(el);
    const c = getComputedStyle(el).color; el.remove(); return c;
  });
  expect(markColour, 'the IN PATTERN mark is as grey as any tab (dark cockpit)').toBe(otherTabColour);

  // Full stop next time round: one click on OPT steps T&G -> FS.
  await inPattern.locator('.efsp-block-9J-OPTION').click(); await settle(page);
  await expect(stripIn(page, call).locator('.efsp-block-9J-OPTION')).toHaveText('FS');
  await pressNla(page, call, 'On Final');
  await openBay(page, 'LC', 'lc-final');
  await pressNla(page, call, 'Landed');
  await openBay(page, 'LC', 'lc-landed');
  await pressNla(page, call, 'Taxi In');
  await waitFor(page, call, r => r.state === 'TAXI_IN' && r.owner === 'GC', 'GC has it');
  await dropStrips(page, [call]);
});

test('02 a local departure stays in closed traffic with LC (never to AP), then leaves the pattern', async ({ page }) => {
  await controller(page);
  const call = cs('LCL');
  await page.evaluate((c) => crc.ws.sendEfspCreateStrip('OPS', { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE',
    flightData: { callsign: c, aircraftType: 'T38', wakeCategory: 'L', departureAirport: 'LTAG', destinationAirport: 'LTAG', route: 'DCT', requestedAltitude: '030' } }, 'INCIRLIK'), call);
  await waitFor(page, call, r => r.owner === 'OPS', 'with OPS');
  // The ground part is not this spec's: jump it to LC in the air.
  for (const [p, op, pred] of [
    ['OPS', { kind: 'InvokeNla' }, r => r.owner === 'CD'],
    ['CD', { kind: 'SetState', toState: 'CLEARED' }, r => r.state === 'CLEARED'],
    ['CD', { kind: 'InvokeNla' }, r => r.owner === 'GC'],
    ['GC', { kind: 'SetState', toState: 'TAXI' }, r => r.state === 'TAXI'],
    ['GC', { kind: 'InvokeNla' }, r => r.owner === 'LC'],
    ['LC', { kind: 'SetState', toState: 'DEPARTED' }, r => r.state === 'DEPARTED'],
  ]) {
    await lapseNlaGuard(page);
    await send(page, call, p, op);
    await waitFor(page, call, pred, `${p} ${op.kind}`);
  }
  await openBay(page, 'LC', 'lc-airborne');
  await startAction(stripIn(page, call), 'Closed traffic');
  await waitFor(page, call, r => r.stripType === 'ARRIVAL' && r.state === 'TRAFFIC_PATTERN' && r.bayId === 'lc-pattern' && r.owner === 'LC', 'in closed traffic with LC');

  await openBay(page, 'LC', 'lc-pattern');
  await expect(stripIn(page, call).locator('.efsp-strip-tab-type')).toHaveText('ARR · IN PATTERN');
  await startAction(stripIn(page, call), 'Leave pattern');
  await waitFor(page, call, r => r.stripType === 'DEPARTURE' && r.state === 'DEPARTED' && r.bayId === 'lc-airborne', 'departing again');
  await openBay(page, 'LC', 'lc-airborne');
  await expect(stripIn(page, call).locator('.efsp-nla-btn')).toHaveText('Hand Off to AP');
  await dropStrips(page, [call]);
});

test('03 AP sets the cells before the transfer, and the ⋯ pattern items are not AP\'s', async ({ page }) => {
  await openPanel(page, { signedOn: ['AP'], controller: `e2e-twr-ap-${cs('')}` });
  const call = cs('ROA');
  await page.evaluate((c) => crc.ws.sendEfspCreateStrip('AP', { kind: 'CreateStrip', bayId: 'ap-inbound', rackId: 'main', stripType: 'ARRIVAL',
    flightData: { callsign: c, aircraftType: 'T38', wakeCategory: 'L', originAirport: 'LTAG' } }, 'INCIRLIK'), call);
  await waitFor(page, call, r => r.owner === 'AP', 'with AP');
  await openBay(page, 'AP', 'ap-inbound');
  const cell = stripIn(page, call).locator('.efsp-block-9J-ENTRY');
  await cell.click(); await settle(page);
  await waitFor(page, call, r => r.entry === 'PATTERN', 'AP sets PAT before the transfer');
  await stripIn(page, call).locator('.efsp-strip-menu-btn').click();
  await expect(page.locator('.efsp-strip-menu').getByRole('menuitem', { name: 'Leave pattern', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await dropStrips(page, [call]);
});
