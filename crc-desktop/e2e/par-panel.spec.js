'use strict';

/* The PAR panel (docs/wip/PAR-2.md; mockup docs/mockups/par-panel.html, revision 4; decisions H115, H116, H122; the sample is
 * crc-sync docs/adr/0112). The harness has no DCS, so the server's PAR sample carries no plot: the spec replaces the samples of
 * every `par-sample` frame with its own (an EFSP message observer, as carrier-map.spec.js puts in the ship) and applies them at
 * once. Everything else is the real server: the Strips, the rotation to PAR, the carrier handoffs and the terminal ops.
 * Incirlik: one controller signed on to RSU, AP, SFA and PAR. The carrier: one controller on the whole carrier.
 */

const { test, expect } = require('./helpers/test');
const { openPanel } = require('./helpers/app');

test.use({ viewport: { width: 1500, height: 1100 } });
test.setTimeout(90000);

let seq = 0;
const unique = () => String((Date.now() + seq++) % 10000);
const FT_PER_NM = 6076.12;
const RAD = Math.PI / 180;

const APPROACH_05 = {
  id: 'LTAG-05', label: 'PAR RWY 05', runwayEnd: '05', airportIcao: 'LTAG',
  gpaDeg: 3.06, gpaPublished: false, tchFt: 50, tdzeFt: 238, dhFt: 200, daFt: 438, courseTrueDeg: 56, courseDisplay: { value: 51, ref: 'M' },
};
const R_DA = (200 - 50) / (FT_PER_NM * Math.tan(3.06 * RAD)); // where the glidepath reaches DA

/** One plot `elDev` degrees off a `gpa` glidepath and `azDeg` off the course (positive right), as the server measures it. */
function plotAt(r, elDev = 0, azDeg = 0, gpa = 3.06, tch = 50) {
  const heightFt = tch + r * FT_PER_NM * Math.tan((gpa + elDev) * RAD);
  const azDevFt = r * FT_PER_NM * Math.tan(azDeg * RAD);
  return {
    rangeNm: r, heightFt, elevDeg: gpa + elDev, elevDevDeg: elDev, elevDevFt: heightFt - (tch + r * FT_PER_NM * Math.tan(gpa * RAD)),
    azDeg, azDevFt, gsKt: 142, vsFpm: -770,
  };
}
function sample(stripId, { r = 3.36, elDev = 0, azDeg = 0, approach = APPROACH_05, sensor, plotAgeMs = 500, plot, trail = 12, facilityId = 'INCIRLIK', positionId = 'PAR' } = {}) {
  const p = plot === undefined ? plotAt(r, elDev, azDeg, approach.gpaDeg, approach.tchFt) : plot;
  const tr = [];
  for (let k = trail; k >= 1; k--) {
    const q = plotAt(r + k * 0.04, elDev, azDeg, approach.gpaDeg, approach.tchFt);
    tr.push({ rangeNm: q.rangeNm, heightFt: q.heightFt, elevDeg: q.elevDeg, elevDevDeg: q.elevDevDeg, elevDevFt: q.elevDevFt, azDeg: q.azDeg, azDevFt: q.azDevFt });
  }
  return {
    stripId, facilityId, positionId, approach,
    sensor: sensor || { elevation: 'OK', azimuth: 'OK', reason: null },
    plot: p, plotAgeMs: p ? plotAgeMs : null, trail: tr,
  };
}

const stripOf = (page, callsign) => page.evaluate((c) => {
  const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
  return s ? { stripId: s.stripId, stripType: s.stripType, state: s.state, ownerPositionId: s.ownerPositionId, bayId: s.bayId } : null;
}, callsign);
const waitStrip = (page, callsign, pred, what) => expect.poll(async () => { const s = await stripOf(page, callsign); return !!s && pred(s); }, { message: what, timeout: 10000 }).toBe(true);

async function openBay(page, positionId, bayId) {
  await page.locator(`.efsp-position-tab[data-position-id="${positionId}"]`).click();
  await page.locator('.efsp-bay-tab', { hasText: bayId }).first().click();
}

/** Every `par-sample` frame carries the spec's samples while it has some; `null` lets the server's through. */
async function installSampleInjection(page) {
  await page.evaluate(() => {
    window.__par = { samples: null };
    crc.msgRegistry.addEfspMessageObserver((msg) => {
      if (msg && msg.type === 'par-sample' && window.__par.samples) msg.samples = JSON.parse(JSON.stringify(window.__par.samples));
    });
    // the panel's settings start at their defaults in every test
    for (const [k, v] of [['parAutoscale', true], ['parGpa', 3.06], ['parTolEl', 1], ['parTolAz', 1]]) crc.settingsRegistry.setSetting(k, v);
  });
}
const inject = (page, samples) => page.evaluate((s) => {
  window.__par.samples = s;
  crc.parSamples.applyParSamples({ type: 'par-sample', at: Date.now(), samples: s ? JSON.parse(JSON.stringify(s)) : [] });
  crc.changeBus.markEfspChanged('par');
}, samples);

const panel = (page) => page.locator('#par-panel');
const field = (page, key) => panel(page).locator(`[data-par="${key}"]`);
const devItem = (page, key) => panel(page).locator(`[data-par-dev="${key}"]`);
const plotMark = (page, kind) => panel(page).locator(`[data-par-plot="${kind}"]`);
const view = (page) => page.evaluate(() => crc.par.parPanelView());

async function cleanUp(page, facility) {
  await page.evaluate((f) => {
    if (window.__par) window.__par.samples = null;
    for (const s of crc.state.getAllEfspStrips()) {
      if (s.state !== 'DROPPED' && s.facilityId === f) crc.ws.sendEfspMutation(s.ownerPositionId, s, { kind: 'DropStrip', reason: 'e2e cleanup' });
    }
  }, facility);
  await expect.poll(() => page.evaluate((f) => crc.state.getAllEfspStrips().filter(s => s.state !== 'DROPPED' && s.facilityId === f).length, facility)).toBe(0);
}

/** A flight rotated to PAR at Incirlik, on final (the real Board); returns its Strip id. */
async function onParFinal(page, callsign, rack = 'freq-2') {
  await page.evaluate((c) => crc.ws.sendEfspCreateStrip('AP', { kind: 'CreateStrip', bayId: 'ap-inbound', rackId: 'main', stripType: 'ARRIVAL', flightData: { callsign: c, aircraftType: 'F-16C', originAirport: 'LTAG' } }), callsign);
  await waitStrip(page, callsign, s => s.ownerPositionId === 'AP', 'created at AP');
  await page.evaluate(([c, r]) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
    crc.ws.sendEfspMutation('AP', s, { kind: 'TransferStrip', toPositionId: 'SFA', bayId: 'sfa-frequencies', rackId: r });
  }, [callsign, rack]);
  await waitStrip(page, callsign, s => s.ownerPositionId === 'SFA', 'with SFA');
  await page.evaluate((c) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
    crc.ws.sendEfspMutation('SFA', s, { kind: 'SfaRotation' });
  }, callsign);
  await waitStrip(page, callsign, s => s.ownerPositionId === 'PAR' && s.state === 'ON_FINAL' && s.bayId === 'par-final', 'on PAR final');
  return (await stripOf(page, callsign)).stripId;
}

async function incirlik(page) {
  await openPanel(page, { signedOn: ['RSU', 'AP', 'SFA', 'PAR'], controller: `e2e-par-${unique()}` });
  await installSampleInjection(page);
}

/** Opens the PAR panel the controller's way: the flight's name in the FINAL Bay. */
async function openFromBay(page, positionId, bayId, name) {
  await openBay(page, positionId, bayId);
  await page.locator('.efsp-final-row .efsp-final-name', { hasText: name }).click();
  await expect(panel(page).locator('#par-body')).toBeVisible();
}

test.afterEach(async ({ page }) => { await cleanUp(page, 'INCIRLIK').catch(() => {}); await cleanUp(page, 'CARRIER').catch(() => {}); });

test('01 on the glidepath: all grey but the magenta track; the header, the flight row and the range; tolerance red above, below, left and right', async ({ page }) => {
  await incirlik(page);
  const call = `PAR${unique()}`;
  const id = await onParFinal(page, call);
  await inject(page, [sample(id)]);
  await openFromBay(page, 'PAR', 'par-final', call);

  await expect(field(page, 'title')).toHaveText('RWY 05 · LTAG');
  await expect(field(page, 'gpa')).toHaveText('3.06°');
  await expect(field(page, 'tch')).toHaveText('50');
  await expect(field(page, 'da')).toHaveText('438');
  await expect(field(page, 'fac')).toHaveText('051M');
  await expect(field(page, 'name')).toHaveText(call); // a callsign at Incirlik (H122)
  await expect(field(page, 'type')).toHaveText('F-16C');
  await expect(field(page, 'gs')).toHaveText('142 kt');
  await expect(field(page, 'vs')).toHaveText('−770');
  await expect(field(page, 'range')).toHaveText('3.4');
  await expect(panel(page).getByText('NM to TD')).toBeVisible();
  await expect(panel(page)).not.toContainText(/need/i); // no "need" VS (H115)
  // dark cockpit: nothing coloured, the track magenta with its dark halo, a 12-plot trail, the reference lines dimmed
  await expect(panel(page).locator('.par-danger, .par-attn, .par-bad')).toHaveCount(0);
  await expect(field(page, 'msg')).toHaveText('');
  await expect(plotMark(page, 'el')).toHaveAttribute('fill', '#e58bff');
  await expect(plotMark(page, 'el')).toHaveAttribute('stroke', '#0b0e11');
  await expect(plotMark(page, 'az')).toHaveAttribute('fill', '#e58bff');
  await expect(panel(page).locator('[data-par-trail="el"] circle')).toHaveCount(12);
  await expect(panel(page).locator('[data-par-line="glidepath"]')).toHaveAttribute('stroke', '#5f6b76');
  await expect(panel(page).locator('.par-term')).toHaveText(['Landing assured', 'Missed approach']);
  await expect(panel(page).locator('input, select, textarea')).toHaveCount(0); // nothing to type on final
  await panel(page).screenshot({ path: test.info().outputPath('01-on-glidepath.png') });

  // above the glidepath, outside tolerance: red; the readout says so
  await inject(page, [sample(id, { r: 5, elDev: 1.3 })]);
  await expect(plotMark(page, 'el')).toHaveAttribute('data-level', 'danger');
  await expect(devItem(page, 'el')).toHaveClass(/par-danger/);
  await expect(devItem(page, 'el')).toContainText('OUTSIDE TOLERANCE');
  await expect(devItem(page, 'el')).toContainText('+');
  await expect(devItem(page, 'az')).not.toHaveClass(/par-danger/);
  await panel(page).screenshot({ path: test.info().outputPath('01-above.png') });
  // below
  await inject(page, [sample(id, { r: 2.4, elDev: -1.2 })]);
  await expect(devItem(page, 'el')).toHaveClass(/par-danger/);
  await expect(devItem(page, 'el')).toContainText('−');
  // slightly off is grey (inside ±1°)
  await inject(page, [sample(id, { r: 3.6, elDev: 0.35, azDeg: -0.9 })]);
  await expect(panel(page).locator('.par-danger')).toHaveCount(0);
  await expect(plotMark(page, 'el')).toHaveAttribute('data-level', '');
  // right of course, outside tolerance
  await inject(page, [sample(id, { r: 5.1, azDeg: 1.3 })]);
  await expect(plotMark(page, 'az')).toHaveAttribute('data-level', 'danger');
  await expect(devItem(page, 'az')).toHaveClass(/par-danger/);
  await expect(devItem(page, 'az')).toContainText(/ft R/);
  await expect(devItem(page, 'el')).not.toHaveClass(/par-danger/);
  // left
  await inject(page, [sample(id, { r: 5.1, azDeg: -1.3 })]);
  await expect(devItem(page, 'az')).toHaveClass(/par-danger/);
  await expect(devItem(page, 'az')).toContainText(/ft L/);
  await panel(page).screenshot({ path: test.info().outputPath('01-left.png') });

  // the azimuth tolerance is the controller's setting: ±1.5° makes 1.3° grey
  await page.evaluate(() => crc.settingsRegistry.setSetting('parTolAz', 1.5));
  await expect(devItem(page, 'az')).not.toHaveClass(/par-danger/);
});

test('02 below DA nothing is coloured and the dashed tolerance lines start at DA; no plot for 3 s is amber; EL INOP blanks the elevation scope', async ({ page }) => {
  await incirlik(page);
  const call = `PAR${unique()}`;
  const id = await onParFinal(page, call);
  await inject(page, [sample(id, { r: 0.36, elDev: -1.6, azDeg: 2.4 })]);
  await openFromBay(page, 'PAR', 'par-final', call);
  await expect(field(page, 'range')).toHaveText('0.4');
  await expect(panel(page).locator('.par-danger, .par-attn, .par-bad')).toHaveCount(0);
  await expect(plotMark(page, 'el')).toHaveAttribute('data-level', '');
  await expect(plotMark(page, 'az')).toHaveAttribute('data-level', '');
  for (const line of ['tol-low', 'tol-high']) {
    const from = Number(await panel(page).locator(`[data-par-line="${line}"]`).getAttribute('data-from-nm'));
    expect(Math.abs(from - R_DA)).toBeLessThan(0.002);
  }
  expect(Number(await panel(page).locator('[data-par-line="tol-left"]').getAttribute('data-from-nm'))).toBeCloseTo(R_DA, 2);
  await expect(panel(page).locator('[data-par-line="da"]')).toHaveCount(1);
  await panel(page).screenshot({ path: test.info().outputPath('02-below-da.png') });

  // no plot for 3 s: amber, the diamond hollow
  await inject(page, [sample(id, { r: 1.9, plotAgeMs: 3400 })]);
  await expect(field(page, 'msg')).toHaveText('NO PLOT 3 s');
  await expect(field(page, 'msg')).toHaveClass(/par-attn/);
  await expect(plotMark(page, 'el')).toHaveAttribute('data-level', 'attn');
  await expect(plotMark(page, 'el')).toHaveAttribute('fill', 'none');
  await panel(page).screenshot({ path: test.info().outputPath('02-no-plot.png') });
  // a fresh plot clears it
  await inject(page, [sample(id, { r: 1.8, plotAgeMs: 500 })]);
  await expect(field(page, 'msg')).toHaveText('');
  await expect(plotMark(page, 'el')).toHaveAttribute('data-level', '');

  // elevation INOP: that scope blanked in orange-red with the reason; azimuth still measured
  const elInop = sample(id, { r: 3, sensor: { elevation: 'INOP', azimuth: 'OK', reason: 'NO_TDZE' } });
  for (const k of ['heightFt', 'elevDeg', 'elevDevDeg', 'elevDevFt']) elInop.plot[k] = null;
  await inject(page, [elInop]);
  await expect(panel(page).locator('[data-par-flag="el"]')).toHaveText('EL INOP');
  await expect(panel(page).locator('[data-par-flag="el"]')).toHaveClass(/par-bad/);
  await expect(panel(page).locator('[data-par-inop="el"]')).toHaveText('NO ELEVATION DATA');
  await expect(panel(page).locator('[data-par-scope="el"]')).toContainText('no touchdown zone elevation');
  await expect(plotMark(page, 'el')).toHaveCount(0);
  await expect(plotMark(page, 'az')).toHaveCount(1);
  await expect(devItem(page, 'el')).toContainText('—');
  await expect(devItem(page, 'alt')).toContainText('—');
  await expect(field(page, 'msg')).toHaveText(''); // INOP is not "no plot"
  await panel(page).screenshot({ path: test.info().outputPath('02-el-inop.png') });
});

test('03 autoscale: the track at the golden-ratio point down to 10 NM; a manual zoom pauses it, a double-click resumes; Shift+wheel is this scope\'s vertical only', async ({ page }) => {
  await incirlik(page);
  const call = `PAR${unique()}`;
  const id = await onParFinal(page, call);
  await inject(page, [sample(id, { r: 12.36 })]);
  await openFromBay(page, 'PAR', 'par-final', call);
  await expect.poll(async () => (await view(page)).rMax).toBeCloseTo(12.36 / 0.618, 3);
  await expect(panel(page).locator('[data-par-scope="el"] .par-win')).toContainText('· AUTO');
  // the track at 61.8 % of the range width
  // one synchronous read: the scopes are redrawn twice a second
  const geo = () => page.evaluate(() => {
    const p = document.querySelector('#par-panel [data-par-plot="el"]');
    const m = /^M([\d.-]+) /.exec(p.getAttribute('d'));
    return { x: Number(m[1]), w: p.ownerSVGElement.viewBox.baseVal.width };
  });
  const g = await geo();
  expect((g.x - 44) / (g.w - 8 - 44)).toBeCloseTo(0.618, 2);
  // down to 10 NM and no further
  await inject(page, [sample(id, { r: 4 })]);
  await expect.poll(async () => (await view(page)).rMax).toBe(10);

  // a manual zoom (the wheel over the elevation scope) pauses autoscale; both scopes share the range
  const el = panel(page).locator('[data-par-scope="el"]');
  const box = await el.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 200);
  await expect.poll(async () => (await view(page)).paused).toBe(true);
  const zoomed = await view(page);
  expect(zoomed.rMax).toBeGreaterThan(10);
  await expect(el.locator('.par-win')).toContainText('AUTO paused (double-click)');
  await inject(page, [sample(id, { r: 8 })]);
  await expect.poll(async () => (await view(page)).rMax).toBeCloseTo(zoomed.rMax, 6); // paused: the window stays
  // Shift+wheel: this scope's height only
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await view(page)).hMax).toBeLessThan(zoomed.hMax);
  const v2 = await view(page);
  expect(v2.rMax).toBeCloseTo(zoomed.rMax, 6);
  expect(v2.yMax).toBeCloseTo(zoomed.yMax, 6);
  // double-click resumes
  await el.dblclick();
  await expect.poll(async () => (await view(page)).paused).toBe(false);
  await expect.poll(async () => (await view(page)).rMax).toBeCloseTo(8 / 0.618, 3);

  // autoscale off (the Settings tab): the window stays where the controller put it
  await page.evaluate(() => crc.settingsRegistry.setSetting('parAutoscale', false));
  const fixed = await view(page);
  await inject(page, [sample(id, { r: 15 })]);
  await expect(el.locator('.par-win')).not.toContainText('AUTO');
  expect((await view(page)).rMax).toBeCloseTo(fixed.rMax, 6);
});

test('04 the controller\'s default glideslope when none is published; a published angle wins; the Settings tab has the four PAR settings', async ({ page }) => {
  await incirlik(page);
  const call = `PAR${unique()}`;
  const id = await onParFinal(page, call);
  // the server measured +0.95° against 3.06° (inside); the controller's 3.00° makes it +1.01° (outside)
  await inject(page, [sample(id, { r: 4, elDev: 0.95 })]);
  await openFromBay(page, 'PAR', 'par-final', call);
  await expect(devItem(page, 'el')).not.toHaveClass(/par-danger/);
  await page.evaluate(() => crc.settingsRegistry.setSetting('parGpa', 3.0));
  await expect(field(page, 'gpa')).toHaveText('3.00°');
  await expect(devItem(page, 'el')).toHaveClass(/par-danger/);
  // a published angle wins over the controller's default
  await inject(page, [sample(id, { r: 4, elDev: 0.95, approach: { ...APPROACH_05, gpaPublished: true } })]);
  await expect(field(page, 'gpa')).toHaveText('3.06°');
  await expect(devItem(page, 'el')).not.toHaveClass(/par-danger/);

  // the Settings panel's PAR tab
  await page.evaluate(() => crc.dock.toggleDockPanel('settings', true));
  await page.locator('.stab[data-pane="par"]').click();
  const pane = page.locator('#stab-par');
  await expect(pane.locator('#set-parAutoscale')).toBeChecked();
  await expect(pane.locator('#set-parGpa')).toHaveValue('3');
  await expect(pane.locator('#set-parTolEl')).toHaveValue('1');
  await expect(pane.locator('#set-parTolAz')).toHaveValue('1');
});

test('05 walks: a second aircraft joins (the picks), the landing runway changes (the trail is cleared), a missed approach mid-run ends the sample', async ({ page }) => {
  await incirlik(page);
  const a = `PA${unique()}`;
  const b = `PB${unique()}`;
  const ida = await onParFinal(page, a);
  // PAR holds one aircraft at Incirlik (par-final capacity 1): the second flight's Strip is with AP; its sample is the spec's
  await page.evaluate((c) => crc.ws.sendEfspCreateStrip('AP', { kind: 'CreateStrip', bayId: 'ap-inbound', rackId: 'main', stripType: 'ARRIVAL', flightData: { callsign: c, aircraftType: 'F-15E' } }), b);
  await waitStrip(page, b, s => s.ownerPositionId === 'AP', 'B at AP');
  const idb = (await stripOf(page, b)).stripId;
  await inject(page, [sample(ida, { r: 3 })]);
  await openFromBay(page, 'PAR', 'par-final', a);
  await expect(panel(page).locator('[data-par="picks"]')).toBeHidden(); // one flight: no picks

  // a second aircraft joins the final, farther out: picks appear, the scopes stay on the first
  await inject(page, [sample(ida, { r: 3 }), sample(idb, { r: 7 })]);
  const picks = panel(page).locator('.par-pick');
  await expect(picks).toHaveText([a, b]);
  await expect(picks.nth(0)).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => crc.par.parShownStripId())).toBe(ida);
  await picks.nth(1).click();
  await expect(field(page, 'name')).toHaveText(b);
  await expect(field(page, 'type')).toHaveText('F-15E');
  // the pick holds while that flight is sent, even when the other is nearer
  await inject(page, [sample(ida, { r: 2 }), sample(idb, { r: 6.9 })]);
  await expect(field(page, 'name')).toHaveText(b);
  // it leaves: the scopes fall back to the one still on the final, the picks go
  await inject(page, [sample(ida, { r: 1.9 })]);
  await expect(field(page, 'name')).toHaveText(a);
  await expect(panel(page).locator('[data-par="picks"]')).toBeHidden();

  // the landing runway changes mid-approach: the trail measured from the old threshold is cleared
  await expect(panel(page).locator('[data-par-trail="el"] circle')).toHaveCount(12);
  const old = sample(ida, { r: 1.9 });
  const switched = { ...sample(ida, { r: 6, approach: { ...APPROACH_05, id: 'LTAG-23', runwayEnd: '23', courseDisplay: { value: 231, ref: 'M' } } }), trail: old.trail, plot: old.plot };
  await inject(page, [switched]);
  await expect(field(page, 'title')).toHaveText('RWY 23 · LTAG');
  await expect(field(page, 'fac')).toHaveText('231M');
  await expect(panel(page).locator('[data-par-trail="el"] circle')).toHaveCount(0);
  await panel(page).screenshot({ path: test.info().outputPath('05-runway-changed.png') });

  // a missed approach mid-run (the PAR panel's button): the Strip goes to par-missed, the server's next frame is empty
  await page.evaluate(() => { window.__par.samples = null; });
  await panel(page).locator('.par-term[data-terminal="MISSED"]').click();
  await waitStrip(page, a, s => s.state === 'BOLTER_WAVEOFF' && s.bayId === 'par-missed', 'missed approach');
  await expect(panel(page).locator('#par-empty')).toBeVisible({ timeout: 5000 });
  await expect(panel(page).locator('#par-empty')).toHaveText('No aircraft on your final.');
});

test('06 Landing assured from the PAR panel; the controller signs off: the sample stops and the panel empties', async ({ page }) => {
  await incirlik(page);
  const a = `PL${unique()}`;
  const id = await onParFinal(page, a);
  await inject(page, [sample(id, { r: 1 })]);
  await openFromBay(page, 'PAR', 'par-final', a);
  await page.evaluate(() => { window.__par.samples = null; });
  await panel(page).locator('.par-term[data-terminal="ASSURED"]').click();
  await waitStrip(page, a, s => s.state === 'BALL', 'landing assured');
  await expect(panel(page).locator('#par-empty')).toBeVisible({ timeout: 5000 });

  // a second flight on final (the first one's Strip leaves the Bay first: PAR holds one), then PAR signs off: the server's
  // one empty frame clears the panel
  await cleanUp(page, 'INCIRLIK');
  const b = `PS${unique()}`;
  const idb = await onParFinal(page, b, 'freq-3');
  await inject(page, [sample(idb, { r: 4 })]);
  await expect(field(page, 'name')).toHaveText(b);
  await page.evaluate(() => { window.__par.samples = null; });
  // (signing off PAR alone would not stop it: this controller also holds AP, which takes PAR's hat, ADR 0110, and is sent the
  // same sample; so the controller signs off everything)
  await page.evaluate(() => crc.ws.sendEfspSetPositions('INCIRLIK', []));
  await expect(panel(page).locator('#par-empty')).toBeVisible({ timeout: 5000 });
  await page.evaluate(() => crc.ws.sendEfspSetPositions('INCIRLIK', ['RSU', 'AP', 'SFA', 'PAR']));
  await page.waitForFunction(() => crc.ws.getAckedPositions('INCIRLIK').includes('PAR'));
});

test('07 a carrier lane has no PAR (H125): no sample, the FINAL line by side number (H124) with no range (H126), Ball and Waveoff keep their ops', async ({ page }) => {
  await openPanel(page, { signedOn: ['CV_MARSHAL', 'CV_APP1', 'CV_APP2', 'CV_PRIFLY'], facilityId: 'CARRIER', controller: `e2e-par-cv-${unique()}` });
  await page.waitForFunction(() => typeof crc.carrier.getEfspCarrier === 'function' && !!crc.carrier.getEfspCarrier());
  await installSampleInjection(page);
  const call = `CV${unique()}`;
  const side = `2${unique()}`.slice(0, 3);
  await page.evaluate((c) => crc.ws.sendEfspCreateStrip('CV_MARSHAL', {
    kind: 'CreateStrip', bayId: 'cv-marshal-stack', rackId: 'main', stripType: 'MARSHAL', flightData: { callsign: c, aircraftType: 'F-18C' },
  }, 'CARRIER'), call);
  await waitStrip(page, call, s => s.state === 'IN_STACK', 'checked in');
  await page.evaluate(([c, sn]) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
    crc.ws.sendEfspMutation('CV_MARSHAL', s, { kind: 'SetBlock', blockId: 'C18', value: sn });
  }, [call, side]);
  await expect.poll(() => page.evaluate((c) => {
    const x = crc.state.getAllEfspStrips().find(y => y.state !== 'DROPPED' && (crc.state.getEfspFlightData(y.flightDataId) || { identity: {} }).identity.callsign === c);
    const f = crc.state.getEfspFlightData(x.flightDataId);
    return (f.military && f.military.carrier && f.military.carrier.sideNumber) || null;
  }, call)).toBe(side);
  await openBay(page, 'CV_MARSHAL', 'cv-marshal-stack');
  const strip = page.locator('.efsp-strip', { has: page.getByText(call, { exact: true }) }).first();
  await strip.locator('.efsp-nla-btn[data-carrier-handoff="MARSHAL_TO_APPROACH"]').click();
  await waitStrip(page, call, s => s.state === 'COMMENCED' && s.ownerPositionId === 'CV_APP1', 'Commence');
  await openBay(page, 'CV_APP1', 'cv-app1-lane');
  await page.locator('.efsp-strip', { has: page.getByText(call, { exact: true }) }).first().locator('.efsp-nla-btn[data-carrier-handoff="APPROACH_TO_FINAL"]').click();
  await waitStrip(page, call, s => s.stripType === 'FINAL' && s.state === 'ON_FINAL', 'Radar contact');
  // No PAR on the carrier (H125, crc-sync docs/adr/0116): the server sends this lane no sample, the FINAL Bay line names the
  // flight by its side number (H124), has no range (H126) and no link to the PAR panel, and keeps Ball / Waveoff.
  await page.evaluate(() => {
    window.__parSeen = [];
    crc.msgRegistry.addEfspMessageObserver((msg) => { if (msg && msg.type === 'par-sample') window.__parSeen.push(...(msg.samples || [])); });
  });
  await openBay(page, 'CV_APP1', 'cv-app1-final');
  const row = page.locator('.efsp-final-row');
  await expect(row.locator('.efsp-final-name')).toHaveText(side);
  await expect(row.locator('span.efsp-final-name')).toHaveCount(1);
  await expect(row.locator('button.efsp-final-name')).toHaveCount(0);
  await expect(row.locator('.efsp-final-range')).toHaveCount(0);
  await expect(row.locator('.efsp-final-terminal')).toHaveText(['Ball', 'Waveoff']);
  await page.waitForTimeout(1500); // three PAR ticks
  expect(await page.evaluate(() => window.__parSeen.length)).toBe(0);
  expect(await page.evaluate(() => crc.parSamples.parSamples().length)).toBe(0);
  await row.locator('.efsp-final-terminal[data-terminal="WAVEOFF"]').click();
  await waitStrip(page, call, s => s.state === 'BOLTER_WAVEOFF', 'waveoff');
});
});
