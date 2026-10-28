'use strict';

/* U-MOA (crc-sync docs/adr/0124).
 *
 * 1. The airspace card's flight list, against the REAL crc-sync: CTR (CENTER) controls a MOA Incirlik uses; AP holds a
 *    flight whose filed route crosses it (crc-sync docs/adr/0128 §5: route geometry, here Incirlik's ICAO and a ROUTE fix;
 *    the name match is gone, H151 MT-Q6 c). OPS (the using agency, not holding AP) opens the card, sees the flight with
 *    Approve, presses it; the Strip is approved into the MOA (the server's delta) and the row turns grey "approved".
 *    The rig has no DCS units, so "inside" and the alert cannot come from crc-sync's monitor: the amber row is checked
 *    by injecting an efsp-alerts frame (airspace-entry-alert.spec.js's pattern); the monitor's own inside/alert/clear
 *    rules are unit tests (crc-sync tests/airspace-card-traffic.test.mjs, airspace-entry-alert.test.mjs).
 * 2. MARSA in a MOA: two Strips declare a LOCAL_DECLARATION MARSA, an altitude (Block 21) is assigned to one, the MARSA stays ACTIVE.
 * Run on E2E_LANE=9.
 */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, dropStrips } = require('./helpers/app');
const { startFakeDcs, fakeDcsPort } = require('./helpers/fake-dcs');

test.describe.configure({ timeout: 90000 });

const LANE = Number(process.env.E2E_LANE || 0);
let fake;
test.beforeAll(async () => { fake = await startFakeDcs(fakeDcsPort(3010 + LANE)); });
test.afterAll(async () => { if (fake) await fake.stop(); });

let seq = 0;
const uid = () => String((Date.now() + seq++) % 100000);

const stripOf = (page, callsign) => page.evaluate((cs) => {
  const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === cs);
  return s ? { stripId: s.stripId, ownerPositionId: s.ownerPositionId, entry: s.airspaceEntry ? s.airspaceEntry.airspaceId : null, flightDataId: s.flightDataId } : null;
}, callsign);

async function signOn(page, facilityId, positions) {
  await page.evaluate(([f, p]) => crc.ws.sendEfspSetPositions(f, p), [facilityId, positions]);
  await page.waitForFunction(([f, p]) => { const a = crc.ws.getAckedPositions(f); return a.length === p.length && p.every(x => a.includes(x)); }, [facilityId, positions]);
}

test('OPS approves AP\'s flight from the MOA card: Approve, then grey "approved"; an alerting row is amber', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS', 'AP'] });
  await signOn(page, 'CENTER', ['CTR']);
  await expect.poll(() => page.evaluate(() => crc.airspaceLayer.currentTheater()), { timeout: 20000 }).toBe('Syria');
  const n = uid();
  const airspaceId = `MOA-UM${n}`;
  const callsign = `UM${n}`.slice(0, 7);
  const routeId = `IR-UM${n}`;
  const fix = `F${n}`;
  const create = (definition) => page.evaluate((d) => new Promise((resolve) => {
    crc.ws.sendEfspAirspaceMutation('CTR', d.airspaceId, 0, { kind: 'CreateAirspace', definition: d },
      {}, { onAck: (ack) => { resolve({ ok: ack.ok, reason: ack.reason || null }); return true; } });
    setTimeout(() => resolve(null), 8000);
  }), definition);
  // A ROUTE whose first fix lies south of the MOA, which lies south of Incirlik (37.0N 35.42E): LTAG -> fix crosses it.
  expect(await create({ airspaceId: routeId, name: `Route ${routeId}`, kind: 'ROUTE', type: 'IR', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR',
    defaultWidthNm: 4, segments: [{ fix: { name: fix, lat: 36.0, lon: 35.42 } }, { fix: { name: `G${n}`, lat: 35.8, lon: 35.42 } }] })).toEqual({ ok: true, reason: null });
  expect(await create({ airspaceId, name: `Moa ${airspaceId}`, kind: 'AREA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'INCIRLIK',
    geometry: { source: 'POLYGON', points: [[36.3, 35.2], [36.3, 35.6], [36.7, 35.6], [36.7, 35.2]] } })).toEqual({ ok: true, reason: null });

  await seedStrip(page, { callsign, stripType: 'DEPARTURE', flightData: { route: `LTAG DCT ${fix}` } });
  const s = await stripOf(page, callsign);
  await page.evaluate((id) => crc.ws.sendEfspMutation('OPS', crc.state.getEfspStrip(id), { kind: 'SetState', toState: 'HANDED_OFF' }), s.stripId);
  await expect.poll(() => page.evaluate((id) => crc.state.getEfspStrip(id).state, s.stripId)).toBe('HANDED_OFF');
  await page.evaluate((id) => crc.ws.sendEfspMutation('OPS', crc.state.getEfspStrip(id), { kind: 'TransferStrip', toPositionId: 'AP', bayId: 'ap-departures', rackId: 'main' }), s.stripId);
  await expect.poll(() => stripOf(page, callsign).then(x => x.ownerPositionId)).toBe('AP');

  try {
    await signOn(page, 'INCIRLIK', ['OPS']); // OPS acts as the using agency, not as the Strip's holder
    await page.evaluate(() => { if (!crc.dock.isDockPanelOpen('airspace')) crc.dock.toggleDockPanel('airspace', true); });
    await expect(page.locator('#airspace-panel')).toBeVisible({ timeout: 10000 });
    const allBtn = page.locator('.airspace-seg-btn[data-filter="all"]');
    if (await allBtn.isEnabled()) await allBtn.click();
    const card = page.locator(`.airspace-card[data-airspace-id="${airspaceId}"]`);
    const row = card.locator('.airspace-entry-row', { hasText: callsign });
    await expect(row, 'filed through: listed for the using agency').toBeVisible({ timeout: 15000 });
    await expect(row.locator('.airspace-entry-why')).toHaveText('filed');
    await expect(row).not.toHaveClass(/airspace-entry-alerting/);

    await row.locator('.airspace-entry-approve-btn').click();
    await expect.poll(() => stripOf(page, callsign).then(x => x.entry), { timeout: 10000 }).toBe(airspaceId);
    expect((await stripOf(page, callsign)).ownerPositionId, 'the approval never moves the Strip').toBe('AP');
    await expect(row, 'approved: grey, no button').toHaveClass(/airspace-entry-approved/, { timeout: 10000 });
    await expect(row.locator('.airspace-entry-approve-btn')).toHaveCount(0);
    await expect(row.locator('.airspace-entry-state')).toHaveText('approved');

    // The amber row: what crc-sync sends for a flight inside unapproved (no DCS units on the rig, so injected).
    await page.evaluate(([id, fd, cs, stripId]) => {
      crc.msgRegistry.dispatchEfspMessage({ version: 1, type: 'efsp-alerts', conformance: [], conflictAlert: [], obligations: [], surveillance: [], tofiRegime: [],
        airspaceEntry: [], airspaceTraffic: [{ airspaceId: id, flights: [{ flightDataId: fd, callsign: cs, inside: true, filed: true, approved: false, alerting: true,
          strips: [{ facilityId: 'INCIRLIK', stripId, positionId: 'AP' }] }] }] });
    }, [airspaceId, s.flightDataId, callsign, s.stripId]);
    await expect(row).toHaveClass(/airspace-entry-alerting/);
    await expect(row.locator('.airspace-entry-why')).toHaveText('inside · filed');
    await expect(row.locator('.airspace-entry-approve-btn')).toHaveCount(1);
  } finally {
    await signOn(page, 'INCIRLIK', ['OPS', 'AP']);
    await dropStrips(page, [callsign]);
    for (const id of [airspaceId, routeId]) {
      await page.evaluate((x) => { const a = crc.state.getEfspAirspace(x); if (a) crc.ws.sendEfspAirspaceMutation('CTR', x, a.rev, { kind: 'DeleteAirspace' }, { baseDefRev: a.defRev }); }, id);
    }
  }
});

test('a Position that may not approve entry sees no flight list on the card', async ({ page }) => {
  await openPanel(page, { signedOn: ['GC'] });
  await page.evaluate(() => { if (!crc.dock.isDockPanelOpen('airspace')) crc.dock.toggleDockPanel('airspace', true); });
  await expect(page.locator('#airspace-panel')).toBeVisible({ timeout: 10000 });
  // The server sends GC no list (crc-sync's trafficFor; unit-tested), and with none the block is absent.
  await expect(page.locator('.airspace-entry-list')).toHaveCount(0);
});

test('MARSA in a MOA: a local declaration survives an altitude assignment (H141 U-RQ6 a)', async ({ page }) => {
  await openPanel(page);
  const a = `MA${uid()}`.slice(0, 7);
  const b = `MB${uid()}`.slice(0, 7);
  await seedStrip(page, { callsign: a, stripType: 'DEPARTURE' });
  await seedStrip(page, { callsign: b, stripType: 'DEPARTURE' });
  const relationState = () => page.evaluate((cs) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs);
    const r = s && crc.state.marsaForStrip(s);
    return r ? r.state : null;
  }, a);
  try {
    await page.evaluate(([csA, csB]) => {
      const byCs = (cs) => crc.state.getAllEfspStrips().find(s => s.state !== 'DROPPED' && crc.state.getEfspFlightData(s.flightDataId).identity.callsign === cs);
      crc.ws.sendEfspMarsaMutation('OPS', undefined, undefined, {
        kind: 'DeclareMarsa', participants: [byCs(csA).flightDataId, byCs(csB).flightDataId],
        startEvent: 'LOCAL_DECLARATION', endCondition: 'ATC_SEPARATION_ESTABLISHED', declaringCallsign: csA,
      });
    }, [a, b]);
    await expect.poll(relationState).toBe('ACTIVE');
    const assign = (value) => page.evaluate(([cs, v]) => new Promise((resolve) => {
      const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs);
      crc.ws.sendEfspMutation('OPS', s, { kind: 'SetBlock', blockId: '21', value: v }, { onAck: (m) => { resolve({ ok: m.ok, reason: m.reason || null }); return true; } });
      setTimeout(() => resolve(null), 8000);
    }), [a, value]);
    expect(await assign('5000')).toEqual({ ok: true, reason: null });
    // A second acked assignment on the same socket: any marsa void from the first has been delivered by its ack.
    expect(await assign('6000')).toEqual({ ok: true, reason: null });
    expect(await relationState(), 'no rendezvous to wait for: the MARSA stands').toBe('ACTIVE');
  } finally {
    await dropStrips(page, [a, b]);
  }
});
