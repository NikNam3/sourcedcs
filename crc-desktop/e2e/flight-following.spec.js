'use strict';

/* LT-VFR (crc-sync H136): flight following on a contact with no Strip. "Start flight following" in the track panel makes
 * an OVERFLIGHT Strip IN_SECTOR with a discrete code, bound to the contact; entry into active airspace is approved on it;
 * "Radar service terminated" drops it (code released, contact untracked); Undo of the start takes it all back.
 * The contact is injected client side: the harness has no DCS, so crc-sync's reconciler will find no such contact and
 * leave the record UNCORRELATED with its binding kept. The specs read the binding, which is what the action makes. */

const { test, expect } = require('./helpers/test');
const { openPanel, stripByCallsign, startAction, dropStrips } = require('./helpers/app');
const { startFakeDcs, fakeDcsPort } = require('./helpers/fake-dcs');

test.describe.configure({ timeout: 60000 });
test.use({ viewport: { width: 1500, height: 1000 } });

// crc-sync scopes the airspace registry to the loaded mission's theater; the harness has no DCS, so this file starts the
// fake one (helpers/fake-dcs.js: GetTheatre "Syria", no units) as airspace-server.spec.js does.
const LANE = Number(process.env.E2E_LANE || 0);
let fake;
test.beforeAll(async () => { fake = await startFakeDcs(fakeDcsPort(3010 + LANE)); });
test.afterAll(async () => { if (fake) await fake.stop(); });

let seq = 0;
const uniqueCallsign = (prefix) => `${prefix}${(Date.now() + seq++) % 10000}`;

async function contact(page, tid) {
  await page.evaluate((id) => {
    const t = { id, domain: 'AIR', lon: 35.6, lat: 37.1, label: { callsign: null, source: null, trackNumber: `T${id}` },
      altitude: null, ssr: null, illuminatedAt: Date.now() };
    crc.picture.latestFromServer.set(id, t);
    crc.picture.tracks.set(id, t);
    crc.trackPanel.showTrackPanel(id);
  }, tid);
}

const recordFor = (page, callsign) => page.evaluate((cs) => {
  const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === cs);
  if (!s) return null;
  const fd = crc.state.getEfspFlightData(s.flightDataId);
  const c = crc.state.getEfspCorrelation(s.flightDataId);
  return { stripType: s.stripType, state: s.state, bayId: s.bayId, code: fd.identity.beaconAssigned, flightDataId: s.flightDataId,
    boundTo: c && c.binding ? c.binding.trackId : null, entry: s.airspaceEntry ? s.airspaceEntry.airspaceId : null };
}, callsign);
const bindingOf = (page, flightDataId) => page.evaluate((id) => {
  const c = crc.state.getEfspCorrelation(id);
  return c && c.binding ? c.binding.trackId : null;
}, flightDataId);

// The track panel shares the dock group with the Strip panel: bring the Strips back to the front.
const showStrips = (page) => page.evaluate(() => crc.dock.dock.api.getPanel('efsp').api.setActive());

async function start(page, tid, callsign, type = 'C172') {
  await contact(page, tid);
  const section = page.locator('#tp-ff-section');
  await expect(section, 'offered on a contact with no Strip').toBeVisible();
  await page.locator('#tp-ff-callsign').fill(callsign);
  await page.locator('#tp-ff-type').fill(type);
  await page.locator('#tp-ff-start').click();
  await expect.poll(() => recordFor(page, callsign)).not.toBe(null);
  // The harness picture drops the injected contact at its next frame: put it back, then the panel refreshes.
  await contact(page, tid);
  await expect(section, 'gone once the contact is the Strip\'s').toBeHidden();
  await showStrips(page);
}

test('start flight following on a contact: an OVERFLIGHT Strip IN_SECTOR, a discrete code, bound; then radar service terminated', async ({ page }) => {
  await openPanel(page, { signedOn: ['CTR'], facilityId: 'CENTER', controller: 'lt-vfr-1' });
  const callsign = uniqueCallsign('VF');
  const tid = `lt-vfr-${Date.now() % 100000}`;
  await start(page, tid, callsign);
  const r = await recordFor(page, callsign);
  expect(r).toMatchObject({ stripType: 'OVERFLIGHT', state: 'IN_SECTOR', bayId: 'ctr-overflight', boundTo: tid });
  expect(r.code).toMatch(/^[0-7]{4}$/);
  await page.screenshot({ path: test.info().outputPath('01-started.png') });

  // Radar service terminated from the ⋯ menu: dropped, code released, the binding ended.
  await page.locator('#efsp-position-tabs .efsp-position-tab[data-position-id="CTR"]').click();
  await page.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="ctr-overflight"]').click();
  await startAction(stripByCallsign(page, callsign), 'Radar service terminated');
  await expect.poll(() => recordFor(page, callsign)).toBe(null);
  await expect.poll(() => bindingOf(page, r.flightDataId)).toBe(null);
  const codeHolder = await page.evaluate((code) => crc.state.getAllEfspStrips()
    .some(s => s.state !== 'DROPPED' && (crc.state.getEfspFlightData(s.flightDataId) || { identity: {} }).identity.beaconAssigned === code), r.code);
  expect(codeHolder, 'no live Strip holds the code').toBe(false);
  // The contact is untracked again: the offer is back.
  await contact(page, tid);
  await expect(page.locator('#tp-ff-section')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('02-terminated.png') });
  await showStrips(page);
});

test('a second Start on a contact already bound is refused, naming the flight', async ({ page, browser }) => {
  await openPanel(page, { signedOn: ['CTR'], facilityId: 'CENTER', controller: 'lt-vfr-2' });
  const callsign = uniqueCallsign('VF');
  const tid = `lt-vfr-${Date.now() % 100000}`;
  await start(page, tid, callsign);
  // Another controller (AP) has not seen the binding yet: force the offer and press.
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1500, height: 1000 } });
  try {
    const ap = await ctx.newPage();
    await openPanel(ap, { signedOn: ['AP'], facilityId: 'INCIRLIK', controller: 'lt-vfr-2b' });
    const sent = await ap.evaluate(([id, cs]) => new Promise((resolve) => {
      crc.ws.sendEfspCreateStrip('AP', { kind: 'StartFlightFollowing', trackId: id, flightData: { callsign: cs, aircraftData: 'C172' } }, 'INCIRLIK', { onAck: (ack) => { resolve(ack); return true; } });
    }), [tid, uniqueCallsign('VX')]);
    expect(sent.ok).toBe(false);
    expect(sent.detail).toContain(`already correlated to ${callsign}`);
  } finally { await ctx.close(); }
  await dropStrips(page, [callsign]);
});

test('approve entry into active airspace on a flight-following Strip, and Undo of the start takes it all back', async ({ page }) => {
  await openPanel(page, { signedOn: ['CTR'], facilityId: 'CENTER', controller: 'lt-vfr-3' });
  const callsign = uniqueCallsign('VF');
  const tid = `lt-vfr-${Date.now() % 100000}`;
  await start(page, tid, callsign);
  const r = await recordFor(page, callsign);
  await expect(page.locator('#efsp-undo-slot button')).toContainText(`Flight following ${callsign}`);

  // Undo of the start: the Strip goes, the binding ends.
  await page.locator('#efsp-dot-command-input').fill('.undo');
  await page.locator('#efsp-dot-command-input').press('Enter');
  await expect.poll(() => recordFor(page, callsign)).toBe(null);
  await expect.poll(() => bindingOf(page, r.flightDataId)).toBe(null);
  await page.screenshot({ path: test.info().outputPath('03-undone.png') });

  // Start again and approve entry into an airspace CTR controls, from the Strip's ⋯ menu (today's rights, H136 VQ5 a;
  // the alert by airspace type is LT-AIRSPACE-ALERT's). crc-sync scopes the registry to the loaded theater: the fake DCS.
  await expect.poll(() => page.evaluate(() => crc.airspaceLayer.currentTheater()), { timeout: 20000 }).toBe('Syria');
  const airspaceId = `MOA-FF${Date.now() % 1000}`;
  await page.evaluate((id) => crc.ws.sendEfspAirspaceMutation('CTR', id, 0,
    { kind: 'CreateAirspace', definition: { airspaceId: id, name: `MOA ${id}`, kind: 'AREA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR' } }), airspaceId);
  await expect.poll(() => page.evaluate((id) => !!crc.state.getEfspAirspace(id), airspaceId)).toBe(true);
  await start(page, tid, callsign);
  await page.locator('#efsp-position-tabs .efsp-position-tab[data-position-id="CTR"]').click();
  await page.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="ctr-overflight"]').click();
  await startAction(stripByCallsign(page, callsign), 'Airspace…');
  await page.locator('[data-testid="airspace-entry-airspace"]').selectOption(airspaceId);
  await page.locator('.efsp-coordinate-send-btn', { hasText: 'Approve entry' }).click();
  await expect.poll(async () => (await recordFor(page, callsign)).entry).toBe(airspaceId);
  await page.screenshot({ path: test.info().outputPath('04-entry-approved.png') });

  // Radar service terminated clears the entry with the Strip.
  await startAction(stripByCallsign(page, callsign), 'Radar service terminated');
  await expect.poll(() => recordFor(page, callsign)).toBe(null);
  const after = await page.evaluate((id) => crc.state.getEfspFlightData(id), r.flightDataId);
  expect(after ? after.comms.airspaceId : null, 'the entry is cleared').toBe(null);
  await dropStrips(page, [callsign]);
});
