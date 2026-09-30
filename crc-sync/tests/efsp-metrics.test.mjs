import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The §11.5 metric store (docs/adr/0065), unit-tested with an injected mission
// clock and wall clock. No real Board here — see efsp-metrics-tap.test.mjs.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-metrics-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_METRICS_PATH: 'metrics.json',
  CRCSYNC_EFSP_INSTRUMENTATION_CONFIG_PATH: 'instrumentation.json',
})) process.env[k] = path.join(tmpDir, v);

const { EfspMetrics, percentile, duplicatePositionIds, TTF_SAMPLE_CAP } = await import('../src/efsp/metrics.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const { MissionSession } = await import('../src/mission-session.js');

const HOUR = 3600000;
const T0 = Date.UTC(2016, 5, 21, 13, 0, 0); // a mission in 2016 — the wall clock is not
const WALL0 = Date.UTC(2026, 8, 30, 12, 0, 0);

function clocks({ mission = T0, wall = WALL0, source = 'MISSION' } = {}) {
  const c = { m: mission, w: wall, source };
  c.clock = { now: () => c.m, get source() { return c.source; } };
  c.wallNow = () => c.w;
  c.advance = (ms) => { c.m += ms; c.w += ms; };
  return c;
}

let fileN = 0;
function freshPath() { return path.join(tmpDir, `m-${++fileN}.json`); }

/** A position store stub: `manned` is the set of Positions with a Primary; `obs` maps Position -> observers. */
function positions(manned = [], obs = {}) {
  const s = { manned: new Set(manned), obs };
  s.getAll = () => ['OPS', 'GND', 'TWR', 'APP'].map(p => ({ positionId: p, primary: s.manned.has(p) ? { controllerId: `c-${p}` } : null, observers: obs[p] || [] }));
  s.primaryOf = (p) => (s.manned.has(p) ? `c-${p}` : null);
  s.observersOf = (p) => obs[p] || [];
  return s;
}

function build(c, extra = {}) {
  const store = extra.store || positions();
  return new EfspMetrics({
    path: extra.path || freshPath(), clock: c.clock, wallNow: c.wallNow, config: { retentionDays: 30 },
    facilityIds: ['INCIRLIK'], positionStoreFor: (f) => (f === 'INCIRLIK' ? store : null),
    correlationStats: extra.correlationStats || null, obligationStats: extra.obligationStats || null,
    missionSession: extra.session || null,
  });
}

function report(m, facilityId, positionId, events, controllerId = `c-${positionId}`, reportId = `r-${Math.random()}`) {
  return m.handleReport({ controllerId }, { version: 1, type: 'efsp-metrics-report', reportId, facilityId, positionId, events });
}

test('percentile is nearest-rank and exact on known samples', () => {
  const s = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
  assert.equal(percentile(s, 0.5), 50);
  assert.equal(percentile(s, 0.95), 95);
  assert.equal(percentile([7], 0.95), 7);
  assert.equal(percentile([], 0.5), null);
});

test('time-to-find: p50/p95/max exact, and the target is p95 < 3 s', () => {
  const c = clocks();
  const m = build(c, { store: positions(['GND']) });
  const latencies = Array.from({ length: 20 }, (_, i) => (i + 1) * 200); // 200..4000
  const ack = report(m, 'INCIRLIK', 'GND', latencies.map(l => ({ kind: 'TIME_TO_FIND', latencyMs: l })));
  assert.equal(ack.accepted, 20);
  const t = m.buildMetricsBody().metrics.timeToFind;
  assert.equal(t.status, 'COLLECTING');
  assert.equal(t.samples, 20);
  assert.equal(t.p50Ms, 2000);
  assert.equal(t.p95Ms, 3800);
  assert.equal(t.maxMs, 4000);
  assert.equal(t.pass, false);
  assert.equal(t.byPosition.GND.p95Ms, 3800);
});

test('time-to-find samples are capped per bucket; the rest are counted as dropped, not kept', () => {
  const c = clocks();
  const m = build(c, { store: positions(['GND']) });
  for (let i = 0; i < 6; i++) report(m, 'INCIRLIK', 'GND', Array.from({ length: 100 }, () => ({ kind: 'TIME_TO_FIND', latencyMs: 100 })));
  const t = m.buildMetricsBody().metrics.timeToFind;
  assert.equal(t.samples, TTF_SAMPLE_CAP);
  assert.equal(t.droppedSamples, 600 - TTF_SAMPLE_CAP);
});

test('search rate is per MANNED hour: 30 of 60 minutes manned, 3 searches -> 6 per manned hour', () => {
  const c = clocks();
  const store = positions(['GND']);
  const m = build(c, { store });
  for (let i = 0; i < 60; i++) {
    c.m = T0 + i * 60000; // one sample a minute through the 13:00Z hour
    store.manned = new Set(i < 30 ? ['GND'] : []);
    m.sampleManning();
  }
  store.manned = new Set(['GND']);
  report(m, 'INCIRLIK', 'GND', [{ kind: 'SEARCH' }, { kind: 'SEARCH', bayId: 'gnd-pending' }, { kind: 'SEARCH' }]);
  const body = m.buildMetricsBody();
  const g = body.metrics.searchInvocations.byPosition.GND;
  assert.equal(g.total, 3);
  assert.equal(g.mannedHours, 0.5);
  assert.equal(g.perMannedHour, 6);
  assert.deepEqual(g.byHour['2016-06-21T13:00Z'], { missionSession: 1, count: 3, mannedMinutes: 30, perMannedHour: 6 });
});

test('correlation: the hourly rate is sum(rate x eligible) / sum(eligible), and null with nothing eligible (T19)', () => {
  const c = clocks();
  let stats = { rate: 1.0, eligible: 1 };
  const m = build(c, { correlationStats: () => stats });
  m.sampleCorrelation();
  stats = { rate: 0.5, eligible: 9 };
  m.sampleCorrelation();
  stats = { rate: null, eligible: 0 }; // an empty board: adds nothing
  m.sampleCorrelation();
  const corr = m.buildMetricsBody().metrics.correlation;
  assert.equal(corr.windowRate, (1 * 1 + 0.5 * 9) / 10);
  assert.equal(corr.byHour['2016-06-21T13:00Z'].samples, 2);
  assert.equal(corr.status, 'COLLECTING');
  assert.deepEqual(corr.live, { rate: null, eligible: 0 }, 'the live getter, verbatim');

  const empty = build(clocks(), { correlationStats: () => ({ rate: null, eligible: 0 }) });
  empty.sampleCorrelation();
  const e = empty.buildMetricsBody().metrics.correlation;
  assert.equal(e.windowRate, null, 'null, never 1.0');
  assert.equal(e.status, 'NO_DATA');
  assert.equal(build(clocks()).buildMetricsBody().metrics.correlation.status, 'NOT_INSTRUMENTED');
});

test('staleness is NOT_INSTRUMENTED with total null until declared, then COLLECTING from a real 0 (T13)', () => {
  const m = build(clocks());
  let s = m.buildMetricsBody().metrics.staleness;
  assert.equal(s.status, 'NOT_INSTRUMENTED');
  assert.equal(s.total, null);
  m.declareSource('staleness');
  s = m.buildMetricsBody().metrics.staleness;
  assert.equal(s.status, 'NO_DATA');
  assert.equal(s.total, 0);
  m.recordStaleness({ positionId: 'TWR', stripState: 'TAXI', trackState: 'AIRBORNE', durationMs: 5000 });
  s = m.buildMetricsBody().metrics.staleness;
  assert.equal(s.status, 'COLLECTING');
  assert.equal(s.total, 1);
  assert.deepEqual(s.byPosition, { TWR: 1 });
  assert.deepEqual(s.byState, { TAXI: 1 });
});

test('an unknown source name throws at wiring time', () => {
  assert.throws(() => build(clocks()).declareSource('stalenes'), /unknown metrics source/);
});

test('client metrics are NOT_INSTRUMENTED until a report has ever arrived', () => {
  const m = build(clocks(), { store: positions(['GND']) });
  const before = m.buildMetricsBody();
  for (const k of ['searchInvocations', 'timeToFind', 'gestureInputs']) assert.equal(before.metrics[k].status, 'NOT_INSTRUMENTED', k);
  assert.equal(before.sources.client, null);
  report(m, 'INCIRLIK', 'GND', [{ kind: 'GESTURE', gesture: 'OFFSET', inputs: 1 }]);
  const after = m.buildMetricsBody();
  assert.equal(after.metrics.gestureInputs.status, 'COLLECTING');
  assert.equal(after.metrics.searchInvocations.status, 'NO_DATA');
  assert.equal(after.sources.client, T0);
});

test('client events are stamped by the server on receipt; the client `at` is ignored (S-R2-3)', () => {
  const c = clocks();
  const m = build(c, { store: positions(['GND']) });
  const ack = report(m, 'INCIRLIK', 'GND', [{ kind: 'SEARCH', at: Date.now() }, { kind: 'SEARCH', at: 'nonsense' }]);
  assert.equal(ack.accepted, 2);
  const body = m.buildMetricsBody();
  assert.deepEqual(Object.keys(body.metrics.searchInvocations.byPosition.GND.byHour), ['2016-06-21T13:00Z'], 'bucketed by the mission clock, not the client');
});

test('gestures: count, mean, max and over-ceiling per gesture', () => {
  const m = build(clocks(), { store: positions(['TWR']) });
  report(m, 'INCIRLIK', 'TWR', [
    { kind: 'GESTURE', gesture: 'FLIP', inputs: 1 },
    { kind: 'GESTURE', gesture: 'FLIP', inputs: 3 },
  ]);
  const g = m.buildMetricsBody().metrics.gestureInputs.byGesture;
  assert.deepEqual(g.FLIP, { count: 2, meanInputs: 2, maxInputs: 3, overCeiling: 1 });
  assert.deepEqual(g.OFFSET, { count: 0, meanInputs: null, maxInputs: null, overCeiling: 0 });
});

const SYRIA = { theatre: 'Syria', waypoints: [{ name: 'A' }], drawings: [] };
const CAUCASUS = { theatre: 'Caucasus', waypoints: [{ name: 'A' }], drawings: [] };

/** A metric store over its own in-memory mission session (src/mission-session.js). */
function withSession(c) {
  const session = new MissionSession({ path: null, clock: c.clock, wallNow: c.wallNow });
  return { session, m: build(c, { session }) };
}

test('metrics sessions (H32): a mission load that is the same mission carrying on is NOT a new session', () => {
  const c = clocks();
  const { session, m } = withSession(c);
  session.noteMissionLoad(SYRIA);
  m.recordMutation({ type: 'efsp-mutation', ok: true });
  assert.equal(m.currentMissionSession(), 1, 'the pre-load session is adopted by the first load');
  c.advance(20 * 60000);
  session.observeClock();
  session.noteMissionLoad(SYRIA); // a crc-sync restart or a gRPC reconnect
  m.recordMutation({ type: 'efsp-mutation', ok: true });
  assert.equal(m.currentMissionSession(), 1);
  assert.equal(m.buildMetricsBody().missionSession.theatre, 'Syria');
});

test('metrics sessions (H32) follow the mission session: mission_start, another mission, the clock stepping back', () => {
  const c = clocks();
  const { session, m } = withSession(c);
  session.noteMissionLoad(SYRIA);
  m.recordMutation({ type: 'efsp-mutation', ok: true });
  c.advance(HOUR);
  session.observeClock();
  c.m = T0; // the same mission file restarted: DCS says mission_start
  session.noteMissionStart();
  session.noteMissionLoad(SYRIA);
  m.recordMutation({ type: 'efsp-mutation', ok: true });
  assert.equal(m.currentMissionSession(), 2);

  session.noteMissionLoad(CAUCASUS);
  m.recordMutation({ type: 'efsp-mutation', ok: true });
  assert.equal(m.currentMissionSession(), 3);

  c.advance(30 * 60000);
  session.observeClock();
  m.recordMutation({ type: 'efsp-mutation', ok: true });
  c.m -= 10 * 60000; // no load event at all, but the mission clock went back
  session.observeClock();
  m.recordMutation({ type: 'efsp-mutation', ok: true });
  assert.equal(m.currentMissionSession(), 4);

  const body = m.buildMetricsBody();
  assert.deepEqual(body.missionSessions.map(s => s.seq), [1, 2, 3, 4]);
  assert.deepEqual(body.missionSessions.map(s => s.theatre), ['Syria', 'Syria', 'Caucasus', 'Caucasus']);
  assert.equal(body.missionSession.seq, 4);
  assert.equal(body.metrics.rejectedMutations.mutations, 1, 'the default view is the current session only');
  assert.equal(m.buildMetricsBody({ missionSession: 1 }).metrics.rejectedMutations.mutations, 1);
  assert.throws(() => m.buildMetricsBody({ missionSession: 99 }), RangeError);
});

test('a fallback to the wall clock (DCS gone) is not a new session when the mission comes back', () => {
  const c = clocks();
  const { session, m } = withSession(c);
  session.noteMissionLoad(SYRIA);
  session.observeClock();
  m.recordMutation({ type: 'efsp-mutation', ok: true });
  c.source = 'WALL';
  const missionAt = c.m;
  c.m = c.w; // the clock now answers wall time, years ahead
  session.observeClock();
  m.recordMutation({ type: 'efsp-mutation', ok: true });
  c.source = 'MISSION';
  c.m = missionAt + 60000;
  session.observeClock();
  session.noteMissionLoad(SYRIA);
  m.recordMutation({ type: 'efsp-mutation', ok: true });
  assert.equal(m.currentMissionSession(), 1);
});

test('the rolling last hour sits beside the session (S-R2-4)', () => {
  const c = clocks();
  const m = build(c);
  m.recordMutation({ type: 'efsp-mutation', ok: false, reason: 'STALE_REV' });
  c.advance(90 * 60000);
  m.recordMutation({ type: 'efsp-mutation', ok: false, reason: 'NOT_OWNER' });
  const body = m.buildMetricsBody();
  assert.equal(body.metrics.rejectedMutations.total, 2, 'the session holds both');
  assert.deepEqual(body.lastHour.metrics.rejectedMutations.byReason, { NOT_OWNER: 1 }, 'the last 60 minutes hold one');
  assert.deepEqual(body.lastHour.metrics.rejectedMutations.byHour, {}, 'no series in the rolling block');
  assert.equal(body.lastHour.to - body.lastHour.from, HOUR);
  assert.equal(body.windowHours, 2);
  assert.deepEqual(body.hours, ['2016-06-21T13:00Z', '2016-06-21T14:00Z']);
  assert.equal(body.metrics.rejectedMutations.byHour['2016-06-21T14:00Z'].missionSession, 1, 'every bucket names its session');
  assert.equal(m.buildMetricsBody({ hours: 1 }).metrics.rejectedMutations.total, 1);
});

test('persistence: a restart restores buckets, sessions and sources; nothing about who', () => {
  const c = clocks();
  const p = freshPath();
  const session = new MissionSession({ path: null, clock: c.clock, wallNow: c.wallNow });
  const m = build(c, { path: p, store: positions(['GND']), session });
  session.noteMissionLoad(SYRIA);
  report(m, 'INCIRLIK', 'GND', [{ kind: 'SEARCH' }]);
  m.declareSource('staleness');
  m.recordTransfer({ kind: 'TRANSFER', ok: false, cause: 'NO_RECEIVING_POSITION' });
  assert.equal(m.flush(), true);
  const raw = fs.readFileSync(p, 'utf8');
  assert.ok(!raw.includes('c-GND'), 'no controller id is persisted');

  const again = build(c, { path: p, store: positions(['GND']), session });
  const a = m.buildMetricsBody();
  const b = again.buildMetricsBody();
  assert.deepEqual(b.metrics.transfers, a.metrics.transfers);
  assert.deepEqual(b.sources, a.sources);
  assert.deepEqual(b.missionSessions, a.missionSessions);
  assert.equal(b.metrics.searchInvocations.total, 1);
});

test('the file is written only when something changed', () => {
  const c = clocks();
  const p = freshPath();
  const m = build(c, { path: p });
  m.tick(); // opens the first session: a change
  const writes = m._writes;
  m.tick();
  m.tick();
  assert.equal(m._writes, writes, 'idle ticks write nothing');
  m.recordMutation({ type: 'efsp-mutation', ok: true });
  m.tick();
  assert.equal(m._writes, writes + 1);
  assert.equal(fs.existsSync(`${p}.tmp`), false, 'sibling-and-rename leaves no tmp behind');
});

test('retention: hour buckets last written more than retentionDays ago (wall clock) are pruned', () => {
  const c = clocks();
  const m = build(c);
  m.recordMutation({ type: 'efsp-mutation', ok: true });
  c.w += 30 * 24 * HOUR;
  m.prune();
  assert.equal(m.buildMetricsBody({ missionSession: 1, hours: 1 }).metrics.rejectedMutations.mutations, 1, 'kept at exactly 30 days');
  c.w += 1;
  m.prune();
  assert.equal(m.buildMetricsBody({ missionSession: 1, hours: 1 }).metrics.rejectedMutations.mutations, 0);
});

test('an unreadable metrics file is moved aside, not overwritten', () => {
  const p = freshPath();
  fs.writeFileSync(p, '{ broken');
  const orig = console.warn;
  console.warn = () => {};
  try { build(clocks(), { path: p }); } finally { console.warn = orig; }
  assert.equal(fs.existsSync(p), false);
  assert.ok(fs.readdirSync(tmpDir).some(n => n.startsWith(path.basename(p)) && n.includes('.corrupt-')));
});

test('Position ids are unique across Facilities, so keying metrics by positionId is safe (Q13)', () => {
  assert.deepEqual(duplicatePositionIds(facilityConfig), []);
  const fake = { getFacilityIds: () => ['A', 'B'], getPositionSet: (f) => (f === 'A' ? ['X', 'Y'] : ['Y', 'Z']) };
  assert.deepEqual(duplicatePositionIds(fake), ['Y'], 'the guard would catch a reuse');
});
