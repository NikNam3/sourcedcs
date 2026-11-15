'use strict';

/* U-LABEL-REMARKS (docs/adr/0165): the owned Strip's remarks are the data block's last line, first 20 characters, in
 * their own colour (lavender unless Settings says otherwise); another Position's flight shows none. The Highlight
 * popover offers eight swatches and a #RRGGBB box that refuses red (ATTENTION's).
 *
 * The Strip is a real one on the harness crc-sync; the contact and its correlation are injected client-side, as
 * u-scope-gestures.spec.js does. Not run by the lane (lane rule 7): the supervisor runs it.
 */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, stripByCallsign, dropStrips } = require('./helpers/app');

test.describe.configure({ timeout: 60000 });

let seq = 0;
const uniqueCallsign = (prefix) => `${prefix}${(Date.now() + seq++) % 10000}`;
const CONTACT = { lat: 37.30, lon: 35.90 };

async function putContact(page, callsign, trackId) {
  await page.evaluate(([cs, tid, c]) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs);
    crc.app.applySnapshot([{
      id: tid, ...c, domain: 'AIR', onGround: false, illuminatedAt: Date.now(), sources: ['PRIMARY', 'SSR'], iffState: 'neutral', iffOverride: null,
      label: { callsign: cs, source: 'FLIGHT_DATA', tag: null, trackNumber: `T${tid}` }, type: 'F16',
      ssr: { code: '4521', ident: false, emergency: null }, altitude: { ft: 12000, ref: 'QNH', source: 'MODE_C' }, dl: null, scheme: 'TACTICAL',
    }]);
    crc.state.applyEfspCorrelationDelta({ correlations: { updated: [{
      flightDataId: s.flightDataId, rev: 99, state: 'CORRELATED', trackId: tid, matchedBy: 'BINDING', confidence: null,
      binding: null, warning: null, observedBeacon: null, transitions: [],
    }] } });
    crc.picture.labelOffsets.clear();
    crc.mapHandle.map.jumpTo({ center: [c.lon, c.lat], zoom: 9 });
    crc.geojson.updateMap();
  }, [callsign, trackId, CONTACT]);
}

const labelProps = (page, tid) => page.evaluate((id) => {
  const f = crc.geojson.buildLabels().features.find(x => String(x.properties.id) === id);
  return f ? f.properties : null;
}, tid);

test('the owned Strip\'s remarks end the tactical label, cut to 20 characters, lavender; Settings changes the colour', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS'] });
  const callsign = uniqueCallsign('RMK');
  await seedStrip(page, { callsign, flightData: { remarks: 'NORDO  WATCH FOR LIGHT GUN' } });
  try {
    await putContact(page, callsign, 'ulr-1');
    await expect.poll(async () => (await labelProps(page, 'ulr-1') || {}).rmkLine).toBe('NORDO WATCH FOR LIGH');
    expect((await labelProps(page, 'ulr-1')).rmkColor).toBe('#c49cff');
    await page.evaluate(() => { crc.settings.settings.colRemarks = '#00e0a0'; });
    await expect.poll(async () => (await labelProps(page, 'ulr-1')).rmkColor).toBe('#00e0a0');
    await page.evaluate(() => { delete crc.settings.settings.colRemarks; });
    // The wider block grows away from its track: nudged right, the leader still ends clear of it.
    const offset = (await labelProps(page, 'ulr-1')).textOffset;
    expect(offset[0]).toBeGreaterThan(0);
    await page.screenshot({ path: test.info().outputPath('remarks-label.png') });
  } finally {
    await dropStrips(page, [callsign]);
  }
});

test('a flight another Position owns shows no remarks on this scope', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS', 'GC'] });
  const callsign = uniqueCallsign('RMO');
  await seedStrip(page, { callsign, flightData: { remarks: 'VIP' } });
  try {
    await page.evaluate(() => crc.ws.sendEfspSetPositions('INCIRLIK', ['GC']));
    await putContact(page, callsign, 'ulr-2');
    await expect.poll(async () => (await labelProps(page, 'ulr-2') || {}).rmkLine).toBe('');
  } finally {
    await page.evaluate(() => crc.ws.sendEfspSetPositions('INCIRLIK', ['OPS']));
    await dropStrips(page, [callsign]);
  }
});

test('the Highlight popover: eight swatches, a #RRGGBB box, red refused with a line saying why', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS'] });
  const callsign = uniqueCallsign('HLP');
  const strip = await seedStrip(page, { callsign });
  try {
    await strip.locator('.efsp-strip-tab-type').click({ button: 'right' });
    const pop = page.locator('.efsp-highlight-popover');
    await expect(pop.locator('.efsp-highlight-swatch:not(.efsp-highlight-off)')).toHaveCount(8);
    const hex = pop.locator('input.efsp-highlight-hex');
    await hex.fill('#e02020');
    await hex.press('Enter');
    await expect(pop.locator('.efsp-highlight-error')).toHaveText(/ATTENTION/);
    await hex.fill('#40c0a0');
    await hex.press('Enter');
    await expect(pop).toHaveCount(0);
    await expect.poll(() => stripByCallsign(page, callsign).evaluate(el => el.style.getPropertyValue('--efsp-highlight'))).toBe('#40c0a0');
  } finally {
    await dropStrips(page, [callsign]);
  }
});
