/* The PAR panel's model (docs/wip/PAR-2.md; decisions H115, H116, H122; the sample is crc-sync docs/adr/0112). The DOM is the
 * Playwright spec's (e2e/par-panel.spec.js); here the rules: the glidepath in use, the tolerance colour above DA only, no plot for
 * 3 s, the flight's name, which flight the scopes show, the autoscale window, the zoom, and the trail across a runway change. */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../app/public/js/panels/efsp/par-model.js';

const JS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'public', 'js');
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const approach = (over) => ({
  id: 'LTAG-05', kind: 'RUNWAY', label: 'PAR RWY 05', runwayEnd: '05', airportIcao: 'LTAG', hullId: null,
  gpaDeg: 3.06, gpaPublished: false, tchFt: 50, tdzeFt: 238, dhFt: 200, daFt: 438, courseTrueDeg: 56, courseDisplay: { value: 51, ref: 'M' }, ...over,
});
const plot = (over) => ({ rangeNm: 3.36, heightFt: 1135, elevDeg: 3.04, elevDevDeg: -0.02, elevDevFt: -6, azDeg: -0.15, azDevFt: -55, gsKt: 142, vsFpm: -770, ...over });

test('the glidepath in use: a published angle wins, else the controller\'s default (H116)', () => {
  assert.equal(M.effectiveGpa(approach({ gpaPublished: true, gpaDeg: 3.5 }), 3.0), 3.5);
  assert.equal(M.effectiveGpa(approach(), 2.9), 2.9);
  assert.equal(M.effectiveGpa(approach(), undefined), 3.06);
  assert.equal(M.effectiveGpa(null, undefined), M.PAR_DEFAULTS.gpaDeg);
  assert.equal(M.PAR_DEFAULTS.gpaDeg, 3.06);
  assert.equal(M.PAR_DEFAULTS.tolElDeg, 1);
  assert.equal(M.PAR_DEFAULTS.tolAzDeg, 1);
  assert.equal(M.PAR_DEFAULTS.autoscale, true);
});

test('replot: the elevation deviation against the controller\'s angle, as docs/wip/PAR-1.md gives it; the same angle changes nothing', () => {
  const a = approach();
  const p = plot();
  assert.deepEqual(M.replot(p, a, 3.06), p);
  const r = M.replot(p, a, 3.0);
  near(r.elevDevDeg, 0.04);
  near(r.elevDevFt, 1135 - (50 + 3.36 * 6076.12 * Math.tan(3 * Math.PI / 180)));
  assert.equal(r.azDevFt, -55, 'azimuth untouched');
  assert.equal(M.replot(null, a, 3), null);
  const atTd = M.replot(plot({ rangeNm: 0, elevDeg: null, elevDevDeg: null }), a, 3.0);
  assert.equal(atTd.elevDevDeg, null, 'angles stay null at range 0');
});

test('DA: the glidepath reaches it at (DH - TCH) / tan(GPA)', () => {
  near(M.rangeAtDaNm(approach(), 3.06), 150 / (6076.12 * Math.tan(3.06 * Math.PI / 180)));
  assert.equal(M.rangeAtDaNm(approach({ dhFt: null }), 3.06), 0);
});

test('red outside a tolerance above DA; nothing coloured below DA (H116)', () => {
  const rDaNm = M.rangeAtDaNm(approach(), 3.06);
  assert.deepEqual(M.severity(plot(), { rDaNm }), { el: '', az: '' }, 'on the glidepath');
  assert.deepEqual(M.severity(plot({ elevDevDeg: 1.2 }), { rDaNm }), { el: 'danger', az: '' }, 'above');
  assert.deepEqual(M.severity(plot({ elevDevDeg: -1.01 }), { rDaNm }), { el: 'danger', az: '' }, 'below');
  assert.deepEqual(M.severity(plot({ azDeg: 1.3 }), { rDaNm }), { el: '', az: 'danger' }, 'right');
  assert.deepEqual(M.severity(plot({ azDeg: -1.3 }), { rDaNm }), { el: '', az: 'danger' }, 'left');
  assert.deepEqual(M.severity(plot({ elevDevDeg: 1 }), { rDaNm }), { el: '', az: '' }, 'on the line is inside');
  assert.deepEqual(M.severity(plot({ rangeNm: rDaNm * 0.9, elevDevDeg: -2, azDeg: 3 }), { rDaNm }), { el: '', az: '' }, 'below DA');
  assert.deepEqual(M.severity(plot({ elevDevDeg: 0.6 }), { rDaNm, tolElDeg: 0.5 }), { el: 'danger', az: '' }, 'the setting');
  assert.deepEqual(M.severity(plot({ elevDevDeg: null, azDeg: null }), { rDaNm }), { el: '', az: '' }, 'an INOP axis is never red');
});

test('no plot: amber at 3 s of plot age (frame age + time since it came), or 3 s with none at all; never under a double INOP', () => {
  const s = { plot: plot(), plotAgeMs: 500, sensor: { elevation: 'OK', azimuth: 'OK' } };
  assert.deepEqual(M.noPlotState(s, { receivedAtMs: 1000, nowMs: 3000 }), { amber: false, seconds: null });
  assert.deepEqual(M.noPlotState(s, { receivedAtMs: 1000, nowMs: 3500 }), { amber: true, seconds: 3 });
  assert.deepEqual(M.noPlotState({ ...s, plotAgeMs: 4200 }, { receivedAtMs: 1000, nowMs: 1000 }), { amber: true, seconds: 4 });
  const none = { plot: null, plotAgeMs: null, sensor: { elevation: 'OK', azimuth: 'OK' } };
  assert.equal(M.noPlotState(none, { nowMs: 2000, firstSeenMs: 0 }).amber, false);
  assert.deepEqual(M.noPlotState(none, { nowMs: 3000, firstSeenMs: 0 }), { amber: true, seconds: null });
  assert.equal(M.noPlotState({ ...none, sensor: { elevation: 'INOP', azimuth: 'INOP', reason: 'NO_APPROACH' } }, { nowMs: 9000, firstSeenMs: 0 }).amber, false);
});

test('several flights: the controller\'s pick holds while it is sent; otherwise the one nearest touchdown', () => {
  const a = { stripId: 'a', plot: { rangeNm: 6 } };
  const b = { stripId: 'b', plot: { rangeNm: 2 } };
  const c = { stripId: 'c', plot: null };
  assert.equal(M.pickFlight([a, b, c], null), 'b');
  assert.equal(M.pickFlight([a, b, c], 'a'), 'a');
  assert.equal(M.pickFlight([a, c], 'b'), 'a', 'the picked one left the final');
  assert.equal(M.pickFlight([c], null), 'c');
  assert.equal(M.pickFlight([], 'a'), null);
});

test('autoscale: the track at the golden-ratio point of the range until the window is 10 NM, then 10 NM', () => {
  const far = M.autoscaleView(plot({ rangeNm: 12.36, heightFt: 4000, azDevFt: 300 }), { gpaDeg: 3.06, tchFt: 50 });
  near(far.rMax, 12.36 / M.PHI);
  assert.ok(far.hMax >= 4000 / M.PHI - 1e-6);
  const near10 = M.autoscaleView(plot({ rangeNm: 3 }), { gpaDeg: 3.06, tchFt: 50 });
  assert.equal(near10.rMax, 10);
  const wide = M.autoscaleView(plot({ rangeNm: 3, azDevFt: 3000 }), { gpaDeg: 3.06, tchFt: 50 });
  near(wide.yMax, 3000 / M.PHI);
});

test('zoom: the wheel zooms the range, Shift this scope\'s vertical, anchored at touchdown and clamped', () => {
  const v = { ...M.DEFAULT_VIEW };
  const out = M.zoomView(v, 'el', false, 100);
  near(out.rMax, 10 * M.ZOOM_STEP);
  assert.equal(out.hMax, v.hMax);
  const tall = M.zoomView(v, 'el', true, -100);
  near(tall.hMax, 3500 / M.ZOOM_STEP);
  assert.equal(tall.yMax, v.yMax);
  const wide = M.zoomView(v, 'az', true, 100);
  near(wide.yMax, 1200 * M.ZOOM_STEP);
  let z = v;
  for (let i = 0; i < 60; i++) z = M.zoomView(z, 'el', false, -100);
  assert.equal(z.rMax, M.LIMITS.rMin);
});

test('the trail: plots ranged from an earlier approach are left out until they age out (the landing runway changed)', () => {
  const f = M.createTrailFilter();
  const t1 = [{ rangeNm: 5, heightFt: 1600, azDevFt: 0 }, { rangeNm: 4.9, heightFt: 1580, azDevFt: 0 }];
  const p1 = { rangeNm: 4.8, heightFt: 1560, azDevFt: 0 };
  assert.deepEqual(f.apply({ approach: { id: 'LTAG-05' }, plot: p1, trail: t1 }), t1);
  // switched: the trail and the plot still on screen were measured from the old threshold
  assert.deepEqual(f.apply({ approach: { id: 'LTAG-23' }, plot: p1, trail: t1 }), []);
  const p2 = { rangeNm: -4.7, heightFt: 1540, azDevFt: 9000 };
  assert.deepEqual(f.apply({ approach: { id: 'LTAG-23' }, plot: p2, trail: [...t1, p1] }), [], 'the old plot joins the trail and is left out too');
  const p3 = { rangeNm: -4.6, heightFt: 1520, azDevFt: 9000 };
  assert.deepEqual(f.apply({ approach: { id: 'LTAG-23' }, plot: p3, trail: [t1[1], p1, p2] }), [p2]);
  assert.deepEqual(f.apply({ approach: { id: 'LTAG-23' }, plot: { rangeNm: -4.5 }, trail: [p2, p3] }), [p2, p3]);
  assert.deepEqual(f.apply({ approach: { id: 'LTAG-23' }, plot: { rangeNm: -4.4 }, trail: [p2, p3, { rangeNm: -4.5 }] }).length, 3, 'nothing dropped any more');
});

test('readout: the flight row and deviations as the mockup writes them; INOP blanks the axis; ALT is TDZE + height', () => {
  const s = { approach: approach(), sensor: { elevation: 'OK', azimuth: 'OK', reason: null }, plot: plot() };
  const ro = M.readoutModel({ sample: s, plot: plot(), flight: { name: 'VIPER 21', type: 'F-16C', beacon: '4621' } });
  assert.equal(ro.range, '3.4');
  assert.equal(ro.gs, '142 kt');
  assert.equal(ro.vs, '−770');
  assert.equal(ro.el, '−6 ft');
  assert.equal(ro.az, '55 ft L');
  assert.equal(ro.alt, '1,373 ft');
  assert.equal(ro.noPlot, '');
  const inop = M.readoutModel({ sample: { ...s, sensor: { elevation: 'INOP', azimuth: 'OK', reason: 'NO_TDZE' } }, plot: plot({ heightFt: null, elevDevFt: null }), sev: { el: 'danger', az: '' } });
  assert.equal(inop.elInop, true);
  assert.equal(inop.el, '—');
  assert.equal(inop.alt, '—');
  assert.equal(inop.elSev, '', 'an INOP axis is never red');
  assert.equal(inop.inopReason, 'no touchdown zone elevation');
  assert.equal(M.readoutModel({ sample: s, plot: plot(), noPlot: { amber: true, seconds: 4 } }).noPlot, 'NO PLOT 4 s');
  assert.equal(M.readoutModel({ sample: s, plot: plot({ rangeNm: -0.12 }) }).range, '−0.1');
});

test('header: the runway (the PAR is airfield-only, H125)', () => {
  assert.deepEqual(M.headerModel(approach(), 3.06), { title: 'RWY 05 · LTAG', gpa: '3.06°', tch: '50', da: '438', fac: '051M' });
  assert.equal(M.headerModel(null, 3).title, 'NO APPROACH');
});

test('terminals are the final controller\'s FAA steps (crc-sync docs/adr/0117): Begin descent, Cleared to land, Landed, Missed approach; no Ball / Waveoff in the PAR (H125)', () => {
  assert.deepEqual(M.parTerminals().map(t => t.label), ['Begin descent', 'Cleared to land', 'Landed', 'Missed approach']);
  const [descent, cleared, landed, missed] = M.parTerminals();
  assert.deepEqual(M.parTerminalOp(descent), { kind: 'FinalCall', call: 'BEGIN_DESCENT' });
  assert.deepEqual(M.parTerminalOp(cleared), { kind: 'FinalCall', call: 'CLEARED_TO_LAND' });
  assert.deepEqual(M.parTerminalOp(landed), { kind: 'FinalCall', call: 'LANDED' });
  assert.deepEqual(M.parTerminalOp(missed), { kind: 'SetState', toState: 'BOLTER_WAVEOFF' });
  assert.equal(M.parTerminalOp(null), null);
  // a once-only call is recorded on the Strip; Landed and Missed approach are never "recorded"
  const strip = { finalCalls: { CLEARED_TO_LAND: { at: 1, by: 'u' } } };
  assert.deepEqual(M.parTerminals().map(t => M.parTerminalRecorded(strip, t)), [false, true, false, false]);
  assert.equal(M.parTerminalRecorded(null, descent), false);
});

test('the panel never tells the controller their job: no call prompts, no cadence (H115)', () => {
  for (const f of ['panels/efsp/par-model.js', 'panels/efsp/par-panel.js', 'panels/efsp/bay-views.js']) {
    const src = fs.readFileSync(path.join(JS, f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/cadence|mile call|required call|suggested call|DECISION ALTITUDE/i.test(src), `${f} prompts a call`);
  }
});

test('the PAR settings tab registers its four settings with the H116 defaults', async () => {
  const reg = await import('../app/public/js/settings-registry.js');
  await import('../app/public/js/panels/efsp/par-panel.js');
  const tab = reg.settingsTabs().find(t => t.id === 'par');
  assert.ok(tab);
  assert.deepEqual(tab.fields.map(f => [f.key, f.default]), [['parAutoscale', true], ['parGpa', 3.06], ['parTolEl', 1], ['parTolAz', 1]]);
});
