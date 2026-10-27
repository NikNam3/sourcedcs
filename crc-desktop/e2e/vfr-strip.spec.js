'use strict';

/* U-VFR-REDO (crc-sync docs/adr/0146, H174, H175): the minimal VFR strip. A controller tags a contact with no strip (the
 * track panel, or the data block's menu): a VFR strip TRACKED in the Position's VFR Bay, no code unless asked, bound to the
 * contact. The strip says VFR (tab VFR · TRACKED, altitude cell VFR or VFR/045). From the data block's menu the holder
 * assigns ALT/HDG/SPEED, gives a code, hands it off (the receiver accepts), and terminates radar service. CD has no VFR
 * form any more.
 * The contact is injected client side: the harness has no DCS, so crc-sync's reconciler leaves the record UNCORRELATED
 * with its binding kept; the menu's tests correlate it client-side as u-label-menu.spec.js does. */

const { test, expect } = require('./helpers/test');
const { openPanel, stripByCallsign, startAction, dropStrips } = require('./helpers/app');

test.describe.configure({ timeout: 60000 });
test.use({ viewport: { width: 1500, height: 1000 } });

let seq = 0;
const uniqueCallsign = (prefix) => `${prefix}${(Date.now() + seq++) % 10000}`;

async function contact(page, tid, { panel = true } = {}) {
  await page.evaluate(([id, open]) => {
    const t = { id, domain: 'AIR', lon: 35.6, lat: 37.1, label: { callsign: null, source: null, trackNumber: `T${id}` },
      altitude: null, ssr: null, illuminatedAt: Date.now() };
    crc.picture.latestFromServer.set(id, t);
    crc.picture.tracks.set(id, t);
    if (open) crc.trackPanel.showTrackPanel(id);
  }, [tid, panel]);
}

const recordFor = (page, callsign) => page.evaluate((cs) => {
  const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === cs);
  if (!s) return null;
  const fd = crc.state.getEfspFlightData(s.flightDataId);
  const c = crc.state.getEfspCorrelation(s.flightDataId);
  const alt = (fd.clearance.altitude.entries || []).find(e => e.status === 'ACTIVE');
  return { stripId: s.stripId, stripType: s.stripType, state: s.state, bayId: s.bayId, owner: s.ownerPositionId, code: fd.identity.beaconAssigned,
    flightDataId: s.flightDataId, boundTo: c && c.binding ? c.binding.trackId : null, handoffTo: s.vfrHandoff ? s.vfrHandoff.toPositionId : null,
    alt: alt ? alt.value : null };
}, callsign);

const showStrips = (page) => page.evaluate(() => crc.dock.dock.api.getPanel('efsp').api.setActive());

/** Tags the contact from the track panel (callsign only: the type is optional). */
async function tag(page, tid, callsign) {
  await contact(page, tid);
  const section = page.locator('#tp-ff-section');
  await expect(section, 'offered on a contact with no strip').toBeVisible();
  await expect(section).toContainText('Tag VFR');
  await page.locator('#tp-ff-callsign').fill(callsign);
  await page.locator('#tp-ff-start').click();
  await expect.poll(() => recordFor(page, callsign)).not.toBe(null);
  await contact(page, tid);
  await expect(section, 'gone once the contact is the strip\'s').toBeHidden();
  await showStrips(page);
}

/** The contact correlated client-side to the flight (the rig has no DCS), so the data block's menu finds its strip. */
async function correlate(page, callsign, tid) {
  await page.evaluate(([cs, id]) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs);
    crc.state.applyEfspCorrelationDelta({ correlations: { updated: [{
      flightDataId: s.flightDataId, rev: 99, state: 'CORRELATED', trackId: id, matchedBy: 'BINDING', confidence: null,
      binding: { trackId: id }, warning: null, observedBeacon: null, transitions: [],
    }] } });
  }, [callsign, tid]);
}

/** Opens the contact's data-block menu; the correlation is put back first (crc-sync's own sweep sends UNCORRELATED here). */
async function openMenu(page, tid, callsign) {
  await contact(page, tid, { panel: false });
  await correlate(page, callsign, tid);
  return page.evaluate((id) => crc.labelMenu.openLabelMenu(id, 400, 300), tid);
}

test('tag a contact at AP: a VFR strip TRACKED, no code, bound; the strip says VFR', async ({ page }) => {
  await openPanel(page, { signedOn: ['AP'], facilityId: 'INCIRLIK', controller: 'vfr-1' });
  const callsign = uniqueCallsign('VF');
  const tid = `vfr-${Date.now() % 100000}`;
  await tag(page, tid, callsign);
  const r = await recordFor(page, callsign);
  expect(r).toMatchObject({ stripType: 'VFR', state: 'TRACKED', bayId: 'ap-overflight', owner: 'AP', boundTo: tid, code: null });
  await page.locator('#efsp-position-tabs .efsp-position-tab[data-position-id="AP"]').click();
  await page.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="ap-overflight"]').click();
  const strip = stripByCallsign(page, callsign);
  await expect(strip).toContainText('VFR · TRACKED');
  await expect(strip.locator('.efsp-block-7A')).toHaveText('VFR');
  for (const absent of ['.efsp-block-9', '.efsp-block-8B', '.efsp-block-14A', '.efsp-block-14D']) await expect(strip.locator(absent)).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('01-tagged.png') });
  await dropStrips(page, [callsign]);
});

test('the data block\'s menu: ALT, a code, the handoff the receiver accepts, and radar service terminated', async ({ page }) => {
  await openPanel(page, { signedOn: ['AP', 'LC'], facilityId: 'INCIRLIK', controller: 'vfr-2' });
  const callsign = uniqueCallsign('VF');
  const tid = `vfr-${Date.now() % 100000}`;
  await tag(page, tid, callsign);

  // ALT on the menu: the strip's clearance cell. The face reads VFR/045.
  expect(await openMenu(page, tid, callsign)).toBe(true);
  const menu = page.locator('.label-menu');
  await menu.locator('input[data-field="altitude"]').fill('045');
  await menu.locator('input[data-field="altitude"]').press('Enter');
  await expect.poll(async () => (await recordFor(page, callsign)).alt).toBe('045');
  await page.locator('#efsp-position-tabs .efsp-position-tab[data-position-id="AP"]').click();
  await page.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="ap-overflight"]').click();
  await expect(stripByCallsign(page, callsign).locator('.efsp-block-7A')).toHaveText('VFR/045');

  // CODE: a discrete code, only while it has none.
  await openMenu(page, tid, callsign);
  await menu.locator('.label-menu-code').click();
  await expect.poll(async () => (await recordFor(page, callsign)).code).toMatch(/^[0-7]{4}$/);
  await openMenu(page, tid, callsign);
  await expect(menu.locator('.label-menu-code')).toHaveCount(0);

  // The handoff: HO LC; the strip stays AP's and says HO LC; LC accepts from the same menu.
  await menu.locator('.label-menu-handoff', { hasText: 'HO LC' }).click();
  await expect.poll(async () => (await recordFor(page, callsign)).handoffTo).toBe('LC');
  expect((await recordFor(page, callsign)).owner).toBe('AP');
  await expect(stripByCallsign(page, callsign).locator('.efsp-vfr-handoff-mark')).toHaveText('HO LC');
  await page.screenshot({ path: test.info().outputPath('02-handoff-initiated.png') });
  await openMenu(page, tid, callsign);
  await menu.locator('.label-menu-accept').click();
  await expect.poll(() => recordFor(page, callsign)).toMatchObject({ owner: 'LC', bayId: 'lc-runway-queue', handoffTo: null });

  // Radar service terminated, by the new holder.
  await openMenu(page, tid, callsign);
  await menu.locator('.label-menu-terminate').click();
  await expect.poll(() => recordFor(page, callsign)).toBe(null);
});

test('a second tag on a contact already tagged is refused, naming the flight; CD has no VFR form', async ({ page, browser }) => {
  await openPanel(page, { signedOn: ['AP'], facilityId: 'INCIRLIK', controller: 'vfr-3' });
  const callsign = uniqueCallsign('VF');
  const tid = `vfr-${Date.now() % 100000}`;
  await tag(page, tid, callsign);
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1500, height: 1000 } });
  try {
    const gc = await ctx.newPage();
    await openPanel(gc, { signedOn: ['GC', 'CD'], facilityId: 'INCIRLIK', controller: 'vfr-3b' });
    const sent = await gc.evaluate(([id, cs]) => new Promise((resolve) => {
      crc.ws.sendEfspCreateStrip('GC', { kind: 'StartFlightFollowing', trackId: id, flightData: { callsign: cs, aircraftData: '' } }, 'INCIRLIK', { onAck: (ack) => { resolve(ack); return true; } });
    }), [tid, uniqueCallsign('VX')]);
    expect(sent.ok).toBe(false);
    expect(sent.detail).toContain(`already tagged as ${callsign}`);
    await expect(gc.locator('#efsp-vfr-departure-btn')).toHaveCount(0);
  } finally { await ctx.close(); }
  await dropStrips(page, [callsign]);
});

test('the keyboard path: .ff <track> <CALLSIGN> tags the contact, .term ends it on the selected strip', async ({ page }) => {
  await openPanel(page, { signedOn: ['AP'], facilityId: 'INCIRLIK', controller: 'vfr-4' });
  const callsign = uniqueCallsign('VF');
  const tid = `vfr-${Date.now() % 100000}`;
  await contact(page, tid);
  await showStrips(page);
  const input = page.locator('#efsp-dot-command-input');
  await input.fill(`.ff T${tid} ${callsign}`);
  await page.evaluate((id) => crc.picture.latestFromServer.set(id, { id, domain: 'AIR', lon: 35.6, lat: 37.1,
    label: { callsign: null, source: null, trackNumber: `T${id}` }, altitude: null, ssr: null, illuminatedAt: Date.now() }), tid);
  await input.press('Enter');
  await expect.poll(() => recordFor(page, callsign)).toMatchObject({ stripType: 'VFR', state: 'TRACKED', boundTo: tid });
  await page.evaluate((cs) => {
    const s = crc.state.getAllEfspStrips().find((x) => x.state !== 'DROPPED' && crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs);
    crc.selection.selectEfspStripById(s.stripId);
  }, callsign);
  await input.fill('.term');
  await input.press('Enter');
  await expect.poll(() => recordFor(page, callsign)).toBe(null);
});

test('IFR cancelled on an IFR strip makes it a VFR strip in place; IFR → Overflight takes it back', async ({ page }) => {
  await openPanel(page, { signedOn: ['AP'], facilityId: 'INCIRLIK', controller: 'vfr-5' });
  const callsign = uniqueCallsign('VF');
  const tid = `vfr-${Date.now() % 100000}`;
  await tag(page, tid, callsign);
  const before = await recordFor(page, callsign);
  await page.locator('#efsp-position-tabs .efsp-position-tab[data-position-id="AP"]').click();
  await page.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="ap-overflight"]').click();
  await startAction(stripByCallsign(page, callsign), 'IFR → Overflight');
  await expect.poll(() => recordFor(page, callsign)).toMatchObject({ stripId: before.stripId, stripType: 'OVERFLIGHT', boundTo: tid });
  expect((await recordFor(page, callsign)).code).toMatch(/^[0-7]{4}$/);
  await startAction(stripByCallsign(page, callsign), 'IFR cancelled → VFR');
  await expect.poll(() => recordFor(page, callsign)).toMatchObject({ stripId: before.stripId, stripType: 'VFR', state: 'TRACKED' });
  await dropStrips(page, [callsign]);
});
