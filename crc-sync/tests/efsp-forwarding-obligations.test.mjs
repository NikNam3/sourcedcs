import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  computeDueObligations, computePendingObligations, ForwardingObligationMonitor,
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

function makeMonitor({ strips, fdr, facilities = ['INCIRLIK'], boardFor, dataOnly = false, airspaceStore, fdrFor } = {}) {
  return new ForwardingObligationMonitor({
    boardStoreFor: boardFor || (() => makeBoardStore(strips)),
    fdrStore: { getFdr: fdrFor || (() => fdr) },
    facilityConfig: { getFacilityIds: () => facilities, getFacilityConfig: () => ({ dataOnly }) },
    airspaceStore,
  });
}

test('tick() raises once per Strip+obligationType: true on the first raise, false on identical ticks, one entry', () => {
  const strip = makeArrivalStrip({ coordination: null });
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW + MIN } });
  const monitor = makeMonitor({
    fdr, facilities: ['INCIRLIK', 'CENTER'],
    boardFor: (facilityId) => (facilityId === 'CENTER' ? makeBoardStore([strip]) : makeBoardStore([])),
  });

  assert.equal(monitor.tick(NOW), true);
  assert.equal(monitor.tick(NOW + 1000), false);
  assert.equal(monitor.tick(NOW + 2000), false);

  assert.deepEqual(monitor.getAll(), [{
    facilityId: 'CENTER', stripId: 's1', obligationType: 'ADVANCE_FORWARDING',
    severity: 'WARNING', dueAt: NOW + MIN - ADVANCE_FORWARDING_MINUTES * MIN, since: NOW,
  }]);
  assert.equal(monitor.getComplianceStats().ADVANCE_FORWARDING.missed, 1);
});

test('tick() skips DROPPED Strips entirely', () => {
  const strip = makeArrivalStrip({ state: 'DROPPED', coordination: null });
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW - MIN } });
  const monitor = makeMonitor({ strips: [strip], fdr });
  assert.equal(monitor.tick(NOW), false);
  assert.deepEqual(monitor.getAll(), []);
});

test('a missed obligation is recorded in compliance stats; recordMet() counts the opposite', () => {
  const strip = makeArrivalStrip({ coordination: null });
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW - MIN } });
  const monitor = makeMonitor({ strips: [strip], fdr });
  monitor.tick(NOW);
  assert.deepEqual(monitor.getComplianceStats(), { ADVANCE_FORWARDING: { met: 0, missed: 1 } });

  monitor.recordMet('ADVANCE_FORWARDING');
  assert.deepEqual(monitor.getComplianceStats(), { ADVANCE_FORWARDING: { met: 1, missed: 1 } });
});

test('a stray onAlert passed to the constructor is ignored, never called and never a throw', () => {
  const strip = makeArrivalStrip({ coordination: null });
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW - MIN } });
  let called = 0;
  const monitor = new ForwardingObligationMonitor({
    boardStoreFor: () => makeBoardStore([strip]),
    fdrStore: { getFdr: () => fdr },
    facilityConfig: { getFacilityIds: () => ['INCIRLIK'], getFacilityConfig: () => ({ dataOnly: false }) },
    onAlert: () => { called += 1; },
  });
  assert.doesNotThrow(() => monitor.tick(NOW));
  assert.equal(called, 0);
  assert.equal(monitor.getAll().length, 1);
});

test('an obligation retracts when its Strip becomes DROPPED, and when the Strip is gone from the Board', () => {
  const strip = makeArrivalStrip({ coordination: null });
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW - MIN } });
  let strips = [strip];
  const monitor = makeMonitor({ boardFor: () => makeBoardStore(strips), fdr });
  assert.equal(monitor.tick(NOW), true);
  strip.state = 'DROPPED';
  assert.equal(monitor.tick(NOW + 1000), true);
  assert.deepEqual(monitor.getAll(), []);

  strip.state = 'INBOUND';
  assert.equal(monitor.tick(NOW + 2000), true);
  strips = [];
  assert.equal(monitor.tick(NOW + 3000), true);
  assert.deepEqual(monitor.getAll(), []);
});

test('ADVANCE_FORWARDING WARNING -> OVERDUE is a change the client gets; since held, missed still 1', () => {
  const strip = makeArrivalStrip({ coordination: null });
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW + MIN } });
  const monitor = makeMonitor({ strips: [strip], fdr });
  assert.equal(monitor.tick(NOW), true);
  assert.equal(monitor.getAll()[0].severity, 'WARNING');
  assert.equal(monitor.tick(NOW + 2 * MIN), true);
  const [entry] = monitor.getAll();
  assert.equal(entry.severity, 'OVERDUE');
  assert.equal(entry.since, NOW);
  assert.equal(monitor.getComplianceStats().ADVANCE_FORWARDING.missed, 1);
  assert.equal(monitor.tick(NOW + 3 * MIN), false);
});

test('ETA_REVISION (dueAt: now) stays one unchanged entry across ticks at different now', () => {
  const strip = makeArrivalStrip({ coordination: { state: 'ACTIVE', lastForwardedEtaUtc: NOW + 30 * MIN } });
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW + 40 * MIN } });
  const monitor = makeMonitor({ strips: [strip], fdr });
  assert.equal(monitor.tick(NOW), true);
  assert.equal(monitor.tick(NOW + 15000), false);
  assert.equal(monitor.tick(NOW + 30000), false);
  assert.deepEqual(monitor.getAll().map(e => [e.obligationType, e.dueAt, e.since]), [['ETA_REVISION', NOW, NOW]]);
});

test('raise, clear, raise again counts two missed episodes', () => {
  const strip = makeArrivalStrip({ coordination: { state: 'ACTIVE', lastForwardedEtaUtc: NOW + 30 * MIN } });
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW + 40 * MIN } });
  const monitor = makeMonitor({ strips: [strip], fdr });
  monitor.tick(NOW);
  strip.coordination.lastForwardedEtaUtc = NOW + 40 * MIN; // re-forwarded
  assert.equal(monitor.tick(NOW + MIN), true);
  assert.deepEqual(monitor.getAll(), []);
  fdr.filed.estimatedArrivalTimeUtc = NOW + 50 * MIN; // drifted again
  assert.equal(monitor.tick(NOW + 2 * MIN), true);
  assert.equal(monitor.getAll()[0].since, NOW + 2 * MIN);
  assert.deepEqual(monitor.getComplianceStats(), { ETA_REVISION: { met: 0, missed: 2 } });
});

test('UNACTIVATED_AIRSPACE_ENTRY retracts when the airspace becomes active', () => {
  let active = false;
  const strip = makeArrivalStrip({ coordination: { state: 'ACTIVE' }, airspaceEntry: { airspaceId: 'R-1', approvedAt: NOW - MIN } });
  const monitor = makeMonitor({ strips: [strip], fdr: makeFdr(), airspaceStore: { isActive: () => active } });
  assert.equal(monitor.tick(NOW), true);
  assert.equal(monitor.getAll()[0].obligationType, 'UNACTIVATED_AIRSPACE_ENTRY');
  active = true;
  assert.equal(monitor.tick(NOW + 1000), true);
  assert.deepEqual(monitor.getAll(), []);
});

test('two Facilities\' replicas of one FDR hold independent entries', () => {
  const a = makeArrivalStrip({ stripId: 'sA', fdrId: 'f1', coordination: null });
  const b = makeArrivalStrip({ stripId: 'sB', fdrId: 'f1', coordination: null });
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW - MIN } });
  const monitor = makeMonitor({
    fdr, facilities: ['INCIRLIK', 'CENTER'],
    boardFor: (facilityId) => makeBoardStore(facilityId === 'CENTER' ? [b] : [a]),
  });
  monitor.tick(NOW);
  assert.deepEqual(monitor.getAll().map(e => [e.facilityId, e.stripId]), [['INCIRLIK', 'sA'], ['CENTER', 'sB']]);
  b.coordination = { state: 'PROPOSED' }; // CENTER forwarded; INCIRLIK has not
  assert.equal(monitor.tick(NOW + 1000), true);
  assert.deepEqual(monitor.getAll().map(e => [e.facilityId, e.stripId]), [['INCIRLIK', 'sA']]);
});

// ── recordMet(): done before it was due (docs/adr/0067) ────────────────

test('computePendingObligations: ADVANCE_FORWARDING is pending at dueAt - 1, not at dueAt', () => {
  const eta = NOW + 20 * MIN;
  const dueAt = eta - ADVANCE_FORWARDING_MINUTES * MIN;
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: eta } });
  assert.deepEqual(computePendingObligations(makeArrivalStrip(), fdr, dueAt - 1), [{ obligationType: 'ADVANCE_FORWARDING', dueAt }]);
  assert.deepEqual(computePendingObligations(makeArrivalStrip(), fdr, dueAt), []);
  assert.deepEqual(computePendingObligations(makeArrivalStrip({ coordination: { state: 'PROPOSED' } }), fdr, dueAt - 1), []);
});

test('computePendingObligations: VOID_TIME_EXPIRED is pending at dueAt - 1, not at dueAt', () => {
  const fdr = makeVoidFdr(NOW);
  assert.deepEqual(computePendingObligations(makeHeldStrip(), fdr, NOW - 1), [{ obligationType: 'VOID_TIME_EXPIRED', dueAt: NOW }]);
  assert.deepEqual(computePendingObligations(makeHeldStrip(), fdr, NOW), []);
  assert.deepEqual(computePendingObligations(makeHeldStrip({ state: 'CLEARED' }), fdr, NOW - 1), []);
});

test('coordination proposed at ETA - 20 min counts ADVANCE_FORWARDING met', () => {
  const strip = makeArrivalStrip();
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW + 20 * MIN } });
  const monitor = makeMonitor({ strips: [strip], fdr });
  monitor.tick(NOW - MIN);
  strip.coordination = { state: 'PROPOSED' };
  assert.equal(monitor.tick(NOW), false);
  assert.deepEqual(monitor.getComplianceStats(), { ADVANCE_FORWARDING: { met: 1, missed: 0 } });
  monitor.tick(NOW + 30 * MIN);
  assert.deepEqual(monitor.getComplianceStats(), { ADVANCE_FORWARDING: { met: 1, missed: 0 } });
});

test('a pending ADVANCE_FORWARDING whose Strip is dropped instead counts nothing', () => {
  const strip = makeArrivalStrip();
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW + 20 * MIN } });
  const monitor = makeMonitor({ strips: [strip], fdr });
  monitor.tick(NOW - MIN);
  strip.state = 'DROPPED';
  monitor.tick(NOW);
  assert.deepEqual(monitor.getComplianceStats(), {});
});

test('a VOID Strip leaving HELD before the deadline counts met; one left HELD past it counts missed', () => {
  const got = makeHeldStrip();
  const fdr = makeVoidFdr(NOW + MIN);
  const m1 = makeMonitor({ strips: [got], fdr });
  m1.tick(NOW);
  got.state = 'PUSHBACK';
  m1.tick(NOW + 30000);
  assert.deepEqual(m1.getComplianceStats(), { VOID_TIME_EXPIRED: { met: 1, missed: 0 } });

  const stuck = makeHeldStrip();
  const m2 = makeMonitor({ strips: [stuck], fdr });
  m2.tick(NOW);
  m2.tick(NOW + 2 * MIN);
  assert.deepEqual(m2.getComplianceStats(), { VOID_TIME_EXPIRED: { met: 0, missed: 1 } });
});

test('a VOID Strip put back to CLEARED before the deadline did not get away: counts nothing', () => {
  const strip = makeHeldStrip();
  const monitor = makeMonitor({ strips: [strip], fdr: makeVoidFdr(NOW + MIN) });
  monitor.tick(NOW);
  strip.state = 'CLEARED';
  monitor.tick(NOW + 30000);
  assert.deepEqual(monitor.getComplianceStats(), {});
});

test('the due-the-moment-they-exist types never count met', () => {
  const strip = makeArrivalStrip({ coordination: { state: 'ACTIVE', lastForwardedEtaUtc: NOW + 30 * MIN } });
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: NOW + 40 * MIN } });
  const monitor = makeMonitor({ strips: [strip], fdr });
  monitor.tick(NOW);
  strip.coordination.lastForwardedEtaUtc = NOW + 40 * MIN;
  monitor.tick(NOW + MIN);
  assert.deepEqual(monitor.getComplianceStats(), { ETA_REVISION: { met: 0, missed: 1 } });
});

// ── VOID_TIME_EXPIRED ───────────────────────────────────────────────────
//
// §3.8's "the system MUST alert if the flight is not airborne" by the derived
// 30-minute deadline. isVoidExpired() has existed since Phase 1 but only ever
// inhibited the release button — a passive check a controller had to go and
// look at. These cover it as a real obligation.

function makeHeldStrip(overrides = {}) {
  return { stripId: 's1', role: 'DEPARTURE', state: 'HELD', coordination: null, ...overrides };
}
function makeVoidFdr(voidDeadlineUtc, overrides = {}) {
  return {
    updatedAt: NOW,
    filed: { estimatedArrivalTimeUtc: null, proposedDepartureTimeUtc: null, ...overrides.filed },
    assigned: { releaseState: 'CLEARANCE_VOID_TIME', voidTimeUtc: voidDeadlineUtc - 30 * MIN, voidDeadlineUtc },
  };
}

test('VOID_TIME_EXPIRED is not yet due one minute before the derived deadline', () => {
  const fdr = makeVoidFdr(NOW + MIN);
  assert.deepEqual(computeDueObligations(makeHeldStrip(), fdr, NOW), []);
});

test('VOID_TIME_EXPIRED fires as OVERDUE at exactly the deadline — a hard deadline, so no WARNING tier', () => {
  const fdr = makeVoidFdr(NOW);
  assert.deepEqual(computeDueObligations(makeHeldStrip(), fdr, NOW), [
    { obligationType: 'VOID_TIME_EXPIRED', dueAt: NOW, severity: 'OVERDUE' },
  ]);
});

test('VOID_TIME_EXPIRED never fires without a CLEARANCE_VOID_TIME release state — there is no deadline to miss', () => {
  const fdr = { updatedAt: NOW, filed: {}, assigned: { releaseState: 'RELEASED', voidTimeUtc: null, voidDeadlineUtc: null } };
  assert.deepEqual(computeDueObligations(makeHeldStrip(), fdr, NOW), []);
});

test('VOID_TIME_EXPIRED never fires for a Strip that is no longer HELD — the flight got away in time', () => {
  const fdr = makeVoidFdr(NOW - MIN);
  assert.deepEqual(computeDueObligations(makeHeldStrip({ state: 'DEPARTED' }), fdr, NOW), []);
});

test('VOID_TIME_EXPIRED never fires for a non-DEPARTURE Role — void time is a departure-clearance concept', () => {
  const fdr = makeVoidFdr(NOW - MIN);
  const strip = { stripId: 's1', role: 'ARRIVAL', state: 'HELD', coordination: null };
  assert.equal(computeDueObligations(strip, fdr, NOW).some(o => o.obligationType === 'VOID_TIME_EXPIRED'), false);
});

test('the monitor raises VOID_TIME_EXPIRED once, and retracts it when the Strip leaves HELD', () => {
  const strip = makeHeldStrip();
  const fdr = makeVoidFdr(NOW - MIN);
  const monitor = makeMonitor({ strips: [strip], fdr });

  assert.equal(monitor.tick(NOW), true);
  assert.equal(monitor.tick(NOW + MIN), false);
  assert.equal(monitor.getAll().length, 1);
  assert.equal(monitor.getAll()[0].obligationType, 'VOID_TIME_EXPIRED');
  assert.equal(monitor.getAll()[0].severity, 'OVERDUE');
  assert.equal(monitor.getComplianceStats().VOID_TIME_EXPIRED.missed, 1);

  strip.state = 'CLEARED';
  assert.equal(monitor.tick(NOW + 2 * MIN), true);
  assert.deepEqual(monitor.getAll(), []);
});
