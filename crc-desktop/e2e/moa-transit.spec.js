'use strict';

/* U-MOA-TRANSIT-BUILD (crc-sync docs/adr/0128, H151), against the REAL crc-sync.
 *
 * 1. The card flow: CTR controls an active MOA Incirlik uses (OPS schedules, so CTR decides, H151 MT-Q1 a). AP holds an
 *    IFR flight and asks for a transit from the Strip's ⋯ menu; the Strip shows the grey REQ mark. CTR opens the card,
 *    sees "transit requested by AP" and approves; the mark reads TRANSIT <name>. CTR then declines with a reason typed
 *    inline; the mark reads DECLINED and stays until AP acknowledges it from the Strip's menu (ADR 0136).
 * 2. The entry block (docs/adr/0128 §3): Airspace… with a block, then Entry block… amends it; the server's ack is checked.
 * Run on E2E_LANE=7.
 */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, stripByCallsign, startAction, dropStrips } = require('./helpers/app');
const { startFakeDcs, fakeDcsPort } = require('./helpers/fake-dcs');

test.describe.configure({ timeout: 120000 });

const LANE = Number(process.env.E2E_LANE || 0);
let fake;
test.beforeAll(async () => { fake = await startFakeDcs(fakeDcsPort(3010 + LANE)); });
test.afterAll(async () => { if (fake) await fake.stop(); });

let seq = 0;
const uid = () => String((Date.now() + seq++) % 100000);

const stripOf = (page, callsign) => page.evaluate((cs) => {
  const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === cs);
  return s ? { stripId: s.stripId, ownerPositionId: s.ownerPositionId, flightDataId: s.flightDataId, entry: s.airspaceEntry } : null;
}, callsign);

const transitOf = (page, airspaceId, flightDataId) => page.evaluate(([id, fd]) => {
  const a = crc.state.getEfspAirspace(id);
  const t = a && (a.transits || []).find(x => x.flightDataId === fd);
  return t ? { state: t.state, requestedPositionId: t.requestedPositionId, decidedPositionId: t.decidedPositionId, reason: t.reason } : null;
}, [airspaceId, flightDataId]);

async function signOn(page, facilityId, positions) {
  await page.evaluate(([f, p]) => crc.ws.sendEfspSetPositions(f, p), [facilityId, positions]);
  await page.waitForFunction(([f, p]) => { const a = crc.ws.getAckedPositions(f); return a.length === p.length && p.every(x => a.includes(x)); }, [facilityId, positions]);
}

const airspaceOp = (page, positionId, airspaceId, op, extra = {}) => page.evaluate(([p, id, o, x]) => new Promise((resolve) => {
  const a = crc.state.getEfspAirspace(id);
  crc.ws.sendEfspAirspaceMutation(p, id, a ? a.rev : 0, o, x, { onAck: (ack) => { resolve({ ok: ack.ok, reason: ack.reason || null, detail: ack.detail || null }); return true; } });
  setTimeout(() => resolve(null), 8000);
}), [positionId, airspaceId, op, extra]);

/** An ACTIVE MOA controlled by CTR and used by Incirlik (OPS schedules, CTR approves the activation). */
async function activeMoa(page, airspaceId, extra = {}) {
  const ok = { ok: true, reason: null, detail: null };
  expect(await airspaceOp(page, 'CTR', airspaceId, { kind: 'CreateAirspace', definition: {
    airspaceId, name: `Moa ${airspaceId}`, kind: 'AREA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'INCIRLIK', ...extra,
  } })).toEqual(ok);
  const now = Date.now(); // a booking is not gated on activation
  expect(await airspaceOp(page, 'OPS', airspaceId, { kind: 'ScheduleAirspace', fromUtc: now - 60000, toUtc: now + 7200000 })).toEqual(ok);
  expect(await airspaceOp(page, 'OPS', airspaceId, { kind: 'RequestActivation' })).toEqual(ok);
  expect(await airspaceOp(page, 'CTR', airspaceId, { kind: 'ApproveActivation' })).toEqual(ok);
}

async function cleanupAirspace(page, airspaceId) {
  await page.evaluate((id) => {
    const a = crc.state.getEfspAirspace(id);
    if (!a) return;
    if (a.state === 'ACTIVE') crc.ws.sendEfspAirspaceMutation('OPS', id, a.rev, { kind: 'ReleaseAirspace' });
  }, airspaceId);
  await expect.poll(() => page.evaluate((id) => (crc.state.getEfspAirspace(id) || {}).state, airspaceId), { timeout: 10000 }).not.toBe('ACTIVE');
  await page.evaluate((id) => { const a = crc.state.getEfspAirspace(id); if (a && a.state === 'RELEASED') crc.ws.sendEfspAirspaceMutation('CTR', id, a.rev, { kind: 'ReturnAirspace' }); }, airspaceId);
  await expect.poll(() => page.evaluate((id) => (crc.state.getEfspAirspace(id) || {}).state, airspaceId), { timeout: 10000 }).toBe('RETURNED');
  await page.evaluate((id) => { const a = crc.state.getEfspAirspace(id); if (a) crc.ws.sendEfspAirspaceMutation('CTR', id, a.rev, { kind: 'DeleteAirspace' }, { baseDefRev: a.defRev }); }, airspaceId);
}

/** An IFR (altitude assigned) DEPARTURE held by AP. */
async function apFlight(page, callsign) {
  await seedStrip(page, { callsign, stripType: 'DEPARTURE' });
  const s = await stripOf(page, callsign);
  await page.evaluate((id) => crc.ws.sendEfspMutation('OPS', crc.state.getEfspStrip(id), { kind: 'SetBlock', blockId: '21', value: '190' }), s.stripId);
  await expect.poll(() => page.evaluate((fd) => {
    const c = crc.state.getEfspFlightData(fd).clearance;
    return !!(c && c.altitude && c.altitude.entries.some(e => e.status === 'ACTIVE' && e.parsed === 19000));
  }, s.flightDataId)).toBe(true);
  await page.evaluate((id) => crc.ws.sendEfspMutation('OPS', crc.state.getEfspStrip(id), { kind: 'SetState', toState: 'HANDED_OFF' }), s.stripId);
  await expect.poll(() => page.evaluate((id) => crc.state.getEfspStrip(id).state, s.stripId)).toBe('HANDED_OFF');
  await page.evaluate((id) => crc.ws.sendEfspMutation('OPS', crc.state.getEfspStrip(id), { kind: 'TransferStrip', toPositionId: 'AP', bayId: 'ap-departures', rackId: 'main' }), s.stripId);
  await expect.poll(() => stripOf(page, callsign).then(x => x.ownerPositionId)).toBe('AP');
  return s;
}

/** Shows AP's departures Bay, where the Strip sits after the transfer. */
async function goApDepartures(page) {
  await page.locator('#efsp-position-tabs .efsp-position-tab[data-position-id="AP"]').click({ timeout: 5000 });
  await page.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="ap-departures"]').click({ timeout: 5000 });
  await expect(page.locator('.efsp-strip')).not.toHaveCount(0);
}

async function openAirspacePanel(page) {
  await page.evaluate(() => { if (!crc.dock.isDockPanelOpen('airspace')) crc.dock.toggleDockPanel('airspace', true); });
  await expect(page.locator('#airspace-panel')).toBeVisible({ timeout: 10000 });
  const allBtn = page.locator('.airspace-seg-btn[data-filter="all"]');
  if (await allBtn.isEnabled()) await allBtn.click();
}

const _contexts = [];
test.afterEach(async () => { while (_contexts.length) await _contexts.pop().close().catch(() => {}); });

/** A second controller in its own browser context (divert.spec.js's pattern). */
async function controller(browser, opts) {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1500, height: 1000 } });
  _contexts.push(ctx);
  const page = await ctx.newPage();
  await openPanel(page, opts);
  return page;
}

test('AP asks from the Strip, CTR approves and then declines on the card; the Strip\'s mark stays grey throughout', async ({ browser }) => {
  const ap = await controller(browser, { signedOn: ['OPS', 'AP'], facilityId: 'INCIRLIK', controller: 'tr-ap' });
  const ctr = await controller(browser, { signedOn: ['CTR'], facilityId: 'CENTER', controller: 'tr-ctr' });
  await expect.poll(() => ctr.evaluate(() => crc.airspaceLayer.currentTheater()), { timeout: 20000 }).toBe('Syria');
  const n = uid();
  const airspaceId = `MOA-TR${n}`;
  const name = `Moa ${airspaceId}`;
  const callsign = `TR${n}`.slice(0, 7);
  const ok = { ok: true, reason: null, detail: null };
  expect(await airspaceOp(ctr, 'CTR', airspaceId, { kind: 'CreateAirspace', definition: {
    airspaceId, name, kind: 'AREA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'INCIRLIK',
  } })).toEqual(ok);
  await expect.poll(() => ap.evaluate((id) => !!crc.state.getEfspAirspace(id), airspaceId), { timeout: 10000 }).toBe(true);
  expect(await airspaceOp(ap, 'OPS', airspaceId, { kind: 'ScheduleAirspace', fromUtc: Date.now() - 60000, toUtc: Date.now() + 7200000 })).toEqual(ok);
  expect(await airspaceOp(ap, 'OPS', airspaceId, { kind: 'RequestActivation' })).toEqual(ok);
  await expect.poll(() => ctr.evaluate((id) => !!(crc.state.getEfspAirspace(id) || {}).pendingRequest, airspaceId), { timeout: 10000 }).toBe(true);
  expect(await airspaceOp(ctr, 'CTR', airspaceId, { kind: 'ApproveActivation' })).toEqual(ok);
  const s = await apFlight(ap, callsign);
  try {
    await goApDepartures(ap);
    await startAction(stripByCallsign(ap, callsign), `Request transit ${name}`);
    await expect.poll(() => transitOf(ap, airspaceId, s.flightDataId), { timeout: 10000 }).toEqual({ state: 'REQUESTED', requestedPositionId: 'AP', decidedPositionId: null, reason: null });
    const mark = stripByCallsign(ap, callsign).locator('.efsp-transit-mark');
    await expect(mark).toHaveText(`TRANSIT ${name} REQ`);
    await expect(mark, 'grey: the normal tone, never amber (H151 MT-Q7 b)').toHaveClass(/efsp-ind-on/);

    await openAirspacePanel(ctr);
    const row = ctr.locator(`.airspace-card[data-airspace-id="${airspaceId}"] .airspace-entry-row`, { hasText: callsign });
    await expect(row.locator('.airspace-entry-transit')).toHaveText('transit requested by AP', { timeout: 15000 });
    await row.locator('.airspace-transit-approve-btn').click({ timeout: 5000 });
    await expect.poll(() => transitOf(ap, airspaceId, s.flightDataId).then(t => t && t.state), { timeout: 10000 }).toBe('APPROVED');
    await expect(mark).toHaveText(`TRANSIT ${name}`);
    expect((await stripOf(ap, callsign)).entry, 'a transit moves no radio and no Strip (unlike ApproveAirspaceEntry)').toBe(null);
    await expect(row.locator('.airspace-entry-transit')).toHaveText('transit approved', { timeout: 15000 });

    await row.locator('.airspace-transit-decline-btn').click({ timeout: 5000 });
    const form = ctr.locator(`.airspace-card[data-airspace-id="${airspaceId}"] .airspace-entry-decline`);
    await form.locator('input').fill('users at all levels');
    await form.locator('.airspace-entry-decline-send').click({ timeout: 5000 });
    await expect.poll(() => transitOf(ap, airspaceId, s.flightDataId), { timeout: 10000 })
      .toEqual({ state: 'DECLINED', requestedPositionId: 'AP', decidedPositionId: 'CTR', reason: 'users at all levels' });
    await expect(mark).toHaveText(`TRANSIT ${name} DECLINED`);
    await expect(row.locator('.airspace-entry-transit')).toHaveText('transit declined: users at all levels', { timeout: 15000 });

    // crc-sync ADR 0136 (H156 MTB-Q2 b): the decline stays until AP, holding the flight, acknowledges it from the Strip.
    await startAction(stripByCallsign(ap, callsign), `Acknowledge transit decline ${name}`);
    await expect.poll(() => transitOf(ap, airspaceId, s.flightDataId), { timeout: 10000 }).toBe(null);
    await expect(mark).toHaveCount(0);
  } finally {
    await dropStrips(ap, [callsign]);
    await ap.evaluate((id) => { const a = crc.state.getEfspAirspace(id); if (a && a.state === 'ACTIVE') crc.ws.sendEfspAirspaceMutation('OPS', id, a.rev, { kind: 'ReleaseAirspace' }); }, airspaceId);
    await expect.poll(() => ctr.evaluate((id) => (crc.state.getEfspAirspace(id) || {}).state, airspaceId), { timeout: 10000 }).not.toBe('ACTIVE');
    await cleanupAirspace(ctr, airspaceId);
  }
});

test('the entry block: Airspace… with a block, then Entry block… amends it', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS', 'AP'] });
  await signOn(page, 'CENTER', ['CTR']);
  await expect.poll(() => page.evaluate(() => crc.airspaceLayer.currentTheater()), { timeout: 20000 }).toBe('Syria');
  const n = uid();
  const airspaceId = `MOA-EB${n}`;
  const callsign = `EB${n}`.slice(0, 7);
  await activeMoa(page, airspaceId, { altLowerFt: 10000, altUpperFt: 30000 });
  await apFlight(page, callsign);
  try {
    await signOn(page, 'INCIRLIK', ['AP']); // the Strip's owner approves as itself
    await goApDepartures(page);
    await startAction(stripByCallsign(page, callsign), 'Airspace…');
    const popover = page.locator('.efsp-coordinate-popover');
    await popover.getByTestId('airspace-entry-airspace').selectOption(airspaceId);
    await popover.locator('.efsp-entry-block-lower').fill('FL200');
    await popover.locator('.efsp-entry-block-upper').fill('FL400');
    await popover.locator('.efsp-coordinate-send-btn').click();
    await expect(popover.locator('.efsp-entry-block-why'), 'refused in place, nothing sent').toHaveText(/tops at FL300/);
    await popover.locator('.efsp-entry-block-upper').fill('FL240');
    await popover.locator('.efsp-coordinate-send-btn').click();
    await expect.poll(() => stripOf(page, callsign).then(x => x.entry && x.entry.altitudeBlock), { timeout: 10000 }).toEqual({ lowerFt: 20000, upperFt: 24000 });

    await startAction(stripByCallsign(page, callsign), 'Entry block…');
    const amend = page.locator('.efsp-entry-block-popover');
    await expect(amend.locator('.efsp-entry-block-lower')).toHaveValue('FL200');
    await amend.locator('.efsp-entry-block-upper').fill('FL220');
    await amend.locator('.efsp-coordinate-send-btn').click();
    await expect.poll(() => stripOf(page, callsign).then(x => x.entry && x.entry.altitudeBlock), { timeout: 10000 }).toEqual({ lowerFt: 20000, upperFt: 22000 });
    expect((await stripOf(page, callsign)).entry.airspaceId).toBe(airspaceId);
  } finally {
    await signOn(page, 'INCIRLIK', ['OPS', 'AP']);
    await dropStrips(page, [callsign]);
    await cleanupAirspace(page, airspaceId);
  }
});

test('Deny activation takes its reason inline on the card (Electron has no window.prompt)', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS'] });
  await signOn(page, 'CENTER', ['CTR']);
  await expect.poll(() => page.evaluate(() => crc.airspaceLayer.currentTheater()), { timeout: 20000 }).toBe('Syria');
  const airspaceId = `MOA-DN${uid()}`;
  const ok = { ok: true, reason: null, detail: null };
  expect(await airspaceOp(page, 'CTR', airspaceId, { kind: 'CreateAirspace', definition: {
    airspaceId, name: `Moa ${airspaceId}`, kind: 'AREA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'INCIRLIK',
  } })).toEqual(ok);
  expect(await airspaceOp(page, 'OPS', airspaceId, { kind: 'ScheduleAirspace', fromUtc: Date.now() - 60000, toUtc: Date.now() + 7200000 })).toEqual(ok);
  expect(await airspaceOp(page, 'OPS', airspaceId, { kind: 'RequestActivation' })).toEqual(ok);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await openAirspacePanel(page);
    const card = page.locator(`.airspace-card[data-airspace-id="${airspaceId}"]`);
    await card.locator('.airspace-action-btn', { hasText: /^Deny$/ }).click({ timeout: 15000 });
    await card.locator('.airspace-delay input').fill('range fouled');
    await card.locator('.airspace-delay .airspace-save-btn').click();
    await expect.poll(() => page.evaluate((id) => {
      const a = crc.state.getEfspAirspace(id);
      return a ? { pending: !!a.pendingRequest, reason: a.lastDenial && a.lastDenial.reason } : null;
    }, airspaceId), { timeout: 10000 }).toEqual({ pending: false, reason: 'range fouled' });
    expect(errors).toEqual([]);
  } finally {
    // A denied request leaves the booking: Return cancels a schedule that never went active (LEGAL_TRANSITIONS).
    await page.evaluate((id) => { const a = crc.state.getEfspAirspace(id); if (a && a.state === 'SCHEDULED') crc.ws.sendEfspAirspaceMutation('CTR', id, a.rev, { kind: 'ReturnAirspace' }); }, airspaceId);
    await cleanupAirspace(page, airspaceId);
  }
});
