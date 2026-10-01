'use strict';

/* L17 (crc-sync docs/adr/0074) — the carrier on screen, as a recovery is flown: PriFly sets the
 * Case and every Position sees it change, the Marshal stack's slot board shows the derived
 * angels/DME/push and re-sequences by one drag, the four hand-overs are four buttons, the
 * talk-down (FINAL) has nothing to type, and a Case I recovery is an altitude list.
 *
 * Two controllers, one browser context each: the Marshal seat (with both approach lanes) and
 * PriFly. Screenshots go to docs/wip/L17/. The Board lives for the whole run, so every test drops
 * what it made and puts the Case back to III, and callsigns are unique per test.
 */

const path = require('path');
const { test, expect } = require('./helpers/test');
const { openPanel } = require('./helpers/app');

const SHOTS = path.join(__dirname, '../../docs/wip/L17');
test.use({ viewport: { width: 1400, height: 1000 } });
test.setTimeout(60000);

let seq = 0;
const cs = (prefix) => `${prefix}${(Date.now() + seq++) % 10000}`;
const _contexts = [];
test.afterEach(async () => { while (_contexts.length) await _contexts.pop().close().catch(() => {}); });

async function controller(browser, baseURL, name, held) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1400, height: 1000 } });
  _contexts.push(context);
  const page = await context.newPage();
  await openPanel(page, { held, facilityId: 'CARRIER', controller: name });
  await page.waitForFunction(() => typeof getEfspCarrier === 'function' && !!getEfspCarrier());
  return page;
}

const strip = (page, callsign) => page.locator('.efsp-strip', { has: page.locator('.efsp-block-C1', { hasText: callsign }) }).first();
const stripOf = (page, callsign) => page.evaluate((c) => {
  const s = getAllEfspStrips().find(x => x.state !== 'DROPPED' && (getEfspFdr(x.fdrId) || { identity: {} }).identity.callsign === c);
  return s ? { stripId: s.stripId, fdrId: s.fdrId, role: s.role, state: s.state, ownerPositionId: s.ownerPositionId, bayId: s.bayId, trigger: s.carrierTransfer && s.carrierTransfer.trigger } : null;
}, callsign);
const waitStrip = (page, callsign, pred, what) => expect.poll(async () => { const s = await stripOf(page, callsign); return !!s && pred(s); }, { message: what, timeout: 10000 }).toBe(true);
const waitCase = (page, value) => expect.poll(() => page.evaluate(() => carrierCaseValue()), { timeout: 10000 }).toBe(value);

async function checkIn(page, callsign) {
  await page.evaluate((c) => window.sendEfspCreateStrip('CV_MARSHAL', {
    kind: 'CreateStrip', bayId: 'cv-marshal-stack', rackId: 'main', role: 'MARSHAL', fdr: { callsign: c, aircraftType: 'F-18C' },
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
      const held = getActingPositions('CARRIER');
      for (const s of getAllEfspStrips()) {
        if (s.state !== 'DROPPED' && s.facilityId === 'CARRIER' && held.includes(s.ownerPositionId)) {
          sendEfspMutation(s.ownerPositionId, s, { kind: 'DropStrip', reason: 'e2e cleanup' });
        }
      }
    });
  }
  await expect.poll(() => pages[0].evaluate(() => getAllEfspStrips().filter(s => s.state !== 'DROPPED' && s.facilityId === 'CARRIER').length)).toBe(0);
}
async function setCase(pri, value) {
  if (await pri.evaluate(() => carrierCaseValue()) === value) return;
  await pri.locator('.carrier-case-select').selectOption(value);
  await waitCase(pri, value);
}

test('01 PriFly sets the Case; every Position sees it change at once, and only PriFly has the selector', async ({ browser, baseURL }) => {
  const marshal = await controller(browser, baseURL, 'e2e-cv-marshal1', ['CV_MARSHAL', 'CV_APP1', 'CV_APP2']);
  const pri = await controller(browser, baseURL, 'e2e-cv-prifly1', ['CV_PRIFLY']);
  await expect(pri.locator('.carrier-case-select')).toBeVisible();
  await expect(marshal.locator('.carrier-case-select')).toHaveCount(0);
  await expect(marshal.locator('[data-carrier-case="value"]')).toHaveText('III'); // the most restrictive until PriFly says otherwise
  await pri.locator('.carrier-case-select').selectOption('II');
  await expect(marshal.locator('[data-carrier-case="value"]')).toHaveText('II');
  await expect(marshal.locator('[data-carrier-banner="text"]')).toContainText('hull not found'); // no DCS in the harness: the banner says so rather than showing a stale number
  await marshal.screenshot({ path: path.join(SHOTS, '01-case-and-banner-marshal.png') });
  await pri.screenshot({ path: path.join(SHOTS, '01-case-selector-prifly.png') });
  await setCase(pri, 'III');
});

test('02 the slot board shows what the slot means; a drag to a slot is one Move and everyone above moves up together', async ({ browser, baseURL }) => {
  const marshal = await controller(browser, baseURL, 'e2e-cv-marshal2', ['CV_MARSHAL']);
  const pri = await controller(browser, baseURL, 'e2e-cv-prifly2', ['CV_PRIFLY']);
  await setCase(pri, 'II');
  const a = cs('AAA'); const b = cs('BBB'); const c = cs('CCC');
  await checkIn(marshal, a); await checkIn(marshal, b); await checkIn(marshal, c);
  await openBay(marshal, 'CV_MARSHAL', 'cv-marshal-stack');
  const board = marshal.locator('.carrier-stack-board');
  await expect(board).toBeVisible();
  await expect(board.locator('.carrier-slot-occupied')).toHaveCount(3);
  await expect(board.locator('.carrier-slot[data-slot-index="0"]')).toContainText('A6');
  await expect(board.locator('.carrier-slot[data-slot-index="0"]')).toContainText('21 DME');
  await expect(board.locator('.carrier-slot[data-slot-index="2"]')).toContainText('A8');
  // no control anywhere takes an angels, DME or push value for Case II
  await expect(strip(marshal, a).locator('.efsp-block-C7.efsp-block-editable')).toHaveCount(0);
  await expect(strip(marshal, a).locator('.efsp-block-C6.efsp-block-editable')).toHaveCount(0);
  await expect(strip(marshal, a).locator('.efsp-block-C8.efsp-block-editable')).toHaveCount(0);
  await marshal.screenshot({ path: path.join(SHOTS, '02-stack-board.png') });

  // low state: drag CCC's row onto slot 0, one gesture
  const before = await marshal.evaluate(() => carrierDerivedStack().map(e => e.fdrId));
  const src = board.locator('.carrier-slot[data-slot-index="2"]');
  const target = board.locator('.carrier-slot[data-slot-index="0"]');
  const s = await src.boundingBox(); const t = await target.boundingBox();
  await marshal.mouse.move(s.x + 30, s.y + s.height / 2);
  await marshal.mouse.down();
  await marshal.mouse.move(s.x + 32, s.y + s.height / 2 - 8, { steps: 4 });
  await marshal.mouse.move(t.x + 30, t.y + t.height / 2, { steps: 10 });
  await expect(target).toHaveClass(/efsp-drop-target/);
  await marshal.screenshot({ path: path.join(SHOTS, '02-drag-to-slot-preview.png') });
  await marshal.mouse.up();
  await expect.poll(() => marshal.evaluate(() => carrierDerivedStack().map(e => e.fdrId))).not.toEqual(before);
  const after = await marshal.evaluate(() => carrierDerivedStack().map(e => [getEfspFdr(e.fdrId).identity.callsign, e.stackIndex, e.angels]));
  expect(after).toEqual([[c, 0, 6], [a, 1, 7], [b, 2, 8]]);
  await expect(strip(marshal, c).locator('.efsp-block-C7')).toHaveText('6');
  await marshal.screenshot({ path: path.join(SHOTS, '02-after-resequence.png') });
  await cleanUp(marshal, pri);
  await setCase(pri, 'III');
});

test('03 Case II hand-overs: Commence feeds a lane, See you hands to PriFly, Radar contact makes it FINAL with nothing to type, Ball and Trapped end it', async ({ browser, baseURL }) => {
  const marshal = await controller(browser, baseURL, 'e2e-cv-marshal3', ['CV_MARSHAL', 'CV_APP1', 'CV_APP2']);
  const pri = await controller(browser, baseURL, 'e2e-cv-prifly3', ['CV_PRIFLY']);
  await setCase(pri, 'II');
  const a = cs('DDD'); const b = cs('EEE');
  await checkIn(marshal, a); await checkIn(marshal, b);
  await openBay(marshal, 'CV_MARSHAL', 'cv-marshal-stack');

  // Commence: the NLA, labelled by its hand-over, carrying its trigger type
  const commence = strip(marshal, a).locator('.efsp-nla-btn[data-carrier-transfer="MARSHAL_TO_APPROACH"]');
  await expect(commence).toHaveText('Commence');
  await expect(commence).toHaveAttribute('data-carrier-trigger', 'CONTROLLER_INITIATED');
  // and "See you" beside it: a second, distinct button with its own trigger type
  const seeYou = strip(marshal, b).locator('.efsp-nla-btn[data-carrier-transfer="MARSHAL_TO_PRIFLY"]');
  await expect(seeYou).toHaveText('See you');
  await expect(seeYou).toHaveAttribute('data-carrier-trigger', 'PILOT_SEE_YOU');
  await strip(marshal, a).scrollIntoViewIfNeeded();
  await marshal.screenshot({ path: path.join(SHOTS, '03-two-handover-buttons.png') });
  await commence.click();
  await waitStrip(marshal, a, s => s.state === 'COMMENCED' && s.ownerPositionId === 'CV_APP1' && s.trigger === 'CONTROLLER_INITIATED', 'Commence');
  await expect.poll(() => marshal.evaluate(() => carrierDerivedStack().map(e => [e.stackIndex, e.status]))).toEqual([[0, 'PUSHED'], [1, 'HOLDING']]);

  // See you: PRIFLY gets it as a PATTERN Strip, and the stack keeps a vacancy at 1
  await seeYou.click();
  await waitStrip(pri, b, s => s.role === 'PATTERN' && s.ownerPositionId === 'CV_PRIFLY' && s.trigger === 'PILOT_SEE_YOU', 'See you');
  await openBay(pri, 'CV_PRIFLY', 'cv-prifly-pattern');
  await expect(strip(pri, b)).toBeVisible();
  await pri.screenshot({ path: path.join(SHOTS, '03-prifly-pattern.png') });
  await expect.poll(() => marshal.evaluate(() => carrierDerivedStack().map(e => e.stackIndex))).toEqual([0]);

  // Radar contact at the lane: same Strip, now FINAL
  await openBay(marshal, 'CV_APP1', 'cv-app1-lane');
  await strip(marshal, a).locator('.efsp-nla-btn[data-carrier-transfer="APPROACH_TO_FINAL"]').click();
  await waitStrip(marshal, a, s => s.role === 'FINAL' && s.state === 'ON_FINAL' && s.trigger === 'RADAR_ACQUISITION', 'Radar contact');
  await openBay(marshal, 'CV_APP1', 'cv-app1-final');
  const onFinal = strip(marshal, a);
  await expect(onFinal).toBeVisible();
  // the talk-down: nothing to type (WP7A bullet 6)
  await expect(onFinal.locator('.efsp-block-editable')).toHaveCount(0);
  await expect(onFinal.locator('input, select')).toHaveCount(0);
  await expect(onFinal.locator('.efsp-block-C16')).toBeVisible();
  await onFinal.scrollIntoViewIfNeeded();
  await marshal.screenshot({ path: path.join(SHOTS, '03-final-nothing-to-type.png') });
  await onFinal.locator('.efsp-nla-btn[data-carrier-transfer="FINAL_TO_LSO"]').click();
  await waitStrip(marshal, a, s => s.state === 'BALL' && s.trigger === 'PILOT_BALL_CALL', 'Ball');
  await expect(strip(marshal, a).locator('.efsp-nla-btn')).toHaveText('Trapped');
  await strip(marshal, a).locator('.efsp-nla-btn').click();
  await expect.poll(() => stripOf(marshal, a)).toBeNull();
  await expect.poll(() => marshal.evaluate(() => carrierDerivedStack().length)).toBe(0);

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
  const board = marshal.locator('.carrier-stack-board');
  await expect(board.locator('.carrier-stack-title')).toContainText('altitude list');
  await expect(board.locator('.carrier-slot-push')).toHaveCount(0);
  await expect(board.locator('.carrier-slot-dme')).toHaveCount(0);
  await expect(board.locator('.carrier-slot-occupied')).toHaveCount(1);
  await expect(board.locator('.carrier-slot-occupied')).toContainText('assign'); // no altitude until the squadron assigns one
  const angels = board.locator('.carrier-slot-angels-input').first();
  await angels.fill('3'); await angels.press('Enter');
  await expect(board.locator('.carrier-slot-occupied')).toContainText('A3');
  await marshal.screenshot({ path: path.join(SHOTS, '04-case-i-list.png') });
  const toPattern = strip(marshal, a).locator('.efsp-nla-btn[data-carrier-transfer="MARSHAL_TO_PATTERN_CASE_I"]');
  await expect(toPattern).toHaveText('To pattern');
  await expect(strip(marshal, a).locator('.efsp-nla-btn[data-carrier-transfer="MARSHAL_TO_PRIFLY"]')).toHaveCount(0);
  await toPattern.click();
  await waitStrip(pri, a, s => s.role === 'PATTERN' && s.ownerPositionId === 'CV_PRIFLY', 'Case I to pattern');
  await cleanUp(marshal, pri);
  await setCase(pri, 'III');
});

test('05 a refusal is visible: a Marshal cannot set the Case, and a frequency is not a button', async ({ browser, baseURL }) => {
  const marshal = await controller(browser, baseURL, 'e2e-cv-marshal5', ['CV_MARSHAL']);
  const a = cs('GGG');
  await checkIn(marshal, a);
  // the server refuses a Case op from the Marshal, and the panel says so
  await marshal.evaluate(() => sendEfspCarrierMutation('CV_MARSHAL', undefined, undefined, { kind: 'SetCase', to: 'I' }));
  await expect(marshal.locator('#efsp-mutation-error')).toContainText(/PERMISSION_DENIED|Case/i);
  await openBay(marshal, 'CV_MARSHAL', 'cv-marshal-stack');
  await marshal.evaluate((c) => {
    const s = getAllEfspStrips().find(x => getEfspFdr(x.fdrId).identity.callsign === c);
    sendEfspMutation('CV_MARSHAL', s, { kind: 'SetBlock', blockId: 'C10', value: '251.000' });
  }, a);
  await expect(marshal.locator('#efsp-mutation-error')).toContainText(/frequency/i);
  await marshal.screenshot({ path: path.join(SHOTS, '05-refusals.png') });
  await cleanUp(marshal);
});
