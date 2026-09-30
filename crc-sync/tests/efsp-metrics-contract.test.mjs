import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The wire/HTTP bodies L15 (ADR 0072) builds against — docs/adr/0065. Keys may
// be ADDED freely; renaming or removing one needs a new ADR, and fails here.
// On an EMPTY service, so the "no data" answers are pinned too: statuses say
// NOT_INSTRUMENTED/NO_DATA and every rate or percentile is null, never 0.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-metrics-contract-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
  CRCSYNC_EFSP_TRAFFIC_COUNT_PATH: 'traffic-count.jsonl',
  CRCSYNC_EFSP_METRICS_PATH: 'metrics.json',
  CRCSYNC_EFSP_INSTRUMENTATION_CONFIG_PATH: 'instrumentation.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');

const { createEfsp } = await import('../src/efsp/index.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const { createEfspInstrumentation } = await import('../src/efsp/metrics.js');

const efsp = createEfsp();
const instr = createEfspInstrumentation({ efsp, facilityConfig });

const NUM = 'number';
const NUM_OR_NULL = 'number|null';
const STR = 'string';
const OBJ = 'object';
const ARR = 'array';
const BOOL_OR_NULL = 'boolean|null';

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** Every key in `shape` is present in `obj` with a matching type; nested shapes recurse. */
function assertShape(obj, shape, where) {
  for (const [key, want] of Object.entries(shape)) {
    assert.ok(obj && Object.prototype.hasOwnProperty.call(obj, key), `${where}.${key} is missing`);
    const v = obj[key];
    if (typeof want === 'object') { assertShape(v, want, `${where}.${key}`); continue; }
    assert.ok(want.split('|').includes(typeOf(v)), `${where}.${key} is ${typeOf(v)}, contract says ${want}`);
  }
}

const STATUS = STR;
const METRICS_SHAPE = {
  searchInvocations: { status: STATUS, target: { kind: STR }, total: NUM, byPosition: OBJ },
  timeToFind: {
    status: STATUS, target: { kind: STR, value: NUM },
    samples: NUM, p50Ms: NUM_OR_NULL, p95Ms: NUM_OR_NULL, maxMs: NUM_OR_NULL, pass: BOOL_OR_NULL,
    droppedSamples: NUM, byPosition: OBJ, byHour: OBJ,
  },
  gestureInputs: {
    status: STATUS, target: { kind: STR, value: NUM },
    byGesture: {
      OFFSET: { count: NUM, meanInputs: NUM_OR_NULL, maxInputs: NUM_OR_NULL, overCeiling: NUM },
      FLIP: OBJ, HIGHLIGHT: OBJ, ATTENTION: OBJ,
    },
    serverSetFlagMutations: { OFFSET: NUM, FLIP: NUM, HIGHLIGHT: NUM, ATTENTION: NUM },
  },
  correlation: { status: STATUS, target: { kind: STR, value: NUM }, windowRate: NUM_OR_NULL, live: 'object|null', byHour: OBJ },
  rejectedMutations: {
    status: STATUS, target: { kind: STR },
    mutations: NUM, total: NUM, byReason: OBJ, byType: OBJ, byOp: OBJ, byPosition: OBJ, byHour: OBJ,
  },
  staleness: { status: STATUS, target: { kind: STR }, total: NUM_OR_NULL, byPosition: OBJ, byState: OBJ, byHour: OBJ },
  transfers: {
    status: STATUS, target: { kind: STR, value: NUM },
    attempts: NUM, succeeded: NUM, failed: NUM, failureRate: NUM_OR_NULL, routedToCovering: NUM, inhibitedPress: NUM,
    byCause: OBJ, byKind: { TRANSFER: { attempts: NUM, failed: NUM }, NLA_TRANSFER: { attempts: NUM, failed: NUM } }, byHour: OBJ,
  },
  obligations: { status: STATUS, live: 'object|null' },
  systemReassigned: { total: NUM, byHour: OBJ },
};

const METRICS_BODY_SHAPE = {
  ok: 'boolean', version: NUM, generatedAt: NUM, serviceStartedAt: NUM,
  missionSession: { seq: NUM, theatre: 'string|null', startedAt: NUM, lastAt: NUM_OR_NULL, current: 'boolean' },
  missionSessions: ARR,
  windowHours: NUM, hours: ARR,
  sources: { client: NUM_OR_NULL, staleness: NUM_OR_NULL },
  metrics: METRICS_SHAPE,
  lastHour: { from: NUM, to: NUM, metrics: METRICS_SHAPE },
};

const TOTALS_SHAPE = {
  flights: NUM, aircraft: NUM, local: NUM, transient: NUM, unknown: NUM,
  formation: NUM, formationAircraft: NUM, suaTraversal: NUM, alertScramble: NUM,
  excluded: NUM, excludedByReason: OBJ,
};

const TRAFFIC_BODY_SHAPE = {
  ok: 'boolean', version: NUM, generatedAt: NUM, from: NUM, to: NUM, unit: STR, policy: STR,
  missionSession: NUM_OR_NULL,
  facilities: {
    INCIRLIK: { homeAirports: ARR, totals: TOTALS_SHAPE, byHour: ARR, byAircraftType: OBJ, byRole: OBJ },
  },
  reconciliation: {
    checkedAt: NUM, ok: 'boolean', window: OBJ, expected: NUM, actual: NUM,
    missing: NUM, extra: NUM, mismatched: NUM, backfilled: NUM,
  },
};

test('every §11.5 metric is collected and exposed', () => {
  const { status, body } = instr.metricsHttp({});
  assert.equal(status, 200);
  // The seven, by name — WP8 acceptance bullet 1, server half.
  for (const name of ['searchInvocations', 'timeToFind', 'gestureInputs', 'correlation', 'rejectedMutations', 'staleness', 'transfers']) {
    assert.ok(body.metrics[name], `§11.5 metric ${name} is not in the body`);
    assert.equal(typeof body.metrics[name].status, 'string', `${name} carries a status`);
  }
  assertShape(body, METRICS_BODY_SHAPE, 'metrics');
});

test('an empty service says so honestly: no source is a healthy zero', () => {
  const { body } = instr.metricsHttp({});
  const m = body.metrics;
  assert.equal(m.searchInvocations.status, 'NOT_INSTRUMENTED');
  assert.equal(m.timeToFind.status, 'NOT_INSTRUMENTED');
  assert.equal(m.gestureInputs.status, 'NOT_INSTRUMENTED');
  assert.equal(m.correlation.status, 'NOT_INSTRUMENTED', 'no getter was wired in this test');
  assert.equal(m.staleness.status, 'NOT_INSTRUMENTED');
  assert.equal(m.staleness.total, null, 'null, not 0, until L19 declares its detector');
  assert.equal(m.rejectedMutations.status, 'NO_DATA', 'the tap is installed; nothing happened');
  assert.equal(m.transfers.status, 'NO_DATA');
  assert.equal(m.transfers.failureRate, null);
  assert.equal(m.timeToFind.p95Ms, null);
  assert.equal(m.timeToFind.pass, null);
  assert.equal(m.correlation.windowRate, null);
  assert.equal(m.obligations.status, 'NOT_INSTRUMENTED');
});

test('the traffic body has its contract keys, and `local + transient + unknown === flights`', () => {
  const { status, body } = instr.trafficCountHttp({});
  assert.equal(status, 200);
  assertShape(body, TRAFFIC_BODY_SHAPE, 'traffic');
  const t = body.facilities.INCIRLIK.totals;
  assert.equal(t.local + t.transient + t.unknown, t.flights);
  assert.deepEqual(body.facilities.INCIRLIK.homeAirports, ['LTAG']);
  assert.equal(body.unit, 'FLIGHT');
  assert.equal(body.records, undefined, 'records only with detail=1');
  assert.ok(Array.isArray(instr.trafficCountHttp({ detail: '1' }).body.records));
});

test('bad queries are 400-shaped, never a throw', () => {
  for (const hours of ['0', '721', 'x', '1.5', -3]) {
    const r = instr.metricsHttp({ hours });
    assert.equal(r.status, 400, `hours=${hours}`);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.reason, 'VALIDATION_ERROR');
  }
  assert.equal(instr.metricsHttp({ hours: '720' }).status, 200);
  assert.equal(instr.metricsHttp({ missionSession: '99' }).status, 404);
  assert.equal(instr.trafficCountHttp({ from: '200', to: '100' }).status, 400);
  assert.equal(instr.trafficCountHttp({ from: 'yesterday' }).status, 400);
  assert.equal(instr.trafficCountHttp({ facilityId: 'NOWHERE' }).status, 400);
  assert.equal(instr.trafficCountHttp({ from: '100', to: '100' }).status, 200, 'an empty window is legal');
});

test('a getter that throws does not take the report down', () => {
  const other = createEfspInstrumentation({
    efsp: { ...efsp }, facilityConfig,
    correlationStats: () => { throw new Error('boom'); },
    obligationStats: () => { throw new Error('boom'); },
    metricsPath: path.join(tmpDir, 'throwing-metrics.json'),
    trafficCountPath: path.join(tmpDir, 'throwing-count.jsonl'),
  });
  other.trafficCount.close();
  const orig = console.warn;
  console.warn = () => {};
  let r;
  try { r = other.metricsHttp({}); other.tick(); } finally { console.warn = orig; }
  assert.equal(r.status, 200);
  assert.equal(r.body.metrics.correlation.live, null);
  assert.equal(r.body.metrics.obligations.live, null);
});
