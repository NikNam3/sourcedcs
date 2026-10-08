'use strict';

/* DIVERT (crc-sync docs/adr/0111): a new destination and a new clearance on the same Strip, from the ⋯ menu.
 * Every Strip the test makes is dropped at its end (the Board lives for the whole run). */

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
  .map(s => ({ stripId: s.stripId, facilityId: s.facilityId, owner: s.ownerPositionId, bayId: s.bayId, state: s.state, stripType: s.stripType, diverts: (s.diverts || []).length })), callsign);
const recordAt = async (page, callsign, facilityId) => (await records(page, callsign)).find(r => r.facilityId === facilityId) || null;
const shot = (page, name) => page.screenshot({ path: test.info().outputPath(`${name}.png`) });
const nla = (page, callsign) => stripByCallsign(page, callsign).locator('.efsp-nla-btn');
async function press(page, callsign) {
  await lapseNlaGuard(page);
  await nla(page, callsign).click();
}
async function goBay(page, positionId, bayId) {
  await page.locator(`#efsp-position-tabs .efsp-position-tab[data-position-id="${positionId}"]`).click();
  await page.locator(`#efsp-bay-tabs .efsp-bay-tab[data-bay-id="${bayId}"]`).click();
}

/** Opens the Divert form on a Strip and sends it. */
async function divert(page, callsign, fields) {
  await startAction(stripByCallsign(page, callsign), 'Divert…');
  const form = page.locator('.efsp-divert-popover');
  await expect(form).toBeVisible();
  for (const [key, value] of Object.entries(fields)) await form.locator(`[data-divert-field="${key}"]`).fill(value);
  await form.getByRole('button', { name: 'Divert' }).dispatchEvent('click');
}

async function seedOverflight(page, callsign, position = 'CTR', facilityId = 'CENTER') {
  const bayId = position === 'CTR' ? 'ctr-overflight' : 'ap-overflight';
  await goBay(page, position, bayId);
  await seedStrip(page, {
    callsign, actingPositionId: position, bayId, stripType: 'OVERFLIGHT', facilityId,
    flightData: { departureAirport: 'LLRD', destinationAirport: 'OSDI', route: 'DCT', requestedAltitude: '250' },
  });
}

async function handOff(from, callsign, toPositionId) {
  await startAction(stripByCallsign(from, callsign), 'Coordinate…');
  const popover = from.locator('.efsp-coordinate-popover');
  await popover.locator('.efsp-coordinate-primitive-select').selectOption('HANDOFF');
  if (toPositionId !== 'AP') await popover.locator('.efsp-coordinate-target-select').selectOption(toPositionId);
  await popover.getByRole('button', { name: 'Send' }).dispatchEvent('click');
}

test('an overflight diverted to Incirlik becomes an arrival on the same Strip, shows the old destination struck through, and is handed to AP', async ({ browser }) => {
  const ctr = await controller(browser, { signedOn: ['CTR'], facilityId: 'CENTER', controller: 'dv-ctr1' });
  const ap = await controller(browser, { signedOn: ['AP'], facilityId: 'INCIRLIK', controller: 'dv-ap1' });
  const callsign = cs('DVA');
  try {
    await seedOverflight(ctr, callsign);
    const before = await recordAt(ctr, callsign, 'CENTER');
    await divert(ctr, callsign, { destination: 'LTAG', route: 'DCT LTAG', altitude: '90', holding: 'HOLD AT LTAG' });
    await expect.poll(async () => (await recordAt(ctr, callsign, 'CENTER') || {}).stripType).toBe('ARRIVAL');
    const after = await recordAt(ctr, callsign, 'CENTER');
    expect(after).toMatchObject({ stripId: before.stripId, state: 'INBOUND', owner: 'CTR', bayId: 'ctr-enroute', diverts: 1 });
    await goBay(ctr, 'CTR', 'ctr-enroute');
    const chip = stripByCallsign(ctr, callsign).locator('.efsp-divert-chip');
    await expect(chip).toContainText('LTAG');
    await expect(chip.locator('s.efsp-divert-old')).toHaveText('OSDI');
    await shot(ctr, '01-diverted-to-incirlik');
    await handOff(ctr, callsign, 'AP');
    await expect.poll(async () => (await recordAt(ap, callsign, 'INCIRLIK') || {}).stripType).toBe('ARRIVAL');
  } finally {
    await dropStrips(ctr, [callsign]);
    await dropStrips(ap, [callsign]);
  }
});

test('an overflight diverted to the carrier becomes an arrival that CV_MARSHAL takes', async ({ browser }) => {
  const ctr = await controller(browser, { signedOn: ['CTR'], facilityId: 'CENTER', controller: 'dv-ctr2' });
  const cv = await controller(browser, { signedOn: ['CV_MARSHAL'], facilityId: 'CARRIER', controller: 'dv-cv2' });
  const callsign = cs('DVB');
  try {
    await seedOverflight(ctr, callsign);
    await divert(ctr, callsign, { destination: 'CVN-72' });
    await expect.poll(async () => (await recordAt(ctr, callsign, 'CENTER') || {}).stripType).toBe('ARRIVAL');
    await goBay(ctr, 'CTR', 'ctr-enroute');
    await handOff(ctr, callsign, 'CV_MARSHAL');
    await expect.poll(async () => (await recordAt(cv, callsign, 'CARRIER') || {}).state).toBeTruthy();
    await goBay(cv, 'CV_MARSHAL', 'cv-marshal-coordination');
    await cv.locator('.efsp-strip', { hasText: callsign }).first().getByRole('button', { name: /accept/i }).first().click();
    await expect.poll(async () => (await recordAt(cv, callsign, 'CARRIER') || {}).owner).toBe('CV_MARSHAL');
    await shot(cv, '02-carrier-took-it');
  } finally {
    await dropStrips(ctr, [callsign]);
    await dropStrips(cv, [callsign]);
  }
});

test('an overflight diverted to an untowered field stays an overflight with CTR until it is terminated', async ({ browser }) => {
  const ctr = await controller(browser, { signedOn: ['CTR'], facilityId: 'CENTER', controller: 'dv-ctr3' });
  const callsign = cs('DVC');
  try {
    await seedOverflight(ctr, callsign);
    await divert(ctr, callsign, { destination: 'LTAI', route: 'DCT LTAI' });
    await expect.poll(async () => (await recordAt(ctr, callsign, 'CENTER') || {}).diverts).toBe(1);
    expect(await recordAt(ctr, callsign, 'CENTER')).toMatchObject({ stripType: 'OVERFLIGHT', state: 'INBOUND', owner: 'CTR', bayId: 'ctr-overflight' });
    await press(ctr, callsign);
    await expect.poll(async () => (await recordAt(ctr, callsign, 'CENTER') || {}).state).toBe('IN_SECTOR');
    await press(ctr, callsign);
    await expect.poll(async () => (await recordAt(ctr, callsign, 'CENTER') || {}).state).toBe('HANDED_OFF');
    await press(ctr, callsign);
    await expect.poll(() => records(ctr, callsign)).toEqual([]);
  } finally {
    await dropStrips(ctr, [callsign]);
  }
});

test('an arrival diverts to the carrier, then to an untowered field (an overflight being worked), then back', async ({ browser }) => {
  const ctr = await controller(browser, { signedOn: ['CTR'], facilityId: 'CENTER', controller: 'dv-ctr4' });
  const callsign = cs('DVD');
  try {
    await goBay(ctr, 'CTR', 'ctr-enroute');
    await seedStrip(ctr, { callsign, actingPositionId: 'CTR', bayId: 'ctr-enroute', stripType: 'ARRIVAL', facilityId: 'CENTER', flightData: { originAirport: 'LLRD' } });
    await divert(ctr, callsign, { destination: 'CVN-72', altitude: 'FL100' });
    await expect.poll(async () => (await recordAt(ctr, callsign, 'CENTER') || {}).diverts).toBe(1);
    expect(await recordAt(ctr, callsign, 'CENTER')).toMatchObject({ stripType: 'ARRIVAL', state: 'INBOUND' });
    await divert(ctr, callsign, { destination: 'LTAI' });
    await expect.poll(async () => (await recordAt(ctr, callsign, 'CENTER') || {}).stripType).toBe('OVERFLIGHT');
    expect(await recordAt(ctr, callsign, 'CENTER')).toMatchObject({ state: 'IN_SECTOR', bayId: 'ctr-overflight', diverts: 2 });
    await goBay(ctr, 'CTR', 'ctr-overflight');
    await divert(ctr, callsign, { destination: 'LTAG' });
    await expect.poll(async () => (await recordAt(ctr, callsign, 'CENTER') || {}).stripType).toBe('ARRIVAL');
    expect(await recordAt(ctr, callsign, 'CENTER')).toMatchObject({ diverts: 3 });
    await shot(ctr, '04-diverted-back');
  } finally {
    await dropStrips(ctr, [callsign]);
  }
});

test('a departure is listed greyed with its reason, and the server refuses it too', async ({ browser }) => {
  const ap = await controller(browser, { signedOn: ['OPS', 'AP'], facilityId: 'INCIRLIK', controller: 'dv-ap5' });
  const callsign = cs('DVE');
  try {
    await seedStrip(ap, { callsign, stripType: 'DEPARTURE' });
    const strip = await ap.evaluate((c) => {
      const s = [...crc.state.efspStrips.values()].find(x => (crc.state.efspFlightDataList.get(x.flightDataId) || {}).identity.callsign === c);
      return { stripId: s.stripId, rev: s.rev };
    }, callsign);
    await ap.evaluate((s) => crc.ws.sendEfspMutation('OPS', crc.state.getEfspStrip(s.stripId), { kind: 'SetState', toState: 'HANDED_OFF' }), strip);
    await expect.poll(async () => (await recordAt(ap, callsign, 'INCIRLIK') || {}).state).toBe('HANDED_OFF');
    await ap.evaluate((s) => crc.ws.sendEfspMutation('OPS', crc.state.getEfspStrip(s.stripId), { kind: 'TransferStrip', toPositionId: 'AP', bayId: 'ap-departures', rackId: 'main' }), strip);
    await expect.poll(async () => (await recordAt(ap, callsign, 'INCIRLIK') || {}).owner).toBe('AP');
    await goBay(ap, 'AP', 'ap-departures');
    const item = await (async () => {
      const el = ap.locator(`.efsp-strip[data-strip-id="${strip.stripId}"]`);
      await expect(el).toBeVisible();
      await el.locator('.efsp-strip-menu-btn').click({ timeout: 5000 });
      return ap.locator('.efsp-strip-menu .efsp-divert-btn');
    })();
    await expect(item).toBeDisabled();
    await expect(item).toHaveAttribute('title', /departure does not divert/);
    await shot(ap, '05-departure-greyed');
    await ap.keyboard.press('Escape');
    // the server's own refusal, reached directly
    await ap.evaluate((s) => {
      window.__divertAck = null;
      crc.ws.sendEfspMutation('AP', crc.state.getEfspStrip(s.stripId), { kind: 'Divert', destination: 'LTAC' }, { onAck: (ack) => { window.__divertAck = ack; return true; } });
    }, strip);
    await expect.poll(() => ap.evaluate(() => window.__divertAck)).not.toBeNull();
    const refusal = await ap.evaluate(() => window.__divertAck);
    expect(refusal.ok).toBe(false);
    expect(refusal.detail).toMatch(/departure does not divert/);
  } finally {
    await dropStrips(ap, [callsign]);
  }
});

test('Undo puts a divert back inside ten seconds', async ({ browser }) => {
  const ctr = await controller(browser, { signedOn: ['CTR'], facilityId: 'CENTER', controller: 'dv-ctr6' });
  const callsign = cs('DVF');
  try {
    await seedOverflight(ctr, callsign);
    await divert(ctr, callsign, { destination: 'LTAG' });
    await expect.poll(async () => (await recordAt(ctr, callsign, 'CENTER') || {}).stripType).toBe('ARRIVAL');
    await expect(ctr.locator('#efsp-undo-slot button')).toContainText(/Divert/);
    await ctr.locator('#efsp-undo-slot button').click();
    await expect.poll(async () => (await recordAt(ctr, callsign, 'CENTER') || {}).stripType).toBe('OVERFLIGHT');
    expect(await recordAt(ctr, callsign, 'CENTER')).toMatchObject({ bayId: 'ctr-overflight', diverts: 0 });
    await shot(ctr, '06-undone');
  } finally {
    await dropStrips(ctr, [callsign]);
  }
});

test('a controller holding both AP and CTR diverts the Strip at the Position that owns it', async ({ browser }) => {
  const both = await controller(browser, { signedOn: ['AP'], facilityId: 'INCIRLIK', controller: 'dv-both7' });
  await both.evaluate(() => crc.ws.sendEfspSetPositions('CENTER', ['CTR']));
  await both.waitForFunction(() => crc.ws.getAckedPositions('CENTER').includes('CTR'));
  const callsign = cs('DVG');
  try {
    await seedOverflight(both, callsign, 'AP', 'INCIRLIK');
    await divert(both, callsign, { destination: 'LTAG' });
    await expect.poll(async () => (await recordAt(both, callsign, 'INCIRLIK') || {}).stripType).toBe('ARRIVAL');
    expect(await recordAt(both, callsign, 'INCIRLIK')).toMatchObject({ owner: 'AP', bayId: 'ap-inbound' });
  } finally {
    await dropStrips(both, [callsign]);
  }
});
