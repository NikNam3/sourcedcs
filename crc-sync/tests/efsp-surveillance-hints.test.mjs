import test from 'node:test';
import assert from 'node:assert/strict';

/* docs/adr/0076: what "detected airborne" means, the suggestion chip (§10.3)
 * and staleness (§10.4). The monitor reads and states; nothing here moves a
 * Strip, and the ring-fence tests below hold that. */

const { instantPhase, debouncedPhase, PHASES } = await import('../src/efsp/airborne.js');
const { SurveillanceHintMonitor, EXPECTS, UNEXPECTING } = await import('../src/efsp/surveillance-hints.js');
const { normalizeHintsConfig, DEFAULT_HINTS_CONFIG, loadHintsConfig } = await import('../src/efsp/surveillance-hints-config.js');
const { STATES_BY_ROLE } = await import('../src/efsp/nla.js');
const { EfspMetrics } = await import('../src/efsp/metrics.js');

const KT = 0.514444;
const FT = 0.3048;
const CFG = DEFAULT_HINTS_CONFIG;
const missionData = { airports: [{ lat: 37.0, lon: 35.4, elev: 70 }] };

/** A track `agl` ft over the field, `kt` knots, at the field (or `far`, 20 km north of it). */
function trk({ agl = 0, kt = 0, far = false, category = 1, id = 7 } = {}) {
  return { id, category, lat: far ? 37.2 : 37.0, lon: 35.4, alt: 70 + agl * FT, groundSpeed: kt * KT };
}

// ── the phase ──────────────────────────────────────────────────────────────

test('airborne needs speed AND height over the field', () => {
  assert.equal(instantPhase(trk({ agl: 500, kt: 150 }), missionData, CFG.airborne), PHASES.AIRBORNE);
  assert.equal(instantPhase(trk({ agl: 500, kt: 20 }), missionData, CFG.airborne), PHASES.UNKNOWN, 'too slow');
  assert.equal(instantPhase(trk({ agl: 180, kt: 150 }), missionData, CFG.airborne), PHASES.UNKNOWN, '180 ft: the band between the thresholds');
});

test('on the apron or the runway is ON_GROUND, however fast', () => {
  assert.equal(instantPhase(trk({ agl: 0, kt: 0 }), missionData, CFG.airborne), PHASES.ON_GROUND);
  assert.equal(instantPhase(trk({ agl: 3, kt: 140 }), missionData, CFG.airborne), PHASES.ON_GROUND, 'landing or take-off roll');
});

test('away from every field, height is unknown and speed alone decides', () => {
  assert.equal(instantPhase(trk({ agl: 0, kt: 200, far: true }), missionData, CFG.airborne), PHASES.AIRBORNE);
  assert.equal(instantPhase(trk({ agl: 0, kt: 10, far: true }), missionData, CFG.airborne), PHASES.UNKNOWN);
});

test('only aircraft are ever airborne or on the ground', () => {
  assert.equal(instantPhase(trk({ agl: 0, kt: 0, category: 3 }), missionData, CFG.airborne), PHASES.UNKNOWN);
  assert.equal(instantPhase(null, missionData, CFG.airborne), PHASES.UNKNOWN);
});

test('AIRBORNE is debounced by holdSec; ON_GROUND is immediate', () => {
  const mem = {};
  assert.equal(debouncedPhase(mem, PHASES.AIRBORNE, 0, CFG.airborne).phase, PHASES.UNKNOWN);
  assert.equal(debouncedPhase(mem, PHASES.AIRBORNE, 4000, CFG.airborne).phase, PHASES.UNKNOWN);
  assert.equal(debouncedPhase(mem, PHASES.AIRBORNE, 5000, CFG.airborne).phase, PHASES.AIRBORNE);
  assert.equal(debouncedPhase(mem, PHASES.UNKNOWN, 6000, CFG.airborne).phase, PHASES.UNKNOWN, 'a break ends it at once');
  assert.equal(debouncedPhase(mem, PHASES.AIRBORNE, 7000, CFG.airborne).phase, PHASES.UNKNOWN, 'and the hold starts again');
  assert.equal(debouncedPhase(mem, PHASES.ON_GROUND, 8000, CFG.airborne).phase, PHASES.ON_GROUND);
});

// ── the state table ────────────────────────────────────────────────────────

test('every EFSP state either expects a phase or deliberately expects none', () => {
  for (const [role, states] of Object.entries(STATES_BY_ROLE)) {
    for (const s of states) {
      const listed = !!(EXPECTS[role] || {})[s] || (UNEXPECTING[role] || []).includes(s);
      assert.ok(listed, `${role}/${s}: decide what it expects of the aircraft in surveillance-hints.js`);
    }
  }
});

// ── the monitor ────────────────────────────────────────────────────────────

function build({ strips, track, correlated = true, config = CFG }) {
  const logged = [];
  const state = { track, correlated };
  const mon = new SurveillanceHintMonitor({
    trackStore: { get: () => state.track },
    correlationStore: { correlatedTrackId: () => (state.correlated ? String(state.track && state.track.id) : null) },
    boardStoreFor: (f) => ({ getAll: () => (f === 'INCIRLIK' ? strips : []) }),
    facilityConfig: { getFacilityIds: () => ['INCIRLIK', 'CENTER'] },
    getMissionData: () => missionData,
    config,
    onStaleness: (e) => logged.push(e),
  });
  return { mon, state, logged };
}

const dep = (state, extra = {}) => ({ stripId: 's1', fdrId: 'f1', role: 'DEPARTURE', state, ownerPositionId: 'TWR', ...extra });

test('a departure on the ground side with a contact airborne for holdSec gets the chip, naming DEPARTED', () => {
  const strips = [dep('LUAW')];
  const { mon } = build({ strips, track: trk({ agl: 800, kt: 160 }) });
  assert.equal(mon.tick(0), false, 'inside the hold: nothing yet');
  assert.deepEqual(mon.getAll(), []);
  assert.equal(mon.tick(5000), true);
  const [h] = mon.getAll();
  assert.equal(h.kind, 'AIRBORNE_ADVANCE');
  assert.equal(h.toState, 'DEPARTED');
  assert.equal(h.stripId, 's1');
  assert.equal(h.facilityId, 'INCIRLIK');
  assert.equal(mon.tick(6000), false, 'unchanged hints are not a change');
});

test('the chip is a hint and never a move: the Strip comes back byte-identical (§10.3)', () => {
  const strips = [dep('PUSHBACK')];
  const before = JSON.parse(JSON.stringify(strips));
  const { mon } = build({ strips, track: trk({ agl: 800, kt: 160 }) });
  for (let t = 0; t <= 300000; t += 1000) mon.tick(t);
  assert.ok(mon.getAll().length > 0, 'it did notice');
  assert.deepEqual(strips, before, 'no state, no bayId, nothing');
});

test('staleness: raised after afterSec, once per episode, logged once', () => {
  const strips = [dep('TAXI')];
  const { mon, logged } = build({ strips, track: trk({ agl: 800, kt: 160 }) });
  // phase turns AIRBORNE at 5 s; the episode starts then and runs afterSec more.
  for (let t = 0; t <= 124000; t += 1000) mon.tick(t);
  assert.equal(mon.getAll().filter(h => h.kind === 'STALE').length, 0, 'not yet');
  mon.tick(125000);
  assert.equal(mon.getAll().filter(h => h.kind === 'STALE').length, 1);
  for (let t = 126000; t <= 200000; t += 1000) mon.tick(t);
  assert.equal(logged.length, 1, 'one occurrence, however long it lasts');
  assert.equal(logged[0].stripState, 'TAXI');
  assert.equal(logged[0].trackState, 'AIRBORNE');
  assert.equal(logged[0].positionId, 'TWR');
  assert.ok(logged[0].durationMs >= 120000);
});

test('the other direction: a Strip that says airborne while its contact sits on the ground is stale, with no chip', () => {
  const strips = [dep('DEPARTED')];
  const { mon, logged } = build({ strips, track: trk({ agl: 0, kt: 0 }) });
  for (let t = 0; t <= 121000; t += 1000) mon.tick(t);
  const hints = mon.getAll();
  assert.deepEqual(hints.map(h => h.kind), ['STALE']);
  assert.equal(logged.length, 1);
});

test('an agreeing Strip, a pre-movement Strip, and a provisional match say nothing', () => {
  const strips = [dep('DEPARTED'), dep('CLEARED', { stripId: 's2' })];
  const { mon, state } = build({ strips, track: trk({ agl: 800, kt: 160 }) });
  for (let t = 0; t <= 300000; t += 1000) mon.tick(t);
  assert.deepEqual(mon.getAll(), []);
  strips.push(dep('TAXI', { stripId: 's3' }));
  state.correlated = false; // PROVISIONAL / UNCORRELATED: not a basis for a hint
  for (let t = 301000; t <= 600000; t += 1000) mon.tick(t);
  assert.deepEqual(mon.getAll(), []);
});

test('an episode ends when the Strip is advanced, and the next contradiction is a new occurrence', () => {
  const strips = [dep('LUAW')];
  const { mon, state, logged } = build({ strips, track: trk({ agl: 800, kt: 160 }) });
  for (let t = 0; t <= 130000; t += 1000) mon.tick(t);
  assert.equal(logged.length, 1);
  strips[0].state = 'DEPARTED'; // the controller advanced it
  mon.tick(131000);
  assert.deepEqual(mon.getAll(), []);
  // ... and later lands, but the Strip still says airborne.
  state.track = trk({ agl: 0, kt: 0 });
  for (let t = 132000; t <= 260000; t += 1000) mon.tick(t);
  assert.equal(logged.length, 2);
  assert.equal(logged[1].trackState, 'ON_GROUND');
});

test('a gap in the contradiction (the contact goes unknown) ends the episode', () => {
  const strips = [dep('TAXI')];
  const { mon, state, logged } = build({ strips, track: trk({ agl: 800, kt: 160 }) });
  for (let t = 0; t <= 100000; t += 1000) mon.tick(t);
  state.track = trk({ agl: 180, kt: 160 }); // the band between: UNKNOWN
  mon.tick(101000);
  state.track = trk({ agl: 800, kt: 160 });
  for (let t = 102000; t <= 200000; t += 1000) mon.tick(t);
  assert.equal(logged.length, 0, 'the clock restarted: 200 s total, but never 120 s unbroken');
});

test('every occurrence reaches L5 metric 6 as a staleness count', () => {
  const metrics = Object.create(EfspMetrics.prototype);
  const calls = [];
  metrics.recordStaleness = (e) => calls.push(e);
  const strips = [dep('TAXI')];
  const mon = new SurveillanceHintMonitor({
    trackStore: { get: () => trk({ agl: 800, kt: 160 }) },
    correlationStore: { correlatedTrackId: () => '7' },
    boardStoreFor: (f) => ({ getAll: () => (f === 'INCIRLIK' ? strips : []) }),
    facilityConfig: { getFacilityIds: () => ['INCIRLIK'] },
    getMissionData: () => missionData,
    config: CFG,
    onStaleness: (e) => metrics.recordStaleness(e),
  });
  for (let t = 0; t <= 130000; t += 1000) mon.tick(t);
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), ['at', 'durationMs', 'facilityId', 'fdrId', 'positionId', 'stripId', 'stripState', 'trackState']);
});

// ── the tuning file ────────────────────────────────────────────────────────

test('the tuning file validates per field and falls back with a warning', () => {
  const warn = console.warn; const warnings = [];
  console.warn = (m) => warnings.push(m);
  try {
    const c = normalizeHintsConfig({ airborne: { minGroundSpeedKt: 'fast', minAglFt: 300 }, staleness: { afterSec: 0 } }, 'x');
    assert.equal(c.airborne.minGroundSpeedKt, 60);
    assert.equal(c.airborne.minAglFt, 300);
    assert.equal(c.airborne.holdSec, 5);
    assert.equal(c.staleness.afterSec, 120);
    assert.equal(warnings.length, 2);
    assert.equal(loadHintsConfig('/nonexistent/x.json'), DEFAULT_HINTS_CONFIG);
  } finally { console.warn = warn; }
});

test('the shipped tuning file holds the defaults', async () => {
  const { readFileSync } = await import('node:fs');
  const shipped = JSON.parse(readFileSync(new URL('../config/efsp-surveillance-hints.json', import.meta.url), 'utf8'));
  assert.deepEqual(normalizeHintsConfig(shipped), DEFAULT_HINTS_CONFIG);
});
