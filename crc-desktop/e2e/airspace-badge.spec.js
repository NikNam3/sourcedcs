'use strict';

/* U-AIRSPACE-BADGE (crc-sync docs/adr/0134, H155 item 4): the Strip's airspace badge is amber only while the flight is
 * airborne inside its approved airspace and that airspace is not ACTIVE.
 *
 * The airspace, the Strip and the entry approval are the REAL crc-sync's. The rig has no DCS units, so the server never
 * says a flight is inside anything; the `airspaceInside` fact is injected the way app.js applies an efsp-alerts frame
 * (airspace-entry-alert.spec.js's pattern). Assert straight after injecting: the next real frame replaces it.
 * Run on E2E_LANE=7.
 */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, stripByCallsign, dropStrips } = require('./helpers/app');
const { startFakeDcs, fakeDcsPort } = require('./helpers/fake-dcs');

test.describe.configure({ timeout: 90000 });

const LANE = Number(process.env.E2E_LANE || 0);
let fake;
test.beforeAll(async () => { fake = await startFakeDcs(fakeDcsPort(3010 + LANE)); });
test.afterAll(async () => { if (fake) await fake.stop(); });

const uid = () => String(Date.now() % 100000);

async function signOn(page, facilityId, positions) {
  await page.evaluate(([f, p]) => crc.ws.sendEfspSetPositions(f, p), [facilityId, positions]);
  await page.waitForFunction(([f, p]) => { const a = crc.ws.getAckedPositions(f); return a.length === p.length && p.every(x => a.includes(x)); }, [facilityId, positions]);
}

test('approved early: grey; airborne inside the unactivated block: amber with its state; out again: grey', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS', 'AP'] });
  await signOn(page, 'CENTER', ['CTR']);
  await expect.poll(() => page.evaluate(() => crc.airspaceLayer.currentTheater()), { timeout: 20000 }).toBe('Syria');
  const n = uid();
  const airspaceId = `MOA-BD${n}`;
  const name = `Badge ${n}`;
  const callsign = `BD${n}`.slice(0, 7);
  const created = await page.evaluate(([id, nm]) => new Promise((resolve) => {
    crc.ws.sendEfspAirspaceMutation('CTR', id, 0, { kind: 'CreateAirspace', definition: {
      airspaceId: id, name: nm, kind: 'AREA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'INCIRLIK',
    } }, {}, { onAck: (ack) => { resolve(ack.ok); return true; } });
    setTimeout(() => resolve(null), 8000);
  }), [airspaceId, name]);
  expect(created).toBe(true);
  await expect.poll(() => page.evaluate((id) => (crc.state.getEfspAirspace(id) || {}).state || null, airspaceId), { timeout: 10000 }).not.toBe(null);
  const state = await page.evaluate((id) => crc.state.getEfspAirspace(id).state, airspaceId);
  expect(state, 'a new airspace is not active').not.toBe('ACTIVE');

  await seedStrip(page, { callsign, stripType: 'DEPARTURE' });
  const stripId = await page.evaluate((cs) => crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === cs).stripId, callsign);
  try {
    await page.evaluate((id) => crc.ws.sendEfspMutation('OPS', crc.state.getEfspStrip(id), { kind: 'SetState', toState: 'HANDED_OFF' }), stripId);
    await expect.poll(() => page.evaluate((id) => crc.state.getEfspStrip(id).state, stripId)).toBe('HANDED_OFF');
    await page.evaluate((id) => crc.ws.sendEfspMutation('OPS', crc.state.getEfspStrip(id), { kind: 'TransferStrip', toPositionId: 'AP', bayId: 'ap-departures', rackId: 'main' }), stripId);
    await expect.poll(() => page.evaluate((id) => crc.state.getEfspStrip(id).ownerPositionId, stripId)).toBe('AP');
    await page.evaluate(([id, a]) => crc.ws.sendEfspMutation('AP', crc.state.getEfspStrip(id), { kind: 'ApproveAirspaceEntry', airspaceId: a }), [stripId, airspaceId]);
    await expect.poll(() => page.evaluate((id) => (crc.state.getEfspStrip(id).airspaceEntry || {}).airspaceId || null, stripId), { timeout: 10000 }).toBe(airspaceId);

    await page.locator('#efsp-position-tabs .efsp-position-tab[data-position-id="AP"]').click();
    await page.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="ap-departures"]').click();
    const badge = () => stripByCallsign(page, callsign).locator('.efsp-airspace-badge');
    await expect(badge()).toBeVisible({ timeout: 5000 });
    await expect(badge(), 'approved early, not inside: grey').not.toHaveClass(/efsp-airspace-badge-unactivated/);
    await expect(badge()).toHaveClass(/efsp-ind-on/);

    const facilityId = await page.evaluate((id) => crc.state.getEfspStrip(id).facilityId, stripId);
    await page.evaluate(([f, s, a]) => {
      crc.state.applyEfspAlerts({ airspaceInside: [{ facilityId: f, stripId: s, airspaceId: a }] });
      crc.bayView.renderAllOpenEfspBays();
    }, [facilityId, stripId, airspaceId]);
    await expect(badge()).toHaveClass(/efsp-airspace-badge-unactivated/);
    await expect(badge()).toHaveClass(/efsp-ind-attn/);
    await expect(badge()).toHaveAttribute('title', `${name} is ${state}, not active`);

    await page.evaluate(() => { crc.state.applyEfspAlerts({ airspaceInside: [] }); crc.bayView.renderAllOpenEfspBays(); });
    await expect(badge()).not.toHaveClass(/efsp-airspace-badge-unactivated/);
  } finally {
    await dropStrips(page, [callsign]);
    await page.evaluate((id) => { const a = crc.state.getEfspAirspace(id); if (a) crc.ws.sendEfspAirspaceMutation('CTR', id, a.rev, { kind: 'DeleteAirspace' }, { baseDefRev: a.defRev }); }, airspaceId);
  }
});
