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
  gpaDeg: 3.06, tchFt: 50, tdzeFt: 238, dhFt: 200, daFt: 438, courseTrueDeg: 56, courseDisplay: { value: 51, ref: 'M' },
  defaults: { tdzeFt: 238, tchFt: 50, dhFt: 200, gpaDeg: 3.06 }, set: [], ...over,
});
const plot = (over) => ({ rangeNm: 3.36, heightFt: 1135, elevDeg: 3.04, elevDevDeg: -0.02, elevDevFt: -6, azDeg: -0.15, azDevFt: -55, gsKt: 142, vsFpm: -770, ...over });

test('the defaults: 3.06° only as a drawing fallback, tolerances H116 / H141', () => {
  assert.equal(M.PAR_DEFAULTS.gpaDeg, 3.06);
  assert.equal(M.PAR_DEFAULTS.tolElHighDeg, 1);
  assert.equal(M.PAR_DEFAULTS.tolElLowDeg, 0.5, 'the FAA lower safe limit (8200.1D B cursor, ADR 0123)');
  assert.equal(M.PAR_DEFAULTS.tolAzDeg, 1);
  assert.equal(M.PAR_DEFAULTS.autoscale, true);
  assert.equal('effectiveGpa' in M, false, 'no per-controller angle any more (crc-sync docs/adr/0130): the approach carries the one in use');
  assert.equal('replot' in M, false);
});

// crc-sync docs/adr/0130 (decisions H153): the approach values the PAR controller sets.
test('parseParValue: as the server checks it (ranges, rounding, units, empty = the default)', () => {
  assert.deepEqual(M.parseParValue('gpaDeg', '2.75'), { ok: true, value: 2.75 });
  assert.deepEqual(M.parseParValue('gpaDeg', ' 3,1° '), { ok: true, value: 3.1 });
  assert.deepEqual(M.parseParValue('gpaDeg', '2.754'), { ok: true, value: 2.75 });
  assert.equal(M.parseParValue('gpaDeg', '3.6').ok, false);
  assert.match(M.parseParValue('gpaDeg', '2.4').error, /2\.5 to 3\.5/);
  assert.deepEqual(M.parseParValue('tdzeFt', '238 ft'), { ok: true, value: 238 });
  assert.deepEqual(M.parseParValue('tdzeFt', '-12'), { ok: true, value: -12 });
  assert.deepEqual(M.parseParValue('tchFt', ''), { ok: true, value: null }, 'empty: back to the default');
  assert.equal(M.parseParValue('dhFt', '99').ok, false);
  assert.equal(M.parseParValue('dhFt', 'abc').ok, false);
  assert.equal(M.parseParValue('dhFt', '1e3').ok, false);
  assert.equal(M.parseParValue('courseTrueDeg', '56').ok, false);
});

test('PAR_VALUE_LIMITS mirror crc-sync surveillance/par.js verbatim', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const server = require('../../crc-sync/src/surveillance/par.js');
  assert.deepEqual(JSON.parse(JSON.stringify(M.PAR_VALUE_LIMITS)), JSON.parse(JSON.stringify(server.PAR_VALUE_LIMITS)));
  assert.deepEqual(M.PAR_VALUE_CELLS.map(c => c.field), [...server.PAR_VALUE_FIELDS]);
});

test('parValueCells: the values in force, which the controller set (marked), and the default each replaces', () => {
  const cells = M.parValueCells(approach({ tdzeFt: 240, gpaDeg: 2.8, daFt: 440, set: ['tdzeFt', 'gpaDeg'] }));
  assert.deepEqual(cells.map(c => [c.label, c.text, c.set, c.defaultText]), [
    ['TDZE', '240', true, '238'], ['TCH', '50', false, '50'], ['DH', '200', false, '200'], ['GPA', '2.80°', true, '3.06°'],
  ]);
  assert.match(cells[0].title, /set by the PAR controller; default 238/);
  const none = M.parValueCells(approach({ tdzeFt: null, defaults: { tdzeFt: null, tchFt: 50, dhFt: 200, gpaDeg: 3.06 } }));
  assert.equal(none[0].text, '');
  assert.equal(none[0].defaultText, 'none');
  assert.equal(M.parValueCells(null).length, 4);
});

test('the PAR panel draws the approach\'s own angle: no client replot, the setter is the SetParApproach owner', () => {
  const src = fs.readFileSync(path.join(JS, 'panels/efsp/par-panel.js'), 'utf8');
  assert.ok(!/parGpa/.test(src.replace(/\/\/.*$/gm, '')), 'no per-controller default glideslope setting');
  assert.ok(/RUNWAY_STATUS_ACTION_OWNERS\.SetParApproach/.test(src));
  assert.ok(/kind: 'SetParApproach'/.test(src));
});

test('DA: the glidepath reaches it at (DH - TCH) / tan(GPA)', () => {
  near(M.rangeAtDaNm(approach(), 3.06), 150 / (6076.12 * Math.tan(3.06 * Math.PI / 180)));
  assert.equal(M.rangeAtDaNm(approach({ dhFt: null }), 3.06), 0);
});

test('red outside a tolerance above DA; nothing coloured below DA (H116)', () => {
  const rDaNm = M.rangeAtDaNm(approach(), 3.06);
  assert.deepEqual(M.severity(plot(), { rDaNm }), { el: '', az: '' }, 'on the glidepath');
  assert.deepEqual(M.severity(plot({ elevDevDeg: 1.2 }), { rDaNm }), { el: 'danger', az: '' }, 'above');
  assert.deepEqual(M.severity(plot({ elevDevDeg: -0.51 }), { rDaNm }), { el: 'danger', az: '' }, 'below the lower safe limit');
  assert.deepEqual(M.severity(plot({ azDeg: 1.3 }), { rDaNm }), { el: '', az: 'danger' }, 'right');
  assert.deepEqual(M.severity(plot({ azDeg: -1.3 }), { rDaNm }), { el: '', az: 'danger' }, 'left');
  assert.deepEqual(M.severity(plot({ elevDevDeg: 1 }), { rDaNm }), { el: '', az: '' }, 'on the line is inside');
  assert.deepEqual(M.severity(plot({ rangeNm: rDaNm * 0.9, elevDevDeg: -2, azDeg: 3 }), { rDaNm }), { el: '', az: '' }, 'below DA');
  assert.deepEqual(M.severity(plot({ elevDevDeg: 0.6 }), { rDaNm, tolElHighDeg: 0.5 }), { el: 'danger', az: '' }, 'the upper setting');
  assert.deepEqual(M.severity(plot({ elevDevDeg: -0.6 }), { rDaNm, tolElLowDeg: 1 }), { el: '', az: '' }, 'the lower setting');
  assert.deepEqual(M.severity(plot({ elevDevDeg: null, azDeg: null }), { rDaNm }), { el: '', az: '' }, 'an INOP axis is never red');
});

test('safety (ADR 0123): 0.5-1° below the glidepath is red; 0.4° below is not; above, 1° still holds; below DA nothing', () => {
  const rDaNm = M.rangeAtDaNm(approach(), 3.06);
  assert.equal(M.severity(plot({ elevDevDeg: -0.7 }), { rDaNm }).el, 'danger', '0.7° low was grey under ±1°');
  assert.equal(M.severity(plot({ elevDevDeg: -0.9 }), { rDaNm }).el, 'danger');
  assert.equal(M.severity(plot({ elevDevDeg: -0.4 }), { rDaNm }).el, '');
  assert.equal(M.severity(plot({ elevDevDeg: -0.5 }), { rDaNm }).el, '', 'on the lower line is inside');
  assert.equal(M.severity(plot({ elevDevDeg: 0.7 }), { rDaNm }).el, '', '0.7° high stays inside +1°');
  assert.equal(M.severity(plot({ rangeNm: rDaNm * 0.5, elevDevDeg: -0.7 }), { rDaNm }).el, '', 'below DA the pilot decides (H116)');
  // the panel passes the controller's settings: a controller who widened only the upper limit keeps the lower one
  assert.equal(M.severity(plot({ elevDevDeg: -0.7 }), { rDaNm, tolElHighDeg: 2 }).el, 'danger');
});

test('a saved single elevation tolerance becomes the upper limit; the lower takes its default (ADR 0123)', async () => {
  const { migratePar } = await import('../app/public/js/settings.js');
  const old = { parTolEl: 1.5, parTolAz: 1 };
  migratePar(old);
  assert.deepEqual(old, { parTolElHigh: 1.5, parTolAz: 1 });
  const both = { parTolEl: 2, parTolElHigh: 0.8 };
  migratePar(both);
  assert.deepEqual(both, { parTolElHigh: 0.8 }, 'a value already set wins');
  const none = {};
  migratePar(none);
  assert.deepEqual(none, {});
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
  const far = M.autoscaleView(plot({ rangeNm: 12.36, heightFt: 4000, azDeg: 0.2 }), { gpaDeg: 3.06, tchFt: 50 });
  near(far.rMax, 12.36 / M.PHI);
  assert.ok(far.hMax >= 4000 / M.PHI - 1e-6);
  const near10 = M.autoscaleView(plot({ rangeNm: 3 }), { gpaDeg: 3.06, tchFt: 50 });
  assert.equal(near10.rMax, 10);
  // H164 FT-Q7 c (ADR 0139): the azimuth window is never autoscaled; it stays the controller's
  assert.equal(far.azMaxDeg, 3, 'the fixed default, ±3°');
  const wide = M.autoscaleView(plot({ rangeNm: 3, azDeg: -1.8 }), { gpaDeg: 3.06, tchFt: 50, azMaxDeg: 0.75 });
  assert.equal(wide.azMaxDeg, 0.75, 'a track off the course does not widen it: the controller\'s zoom stays');
  assert.equal(M.autoscaleView(plot({ azDeg: 14 }), {}).azMaxDeg, 3, 'even far off');
  assert.equal(M.LIMITS.azMaxDeg, 15);
  assert.equal('yMax' in wide, false, 'no feet window any more');
});

test('ADR 0139: a Shift+wheel on the azimuth scope zooms only the azimuth window and does not pause autoscale; anything else does', () => {
  assert.equal(M.zoomPausesAutoscale('az', true), false);
  assert.equal(M.zoomPausesAutoscale('az', false), true, 'the plain wheel zooms the range of both');
  assert.equal(M.zoomPausesAutoscale('el', true), true);
  assert.equal(M.zoomPausesAutoscale('el', false), true);
});

test('ADR 0139 (H164 FT-Q5): the needed and current headings, magnetic, and how far the aircraft is off the needed one', () => {
  const h = M.headingsModel({ headings: { needed: 47, current: 52, windFrom: 137, windKt: 20 } });
  assert.equal(h.needed, '047');
  assert.equal(h.current, '052');
  assert.equal(h.wind, '137/20');
  assert.equal(h.offDeg, 5, 'right of the needed heading is +');
  assert.equal(M.headingsModel({ headings: { needed: 358, current: 3, windFrom: null, windKt: null } }).offDeg, 5, 'the short way round north');
  assert.equal(M.headingsModel({ headings: { needed: 360, current: 355 } }).needed, '360');
  const none = M.headingsModel({ headings: { needed: null, current: 52, windFrom: null, windKt: null } });
  assert.equal(none.needed, '');
  assert.equal(none.offDeg, null);
  assert.match(none.title, /no field wind/);
  assert.deepEqual(M.headingsModel(null), { needed: '', current: '', wind: '', offDeg: null, title: M.headingsModel(null).title });
});

test('ADR 0139: crc-sync\'s GLIDESLOPE alert is said on the EL row; any other alert is not', () => {
  assert.equal(M.glidepathWarningText([{ kind: 'GLIDESLOPE', side: 'BELOW' }]), 'BELOW GLIDEPATH');
  assert.equal(M.glidepathWarningText([{ kind: 'HEADING' }, { kind: 'GLIDESLOPE', side: 'ABOVE' }]), 'ABOVE GLIDEPATH');
  assert.equal(M.glidepathWarningText([{ kind: 'LEVEL_BUST' }]), '');
  assert.equal(M.glidepathWarningText(undefined), '');
});

test('parity: the server\'s glidepath alert limits are the panel\'s default tolerance lines (ADR 0139, ADR 0123)', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(JS, '..', '..', '..', '..', 'crc-sync', 'config', 'alerting.json'), 'utf8')).conformance;
  assert.equal(cfg.glidepathAboveDeg, M.PAR_DEFAULTS.tolElHighDeg);
  assert.equal(cfg.glidepathBelowDeg, M.PAR_DEFAULTS.tolElLowDeg);
});

test('zoom: the wheel zooms the range, Shift this scope\'s vertical, anchored at touchdown and clamped', () => {
  const v = { ...M.DEFAULT_VIEW };
  const out = M.zoomView(v, 'el', false, 100);
  near(out.rMax, 10 * M.ZOOM_STEP);
  assert.equal(out.hMax, v.hMax);
  const tall = M.zoomView(v, 'el', true, -100);
  near(tall.hMax, 3500 / M.ZOOM_STEP);
  assert.equal(tall.azMaxDeg, v.azMaxDeg);
  const wide = M.zoomView(v, 'az', true, 100);
  near(wide.azMaxDeg, 3 * M.ZOOM_STEP);
  let n = v;
  for (let i = 0; i < 60; i++) n = M.zoomView(n, 'az', true, -100);
  assert.equal(n.azMaxDeg, M.LIMITS.azMinDeg);
  for (let i = 0; i < 60; i++) n = M.zoomView(n, 'az', true, 100);
  assert.equal(n.azMaxDeg, M.LIMITS.azMaxDeg);
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
  assert.equal(ro.az, '0.2° L', 'degrees only (H141 U-RQ4 b)');
  assert.ok(!/ft/.test(ro.az));
  assert.equal(M.readoutModel({ sample: s, plot: plot({ azDeg: 0.42 }) }).az, '0.4° R');
  assert.equal(M.readoutModel({ sample: s, plot: plot({ azDeg: 0.02 }) }).az, '0.0°');
  assert.equal(M.readoutModel({ sample: s, plot: plot({ azDeg: null }) }).az, '—');
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

test('azimuth axis labels are degrees, the course 0°; a plot past the edge is drawn at it', () => {
  assert.equal(M.azAxisLabel(0), '0°');
  assert.equal(M.azAxisLabel(-0.5), '0.5°L');
  assert.equal(M.azAxisLabel(1), '1°R');
  assert.equal(M.azAxisLabel(-1e-12), '0°');
  for (const d of [-2, -1.5, -0.25, 0.25, 2]) assert.ok(!/ft/.test(M.azAxisLabel(d)));
  assert.equal(M.clampTo(3.1, -2, 2), 2);
  assert.equal(M.clampTo(-7, -2, 2), -2);
  assert.equal(M.clampTo(0.4, -2, 2), 0.4);
  assert.deepEqual(M.DEFAULT_VIEW, { rMax: 10, hMax: 3500, azMaxDeg: 3 });
});

test('par-panel draws the azimuth scope in degrees: no feet conversion left in it (ADR 0123)', () => {
  const src = fs.readFileSync(path.join(JS, 'panels/efsp/par-panel.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/azDevFt|lateralFt|yMax/.test(src));
  assert.ok(/'tol-low'/.test(src) && /c\.tolElLow/.test(src) && /c\.tolElHigh/.test(src));
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
  assert.deepEqual(M.parTerminalOp(missed), { kind: 'FinalCall', call: 'MISSED_APPROACH' }, 'back to AP (H137 LT-PQ1 a)');
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

test('the PAR settings tab registers its settings with the H116 / H141 defaults', async () => {
  const reg = await import('../app/public/js/settings-registry.js');
  await import('../app/public/js/panels/efsp/par-panel.js');
  const tab = reg.settingsTabs().find(t => t.id === 'par');
  assert.ok(tab);
  assert.deepEqual(tab.fields.map(f => [f.key, f.default]), [['parAutoscale', true], ['parTolElHigh', 1], ['parTolElLow', 0.5], ['parTolAz', 1]]);
});
