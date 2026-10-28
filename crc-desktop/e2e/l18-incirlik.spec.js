'use strict';

/* L18 on screen (crc-sync docs/adr/0075, 0093), as docs/adr/0117 left it (no RSU since docs/adr/0126; LC's pattern work is e2e/u-twr-pattern.spec.js): AP's SFA frequency racks with
 * their header and "Hand off to PAR" (no SFA Position: JO 7610.14A para 7-1-5); PAR's FINAL Bay of ordinary Strips (H138 U10:
 * HDG and ALT are the 9A-VECTOR and 7A Blocks, the next of Begin descent / Cleared to land beside the NLA Landed, the ⋯ menu's
 * Final group with Missed approach (back to AP, H137); the picture is the PAR panel's, e2e/par-panel.spec.js).
 * One controller holds GC, AP and PAR. Run on E2E_LANE=9. The Board lives for the whole run, so every test drops what
 * it made. */

const { test, expect } = require('./helpers/test');
const { openPanel } = require('./helpers/app');

test.use({ viewport: { width: 1400, height: 1000 } });
test.setTimeout(60000);

let seq = 0;
const cs = (prefix) => `${prefix}${(Date.now() + seq++) % 10000}`;

const stripOf = (page, callsign) => page.evaluate((c) => {
  const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
  return s ? { stripId: s.stripId, stripType: s.stripType, state: s.state, ownerPositionId: s.ownerPositionId, bayId: s.bayId, rackId: s.rackId, mhz: (crc.state.getEfspFlightData(s.flightDataId).comms || {}).workingFrequencyMhz } : null;
}, callsign);
const waitStrip = (page, callsign, pred, what) => expect.poll(async () => { const s = await stripOf(page, callsign); return !!s && pred(s); }, { message: what, timeout: 10000 }).toBe(true);

async function openBay(page, positionId, bayId) {
  await page.locator(`.efsp-position-tab[data-position-id="${positionId}"]`).click();
  await page.locator('.efsp-bay-tab', { hasText: bayId }).first().click();
}

async function cleanUp(page) {
  await page.evaluate(() => {
    for (const s of crc.state.getAllEfspStrips()) {
      if (s.state !== 'DROPPED' && s.facilityId === 'INCIRLIK') crc.ws.sendEfspMutation(s.ownerPositionId, s, { kind: 'DropStrip', reason: 'e2e cleanup' });
    }
  });
  await expect.poll(() => page.evaluate(() => crc.state.getAllEfspStrips().filter(s => s.state !== 'DROPPED' && s.facilityId === 'INCIRLIK').length)).toBe(0);
}

async function controller(page) {
  await openPanel(page, { signedOn: ['GC', 'AP', 'PAR'], controller: 'e2e-l18' });
  await page.waitForFunction(() => crc.state.getEfspBays().some(b => b.bayId === 'ap-sfa' && Array.isArray(b.sfaPool)));
}

const send = (page, callsign, positionId, op) => page.evaluate(([c, p, o]) => {
  const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
  crc.ws.sendEfspMutation(p, s, o);
}, [callsign, positionId, op]);

/** An arrival with AP, filed on SFA frequency `rack` when given (the Rack assigns the flight that frequency). */
async function arrival(page, callsign, rack) {
  await page.evaluate((c) => crc.ws.sendEfspCreateStrip('AP', { kind: 'CreateStrip', bayId: 'ap-inbound', rackId: 'main', stripType: 'ARRIVAL', flightData: { callsign: c, aircraftType: 'F-16C', originAirport: 'LTAG' } }), callsign);
  await waitStrip(page, callsign, s => s.ownerPositionId === 'AP', `${callsign} created at AP`);
  if (!rack) return;
  await send(page, callsign, 'AP', { kind: 'MoveStrip', bayId: 'ap-sfa', rackId: rack });
  await waitStrip(page, callsign, s => s.bayId === 'ap-sfa' && s.rackId === rack, `${callsign} on ${rack}`);
}
const TO_PAR = { kind: 'TransferStrip', toPositionId: 'PAR', bayId: 'par-final', rackId: 'main' };

// PAR's FINAL Strip (H138 U10): an ordinary Strip in the par-final Bay.
const finalStrip = (page, callsign) => page.locator('.efsp-strip', { hasText: callsign });
/** Types `value` into one of the Strip's Blocks (9A-VECTOR = HDG, 7A = ALT) and sends it with Enter. */
async function typeBlock(page, callsign, blockId, value) {
  await finalStrip(page, callsign).locator(`.efsp-block-${blockId}`).click();
  const input = finalStrip(page, callsign).locator('input.efsp-block-input');
  await input.fill(value);
  await input.press('Enter');
}
/** The ⋯ menu's item `key` (opens the menu; the caller clicks or checks it). */
async function menuItem(page, callsign, key) {
  await finalStrip(page, callsign).locator('.efsp-strip-menu-btn').click();
  return page.locator(`.efsp-strip-menu [data-strip-action="${key}"]`);
}
const closeMenu = (page) => page.keyboard.press('Escape');

test.afterEach(async ({ page }) => { await cleanUp(page).catch(() => {}); });

test('01 SFA (T1): AP files the arrival on a rotating frequency and presses Hand off to PAR; the frequency is unchanged and the header shows PAR on it', async ({ page }) => {
  await controller(page);
  const call = cs('SFA');
  await arrival(page, call, 'freq-2');
  expect((await stripOf(page, call)).mhz).toBe(233.1);

  await openBay(page, 'AP', 'ap-sfa');
  const header = page.locator('.efsp-sfa-header');
  await expect(header).toBeVisible();
  await expect(header.locator('.efsp-sfa-row')).toHaveCount(5);
  await expect(header.locator('.efsp-sfa-select')).toHaveCount(0); // nothing to set: the rotation follows the handoffs
  await expect(page.locator('.efsp-rack-header', { hasText: '233.100 · AP' })).toBeVisible();
  await expect(page.locator('.efsp-rack-header', { hasText: '232.100 · INIT' })).toBeVisible();
  await expect(page.locator('.efsp-rack-header', { hasText: '236.100 · SPARE' })).toBeVisible();

  await page.locator('.efsp-final-handoff').first().click();             // Hand off to PAR
  await waitStrip(page, call, s => s.ownerPositionId === 'PAR' && s.stripType === 'FINAL' && s.state === 'ON_FINAL' && s.bayId === 'par-final', 'handed to PAR');
  expect((await stripOf(page, call)).mhz).toBe(233.1);
  await expect(page.locator('.efsp-rack-header', { hasText: '233.100 · PAR' })).toBeVisible();
});

test('01b T1, the live test\'s refused drop: an arrival from AP\'s inbound Bay (no SFA frequency) into PAR\'s final Bay is accepted', async ({ page }) => {
  await controller(page);
  const call = cs('DRP');
  await arrival(page, call, null);
  await send(page, call, 'AP', TO_PAR);
  await waitStrip(page, call, s => s.ownerPositionId === 'PAR' && s.stripType === 'FINAL' && s.bayId === 'par-final', 'handed to PAR');
});

test('02 PAR (T5, T11, H138 U10): HDG and ALT on the FINAL Strip; Begin descent and Cleared to land recorded; Landed (the NLA) sends it to GC and frees the Bay; a second aircraft is handed in', async ({ page }) => {
  await controller(page);
  const a = cs('PA'); const b = cs('PB');
  await arrival(page, a, 'freq-2');
  await arrival(page, b, 'freq-3');
  await send(page, a, 'AP', TO_PAR);
  await waitStrip(page, a, s => s.ownerPositionId === 'PAR', 'A on final');
  // PAR holds one aircraft: B is refused and waits with AP
  await send(page, b, 'AP', TO_PAR);
  await expect(page.locator('#efsp-mutation-error')).toContainText(/par-final holds 1 Strip/, { timeout: 5000 });
  expect((await stripOf(page, b)).ownerPositionId).toBe('AP');

  await openBay(page, 'PAR', 'par-final');
  const strip = finalStrip(page, a);
  await expect(strip).toBeVisible();                                     // the ordinary Strip, no flight line
  await expect(page.locator('.efsp-final-row')).toHaveCount(0);
  await expect(strip.locator('.efsp-strip-menu-btn')).toBeVisible();
  const call = strip.locator('[data-par-call]');
  const landed = strip.locator('.efsp-nla-btn:not([data-par-call])');
  await expect(call).toHaveText('Begin descent');
  await expect(landed).toHaveText('Landed');
  await typeBlock(page, a, '9A-VECTOR', '065');
  await typeBlock(page, a, '7A', '030');
  const assigned = (f) => page.evaluate(([c, field]) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
    const e = crc.state.getEfspFlightData(s.flightDataId).clearance[field].entries.find(x => x.status === 'ACTIVE');
    return e ? e.value : null;
  }, [a, f]);
  await expect.poll(() => assigned('heading')).toBe('065');
  await expect.poll(() => assigned('altitude')).toBe('030');
  await call.click();
  await expect.poll(() => assigned('altitude')).toBe(''); // the glidepath, no assigned altitude
  await expect(call).toHaveText('Cleared to land');      // the next call takes its place
  const begin = await menuItem(page, a, 'par-begin-descent');
  await expect(begin).toBeDisabled();                    // the recorded call stays in the menu, greyed
  await closeMenu(page);
  await call.click();
  await expect(call).toHaveCount(0);                     // both once-only calls recorded
  const ctl = await menuItem(page, a, 'par-cleared-to-land');
  await expect(ctl).toBeDisabled();
  await closeMenu(page);
  await landed.click();
  await waitStrip(page, a, s => s.stripType === 'ARRIVAL' && s.state === 'TAXI_IN' && s.ownerPositionId === 'GC' && s.bayId === 'gc-taxi-in', 'A landed: with GC');
  await expect(finalStrip(page, a)).toHaveCount(0);

  // the Bay is free: B is handed in
  await send(page, b, 'AP', TO_PAR);
  await waitStrip(page, b, s => s.ownerPositionId === 'PAR' && s.bayId === 'par-final', 'B on final once A has landed');
  await expect(finalStrip(page, b)).toBeVisible();
});

test('02b missed approach (H137 LT-PQ1 a): back to AP on its frequency Rack with the climb-out kept, PAR\'s final and the frequency free; a second approach records its calls again', async ({ page }) => {
  await controller(page);
  const a = cs('MA');
  await arrival(page, a, 'freq-3');
  await send(page, a, 'AP', TO_PAR);
  await waitStrip(page, a, s => s.ownerPositionId === 'PAR' && s.bayId === 'par-final', 'A on final');
  await openBay(page, 'PAR', 'par-final');
  const call = () => finalStrip(page, a).locator('[data-par-call]');
  const assigned = (f) => page.evaluate(([c, field]) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
    const e = crc.state.getEfspFlightData(s.flightDataId).clearance[field].entries.find(x => x.status === 'ACTIVE');
    return e ? e.value : null;
  }, [a, f]);
  await expect(call()).toHaveText('Begin descent');
  await call().click();
  await expect(call()).toHaveText('Cleared to land');
  await call().click();
  await expect(call()).toHaveCount(0);
  // the climb-out PAR issues (JO 7110.65BB para 5-10-12: a specific heading and altitude)
  await typeBlock(page, a, '9A-VECTOR', '230');
  await typeBlock(page, a, '7A', '040');
  await expect.poll(() => assigned('altitude')).toBe('040');
  await (await menuItem(page, a, 'par-missed')).click();
  await waitStrip(page, a, s => s.stripType === 'ARRIVAL' && s.state === 'INBOUND' && s.ownerPositionId === 'AP' && s.bayId === 'ap-sfa' && s.rackId === 'freq-3', 'A back with AP on its frequency Rack');
  expect((await stripOf(page, a)).mhz).toBe(234.1);
  expect(await assigned('heading')).toBe('230');
  expect(await assigned('altitude')).toBe('040');

  // AP re-sequences it: the rotating frequency is AP's again, and Hand off to PAR starts the second approach
  await openBay(page, 'AP', 'ap-sfa');
  await expect(page.locator('.efsp-rack-header', { hasText: '234.100 · AP' })).toBeVisible();
  await page.locator('.efsp-final-handoff').first().click();
  await waitStrip(page, a, s => s.ownerPositionId === 'PAR' && s.stripType === 'FINAL' && s.state === 'ON_FINAL' && s.bayId === 'par-final', 'second approach');
  await openBay(page, 'PAR', 'par-final');
  await expect(call()).toHaveText('Begin descent');     // the first approach's calls were cleared
  const ctl = await menuItem(page, a, 'par-cleared-to-land');
  await expect(ctl).toBeEnabled();
  await closeMenu(page);
  await call().click();
  await expect(call()).toHaveText('Cleared to land');
  await finalStrip(page, a).locator('.efsp-nla-btn:not([data-par-call])').click();
  await waitStrip(page, a, s => s.stripType === 'ARRIVAL' && s.state === 'TAXI_IN' && s.ownerPositionId === 'GC', 'landed on the second approach');
});

test('02c PAR\'s missed-approach Bay: a Strip PAR keeps there offers Back to AP', async ({ page }) => {
  await controller(page);
  const a = cs('MB');
  await arrival(page, a, 'freq-4');
  await send(page, a, 'AP', TO_PAR);
  await waitStrip(page, a, s => s.ownerPositionId === 'PAR' && s.bayId === 'par-final', 'on final');
  await send(page, a, 'PAR', { kind: 'SetState', toState: 'BOLTER_WAVEOFF' });
  await waitStrip(page, a, s => s.state === 'BOLTER_WAVEOFF' && s.bayId === 'par-missed', 'held by PAR');
  await openBay(page, 'PAR', 'par-missed');
  const nla = page.locator('.efsp-strip', { hasText: a }).locator('.efsp-nla-btn');
  await expect(nla).toHaveText('Back to AP');
  await nla.click();
  await waitStrip(page, a, s => s.stripType === 'ARRIVAL' && s.state === 'INBOUND' && s.ownerPositionId === 'AP' && s.rackId === 'freq-4', 'back to AP');
});
