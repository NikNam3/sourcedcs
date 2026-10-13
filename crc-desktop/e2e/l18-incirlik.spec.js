'use strict';

/* L18 on screen (crc-sync docs/adr/0075, 0093), as docs/adr/0117 left it: RSU's pattern board; AP's SFA frequency racks with
 * their header and "Hand off to PAR" (no SFA Position: JO 7610.14A para 7-1-5); PAR's FINAL Bay line (HDG and ALT, Begin
 * descent, Cleared to land, Landed, Missed approach (back to AP, H137), the ⋯ menu; the picture is the PAR panel's, e2e/par-panel.spec.js).
 * One controller holds GC, RSU, AP and PAR. Run on E2E_LANE=9. The Board lives for the whole run, so every test drops what
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
  await openPanel(page, { signedOn: ['GC', 'RSU', 'AP', 'PAR'], controller: 'e2e-l18' });
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

test('02 PAR (T5, T11): HDG and ALT on the FINAL line; Begin descent and Cleared to land recorded; Landed sends it to GC and frees the Bay; a second aircraft is handed in', async ({ page }) => {
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
  const row = page.locator('.efsp-final-row', { hasText: a });
  await expect(row).toBeVisible();
  await expect(page.locator('.efsp-strip:visible')).toHaveCount(0);       // PAR's racks are replaced by the flight line
  await expect(row.locator('.efsp-final-name')).toHaveText(a);
  await expect(row.locator('.efsp-final-terminal')).toHaveText(['Begin descent', 'Cleared to land', 'Landed', 'Missed approach']);
  await expect(row.locator('.efsp-strip-menu-btn')).toBeVisible();        // the Strip's ⋯ menu, its racks being hidden
  await row.locator('.efsp-final-hdg').fill('065');
  await row.locator('.efsp-final-hdg').press('Enter');
  await row.locator('.efsp-final-alt').fill('030');
  await row.locator('.efsp-final-alt').press('Enter');
  const assigned = (f) => page.evaluate(([c, field]) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
    const e = crc.state.getEfspFlightData(s.flightDataId).clearance[field].entries.find(x => x.status === 'ACTIVE');
    return e ? e.value : null;
  }, [a, f]);
  await expect.poll(() => assigned('heading')).toBe('065');
  await expect.poll(() => assigned('altitude')).toBe('030');
  await page.locator('.efsp-final-row', { hasText: a }).locator('.efsp-final-terminal[data-terminal="BEGIN_DESCENT"]').click();
  await expect.poll(() => assigned('altitude')).toBe(''); // the glidepath, no assigned altitude
  await expect(page.locator('.efsp-final-row', { hasText: a }).locator('.efsp-final-terminal[data-terminal="BEGIN_DESCENT"]')).toBeDisabled();
  await page.locator('.efsp-final-row', { hasText: a }).locator('.efsp-final-terminal[data-terminal="CLEARED_TO_LAND"]').click();
  await expect(page.locator('.efsp-final-row', { hasText: a }).locator('.efsp-final-terminal[data-terminal="CLEARED_TO_LAND"]')).toBeDisabled();
  await page.locator('.efsp-final-row', { hasText: a }).locator('.efsp-final-terminal[data-terminal="LANDED"]').click();
  await waitStrip(page, a, s => s.stripType === 'ARRIVAL' && s.state === 'TAXI_IN' && s.ownerPositionId === 'GC' && s.bayId === 'gc-taxi-in', 'A landed: with GC');
  await expect(page.locator('.efsp-final-none')).toHaveText('No aircraft on final.');

  // the Bay is free: B is handed in
  await send(page, b, 'AP', TO_PAR);
  await waitStrip(page, b, s => s.ownerPositionId === 'PAR' && s.bayId === 'par-final', 'B on final once A has landed');
  await expect(page.locator('.efsp-final-row', { hasText: b })).toBeVisible();
});

test('02b missed approach (H137 LT-PQ1 a): back to AP on its frequency Rack with the climb-out kept, PAR\'s final and the frequency free; a second approach records its calls again', async ({ page }) => {
  await controller(page);
  const a = cs('MA');
  await arrival(page, a, 'freq-3');
  await send(page, a, 'AP', TO_PAR);
  await waitStrip(page, a, s => s.ownerPositionId === 'PAR' && s.bayId === 'par-final', 'A on final');
  await openBay(page, 'PAR', 'par-final');
  const row = () => page.locator('.efsp-final-row', { hasText: a });
  const term = (id) => row().locator(`.efsp-final-terminal[data-terminal="${id}"]`);
  const assigned = (f) => page.evaluate(([c, field]) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
    const e = crc.state.getEfspFlightData(s.flightDataId).clearance[field].entries.find(x => x.status === 'ACTIVE');
    return e ? e.value : null;
  }, [a, f]);
  await term('BEGIN_DESCENT').click();
  await expect(term('BEGIN_DESCENT')).toBeDisabled();
  await term('CLEARED_TO_LAND').click();
  await expect(term('CLEARED_TO_LAND')).toBeDisabled();
  // the climb-out PAR issues (JO 7110.65BB para 5-10-12: a specific heading and altitude)
  await row().locator('.efsp-final-hdg').fill('230');
  await row().locator('.efsp-final-hdg').press('Enter');
  await row().locator('.efsp-final-alt').fill('040');
  await row().locator('.efsp-final-alt').press('Enter');
  await expect.poll(() => assigned('altitude')).toBe('040');
  await term('MISSED').click();
  await waitStrip(page, a, s => s.stripType === 'ARRIVAL' && s.state === 'INBOUND' && s.ownerPositionId === 'AP' && s.bayId === 'ap-sfa' && s.rackId === 'freq-3', 'A back with AP on its frequency Rack');
  expect((await stripOf(page, a)).mhz).toBe(234.1);
  await expect(page.locator('.efsp-final-none')).toHaveText('No aircraft on final.');
  expect(await assigned('heading')).toBe('230');
  expect(await assigned('altitude')).toBe('040');

  // AP re-sequences it: the rotating frequency is AP's again, and Hand off to PAR starts the second approach
  await openBay(page, 'AP', 'ap-sfa');
  await expect(page.locator('.efsp-rack-header', { hasText: '234.100 · AP' })).toBeVisible();
  await page.locator('.efsp-final-handoff').first().click();
  await waitStrip(page, a, s => s.ownerPositionId === 'PAR' && s.stripType === 'FINAL' && s.state === 'ON_FINAL' && s.bayId === 'par-final', 'second approach');
  await openBay(page, 'PAR', 'par-final');
  await expect(term('BEGIN_DESCENT')).toBeEnabled();      // the first approach's calls were cleared
  await expect(term('CLEARED_TO_LAND')).toBeEnabled();
  await term('BEGIN_DESCENT').click();
  await expect(term('BEGIN_DESCENT')).toBeDisabled();
  await term('LANDED').click();
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

test('03 RSU: the pattern board replaces the racks; Next leg, Landed and Drop work from the chips', async ({ page }) => {
  await controller(page);
  const call = cs('PAT');
  await page.evaluate((c) => crc.ws.sendEfspCreateStrip('RSU', { kind: 'CreateStrip', bayId: 'rsu-pattern', rackId: 'initial', stripType: 'PATTERN', flightData: { callsign: c, aircraftType: 'F-16C' } }), call);
  await waitStrip(page, call, s => s.ownerPositionId === 'RSU' && s.rackId === 'initial', 'in the pattern');
  await openBay(page, 'RSU', 'rsu-pattern');
  const chip = page.locator('.efsp-pattern-chip', { hasText: call });
  await expect(chip).toBeVisible();
  await expect(page.locator('.efsp-pattern-leg')).toHaveCount(4);
  await chip.locator('.efsp-pattern-next').click();
  await waitStrip(page, call, s => s.rackId === 'base', 'base leg');
  await page.locator('.efsp-pattern-chip', { hasText: call }).locator('[data-action="LANDED"]').click();
  await waitStrip(page, call, s => s.state === 'RECOVERED', 'landed');
  await page.locator('.efsp-pattern-chip', { hasText: call }).locator('[data-action="DROP"]').click();
  await expect.poll(() => stripOf(page, call)).toBeNull();
});
