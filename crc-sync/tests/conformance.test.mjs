import { test } from 'node:test';
import assert from 'node:assert/strict';

// Tests drive tick(t) with a virtual instant; the wall clock (docs/adr/0096) follows it, so only the
// divergence tests below separate the two.
const wallFollows = (m) => { const raw = m.tick.bind(m); m.tick = (t, w = t) => raw(t, w); return m; };

// docs/adr/0058 — conformance: only what is wrong is ever reported.
const { evaluateConformance, headingDiff, FPM_PER_MS, MS_PER_KT } = await import('../src/efsp/conformance.js');
const { loadAlertingConfig } = await import('../src/alerting-config.js');
const DEFAULTS = loadAlertingConfig();
const { indicatedAltFt } = await import('../src/altimetry.js');

const cfg = DEFAULTS.conformance;
const FAST = 250 * MS_PER_KT;
const fpm = (v) => v / FPM_PER_MS;
const S = 1000;

/** Runs one flight through a sequence of [secondsFromStart, input] and returns the alerts at the last step. */
function run(steps, base = {}) {
  const mem = {};
  let alerts = [];
  for (const [t, over] of steps) {
    alerts = evaluateConformance({ hdg: null, alt: null, course: 50, groundSpeedMs: FAST, verticalSpeedMs: 0, altFt: 10000, ...base, ...over }, mem, t * S, cfg);
  }
  return alerts;
}
const kinds = (alerts) => alerts.map(a => a.kind);

test('headings compare the short way round', () => {
  assert.equal(headingDiff(355, 5), 10);
  assert.equal(headingDiff(90, 270), 180);
});

test('a flight with no clearance, or on the ground, never alerts', () => {
  assert.deepEqual(run([[0, {}], [60, { course: 200, verticalSpeedMs: fpm(-3000) }]]), []);
  assert.deepEqual(run([[0, { alt: { parsed: 5000, at: 0 }, hdg: { parsed: 50, at: 0 }, groundSpeedMs: 5, course: 300 }], [60, {}]]), []);
});

test('heading: off by more than 5° after the grace and 10 s persistence, and clears when back on', () => {
  const hdg = { parsed: 50, at: 0 };
  // Still turning inside the 30 s grace: nothing.
  assert.deepEqual(run([[0, { hdg, course: 120 }], [25, { hdg, course: 90 }]]), []);
  // Off 22° from 30 s on; alerts once it has been off for 10 s.
  const steps = [[0, { hdg, course: 120 }], [31, { hdg, course: 72 }], [40, { hdg, course: 72 }]];
  assert.deepEqual(run(steps), []);
  const late = run([...steps, [41, { hdg, course: 72 }]]);
  assert.deepEqual(kinds(late), ['HEADING']);
  assert.equal(late[0].assigned, 50);
  assert.equal(late[0].actual, 72);
  assert.deepEqual(run([...steps, [41, { hdg, course: 72 }], [42, { hdg, course: 53 }]]), [], '3° off is conforming');
  // Captured early ends the grace: back off course at 10 s alerts from 20 s.
  assert.deepEqual(kinds(run([[0, { hdg, course: 51 }], [10, { hdg, course: 80 }], [20, { hdg, course: 80 }]])), ['HEADING']);
});

test('descend when ready: told to descend and still level is conforming, however long it takes', () => {
  const alt = { parsed: 5000, at: 0 };
  assert.deepEqual(run([[0, { alt, altFt: 12000 }], [600, { alt, altFt: 12000, verticalSpeedMs: 0 }]]), []);
  // And a slow climb toward it is fine too.
  assert.deepEqual(run([[0, { alt: { parsed: 18000, at: 0 }, altFt: 9000, verticalSpeedMs: fpm(200) }], [120, { alt: { parsed: 18000, at: 0 }, altFt: 9400, verticalSpeedMs: fpm(200) }]]), []);
});

test('wrong way: told to climb and descending (or the reverse) faster than 500 ft/min for 5 s', () => {
  const alt = { parsed: 18000, at: 0 };
  const steps = [[0, { alt, altFt: 9000, verticalSpeedMs: fpm(-1200) }], [4, { alt, altFt: 8900, verticalSpeedMs: fpm(-1200) }]];
  assert.deepEqual(run(steps), [], 'not yet 5 s');
  const now = run([...steps, [5, { alt, altFt: 8880, verticalSpeedMs: fpm(-1200) }]]);
  assert.deepEqual(kinds(now), ['WRONG_WAY']);
  assert.equal(now[0].fpm, -1200);
  // Told to descend and climbing.
  const down = { parsed: 5000, at: 0 };
  assert.deepEqual(kinds(run([[0, { alt: down, altFt: 12000, verticalSpeedMs: fpm(800) }], [6, { alt: down, altFt: 12080, verticalSpeedMs: fpm(800) }]])), ['WRONG_WAY']);
});

test('level bust: reached within ±400 ft, then more than 500 ft away for 3 s', () => {
  const alt = { parsed: 18000, at: 0 };
  // Never reached it: 600 ft short while climbing is not a bust.
  assert.deepEqual(run([[0, { alt, altFt: 17400, verticalSpeedMs: fpm(1000) }], [10, { alt, altFt: 17400 }]]), []);
  // Reached (within 400), then 600 high.
  const steps = [[0, { alt, altFt: 17700 }], [10, { alt, altFt: 18600 }], [12, { alt, altFt: 18600 }]];
  assert.deepEqual(run(steps), [], 'not yet 3 s');
  const bust = run([...steps, [13, { alt, altFt: 18610 }]]);
  assert.deepEqual(kinds(bust), ['LEVEL_BUST']);
  assert.equal(bust[0].deviationFt, 610);
  // 450 ft off after reaching is inside the bust threshold.
  assert.deepEqual(run([[0, { alt, altFt: 18000 }], [10, { alt, altFt: 18450 }], [20, { alt, altFt: 18450 }]]), []);
});

test('a new clearance starts over: reached / captured state belongs to the entry', () => {
  const first = { parsed: 18000, at: 0 };
  const second = { parsed: 10000, at: 50 * S };
  // Reached FL180, then cleared down to 10000 and descending: that is conforming, not a bust.
  assert.deepEqual(run([[0, { alt: first, altFt: 18000 }], [50, { alt: second, altFt: 17000, verticalSpeedMs: fpm(-1500) }], [60, { alt: second, altFt: 16000, verticalSpeedMs: fpm(-1500) }]]), []);
});

test('altitudes are compared as the controller reads them: QNH below transition, flight level above', () => {
  // ISA day: indicated equals true (within rounding) below and above transition.
  assert.ok(Math.abs(indicatedAltFt(3048, { pressurePa: 101325, tempK: 288.15 }, 18000) - 10000) < 60);
  // Below transition the altimeter is set to QNH, so it reads true altitude whatever the QNH.
  assert.ok(Math.abs(indicatedAltFt(3048, { pressurePa: 99000, tempK: 288.15 }, 18000) - indicatedAltFt(3048, { pressurePa: 101325, tempK: 288.15 }, 18000)) < 1);
  // Above it the altimeter is on standard pressure: on a low-pressure day the
  // same true altitude reads as a HIGHER flight level.
  assert.ok(indicatedAltFt(7000, { pressurePa: 99000, tempK: 288.15 }, 18000) > indicatedAltFt(7000, { pressurePa: 101325, tempK: 288.15 }, 18000) + 300);
});

test('the monitor reads correlation, track and clearance, and reports a flight only while it is wrong', async () => {
  const { ConformanceMonitor } = await import('../src/efsp/conformance.js');
  const flightData = { flightDataId: 'f1', clearance: { heading: { entries: [{ value: '050', parsed: 50, status: 'ACTIVE', at: 0 }] }, altitude: { entries: [] } } };
  const track = { id: 't1', alt: 3048, course: 90, groundSpeed: FAST, verticalSpeed: 0 };
  const monitor = new ConformanceMonitor({
    trackStore: { get: (id) => (id === 't1' ? track : null) },
    flightDataStore: { getFlightData: (id) => (id === 'f1' ? flightData : null) },
    correlationStore: { getAll: () => [{ flightDataId: 'f1', trackId: 't1', state: 'CORRELATED' }] },
    weather: () => ({ pressurePa: 101325, tempK: 288.15 }),
    transitionAltFt: () => 18000,
    indicatedAltFt,
    gridToMagnetic: (deg) => deg, // the frame conversion has its own tests below
    config: cfg,
  });
  wallFollows(monitor);
  monitor.tick(0); // first sight of the clearance: the wall-clock grace starts here (docs/adr/0096)
  assert.equal(monitor.tick(31 * S), false, 'deviating, but not for 10 s yet');
  assert.equal(monitor.tick(41 * S), true);
  assert.deepEqual(monitor.getAll().map(r => [r.flightDataId, r.alerts[0].kind]), [['f1', 'HEADING']]);
  track.course = 50;
  assert.equal(monitor.tick(42 * S), true, 'back on heading: the flight drops off the list');
  assert.deepEqual(monitor.getAll(), []);
  assert.equal(monitor.tick(43 * S), false);
});

// ── on a final (docs/adr/0139, H164 FT-Q8; ADR 0117) ──────────────────────
// From the moment the final Position holds the flight nothing of its clearance is checked (no heading, no level bust, no
// wrong way); the one alert is GLIDESLOPE, after Begin descent, above DA. A missed approach is checked again.

async function finalMonitor(onFinal) {
  const { ConformanceMonitor } = await import('../src/efsp/conformance.js');
  const flightData = { flightDataId: 'f1', clearance: {
    heading: { entries: [{ value: '050', parsed: 50, status: 'ACTIVE', at: 0 }] },
    altitude: { entries: [{ value: '030', parsed: 3000, block: null, status: 'ACTIVE', at: 0 }] },
  } };
  // flying 090 (40 degrees off AP's last vector) and 1,500 ft below the 3,000 it reached, descending
  const track = { id: 't1', alt: 3000 / 3.28084, course: 90, groundSpeed: FAST, verticalSpeed: fpm(-700) };
  const finals = new Map(onFinal ? [['f1', onFinal]] : []);
  const monitor = new ConformanceMonitor({
    trackStore: { get: () => track },
    flightDataStore: { getFlightData: () => flightData },
    correlationStore: { getAll: () => [{ flightDataId: 'f1', trackId: 't1', state: 'CORRELATED' }] },
    weather: () => ({ pressurePa: 101325, tempK: 288.15 }),
    transitionAltFt: () => 18000,
    indicatedAltFt,
    gridToMagnetic: (deg) => deg,
    config: cfg,
    finals: () => finals,
  });
  wallFollows(monitor);
  monitor.tick(0);
  track.alt = 1500 / 3.28084;
  for (let t = 1; t <= 60; t++) monitor.tick(t * S);
  return { monitor, finals, flightData, track };
}

test('not on a final: AP\'s vector and altitude alert as ever (the control case)', async () => {
  const { monitor } = await finalMonitor(null);
  assert.deepEqual(kinds(monitor.getAll()[0].alerts).sort(), ['HEADING', 'LEVEL_BUST']);
});

test('FT-Q8: held by PAR, its own "descend and maintain" below the altitude it was handed at raises no bust, before Begin descent too', async () => {
  const { monitor } = await finalMonitor({ glidepath: null });
  assert.deepEqual(monitor.getAll(), [], 'no HEADING, no LEVEL_BUST, no WRONG_WAY once the final Position has the flight');
});

test('leaving the final (a missed approach) brings the checks back against what is then assigned', async () => {
  const { monitor, finals } = await finalMonitor({ glidepath: null });
  finals.delete('f1');
  for (let t = 61; t <= 120; t++) monitor.tick(t * S);
  assert.ok(kinds(monitor.getAll()[0].alerts).includes('HEADING'));
});

test('GLIDESLOPE: after Begin descent, outside the limits for the persistence, above and below; never inside DA', async () => {
  const entry = { glidepath: { elevDevDeg: 0.3, beyondDa: true } };
  const { monitor } = await finalMonitor(entry);
  assert.deepEqual(monitor.getAll(), [], 'on the glidepath: nothing');
  entry.glidepath = { elevDevDeg: -0.8, beyondDa: true };
  monitor.tick(61 * S);
  assert.deepEqual(monitor.getAll(), [], 'below, but not for the persistence yet');
  assert.equal(monitor.tick(61 * S + cfg.glidepathPersistSec * S), true);
  const [a] = monitor.getAll()[0].alerts;
  assert.equal(a.kind, 'GLIDESLOPE');
  assert.equal(a.side, 'BELOW');
  assert.equal(a.limitDeg, cfg.glidepathBelowDeg);
  assert.equal(a.since, 61 * S);
  entry.glidepath = { elevDevDeg: -0.9, beyondDa: true };
  assert.equal(monitor.tick(70 * S), false, 'a drifting deviation on the same side is the same alert');
  entry.glidepath = { elevDevDeg: 1.4, beyondDa: true };
  monitor.tick(71 * S);
  assert.deepEqual(monitor.getAll(), [], 'the other side starts its own persistence');
  monitor.tick(71 * S + cfg.glidepathPersistSec * S);
  assert.equal(monitor.getAll()[0].alerts[0].side, 'ABOVE');
  entry.glidepath = { elevDevDeg: 1.4, beyondDa: false };
  assert.equal(monitor.tick(80 * S), true);
  assert.deepEqual(monitor.getAll(), [], 'inside DA the pilot decides (H116): nothing');
  entry.glidepath = null;
  monitor.tick(81 * S);
  assert.deepEqual(monitor.getAll(), [], 'no plot (or no Begin descent): nothing');
});

test('evaluateGlidepath: the limits are the PAR panel defaults, +1 deg above and 0.5 deg below, on the line is inside', async () => {
  const { evaluateGlidepath } = await import('../src/efsp/conformance.js');
  assert.equal(cfg.glidepathAboveDeg, 1);
  assert.equal(cfg.glidepathBelowDeg, 0.5);
  const at = (dev) => { const mem = {}; evaluateGlidepath({ elevDevDeg: dev, beyondDa: true }, mem, 0, cfg, 0); return evaluateGlidepath({ elevDevDeg: dev, beyondDa: true }, mem, 10 * S, cfg, 10 * S); };
  assert.deepEqual(at(1), []);
  assert.deepEqual(at(-0.5), []);
  assert.equal(at(1.01)[0].side, 'ABOVE');
  assert.equal(at(-0.51)[0].side, 'BELOW');
});

// ── frames (docs/adr/0085, S-F2) ─────────────────────────────────────────
// The HDG is typed magnetic; DCS's course is grid. Over Syria the two differ
// by about 7°, so comparing them raw alerts on a pilot flying the heading
// exactly. The monitor converts the course with theater-context.js first.

async function syriaMonitor(course, { theatre = 'Syria', at = [37.0, 35.43] } = {}) {
  const path = await import('path');
  const { ConformanceMonitor } = await import('../src/efsp/conformance.js');
  const { TheaterContext } = await import('../src/theater-context.js');
  const { loadTheaters } = await import('../src/theaters.js');
  const theaters = loadTheaters(path.join(import.meta.dirname, '../config/theaters.json'));
  const ctx = new TheaterContext({ theaters, clock: { now: () => Date.UTC(2026, 0, 15), source: 'MISSION' } });
  ctx.setMission({ theatre, airports: [{ lat: at[0], lon: at[1] }] });
  const flightData = { flightDataId: 'f1', clearance: { heading: { entries: [{ value: '050', parsed: 50, status: 'ACTIVE', at: 0 }] }, altitude: { entries: [] } } };
  const track = { id: 't1', lat: at[0], lon: at[1], alt: 3048, course, groundSpeed: FAST, verticalSpeed: 0 };
  const monitor = new ConformanceMonitor({
    trackStore: { get: () => track },
    flightDataStore: { getFlightData: () => flightData },
    correlationStore: { getAll: () => [{ flightDataId: 'f1', trackId: 't1', state: 'CORRELATED' }] },
    weather: () => ({ pressurePa: 101325, tempK: 288.15 }),
    transitionAltFt: () => 10000,
    indicatedAltFt,
    gridToMagnetic: (deg, lat, lon) => ctx.gridToMagnetic(deg, lat, lon),
    config: cfg,
  });
  wallFollows(monitor);
  // The grid course a pilot flying 050 magnetic at this spot actually shows.
  const onHeadingGrid = 50 + ctx.variationAt(...at) - ctx.convergenceAt(...at);
  return { monitor, track, onHeadingGrid };
}

test('a pilot flying the assigned heading exactly over Syria raises no alert (grid course ≠ magnetic by ~7°)', async () => {
  const { monitor, track, onHeadingGrid } = await syriaMonitor(0);
  track.course = onHeadingGrid;
  assert.ok(headingDiff(onHeadingGrid, 50) > cfg.headingToleranceDeg, 'the raw grid course would have alerted');
  for (let t = 0; t <= 120; t += 5) monitor.tick(t * S);
  assert.deepEqual(monitor.getAll(), []);
});

test('a genuine 20° deviation still alerts, and the reported actual is magnetic', async () => {
  const { monitor, track, onHeadingGrid } = await syriaMonitor(0);
  track.course = onHeadingGrid + 20;
  for (let t = 0; t <= 120; t += 5) monitor.tick(t * S);
  const [{ alerts: [alert] }] = monitor.getAll();
  assert.equal(alert.kind, 'HEADING');
  assert.equal(alert.assigned, 50);
  assert.equal(alert.actual, 70, 'magnetic, not the grid value');
  assert.notEqual(alert.actual, Math.round(track.course));
});

test('unknown magnetic course (no projection for the theater, or no converter): no heading alert at all', async () => {
  const { monitor, track } = await syriaMonitor(0, { theatre: 'Afghanistan', at: [34, 66] });
  track.course = 180; // way off 050 in any frame
  for (let t = 0; t <= 120; t += 5) monitor.tick(t * S);
  assert.deepEqual(monitor.getAll(), []);

  const { ConformanceMonitor } = await import('../src/efsp/conformance.js');
  const bare = new ConformanceMonitor({
    trackStore: { get: () => track },
    flightDataStore: { getFlightData: () => ({ flightDataId: 'f1', clearance: { heading: { entries: [{ parsed: 50, status: 'ACTIVE', at: 0 }] }, altitude: { entries: [] } } }) },
    correlationStore: { getAll: () => [{ flightDataId: 'f1', trackId: 't1', state: 'CORRELATED' }] },
    weather: () => ({}), transitionAltFt: () => 18000, indicatedAltFt, config: cfg,
  });
  wallFollows(bare);
  for (let t = 0; t <= 120; t += 5) bare.tick(t * S);
  assert.deepEqual(bare.getAll(), [], 'no converter injected: never a cross-frame compare');
});

// ── persistence durations run on the wall clock (docs/adr/0096, H102) ─────
// steps: [missionSec, wallSec, input]. `since` stays mission time.
function runWall(steps, base = {}) {
  const mem = {};
  let alerts = [];
  for (const [m, w, over] of steps) {
    alerts = evaluateConformance({ hdg: null, alt: null, course: 50, groundSpeedMs: FAST, verticalSpeedMs: 0, altFt: 10000, ...base, ...over }, mem, m * S, cfg, w * S);
  }
  return alerts;
}

test('heading persistence is wall time: a paused or jumping mission clock does not change it', () => {
  const hdg = { parsed: 50, at: 0 };
  const dev = { hdg, course: 90 };
  const w0 = 100; // grace over: first seen at wall 0
  const first = [[0, 0, { hdg, course: 50 }], [0, w0, dev]];
  // mission clock paused for 60 s of wall time: alert fires
  const paused = runWall([...first, [0, w0 + 11, dev]]);
  assert.deepEqual(kinds(paused), ['HEADING']);
  assert.equal(paused[0].since, 0, '`since` is mission time');
  // mission clock jumps an hour, wall only 5 s: no alert
  assert.deepEqual(runWall([...first, [3600, w0 + 5, dev]]), []);
});

test('wrong-way persistence is wall time: a paused or jumping mission clock does not change it', () => {
  const alt = { parsed: 12000, at: 0 };
  const dev = { alt, altFt: 10000, verticalSpeedMs: fpm(-1500) };
  const start = [0, 0, dev];
  assert.deepEqual(kinds(runWall([start, [0, 31, dev]])), ['WRONG_WAY']);
  assert.deepEqual(runWall([start, [3600, 4, dev]]), []);
});

test('level-bust persistence is wall time: a paused or jumping mission clock does not change it', () => {
  const alt = { parsed: 10000, at: 0 };
  const on = { alt, altFt: 10000 };
  const bust = { alt, altFt: 10800 };
  const pre = [[0, 0, on], [1, 1, bust]];
  assert.deepEqual(kinds(runWall([...pre, [1, 1 + cfg.levelBustPersistSec + 1, bust]])), ['LEVEL_BUST']);
  assert.deepEqual(runWall([...pre, [3600, 3, bust]]), []);
});

// ── under MARSA with a tanker (docs/adr/0118, T17, H134 LT-RQ10) ───────────────────────────────
const { evaluateRefuelingBlock, refuelingReceivers, ConformanceMonitor: CM } = await import('../src/efsp/conformance.js');

function runAr(steps) {
  const mem = {};
  let alerts = [];
  for (const [t, over] of steps) {
    alerts = evaluateRefuelingBlock({ altFt: 20000, verticalSpeedMs: 0, groundSpeedMs: FAST, tankerAltFt: 22000, distanceNm: 1, tanker: 'SHELL71', ...over }, mem, t * S, cfg);
  }
  return alerts;
}

test('AR block: 2,000 ft below the tanker and climbing toward it is fine', () => {
  assert.deepEqual(runAr([[0, { verticalSpeedMs: fpm(1500) }], [10, { verticalSpeedMs: fpm(1500) }]]), []);
});

test('AR block: 1,350 ft below and descending away is WRONG_WAY, named after the tanker', () => {
  const alerts = runAr([[0, { altFt: 20650, verticalSpeedMs: fpm(-800) }], [6, { altFt: 20600, verticalSpeedMs: fpm(-800) }]]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, 'WRONG_WAY');
  assert.equal(alerts[0].tanker, 'SHELL71');
  assert.deepEqual(alerts[0].block, { lowFt: 21000, highFt: 23000 });
});

test('AR block: once in it, drifting out within our buffer is quiet; beyond it is LEVEL_BUST', () => {
  assert.deepEqual(runAr([[0, { altFt: 21500 }], [5, { altFt: 20600 }], [10, { altFt: 20600 }]]), [], '400 ft out: inside the buffer');
  const bust = runAr([[0, { altFt: 21500 }], [5, { altFt: 20300 }], [10, { altFt: 20300 }]]);
  assert.deepEqual(bust.map(a => a.kind), ['LEVEL_BUST']);
  assert.equal(bust[0].deviationFt, -700);
});

test('AR block: the block moves with the tanker (no alert while both climb together)', () => {
  assert.deepEqual(runAr([[0, { altFt: 21500, tankerAltFt: 22000 }], [10, { altFt: 23500, tankerAltFt: 24000 }]]), []);
});

test('AR block: within 3 NM, then beyond it, is TANKER_DISTANCE; never before the receiver has closed', () => {
  assert.deepEqual(runAr([[0, { altFt: 21500, distanceNm: 12 }], [10, { altFt: 21500, distanceNm: 8 }]]), [], 'still closing');
  const far = runAr([[0, { altFt: 21500, distanceNm: 1 }], [5, { altFt: 21500, distanceNm: 3.6 }], [10, { altFt: 21500, distanceNm: 3.8 }]]);
  assert.deepEqual(far.map(a => [a.kind, a.nm, a.limitNm]), [['TANKER_DISTANCE', 3.8, 3]]);
});

test('refuelingReceivers: the ATO tanker, else the declaring callsign; only TANKER_ACCEPTED, only ACTIVE', () => {
  const fds = {
    fT: { identity: { callsign: 'SHELL71' }, military: { arInfo: null } },
    fR: { identity: { callsign: 'VIPER11' }, military: {} },
    fA: { identity: { callsign: 'TEXACO1' }, military: { arInfo: { asTanker: { tacan: '50X' }, asReceiver: [] } } },
  };
  const of = (id) => fds[id];
  const declared = { state: 'ACTIVE', startEvent: 'TANKER_ACCEPTED', declaringCallsign: 'Shell 71', participants: ['fT', 'fR'] };
  assert.deepEqual([...refuelingReceivers([declared], of)], [['fR', { tankerFlightDataId: 'fT', tanker: 'SHELL71' }]]);
  const ato = { ...declared, declaringCallsign: 'somebody', participants: ['fR', 'fA'] };
  assert.deepEqual([...refuelingReceivers([ato], of)], [['fR', { tankerFlightDataId: 'fA', tanker: 'TEXACO1' }]]);
  const unknown = { ...declared, declaringCallsign: 'ARCO9' };
  assert.deepEqual([...refuelingReceivers([unknown], of)].map(([id, v]) => [id, v.tankerFlightDataId]), [['fT', null], ['fR', null]]);
  assert.equal(refuelingReceivers([{ ...declared, state: 'VOIDED' }, { ...declared, startEvent: 'LOCAL_DECLARATION' }], of).size, 0);
});

test('T17: a receiver climbing from its assigned altitude to the tanker raises nothing under MARSA; its clearance is back once MARSA ends', () => {
  const FT = 1 / 3.28084;
  const tracks = {
    tR: { lat: 37, lon: 35, alt: 20000 * FT, course: 90, groundSpeed: FAST, verticalSpeed: fpm(1500) },
    tT: { lat: 37, lon: 35.01, alt: 21000 * FT, course: 90, groundSpeed: FAST, verticalSpeed: 0 },
  };
  const at = Date.now();
  const assigned = { status: 'ACTIVE', parsed: 20000, at };
  const fds = {
    fR: { identity: { callsign: 'VIPER11' }, military: {}, clearance: { altitude: { entries: [assigned] }, heading: { entries: [] } } },
    fT: { identity: { callsign: 'SHELL71' }, military: {}, clearance: { altitude: { entries: [] }, heading: { entries: [] } } },
  };
  let relations = [{ state: 'ACTIVE', startEvent: 'TANKER_ACCEPTED', declaringCallsign: 'SHELL71', participants: ['fT', 'fR'] }];
  const monitor = wallFollows(new CM({
    trackStore: { get: (id) => tracks[id] },
    flightDataStore: { getFlightData: (id) => fds[id] },
    correlationStore: { getAll: () => [{ flightDataId: 'fR', trackId: 'tR', state: 'CORRELATED' }, { flightDataId: 'fT', trackId: 'tT', state: 'CORRELATED' }] },
    weather: () => ({ pressurePa: 101325, tempK: 288.15 }),
    transitionAltFt: () => 99999,
    indicatedAltFt: (m) => m * 3.28084,
    gridToMagnetic: (deg) => deg,
    config: cfg,
    refueling: () => refuelingReceivers(relations, (id) => fds[id]),
  }));
  // Reached its assigned 20,000 first, then the climb to the tanker.
  monitor.tick(0);
  for (let t = 1; t <= 20; t++) { tracks.tR.alt = (20000 + t * 50) * FT; monitor.tick(t * S); }
  assert.deepEqual(monitor.getAll(), [], 'no LEVEL_BUST against 20,000 while under MARSA');
  relations = [{ ...relations[0], state: 'ENDED' }];
  for (let t = 21; t <= 30; t++) monitor.tick(t * S);
  assert.deepEqual(monitor.getAll().map(r => [r.flightDataId, r.alerts.map(a => a.kind)]), [['fR', ['WRONG_WAY']]],
    'MARSA terminated: back on its own clearance, 1,000 ft above it and still climbing');
});

// ── an airspace entry's altitude block (docs/adr/0128 §4, H151) ──────────────────────────────────────────────────
// Checked like an assigned block (ADR 0091) when the flight has no assigned altitude; the assigned altitude wins. No new kind.

test('altitudeToCheck: the assigned altitude wins; otherwise the entry block, re-armed when amended', async () => {
  const { altitudeToCheck } = await import('../src/efsp/conformance.js');
  const assigned = { clearance: { altitude: { entries: [{ value: '150', parsed: 15000, block: null, status: 'ACTIVE', at: 5 }] } } };
  const none = { clearance: { altitude: { entries: [] } } };
  const entry = { lowerFt: 20000, upperFt: 24000, at: 7 };
  assert.equal(altitudeToCheck(assigned, entry).parsed, 15000);
  const a = altitudeToCheck(none, entry);
  assert.deepEqual(a.block, { lowFt: 20000, highFt: 24000 });
  assert.notEqual(altitudeToCheck(none, { ...entry, upperFt: 23000 }).at, a.at, 'an amended block is a new clearance');
  assert.equal(altitudeToCheck(none, null), null);
  assert.equal(altitudeToCheck(none, { lowerFt: null, upperFt: 2, at: 1 }), null);
});

test('a flight working an airspace on an entry block busts it like an assigned block (LEVEL_BUST with the block)', async () => {
  const { ConformanceMonitor } = await import('../src/efsp/conformance.js');
  const flightData = { flightDataId: 'f1', clearance: { altitude: { entries: [] }, heading: { entries: [] } } };
  const track = { id: 't1', alt: 22000 / 3.28084, course: 90, groundSpeed: FAST, verticalSpeed: 0 };
  const blocks = new Map([['f1', { lowerFt: 20000, upperFt: 24000, at: 0 }]]);
  const monitor = wallFollows(new ConformanceMonitor({
    trackStore: { get: () => track },
    flightDataStore: { getFlightData: () => flightData },
    correlationStore: { getAll: () => [{ flightDataId: 'f1', trackId: 't1', state: 'CORRELATED' }] },
    weather: () => ({ pressurePa: 101325, tempK: 288.15 }),
    transitionAltFt: () => 18000,
    indicatedAltFt,
    gridToMagnetic: (deg) => deg,
    config: cfg,
    entryBlocks: () => blocks,
  }));
  for (let t = 0; t <= 5; t++) monitor.tick(t * S);
  assert.deepEqual(monitor.getAll(), [], 'inside the block');
  track.alt = 26000 / 3.28084;
  for (let t = 6; t <= 60; t++) monitor.tick(t * S);
  const [row] = monitor.getAll();
  assert.equal(row.alerts[0].kind, 'LEVEL_BUST');
  assert.deepEqual(row.alerts[0].block, { lowFt: 20000, highFt: 24000 });
  // an assigned altitude is the clearance: the entry block is not checked beside it
  flightData.clearance.altitude.entries.push({ value: '260', parsed: 26000, block: null, status: 'ACTIVE', at: 99 });
  for (let t = 61; t <= 120; t++) monitor.tick(t * S);
  assert.deepEqual(monitor.getAll(), []);
});
