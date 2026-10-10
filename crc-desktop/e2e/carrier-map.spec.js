'use strict';

/* The CARRIER MAP panel (docs/wip/CARRIER-MAP.md; mockup docs/mockups/carrier-map-panel.html, revision 5; decisions H119, S-ARCH-36,
 * H121). The harness has no DCS, so there is no ship and no radar contact: the spec puts a ship under every carrier frame (an EFSP
 * message observer rewrites the hull view's ship and bearings, which is all the server lacks) and places contacts and their
 * correlations in the client's picture. Everything else is the real server: the Strips, their states, the Case, the stack, the
 * tanker. One controller signed on as the Marshal, both approach lanes and PriFly; every test drops what it made.
 */

const { test, expect } = require('./helpers/test');
const { openPanel, lapseNlaGuard } = require('./helpers/app');

test.use({ viewport: { width: 1400, height: 1000 } });
test.setTimeout(90000);

let seq = 0;
const unique = () => String((Date.now() + seq++) % 100000);
const _contexts = [];
test.afterEach(async () => { while (_contexts.length) await _contexts.pop().close().catch(() => {}); });

const SHIP = { lat: 36, lon: 35, brc: 360, fb: 351, radial: 171 };

async function mapPage(browser, baseURL, name) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1400, height: 1000 } });
  _contexts.push(context);
  const page = await context.newPage();
  await openPanel(page, { signedOn: ['CV_MARSHAL', 'CV_APP1', 'CV_APP2', 'CV_PRIFLY'], facilityId: 'CARRIER', controller: name });
  await page.waitForFunction(() => typeof crc.carrier.getEfspCarrier === 'function' && !!crc.carrier.getEfspCarrier());
  await page.evaluate((ship) => {
    // the ship the harness lacks: every carrier frame gets it, so a server delta never takes it away
    window.__cm = { ship: { ...ship, found: true, stale: false }, corr: {} };
    const bearing = (deg) => ({ value: deg, ref: 'TRUE', source: 'dcs', override: null, default: deg, display: { value: deg, ref: 'M' } });
    window.__cmPatch = (v) => {
      if (!v || !v.state) return v;
      const s = window.__cm.ship;
      v.shipState = { ...(v.shipState || {}), found: s.found, stale: s.stale, lat: s.lat, lon: s.lon, hullProblem: s.found ? null : 'hull not found', finalBearingUnavailable: null };
      v.state = { ...v.state, brc: bearing(s.brc), finalBearing: bearing(s.fb), radial: bearing(s.radial) };
      return v;
    };
    crc.msgRegistry.addEfspMessageObserver((msg) => {
      for (const v of (msg.carriers && (msg.carriers.updated || msg.carriers)) || []) window.__cmPatch(v);
      if (msg.carrier) window.__cmPatch(msg.carrier);
      for (const r of (msg.correlations && msg.correlations.updated) || []) {
        if (window.__cm.corr[r.flightDataId]) r.trackId = window.__cm.corr[r.flightDataId];
      }
    });
    window.__cmApply = () => {
      const v = JSON.parse(JSON.stringify(crc.carrier.getEfspCarrier()));
      crc.carrier.applyEfspCarrierDelta({ carriers: { updated: [window.__cmPatch(v)] } });
      crc.carrierMap.renderCarrierMap();
    };
    window.__cmApply();
    crc.settingsRegistry.setSetting('carrierMapRangeNm', 30);
    crc.settingsRegistry.setSetting('carrierMapRingSpacing', 'auto');
    const p = crc.dock.dock.api.getPanel('carrierMap');
    if (p) crc.dock.dock.api.removePanel(p);
    crc.dock.dock.addPanel({ id: 'carrierMap', component: 'carrierMap', title: crc.dock.PANEL_TITLES.carrierMap, position: { referencePanel: 'map', direction: 'left' } });
  }, SHIP);
  await expect(page.locator('#carrier-map-panel [data-cm="svg"]')).toBeVisible({ timeout: 10000 });
  return page;
}

const setShip = (page, patch) => page.evaluate((p) => { Object.assign(window.__cm.ship, p); window.__cmApply(); }, patch);
const typeState = (page, field, value) => page.evaluate(([f, v]) => crc.ws.sendEfspCarrierMutation('CV_PRIFLY', undefined, undefined, { kind: 'SetCarrierState', field: f, value: v }), [field, value]);
const stripOf = (page, callsign) => page.evaluate((c) => {
  const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
  return s ? { stripId: s.stripId, flightDataId: s.flightDataId, stripType: s.stripType, state: s.state, ownerPositionId: s.ownerPositionId } : null;
}, callsign);
const waitStrip = (page, callsign, pred, what) => expect.poll(async () => { const s = await stripOf(page, callsign); return !!s && pred(s); }, { message: what, timeout: 10000 }).toBe(true);
const act = (page, callsign, op) => page.evaluate(([c, o]) => {
  const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
  crc.ws.sendEfspMutation(s.ownerPositionId, s, o);
}, [callsign, op]);

/** Checks a flight into the stack and types its side number (and fuel, bingo, approach turn), as the Marshal does. */
async function flight(page, { side, fuel, bingo, turn }) {
  const callsign = `Z${side}`;
  await page.evaluate((c) => crc.ws.sendEfspCreateStrip('CV_MARSHAL', {
    kind: 'CreateStrip', bayId: 'cv-marshal-stack', rackId: 'main', stripType: 'MARSHAL', flightData: { callsign: c, aircraftType: 'F-18C' },
  }, 'CARRIER'), callsign);
  await waitStrip(page, callsign, s => s.state === 'IN_STACK', `${callsign} checked in`);
  const blocks = [['C18', side]];
  if (fuel != null) blocks.push(['C12', String(fuel)]);
  if (bingo != null) blocks.push(['C14', String(bingo)]);
  if (turn != null) blocks.push(['C19', String(turn)]);
  for (const [blockId, value] of blocks) await act(page, callsign, { kind: 'SetBlock', blockId, value });
  await expect.poll(() => page.evaluate(([c, n]) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
    const f = crc.state.getEfspFlightData(s.flightDataId);
    const k = f.military && f.military.carrier;
    return k ? [k.sideNumber, k.lowStateLb, k.bingoFuelLb, k.approachTurnNm].filter((x) => x != null).length : 0;
  }, [callsign, blocks.length])).toBe(blocks.length);
  return callsign;
}

/** A radar contact `nm` from the ship on a true bearing, correlated to the flight `callsign` (when given). */
async function contact(page, id, { brg, nm, altFt, callsign }) {
  await page.evaluate(([tid, b, d, alt, c]) => {
    const { lat, lon } = window.__cm.ship;
    const t = {
      id: tid, domain: 'AIR', lat: lat + d * Math.cos(b * Math.PI / 180) / 60,
      lon: lon + d * Math.sin(b * Math.PI / 180) / 60 / Math.cos(lat * Math.PI / 180),
      label: { callsign: null, source: null, trackNumber: `T${tid}` }, altitude: alt == null ? null : { ft: alt, ref: 'QNH', source: 'MODE_C' },
      ssr: null, illuminatedAt: Date.now(),
    };
    crc.picture.latestFromServer.set(tid, t);
    if (c) {
      const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
      window.__cm.corr[s.flightDataId] = tid;
      crc.state.applyEfspCorrelationDelta({ correlations: { updated: [{ flightDataId: s.flightDataId, trackId: tid }] } });
    }
    crc.carrierMap.renderCarrierMap();
  }, [id, brg, nm, altFt ?? null, callsign || null]);
}

async function cleanUp(page) {
  await page.evaluate(() => {
    for (const s of crc.state.getAllEfspStrips()) {
      if (s.state !== 'DROPPED' && s.facilityId === 'CARRIER') {
        const own = crc.ws.getActingPositions('CARRIER');
        if (own.includes(s.ownerPositionId)) crc.ws.sendEfspMutation(s.ownerPositionId, s, { kind: 'DropStrip', reason: 'e2e cleanup' });
      }
    }
    for (const id of [...crc.picture.latestFromServer.keys()]) if (String(id).startsWith('cm')) crc.picture.latestFromServer.delete(id);
  });
  await expect.poll(() => page.evaluate(() => crc.state.getAllEfspStrips().filter(s => s.state !== 'DROPPED' && s.facilityId === 'CARRIER').length)).toBe(0);
  for (const f of ['tankerSide', 'tankerOnStation']) await typeState(page, f, null);
  if (await page.evaluate(() => crc.carrier.carrierCaseValue()) !== 'III') await typeState(page, 'case', 'III');
}

const map = (page) => page.locator('#carrier-map-panel');
const pattern = (page, kind) => map(page).locator(`[data-pattern="${kind}"]`);
const label = (page, id) => map(page).locator(`[data-label="${id}"]`);
const render = (page) => page.evaluate(() => crc.carrierMap.renderCarrierMap());
const setRange = (page, nm) => page.evaluate((v) => crc.settingsRegistry.setSetting('carrierMapRangeNm', v), nm);

test('01 centred on the ship, north-up, the 10 nm ring at every zoom; the wheel zooms; label size does not change with zoom', async ({ browser, baseURL }) => {
  const page = await mapPage(browser, baseURL, 'e2e-cm1');
  await contact(page, 'cm-near', { brg: 90, nm: 1, altFt: 1200 });
  const heights = [];
  for (const nm of [2.5, 10, 30, 65]) {
    await setRange(page, nm);
    await expect(map(page).locator('[data-cm="range"]')).toHaveText(String(nm));
    const g = await page.evaluate(() => crc.carrierMap.carrierMapGeometry());
    expect(g.range).toBe(nm);
    expect(g.cx).toBeCloseTo(g.w / 2, 5);
    expect(g.cy).toBeCloseTo(g.h / 2, 5);
    expect(g.k).toBeCloseTo((Math.min(g.w, g.h) / 2 - 24) / nm, 5);
    const ten = map(page).locator('circle[data-ring-nm="10"]');
    await expect(ten).toHaveCount(1);
    await expect(ten).toHaveAttribute('stroke', '#2f8a45');
    expect(Number(await ten.getAttribute('cx'))).toBeCloseTo(g.cx, 3);
    expect(Number(await ten.getAttribute('r'))).toBeCloseTo(10 * g.k, 3);
    // rings carry on into the corners: the largest ring reaches past the range circle
    const radii = await map(page).locator('circle[data-ring-nm]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-ring-nm'))));
    expect(Math.max(...radii)).toBeGreaterThan(nm);
    // the ship is at the centre; north is up (the centreline's ticks run astern of a 351 final bearing: south-south-east)
    await expect(map(page).locator('[data-cm="ship"]')).toHaveAttribute('transform', `translate(${g.cx} ${g.cy}) rotate(360)`);
    await expect(map(page).locator('[data-cm="centreline"]')).toHaveAttribute('data-bearing', '351');
    const box = await label(page, 'cm-near').boundingBox();
    heights.push(box.height);
    expect(await label(page, 'cm-near').getAttribute('font-size')).toBe(await map(page).locator('[data-ring-label="10"]').getAttribute('font-size'));
  }
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.5);
  // the wheel: out doubles the range per 450 px, the centre stays
  await setRange(page, 20);
  await map(page).locator('.cm-wrap').hover();
  await page.mouse.wheel(0, 450);
  await expect(map(page).locator('[data-cm="range"]')).toHaveText('40');
  await page.mouse.wheel(0, 2000);
  await expect(map(page).locator('[data-cm="range"]')).toHaveText('65');
  await map(page).locator('.cm-wrap').dblclick();
  await expect(map(page).locator('[data-cm="range"]')).toHaveText('32.5');
  await page.screenshot({ path: test.info().outputPath('01-zoom.png') });
  await cleanUp(page);
});

test('02 the marshal stack on the radial, aircraft by side number and altitude, amber low state, labels decluttered at the stack', async ({ browser, baseURL }) => {
  const page = await mapPage(browser, baseURL, 'e2e-cm2');
  const [a, b, c] = [`1${unique()}`, `2${unique()}`, `3${unique()}`];
  const ca = await flight(page, { side: a, fuel: 7200, bingo: 4000 });
  const cb = await flight(page, { side: b, fuel: 4500, bingo: 4000 });
  const cc = await flight(page, { side: c, fuel: 3900, bingo: 4000 });
  await setRange(page, 30);
  await contact(page, 'cm-a', { brg: SHIP.radial, nm: 21, altFt: 6000, callsign: ca });
  await contact(page, 'cm-b', { brg: SHIP.radial, nm: 22, altFt: 7000, callsign: cb });
  await contact(page, 'cm-c', { brg: SHIP.radial, nm: 23, altFt: 8000, callsign: cc });
  await contact(page, 'cm-x', { brg: 45, nm: 12, altFt: 15000 });
  await expect(map(page).locator('[data-fix-dme]')).toHaveCount(3);
  await expect(map(page).locator('[data-fix-dme="21"]')).toHaveCount(1);
  await expect(map(page).locator('[data-cm="stack-label"]')).toHaveText('MARSHAL 171M 21');
  await expect(label(page, 'cm-a')).toHaveText(`${a} 060`);
  await expect(label(page, 'cm-b')).toHaveText(`${b} 070`);
  await expect(label(page, 'cm-x')).toHaveText('Tcm-x 150');
  await expect(label(page, 'cm-a')).toHaveAttribute('fill', '#d8e0e6');
  await expect(label(page, 'cm-b')).toHaveAttribute('fill', /e0a83c/);
  await expect(label(page, 'cm-c')).toHaveAttribute('fill', /ff5c5c/);
  // the margin is the MARSHAL panel's setting
  await page.evaluate(() => crc.settingsRegistry.setSetting('marshalLowStateMarginKlb', 4));
  await expect(label(page, 'cm-a')).toHaveAttribute('fill', /e0a83c/);
  await page.evaluate(() => crc.settingsRegistry.setSetting('marshalLowStateMarginKlb', 1));
  // a mile apart at 30 nm is 9 px: the labels must not overlap
  const boxes = await map(page).locator('[data-label]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const p = boxes[i];
      const q = boxes[j];
      expect(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h, `labels ${i}/${j} overlap`).toBe(false);
    }
  }
  await expect(map(page).locator('[data-leader]')).not.toHaveCount(0);
  await expect(map(page).locator('[data-pattern]')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('02-stack.png') });
  await cleanUp(page);
});

test('03 the bolter racetrack only while a Strip is BOLTER_WAVEOFF, turning in at its approach turn (4 and 8 nm), gone after', async ({ browser, baseURL }) => {
  const page = await mapPage(browser, baseURL, 'e2e-cm3');
  const [a, b] = [`4${unique()}`, `5${unique()}`];
  const ca = await flight(page, { side: a, fuel: 7000, bingo: 4000, turn: 8 });
  const cb = await flight(page, { side: b, fuel: 7000, bingo: 4000, turn: 4 });
  await setRange(page, 15);
  const toFinal = async (cs) => {
    await act(page, cs, { kind: 'InvokeNla' });
    await waitStrip(page, cs, s => s.state === 'COMMENCED', 'commenced');
    await lapseNlaGuard(page);
    await act(page, cs, { kind: 'InvokeNla' });
    await waitStrip(page, cs, s => s.state === 'ON_FINAL', 'on final');
  };
  await toFinal(ca);
  await expect(pattern(page, 'bolter')).toHaveCount(0);
  await act(page, ca, { kind: 'SetState', toState: 'BOLTER_WAVEOFF' });
  await waitStrip(page, ca, s => s.state === 'BOLTER_WAVEOFF', 'bolter');
  await expect(pattern(page, 'bolter')).toHaveCount(1);
  await expect(pattern(page, 'bolter')).toHaveAttribute('data-turn-nm', '8');
  await lapseNlaGuard(page);
  await toFinal(cb);
  await act(page, cb, { kind: 'SetState', toState: 'BOLTER_WAVEOFF' });
  await waitStrip(page, cb, s => s.state === 'BOLTER_WAVEOFF', 'second bolter');
  await expect(pattern(page, 'bolter')).toHaveCount(2);
  await expect(map(page).locator('[data-pattern="bolter"][data-turn-nm="4"]')).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath('03-bolters.png') });
  await act(page, ca, { kind: 'SetState', toState: 'ON_FINAL' });
  await waitStrip(page, ca, s => s.state === 'ON_FINAL', 'back on final');
  await expect(pattern(page, 'bolter')).toHaveCount(1);
  await expect(pattern(page, 'bolter')).toHaveAttribute('data-turn-nm', '4');
  await act(page, cb, { kind: 'DropStrip', reason: 'trapped' });
  await expect(pattern(page, 'bolter')).toHaveCount(0);
  await cleanUp(page);
});

test('04 Case change mid-recovery: the stack gives way to port holding; the landing pattern and the initial, then the spin, only while flown', async ({ browser, baseURL }) => {
  const page = await mapPage(browser, baseURL, 'e2e-cm4');
  const a = `6${unique()}`;
  const ca = await flight(page, { side: a, fuel: 7000, bingo: 4000 });
  await setRange(page, 8);
  await expect(map(page).locator('[data-cm="stack"]')).toHaveCount(1);
  await expect(pattern(page, 'port-holding')).toHaveCount(0);
  await typeState(page, 'case', 'I');
  await expect(map(page).locator('[data-cm="case"]')).toHaveText('I');
  await expect(pattern(page, 'port-holding')).toHaveCount(1);
  await expect(map(page).locator('[data-cm="stack"]')).toHaveCount(0);
  await expect(pattern(page, 'landing')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('04-port-holding.png') });
  // Commence in Case I hands the flight to PriFly as a PATTERN Strip
  await act(page, ca, { kind: 'InvokeNla' });
  await waitStrip(page, ca, s => s.stripType === 'PATTERN' && s.state === 'IN_PATTERN', 'in the pattern');
  await expect(pattern(page, 'port-holding')).toHaveCount(0);
  await expect(pattern(page, 'landing')).toHaveCount(1);
  await expect(pattern(page, 'initial')).toHaveCount(1);
  await expect(map(page).locator('text', { hasText: 'INITIAL' })).toHaveCount(1);
  // its contact at 1,200 ft within 3 nm of the ship: the spin, not the landing pattern
  await contact(page, 'cm-spin', { brg: 30, nm: 2, altFt: 1200, callsign: ca });
  await expect(pattern(page, 'spin')).toHaveCount(1);
  await expect(pattern(page, 'landing')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('04-spin.png') });
  await contact(page, 'cm-spin', { brg: 200, nm: 1.2, altFt: 600, callsign: ca });
  await expect(pattern(page, 'landing')).toHaveCount(1);
  await expect(pattern(page, 'spin')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('04-landing.png') });
  await act(page, ca, { kind: 'DropStrip', reason: 'trapped' });
  await expect(map(page).locator('[data-pattern]')).toHaveCount(0);
  await cleanUp(page);
});

test('05 the tanker: "side alt TKR", its racetrack only while on station', async ({ browser, baseURL }) => {
  const page = await mapPage(browser, baseURL, 'e2e-cm5');
  const t = `7${unique()}`;
  const ct = await flight(page, { side: t });
  await setRange(page, 15);
  await typeState(page, 'tankerSide', t);
  await contact(page, 'cm-tkr', { brg: 270, nm: 4, altFt: 6000, callsign: ct });
  await expect(map(page).locator('[data-track-id="cm-tkr"]')).toHaveAttribute('data-tanker', '1');
  await expect(label(page, 'cm-tkr')).toHaveText(`${t} 060`);
  await expect(map(page).locator('text', { hasText: /^TKR$/ })).toHaveCount(1);
  await expect(pattern(page, 'tanker')).toHaveCount(0);
  await typeState(page, 'tankerOnStation', true);
  await expect(pattern(page, 'tanker')).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath('05-tanker.png') });
  await typeState(page, 'tankerOnStation', false);
  await expect(pattern(page, 'tanker')).toHaveCount(0);
  await cleanUp(page);
});

test('06 the final bearing overridden moves the centreline; the ship track lost is said; a hull lost from DCS empties the map', async ({ browser, baseURL }) => {
  const page = await mapPage(browser, baseURL, 'e2e-cm6');
  await setRange(page, 10);
  const tick = () => map(page).locator('[data-cm="centreline"] [data-tick]').first().evaluate((e) => [Number(e.getAttribute('x1')), Number(e.getAttribute('y1'))]);
  const before = await tick();
  await setShip(page, { fb: 330 });
  await expect(map(page).locator('[data-cm="centreline"]')).toHaveAttribute('data-bearing', '330');
  expect(await tick()).not.toEqual(before);
  await expect(map(page).locator('[data-cm="problem"]')).toHaveText('');
  await setShip(page, { stale: true });
  await expect(map(page).locator('[data-cm="problem"]')).toContainText('ship track lost');
  await page.screenshot({ path: test.info().outputPath('06-stale.png') });
  await setShip(page, { found: false });
  await expect(page.locator('#carrier-map-empty')).toBeVisible();
  await expect(page.locator('#carrier-map-empty')).toHaveText('hull not found');
  await expect(page.locator('#carrier-map-body')).toBeHidden();
  await setShip(page, { found: true, stale: false, fb: 351 });
  await expect(map(page).locator('[data-cm="svg"]')).toBeVisible();
  await cleanUp(page);
});
