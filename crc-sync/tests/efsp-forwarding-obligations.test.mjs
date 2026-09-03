import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  computeDueObligations, ForwardingObligationMonitor,
  ADVANCE_FORWARDING_MINUTES, ETA_REVISION_THRESHOLD_MINUTES, AMENDMENT_WINDOW_MINUTES, DATA_ONLY_VERIFICATION_MINUTES,
} = await import('../src/efsp/forwarding-obligations.js');

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
const MIN = 60 * 1000;

function makeArrivalStrip(overrides = {}) {
  return { stripId: 's1', role: 'ARRIVAL', state: 'INBOUND', coordination: null, ...overrides };
}
function makeDepartureStrip(overrides = {}) {
  return { stripId: 's1', role: 'DEPARTURE', state: 'PROPOSED', coordination: null, ...overrides };
}
function makeFdr(overrides = {}) {
  return {
    updatedAt: NOW,
    filed: { estimatedArrivalTimeUtc: null, proposedDepartureTimeUtc: null, ...overrides.filed },
    ...overrides,
  };
}

test('computeDueObligations returns [] for null strip/fdr, never a throw', () => {
  assert.deepEqual(computeDueObligations(null, makeFdr(), NOW), []);
  assert.deepEqual(computeDueObligations(makeArrivalStrip(), null, NOW), []);
});

// ── ADVANCE_FORWARDING ──────────────────────────────────────────────────

test('ADVANCE_FORWARDING is not yet due more than 15 minutes before the ETA', () => {
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW + (ADVANCE_FORWARDING_MINUTES + 1) * MIN } });
  assert.deepEqual(computeDueObligations(makeArrivalStrip(), fdr, NOW), []);
});

test('ADVANCE_FORWARDING is due (WARNING) exactly 15 minutes before the ETA, while unforwarded', () => {
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW + ADVANCE_FORWARDING_MINUTES * MIN } });
  const result = computeDueObligations(makeArrivalStrip(), fdr, NOW);
  assert.deepEqual(result, [{ obligationType: 'ADVANCE_FORWARDING', dueAt: NOW, severity: 'WARNING' }]);
});

test('ADVANCE_FORWARDING escalates to OVERDUE once the ETA itself has passed with no coordination started', () => {
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW - MIN } });
  const result = computeDueObligations(makeArrivalStrip(), fdr, NOW);
  assert.equal(result.find(o => o.obligationType === 'ADVANCE_FORWARDING').severity, 'OVERDUE');
});

test('ADVANCE_FORWARDING never fires once a coordination link exists — already forwarded', () => {
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW - MIN } });
  const strip = makeArrivalStrip({ coordination: { state: 'PROPOSED', lastForwardedEtaUtc: NOW - MIN } });
  const result = computeDueObligations(strip, fdr, NOW);
  assert.equal(result.some(o => o.obligationType === 'ADVANCE_FORWARDING'), false);
});

test('ADVANCE_FORWARDING never fires for a DEPARTURE-role Strip', () => {
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW - MIN } });
  assert.deepEqual(computeDueObligations(makeDepartureStrip(), fdr, NOW), []);
});

// ── ETA_REVISION ────────────────────────────────────────────────────────

test('ETA_REVISION does not fire when the drift is within the 3-minute threshold', () => {
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW + 60 * MIN } });
  const strip = makeArrivalStrip({ coordination: { state: 'ACTIVE', lastForwardedEtaUtc: NOW + 60 * MIN + 2 * MIN } });
  assert.deepEqual(computeDueObligations(strip, fdr, NOW), []);
});

test('ETA_REVISION fires once drift exceeds 3 minutes, in either direction', () => {
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW + 60 * MIN } });
  const strip = makeArrivalStrip({ coordination: { state: 'ACTIVE', lastForwardedEtaUtc: NOW + 60 * MIN - (ETA_REVISION_THRESHOLD_MINUTES + 1) * MIN } });
  const result = computeDueObligations(strip, fdr, NOW);
  assert.deepEqual(result, [{ obligationType: 'ETA_REVISION', dueAt: NOW, severity: 'WARNING' }]);
});

test('ETA_REVISION never fires without an open coordination link at all', () => {
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW + 60 * MIN } });
  assert.deepEqual(computeDueObligations(makeArrivalStrip(), fdr, NOW), []);
});

test('ETA_REVISION never fires on a REJECTED coordination link', () => {
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW + 60 * MIN } });
  const strip = makeArrivalStrip({ coordination: { state: 'REJECTED', lastForwardedEtaUtc: NOW } });
  assert.deepEqual(computeDueObligations(strip, fdr, NOW), []);
});

// ── AMENDMENT_INSIDE_30MIN ────────────────────────────────────────────────

test('AMENDMENT_INSIDE_30MIN fires for a DEPARTURE Strip amended within the last minute, inside 30 minutes of proposed departure', () => {
  const fdr = makeFdr({ updatedAt: NOW - 5000, filed: { proposedDepartureTimeUtc: NOW + 10 * MIN } });
  const result = computeDueObligations(makeDepartureStrip(), fdr, NOW);
  assert.deepEqual(result, [{ obligationType: 'AMENDMENT_INSIDE_30MIN', dueAt: NOW, severity: 'WARNING' }]);
});

test('AMENDMENT_INSIDE_30MIN does not fire when the amendment was more than 60s ago', () => {
  const fdr = makeFdr({ updatedAt: NOW - 5 * MIN, filed: { proposedDepartureTimeUtc: NOW + 10 * MIN } });
  assert.deepEqual(computeDueObligations(makeDepartureStrip(), fdr, NOW), []);
});

test('AMENDMENT_INSIDE_30MIN does not fire outside the 30-minute departure window', () => {
  const fdr = makeFdr({ updatedAt: NOW - 5000, filed: { proposedDepartureTimeUtc: NOW + (AMENDMENT_WINDOW_MINUTES + 5) * MIN } });
  assert.deepEqual(computeDueObligations(makeDepartureStrip(), fdr, NOW), []);
});

test('AMENDMENT_INSIDE_30MIN does not fire once the proposed departure time has already passed', () => {
  const fdr = makeFdr({ updatedAt: NOW - 5000, filed: { proposedDepartureTimeUtc: NOW - MIN } });
  assert.deepEqual(computeDueObligations(makeDepartureStrip(), fdr, NOW), []);
});

// ── DATA_ONLY_VERIFICATION ────────────────────────────────────────────────

test('DATA_ONLY_VERIFICATION never fires when the Facility is not data-only (the case for both real Facilities this slice)', () => {
  const fdr = makeFdr();
  const strip = makeArrivalStrip({ coordination: { state: 'ACTIVE', acceptedAt: NOW - 10 * MIN } });
  assert.deepEqual(computeDueObligations(strip, fdr, NOW, { dataOnly: false }), []);
});

test('DATA_ONLY_VERIFICATION fires (OVERDUE) once 3 minutes have passed since ACCEPT at a data-only Facility — synthetic fixture only', () => {
  const fdr = makeFdr();
  const strip = makeArrivalStrip({ coordination: { state: 'ACTIVE', acceptedAt: NOW - (DATA_ONLY_VERIFICATION_MINUTES + 1) * MIN } });
  const result = computeDueObligations(strip, fdr, NOW, { dataOnly: true });
  assert.equal(result.some(o => o.obligationType === 'DATA_ONLY_VERIFICATION' && o.severity === 'OVERDUE'), true);
});

test('DATA_ONLY_VERIFICATION does not fire before the 3-minute window elapses', () => {
  const fdr = makeFdr();
  const strip = makeArrivalStrip({ coordination: { state: 'ACTIVE', acceptedAt: NOW - MIN } });
  assert.deepEqual(computeDueObligations(strip, fdr, NOW, { dataOnly: true }), []);
});

// ── ForwardingObligationMonitor ──────────────────────────────────────────

function makeBoardStore(strips) {
  return { getAll: () => strips };
}

test('tick() alerts once per Strip+obligationType, even across repeated ticks', () => {
  const strip = makeArrivalStrip({ coordination: null });
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW - MIN } });
  const alerts = [];
  const monitor = new ForwardingObligationMonitor({
    boardStoreFor: (facilityId) => (facilityId === 'CENTER' ? makeBoardStore([strip]) : makeBoardStore([])),
    fdrStore: { getFdr: () => fdr },
    facilityConfig: { getFacilityIds: () => ['INCIRLIK', 'CENTER'], getFacilityConfig: () => ({ dataOnly: false }) },
    onAlert: (alert) => alerts.push(alert),
  });

  monitor.tick(NOW);
  monitor.tick(NOW + 1000);
  monitor.tick(NOW + 2000);

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].facilityId, 'CENTER');
  assert.equal(alerts[0].stripId, 's1');
  assert.equal(alerts[0].obligationType, 'ADVANCE_FORWARDING');
});

test('tick() skips DROPPED Strips entirely', () => {
  const strip = makeArrivalStrip({ state: 'DROPPED', coordination: null });
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW - MIN } });
  const alerts = [];
  const monitor = new ForwardingObligationMonitor({
    boardStoreFor: () => makeBoardStore([strip]),
    fdrStore: { getFdr: () => fdr },
    facilityConfig: { getFacilityIds: () => ['INCIRLIK'], getFacilityConfig: () => ({ dataOnly: false }) },
    onAlert: (alert) => alerts.push(alert),
  });
  monitor.tick(NOW);
  assert.deepEqual(alerts, []);
});

test('a missed obligation is recorded in compliance stats; recordMet() is available for a caller to count the opposite', () => {
  const strip = makeArrivalStrip({ coordination: null });
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW - MIN } });
  const monitor = new ForwardingObligationMonitor({
    boardStoreFor: () => makeBoardStore([strip]),
    fdrStore: { getFdr: () => fdr },
    facilityConfig: { getFacilityIds: () => ['INCIRLIK'], getFacilityConfig: () => ({ dataOnly: false }) },
  });
  monitor.tick(NOW);
  assert.deepEqual(monitor.getComplianceStats(), { ADVANCE_FORWARDING: { met: 0, missed: 1 } });

  monitor.recordMet('ADVANCE_FORWARDING');
  assert.deepEqual(monitor.getComplianceStats(), { ADVANCE_FORWARDING: { met: 1, missed: 1 } });
});

test('tick() with no onAlert callback does not throw', () => {
  const strip = makeArrivalStrip({ coordination: null });
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW - MIN } });
  const monitor = new ForwardingObligationMonitor({
    boardStoreFor: () => makeBoardStore([strip]),
    fdrStore: { getFdr: () => fdr },
    facilityConfig: { getFacilityIds: () => ['INCIRLIK'], getFacilityConfig: () => ({ dataOnly: false }) },
  });
  assert.doesNotThrow(() => monitor.tick(NOW));
});
