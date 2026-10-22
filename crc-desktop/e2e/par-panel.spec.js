'use strict';

/* The PAR panel (docs/wip/PAR-2.md, docs/wip/U-PAR.md; mockup docs/mockups/par-panel.html, revision 5; decisions H115, H116, H122,
 * H141 (ADR 0123: azimuth in degrees, elevation lower limit 0.5°); the sample is
 * crc-sync docs/adr/0112). The harness has no DCS, so the server's PAR sample carries no plot: the spec replaces the samples of
 * every `par-sample` frame with its own (an EFSP message observer, as carrier-map.spec.js puts in the ship) and applies them at
 * once. Everything else is the real server: the Strips, AP's handoff to PAR (crc-sync docs/adr/0117), the carrier handoffs and
 * the terminal ops. Incirlik: one controller signed on to GC, AP and PAR. The carrier: one controller on the whole carrier.
 */

const { test, expect } = require('./helpers/test');
const { openPanel, serverTicks } = require('./helpers/app');

test.use({ viewport: { width: 1500, height: 1100 } });
test.setTimeout(90000);

let seq = 0;
const unique = () => String((Date.now() + seq++) % 10000);
const FT_PER_NM = 6076.12;
const RAD = Math.PI / 180;

const APPROACH_05 = {
  id: 'LTAG-05', label: 'PAR RWY 05', runwayEnd: '05', airportIcao: 'LTAG',
  gpaDeg: 3.06, tchFt: 50, tdzeFt: 238, dhFt: 200, daFt: 438, courseTrueDeg: 56, courseDisplay: { value: 51, ref: 'M' },
  defaults: { tdzeFt: 238, tchFt: 50, dhFt: 200, gpaDeg: 3.06 }, set: [],
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

/** Every `par-sample` frame carries the spec's samples (and empty-final approaches) while it has some; `null` lets the server's through. */
async function installSampleInjection(page) {
  await page.evaluate(() => {
    window.__par = { samples: null, approaches: null };
    crc.msgRegistry.addEfspMessageObserver((msg) => {
      if (msg && msg.type === 'par-sample' && window.__par.samples) msg.samples = JSON.parse(JSON.stringify(window.__par.samples));
      if (msg && msg.type === 'par-sample' && window.__par.approaches) msg.approaches = JSON.parse(JSON.stringify(window.__par.approaches));
    });
    // the panel's settings start at their defaults in every test
    for (const [k, v] of [['parAutoscale', true], ['parTolElHigh', 1], ['parTolElLow', 0.5], ['parTolAz', 1]]) crc.settingsRegistry.setSetting(k, v);
  });
}
const inject = (page, samples, approaches = null) => page.evaluate(([s, a]) => {
  window.__par.samples = s;
  window.__par.approaches = a;
  crc.parSamples.applyParSamples({ type: 'par-sample', at: Date.now(), samples: s ? JSON.parse(JSON.stringify(s)) : [], approaches: a ? JSON.parse(JSON.stringify(a)) : [] });
  crc.changeBus.markEfspChanged('par');
}, [samples, approaches]);

const panel = (page) => page.locator('#par-panel');
const field = (page, key) => panel(page).locator(`[data-par="${key}"]`);
const devItem = (page, key) => panel(page).locator(`[data-par-dev="${key}"]`);
const plotMark = (page, kind) => panel(page).locator(`[data-par-plot="${kind}"]`);
const view = (page) => page.evaluate(() => crc.par.parPanelView());

async function cleanUp(page, facility) {
  await page.evaluate((f) => {
    if (window.__par) { window.__par.samples = null; window.__par.approaches = null; }
    for (const s of crc.state.getAllEfspStrips()) {
      if (s.state !== 'DROPPED' && s.facilityId === f) crc.ws.sendEfspMutation(s.ownerPositionId, s, { kind: 'DropStrip', reason: 'e2e cleanup' });
    }
  }, facility);
  await expect.poll(() => page.evaluate((f) => crc.state.getAllEfspStrips().filter(s => s.state !== 'DROPPED' && s.facilityId === f).length, facility)).toBe(0);
}

/** A flight AP filed on an SFA frequency and handed to PAR at Incirlik, on final (the real Board); returns its Strip id. */
async function onParFinal(page, callsign, rack = 'freq-2') {
  await page.evaluate((c) => crc.ws.sendEfspCreateStrip('AP', { kind: 'CreateStrip', bayId: 'ap-inbound', rackId: 'main', stripType: 'ARRIVAL', flightData: { callsign: c, aircraftType: 'F-16C', originAirport: 'LTAG' } }), callsign);
  await waitStrip(page, callsign, s => s.ownerPositionId === 'AP', 'created at AP');
  await page.evaluate(([c, r]) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
    crc.ws.sendEfspMutation('AP', s, { kind: 'MoveStrip', bayId: 'ap-sfa', rackId: r });
  }, [callsign, rack]);
  await waitStrip(page, callsign, s => s.ownerPositionId === 'AP' && s.bayId === 'ap-sfa', 'on an SFA frequency');
  await page.evaluate((c) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
    crc.ws.sendEfspMutation('AP', s, { kind: 'TransferStrip', toPositionId: 'PAR', bayId: 'par-final', rackId: 'main' });
  }, callsign);
  await waitStrip(page, callsign, s => s.ownerPositionId === 'PAR' && s.state === 'ON_FINAL' && s.bayId === 'par-final', 'on PAR final');
  return (await stripOf(page, callsign)).stripId;
}

async function incirlik(page) {
  await openPanel(page, { signedOn: ['GC', 'AP', 'PAR'], controller: `e2e-par-${unique()}` });
  await installSampleInjection(page);
}

/** Opens the PAR panel the controller's way: the FINAL Strip's ⋯ menu, "Show in PAR panel" (H138 U10: ordinary Strips). */
async function openFromBay(page, positionId, bayId, name) {
  await openBay(page, positionId, bayId);
  await page.locator('.efsp-strip', { hasText: name }).locator('.efsp-strip-menu-btn').click();
  await page.locator('.efsp-strip-menu [data-strip-action="show-in-par"]').click();
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
  await expect(field(page, 'tdzeFt')).toHaveText('238');
  await expect(field(page, 'tchFt')).toHaveText('50');
  await expect(field(page, 'dhFt')).toHaveText('200');
  await expect(field(page, 'gpaDeg')).toHaveText('3.06°');
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
  await expect(panel(page).locator('.par-term')).toHaveText(['Begin descent', 'Cleared to land', 'Landed', 'Missed approach']);
  await expect(panel(page).locator('input, select, textarea')).toHaveCount(0); // nothing to type on final until a value is opened
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
  // safety (ADR 0123): 0.7° below is past the lower safe limit (0.5°) and red, where ±1° showed it grey
  await inject(page, [sample(id, { r: 4.2, elDev: -0.7 })]);
  await expect(plotMark(page, 'el')).toHaveAttribute('data-level', 'danger');
  await expect(devItem(page, 'el')).toHaveClass(/par-danger/);
  await expect(devItem(page, 'el')).toContainText('OUTSIDE TOLERANCE');
  await panel(page).screenshot({ path: test.info().outputPath('01-below-lower-safe-limit.png') });
  // 0.4° below is inside it
  await inject(page, [sample(id, { r: 4.2, elDev: -0.4 })]);
  await expect(plotMark(page, 'el')).toHaveAttribute('data-level', '');
  await expect(devItem(page, 'el')).not.toHaveClass(/par-danger/);
  // the elevation lines: the lower one 0.5° below the glidepath, the upper 1° above (drawn heights at the window's far edge)
  const lineEndFt = (tag) => page.evaluate((t) => {
    const p = document.querySelector(`#par-panel [data-par-line="${t}"]`);
    const m = /([\d.-]+) ([\d.-]+)$/.exec(p.getAttribute('d'));
    return Number(m[2]);
  }, tag);
  const [gpY, lowY, highY] = [await lineEndFt('glidepath'), await lineEndFt('tol-low'), await lineEndFt('tol-high')];
  expect(lowY).toBeGreaterThan(gpY);
  expect(highY).toBeLessThan(gpY);
  expect((lowY - gpY) / (gpY - highY)).toBeGreaterThan(0.4); // tan(2.56)…tan(3.06)…tan(4.06): about half the upper gap
  expect((lowY - gpY) / (gpY - highY)).toBeLessThan(0.6);
  // slightly off is grey (inside the limits)
  await inject(page, [sample(id, { r: 3.6, elDev: 0.35, azDeg: -0.9 })]);
  await expect(panel(page).locator('.par-danger')).toHaveCount(0);
  await expect(plotMark(page, 'el')).toHaveAttribute('data-level', '');
  await expect(devItem(page, 'az')).toContainText('0.9° L');
  // the azimuth scope is in degrees only (H141 U-RQ4 b): its axis, its window, its readout; the tolerance lines are straight
  const azLabels = await panel(page).locator('[data-par-axis="az"]').allTextContents();
  expect(azLabels).toContain('0°');
  expect(azLabels.some(t => /°L$/.test(t)) && azLabels.some(t => /°R$/.test(t))).toBe(true);
  expect(azLabels.join(' ')).not.toMatch(/ft/);
  await expect(panel(page).locator('[data-par-scope="az"] .par-win')).toContainText('±2°');
  await expect(panel(page).locator('[data-par-scope="az"] .par-win')).not.toContainText('ft');
  for (const tag of ['tol-left', 'tol-right', 'course']) {
    const ys = await page.evaluate((t) => [...document.querySelector(`#par-panel [data-par-line="${t}"]`).getAttribute('d').matchAll(/[ML][\d.-]+ ([\d.-]+)/g)].map(m => m[1]), tag);
    expect(new Set(ys).size, `${tag} is a straight line`).toBe(1);
  }
  // right of course, outside tolerance
  await inject(page, [sample(id, { r: 5.1, azDeg: 1.3 })]);
  await expect(plotMark(page, 'az')).toHaveAttribute('data-level', 'danger');
  await expect(devItem(page, 'az')).toHaveClass(/par-danger/);
  await expect(devItem(page, 'az')).toContainText('1.3° R');
  await expect(devItem(page, 'az')).not.toContainText('ft');
  await expect(devItem(page, 'el')).not.toHaveClass(/par-danger/);
  // left
  await inject(page, [sample(id, { r: 5.1, azDeg: -1.3 })]);
  await expect(devItem(page, 'az')).toHaveClass(/par-danger/);
  await expect(devItem(page, 'az')).toContainText('1.3° L');
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
  expect(v2.azMaxDeg).toBeCloseTo(zoomed.azMaxDeg, 6);
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

// crc-sync docs/adr/0130 (decisions H153): the approach values are the PAR controller's, held on the server per runway end.
const parValues = (page) => page.evaluate(() => {
  const r = crc.state.getEfspRunwayStatus('INCIRLIK');
  return r ? (r.parValues || {}) : null;
});

test('04 the approach values: PAR sets the angle in place, the server holds it, a set value is marked grey, Default and Escape; the Settings tab has four PAR settings', async ({ page }) => {
  await incirlik(page);
  const call = `PAR${unique()}`;
  const id = await onParFinal(page, call);
  await inject(page, [sample(id, { r: 4 })]);
  await openFromBay(page, 'PAR', 'par-final', call);
  await expect.poll(() => parValues(page)).toEqual({});
  const gpaCell = field(page, 'gpaDeg');
  await expect(gpaCell).toHaveAttribute('data-editable', '1');
  await expect(gpaCell).toHaveAttribute('data-set', '');

  // out of range: the field stays open and says the range, nothing coloured, nothing sent
  await gpaCell.click();
  const input = panel(page).locator('[data-par-input="gpaDeg"]');
  await expect(input).toHaveValue('3.06');
  await input.fill('4');
  await input.press('Enter');
  await expect(input).toHaveAttribute('data-invalid', '1');
  await expect(field(page, 'msg')).toContainText('2.5 to 3.5');
  await expect(panel(page).locator('.par-danger, .par-attn, .par-bad')).toHaveCount(0);
  await panel(page).screenshot({ path: test.info().outputPath('04-invalid.png') });
  // a valid angle: sent as SetParApproach, held on the runway-status record
  await input.fill('3.00');
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect.poll(() => parValues(page)).toEqual({ '05': { gpaDeg: 3 } });
  await expect(field(page, 'msg')).toHaveText('');

  // the server's next sample carries it (the harness has no DCS, so the spec's sample says what the monitor would)
  const setApproach = { ...APPROACH_05, gpaDeg: 3, set: ['gpaDeg'] };
  await inject(page, [sample(id, { r: 4, approach: setApproach })]);
  await expect(gpaCell).toHaveText('3.00°');
  await expect(gpaCell).toHaveAttribute('data-set', '1');
  await expect(gpaCell).toHaveClass(/par-set/);
  await expect(gpaCell).toHaveAttribute('title', /default 3\.06°/);
  await expect(field(page, 'tchFt')).toHaveAttribute('data-set', '');
  await expect(panel(page).locator('.par-danger, .par-attn, .par-bad')).toHaveCount(0); // a set value is grey (dark cockpit)
  await panel(page).screenshot({ path: test.info().outputPath('04-set.png') });

  // Escape abandons: nothing sent
  await field(page, 'tchFt').click();
  const tch = panel(page).locator('[data-par-input="tchFt"]');
  await tch.fill('60');
  await tch.press('Escape');
  await expect(tch).toHaveCount(0);
  await expect(field(page, 'tchFt')).toHaveText('50');
  // Default puts the angle back
  await gpaCell.click();
  await panel(page).locator('[data-par-default="gpaDeg"]').click();
  await expect.poll(() => parValues(page)).toEqual({});

  // the Settings panel's PAR tab: no per-controller glideslope any more
  await page.evaluate(() => crc.dock.toggleDockPanel('settings', true));
  await page.locator('.stab[data-pane="par"]').click();
  const pane = page.locator('#stab-par');
  await expect(pane.locator('#set-parAutoscale')).toBeChecked();
  await expect(pane.locator('#set-parGpa')).toHaveCount(0);
  await expect(pane.locator('#set-parTolElHigh')).toHaveValue('1');
  await expect(pane.locator('#set-parTolElLow')).toHaveValue('0.5');
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

  // a missed approach mid-run (the PAR panel's button): the Strip goes back to AP for another approach (H137 LT-PQ1 a), the
  // server's next frame is empty
  await page.evaluate(() => { window.__par.samples = null; });
  await panel(page).locator('.par-term[data-terminal="MISSED"]').click();
  await waitStrip(page, a, s => s.stripType === 'ARRIVAL' && s.state === 'INBOUND' && s.ownerPositionId === 'AP' && s.bayId === 'ap-sfa', 'missed approach: back to AP');
  await expect(panel(page).locator('#par-empty')).toBeVisible({ timeout: 5000 });
  await expect(panel(page).locator('#par-empty')).toHaveText('No aircraft on your final.');
});

test('06 Landed from the PAR panel: the Strip goes to GC and PAR\'s Bay frees (T5); a second aircraft is handed in; the controller signs off: the sample stops and the panel empties', async ({ page }) => {
  await incirlik(page);
  const a = `PL${unique()}`;
  const id = await onParFinal(page, a);
  await inject(page, [sample(id, { r: 1 })]);
  await openFromBay(page, 'PAR', 'par-final', a);
  await panel(page).locator('.par-term[data-terminal="CLEARED_TO_LAND"]').click();
  await expect(panel(page).locator('.par-term[data-terminal="CLEARED_TO_LAND"]')).toBeDisabled(); // recorded, greyed
  await page.evaluate(() => { window.__par.samples = null; });
  await panel(page).locator('.par-term[data-terminal="LANDED"]').click();
  await waitStrip(page, a, s => s.stripType === 'ARRIVAL' && s.state === 'TAXI_IN' && s.ownerPositionId === 'GC' && s.bayId === 'gc-taxi-in', 'landed: with GC');
  await expect(panel(page).locator('#par-empty')).toBeVisible({ timeout: 5000 });

  // the first Strip is still live (with GC), and PAR's final Bay is free: a second flight is handed to PAR at once
  const b = `PS${unique()}`;
  const idb = await onParFinal(page, b, 'freq-3');
  expect((await stripOf(page, a)).ownerPositionId).toBe('GC');
  await inject(page, [sample(idb, { r: 4 })]);
  await expect(field(page, 'name')).toHaveText(b);
  await page.evaluate(() => { window.__par.samples = null; });
  // (signing off PAR alone would not stop it: this controller also holds AP, which takes PAR's hat, ADR 0110, and is sent the
  // same sample; so the controller signs off everything)
  await page.evaluate(() => crc.ws.sendEfspSetPositions('INCIRLIK', []));
  await expect(panel(page).locator('#par-empty')).toBeVisible({ timeout: 5000 });
  await page.evaluate(() => crc.ws.sendEfspSetPositions('INCIRLIK', ['GC', 'AP', 'PAR']));
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
  await serverTicks(page, 3); // the PAR ticks every 500 ms, the hub's heartbeat no faster
  expect(await page.evaluate(() => window.__parSeen.length)).toBe(0);
  expect(await page.evaluate(() => crc.parSamples.parSamples().length)).toBe(0);
  await row.locator('.efsp-final-terminal[data-terminal="WAVEOFF"]').click();
  await waitStrip(page, call, s => s.state === 'BOLTER_WAVEOFF', 'waveoff');
});

test('08 an empty final: the approach values stay on the header and PAR sets one with no aircraft (H161 V2-Q1 a); the note stays', async ({ page }) => {
  await incirlik(page);
  // the harness has no wind, so no active runway: the spec's frame names the approach the server would (the active runway end's)
  await inject(page, [], [{ facilityId: 'INCIRLIK', positionId: 'PAR', approach: APPROACH_05 }]);
  await page.evaluate(() => crc.dock.toggleDockPanel('par', true));
  await expect(panel(page).locator('#par-empty')).toBeVisible();
  await expect(panel(page).locator('#par-empty')).toHaveText('No aircraft on your final.');
  await expect(panel(page).locator('#par-body')).toBeVisible();
  await expect(field(page, 'title')).toHaveText('RWY 05 · LTAG');
  await expect(field(page, 'da')).toHaveText('438');
  // nothing about a flight: no flight row, no scope, no terminal button, no picks with one final
  await expect(field(page, 'name')).toBeHidden();
  await expect(panel(page).locator('[data-par-scope]')).toHaveCount(2);
  await expect(panel(page).locator('[data-par-scope="el"]')).toBeHidden();
  await expect(panel(page).locator('.par-term')).toHaveCount(0);
  await expect(panel(page).locator('[data-par="picks"]')).toBeHidden();
  await expect(panel(page).locator('.par-danger, .par-attn, .par-bad')).toHaveCount(0);
  await expect.poll(() => parValues(page)).toEqual({});

  const gpaCell = field(page, 'gpaDeg');
  await expect(gpaCell).toHaveAttribute('data-editable', '1');
  await gpaCell.click();
  const input = panel(page).locator('[data-par-input="gpaDeg"]');
  await expect(input).toHaveValue('3.06');
  await input.fill('3.00');
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect.poll(() => parValues(page)).toEqual({ '05': { gpaDeg: 3 } }); // the real server took it with nobody on the final
  await inject(page, [], [{ facilityId: 'INCIRLIK', positionId: 'PAR', approach: { ...APPROACH_05, gpaDeg: 3, set: ['gpaDeg'] } }]);
  await expect(gpaCell).toHaveText('3.00°');
  await expect(gpaCell).toHaveAttribute('data-set', '1');
  await panel(page).screenshot({ path: test.info().outputPath('08-empty-final-set.png') });

  // the first aircraft arrives: the same header, now with its flight; it leaves: the header stays
  const call = `PE${unique()}`;
  const id = await onParFinal(page, call);
  const setApproach = { ...APPROACH_05, gpaDeg: 3, set: ['gpaDeg'] };
  await inject(page, [sample(id, { r: 4, approach: setApproach })], [{ facilityId: 'INCIRLIK', positionId: 'PAR', approach: setApproach }]);
  await expect(panel(page).locator('#par-empty')).toBeHidden();
  await expect(field(page, 'name')).toHaveText(call);
  await expect(gpaCell).toHaveText('3.00°');
  await inject(page, [], [{ facilityId: 'INCIRLIK', positionId: 'PAR', approach: setApproach }]);
  await expect(panel(page).locator('#par-empty')).toBeVisible();
  await expect(field(page, 'name')).toBeHidden();
  await expect(gpaCell).toHaveText('3.00°');

  // back to the default (the record is shared with every other test)
  await gpaCell.click();
  await panel(page).locator('[data-par-default="gpaDeg"]').click();
  await expect.poll(() => parValues(page)).toEqual({});

  // no approach named (no active runway, or not this controller's final): the note alone
  await inject(page, [], []);
  await expect(panel(page).locator('#par-body')).toBeHidden();
  await expect(panel(page).locator('#par-empty')).toBeVisible();
});
