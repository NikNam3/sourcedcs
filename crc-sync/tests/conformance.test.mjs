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

// ── on a final (docs/adr/0117, H134 LT-RQ8 a, LT-RQ9 a) ──────────────────────
// No heading check on a final; at an airfield the altitude is checked until "BEGIN DESCENT" ends it (the FinalCall clears
// the assigned altitude, a Board test covers that); on the carrier no altitude check from the final on (ours).

async function finalMonitor(onFinal) {
  const { ConformanceMonitor } = await import('../src/efsp/conformance.js');
  const flightData = { flightDataId: 'f1', clearance: {
    heading: { entries: [{ value: '050', parsed: 50, status: 'ACTIVE', at: 0 }] },
    altitude: { entries: [{ value: '030', parsed: 3000, block: null, status: 'ACTIVE', at: 0 }] },
  } };
  // flying 090 (40 degrees off AP's last vector) and 1,500 ft below the 3,000 it reached, descending on the glidepath
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

test('on the PAR final: no heading alert; the altitude still alerts until Begin descent ends it', async () => {
  const { monitor, flightData } = await finalMonitor('AIRFIELD');
  assert.deepEqual(kinds(monitor.getAll()[0].alerts), ['LEVEL_BUST'], 'before Begin descent the assigned altitude holds (para 5-12-3)');
  // Begin descent: the assigned altitude is superseded by "none" (board/ops/final-call.js)
  flightData.clearance.altitude.entries[0].status = 'SUPERSEDED';
  flightData.clearance.altitude.entries.push({ value: '', parsed: null, block: null, status: 'ACTIVE', at: 61 * S });
  monitor.tick(62 * S);
  assert.deepEqual(monitor.getAll(), [], 'on the glidepath nothing is alerted');
});

test('on the carrier final: neither heading nor altitude alerts (ours: JO 7110.65 is silent on the carrier)', async () => {
  const { monitor } = await finalMonitor('CARRIER');
  assert.deepEqual(monitor.getAll(), []);
});

test('leaving the final (a missed approach) brings the checks back against what is then assigned', async () => {
  const { monitor, finals } = await finalMonitor('AIRFIELD');
  finals.delete('f1');
  for (let t = 61; t <= 120; t++) monitor.tick(t * S);
  assert.ok(kinds(monitor.getAll()[0].alerts).includes('HEADING'));
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
