'use strict';

/* L23 (docs/adr/0080) — the tactical Positions on screen: what a JTAC is sent,
 * the hand-back to TAC_C2, the Bay that follows the Position an unstaffed owner is consolidated at, the TOFI exit
 * answered on an AIC-held line, and D12 on a combined controller.
 *
 * Several controllers at once, one browser context each (a context has one
 * localStorage, so the fake token is per context). Screenshots go to
 * docs/wip/L23/. Callsigns are unique per test: the Board lives for the run.
 */

const path = require('path');
const { test, expect } = require('./helpers/test');
const { openPanel, startAction, stripMenuItem } = require('./helpers/app');

/** A mission line's callsign is not in Block 1 (that is the ATC Strips'), so find the Strip by its text. */
const stripByCallsign = (page, callsign) => page.locator('.efsp-strip', { hasText: callsign }).first();

const SHOTS = path.join(__dirname, '../../docs/wip/L23');
test.use({ viewport: { width: 1400, height: 900 } });
// Each test opens two or three browser contexts and walks a flight through several states; every wait
// in it is on state (waitStrip / expect.poll), so the only time limit that can bite is the test's own,
// which sat at 19-21 s of 20 under load (docs/wip/E2EH.md).
test.describe.configure({ timeout: 90000 });

let seq = 0;
const cs = (prefix) => `${prefix}${(Date.now() + seq++) % 10000}`;

/** One controller: its own context, its own token, the given Positions held at `facilityId`. */
async function controller(browser, baseURL, name, signedOn, facilityId = 'TACTICAL') {
  const context = await browser.newContext({ baseURL, viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await openPanel(page, { signedOn, facilityId, controller: name });
  return { page, context };
}

// `stripType` picks between the two Strips one flight has under TOFI (the ATC side and the MISSION line).
const stripOf = (page, callsign, stripType = null) => page.evaluate(([c, r]) => {
  const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (!r || x.stripType === r) && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
  return s ? { stripId: s.stripId, state: s.state, ownerPositionId: s.ownerPositionId, bayId: s.bayId, rev: s.rev, tofi: s.tofiCoordination } : null;
}, [callsign, stripType]);
const waitStrip = (page, callsign, pred, what, stripType = null) => expect.poll(async () => {
  const s = await stripOf(page, callsign, stripType);
  return !!s && pred(s);
}, { message: what || `${callsign} reaches the expected state`, timeout: 10000 }).toBe(true);
const liveCount = (page) => page.evaluate(() => crc.state.getAllEfspStrips().filter(s => s.state !== 'DROPPED').length);

/** A mutation through the page's own send function, as `positionId`, on the live Strip. */
async function act(page, positionId, callsign, op, stripType = null) {
  await page.evaluate(([pos, c, o, r]) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (!r || x.stripType === r) && crc.state.getEfspFlightData(x.flightDataId).identity.callsign === c);
    crc.ws.sendEfspMutation(pos, crc.state.getEfspStrip(s.stripId), o);
  }, [positionId, callsign, op, stripType]);
}

/** Selects a Position's tab and one of its Bays, the way a controller pages to a Strip. */
async function openBay(page, positionId, bayId) {
  await page.locator(`.efsp-position-tab[data-position-id="${positionId}"]`).click();
  await page.locator('.efsp-bay-tab', { hasText: bayId }).first().click();
}

/** TAC_C2 tasks a mission line and walks it to ON_STATION. */
async function onStationLine(page, callsign) {
  await page.evaluate(([c]) => crc.ws.sendEfspCreateStrip('TAC_C2', {
    kind: 'CreateStrip', bayId: 'tac-c2-tasked', rackId: 'main', stripType: 'MISSION', flightData: { callsign: c },
  }, 'TACTICAL'), [callsign]);
  await waitStrip(page, callsign, s => s.state === 'TASKED');
  await act(page, 'TAC_C2', callsign, { kind: 'SetState', toState: 'AIRBORNE' });
  await waitStrip(page, callsign, s => s.state === 'AIRBORNE');
  await act(page, 'TAC_C2', callsign, { kind: 'SetState', toState: 'ON_STATION' });
  await waitStrip(page, callsign, s => s.state === 'ON_STATION');
}
const handTo = async (page, callsign, positionId, bayId) => {
  await act(page, 'TAC_C2', callsign, { kind: 'TransferStrip', toPositionId: positionId, bayId, rackId: 'main' });
  await waitStrip(page, callsign, s => s.ownerPositionId === positionId);
};

test('01/02 a JTAC session is sent only what TAC_C2 handed it, and hands it back from the menu (B6, B1)', async ({ browser, baseURL }) => {
  const tac = await controller(browser, baseURL, 'e2e-tac1', ['TAC_C2']);
  const jt = await controller(browser, baseURL, 'e2e-jtac1', ['JTAC']);
  const a = cs('HND'); const b = cs('KPT');
  await onStationLine(tac.page, a);
  await onStationLine(tac.page, b);
  await handTo(tac.page, a, 'JTAC', 'jtac-mission');

  // The wire, not just the tabs: the JTAC's store holds one live Strip.
  await expect(jt.page.locator('.efsp-strip')).toHaveCount(1);
  await expect.poll(() => liveCount(jt.page)).toBe(1);
  expect(await stripOf(jt.page, b), 'TAC_C2\'s other line never reached the JTAC').toBeNull();
  expect(await liveCount(tac.page)).toBe(2);
  await jt.page.screenshot({ path: path.join(SHOTS, '01-jtac-sees-only-handed.png') });

  // Holding only JTAC there is no TAC_C2 tab to drag to: the menu has the hand-back.
  await startAction(stripByCallsign(jt.page, a), 'Hand back to TAC_C2');
  await waitStrip(tac.page, a, s => s.ownerPositionId === 'TAC_C2' && s.bayId === 'tac-c2-on-station');
  await expect(jt.page.locator('.efsp-strip')).toHaveCount(0);
  await expect.poll(() => liveCount(jt.page)).toBe(0);
  await openBay(tac.page, 'TAC_C2', 'tac-c2-on-station');
  await expect(stripByCallsign(tac.page, a)).toBeVisible();
  await tac.page.screenshot({ path: path.join(SHOTS, '02-jtac-hands-back-tac-c2-side.png') });
  await jt.page.screenshot({ path: path.join(SHOTS, '02-jtac-hands-back-jtac-side.png') });
  await tac.context.close(); await jt.context.close();
});

test('03 an AIC-held line: NLA disabled with the server\'s reason, a hand-back item, no Coordinate or TOFI (H2, D12)', async ({ browser, baseURL }) => {
  const tac = await controller(browser, baseURL, 'e2e-tac2', ['TAC_C2']);
  const aic = await controller(browser, baseURL, 'e2e-aic2', ['AIC']);
  const line = cs('AIC');
  await onStationLine(tac.page, line);
  await handTo(tac.page, line, 'AIC', 'aic-on-station');

  const strip = stripByCallsign(aic.page, line);
  await expect(strip).toBeVisible();
  await expect(strip.locator('.efsp-nla-inhibit-reason')).toContainText(/not AIC's to advance/);
  await expect(strip.locator('.efsp-nla-btn')).toBeDisabled();
  await strip.locator('.efsp-strip-menu-btn').click();
  const menu = aic.page.locator('.efsp-strip-menu');
  await expect(menu.getByRole('menuitem', { name: 'Hand back to TAC_C2', exact: true })).toBeEnabled();
  // A regex, not exact: a disabled item carries its reason in its name.
  for (const name of [/^Coordinate/, /^TOFI/]) await expect(menu.getByRole('menuitem', { name })).toHaveCount(0);
  await aic.page.screenshot({ path: path.join(SHOTS, '03-aic-hand-back-menu.png') });
  await menu.getByRole('menuitem', { name: 'Hand back to TAC_C2', exact: true }).click();
  await waitStrip(tac.page, line, s => s.ownerPositionId === 'TAC_C2');
  await tac.context.close(); await aic.context.close();
});

test('04 AIC walks away: the line lands in TAC_C2\'s On Station tab, where TAC_C2 can see it (B3)', async ({ browser, baseURL }) => {
  const tac = await controller(browser, baseURL, 'e2e-tac3', ['TAC_C2']);
  const aic = await controller(browser, baseURL, 'e2e-aic3', ['AIC']);
  const line = cs('VAC');
  await onStationLine(tac.page, line);
  await handTo(tac.page, line, 'AIC', 'aic-on-station');
  await aic.page.evaluate(() => crc.ws.sendEfspSetPositions('TACTICAL', []));
  await waitStrip(tac.page, line, s => s.ownerPositionId === 'TAC_C2' && s.bayId === 'tac-c2-on-station');
  await openBay(tac.page, 'TAC_C2', 'tac-c2-on-station');
  await expect(stripByCallsign(tac.page, line)).toBeVisible();
  await tac.page.screenshot({ path: path.join(SHOTS, '04-consolidated-lands-in-tab.png') });
  await tac.context.close(); await aic.context.close();
});

test('05 CTR proposes the TOFI exit while AIC holds the line, and the TAC_C2 seat answers it (B2)', async ({ browser, baseURL }) => {
  const ctr = await controller(browser, baseURL, 'e2e-ctr5', ['CTR'], 'CENTER');
  // One controller holds both: the AIC tab shows the line, and the answer is sent as TAC_C2.
  const combo = await controller(browser, baseURL, 'e2e-combo5', ['TAC_C2', 'AIC']);
  const line = cs('EXT');
  await ctr.page.evaluate(([c]) => crc.ws.sendEfspCreateStrip('CTR', {
    kind: 'CreateStrip', bayId: 'ctr-overflight', rackId: 'main', stripType: 'OVERFLIGHT', flightData: { callsign: c },
  }, 'CENTER'), [line]);
  await waitStrip(ctr.page, line, s => s.state === 'INBOUND', null, 'OVERFLIGHT');
  await act(ctr.page, 'CTR', line, { kind: 'SetState', toState: 'IN_SECTOR' }, 'OVERFLIGHT'); // TOFI ENTRY needs the flight being worked (docs/adr/0087)
  await waitStrip(ctr.page, line, s => s.state === 'IN_SECTOR', null, 'OVERFLIGHT');
  await act(ctr.page, 'CTR', line, { kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2' }, 'OVERFLIGHT');
  // The MISSION Strip minted at TACTICAL shares the callsign; the ATC side is the CENTER one.
  await expect.poll(() => combo.page.evaluate((c) => crc.state.getAllEfspStrips().some(s => s.stripType === 'MISSION' && crc.state.getEfspFlightData(s.flightDataId).identity.callsign === c), line)).toBe(true);
  await act(combo.page, 'TAC_C2', line, { kind: 'TOFI', action: 'ACCEPT', separationRegime: 'MARSA' }, 'MISSION');
  await waitStrip(combo.page, line, s => s.tofi && s.tofi.state === 'ACTIVE', null, 'MISSION');
  await act(combo.page, 'TAC_C2', line, { kind: 'SetState', toState: 'AIRBORNE' }, 'MISSION');
  await waitStrip(combo.page, line, s => s.state === 'AIRBORNE', null, 'MISSION');
  await act(combo.page, 'TAC_C2', line, { kind: 'SetState', toState: 'ON_STATION' }, 'MISSION');
  await waitStrip(combo.page, line, s => s.state === 'ON_STATION', null, 'MISSION');
  await act(combo.page, 'TAC_C2', line, { kind: 'TransferStrip', toPositionId: 'AIC', bayId: 'aic-on-station', rackId: 'main' }, 'MISSION');
  await waitStrip(combo.page, line, s => s.ownerPositionId === 'AIC', null, 'MISSION');

  // CTR sets SEP REG back to ATC, then proposes the exit.
  await act(ctr.page, 'CTR', line, { kind: 'SetBlock', blockId: 'SREG', value: 'ATC' }, 'OVERFLIGHT');
  await expect.poll(() => ctr.page.evaluate((c) => {
    const s = crc.state.getAllEfspStrips().find(x => x.stripType === 'OVERFLIGHT' && crc.state.getEfspFlightData(x.flightDataId).identity.callsign === c);
    return crc.state.getEfspFlightData(s.flightDataId).tofi.separationRegime;
  }, line)).toBe('ATC');
  await act(ctr.page, 'CTR', line, { kind: 'TOFI', action: 'PROPOSE', direction: 'EXIT' }, 'OVERFLIGHT');
  await expect.poll(() => combo.page.evaluate((c) => {
    const s = crc.state.getAllEfspStrips().find(x => x.stripType === 'MISSION' && crc.state.getEfspFlightData(x.flightDataId).identity.callsign === c);
    return s && s.tofiCoordination && s.tofiCoordination.state;
  }, line)).toBe('INITIATED');

  await openBay(combo.page, 'AIC', 'aic-on-station');
  const strip = stripByCallsign(combo.page, line);
  await expect(strip).toBeVisible();
  await combo.page.screenshot({ path: path.join(SHOTS, '05-tofi-exit-answered-before.png') });
  await strip.getByRole('button', { name: 'Accept TOFI Exit' }).click();
  await expect.poll(() => ctr.page.evaluate((c) => {
    const s = crc.state.getAllEfspStrips().find(x => x.stripType === 'OVERFLIGHT' && crc.state.getEfspFlightData(x.flightDataId).identity.callsign === c);
    return s.tofiCoordination && s.tofiCoordination.state;
  }, line)).toBe('COMPLETE');
  expect((await stripOf(combo.page, line, 'MISSION')).ownerPositionId, 'answering did not move the line').toBe('AIC');
  await combo.page.screenshot({ path: path.join(SHOTS, '05-tofi-exit-answered.png') });
  await ctr.context.close(); await combo.context.close();
});

test('06 one controller holding CTR and AIC: Coordinate is offered on CTR\'s Strips and never on the AIC-held line (D12)', async ({ browser, baseURL }) => {
  const tac = await controller(browser, baseURL, 'e2e-tac6', ['TAC_C2']);
  const combo = await controller(browser, baseURL, 'e2e-combo6', ['AIC']);
  await combo.page.evaluate(() => crc.ws.sendEfspSetPositions('CENTER', ['CTR']));
  await combo.page.waitForFunction(() => crc.ws.getActingPositions('CENTER').includes('CTR'));
  const mission = cs('D12');
  await onStationLine(tac.page, mission);
  await handTo(tac.page, mission, 'AIC', 'aic-on-station');
  const overflight = cs('ARR');
  await combo.page.evaluate(([c]) => crc.ws.sendEfspCreateStrip('CTR', {
    kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', stripType: 'ARRIVAL', flightData: { callsign: c },
  }, 'CENTER'), [overflight]);
  await waitStrip(combo.page, overflight, s => s.state === 'INBOUND');

  await openBay(combo.page, 'CTR', 'ctr-enroute');
  await expect(stripByCallsign(combo.page, overflight)).toBeVisible();
  await expect(await stripMenuItem(stripByCallsign(combo.page, overflight), 'Coordinate…')).toBeVisible();
  await combo.page.keyboard.press('Escape');
  await combo.page.screenshot({ path: path.join(SHOTS, '06-ctr-aic-coordinate-on-ctr.png') });

  await openBay(combo.page, 'AIC', 'aic-on-station');
  const line = stripByCallsign(combo.page, mission);
  await expect(line).toBeVisible();
  await line.locator('.efsp-strip-menu-btn').click();
  await expect(combo.page.locator('.efsp-strip-menu').getByRole('menuitem', { name: /^Coordinate/ })).toHaveCount(0);
  await expect(combo.page.locator('.efsp-strip-menu').getByRole('menuitem', { name: /^TOFI/ })).toHaveCount(0);
  await expect(combo.page.locator('.efsp-strip-menu').getByRole('menuitem', { name: 'Hand back to TAC_C2', exact: true })).toBeVisible();
  await combo.page.screenshot({ path: path.join(SHOTS, '06-ctr-aic-no-coordinate-on-aic.png') });
  await tac.context.close(); await combo.context.close();
});
