import { test } from 'node:test';
import assert from 'node:assert/strict';

// docs/adr/0147 (H176): a conflict alert is shown only at the Positions with track control of its aircraft. A CA at the
// holders of either aircraft, an MCI at the tracked aircraft's (and there only where its Facility lets the intruder
// through); nobody else is shown or suppresses it. One session's suppress applies at every Position it is Primary at
// where the alert is shown. Ids here are test data only (ADR 0132).
const { ConflictAlertMonitor } = await import('../src/conflict-alert.js');
const { trackControlPositions } = await import('../src/efsp/track-control.js');
const { loadAlertingConfig } = await import('../src/alerting-config.js');
const { default: WsHub } = await import('../src/ws-hub.js');
const { default: TrackStore } = await import('../src/tracks.js');
const { default: CollaborativeStore } = await import('../src/collab-store.js');
const { fakeWs } = await import('./helpers/ws.mjs');

const cfg = loadAlertingConfig().conflictAlert;
const KT = 0.514444;
const NOW = 1_000_000;
const NM_LAT = 1 / 60;
const F = 'F1';
const P_A = { facilityId: F, positionId: 'P_A' };
const P_B = { facilityId: F, positionId: 'P_B' };
const P_C = { facilityId: F, positionId: 'P_C' };
const P_TAC = { facilityId: F, positionId: 'P_TAC' };

function track(id, over) {
  return { id, callsign: `T${id}`, category: 1, lat: 37, lon: 35, alt: 3000, course: 0, groundSpeed: 400 * KT, verticalSpeed: 0, firstSeenAt: NOW - 60000, ...over };
}

const strip = (over) => ({ stripId: 's', flightDataId: 'f', state: 'TRACKED', ownerPositionId: 'P_A', coordination: null, vfrHandoff: null, ...over });

// ── track control ──────────────────────────────────────────────────────────────────────────────────────────────────

test('track control: the Strip holder; both ends of a handoff until it is accepted, the receiver after', () => {
  const ids = (entries) => trackControlPositions(entries).map(p => `${p.facilityId}/${p.positionId}`);
  assert.deepEqual(ids([{ facilityId: F, strip: strip() }]), ['F1/P_A'], 'the holder');
  assert.deepEqual(ids([{ facilityId: F, strip: strip({ state: 'DROPPED' }) }]), [], 'a dropped Strip holds nothing');
  assert.deepEqual(ids([{ facilityId: F, strip: strip({ stripType: 'VFR', vfrHandoff: { toPositionId: 'P_B' } }) }]), ['F1/P_A', 'F1/P_B'],
    'an open VFR handoff: the holder and the Position it names');

  const handoff = (state) => [
    { facilityId: F, strip: strip({ coordination: { primitive: 'HANDOFF', state } }) },
    { facilityId: 'F2', strip: strip({ ownerPositionId: 'P_X', coordination: { primitive: 'HANDOFF', state, mintedForCoordination: true } }) },
  ];
  assert.deepEqual(ids(handoff('INITIATED')), ['F1/P_A', 'F2/P_X'], 'in progress: both ends');
  assert.deepEqual(ids(handoff('ACTIVE')), ['F2/P_X'], 'accepted: the receiver');
  assert.deepEqual(ids(handoff('REJECTED')), ['F1/P_A'], 'rejected: the transferring Position');

  const pointOut = [
    { facilityId: F, strip: strip({ coordination: { primitive: 'POINT_OUT', state: 'ACTIVE' } }) },
    { facilityId: 'F2', strip: strip({ ownerPositionId: 'P_X', coordination: { primitive: 'POINT_OUT', state: 'ACTIVE', mintedForCoordination: true } }) },
  ];
  assert.deepEqual(ids(pointOut), ['F1/P_A'], 'a point-out never gives the receiver the track');
});

// ── the monitor ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Tracks 1 and 2 head-on, both correlated (flights f1, f2); 3 untracked, head-on with 1 from the side, replying Mode C.
 * `control`: flightDataId -> the Positions with track control.
 */
function monitor(control, { tracks, mciShownAt } = {}) {
  const all = tracks || [track(1, { lat: 37, course: 0 }), track(2, { lat: 37 + 10 * NM_LAT, course: 180 })];
  const m = new ConflictAlertMonitor({
    trackStore: { getAll: () => all }, config: cfg,
    trackedFlights: () => new Map([['1', 'f1'], ['2', 'f2']]),
    isAtcPosition: (positionId) => positionId !== P_TAC.positionId,
    trackControlOf: (flightDataId) => control[flightDataId] || [],
    mciShownAt,
    clock: { now: () => 42 },
  });
  m.tick(NOW);
  return m;
}

test('a CA is shown only at the Positions working either aircraft, nobody else', () => {
  const m = monitor({ f1: [P_A], f2: [P_B] });
  const ca = m.getAll().find(c => c.id === '1|2');
  assert.equal(ca.kind, 'CA');
  assert.equal(m.deliverableTo(ca, [P_A]), true, 'A works aircraft 1');
  assert.equal(m.deliverableTo(ca, [P_B]), true, 'B works aircraft 2');
  assert.equal(m.deliverableTo(ca, [P_C]), false, 'C works neither: nothing');
  assert.equal(m.deliverableTo(ca, [{ facilityId: 'F2', positionId: 'P_A' }]), false, 'the same id in another Facility is not the holder');
  assert.deepEqual(m.presentFor(ca, [P_A, P_C]).shownAt, ['P_A'], 'shown at the session\'s working Position only');
});

test('nobody works either aircraft: shown nowhere', () => {
  const m = monitor({});
  const ca = m.getAll()[0];
  assert.equal(m.deliverableTo(ca, [P_A, P_B, P_C]), false);
  assert.equal(m.setSuppressed(ca.id, P_A, true).reason, 'NOT_FOUND', 'nor suppressed there');
});

test('an MCI is shown only at the tracked aircraft\'s Position, and there only where its Facility lets it through', () => {
  const tracks = [track(1, { lat: 37, course: 0 }), track(9, { lat: 37 + 10 * NM_LAT, course: 180 })];
  let through = true;
  const m = new ConflictAlertMonitor({
    trackStore: { getAll: () => tracks }, config: cfg,
    trackedFlights: () => new Map([['1', 'f1']]),
    trackControlOf: (f) => (f === 'f1' ? [P_A] : []),
    mciShownAt: () => through,
  });
  m.tick(NOW);
  const mci = m.getAll()[0];
  assert.equal(mci.kind, 'MCI');
  assert.equal(m.deliverableTo(mci, [P_A]), true);
  assert.equal(m.deliverableTo(mci, [P_B]), false, 'another Position: nothing');
  through = false;
  assert.equal(m.deliverableTo(mci, [P_A]), false, 'inhibited or below the base altitude at the holder\'s Facility');
});

test('A works one aircraft, B the other: each suppresses at their own Position only', () => {
  const m = monitor({ f1: [P_A], f2: [P_B] });
  assert.equal(m.setSuppressed('1|2', P_A, true, 'alice').ok, true);
  const ca = m.getAll()[0];
  assert.deepEqual(m.presentFor(ca, [P_A]).suppressedAt, ['P_A']);
  assert.equal(m.presentFor(ca, [P_B]).suppressedAt, undefined, 'B\'s alert still flashes');
  assert.equal(m.setSuppressed('1|2', P_B, true, 'bob').ok, true);
  assert.deepEqual(m.presentFor(ca, [P_B]).suppressedAt, ['P_B']);
  assert.equal(m.setSuppressed('1|2', P_A, false).ok, true);
  assert.equal(m.presentFor(ca, [P_A]).suppressedAt, undefined, 'A restored');
  assert.deepEqual(m.presentFor(ca, [P_B]).suppressedAt, ['P_B'], 'B\'s suppress is B\'s');
});

test('one session working both aircraft at two Positions: one suppress applies at both; never at a Position not shown it', () => {
  const m = monitor({ f1: [P_A], f2: [P_B] });
  const r = m.setSuppressed('1|2', P_A, true, 'alice', { alsoAt: [P_B, P_C] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.positionIds, ['P_A', 'P_B'], 'P_C is not shown it, so nothing is recorded there');
  const ca = m.getAll()[0];
  assert.deepEqual(m.presentFor(ca, [P_A, P_B]).suppressedAt, ['P_A', 'P_B']);
  assert.equal(m.setSuppressed('1|2', P_B, false, null, { alsoAt: [P_A] }).ok, true);
  assert.equal(m._suppressed.size, 0, 'one restore restores both');
});

// ── the wire ───────────────────────────────────────────────────────────────────────────────────────────────────────

function hubWith(m, signedOn) {
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore(), conflictAlert: m });
  const sessions = signedOn.map((positions, i) => {
    const ws = fakeWs();
    const session = { controllerId: `c${i}`, who: `c${i}`, lastSent: new Map([['1', 1], ['2', 1]]), labelRevs: new Map(),
      coverage: { conflictAlert: true, signedOnPositions: positions } };
    hub._sessions.set(ws, session);
    return { ws, session };
  });
  hub.broadcastEfspAlerts({
    conflictAlert: m.getAll(),
    conflictAlertFor: (c, positions) => m.deliverableTo(c, positions),
    conflictAlertAs: (c, positions) => m.presentFor(c, positions),
  });
  return { hub, sessions };
}

const lastAlerts = (ws) => ws.of('efsp-alerts').pop().conflictAlert;
const suppress = (hub, { ws, session }, actingPositionId, on = true) => {
  hub._onMessage(ws, session, JSON.stringify({ type: 'efsp-conflict-suppress', clientMutationId: 'c', conflictId: '1|2', actingPositionId, suppress: on }));
  return ws.of('efsp-conflict-suppress-ack').pop();
};

test('over the wire, two controllers: both are sent it, a third is not; each suppress is their own', () => {
  const m = monitor({ f1: [P_A], f2: [P_B] });
  const { hub, sessions: [a, b, c] } = hubWith(m, [[{ ...P_A, isPrimary: true }], [{ ...P_B, isPrimary: true }], [{ ...P_C, isPrimary: true }]]);
  assert.deepEqual(lastAlerts(a.ws).map(x => x.shownAt), [['P_A']]);
  assert.deepEqual(lastAlerts(b.ws).map(x => x.shownAt), [['P_B']]);
  assert.deepEqual(lastAlerts(c.ws), [], 'C works neither aircraft');
  assert.equal(suppress(hub, c, 'P_C').reason, 'NOT_FOUND', 'C cannot suppress what it is not shown');

  assert.equal(suppress(hub, a, 'P_A').ok, true);
  assert.deepEqual(lastAlerts(a.ws)[0].suppressedAt, ['P_A']);
  assert.equal(lastAlerts(b.ws)[0].suppressedAt, undefined, 'A\'s suppress leaves B\'s alert flashing');
  assert.equal(suppress(hub, b, 'P_B').ok, true);
  assert.deepEqual(lastAlerts(b.ws)[0].suppressedAt, ['P_B']);
  assert.equal(suppress(hub, a, 'P_A', false).ok, true);
  assert.equal(lastAlerts(a.ws)[0].suppressedAt, undefined);
  assert.deepEqual(lastAlerts(b.ws)[0].suppressedAt, ['P_B'], 'and the reverse');
});

test('over the wire, one session Primary at both: one frame suppresses at both; an Observer Position is left alone', () => {
  const m = monitor({ f1: [P_A], f2: [P_B, P_C] });
  const { hub, sessions: [s] } = hubWith(m, [[{ ...P_A, isPrimary: true }, { ...P_B, isPrimary: true }, { ...P_C, isPrimary: false }]]);
  assert.deepEqual(lastAlerts(s.ws)[0].shownAt, ['P_A', 'P_B', 'P_C']);
  assert.equal(suppress(hub, s, 'P_A').ok, true);
  assert.deepEqual(lastAlerts(s.ws)[0].suppressedAt, ['P_A', 'P_B'], 'one acknowledgement for the Positions this controller works');
  assert.equal(suppress(hub, s, 'P_B', false).ok, true);
  assert.equal(lastAlerts(s.ws)[0].suppressedAt, undefined, 'one restore');
});
