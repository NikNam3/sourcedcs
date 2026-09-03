import { test } from 'node:test';
import assert from 'node:assert/strict';

const { STATES, ARRIVAL_STATES, isValidState, isFlightPlanValid, isVoidExpired, computeNla } =
  await import('../src/efsp/nla.js');

function makeFdr(overrides = {}) {
  return {
    identity: { beaconAssigned: '1234', ...overrides.identity },
    filed: { route: 'DCT', requestedAltitude: '250', departureAirport: 'LTAG', destinationAirport: 'LTAC', ...overrides.filed },
    assigned: { releaseState: 'RELEASED', releaseTimeUtc: null, voidTimeUtc: null, voidDeadlineUtc: null, ...overrides.assigned },
  };
}

function makeStrip(state) { return { state }; }

test('every declared State has exactly one NLA or a rendered inhibit reason — never undefined/unhandled', () => {
  for (const state of STATES) {
    const result = computeNla(makeStrip(state), makeFdr());
    if (state === 'DROPPED') {
      assert.equal(result, null); // terminal — no NLA at all, and that's the one deliberate exception
    } else {
      assert.ok(result !== undefined, state);
      assert.ok(result === null || 'toState' in result || 'inhibited' in result, state);
    }
  }
});

test('isValidState accepts every declared DEPARTURE state (default role) and rejects everything else', () => {
  for (const s of STATES) assert.equal(isValidState(s), true, s);
  assert.equal(isValidState('NOT_A_STATE'), false);
  assert.equal(isValidState(''), false);
  assert.equal(isValidState(undefined), false);
});

test('isValidState is role-aware: an ARRIVAL state is invalid under the default (DEPARTURE) role, and vice versa', () => {
  assert.equal(isValidState('INBOUND'), false); // valid ARRIVAL state, but no role given -> DEPARTURE default
  assert.equal(isValidState('INBOUND', 'ARRIVAL'), true);
  assert.equal(isValidState('PROPOSED', 'ARRIVAL'), false); // valid DEPARTURE state, invalid for ARRIVAL
});

test('DROPPED — the one state name both lifecycles share — is valid under either role', () => {
  assert.equal(isValidState('DROPPED', 'DEPARTURE'), true);
  assert.equal(isValidState('DROPPED', 'ARRIVAL'), true);
});

test('isValidState returns false for an unknown role entirely, never a throw', () => {
  assert.equal(isValidState('PROPOSED', 'OVERFLIGHT'), false);
});

// ── PROPOSED -> PENDING_CLEARANCE ───────────────────────────────────────────

test('PROPOSED is inhibited until a beacon code is assigned (guide §3.5)', () => {
  const result = computeNla(makeStrip('PROPOSED'), makeFdr({ identity: { beaconAssigned: null } }));
  assert.deepEqual(result, { inhibited: 'no beacon code assigned' });
});

test('PROPOSED with a beacon assigned but CD neither occupied nor covered is inhibited — no receiving Position present', () => {
  const ctx = { isOccupied: () => false, coveringPositionFor: () => null };
  const result = computeNla(makeStrip('PROPOSED'), makeFdr(), Date.now(), ctx);
  assert.deepEqual(result, { inhibited: 'no receiving Position present' });
});

test('PROPOSED with a beacon assigned advances to PENDING_CLEARANCE, transferring to CD, once CD is occupied', () => {
  const ctx = { isOccupied: (id) => id === 'CD', coveringPositionFor: () => null };
  const result = computeNla(makeStrip('PROPOSED'), makeFdr(), Date.now(), ctx);
  assert.deepEqual(result, { toState: 'PENDING_CLEARANCE', transferTo: 'CD' });
});

test('PROPOSED transitions when CD is unoccupied but covered by another Position', () => {
  const ctx = { isOccupied: () => false, coveringPositionFor: (id) => (id === 'CD' ? 'OPS' : null) };
  const result = computeNla(makeStrip('PROPOSED'), makeFdr(), Date.now(), ctx);
  assert.deepEqual(result, { toState: 'PENDING_CLEARANCE', transferTo: 'CD' });
});

test('PROPOSED with a null fdr (defensive) is inhibited on the beacon check, before occupancy is even considered', () => {
  const result = computeNla(makeStrip('PROPOSED'), null);
  assert.deepEqual(result, { inhibited: 'no beacon code assigned' });
});

// ── PENDING_CLEARANCE -> CLEARED ─────────────────────────────────────────

test('PENDING_CLEARANCE is inhibited when required filed fields are missing', () => {
  for (const missing of ['route', 'requestedAltitude', 'departureAirport', 'destinationAirport']) {
    const fdr = makeFdr({ filed: { [missing]: '' } });
    const result = computeNla(makeStrip('PENDING_CLEARANCE'), fdr);
    assert.deepEqual(result, { inhibited: 'flight plan invalid' }, missing);
  }
});

test('PENDING_CLEARANCE with a complete flight plan advances to CLEARED', () => {
  const result = computeNla(makeStrip('PENDING_CLEARANCE'), makeFdr());
  assert.deepEqual(result, { toState: 'CLEARED' });
});

test('isFlightPlanValid is false for a null fdr', () => {
  assert.equal(isFlightPlanValid(null), false);
});

// ── CLEARED -> PUSHBACK ─────────────────────────────────────────────────

test('CLEARED is inhibited when a hold is in force (releaseState !== RELEASED)', () => {
  for (const state of ['HOLD_FOR_RELEASE', 'RELEASE_TIME', 'CLEARANCE_VOID_TIME']) {
    const fdr = makeFdr({ assigned: { releaseState: state } });
    const result = computeNla(makeStrip('CLEARED'), fdr);
    assert.deepEqual(result, { inhibited: 'a hold is in force' }, state);
  }
});

test('CLEARED with releaseState RELEASED but GND neither occupied nor covered is inhibited', () => {
  const ctx = { isOccupied: () => false, coveringPositionFor: () => null };
  const result = computeNla(makeStrip('CLEARED'), makeFdr(), Date.now(), ctx);
  assert.deepEqual(result, { inhibited: 'no receiving Position present' });
});

test('CLEARED with releaseState RELEASED advances to PUSHBACK, transferring to GND, once GND is occupied', () => {
  const ctx = { isOccupied: (id) => id === 'GND', coveringPositionFor: () => null };
  const result = computeNla(makeStrip('CLEARED'), makeFdr(), Date.now(), ctx);
  assert.deepEqual(result, { toState: 'PUSHBACK', transferTo: 'GND' });
});

// ── HELD -> PUSHBACK (Release) ───────────────────────────────────────────

test('HELD is inhibited when the release time has not yet been reached', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const fdr = makeFdr({ assigned: { releaseState: 'RELEASE_TIME', releaseTimeUtc: now + 60000 } });
  const result = computeNla(makeStrip('HELD'), fdr, now);
  assert.deepEqual(result, { inhibited: 'release time not reached' });
});

test('HELD releases once the release time has passed, transferring to GND, once GND is occupied', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const fdr = makeFdr({ assigned: { releaseState: 'RELEASE_TIME', releaseTimeUtc: now - 1000 } });
  const ctx = { isOccupied: (id) => id === 'GND', coveringPositionFor: () => null };
  const result = computeNla(makeStrip('HELD'), fdr, now, ctx);
  assert.deepEqual(result, { toState: 'PUSHBACK', transferTo: 'GND' });
});

test('HELD is inhibited once the derived void deadline has expired', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const fdr = makeFdr({ assigned: { releaseState: 'CLEARANCE_VOID_TIME', voidDeadlineUtc: now - 1 } });
  const result = computeNla(makeStrip('HELD'), fdr, now);
  assert.deepEqual(result, { inhibited: 'void time expired' });
});

test('HELD with no active hold condition but GND neither occupied nor covered is inhibited', () => {
  const ctx = { isOccupied: () => false, coveringPositionFor: () => null };
  const result = computeNla(makeStrip('HELD'), makeFdr(), Date.now(), ctx);
  assert.deepEqual(result, { inhibited: 'no receiving Position present' });
});

test('HELD with no active hold condition releases to PUSHBACK, transferring to GND — a no-op reassignment if GND already held it', () => {
  const ctx = { isOccupied: (id) => id === 'GND', coveringPositionFor: () => null };
  const result = computeNla(makeStrip('HELD'), makeFdr(), Date.now(), ctx);
  assert.deepEqual(result, { toState: 'PUSHBACK', transferTo: 'GND' });
});

// ── WP4A (docs/adr/0017), §4.6.2: HOLD_FOR_RELEASE + standing releases ───

test('HELD with releaseState HOLD_FOR_RELEASE and no matching standing release is inhibited, pointing at OPERATIONAL_REQUEST', () => {
  const fdr = makeFdr({ assigned: { releaseState: 'HOLD_FOR_RELEASE' } });
  const ctx = { isOccupied: (id) => id === 'GND', coveringPositionFor: () => null, standingReleases: [] };
  const result = computeNla(makeStrip('HELD'), fdr, Date.now(), ctx);
  assert.deepEqual(result, { inhibited: 'outside standing release envelope — file OPERATIONAL_REQUEST' });
});

test('HELD with releaseState HOLD_FOR_RELEASE and a matching standing release proceeds normally (skips straight to the GND-occupancy check)', () => {
  const fdr = makeFdr({ assigned: { releaseState: 'HOLD_FOR_RELEASE' }, filed: { route: 'DCT', requestedAltitude: '250', departureAirport: 'LTAG', destinationAirport: 'LTAC' } });
  const ctx = {
    isOccupied: (id) => id === 'GND', coveringPositionFor: () => null,
    standingReleases: [{ envelopeId: 'e1', stereoRoute: 'DCT', active: true }],
  };
  const result = computeNla(makeStrip('HELD'), fdr, Date.now(), ctx);
  assert.deepEqual(result, { toState: 'PUSHBACK', transferTo: 'GND' });
});

test('every pre-WP4A caller (ctx.standingReleases omitted) defaults to an empty envelope list — HOLD_FOR_RELEASE is inhibited by default, never a throw', () => {
  const fdr = makeFdr({ assigned: { releaseState: 'HOLD_FOR_RELEASE' } });
  const result = computeNla(makeStrip('HELD'), fdr, Date.now(), { isOccupied: () => true, coveringPositionFor: () => null });
  assert.deepEqual(result, { inhibited: 'outside standing release envelope — file OPERATIONAL_REQUEST' });
});

test('RELEASE_TIME and CLEARANCE_VOID_TIME are unaffected by the standing-release check — only HOLD_FOR_RELEASE triggers it', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const fdr = makeFdr({ assigned: { releaseState: 'RELEASE_TIME', releaseTimeUtc: now - 1000 } });
  const ctx = { isOccupied: (id) => id === 'GND', coveringPositionFor: () => null, standingReleases: [] };
  const result = computeNla(makeStrip('HELD'), fdr, now, ctx);
  assert.deepEqual(result, { toState: 'PUSHBACK', transferTo: 'GND' }); // not the standing-release inhibit
});

// ── isVoidExpired ────────────────────────────────────────────────────────

test('isVoidExpired is true at exactly the deadline and after, false before', () => {
  const deadline = Date.UTC(2026, 0, 1, 12, 30, 0);
  assert.equal(isVoidExpired(makeFdr({ assigned: { voidDeadlineUtc: deadline } }), deadline), true);
  assert.equal(isVoidExpired(makeFdr({ assigned: { voidDeadlineUtc: deadline } }), deadline + 1), true);
  assert.equal(isVoidExpired(makeFdr({ assigned: { voidDeadlineUtc: deadline } }), deadline - 1), false);
});

test('isVoidExpired is false when no voidDeadlineUtc is set', () => {
  assert.equal(isVoidExpired(makeFdr(), Date.now()), false);
});

// ── The rest of the straight-line lifecycle ─────────────────────────────

test('PUSHBACK -> TAXI, state-only (still GND\'s own — no boundary crossed)', () => {
  assert.deepEqual(computeNla(makeStrip('PUSHBACK'), makeFdr()), { toState: 'TAXI' });
});

test('TAXI is inhibited when TWR is neither occupied nor covered', () => {
  const ctx = { isOccupied: () => false, coveringPositionFor: () => null };
  assert.deepEqual(computeNla(makeStrip('TAXI'), makeFdr(), Date.now(), ctx), { inhibited: 'no receiving Position present' });
});

test('TAXI transitions to RUNWAY_QUEUE, transferring to TWR, once TWR is occupied', () => {
  const ctx = { isOccupied: (id) => id === 'TWR', coveringPositionFor: () => null };
  assert.deepEqual(computeNla(makeStrip('TAXI'), makeFdr(), Date.now(), ctx), { toState: 'RUNWAY_QUEUE', transferTo: 'TWR' });
});

test('RUNWAY_QUEUE -> LUAW -> DEPARTED, state-only, unconditionally in Phase 2 (WP6 inhibits not yet built; both stay TWR\'s own)', () => {
  assert.deepEqual(computeNla(makeStrip('RUNWAY_QUEUE'), makeFdr()), { toState: 'LUAW' });
  assert.deepEqual(computeNla(makeStrip('LUAW'), makeFdr()), { toState: 'DEPARTED' });
});

// Phase 2 (docs/adr/0007, superseding ADR 0005's always-succeed stub) —
// DEPARTED's NLA is now a real, occupancy-gated "Hand Off" to APP.

test('DEPARTED is inhibited when APP is neither occupied nor covered — no receiving Position present', () => {
  const ctx = { isOccupied: () => false, coveringPositionFor: () => null };
  assert.deepEqual(computeNla(makeStrip('DEPARTED'), makeFdr(), Date.now(), ctx), { inhibited: 'no receiving Position present' });
});

test('DEPARTED transitions to HANDED_OFF, transferring to APP, once APP is occupied', () => {
  const ctx = { isOccupied: (id) => id === 'APP', coveringPositionFor: () => null };
  assert.deepEqual(computeNla(makeStrip('DEPARTED'), makeFdr(), Date.now(), ctx), { toState: 'HANDED_OFF', transferTo: 'APP' });
});

test('DEPARTED transitions when APP is unoccupied but covered by another Position', () => {
  const ctx = { isOccupied: () => false, coveringPositionFor: (id) => (id === 'APP' ? 'TWR' : null) };
  assert.deepEqual(computeNla(makeStrip('DEPARTED'), makeFdr(), Date.now(), ctx), { toState: 'HANDED_OFF', transferTo: 'APP' });
});

test('DEPARTED with no ctx supplied at all defaults to inhibited, not a throw — a safe degrade, not a crash', () => {
  assert.deepEqual(computeNla(makeStrip('DEPARTED'), makeFdr()), { inhibited: 'no receiving Position present' });
});

test('HANDED_OFF advances to DROPPED', () => {
  assert.deepEqual(computeNla(makeStrip('HANDED_OFF'), makeFdr()), { toState: 'DROPPED' });
});

test('DROPPED has no NLA — a terminal state', () => {
  assert.equal(computeNla(makeStrip('DROPPED'), makeFdr()), null);
});

// ── ARRIVAL lifecycle (Phase 2, docs/adr/0008 — [SOURCE-DEFINED]) ────────
// INBOUND -> HANDED_TO_TOWER -> FINAL -> LANDED -> TAXI_IN -> DROPPED

function makeArrivalStrip(state) { return { state, role: 'ARRIVAL' }; }

test('every declared ARRIVAL State has exactly one NLA or a rendered inhibit reason — never undefined/unhandled', () => {
  for (const state of ARRIVAL_STATES) {
    const result = computeNla(makeArrivalStrip(state), makeFdr());
    if (state === 'DROPPED') {
      assert.equal(result, null);
    } else {
      assert.ok(result !== undefined, state);
      assert.ok(result === null || 'toState' in result || 'inhibited' in result, state);
    }
  }
});

test('INBOUND is inhibited when TWR is neither occupied nor covered', () => {
  const ctx = { isOccupied: () => false, coveringPositionFor: () => null };
  assert.deepEqual(computeNla(makeArrivalStrip('INBOUND'), makeFdr(), Date.now(), ctx), { inhibited: 'no receiving Position present' });
});

test('INBOUND transitions to HANDED_TO_TOWER, transferring to TWR, once TWR is occupied', () => {
  const ctx = { isOccupied: (id) => id === 'TWR', coveringPositionFor: () => null };
  assert.deepEqual(computeNla(makeArrivalStrip('INBOUND'), makeFdr(), Date.now(), ctx), { toState: 'HANDED_TO_TOWER', transferTo: 'TWR' });
});

test('INBOUND transitions when TWR is unoccupied but covered', () => {
  const ctx = { isOccupied: () => false, coveringPositionFor: (id) => (id === 'TWR' ? 'APP' : null) };
  assert.deepEqual(computeNla(makeArrivalStrip('INBOUND'), makeFdr(), Date.now(), ctx), { toState: 'HANDED_TO_TOWER', transferTo: 'TWR' });
});

// ── WP4A (docs/adr/0014): a CENTER-held INBOUND Strip's next step is the
// cross-Facility HANDOFF, not an intrafacility TWR transfer ────────────

test('INBOUND is inhibited with a HANDOFF-pointing reason when ctx.facilityId is CENTER, even if TWR would otherwise be occupied — there is no TWR at CENTER to transfer to at all', () => {
  const ctx = { isOccupied: () => true, coveringPositionFor: () => null, facilityId: 'CENTER' };
  assert.deepEqual(
    computeNla(makeArrivalStrip('INBOUND'), makeFdr(), Date.now(), ctx),
    { inhibited: 'cross-Facility HANDOFF required — use Coordinate' },
  );
});

test('every pre-WP4A caller (ctx.facilityId omitted entirely) is completely unaffected — INBOUND still resolves via the ordinary TWR-occupancy path', () => {
  const ctx = { isOccupied: (id) => id === 'TWR', coveringPositionFor: () => null };
  assert.equal('facilityId' in ctx, false);
  assert.deepEqual(computeNla(makeArrivalStrip('INBOUND'), makeFdr(), Date.now(), ctx), { toState: 'HANDED_TO_TOWER', transferTo: 'TWR' });
});

test('HANDED_TO_TOWER -> FINAL -> LANDED, unconditionally (no WP6/WP7A machinery gates these in Phase 2)', () => {
  assert.deepEqual(computeNla(makeArrivalStrip('HANDED_TO_TOWER'), makeFdr()), { toState: 'FINAL' });
  assert.deepEqual(computeNla(makeArrivalStrip('FINAL'), makeFdr()), { toState: 'LANDED' });
});

test('LANDED is inhibited when GND is neither occupied nor covered', () => {
  const ctx = { isOccupied: () => false, coveringPositionFor: () => null };
  assert.deepEqual(computeNla(makeArrivalStrip('LANDED'), makeFdr(), Date.now(), ctx), { inhibited: 'no receiving Position present' });
});

test('LANDED transitions to TAXI_IN, transferring to GND, once GND is occupied', () => {
  const ctx = { isOccupied: (id) => id === 'GND', coveringPositionFor: () => null };
  assert.deepEqual(computeNla(makeArrivalStrip('LANDED'), makeFdr(), Date.now(), ctx), { toState: 'TAXI_IN', transferTo: 'GND' });
});

test('TAXI_IN advances to DROPPED, matching DEPARTURE\'s own HANDED_OFF -> DROPPED precedent', () => {
  assert.deepEqual(computeNla(makeArrivalStrip('TAXI_IN'), makeFdr()), { toState: 'DROPPED' });
});

test('ARRIVAL\'s DROPPED has no NLA — a terminal state, same as DEPARTURE\'s', () => {
  assert.equal(computeNla(makeArrivalStrip('DROPPED'), makeFdr()), null);
});

test('a Strip with no role at all (or role:DEPARTURE) is unaffected by ARRIVAL\'s table — dispatch is per-Strip, not global state', () => {
  assert.deepEqual(computeNla(makeStrip('PUSHBACK'), makeFdr()), { toState: 'TAXI' });
});
