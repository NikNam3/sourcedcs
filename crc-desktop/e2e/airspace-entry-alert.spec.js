'use strict';

/* LT-AIRSPACE-ALERT (crc-sync docs/adr/0119).
 *
 * 1. The using agency approves entry, against the REAL crc-sync: OPS (Incirlik's using agency) approves and clears a
 *    flight AP holds into an airspace Incirlik uses, without holding AP; the server's ack and delta are what is checked.
 * 2. The alert's display: the rig has no DCS units, so crc-sync's monitor never sees an aircraft inside anything; the
 *    efsp-alerts frame is injected the way app.js applies it (l4-badges.spec.js's pattern), and the Strip chip, the ATC
 *    data block's amber SAA and its acknowledgement by a click are the app's own. Assert straight after injecting: the next
 *    real efsp-alerts from crc-sync replaces the injected state.
 * Run on E2E_LANE=3.
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

const stripOf = (page, callsign) => page.evaluate((cs) => {
  const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === cs);
  return s ? { stripId: s.stripId, ownerPositionId: s.ownerPositionId, entry: s.airspaceEntry ? s.airspaceEntry.airspaceId : null, flightDataId: s.flightDataId } : null;
}, callsign);

async function signOn(page, facilityId, positions) {
  await page.evaluate(([f, p]) => crc.ws.sendEfspSetPositions(f, p), [facilityId, positions]);
  await page.waitForFunction(([f, p]) => { const a = crc.ws.getAckedPositions(f); return a.length === p.length && p.every(x => a.includes(x)); }, [facilityId, positions]);
}

test('the using agency (OPS) approves and clears entry on a Strip AP holds, into an airspace Incirlik uses; GC may not', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS', 'AP', 'GC'] });
  await signOn(page, 'CENTER', ['CTR']); // CENTER controls the MOA (a using Facility is never the controlling one)
  await expect.poll(() => page.evaluate(() => crc.airspaceLayer.currentTheater()), { timeout: 20000 }).toBe('Syria');
  const n = uid();
  const airspaceId = `MOA-UA${n}`;
  const callsign = `UA${n}`.slice(0, 7);
  const created = await page.evaluate((id) => new Promise((resolve) => {
    crc.ws.sendEfspAirspaceMutation('CTR', id, 0, { kind: 'CreateAirspace', definition: {
      airspaceId: id, name: `Using ${id}`, kind: 'AREA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'INCIRLIK',
    } }, {}, { onAck: (ack) => { resolve({ ok: ack.ok, reason: ack.reason || null, detail: ack.detail || null }); return true; } });
    setTimeout(() => resolve(null), 8000);
  }), airspaceId);
  expect(created).toEqual({ ok: true, reason: null, detail: null });
  await expect.poll(() => page.evaluate((id) => !!crc.state.getEfspAirspace(id), airspaceId), { timeout: 10000 }).toBe(true);

  await seedStrip(page, { callsign, stripType: 'DEPARTURE' });
  let s = await stripOf(page, callsign);
  await page.evaluate((id) => crc.ws.sendEfspMutation('OPS', crc.state.getEfspStrip(id), { kind: 'SetState', toState: 'HANDED_OFF' }), s.stripId);
  await expect.poll(() => page.evaluate((id) => crc.state.getEfspStrip(id).state, s.stripId)).toBe('HANDED_OFF');
  await page.evaluate((id) => crc.ws.sendEfspMutation('OPS', crc.state.getEfspStrip(id), { kind: 'TransferStrip', toPositionId: 'AP', bayId: 'ap-departures', rackId: 'main' }), s.stripId);
  await expect.poll(() => stripOf(page, callsign).then(x => x.ownerPositionId)).toBe('AP');

  try {
    await signOn(page, 'INCIRLIK', ['OPS', 'GC']); // AP goes: OPS acts as the using agency, not as the Strip's holder
    const gc = await page.evaluate(([id, a]) => new Promise((resolve) => {
      crc.ws.sendEfspMutation('GC', crc.state.getEfspStrip(id), { kind: 'ApproveAirspaceEntry', airspaceId: a },
        { onAck: (ack) => { resolve({ ok: ack.ok, reason: ack.reason || null }); return true; } });
      setTimeout(() => resolve(null), 8000);
    }), [s.stripId, airspaceId]);
    expect(gc, 'GC has neither the op nor the using agency').toEqual({ ok: false, reason: 'PERMISSION_DENIED' });

    await page.evaluate(([id, a]) => crc.ws.sendEfspMutation('OPS', crc.state.getEfspStrip(id), { kind: 'ApproveAirspaceEntry', airspaceId: a }), [s.stripId, airspaceId]);
    await expect.poll(() => stripOf(page, callsign).then(x => x.entry), { timeout: 10000 }).toBe(airspaceId);
    s = await stripOf(page, callsign);
    expect(s.ownerPositionId, 'the approval moves the radio, never the Strip').toBe('AP');

    await page.evaluate((id) => crc.ws.sendEfspMutation('OPS', crc.state.getEfspStrip(id), { kind: 'ClearAirspaceEntry' }), s.stripId);
    await expect.poll(() => stripOf(page, callsign).then(x => x.entry), { timeout: 10000 }).toBe(null);
  } finally {
    await signOn(page, 'INCIRLIK', ['OPS', 'AP', 'GC']);
    await dropStrips(page, [callsign]);
    await page.evaluate((id) => { const a = crc.state.getEfspAirspace(id); if (a) crc.ws.sendEfspAirspaceMutation('CTR', id, a.rev, { kind: 'DeleteAirspace' }); }, airspaceId);
  }
});

test('an airspace-entry alert: an amber chip on the Strip, SAA on the data block blinking until clicked, gone when retracted', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS'] });
  const callsign = `SA${uid()}`.slice(0, 7);
  const strip = await seedStrip(page, { callsign, stripType: 'DEPARTURE' });
  try {
    const { flightDataId } = await stripOf(page, callsign);
    const alert = { id: `F:${flightDataId}:R-77`, kind: 'AIRSPACE_ENTRY', trackId: 'saa1', flightDataId, callsign,
      airspaceId: 'R-77', airspaceName: 'Restricted 77', airspaceType: 'RESTRICTED', since: 1 };
    const scope = await page.evaluate((a) => {
      const t = { id: 'saa1', domain: 'AIR', onGround: false, scheme: 'ATC', lat: 37.1, lon: 35.6, illuminatedAt: Date.now(),
        sources: ['PRIMARY', 'SSR'], label: { callsign: null, source: null, tag: null, trackNumber: 'T1' }, ssr: { code: '4521', ident: false, emergency: null },
        altitude: { ft: 12000, ref: 'QNH', source: 'MODE_C' }, dl: null, iffOverride: null };
      crc.picture.latestFromServer.set(t.id, t);
      crc.picture.tracks.set(t.id, t);
      crc.state.applyEfspAlerts({ conformance: [], conflictAlert: [], obligations: [], airspaceEntry: [a] });
      crc.bayView.renderAllOpenEfspBays();
      const line0 = (d) => d.view.line0.map(x => `${x.text}:${x.blink}:${x.color}`);
      const before = line0(crc.atc.atcDisplay(t.id, t));
      const click = crc.atc.atcTargetClick(t.id);
      const after = line0(crc.atc.atcDisplay(t.id, t));
      return { before, click, after, caution: crc.atc.atcPalette().caution };
    }, alert);
    await expect(strip.getByText('Airspace conflict Restricted 77')).toBeVisible({ timeout: 5000 });
    expect(scope.before).toEqual([`SAA:true:${scope.caution}`]);
    expect(scope.click).toBe('ACK_AIRSPACE');
    expect(scope.after).toEqual([`SAA:false:${scope.caution}`]);

    await page.evaluate(() => { crc.state.applyEfspAlerts({ conformance: [], conflictAlert: [], obligations: [], airspaceEntry: [] }); crc.bayView.renderAllOpenEfspBays(); });
    await expect(stripByCallsign(page, callsign).getByText('Airspace conflict Restricted 77')).toHaveCount(0);
  } finally {
    await dropStrips(page, [callsign]);
  }
});
