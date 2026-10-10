'use strict';

/* L17 (crc-sync docs/adr/0074) — the carrier on screen, as a recovery is flown: PriFly and the Marshal
 * set the Case in the carrier management panel (crc-sync docs/adr/0113) and every Position sees it
 * change, the MARSHAL panel (crc-sync docs/adr/0114) shows the derived angels and EAT and re-sequences by one
 * drag, the four handoffs are four buttons, the talk-down (FINAL) has nothing to type, and a Case I
 * recovery is an altitude list.
 *
 * Two controllers, one browser context each: the Marshal seat (with both approach lanes) and
 * PriFly. Screenshots go to the test output directory (test-results/). The Board lives for the whole run, so every test drops
 * what it made and puts the Case back to III, and callsigns are unique per test.
 */

const path = require('path');
const { test, expect } = require('./helpers/test');
const { openPanel, lapseNlaGuard } = require('./helpers/app');

test.use({ viewport: { width: 1400, height: 1000 } });
test.setTimeout(60000);

let seq = 0;
const cs = (prefix) => `${prefix}${(Date.now() + seq++) % 10000}`;
const _contexts = [];
test.afterEach(async () => { while (_contexts.length) await _contexts.pop().close().catch(() => {}); });

async function controller(browser, baseURL, name, signedOn) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1400, height: 1000 } });
  _contexts.push(context);
  const page = await context.newPage();
  await openPanel(page, { signedOn, facilityId: 'CARRIER', controller: name });
  await page.waitForFunction(() => typeof crc.carrier.getEfspCarrier === 'function' && !!crc.carrier.getEfspCarrier());
  return page;
}

const strip = (page, callsign) => page.locator('.efsp-strip', { has: page.locator('.efsp-block-C1', { hasText: callsign }) }).first();
const stripOf = (page, callsign) => page.evaluate((c) => {
  const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
  return s ? { stripId: s.stripId, flightDataId: s.flightDataId, stripType: s.stripType, state: s.state, ownerPositionId: s.ownerPositionId, bayId: s.bayId, trigger: s.carrierHandoff && s.carrierHandoff.trigger } : null;
}, callsign);
const waitStrip = (page, callsign, pred, what) => expect.poll(async () => { const s = await stripOf(page, callsign); return !!s && pred(s); }, { message: what, timeout: 10000 }).toBe(true);
const waitCase = (page, value) => expect.poll(() => page.evaluate(() => crc.carrier.carrierCaseValue()), { timeout: 10000 }).toBe(value);

async function checkIn(page, callsign) {
  await page.evaluate((c) => crc.ws.sendEfspCreateStrip('CV_MARSHAL', {
    kind: 'CreateStrip', bayId: 'cv-marshal-stack', rackId: 'main', stripType: 'MARSHAL', flightData: { callsign: c, aircraftType: 'F-18C' },
  }, 'CARRIER'), callsign);
  await waitStrip(page, callsign, s => s.state === 'IN_STACK', `${callsign} checked in`);
}

async function openBay(page, positionId, bayId) {
  await page.locator(`.efsp-position-tab[data-position-id="${positionId}"]`).click();
  await page.locator('.efsp-bay-tab', { hasText: bayId }).first().click();
}

/** Drops every live carrier Strip (each page drops the ones its Positions own) and leaves the ship empty for the next spec. */
async function cleanUp(...pages) {
  for (const p of pages) {
    await p.evaluate(() => {
      const signedOn = crc.ws.getActingPositions('CARRIER');
      for (const s of crc.state.getAllEfspStrips()) {
        if (s.state !== 'DROPPED' && s.facilityId === 'CARRIER' && signedOn.includes(s.ownerPositionId)) {
          crc.ws.sendEfspMutation(s.ownerPositionId, s, { kind: 'DropStrip', reason: 'e2e cleanup' });
        }
      }
    });
  }
  await expect.poll(() => pages[0].evaluate(() => crc.state.getAllEfspStrips().filter(s => s.state !== 'DROPPED' && s.facilityId === 'CARRIER').length)).toBe(0);
}
/** Types a value over the carrier state as PriFly, through the page's own send function (the panel itself is test 01 and 06). */
const typeState = (page, field, value, acting = 'CV_PRIFLY') => page.evaluate(([a, f, v]) => crc.ws.sendEfspCarrierMutation(a, undefined, undefined, { kind: 'SetCarrierState', field: f, value: v }), [acting, field, value]);
async function setCase(pri, value) {
  if (await pri.evaluate(() => crc.carrier.carrierCaseValue()) === value) return;
  await typeState(pri, 'case', value);
  await waitCase(pri, value);
}
/**
 * Opens the carrier management panel BESIDE the Strip panel: in the same tab group the other would be detached from the document
 * (dockview), so the banner and the stack board would not be there to read (the runway-status spec's `besideStrips`).
 */
async function openCarrierPanel(page) {
  await page.evaluate(() => {
    const p = crc.dock.dock.api.getPanel('carrier');
    if (p) crc.dock.dock.api.removePanel(p);
    crc.dock.dock.addPanel({ id: 'carrier', component: 'carrier', title: crc.dock.PANEL_TITLES.carrier, position: { referencePanel: 'efsp', direction: 'right' } });
    crc.dock.dock.api.getPanel('efsp').api.setActive();
  });
  await expect(page.locator('#carrier-mgmt-panel')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#efsp-panel')).toBeVisible();
  return page.locator('#carrier-mgmt-panel');
}

/** Opens the MARSHAL panel beside the Strip panel (the carrier panel's reason: a tab group detaches the inactive one). */
async function openMarshalPanel(page) {
  await page.evaluate(() => {
    const p = crc.dock.dock.api.getPanel('marshal');
    if (p) crc.dock.dock.api.removePanel(p);
    crc.dock.dock.addPanel({ id: 'marshal', component: 'marshal', title: crc.dock.PANEL_TITLES.marshal, position: { referencePanel: 'efsp', direction: 'right' } });
    crc.dock.dock.api.getPanel('efsp').api.setActive();
  });
  await expect(page.locator('#marshal-panel')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#efsp-panel')).toBeVisible();
  return page.locator('#marshal-panel');
}
const rowOf = (panel, callsign) => panel.locator('tr.mb-row', { has: panel.page().locator('[data-cell="side"]', { hasText: callsign }) });

test('01 PriFly sets the Case in the carrier panel; every Position sees it change at once; the lanes only read', async ({ browser, baseURL }) => {
  const marshal = await controller(browser, baseURL, 'e2e-cv-marshal1', ['CV_MARSHAL']);
  const pri = await controller(browser, baseURL, 'e2e-cv-prifly1', ['CV_PRIFLY']);
  const lane = await controller(browser, baseURL, 'e2e-cv-lane1', ['CV_APP1', 'CV_APP2']);
  const priPanel = await openCarrierPanel(pri);
  const lanePanel = await openCarrierPanel(lane);
  const marshalPanel = await openCarrierPanel(marshal);
  await expect(priPanel.locator('[data-carrier-field="case"]')).toBeVisible();
  await expect(marshalPanel.locator('[data-carrier-field="case"]')).toBeVisible(); // the Marshal edits too (decisions H119)
  await expect(lanePanel.locator('[data-carrier-field="case"]')).toBeHidden();
  await expect(lanePanel.locator('[data-carrier-value="case"]')).toHaveText('III'); // the most restrictive until somebody says otherwise
  await expect(lanePanel.locator('[data-carrier-source="case"]')).toContainText('default');
  await priPanel.locator('[data-carrier-field="case"]').selectOption('II');
  await expect(marshal.locator('[data-carrier-case="value"]')).toHaveText('II');
  await expect(lanePanel.locator('[data-carrier-value="case"]')).toHaveText('II');
  await expect(lanePanel.locator('[data-carrier-source="case"]')).toContainText('set');
  await expect(marshal.locator('[data-carrier-banner="text"]')).toContainText('hull not found'); // no DCS in the harness: the banner says so rather than showing a stale number
  await marshal.screenshot({ path: test.info().outputPath('01-case-and-banner-marshal.png') });
  await pri.screenshot({ path: test.info().outputPath('01-carrier-panel-prifly.png') });
  await lane.screenshot({ path: test.info().outputPath('01-carrier-panel-lane-reads.png') });
  // "Use default" puts the Case back
  await priPanel.locator('[data-carrier-reset="case"]').click();
  await waitCase(marshal, 'III');
  await expect(lanePanel.locator('[data-carrier-source="case"]')).toContainText('default');
});

test('02 the MARSHAL panel lists the stack in landing order; a drag onto another holding row is one Move and everyone above moves up together', async ({ browser, baseURL }) => {
  const marshal = await controller(browser, baseURL, 'e2e-cv-marshal2', ['CV_MARSHAL']);
  const pri = await controller(browser, baseURL, 'e2e-cv-prifly2', ['CV_PRIFLY']);
  await setCase(pri, 'II');
  const a = cs('AAA'); const b = cs('BBB'); const c = cs('CCC');
  await checkIn(marshal, a); await checkIn(marshal, b); await checkIn(marshal, c);
  await openBay(marshal, 'CV_MARSHAL', 'cv-marshal-stack');
  const panel = await openMarshalPanel(marshal);
  await expect(panel.locator('tr.mb-hold')).toHaveCount(3);
  await expect(rowOf(panel, a).locator('[data-cell="ang"]')).toHaveText('6');
  await expect(rowOf(panel, c).locator('[data-cell="ang"]')).toHaveText('8');
  await expect(panel.locator('tr.mb-row').nth(0)).toContainText(a);
  // no control anywhere takes an angels, DME or push value for Case II
  await expect(strip(marshal, a).locator('.efsp-block-C7.efsp-block-editable')).toHaveCount(0);
  await expect(strip(marshal, a).locator('.efsp-block-C6.efsp-block-editable')).toHaveCount(0);
  await expect(strip(marshal, a).locator('.efsp-block-C8.efsp-block-editable')).toHaveCount(0);
  await marshal.screenshot({ path: test.info().outputPath('02-stack-board.png') });

  // one gesture: CCC's row dropped on AAA's
  const before = await marshal.evaluate(() => crc.carrier.carrierDerivedStack().map(e => e.flightDataId));
  await rowOf(panel, c).dragTo(rowOf(panel, a));
  await expect.poll(() => marshal.evaluate(() => crc.carrier.carrierDerivedStack().map(e => e.flightDataId))).not.toEqual(before);
  const after = await marshal.evaluate(() => crc.carrier.carrierDerivedStack().map(e => [crc.state.getEfspFlightData(e.flightDataId).identity.callsign, e.stackIndex, e.angels]));
  expect(after).toEqual([[c, 0, 6], [a, 1, 7], [b, 2, 8]]);
  await expect(strip(marshal, c).locator('.efsp-block-C7')).toHaveText('6');
  await expect(panel.locator('tr.mb-row').nth(0)).toContainText(c);
  await marshal.screenshot({ path: test.info().outputPath('02-after-resequence.png') });
  await cleanUp(marshal, pri);
  await setCase(pri, 'III');
});

test('03 Case II handoffs: Commence feeds a lane, See you hands to PriFly, Radar contact makes it FINAL with nothing to type, Ball and Trapped end it', async ({ browser, baseURL }) => {
  const marshal = await controller(browser, baseURL, 'e2e-cv-marshal3', ['CV_MARSHAL', 'CV_APP1', 'CV_APP2']);
  const pri = await controller(browser, baseURL, 'e2e-cv-prifly3', ['CV_PRIFLY']);
  await setCase(pri, 'II');
  const a = cs('DDD'); const b = cs('EEE');
  await checkIn(marshal, a); await checkIn(marshal, b);
  await openBay(marshal, 'CV_MARSHAL', 'cv-marshal-stack');

  // Commence: the NLA, labelled by its handoff, carrying its trigger type
  const commence = strip(marshal, a).locator('.efsp-nla-btn[data-carrier-handoff="MARSHAL_TO_APPROACH"]');
  await expect(commence).toHaveText('Commence');
  await expect(commence).toHaveAttribute('data-carrier-trigger', 'CONTROLLER_INITIATED');
  // and "See you" beside it: a second, distinct button with its own trigger type
  const seeYou = strip(marshal, b).locator('.efsp-nla-btn[data-carrier-handoff="MARSHAL_TO_PRIFLY"]');
  await expect(seeYou).toHaveText('See you');
  await expect(seeYou).toHaveAttribute('data-carrier-trigger', 'PILOT_SEE_YOU');
  await strip(marshal, a).scrollIntoViewIfNeeded();
  await marshal.screenshot({ path: test.info().outputPath('03-two-handoff-buttons.png') });
  await commence.click();
  await waitStrip(marshal, a, s => s.state === 'COMMENCED' && s.ownerPositionId === 'CV_APP1' && s.trigger === 'CONTROLLER_INITIATED', 'Commence');
  await expect.poll(() => marshal.evaluate(() => crc.carrier.carrierDerivedStack().map(e => [e.stackIndex, e.status]))).toEqual([[0, 'PUSHED'], [1, 'HOLDING']]);

  // See you: PRIFLY gets it as a PATTERN Strip, and the stack keeps a vacancy at 1
  await seeYou.click();
  await waitStrip(pri, b, s => s.stripType === 'PATTERN' && s.ownerPositionId === 'CV_PRIFLY' && s.trigger === 'PILOT_SEE_YOU', 'See you');
  await openBay(pri, 'CV_PRIFLY', 'cv-prifly-pattern');
  await expect(strip(pri, b)).toBeVisible();
  await pri.screenshot({ path: test.info().outputPath('03-prifly-pattern.png') });
  await expect.poll(() => marshal.evaluate(() => crc.carrier.carrierDerivedStack().map(e => e.stackIndex))).toEqual([0]);

  // Radar contact at the lane: same Strip, now FINAL
  await openBay(marshal, 'CV_APP1', 'cv-app1-lane');
  await strip(marshal, a).locator('.efsp-nla-btn[data-carrier-handoff="APPROACH_TO_FINAL"]').click();
  await waitStrip(marshal, a, s => s.stripType === 'FINAL' && s.state === 'ON_FINAL' && s.trigger === 'RADAR_ACQUISITION', 'Radar contact');
  await openBay(marshal, 'CV_APP1', 'cv-app1-final');
  const onFinal = strip(marshal, a);
  await expect(onFinal).toBeVisible();
  // the talk-down: nothing to type (WP7A bullet 6)
  await expect(onFinal.locator('.efsp-block-editable')).toHaveCount(0);
  await expect(onFinal.locator('input, select')).toHaveCount(0);
  await expect(onFinal.locator('.efsp-block-C16')).toBeVisible();
  await onFinal.scrollIntoViewIfNeeded();
  await marshal.screenshot({ path: test.info().outputPath('03-final-nothing-to-type.png') });
  await onFinal.locator('.efsp-nla-btn[data-carrier-handoff="FINAL_TO_LSO"]').click();
  await waitStrip(marshal, a, s => s.state === 'BALL' && s.trigger === 'PILOT_BALL_CALL', 'Ball');
  await expect(strip(marshal, a).locator('.efsp-nla-btn')).toHaveText('Trapped');
  // Ball and Trapped are two advancing presses: the client swallows a second one inside the 400 ms double-tap window (F-101), as it does for a person's double tap.
  await lapseNlaGuard(marshal);
  await strip(marshal, a).locator('.efsp-nla-btn').click();
  await expect.poll(() => stripOf(marshal, a)).toBeNull();
  await expect.poll(() => marshal.evaluate(() => crc.carrier.carrierDerivedStack().length)).toBe(0);

  await cleanUp(marshal, pri);
  await setCase(pri, 'III');
});

test('04 Case I is an altitude list: no push column, the flight goes to the pattern with its own button', async ({ browser, baseURL }) => {
  const marshal = await controller(browser, baseURL, 'e2e-cv-marshal4', ['CV_MARSHAL']);
  const pri = await controller(browser, baseURL, 'e2e-cv-prifly4', ['CV_PRIFLY']);
  const a = cs('FFF');
  await checkIn(marshal, a);
  await setCase(pri, 'I');
  await waitCase(marshal, 'I');
  await openBay(marshal, 'CV_MARSHAL', 'cv-marshal-stack');
  const panel = await openMarshalPanel(marshal);
  await expect(panel.locator('[data-marshal="case"]')).toHaveText('I');
  await expect(panel.locator('[data-marshal-action="commence"]')).toHaveCount(0); // Case I has no push time
  await expect(panel.locator('[data-marshal="picture"]')).toBeHidden(); // the Case III picture is for II and III
  await expect(panel.locator('tr.mb-hold')).toHaveCount(1);
  const angels = panel.locator('[data-marshal-input="angels"]').first();
  await expect(angels).toHaveValue(''); // no altitude until the squadron assigns one
  await angels.fill('3'); await angels.press('Enter');
  await expect(panel.locator('[data-marshal-input="angels"]').first()).toHaveValue('3');
  await marshal.screenshot({ path: test.info().outputPath('04-case-i-list.png') });
  const toPattern = strip(marshal, a).locator('.efsp-nla-btn[data-carrier-handoff="MARSHAL_TO_PATTERN_CASE_I"]');
  await expect(toPattern).toHaveText('To pattern');
  await expect(strip(marshal, a).locator('.efsp-nla-btn[data-carrier-handoff="MARSHAL_TO_PRIFLY"]')).toHaveCount(0);
  await toPattern.click();
  await waitStrip(pri, a, s => s.stripType === 'PATTERN' && s.ownerPositionId === 'CV_PRIFLY', 'Case I to pattern');
  await cleanUp(marshal, pri);
  await setCase(pri, 'III');
});

test('05 a refusal is visible: an approach lane cannot set the carrier state, and a frequency is not a button', async ({ browser, baseURL }) => {
  const lane = await controller(browser, baseURL, 'e2e-cv-lane5', ['CV_APP1']);
  const marshal = await controller(browser, baseURL, 'e2e-cv-marshal5', ['CV_MARSHAL']);
  const a = cs('GGG');
  await checkIn(marshal, a);
  // the server refuses a state op from a lane, and the panel says so
  await typeState(lane, 'case', 'I', 'CV_APP1');
  await expect(lane.locator('#efsp-mutation-error')).toContainText(/PERMISSION_DENIED|carrier state/i);
  expect(await lane.evaluate(() => crc.carrier.carrierCaseValue())).toBe('III');
  await openBay(marshal, 'CV_MARSHAL', 'cv-marshal-stack');
  await marshal.evaluate((c) => {
    const s = crc.state.getAllEfspStrips().find(x => crc.state.getEfspFlightData(x.flightDataId).identity.callsign === c);
    crc.ws.sendEfspMutation('CV_MARSHAL', s, { kind: 'SetBlock', blockId: 'C10', value: '251.000' });
  }, a);
  await expect(marshal.locator('#efsp-mutation-error')).toContainText(/frequency/i);
  await marshal.screenshot({ path: test.info().outputPath('05-refusals.png') });
  await cleanUp(marshal);
});

test('06 the carrier panel: typing over a value, where it comes from, "Use default", PriFly and the Marshal at once, the ramp time on the recovery board', async ({ browser, baseURL }) => {
  const marshal = await controller(browser, baseURL, 'e2e-cv-marshal6', ['CV_MARSHAL']);
  const pri = await controller(browser, baseURL, 'e2e-cv-prifly6', ['CV_PRIFLY']);
  const lane = await controller(browser, baseURL, 'e2e-cv-lane6', ['CV_APP2']);
  const mp = await openCarrierPanel(marshal);
  const pp = await openCarrierPanel(pri);
  const lp = await openCarrierPanel(lane);
  await setCase(pri, 'II');
  const a = cs('HHH'); const b = cs('JJJ');
  await checkIn(marshal, a); await checkIn(marshal, b);

  // nothing typed: the first fix is the default, the ramp time is not known, and no EAT is invented
  await expect(mp.locator('[data-carrier-field="firstFix"]')).toHaveValue('21');
  await expect(mp.locator('[data-carrier-source="firstFix"]')).toContainText('default');
  await expect(mp.locator('[data-carrier-source="rampTime"]')).toHaveText('not known');
  await expect(mp.locator('[data-carrier-reset="rampTime"]')).toBeHidden();
  await openBay(marshal, 'CV_MARSHAL', 'cv-marshal-stack');
  const board = await openMarshalPanel(marshal);
  const eatOf = (n) => board.locator(`tr.mb-hold[data-seq="${n}"] [data-part="eat"]`);
  const dmeOf = (i) => marshal.evaluate((k) => crc.carrier.carrierDerivedStack()[k].marshalDme, i);
  await expect(board.locator('[data-marshal="ramp"]')).toHaveText('—');
  await expect(eatOf(1)).toHaveText('--');
  await marshal.screenshot({ path: test.info().outputPath('06-before.png') });

  // The Marshal types the ramp time, PriFly the weather and the first fix, at the same moment
  const ramp = mp.locator('[data-carrier-field="rampTime"]');
  await ramp.fill('2040'); await ramp.press('Enter');
  const ceiling = pp.locator('[data-carrier-field="ceiling"]');
  await ceiling.fill('800'); await ceiling.press('Enter');
  const fix = pp.locator('[data-carrier-field="firstFix"]');
  await fix.fill('24'); await fix.press('Enter');
  for (const panel of [mp, pp, lp]) {
    await expect(panel.locator('[data-carrier-source="rampTime"]')).toContainText('set');
    await expect(panel.locator('[data-carrier-source="ceiling"]')).toContainText('set');
    await expect(panel.locator('[data-carrier-source="firstFix"]')).toHaveText('set · automatic 21');
  }
  await expect(lp.locator('[data-carrier-value="rampTime"]')).toHaveText('2040');
  await expect(lp.locator('[data-carrier-field="rampTime"]')).toBeHidden();
  await expect(lp.locator('[data-carrier-reset="firstFix"]')).toBeHidden(); // the lanes only read
  await expect(board.locator('[data-marshal="ramp"]')).toHaveText('2040Z');
  // the first fix moved every slot's DME, and an EAT now exists, worked back from the ramp time
  expect([await dmeOf(0), await dmeOf(1)]).toEqual([24, 25]);
  await expect(eatOf(1)).toHaveText(/^\d\d$/);
  expect(await eatOf(1).textContent()).toBe('34'); // 2040Z ramp less the 6 minutes from the fix to the ramp
  await marshal.screenshot({ path: test.info().outputPath('06-typed-marshal.png') });
  await lane.screenshot({ path: test.info().outputPath('06-typed-lane-reads.png') });

  // a magnetic bearing cannot be converted without a ship (the harness has none): refused, and nothing changes
  const brc = mp.locator('[data-carrier-field="brc"]');
  await brc.fill('100'); await brc.press('Enter');
  await expect(marshal.locator('#efsp-mutation-error')).toContainText(/magnetic variation/i);
  await expect(mp.locator('[data-carrier-source="brc"]')).toHaveText('not known');

  // "Use default" and an empty field both give the automatic value back
  await mp.locator('[data-carrier-reset="firstFix"]').click();
  await expect(mp.locator('[data-carrier-source="firstFix"]')).toContainText('default');
  await expect(mp.locator('[data-carrier-field="firstFix"]')).toHaveValue('21');
  expect(await dmeOf(0)).toBe(21);
  await ceiling.fill(''); await ceiling.press('Enter');
  await expect(pp.locator('[data-carrier-source="ceiling"]')).toHaveText('not known');
  await ramp.fill(''); await ramp.press('Enter');
  await expect(board.locator('[data-marshal="ramp"]')).toHaveText('—');
  await expect(eatOf(1)).toHaveText('--');

  // the tanker: a select and a number
  await pp.locator('[data-carrier-field="tankerOnStation"]').selectOption('true');
  await expect(lp.locator('[data-carrier-value="tankerOnStation"]')).toHaveText('yes');
  await pp.locator('[data-carrier-reset="tankerOnStation"]').click();
  await expect(lp.locator('[data-carrier-value="tankerOnStation"]')).toHaveText('no');
  await cleanUp(marshal, pri);
  await setCase(pri, 'III');
});
