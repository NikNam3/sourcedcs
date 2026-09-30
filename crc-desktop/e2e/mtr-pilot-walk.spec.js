'use strict';

/* L2 — the hand-walked pilot request, "VIPER11 request a different exit fix",
 * as two controllers in two browsers against the one crc-sync (guide §9.4,
 * crc-sync's docs/adr/0062). Written up step by step in docs/wip/L2.md.
 *
 * A walk records what a controller SEES, so most checks here are soft: the
 * point is the notes and screenshots, and one surprise should not hide the
 * rest of the walk. The things the design promises are hard assertions.
 */

const path = require('path');
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { openPanel, seedStrip, startAction } = require('./helpers/app');

test.describe.configure({ timeout: 120000 });

const SHOTS = path.join(__dirname, '..', '..', 'docs', 'wip', 'L2');
const notes = [];
const note = (step, text) => notes.push(`${step}: ${text}`);
test.afterAll(() => fs.writeFileSync(path.join(SHOTS, 'walk-notes.txt'), notes.join('\n') + '\n'));

const _contexts = [];
test.afterEach(async () => { while (_contexts.length) await _contexts.pop().close().catch(() => {}); });
async function controller(browser, opts) {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1600, height: 1200 } });
  _contexts.push(ctx);
  const page = await ctx.newPage();
  await openPanel(page, opts);
  return page;
}
async function goBay(page, positionId, bayId) {
  await page.locator(`#efsp-position-tabs .efsp-position-tab[data-position-id="${positionId}"]`).click();
  await page.locator(`#efsp-bay-tabs .efsp-bay-tab[data-bay-id="${bayId}"]`).click();
}
const stripOf = (page, callsign) => page.locator('.efsp-strip', { has: page.getByText(callsign, { exact: true }) }).first();
async function edit(scope, blockId, text) {
  await scope.locator(`.efsp-block-${blockId}`).first().click();
  const input = scope.locator('input.efsp-block-input');
  await expect(input).toBeFocused();
  await input.fill(text);
  await input.press('Enter');
}
const mtrOf = (page, callsign) => page.evaluate((cs) => {
  const s = [...efspStrips.values()].find(x => (efspFdrs.get(x.fdrId) || {}).identity?.callsign === cs);
  return s ? efspFdrs.get(s.fdrId).military.mtr : null;
}, callsign);
const faceIds = (strip) => strip.locator('.efsp-strip-fields [data-block]').evaluateAll((els) => els.map((e) => e.dataset.block));
async function only(page, callsign) {
  await page.evaluate((cs) => {
    for (const s of document.querySelectorAll('.efsp-strip')) s.style.display = s.textContent.includes(cs) ? '' : 'none';
  }, callsign);
}

test('pilot walk: "VIPER11 request a different exit fix", CTR and APP at once', async ({ browser }) => {
  const ctr = await controller(browser, { held: ['CTR'], facilityId: 'CENTER', controller: 'ctr-walk' });
  const app = await controller(browser, { held: ['APP'], facilityId: 'INCIRLIK', controller: 'app-walk' });
  const CS = 'VIPER11';

  // An inbound at Center, coordinated to APP so both Facilities hold a Strip.
  await goBay(ctr, 'CTR', 'ctr-enroute');
  const c = await seedStrip(ctr, { callsign: CS, actingPositionId: 'CTR', bayId: 'ctr-enroute', role: 'ARRIVAL', facilityId: 'CENTER',
    fdr: { originAirport: 'LCRA', destinationAirport: 'LTAG', route: 'DCT' } });
  await startAction(c, 'Coordinate…');
  const pop = ctr.locator('.efsp-coordinate-popover');
  await pop.locator('select').selectOption('HANDOFF');
  await pop.getByRole('button', { name: 'Send' }).dispatchEvent('click');
  await goBay(app, 'APP', 'app-coordination');
  const a = stripOf(app, CS);
  await expect(a).toBeVisible();

  // ── 1. "VIPER11, IR107, exit F at 32, request FL190." — CTR posts. ─────────
  await c.locator('.efsp-expand-btn').click();
  await edit(c.locator('[data-expanded-block="9G-MTR"]'), '9G-MTR', 'IR107');
  await c.locator('.efsp-expand-btn').click();
  await edit(c, '9H-EXIT', 'F');
  await edit(c, '9H-TIME', '1432');
  await edit(c, '9H-ALT', 'FL190');
  await expect(a.locator('.efsp-strip-fields .efsp-block-9H-EXIT')).toHaveText('F', { timeout: 3000 });
  await expect(a.locator('.efsp-strip-fields .efsp-block-9H-TIME')).toHaveText('1432');
  note('1', `CTR posted IR107/F/1432/FL190; APP's replica showed them without a reload. APP face: ${(await faceIds(a)).join(' ')}`);
  await only(app, CS);
  await a.screenshot({ path: path.join(SHOTS, 'walk-1-app-replica.png') });

  // APP takes the flight.
  const accept = a.getByRole('button', { name: 'Accept Hand Off' });
  await accept.click({ timeout: 3000 });
  await expect.poll(async () => (await app.evaluate((cs) => [...efspStrips.values()].filter(s => efspFdrs.get(s.fdrId)?.identity?.callsign === cs && s.facilityId === 'INCIRLIK').map(s => s.coordination && s.coordination.state), CS))[0]).toBe('ACTIVE');
  const bayNow = await app.evaluate((cs) => [...efspStrips.values()].find(s => efspFdrs.get(s.fdrId)?.identity?.callsign === cs && s.facilityId === 'INCIRLIK').bayId, CS);
  if (bayNow !== 'app-coordination') await goBay(app, 'APP', bayNow);
  const mine = stripOf(app, CS);
  note('1b', `APP accepted; its Strip is in ${bayNow}`);

  // ── 2. "request exit at E instead, estimating 40, request FL210." ─────────
  const before = await mtrOf(app, CS);
  await edit(mine, '9H-EXIT', 'E');
  await edit(mine, '9H-TIME', '1440');
  await edit(mine, '9H-ALT', 'FL210');
  await expect(mine.locator('.efsp-block-9H-EXIT')).toHaveText('E');
  const after = await mtrOf(app, CS);
  const struck = await mine.locator('.efsp-strip-fields .efsp-annotation-entry').count();
  note('2', `APP overwrote F/1432/FL190 -> ${after.exitFix}/${new Date(after.exitEstimateUtc).toISOString().slice(11, 16)}/${after.requestedAltitudeAfterExit}. `
    + `Struck history entries on the face: ${struck} (expected 0 — §3.7 gap, H25). Old exit fix anywhere on the FDR: ${JSON.stringify(after).includes('"F"')}`);
  expect(before.exitFix).toBe('F');
  expect(after.exitFix).toBe('E');
  await expect(c.locator('.efsp-strip-fields .efsp-block-9H-EXIT')).toHaveText('E', { timeout: 3000 });
  note('2b', 'CTR\'s Strip showed E within the poll; nothing on either Strip says it was amended');
  await only(app, CS);
  await mine.screenshot({ path: path.join(SHOTS, 'walk-2-amended.png') });

  // ── 3. "…approved FL210": the controller writes ALT. The advisory follows. ──
  await edit(mine, '7', 'FL210');
  await mine.locator('.efsp-expand-btn').click();
  const adv = mine.locator('.efsp-mtr-lostcomms');
  await expect(adv).toContainText('FL210');
  note('3', `APP wrote ALT FL210; ▼ advisory reads: "${(await adv.textContent()).trim()}"`);
  await mine.screenshot({ path: path.join(SHOTS, 'walk-3-approved.png') });
  await mine.locator('.efsp-expand-btn').click();

  // ── 4. "cancel IR107, direct home." ───────────────────────────────────────
  await edit(mine, '9G-MTR', '');
  await expect(mine.locator('.efsp-strip-fields .efsp-block-9H-EXIT')).toHaveText('E');
  note('4', `MTR cleared; exit fields stayed on the face: ${(await faceIds(mine)).filter(id => /^9[GH]/.test(id)).join(' ')}`);
  await mine.screenshot({ path: path.join(SHOTS, 'walk-4-cancelled.png') });
  for (const id of ['9H-EXIT', '9H-TIME', '9H-ALT']) await edit(mine, id, '');
  await expect(mine.locator('.efsp-strip-fields .efsp-block-9G-MTR')).toHaveCount(0);
  note('4b', 'after clearing all, the MTR row went');

  // ── 5. "request IR109 instead" — designator only; the old exit is stale. ──
  await mine.locator('.efsp-expand-btn').click();
  await edit(mine.locator('[data-expanded-block="9H-EXIT"]'), '9H-EXIT', 'E');
  await mine.locator('.efsp-expand-btn').click();
  await edit(mine, '9G-MTR', 'IR109');
  const warn = await mine.locator('.efsp-strip-reason, .efsp-ind').allTextContents();
  note('5', `IR109 posted over an exit fix E that belonged to IR107; warnings/indicators on the Strip: ${JSON.stringify(warn)}`);

  // ── 6. A typo'd time. ────────────────────────────────────────────────────
  await edit(mine, '9H-TIME', '1472');
  await expect(app.locator('#efsp-mutation-error')).toContainText('HHMM');
  await expect(mine.locator('.efsp-strip-fields .efsp-block-refused')).toHaveCount(1);
  note('6', `1472 refused: "${(await app.locator('#efsp-mutation-error').textContent()).trim()}"; cell marked refused`);
  await only(app, CS);
  await app.locator('#efsp-panel').screenshot({ path: path.join(SHOTS, 'walk-6-typo.png') });
  await app.keyboard.press('Escape');

  // ── 7. On APP's ARRIVAL: the M11 group, no entry on the face. ─────────────
  const ids = await faceIds(mine);
  note('7', `APP ARRIVAL face MTR group: ${ids.filter(id => /^9[GH]/.test(id)).join(' ')}`);
  expect(ids.includes('9G-ENTRY')).toBe(false);

  // ── 8. CTR edits EXIT EST while APP is typing in EXIT. ────────────────────
  await mine.locator('.efsp-strip-fields .efsp-block-9H-EXIT').click();
  const input = mine.locator('input.efsp-block-input');
  await input.fill('D');
  const ctrWrite = await ctr.evaluate((cs) => {
    const s = [...efspStrips.values()].find(x => efspFdrs.get(x.fdrId)?.identity?.callsign === cs && x.facilityId === 'CENTER');
    window.sendEfspMutation('CTR', s, { kind: 'SetBlock', blockId: '9H-TIME', value: '1445' }, 'CENTER');
    return s.ownerPositionId;
  }, CS);
  await app.waitForTimeout(800);
  const stillOpen = await input.count();
  const draft = stillOpen ? await input.inputValue() : null;
  const ctrErr = (await ctr.locator('#efsp-mutation-error').textContent().catch(() => '') || '').trim();
  const est = await mine.locator('.efsp-block-9H-TIME').textContent().catch(() => null);
  note('8', `CTR (its Strip owned by ${ctrWrite}) sent EXIT EST 1445 while APP typed "D" in EXIT: APP input still open=${!!stillOpen}, draft=${JSON.stringify(draft)}; APP's EXIT EST now ${JSON.stringify(est)}; CTR refusal: ${JSON.stringify(ctrErr)}`);
  const fdrEst = (await mtrOf(app, CS)).exitEstimateUtc;
  note('8b', `APP's copy of the FDR has exitEstimateUtc=${fdrEst ? new Date(fdrEst).toISOString().slice(11, 16) : fdrEst} while the edit is open`);
  if (stillOpen) await input.press('Enter');
  await app.waitForTimeout(800);
  note('8c', `after APP pressed Enter: EXIT=${JSON.stringify(await mine.locator('.efsp-block-9H-EXIT').textContent())}, EXIT EST=${JSON.stringify(await mine.locator('.efsp-block-9H-TIME').textContent())}`);
});
