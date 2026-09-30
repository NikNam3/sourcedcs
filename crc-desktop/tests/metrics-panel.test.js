'use strict';

// The METRICS panel's view-model (docs/adr/0072), against crc-sync's metrics
// and traffic bodies as docs/adr/0065 ships them (crc-sync's
// tests/efsp-metrics-contract.test.mjs is the contract). Pure: no DOM, except
// the last test, which renders into the shared stub.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { renderMetricsModel, renderTrafficModel, metricsTrend, METRICS_ROWS } = require('../app/public/js/panels/metrics-panel.js');
const { makeElement, descendants } = require('./helpers/dom-stub.js');

const H1 = '2026-09-30T12:00Z', H2 = '2026-09-30T13:00Z', H3 = '2026-09-30T14:00Z', H4 = '2026-09-30T15:00Z';
const T0 = Date.parse('2026-09-30T12:05:00Z');
const NOW = Date.parse('2026-09-30T15:20:00Z');

function gesture(count, mean, max, over) { return { count, meanInputs: count ? mean : null, maxInputs: count ? max : null, overCeiling: over }; }

/** Every metric COLLECTING — the shape of an hour of real controlling. */
function metricsBlock({ withSeries = true } = {}) {
  const s = (o) => (withSeries ? o : {});
  return {
    searchInvocations: {
      status: 'COLLECTING', target: { kind: 'TRENDING_DOWN' }, total: 12,
      byPosition: {
        GND: { facilityId: 'INCIRLIK', total: 9, mannedHours: 3, perMannedHour: 3, byHour: s({
          [H1]: { missionSession: 2, count: 4, mannedMinutes: 60, perMannedHour: 4 },
          [H2]: { missionSession: 2, count: 3, mannedMinutes: 60, perMannedHour: 3 },
          [H3]: { missionSession: 2, count: 2, mannedMinutes: 60, perMannedHour: 2 },
        }) },
        TWR: { facilityId: 'INCIRLIK', total: 3, mannedHours: 1, perMannedHour: 3, byHour: s({ [H4]: { missionSession: 2, count: 3, mannedMinutes: 20, perMannedHour: 9 } }) },
      },
    },
    timeToFind: {
      status: 'COLLECTING', target: { kind: 'P95_BELOW_MS', value: 3000 },
      samples: 14, p50Ms: 900, p95Ms: 2100, maxMs: 2600, pass: true, droppedSamples: 0,
      byPosition: { GND: { samples: 14, p50Ms: 900, p95Ms: 2100, maxMs: 2600 } },
      byHour: s({ [H2]: { missionSession: 2, samples: 6, p95Ms: 2000 }, [H3]: { missionSession: 2, samples: 8, p95Ms: 2100 } }),
    },
    gestureInputs: {
      status: 'COLLECTING', target: { kind: 'EQUALS', value: 1 },
      byGesture: { OFFSET: gesture(2, 2, 2, 2), FLIP: gesture(5, 1, 1, 0), HIGHLIGHT: gesture(1, 2, 2, 1), ATTENTION: gesture(0, null, null, 0) },
      serverSetFlagMutations: { OFFSET: 2, FLIP: 5, HIGHLIGHT: 1, ATTENTION: 0 },
    },
    correlation: { status: 'COLLECTING', target: { kind: 'AT_LEAST', value: 0.95 }, windowRate: 0.9, live: null, byHour: s({ [H3]: { missionSession: 2, rate: 0.9, samples: 60 } }) },
    rejectedMutations: {
      status: 'COLLECTING', target: { kind: 'TRENDING_DOWN' }, mutations: 120, total: 6,
      byReason: { STALE_REV: 4, NOT_HOLDING_POSITION: 2 }, byType: {}, byOp: {}, byPosition: { GND: 6 },
      byHour: s({ [H1]: { missionSession: 2, mutations: 40, total: 1, byReason: {} }, [H2]: { missionSession: 2, mutations: 40, total: 3, byReason: {} }, [H3]: { missionSession: 2, mutations: 40, total: 2, byReason: {} } }),
    },
    staleness: { status: 'COLLECTING', target: { kind: 'TRENDING_DOWN' }, total: 3, byPosition: { GND: 3 }, byState: { COASTING: 3 }, byHour: s({ [H2]: { missionSession: 2, total: 2 }, [H3]: { missionSession: 2, total: 1 } }) },
    transfers: {
      status: 'COLLECTING', target: { kind: 'AT_MOST', value: 0.005 },
      attempts: 200, succeeded: 199, failed: 1, failureRate: 0.005, routedToCovering: 2, inhibitedPress: 1,
      byCause: { STALE_REV: 1 }, byKind: { TRANSFER: { attempts: 150, failed: 1 }, NLA_TRANSFER: { attempts: 50, failed: 0 } }, byHour: {},
    },
    obligations: { status: 'NOT_INSTRUMENTED', live: null },
    systemReassigned: { total: 0, byHour: {} },
  };
}

function collectingBody() {
  return {
    ok: true, version: 1, generatedAt: NOW, serviceStartedAt: T0,
    missionSession: { seq: 2, theatre: 'Syria', startedAt: T0, lastAt: NOW, current: true },
    missionSessions: [
      { seq: 1, theatre: 'Caucasus', startedAt: T0 - 86400000, lastAt: T0 - 80000000, current: false },
      { seq: 2, theatre: 'Syria', startedAt: T0, lastAt: NOW, current: true },
    ],
    windowHours: 4, hours: [H1, H2, H3, H4],
    sources: { client: T0, staleness: T0 },
    metrics: metricsBlock(),
    lastHour: { from: NOW - 3600000, to: NOW, metrics: metricsBlock({ withSeries: false }) },
  };
}

/** A fresh crc-sync: the contract test's "empty service" answers. */
function freshBody() {
  const empty = {
    searchInvocations: { status: 'NOT_INSTRUMENTED', target: { kind: 'TRENDING_DOWN' }, total: 0, byPosition: {} },
    timeToFind: { status: 'NOT_INSTRUMENTED', target: { kind: 'P95_BELOW_MS', value: 3000 }, samples: 0, p50Ms: null, p95Ms: null, maxMs: null, pass: null, droppedSamples: 0, byPosition: {}, byHour: {} },
    gestureInputs: { status: 'NOT_INSTRUMENTED', target: { kind: 'EQUALS', value: 1 }, byGesture: { OFFSET: gesture(0), FLIP: gesture(0), HIGHLIGHT: gesture(0), ATTENTION: gesture(0) }, serverSetFlagMutations: { OFFSET: 0, FLIP: 0, HIGHLIGHT: 0, ATTENTION: 0 } },
    correlation: { status: 'NOT_INSTRUMENTED', target: { kind: 'AT_LEAST', value: 0.95 }, windowRate: null, live: null, byHour: {} },
    rejectedMutations: { status: 'NO_DATA', target: { kind: 'TRENDING_DOWN' }, mutations: 0, total: 0, byReason: {}, byType: {}, byOp: {}, byPosition: {}, byHour: {} },
    staleness: { status: 'NOT_INSTRUMENTED', target: { kind: 'TRENDING_DOWN' }, total: null, byPosition: {}, byState: {}, byHour: {} },
    transfers: { status: 'NO_DATA', target: { kind: 'AT_MOST', value: 0.005 }, attempts: 0, succeeded: 0, failed: 0, failureRate: null, routedToCovering: 0, inhibitedPress: 0, byCause: {}, byKind: { TRANSFER: { attempts: 0, failed: 0 }, NLA_TRANSFER: { attempts: 0, failed: 0 } }, byHour: {} },
    obligations: { status: 'NOT_INSTRUMENTED', live: null },
    systemReassigned: { total: 0, byHour: {} },
  };
  return {
    ok: true, version: 1, generatedAt: T0, serviceStartedAt: T0,
    missionSession: { seq: 1, theatre: null, startedAt: T0, lastAt: null, current: true },
    missionSessions: [{ seq: 1, theatre: null, startedAt: T0, lastAt: null, current: true }],
    windowHours: 1, hours: [H1], sources: { client: null, staleness: null },
    metrics: empty, lastHour: { from: T0 - 3600000, to: T0, metrics: JSON.parse(JSON.stringify(empty)) },
  };
}

/** Sources wired, rates with nothing under them: COLLECTING with null rates. */
function nullRatesBody() {
  const b = collectingBody();
  Object.assign(b.metrics.timeToFind, { samples: 0, p50Ms: null, p95Ms: null, maxMs: null, pass: null });
  Object.assign(b.metrics.correlation, { windowRate: null });
  Object.assign(b.metrics.transfers, { attempts: 0, failed: 0, failureRate: null });
  return b;
}

const cells = (model) => model.rows.flatMap(r => [r.cells.mission, r.cells.lastHour]);
const row = (model, id) => model.rows.find(r => r.id === id);

test('Every metric in §11.5 is collected and visible.', () => {
  // WP8 acceptance bullet 1, client half: seven rows in the guide's order, each
  // with a value, a target and a verdict, in both windows.
  const model = renderMetricsModel(collectingBody());
  assert.equal(model.ok, true);
  assert.deepEqual(model.rows.map(r => r.id), ['searchInvocations', 'timeToFind', 'gestureInputs', 'correlation', 'rejectedMutations', 'staleness', 'transfers']);
  for (const r of model.rows) {
    assert.ok(r.name && r.target && r.target !== '—', `${r.id}: name and target`);
    for (const c of [r.cells.mission, r.cells.lastHour]) {
      assert.ok(c.value && c.value !== '—', `${r.id}: a value`);
      assert.ok(c.verdict, `${r.id}: a verdict`);
      assert.notEqual(c.verdict, 'NOT INSTRUMENTED', `${r.id} is collected`);
    }
  }
});

test('verdicts: met, not met, and the trend for the trending-down metrics', () => {
  const m = renderMetricsModel(collectingBody());
  assert.equal(row(m, 'timeToFind').cells.mission.verdict, 'MET');
  assert.equal(row(m, 'gestureInputs').cells.mission.verdict, 'NOT MET', 'HIGHLIGHT and OFFSET cost 2');
  assert.match(row(m, 'gestureInputs').cells.mission.title, /OFFSET/);
  assert.equal(row(m, 'correlation').cells.mission.verdict, 'NOT MET');
  assert.equal(row(m, 'transfers').cells.mission.verdict, 'MET', '0.5% is at the ceiling, not over it');
  // Search per manned hour 4, 3, 2 over the three complete hours (15Z is still filling).
  assert.equal(row(m, 'searchInvocations').cells.mission.verdict, 'TRENDING ↓');
  // Rejected 1, 3, 2: rose then fell — the last step.
  assert.equal(row(m, 'rejectedMutations').cells.mission.verdict, 'TRENDING ↓');
  // Staleness: 12Z has no bucket, so 2 then 1.
  assert.equal(row(m, 'staleness').cells.mission.verdict, 'TRENDING ↓');
  // The rolling hour has no hourly series to trend.
  assert.equal(row(m, 'searchInvocations').cells.lastHour.verdict, '—');
});

test('the trend rule', () => {
  assert.equal(metricsTrend([5, 4, 4]), '↓');
  assert.equal(metricsTrend([3, 3, 3]), '→');
  assert.equal(metricsTrend([1, 3, 2]), '↓');
  assert.equal(metricsTrend([3, 1, 2]), '↑');
  assert.equal(metricsTrend([9, 1, 2, 3]), '↑', 'only the last three');
  assert.equal(metricsTrend([null, 4, null]), null, 'two points are needed');
  assert.equal(metricsTrend([2, null, 1]), '↓', 'gaps are skipped');
});

test('only NOT MET is coloured (ADR 0056)', () => {
  for (const body of [collectingBody(), freshBody(), nullRatesBody()]) {
    for (const c of cells(renderMetricsModel(body))) {
      assert.equal(c.tone === 'bad', c.verdict === 'NOT MET', `${c.verdict} is ${c.tone}`);
    }
  }
  const m = renderMetricsModel(collectingBody());
  assert.equal(row(m, 'timeToFind').cells.mission.tone, 'plain', 'a met target is plain text');
});

test('a fresh crc-sync reads NOT INSTRUMENTED and NO DATA, in words and in grey — never a zero', () => {
  const m = renderMetricsModel(freshBody());
  const verdicts = Object.fromEntries(m.rows.map(r => [r.id, r.cells.mission.verdict]));
  assert.deepEqual(verdicts, {
    searchInvocations: 'NOT INSTRUMENTED', timeToFind: 'NOT INSTRUMENTED', gestureInputs: 'NOT INSTRUMENTED',
    correlation: 'NOT INSTRUMENTED', rejectedMutations: 'NO DATA', staleness: 'NOT INSTRUMENTED', transfers: 'NO DATA',
  });
  for (const c of cells(m)) {
    assert.equal(c.tone, 'muted');
    assert.doesNotMatch(c.value, /(^|\D)0(\.0)?(%|\b)|100%/, `"${c.value}" reads as a number`);
  }
  assert.equal(row(m, 'staleness').cells.mission.value, 'not instrumented (L19)');
});

test('staleness stays "not instrumented (L19)" until sources.staleness is set, whatever its block says', () => {
  const b = collectingBody();
  b.sources.staleness = null;
  const c = row(renderMetricsModel(b), 'staleness').cells.mission;
  assert.equal(c.verdict, 'NOT INSTRUMENTED');
  assert.equal(c.value, 'not instrumented (L19)');
});

test('a null rate renders —, never 0 or 100%', () => {
  const m = renderMetricsModel(nullRatesBody());
  for (const id of ['timeToFind', 'correlation', 'transfers']) {
    const c = row(m, id).cells.mission;
    assert.equal(c.verdict, 'NO DATA', id);
    assert.doesNotMatch(c.value, /\b0\.0%|100%|\b0\.0 s/, `${id}: "${c.value}"`);
    assert.match(c.value, /—/, id);
  }
});

test('a past mission: the selector lists it, and the last-hour column is —', () => {
  const b = collectingBody();
  b.missionSession = { ...b.missionSessions[0] };
  b.lastHour = null;
  const m = renderMetricsModel(b);
  assert.equal(m.session.current, false);
  assert.match(m.session.label, /#1 Caucasus/);
  assert.deepEqual(m.sessions.map(s => s.seq), [2, 1], 'newest first');
  for (const r of m.rows) assert.equal(r.cells.lastHour.value, '—');
  // Every hour of a past session is complete: 12Z–14Z counts for the trend (4, 3, 2) and 15Z (9) too.
  assert.equal(row(m, 'searchInvocations').cells.mission.verdict, 'TRENDING ↑');
});

test('hourly sparklines carry HHMMZ labels from the mission-clock bucket keys', () => {
  const spark = row(renderMetricsModel(collectingBody()), 'timeToFind').cells.mission.spark;
  assert.deepEqual(spark.map(p => p.label), ['1200Z', '1300Z', '1400Z', '1500Z']);
  assert.deepEqual(spark.map(p => p.value), [null, 2000, 2100, null]);
});

test('per-Position numbers are there, keyed by Position — and nothing is keyed by controller (H35)', () => {
  const b = collectingBody();
  // Should a controller id ever reappear on the wire, it still must not reach the view.
  b.metrics.searchInvocations.byPosition.GND.controllerId = 'c-alice';
  b.metrics.searchInvocations.byPosition.GND.controllerName = 'Alice';
  b.metrics.timeToFind.byPosition.GND.controllerId = 'c-alice';
  b.metrics.rejectedMutations.sessions = [{ controllerId: 'c-alice', controllerName: 'Alice', rejected: 3 }];
  b.missionSessions[1].controllerId = 'c-alice';
  const m = renderMetricsModel(b);
  assert.deepEqual(m.perPosition.search.map(r => r.positionId), ['GND', 'TWR']);
  assert.deepEqual(m.perPosition.timeToFind.map(r => r.positionId), ['GND']);
  const json = JSON.stringify(m);
  assert.equal(json.includes('controllerId'), false);
  assert.equal(json.includes('c-alice'), false);
  assert.equal(json.includes('Alice'), false);
});

test('an error body is not a model', () => {
  assert.equal(renderMetricsModel({ ok: false, reason: 'NOT_FOUND', detail: 'unknown missionSession: 9' }).ok, false);
  assert.equal(renderMetricsModel(null).ok, false);
});

// ── traffic count ──

function trafficBody(over = {}) {
  return {
    ok: true, version: 1, generatedAt: NOW, from: T0, to: NOW + 1, unit: 'FLIGHT',
    policy: '[SOURCE-DEFINED] one record per DROPPED ATC Strip per Facility; see ADR 0065', missionSession: 2,
    facilities: {
      INCIRLIK: {
        homeAirports: ['LTAG'],
        totals: { flights: 5, aircraft: 8, local: 3, transient: 2, unknown: 0, formation: 2, formationAircraft: 5, suaTraversal: 2, alertScramble: 1, excluded: 1, excludedByReason: { NEVER_WORKED: 1 } },
        byHour: [{ hourUtc: H2, flights: 2, aircraft: 3, excluded: 0 }, { hourUtc: H3, flights: 3, aircraft: 5, excluded: 1 }],
        byAircraftType: { 'F-16C': { flights: 4, aircraft: 7 }, 'C-130': { flights: 1, aircraft: 1 } },
        byRole: { DEPARTURE: 3, ARRIVAL: 2 },
      },
      CENTER: { homeAirports: [], totals: { flights: 0, aircraft: 0, local: 0, transient: 0, unknown: 0, formation: 0, formationAircraft: 0, suaTraversal: 0, alertScramble: 0, excluded: 0, excludedByReason: {} }, byHour: [], byAircraftType: {}, byRole: {} },
    },
    reconciliation: { checkedAt: Date.parse('2026-09-30T14:32:00Z'), ok: true, window: {}, expected: 5, actual: 5, missing: 0, extra: 0, mismatched: 0, backfilled: 0 },
    ...over,
  };
}

test('traffic count: a partition line that sums, overlapping subsets labelled as such', () => {
  const t = renderTrafficModel(trafficBody(), 'INCIRLIK');
  assert.equal(t.partition.text, 'local 3 + transient 2 + unknown 0 = 5 flights');
  assert.equal(t.partition.ok, true);
  assert.equal(t.aircraft, '8 aircraft');
  assert.match(t.subsets, /^of which: formation 2 \(5 aircraft\), SUA traversal 2, alert scramble 1$/);
  assert.deepEqual(t.byHour.map(h => h.hour), ['1300Z', '1400Z']);
  assert.deepEqual(t.byType.map(r => r.type), ['F-16C', 'C-130']);
  assert.deepEqual(t.excluded, [{ reason: 'NEVER_WORKED', count: 1 }]);
  assert.match(t.policy, /^\[SOURCE-DEFINED\]/, 'verbatim');
  assert.deepEqual(t.facilities, ['CENTER', 'INCIRLIK']);
});

test('traffic count: a partition that does not sum is flagged', () => {
  const b = trafficBody();
  b.facilities.INCIRLIK.totals.unknown = 1;
  const t = renderTrafficModel(b, 'INCIRLIK');
  assert.equal(t.partition.ok, false);
  assert.equal(t.partition.tone, 'bad');
});

test('traffic count: the reconciliation line — plain when it reconciles, coloured when not', () => {
  const ok = renderTrafficModel(trafficBody(), 'INCIRLIK').reconciliation;
  assert.equal(ok.text, 'reconciles with the Mutation log ✓ (checked 1432Z)');
  assert.equal(ok.tone, 'plain');
  const bad = renderTrafficModel(trafficBody({ reconciliation: { checkedAt: NOW, ok: false, window: {}, expected: 5, actual: 4, missing: 2, extra: 1, mismatched: 0, backfilled: 0 } }), 'INCIRLIK').reconciliation;
  assert.equal(bad.text, 'does not reconcile with the Mutation log: 2 missing, 1 extra (checked 1520Z)');
  assert.equal(bad.tone, 'bad');
  assert.equal(renderTrafficModel(trafficBody({ reconciliation: null }), 'INCIRLIK').reconciliation.tone, 'muted');
});

test('traffic count: an unknown Facility falls back to INCIRLIK', () => {
  assert.equal(renderTrafficModel(trafficBody(), 'RANGES').facilityId, 'INCIRLIK');
});

test('the panel renders seven metric rows into the DOM', () => {
  const els = { 'metrics-panel': makeElement('div'), 'metrics-content': makeElement('div') };
  const sent = [];
  const sandbox = {
    console, module: { exports: {} }, setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout,
    Date, JSON, Math, Number, Set, Map, Array, Object, String, Boolean, isNaN, parseInt, parseFloat,
    crypto: { randomUUID: () => 'req-1' },
    document: { getElementById: (id) => els[id] || null, createElement: makeElement },
    isSyncOpen: () => true, sendToSync: (m) => sent.push(m),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/public/js/panels/metrics-panel.js'), 'utf8'), sandbox);
  sandbox.initMetricsPanel();
  assert.equal(sent.length, 1, 'asks on open');
  assert.equal(sent[0].type, 'efsp-metrics-request');
  assert.equal(sent[0].missionSession, null);
  sandbox.onEfspMetrics({ type: 'efsp-metrics', requestId: 'stale', ok: true, metrics: freshBody() });
  assert.equal(descendants(els['metrics-content']).filter(c => c.dataset && c.dataset.metric).length, 0, 'an answer to an older request is ignored');
  sandbox.onEfspMetrics({ type: 'efsp-metrics', requestId: 'req-1', ok: true, metrics: collectingBody(), trafficCount: trafficBody() });
  const rows = descendants(els['metrics-content']).filter(c => c.dataset && c.dataset.metric);
  assert.deepEqual(rows.map(r => r.dataset.metric), METRICS_ROWS.map(r => r.id));
  const text = descendants(els['metrics-content']).map(c => c.textContent).join('\n');
  assert.match(text, /reconciles with the Mutation log ✓/);
  assert.match(text, /Per Position/);
  assert.doesNotMatch(text, /Searches/, 'per-Position numbers are folded by default (H66)');
});
