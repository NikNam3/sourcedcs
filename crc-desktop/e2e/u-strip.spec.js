'use strict';

/* U-STRIP (live test 2026-10-13 §A, decisions.md H138, H139): the Strip face, round 2.
 *  U1  a long value never runs under the next field: cut inside its own cell, the whole text on hover, on every strip type.
 *  U2  RMKS on every strip type when present, one bottom row cut at a word boundary; a text-box window shows and edits
 *      the whole remark (SetBlock), read-only and refused for a controller without the right.
 *  U3  COMMS:/CTRL: grey with no background (is in the control-release spec's HANDOFF set-up: see the U3 test below).
 *  U4  the stereo picker lists names only, and a Strip filed on one carries no remarks.
 * The carrier and airfield FINAL Bays draw a one-line list, not Strip faces (bay-views.js), so FINAL is not here: see
 * docs/wip/U-STRIP.md. */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, startAction } = require('./helpers/app');

test.describe.configure({ timeout: 90000 });

let seq = 0;
const uniqueCallsign = (prefix) => `${prefix}${(Date.now() + seq++) % 10000}`;

const LONG_ROUTE = 'DCT KEMER DCT ERGEP/D1+00 ERGEP DCT KEMER DCT DAN DCT MANAZ DCT MUT DCT TARSU DCT ADANA DCT LTAG';
const LONG_TEXT = 'FORMATION OF FOUR WITH A VERY LONG NOTE THAT WILL NOT FIT';
// 300 characters of words, the H139 case.
const LONG_REMARK = (() => {
  const words = 'Formations expect block FL210-FL230. RECOVERY: contact Ankara Center (CH7). When cleared on the recovery, depart the MOA and descend to cross ERGEP at FL180 or as assigned. After ERGEP proceed direct KEMER, after KEMER proceed direct Incirlik TACAN. Expect further clearance from Incirlik Radar. Nonstandard formation authorized.';
  return words.slice(0, 300);
})();

const stripOf = (page, callsign) => page.locator('.efsp-strip', { has: page.getByText(callsign, { exact: true }) }).first();

/** The live record for a callsign, from the page's own state. */
const recordOf = (page, callsign) => page.evaluate((cs) => {
  const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === cs);
  if (!s) return null;
  const f = crc.state.getEfspFlightData(s.flightDataId);
  return { stripId: s.stripId, owner: s.ownerPositionId, stripType: s.stripType, state: s.state, remarks: f.filed.remarks, rev: s.rev };
}, callsign);

/** A SetBlock as `positionId` on the callsign's Strip; resolves to the server's ack. */
const setBlock = (page, callsign, positionId, blockId, value) => page.evaluate(([cs, p, b, v]) => new Promise((resolve) => {
  const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === cs);
  crc.ws.sendEfspMutation(p, s, { kind: 'SetBlock', blockId: b, value: v }, { onAck: (ack) => { resolve({ ok: ack.ok, reason: ack.reason || null }); return false; } });
}), [callsign, positionId, blockId, value]);

async function openBay(page, positionId, bayId) {
  await page.locator(`#efsp-position-tabs .efsp-position-tab[data-position-id="${positionId}"]`).click();
  await page.locator(`#efsp-bay-tabs .efsp-bay-tab[data-bay-id="${bayId}"]`).click();
}

async function create(page, { positionId, facilityId, bayId, rackId = 'main', stripType, flightData }) {
  await page.evaluate(([p, op, f]) => crc.ws.sendEfspCreateStrip(p, op, f), [positionId,
    { kind: 'CreateStrip', bayId, rackId, stripType, flightData }, facilityId]);
  await expect.poll(() => recordOf(page, flightData.callsign), { timeout: 15000 }).not.toBe(null);
}

/**
 * U1's measure: every field's value stays inside its own cell (the editable cell's 3px target margin aside), and no
 * two fields' values overlap. Returns the offenders, so a failure names them.
 */
const overflowingFields = (strip) => strip.evaluate((el) => {
  const bad = [];
  const fields = [...el.querySelectorAll('.efsp-strip-fields > .efsp-field, .efsp-expanded-row')];
  const boxes = [];
  for (const f of fields) {
    const v = f.querySelector('.efsp-block');
    if (!v) continue;
    const fr = f.getBoundingClientRect();
    const vr = v.getBoundingClientRect();
    const id = v.dataset.block;
    if (vr.right > fr.right + 3.5 || vr.left < fr.left - 3.5) bad.push(`${id}: value ${Math.round(vr.left)}..${Math.round(vr.right)} outside cell ${Math.round(fr.left)}..${Math.round(fr.right)}`);
    boxes.push({ id, l: Math.max(vr.left, fr.left - 3.5), r: Math.min(vr.right, fr.right + 3.5), t: fr.top, b: fr.bottom });
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const vertical = a.t < b.b && b.t < a.b;
      // Neighbouring editable targets meet in the 10px column gap by design (F-105): ink overlap is what is measured.
      if (vertical && a.l < b.r - 7 && b.l < a.r - 7) bad.push(`${a.id} overlaps ${b.id}`);
    }
  }
  return bad;
});

/** The remarks row: one line, inside the Strip, cut at a word boundary of the full text, the full text on hover. */
async function expectRemarksRow(strip, full) {
  const row = strip.locator('.efsp-strip-remarks');
  await expect(row).toBeVisible();
  await expect(row.locator('.efsp-strip-remarks-label')).toHaveText('RMKS');
  const text = row.locator('.efsp-strip-remarks-text');
  await expect(text).toHaveAttribute('title', full);
  await expect.poll(() => text.textContent(), { message: 'cut with an ellipsis' }).toMatch(/…$/);
  const m = await text.evaluate((t) => {
    const r = t.getBoundingClientRect();
    const strip = t.closest('.efsp-strip-main').getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(t).lineHeight);
    return { text: t.textContent, h: r.height, lh, right: r.right, stripRight: strip.right, sw: t.scrollWidth, cw: t.clientWidth };
  });
  expect(m.h, 'one line').toBeLessThanOrEqual(m.lh + 1);
  expect(m.right).toBeLessThanOrEqual(m.stripRight + 0.5);
  expect(m.sw, 'the cut fits: no CSS ellipsis needed').toBeLessThanOrEqual(m.cw);
  const shown = m.text.replace(/…$/, '');
  expect(full.replace(/\s+/g, ' ').startsWith(shown), 'a prefix of the remark').toBe(true);
  const next = full.replace(/\s+/g, ' ').charAt(shown.length);
  expect(next === ' ' || /[,;:.\-]/.test(next), `cut at a word boundary (next char "${next}")`).toBe(true);
  return text;
}

test('U1/U2 DEPARTURE at OPS: a long route stays in its cell (whole on hover); a 300-character remark is one cut line', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS'] });
  const callsign = uniqueCallsign('RTE');
  const strip = await seedStrip(page, { callsign, flightData: { route: LONG_ROUTE } });
  expect(await overflowingFields(strip)).toEqual([]);
  const route = strip.locator('.efsp-block-9');
  await route.hover();
  await expect(route).toHaveAttribute('title', LONG_ROUTE);

  // No remarks: no row, no space.
  await expect(strip.locator('.efsp-strip-remarks')).toHaveCount(0);
  const h0 = await strip.evaluate((el) => el.getBoundingClientRect().height);
  expect(await setBlock(page, callsign, 'OPS', '9E', LONG_REMARK)).toEqual({ ok: true, reason: null });
  await expectRemarksRow(stripOf(page, callsign), LONG_REMARK);
  const h1 = await stripOf(page, callsign).evaluate((el) => el.getBoundingClientRect().height);
  expect(h1 - h0, 'the row is one line tall').toBeLessThanOrEqual(24);
  await page.screenshot({ path: test.info().outputPath('u1-u2-departure.png') });
});

test('U2 the text-box window shows the whole remark and saves an edit; Esc and Cancel change nothing', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS'] });
  const callsign = uniqueCallsign('RMK');
  await seedStrip(page, { callsign, flightData: { route: 'DCT' } });
  await setBlock(page, callsign, 'OPS', '9E', LONG_REMARK);
  const text = await expectRemarksRow(stripOf(page, callsign), LONG_REMARK);

  await text.click();
  const pop = page.locator('.efsp-remarks-popover');
  await expect(pop).toBeVisible();
  await expect(pop).toHaveAttribute('data-remarks', 'edit');
  const box = pop.locator('textarea.efsp-remarks-textarea');
  await expect(box).toHaveValue(LONG_REMARK);
  await expect(box).toBeFocused();
  // The window stays in the viewport and scrolls rather than growing without end.
  const geo = await pop.evaluate((p) => { const r = p.getBoundingClientRect(); return { r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight }; });
  expect(geo.r).toBeLessThanOrEqual(geo.vw);
  expect(geo.b).toBeLessThanOrEqual(geo.vh);
  await page.screenshot({ path: test.info().outputPath('u2-window.png') });

  // Esc cancels.
  await box.fill('SHOULD NOT SAVE');
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  expect((await recordOf(page, callsign)).remarks).toBe(LONG_REMARK);
  // Cancel cancels.
  await stripOf(page, callsign).locator('.efsp-strip-remarks-text').click();
  await page.locator('.efsp-remarks-popover textarea').fill('NOR THIS');
  await page.locator('.efsp-remarks-popover .efsp-remarks-cancel').click();
  await expect(page.locator('.efsp-remarks-popover')).toHaveCount(0);
  expect((await recordOf(page, callsign)).remarks).toBe(LONG_REMARK);

  // Ctrl+Enter saves, through the ordinary SetBlock, and the window closes on the ack.
  await stripOf(page, callsign).locator('.efsp-strip-remarks-text').click();
  await page.locator('.efsp-remarks-popover textarea').fill('PPR 1420\nTAIL SWAP TO 88-0412');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.efsp-remarks-popover')).toHaveCount(0);
  await expect.poll(() => recordOf(page, callsign).then(r => r.remarks)).toBe('PPR 1420\nTAIL SWAP TO 88-0412');
  await expect(stripOf(page, callsign).locator('.efsp-strip-remarks-text')).toHaveText('PPR 1420 TAIL SWAP TO 88-0412');

  // Save button; an emptied remark takes the row away.
  await stripOf(page, callsign).locator('.efsp-strip-remarks-text').click();
  await page.locator('.efsp-remarks-popover textarea').fill('');
  await page.locator('.efsp-remarks-popover .efsp-remarks-save').click();
  await expect.poll(() => recordOf(page, callsign).then(r => r.remarks)).toBe('');
  await expect(stripOf(page, callsign).locator('.efsp-strip-remarks')).toHaveCount(0);

  // With no remarks, the ⋯ menu's "Edit remarks…" writes the first one.
  await startAction(stripOf(page, callsign), 'Edit remarks…');
  await expect(page.locator('.efsp-remarks-popover textarea')).toHaveValue('');
  await page.locator('.efsp-remarks-popover textarea').fill('FIRST REMARK');
  await page.locator('.efsp-remarks-popover .efsp-remarks-save').click();
  await expect.poll(() => recordOf(page, callsign).then(r => r.remarks)).toBe('FIRST REMARK');
});

test('U2 a controller without the right reads the remark (no Save), and the server refuses its edit', async ({ browser }) => {
  const contexts = [];
  const controller = async (opts) => {
    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1600, height: 1000 } });
    contexts.push(ctx);
    const p = await ctx.newPage();
    await openPanel(p, opts);
    return p;
  };
  try {
    const ops = await controller({ signedOn: ['OPS'], controller: 'u-strip-ops' });
    const cd = await controller({ signedOn: ['CD'], controller: 'u-strip-cd' });
    const callsign = uniqueCallsign('ROB');
    await seedStrip(ops, { callsign, flightData: { route: 'DCT' } });
    await setBlock(ops, callsign, 'OPS', '9E', LONG_REMARK);
    await expect.poll(() => recordOf(cd, callsign).then(r => r && r.remarks)).toBe(LONG_REMARK);

    // CD finds OPS's Strip with `.find` (the search Bay lists every Strip, whoever holds it).
    const cmd = cd.locator('#efsp-dot-command-input');
    await cmd.fill(`.find ${callsign}`);
    await cmd.press('Enter');
    const text = await expectRemarksRow(stripOf(cd, callsign), LONG_REMARK);
    await text.click();
    const pop = cd.locator('.efsp-remarks-popover');
    await expect(pop).toHaveAttribute('data-remarks', 'read');
    await expect(pop.locator('textarea')).toHaveValue(LONG_REMARK);
    await expect(pop.locator('textarea')).toHaveJSProperty('readOnly', true);
    await expect(pop.locator('.efsp-remarks-save')).toHaveCount(0);
    await expect(pop.locator('.efsp-remarks-readonly')).toContainText('OPS holds this Strip');
    await cd.screenshot({ path: test.info().outputPath('u2-read-only.png') });
    await pop.locator('.efsp-remarks-close').click();
    await expect(pop).toHaveCount(0);
    // No "Edit remarks…" in its menu either.
    if (await stripOf(cd, callsign).locator('.efsp-strip-menu-btn').count()) {
      await stripOf(cd, callsign).locator('.efsp-strip-menu-btn').click();
      await expect(cd.locator('.efsp-strip-menu [data-strip-action="remarks"]')).toHaveCount(0);
      await cd.keyboard.press('Escape');
    }

    // The same rights as any Block edit: the server refuses a write from a Position that does not hold the Strip.
    const refused = await setBlock(cd, callsign, 'CD', '9E', 'NOT YOURS');
    expect(refused).toEqual({ ok: false, reason: 'NOT_OWNER' });
    expect((await recordOf(ops, callsign)).remarks).toBe(LONG_REMARK);
  } finally {
    for (const c of contexts) await c.close().catch(() => {});
  }
});

test('U1/U2 ARRIVAL at AP: values stay in their cells, the route in the expanded view too; RMKS', async ({ page }) => {
  await openPanel(page, { signedOn: ['AP'], controller: 'u-strip-ap' });
  const arr = uniqueCallsign('ARR');
  await create(page, { positionId: 'AP', facilityId: 'INCIRLIK', bayId: 'ap-inbound', stripType: 'ARRIVAL',
    flightData: { callsign: arr, aircraftType: 'F-16C', originAirport: 'LTAGLONGORIGINNAME', route: LONG_ROUTE } });
  await setBlock(page, arr, 'AP', '9E', LONG_REMARK);
  await openBay(page, 'AP', 'ap-inbound');
  const a = stripOf(page, arr);
  await expectRemarksRow(a, LONG_REMARK);
  await a.locator('.efsp-expand-btn').click();
  await expect(stripOf(page, arr).locator('.efsp-strip-expanded [data-expanded-block="9"]')).toBeVisible();
  // The remarks have their row, so the expanded view does not list them again.
  await expect(stripOf(page, arr).locator('.efsp-strip-expanded [data-expanded-block="9E"]')).toHaveCount(0);
  expect(await overflowingFields(stripOf(page, arr))).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('u1-arrival-expanded.png') });
  await stripOf(page, arr).locator('.efsp-expand-btn').click();
});

test('U1/U2 OVERFLIGHT at CTR (CENTER): the route stays in its cell; RMKS', async ({ page }) => {
  await openPanel(page, { signedOn: ['CTR'], facilityId: 'CENTER', controller: 'u-strip-ctr' });
  const call = uniqueCallsign('OVF');
  await create(page, { positionId: 'CTR', facilityId: 'CENTER', bayId: 'ctr-overflight', stripType: 'OVERFLIGHT',
    flightData: { callsign: call, aircraftType: 'F-16C', route: LONG_ROUTE } });
  await setBlock(page, call, 'CTR', '9E', LONG_REMARK);
  await openBay(page, 'CTR', 'ctr-overflight');
  const s = stripOf(page, call);
  await expect(s.locator('.efsp-block-9')).toHaveText(LONG_ROUTE);
  expect(await overflowingFields(s)).toEqual([]);
  await expectRemarksRow(s, LONG_REMARK);
});

test('U1/U2 MISSION at TAC_C2 (TACTICAL): a long controlling agency stays in its cell; RMKS (Block M8)', async ({ page }) => {
  await openPanel(page, { signedOn: ['TAC_C2'], facilityId: 'TACTICAL', controller: 'u-strip-tac' });
  const call = uniqueCallsign('MSN');
  await create(page, { positionId: 'TAC_C2', facilityId: 'TACTICAL', bayId: 'tac-c2-tasked', stripType: 'MISSION', flightData: { callsign: call } });
  expect(await setBlock(page, call, 'TAC_C2', 'M5', LONG_TEXT)).toEqual({ ok: true, reason: null });
  expect(await setBlock(page, call, 'TAC_C2', 'M8', LONG_REMARK)).toEqual({ ok: true, reason: null });
  await openBay(page, 'TAC_C2', 'tac-c2-tasked');
  const s = stripOf(page, call);
  await expect(s.locator('.efsp-block-M5')).toHaveText(LONG_TEXT);
  expect(await overflowingFields(s)).toEqual([]);
  await expectRemarksRow(s, LONG_REMARK);
});

const BINGO = 'INCIRLIK AIR BASE ADANA TURKEY';
const setCase = async (page, value) => {
  if (await page.evaluate(() => crc.carrier.carrierCaseValue()) === value) return;
  await page.evaluate((v) => crc.ws.sendEfspCarrierMutation('CV_PRIFLY', undefined, undefined, { kind: 'SetCarrierState', field: 'case', value: v }), value);
  await expect.poll(() => page.evaluate(() => crc.carrier.carrierCaseValue()), { timeout: 10000 }).toBe(value);
};

test('U1/U2 MARSHAL and PATTERN at the carrier: a long bingo field and note stay in their cells; RMKS on both', async ({ page }) => {
  await openPanel(page, { signedOn: ['CV_MARSHAL', 'CV_PRIFLY'], facilityId: 'CARRIER', controller: 'u-strip-cv' });
  await page.waitForFunction(() => typeof crc.carrier.getEfspCarrier === 'function' && !!crc.carrier.getEfspCarrier());
  const before = await page.evaluate(() => crc.carrier.carrierCaseValue());
  await setCase(page, 'II');
  try {
    const call = uniqueCallsign('CV');
    await create(page, { positionId: 'CV_MARSHAL', facilityId: 'CARRIER', bayId: 'cv-marshal-stack', stripType: 'MARSHAL',
      flightData: { callsign: call, aircraftType: 'F-18C' } });
    expect(await setBlock(page, call, 'CV_MARSHAL', 'C13', BINGO)).toEqual({ ok: true, reason: null });
    expect(await setBlock(page, call, 'CV_MARSHAL', '9E', LONG_REMARK)).toEqual({ ok: true, reason: null });
    await openBay(page, 'CV_MARSHAL', 'cv-marshal-stack');
    const s = stripOf(page, call);
    await expect(s.locator('.efsp-block-C13')).toHaveText(BINGO);
    expect(await overflowingFields(s)).toEqual([]);
    await expectRemarksRow(s, LONG_REMARK);
    await page.screenshot({ path: test.info().outputPath('u1-u2-marshal.png') });

    // See you: the same flight as PriFly's PATTERN Strip, its remarks with it.
    await s.locator('.efsp-nla-btn[data-carrier-handoff="MARSHAL_TO_PRIFLY"]').click();
    await expect.poll(() => recordOf(page, call).then(r => r && `${r.stripType}/${r.owner}`)).toBe('PATTERN/CV_PRIFLY');
    expect(await setBlock(page, call, 'CV_PRIFLY', 'C24', LONG_TEXT)).toEqual({ ok: true, reason: null });
    await openBay(page, 'CV_PRIFLY', 'cv-prifly-pattern');
    const p = stripOf(page, call);
    await expect(p.locator('.efsp-block-C24')).toHaveText(LONG_TEXT);
    expect(await overflowingFields(p)).toEqual([]);
    await expectRemarksRow(p, LONG_REMARK);
    await page.evaluate((cs) => {
      const x = crc.state.getAllEfspStrips().find(y => y.state !== 'DROPPED' && crc.state.getEfspFlightData(y.flightDataId).identity.callsign === cs);
      crc.ws.sendEfspMutation(x.ownerPositionId, x, { kind: 'DropStrip', reason: 'e2e cleanup' });
    }, call);
  } finally {
    await setCase(page, before);
  }
});

test('U4: the stereo picker lists names only; a Strip filed on a stereo route has no remarks', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS'] });
  const picker = page.locator('#efsp-create-strip-stereo');
  await expect(picker.locator('option')).toHaveText(['— no stereo —', 'PACK1', 'PACK2']);
  const callsign = uniqueCallsign('STR');
  await page.locator('#efsp-new-strip-callsign').fill(callsign);
  await picker.selectOption('PACK1');
  await page.locator('#efsp-create-strip-btn').click();
  await expect.poll(() => recordOf(page, callsign)).not.toBe(null);
  const r = await page.evaluate((cs) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs);
    return crc.state.getEfspFlightData(s.flightDataId).filed;
  }, callsign);
  expect(r.stereoRouteName).toBe('PACK1');
  expect(r.remarks).toBe('');
  await expect(stripOf(page, callsign).locator('.efsp-strip-remarks')).toHaveCount(0);
});

test('U3: COMMS: and CTRL: are grey with no background on both sides of an accepted handoff, whoever holds them', async ({ browser }) => {
  const contexts = [];
  const controller = async (opts) => {
    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1500, height: 1000 } });
    contexts.push(ctx);
    const p = await ctx.newPage();
    await openPanel(p, opts);
    return p;
  };
  try {
    const ctr = await controller({ signedOn: ['CTR'], facilityId: 'CENTER', controller: 'u3-ctr' });
    const ap = await controller({ signedOn: ['AP'], facilityId: 'INCIRLIK', controller: 'u3-ap' });
    const cs = uniqueCallsign('UCR');
    const s = await seedStrip(ctr, { callsign: cs, actingPositionId: 'CTR', bayId: 'ctr-enroute', stripType: 'ARRIVAL', facilityId: 'CENTER' });
    await startAction(s, 'Coordinate…');
    const popover = ctr.locator('.efsp-coordinate-popover');
    await popover.locator('.efsp-coordinate-primitive-select').selectOption('HANDOFF');
    await popover.locator('.efsp-coordinate-send-btn').dispatchEvent('click');
    await popover.waitFor({ state: 'detached' });
    await openBay(ap, 'AP', 'ap-coordination');
    await stripOf(ap, cs).getByRole('button', { name: 'Accept Hand Off' }).click();
    await openBay(ap, 'AP', 'ap-inbound');

    const MUTED = 'rgb(140, 154, 166)'; // --efsp-muted
    for (const page of [ctr, ap]) {
      for (const key of ['comms', 'control']) {
        const c = stripOf(page, cs).locator(`[data-chip="${key}"]`);
        await expect(c).toBeVisible();
        const style = await c.evaluate((el) => { const s = getComputedStyle(el); return { color: s.color, bg: s.backgroundColor, border: s.borderTopColor }; });
        expect(style, `${key}`).toEqual({ color: MUTED, bg: 'rgba(0, 0, 0, 0)', border: 'rgba(0, 0, 0, 0)' });
      }
    }
    await ap.screenshot({ path: test.info().outputPath('u3-chips.png') });
  } finally {
    for (const c of contexts) await c.close().catch(() => {});
  }
});
