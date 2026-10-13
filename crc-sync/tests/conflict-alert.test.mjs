import { test } from 'node:test';
import assert from 'node:assert/strict';

// docs/adr/0058 — short-term conflict alert.
const { findConflicts, formationMembers, ConflictAlertMonitor } = await import('../src/conflict-alert.js');
const { loadAlertingConfig } = await import('../src/alerting-config.js');
const DEFAULTS = loadAlertingConfig();

const cfg = DEFAULTS.conflictAlert;
const KT = 0.514444;
const NOW = 1_000_000;
const NM_LAT = 1 / 60; // one nautical mile of latitude, in degrees

function track(id, over) {
  return {
    id, callsign: `T${id}`, category: 1, lat: 37, lon: 35, alt: 3000,
    course: 0, groundSpeed: 400 * KT, verticalSpeed: 0, firstSeenAt: NOW - 60000, ...over,
  };
}

test('two aircraft head-on at the same level, 10 NM apart, conflict well inside two minutes', () => {
  const a = track(1, { lat: 37, course: 0 });
  const b = track(2, { lat: 37 + 10 * NM_LAT, course: 180 });
  const [c] = findConflicts([a, b], cfg, NOW);
  assert.ok(c, 'no conflict found');
  assert.equal(c.id, '1|2');
  // Closing at 800 kt, 10 NM: they meet in 45 s; the closest sampled point is at the meeting.
  assert.ok(c.timeToCpaSec >= 40 && c.timeToCpaSec <= 46, `CPA at ${c.timeToCpaSec} s`);
  assert.ok(c.minNm < 0.5);
  assert.equal(c.vertFt, 0);
  assert.ok(Math.abs(c.aAt.lat - c.bAt.lat) < 0.01, 'both predicted positions are at the meeting point');
});

test('the same geometry 2000 ft apart is separated vertically — no alert', () => {
  const a = track(1, { lat: 37, course: 0, alt: 3000 });
  const b = track(2, { lat: 37 + 10 * NM_LAT, course: 180, alt: 3000 + 2000 / 3.28084 });
  assert.deepEqual(findConflicts([a, b], cfg, NOW), []);
});

test('a climb that closes the vertical gap inside the window IS a conflict', () => {
  const a = track(1, { lat: 37, course: 0, alt: 3000, verticalSpeed: 2000 / 196.85 }); // climbing 2000 fpm
  const b = track(2, { lat: 37 + 10 * NM_LAT, course: 180, alt: 3000 + 1500 / 3.28084 });
  assert.equal(findConflicts([a, b], cfg, NOW).length, 1);
});

test('diverging, too far, too slow or too new: no alert', () => {
  const a = track(1, { lat: 37, course: 180 });
  const b = track(2, { lat: 37 + 10 * NM_LAT, course: 0 });
  assert.deepEqual(findConflicts([a, b], cfg, NOW), [], 'flying apart');
  assert.deepEqual(findConflicts([track(1, {}), track(2, { lat: 38 })], cfg, NOW), [], '60 NM in trail at the same speed');
  const taxi = track(2, { lat: 37 + 1 * NM_LAT, course: 180, groundSpeed: 20 * KT });
  assert.deepEqual(findConflicts([track(1, {}), taxi], cfg, NOW), [], 'under 50 kt');
  const young = track(2, { lat: 37 + 5 * NM_LAT, course: 180, firstSeenAt: NOW - 2000 });
  assert.deepEqual(findConflicts([track(1, {}), young], cfg, NOW), [], 'no stable course yet');
  const ship = track(2, { lat: 37 + 5 * NM_LAT, course: 180, category: 4 });
  assert.deepEqual(findConflicts([track(1, {}), ship], cfg, NOW), [], 'ships are not traffic');
});

test('a MARSA pair is suppressed; the monitor reports a change while conflicts exist and once when they clear', () => {
  const tracks = [track(1, { lat: 37, course: 0 }), track(2, { lat: 37 + 10 * NM_LAT, course: 180 })];
  const store = { getAll: () => tracks };
  const marsa = new ConflictAlertMonitor({
    trackStore: store, config: cfg,
    trackedFlights: () => new Map([['1', 'fA'], ['2', 'fB']]),
    activeMarsaFor: () => ({ marsaId: 'm1', participants: ['fA', 'fB'] }),
  });
  assert.equal(marsa.tick(NOW), false);
  assert.deepEqual(marsa.getAll(), []);

  const plain = new ConflictAlertMonitor({ trackStore: store, config: cfg });
  assert.equal(plain.tick(NOW), true);
  assert.equal(plain.getAll().length, 1);
  tracks[1] = { ...tracks[1], alt: 9000 };
  assert.equal(plain.tick(NOW), true, 'clearing is a change');
  assert.equal(plain.tick(NOW), false, 'and quiet after that');
});

// ── docs/adr/0118: which pairs (H134 LT-RQ16 a, H136 VQ7 a, VQ8 a) and groups (T16, research Q7) ──

const headOn = () => [track(1, { lat: 37, course: 0 }), track(2, { lat: 37 + 10 * NM_LAT, course: 180 })];
function monitorFor(tracks, tracked, extra = {}) {
  return new ConflictAlertMonitor({
    trackStore: { getAll: () => tracks }, config: cfg,
    trackedFlights: () => new Map(Object.entries(tracked)),
    activeMarsaFor: () => null, flightSizeOf: () => 1, reportsAltitude: () => true, ...extra,
  });
}

test('two correlated tracks: CA', () => {
  const m = monitorFor(headOn(), { 1: 'fA', 2: 'fB' });
  m.tick(NOW);
  assert.equal(m.getAll().length, 1);
  assert.equal(m.getAll()[0].kind, 'CA');
  assert.equal(m.getAll()[0].intruder, undefined);
});

test('two uncorrelated tracks: nothing (P/CG CONFLICT ALERT is between tracked targets)', () => {
  const m = monitorFor(headOn(), {});
  m.tick(NOW);
  assert.deepEqual(m.getAll(), []);
});

test('correlated vs uncorrelated reporting altitude: MCI naming the intruder; a primary-only target raises nothing', () => {
  const m = monitorFor(headOn(), { 1: 'fA' });
  m.tick(NOW);
  const [c] = m.getAll();
  assert.equal(c.kind, 'MCI');
  assert.equal(c.intruder, '2');
  const primary = monitorFor(headOn(), { 1: 'fA' }, { reportsAltitude: () => false });
  primary.tick(NOW);
  assert.deepEqual(primary.getAll(), [], 'H136 VQ8 a: no Mode C, no MCI');
});

test('an MCI is delivered only to a session holding a Position that shows it; a CA to every ATC session', () => {
  const shown = [];
  const m = monitorFor(headOn(), { 1: 'fA' }, { mciShownAt: (intruder, f, p) => { shown.push([String(intruder.id), f, p]); return p === 'AP'; } });
  m.tick(NOW);
  const [c] = m.getAll();
  assert.equal(m.deliverableTo(c, [{ facilityId: 'INCIRLIK', positionId: 'LC' }]), false);
  assert.equal(m.deliverableTo(c, [{ facilityId: 'INCIRLIK', positionId: 'LC' }, { facilityId: 'INCIRLIK', positionId: 'AP' }]), true);
  assert.deepEqual(shown[0], ['2', 'INCIRLIK', 'LC'], 'asked with the intruder track');
  const ca = monitorFor(headOn(), { 1: 'fA', 2: 'fB' }, { mciShownAt: () => false });
  ca.tick(NOW);
  assert.equal(ca.deliverableTo(ca.getAll()[0], []), true);
});

test('T16: an uncorrelated wingman beside its formation lead raises no MCI against it; a third aircraft still alerts against both', () => {
  const lead = track(1, { lat: 37, lon: 35, course: 0 });
  const wing = track(2, { lat: 37, lon: 35 + 0.5 / 48, course: 0, alt: 3000 + 200 / 3.28084 }); // ~0.5 NM abeam, 200 ft up
  const other = track(3, { lat: 37 + 10 * NM_LAT, lon: 35, course: 180, alt: 3000 });
  // Converging slightly so the pair alone would conflict too.
  const formation = monitorFor([lead, wing], { 1: 'fA' }, { flightSizeOf: () => 2 });
  formation.tick(NOW);
  assert.deepEqual(formation.getAll(), [], 'the member is one of the formation');
  const single = monitorFor([lead, wing], { 1: 'fA' }, { flightSizeOf: () => 1 });
  single.tick(NOW);
  assert.equal(single.getAll().length, 1, 'a single aircraft has no members: the same target is an MCI');
  assert.equal(single.getAll()[0].kind, 'MCI');

  const withOther = monitorFor([lead, wing, other], { 1: 'fA', 3: 'fC' }, { flightSizeOf: (id) => (id === 'fA' ? 2 : 1) });
  withOther.tick(NOW);
  const ids = withOther.getAll().map(c => `${c.id}:${c.kind}`).sort();
  assert.deepEqual(ids, ['1|3:CA', '2|3:CA'], 'measured from each member; the member is tracked as part of its formation');
});

test('a formation claims at most size - 1 members, the nearest ones', () => {
  const lead = track(1, { lat: 37, lon: 35 });
  const near = track(2, { lat: 37, lon: 35 + 0.2 / 48 });
  const far = track(3, { lat: 37, lon: 35 + 0.8 / 48 });
  const tooHigh = track(4, { lat: 37, lon: 35 + 0.1 / 48, alt: 3000 + 3000 / 3.28084 });
  const leads = new Map([[lead, { flightDataId: 'fA', group: 'F:fA', size: 2 }]]);
  const members = formationMembers([lead, near, far, tooHigh], leads, cfg);
  assert.deepEqual([...members.keys()].map(t => t.id), [2]);
});

test('MARSA groups a receiver formation with the tanker: no MCI between the tanker and the receiver lead\'s wingman', () => {
  const tanker = track(1, { lat: 37, lon: 35, course: 0 });
  const receiver = track(2, { lat: 37 - 0.5 * NM_LAT, lon: 35, course: 0, groundSpeed: 420 * KT });
  const wing = track(3, { lat: 37 - 0.5 * NM_LAT, lon: 35 + 0.3 / 48, course: 0, groundSpeed: 420 * KT });
  const relation = { marsaId: 'm1', participants: ['fT', 'fR'] };
  const m = monitorFor([tanker, receiver, wing], { 1: 'fT', 2: 'fR' }, {
    flightSizeOf: (id) => (id === 'fR' ? 2 : 1),
    activeMarsaFor: (id) => (relation.participants.includes(id) ? relation : null),
  });
  m.tick(NOW);
  assert.deepEqual(m.getAll(), []);
  const ended = monitorFor([tanker, receiver, wing], { 1: 'fT', 2: 'fR' }, { flightSizeOf: (id) => (id === 'fR' ? 2 : 1) });
  ended.tick(NOW);
  assert.ok(ended.getAll().length >= 1, 'once MARSA ends the tanker alerts against the receivers again');
});

test("a track correlated to a Strip is named by the Strip's callsign", () => {
  const tracks = [track(1, { lat: 37, course: 0, callsign: 'Enfield 1-1' }), track(2, { lat: 37 + 10 * NM_LAT, course: 180 })];
  const monitor = new ConflictAlertMonitor({
    trackStore: { getAll: () => tracks }, config: cfg,
    callsignFor: (t) => (t.id === 1 ? 'VIPER11' : null),
  });
  monitor.tick(NOW);
  const [c] = monitor.getAll();
  assert.equal(c.aCallsign, 'VIPER11');
  assert.equal(c.bCallsign, 'T2', 'uncorrelated keeps its own');
});

test('the MCI floor: 500 ft AGL over the ground (sea level when unknown); 5,000 MSL, 1,500 AGL over ground above it', async () => {
  const { mciFloorFt } = await import('../src/conflict-alert.js');
  const terminal = { baseAltitudeFt: 500, reference: 'AGL', highTerrainAglFt: null };
  assert.equal(mciFloorFt(terminal, 240), 740);
  assert.equal(mciFloorFt(terminal, null), 500);
  const center = { baseAltitudeFt: 5000, reference: 'MSL', highTerrainAglFt: 1500 };
  assert.equal(mciFloorFt(center, 1200), 5000);
  assert.equal(mciFloorFt(center, 6000), 7500);
  assert.equal(mciFloorFt(center, null), 5000, 'unknown ground: the MSL base');
});

test('the hub sends an MCI only to a session whose Positions show it, and never sends the filter itself', async () => {
  const { default: WsHub } = await import('../src/ws-hub.js');
  const ca = { id: '1|2', kind: 'CA', a: '1', b: '2' };
  const mci = { id: '1|3', kind: 'MCI', a: '1', b: '3', intruder: '3' };
  const self = {
    _efspAlerts: { conflictAlert: [ca, mci], conflictAlertFor: (c, positions) => c.kind !== 'MCI' || positions.some(p => p.positionId === 'AP') },
    _efspFilter: (s, m) => m,
  };
  const session = (positionId) => ({
    lastSent: new Map([['1', 0], ['2', 0], ['3', 0]]),
    coverage: { conflictAlert: true, signedOnPositions: [{ facilityId: 'INCIRLIK', positionId }] },
  });
  const ap = WsHub.prototype._efspAlertsMsg.call(self, session('AP'));
  assert.deepEqual(ap.conflictAlert.map(c => c.kind), ['CA', 'MCI']);
  assert.equal(ap.conflictAlertFor, undefined);
  const lc = WsHub.prototype._efspAlertsMsg.call(self, session('LC'));
  assert.deepEqual(lc.conflictAlert.map(c => c.kind), ['CA']);
});
