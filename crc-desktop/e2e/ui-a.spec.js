'use strict';

/* UI-A follow-up (docs/wip/UI-A.md): the human-reported U1-U8, S-L15 and S-L16 items on screen.
 * Every Strip a test seeds is dropped at its end (the Board lives for the whole run). */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, stripByCallsign, startAction, dropStrips } = require('./helpers/app');

test.describe.configure({ timeout: 60000 });
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

test('U1 + U4: OPS has ORDNANCE on its face and can set HUNG; TYPE is editable', async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  const callsign = cs('UIA');
  const strip = await seedStrip(page, { callsign });
  try {
    const ord = strip.locator('.efsp-strip-fields .efsp-block-3G').first();
    await expect(ord, 'ORDNANCE is on OPS\'s face').toBeVisible();
    await ord.click();
    await strip.locator('select.efsp-block-enum-select').selectOption('HUNG');
    await expect(stripByCallsign(page, callsign).locator('.efsp-strip-fields .efsp-block-3G')).toHaveText('HUNG');

    // U4: TYPE shows count/wake/type; clicking edits the aircraft type.
    const type = stripByCallsign(page, callsign).locator('.efsp-strip-fields .efsp-block-3').first();
    await expect(type).toContainText('F16');
    await type.click();
    const input = stripByCallsign(page, callsign).locator('input.efsp-block-input');
    await expect(input, 'the editor opens on the bare aircraft type').toHaveValue('F16');
    await input.fill('F15E');
    await input.press('Enter');
    await expect(stripByCallsign(page, callsign).locator('.efsp-strip-fields .efsp-block-3').first()).toContainText('F15E');
  } finally {
    await dropStrips(page, [callsign]);
  }
});

test('S-L15: Alt+click offsets a Strip and Ctrl+click steps its highlight, one input each', async ({ page }) => {
  await openPanel(page, { held: ['OPS'] });
  const callsign = cs('GST');
  const strip = await seedStrip(page, { callsign });
  try {
    const fields = () => stripByCallsign(page, callsign).locator('.efsp-strip-tab-role'); // an inert part of the Strip
    await fields().click({ modifiers: ['Alt'] });
    await expect(stripByCallsign(page, callsign)).toHaveClass(/efsp-strip-offset/);
    await fields().click({ modifiers: ['Alt'] });
    await expect(stripByCallsign(page, callsign)).not.toHaveClass(/efsp-strip-offset/);
    const colour = () => stripByCallsign(page, callsign).evaluate(el => el.style.getPropertyValue('--efsp-highlight'));
    for (const want of ['yellow', 'cyan', 'lime', '']) {
      await fields().click({ modifiers: ['Control'] });
      await expect.poll(colour).toBe(want);
    }
  } finally {
    await dropStrips(page, [callsign]);
  }
});

test('S-L16 W5: retyping a shown estimate accepts it as the actual', async ({ page }) => {
  await openPanel(page, { held: ['OPS', 'GND'] });
  const callsign = cs('EST');
  const strip = await seedStrip(page, { callsign, fdr: { proposedDepartureTimeUtc: '1450' } });
  try {
    // P-time 1450 gives TAXI an estimate; the expanded view carries TAXI.
    await strip.locator('.efsp-expand-btn').click();
    const taxi = stripByCallsign(page, callsign).locator('[data-expanded-block="17"] .efsp-block').first();
    await expect(taxi).toHaveClass(/efsp-block-estimated/);
    await taxi.click();
    const input = stripByCallsign(page, callsign).locator('input.efsp-block-input');
    const shown = await input.inputValue();
    await input.press('Enter'); // the same value, unchanged: accepts the estimate
    await expect(stripByCallsign(page, callsign).locator('[data-expanded-block="17"] .efsp-block').first()).not.toHaveClass(/efsp-block-estimated/);
    await expect(stripByCallsign(page, callsign).locator('[data-expanded-block="17"] .efsp-block').first()).toHaveText(shown);
  } finally {
    await dropStrips(page, [callsign]);
  }
});

test('U2: a HANDOFF proposal to CTR announces a new Strip at CTR, even to one controller holding APP and CTR', async ({ browser }) => {
  const page = await controller(browser, { held: ['APP'], facilityId: 'INCIRLIK', controller: 'uia-combo' });
  await page.evaluate(() => window.sendEfspSetPositions('CENTER', ['CTR']));
  await page.waitForFunction(() => window.getActingPositions('CENTER').includes('CTR'));
  const callsign = cs('HND');
  const s = await seedStrip(page, { callsign, actingPositionId: 'APP', bayId: 'app-inbound', role: 'ARRIVAL' });
  try {
    await startAction(s, 'Coordinate…');
    const popover = page.locator('.efsp-coordinate-popover');
    await popover.locator('select').selectOption('HANDOFF');
    await popover.getByRole('button', { name: 'Send' }).dispatchEvent('click');
    const ctrTab = page.locator('.efsp-position-tab[data-position-id="CTR"]');
    await expect(ctrTab.locator('.efsp-tab-new-dot, .efsp-tab-new'), 'CTR\'s tab says a Strip arrived').toBeVisible({ timeout: 10000 });
    await ctrTab.click();
    await page.locator('#efsp-bay-tabs .efsp-bay-tab.efsp-tab-has-arrival').click();
    await expect(page.locator('.efsp-strip', { hasText: callsign }).first().locator('.efsp-strip-from')).toContainText('from APP');
  } finally {
    await dropStrips(page, [callsign]);
  }
});

test('U8: TOFI Exit becomes CTR\'s primary action once the mission line goes OFF_STATION', async ({ browser }) => {
  const ctr = await controller(browser, { held: ['CTR'], facilityId: 'CENTER', controller: 'uia-ctr' });
  const tac = await controller(browser, { held: ['TAC_C2'], facilityId: 'TACTICAL', controller: 'uia-tac' });
  const callsign = cs('EXT');
  const act = (page, pos, role, op) => page.evaluate(([p, c, r, o]) => {
    const s = getAllEfspStrips().find(x => x.state !== 'DROPPED' && x.role === r && getEfspFdr(x.fdrId).identity.callsign === c);
    window.sendEfspMutation(p, getEfspStrip(s.stripId), o);
  }, [pos, callsign, role, op]);
  const state = (page, role) => page.evaluate(([c, r]) => {
    const s = getAllEfspStrips().find(x => x.state !== 'DROPPED' && x.role === r && getEfspFdr(x.fdrId).identity.callsign === c);
    return s ? s.state : null;
  }, [callsign, role]);
  try {
    await ctr.evaluate((c) => window.sendEfspCreateStrip('CTR', { kind: 'CreateStrip', bayId: 'ctr-overflight', rackId: 'main', role: 'OVERFLIGHT', fdr: { callsign: c } }, 'CENTER'), callsign);
    await expect.poll(() => state(ctr, 'OVERFLIGHT')).toBe('TRANSITING');
    await act(ctr, 'CTR', 'OVERFLIGHT', { kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2' });
    await expect.poll(() => state(tac, 'MISSION')).not.toBeNull();
    await act(tac, 'TAC_C2', 'MISSION', { kind: 'TOFI', action: 'ACCEPT', separationRegime: 'ATC' });
    for (const to of ['AIRBORNE', 'ON_STATION']) {
      await act(tac, 'TAC_C2', 'MISSION', { kind: 'SetState', toState: to });
      await expect.poll(() => state(tac, 'MISSION')).toBe(to);
    }
    const ctrStrip = ctr.locator('.efsp-strip', { hasText: callsign }).first();
    await ctr.locator('#efsp-bay-tabs .efsp-bay-tab', { hasText: 'overflight' }).first().click().catch(() => {});
    await expect(ctrStrip).toBeVisible();
    await expect(ctrStrip.locator('[data-strip-action="tofi-exit-primary"]'), 'not while the line is ON_STATION').toHaveCount(0);
    await act(tac, 'TAC_C2', 'MISSION', { kind: 'SetState', toState: 'OFF_STATION' });
    await expect.poll(() => state(ctr, 'MISSION')).toBe('OFF_STATION');
    const exit = ctrStrip.locator('[data-strip-action="tofi-exit-primary"]');
    await expect(exit, 'TOFI Exit is CTR\'s primary action').toBeVisible();
    await expect(exit).toHaveText('TOFI Exit');
    await exit.click();
    await expect.poll(() => ctr.evaluate((c) => {
      const s = getAllEfspStrips().find(x => x.role === 'OVERFLIGHT' && x.state !== 'DROPPED' && getEfspFdr(x.fdrId).identity.callsign === c);
      return s && s.tofiCoordination && s.tofiCoordination.direction + ':' + s.tofiCoordination.state;
    }, callsign)).toBe('EXIT:PROPOSED');
  } finally {
    await dropStrips(ctr, [callsign]);
    await dropStrips(tac, [callsign]);
  }
});

test('S-L23 finding: a TAC_C2-only controller sees the line AIC holds, and a JTAC-only one sees no other Position\'s tab', async ({ browser }) => {
  const tac = await controller(browser, { held: ['TAC_C2'], facilityId: 'TACTICAL', controller: 'uia-tac2' });
  const jtac = await controller(browser, { held: ['JTAC'], facilityId: 'TACTICAL', controller: 'uia-jtac2' });
  await controller(browser, { held: ['AIC'], facilityId: 'TACTICAL', controller: 'uia-aic2' }); // a manned AIC, or the transfer has no receiver
  const callsign = cs('WTH');
  try {
    await tac.evaluate((c) => window.sendEfspCreateStrip('TAC_C2', { kind: 'CreateStrip', bayId: 'tac-c2-tasked', rackId: 'main', role: 'MISSION', fdr: { callsign: c } }, 'TACTICAL'), callsign);
    const line = (page) => page.evaluate((c) => getAllEfspStrips().find(x => x.state !== 'DROPPED' && getEfspFdr(x.fdrId).identity.callsign === c), callsign);
    await expect.poll(() => line(tac)).not.toBeNull();
    for (const to of ['AIRBORNE', 'ON_STATION']) {
      await tac.evaluate(([c, t]) => { const s = getAllEfspStrips().find(x => x.state !== 'DROPPED' && getEfspFdr(x.fdrId).identity.callsign === c); window.sendEfspMutation('TAC_C2', getEfspStrip(s.stripId), { kind: 'SetState', toState: t }); }, [callsign, to]);
      await expect.poll(async () => (await line(tac)).state).toBe(to);
    }
    await tac.evaluate((c) => { const s = getAllEfspStrips().find(x => x.state !== 'DROPPED' && getEfspFdr(x.fdrId).identity.callsign === c); window.sendEfspMutation('TAC_C2', getEfspStrip(s.stripId), { kind: 'TransferStrip', toPositionId: 'AIC', bayId: 'aic-on-station', rackId: 'main' }); }, callsign);
    await expect.poll(async () => (await line(tac)).ownerPositionId).toBe('AIC');
    const withTab = tac.locator('#efsp-bay-tabs .efsp-bay-tab', { hasText: 'with AIC/JTAC' });
    await expect(withTab, 'TAC_C2 has a tab for lines held below it').toBeVisible();
    await withTab.click();
    await expect(tac.locator('.efsp-strip', { hasText: callsign }).first()).toBeVisible();
    // JTAC-only: only its own tab (the line is AIC's, never sent to it).
    await expect(jtac.locator('#efsp-position-tabs .efsp-position-tab')).toHaveCount(1);
  } finally {
    await dropStrips(tac, [callsign]);
  }
});
