import { test } from 'node:test';
import assert from 'node:assert/strict';

// docs/adr/0058 — conformance: only what is wrong is ever reported.
const { evaluateConformance, headingDiff, FPM_PER_MS, MS_PER_KT } = await import('../src/efsp/conformance.js');
const { DEFAULTS } = await import('../src/alerting-config.js');
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
  assert.ok(Math.abs(indicatedAltFt(3048, { pressurePa: 101325, tempK: 288.15 }) - 10000) < 60);
  // Below transition the altimeter is set to QNH, so it reads true altitude whatever the QNH.
  assert.ok(Math.abs(indicatedAltFt(3048, { pressurePa: 99000, tempK: 288.15 }) - indicatedAltFt(3048, { pressurePa: 101325, tempK: 288.15 })) < 1);
  // Above it the altimeter is on standard pressure: on a low-pressure day the
  // same true altitude reads as a HIGHER flight level.
  assert.ok(indicatedAltFt(7000, { pressurePa: 99000, tempK: 288.15 }) > indicatedAltFt(7000, { pressurePa: 101325, tempK: 288.15 }) + 300);
});

test('the monitor reads correlation, track and clearance, and reports a flight only while it is wrong', async () => {
  const { ConformanceMonitor } = await import('../src/efsp/conformance.js');
  const fdr = { fdrId: 'f1', clearance: { heading: { entries: [{ value: '050', parsed: 50, status: 'ACTIVE', at: 0 }] }, altitude: { entries: [] } } };
  const track = { id: 't1', alt: 3048, course: 90, groundSpeed: FAST, verticalSpeed: 0 };
  const monitor = new ConformanceMonitor({
    trackStore: { get: (id) => (id === 't1' ? track : null) },
    fdrStore: { getFdr: (id) => (id === 'f1' ? fdr : null) },
    correlationStore: { getAll: () => [{ fdrId: 'f1', trackId: 't1', state: 'CORRELATED' }] },
    weather: () => ({ pressurePa: 101325, tempK: 288.15 }),
    transitionAltFt: () => 18000,
    indicatedAltFt,
    config: cfg,
  });
  assert.equal(monitor.tick(31 * S), false, 'deviating, but not for 10 s yet');
  assert.equal(monitor.tick(41 * S), true);
  assert.deepEqual(monitor.getAll().map(r => [r.fdrId, r.alerts[0].kind]), [['f1', 'HEADING']]);
  track.course = 50;
  assert.equal(monitor.tick(42 * S), true, 'back on heading: the flight drops off the list');
  assert.deepEqual(monitor.getAll(), []);
  assert.equal(monitor.tick(43 * S), false);
});
