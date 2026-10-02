import { test } from 'node:test';
import assert from 'node:assert/strict';

const { STATES, ARRIVAL_STATES, isValidState, isFlightPlanValid, isVoidExpired, computeNla, missingForClearance } =
  await import('../src/efsp/nla.js');

// Mission-clock ms (docs/adr/0079) — the gates take `now` explicitly, never the wall clock.
const NOW = Date.UTC(2016, 5, 21, 2, 40);

function makeFlightData(overrides = {}) {
  return {
    identity: { beaconAssigned: '1234', ...overrides.identity },
    filed: { route: 'DCT', requestedAltitude: '250', departureAirport: 'LTAG', destinationAirport: 'LTAC', ...overrides.filed },
    assigned: { releaseState: 'RELEASED', releaseTimeUtc: null, voidTimeUtc: null, voidDeadlineUtc: null, ...overrides.assigned },
  };
}

function makeStrip(state) { return { state }; }

test('every declared State has exactly one NLA or a rendered inhibit reason — never undefined/unhandled', () => {
  for (const state of STATES) {
    const result = computeNla(makeStrip(state), makeFlightData(), NOW);
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
  const result = computeNla(makeStrip('PROPOSED'), makeFlightData({ identity: { beaconAssigned: null } }), NOW);
  assert.deepEqual(result, { inhibited: 'no beacon code assigned' });
});

test('PROPOSED with a beacon assigned but CD neither occupied nor covered is inhibited — no receiving Position present', () => {
  const ctx = { isStaffed: () => false, consolidatedAt: () => null };
  const result = computeNla(makeStrip('PROPOSED'), makeFlightData(), Date.now(), ctx);
  assert.deepEqual(result, { inhibited: 'no receiving Position present' });
});

test('PROPOSED with a beacon assigned advances to PENDING_CLEARANCE, transferring to CD, once CD is occupied', () => {
  const ctx = { isStaffed: (id) => id === 'CD', consolidatedAt: () => null };
  const result = computeNla(makeStrip('PROPOSED'), makeFlightData(), Date.now(), ctx);
  assert.deepEqual(result, { toState: 'PENDING_CLEARANCE', transferTo: 'CD' });
});

test('PROPOSED transitions when CD is unstaffed but covered by another Position', () => {
  const ctx = { isStaffed: () => false, consolidatedAt: (id) => (id === 'CD' ? 'OPS' : null) };
  const result = computeNla(makeStrip('PROPOSED'), makeFlightData(), Date.now(), ctx);
  assert.deepEqual(result, { toState: 'PENDING_CLEARANCE', transferTo: 'CD' });
});

test('PROPOSED with a null fdr (defensive) is inhibited on the beacon check, before staffing is even considered', () => {
  const result = computeNla(makeStrip('PROPOSED'), null, NOW);
  assert.deepEqual(result, { inhibited: 'no beacon code assigned' });
});

// ── PENDING_CLEARANCE -> CLEARED ─────────────────────────────────────────

// The reason NAMES the Blocks now (F-104) — it used to be the bare string
// 'flight plan invalid', which left a controller to guess among 28 chips.
test('PENDING_CLEARANCE is inhibited when required filed fields are missing, naming the Block', () => {
  const labelFor = { requestedAltitude: 'ALT', departureAirport: 'DEP', destinationAirport: 'DEST', route: 'RTE' };
  for (const [missing, label] of Object.entries(labelFor)) {
    const fdr = makeFlightData({ filed: { [missing]: '' } });
    const result = computeNla(makeStrip('PENDING_CLEARANCE'), fdr, NOW);
    assert.deepEqual(result, { inhibited: `flight plan incomplete \u2014 ${label} not filed` }, missing);
  }
});

test('an empty flight plan names all four Blocks, in Block order', () => {
  const fdr = makeFlightData({ filed: { route: '', requestedAltitude: '', departureAirport: '', destinationAirport: '' } });
  assert.deepEqual(
    computeNla(makeStrip('PENDING_CLEARANCE'), fdr, NOW),
    { inhibited: 'flight plan incomplete \u2014 ALT, DEP, DEST, RTE not filed' },
  );
});

test('missingForClearance treats a missing FDR as nothing filed at all', () => {
  assert.deepEqual(missingForClearance(null), ['ALT', 'DEP', 'DEST', 'RTE']);
  assert.deepEqual(missingForClearance(makeFlightData()), []);
});

test('PENDING_CLEARANCE with a complete flight plan advances to CLEARED', () => {
  const result = computeNla(makeStrip('PENDING_CLEARANCE'), makeFlightData(), NOW);
  assert.deepEqual(result, { toState: 'CLEARED' });
});

test('isFlightPlanValid is false for a null fdr', () => {
  assert.equal(isFlightPlanValid(null), false);
});

// ── CLEARED -> PUSHBACK ─────────────────────────────────────────────────

test('CLEARED is inhibited when a hold is in force (releaseState !== RELEASED)', () => {
  for (const state of ['HOLD_FOR_RELEASE', 'RELEASE_TIME', 'CLEARANCE_VOID_TIME']) {
    const fdr = makeFlightData({ assigned: { releaseState: state } });
    const result = computeNla(makeStrip('CLEARED'), fdr, NOW);
    assert.deepEqual(result, { inhibited: 'a hold is in force' }, state);
  }
});

test('CLEARED with releaseState RELEASED but GND neither occupied nor covered is inhibited', () => {
  const ctx = { isStaffed: () => false, consolidatedAt: () => null };
  const result = computeNla(makeStrip('CLEARED'), makeFlightData(), Date.now(), ctx);
  assert.deepEqual(result, { inhibited: 'no receiving Position present' });
});

test('CLEARED with releaseState RELEASED advances to PUSHBACK, transferring to GND, once GND is occupied', () => {
  const ctx = { isStaffed: (id) => id === 'GND', consolidatedAt: () => null };
  const result = computeNla(makeStrip('CLEARED'), makeFlightData(), Date.now(), ctx);
  assert.deepEqual(result, { toState: 'PUSHBACK', transferTo: 'GND' });
});

// ── HELD -> PUSHBACK (Release) ───────────────────────────────────────────

test('HELD is inhibited when the release time has not yet been reached', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const fdr = makeFlightData({ assigned: { releaseState: 'RELEASE_TIME', releaseTimeUtc: now + 60000 } });
  const result = computeNla(makeStrip('HELD'), fdr, now);
  assert.deepEqual(result, { inhibited: 'release time not reached' });
});

test('HELD releases once the release time has passed, transferring to GND, once GND is occupied', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const fdr = makeFlightData({ assigned: { releaseState: 'RELEASE_TIME', releaseTimeUtc: now - 1000 } });
  const ctx = { isStaffed: (id) => id === 'GND', consolidatedAt: () => null };
  const result = computeNla(makeStrip('HELD'), fdr, now, ctx);
  assert.deepEqual(result, { toState: 'PUSHBACK', transferTo: 'GND' });
});

test('HELD is inhibited once the derived void deadline has expired', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const fdr = makeFlightData({ assigned: { releaseState: 'CLEARANCE_VOID_TIME', voidDeadlineUtc: now - 1 } });
  const result = computeNla(makeStrip('HELD'), fdr, now);
  assert.deepEqual(result, { inhibited: 'void time expired' });
});

test('HELD with no active hold condition but GND neither occupied nor covered is inhibited', () => {
  const ctx = { isStaffed: () => false, consolidatedAt: () => null };
  const result = computeNla(makeStrip('HELD'), makeFlightData(), Date.now(), ctx);
  assert.deepEqual(result, { inhibited: 'no receiving Position present' });
});

test('HELD with no active hold condition releases to PUSHBACK, transferring to GND — a no-op reassignment if GND already held it', () => {
  const ctx = { isStaffed: (id) => id === 'GND', consolidatedAt: () => null };
  const result = computeNla(makeStrip('HELD'), makeFlightData(), Date.now(), ctx);
  assert.deepEqual(result, { toState: 'PUSHBACK', transferTo: 'GND' });
});

// ── WP4A (docs/adr/0017), §4.6.2: HOLD_FOR_RELEASE + standing releases ───

test('HELD with releaseState HOLD_FOR_RELEASE and no matching standing release is inhibited, pointing at OPERATIONAL_REQUEST', () => {
  const fdr = makeFlightData({ assigned: { releaseState: 'HOLD_FOR_RELEASE' } });
  const ctx = { isStaffed: (id) => id === 'GND', consolidatedAt: () => null, standingReleases: [] };
  const result = computeNla(makeStrip('HELD'), fdr, Date.now(), ctx);
  assert.deepEqual(result, { inhibited: 'outside standing release envelope — file OPERATIONAL_REQUEST' });
});

test('HELD with releaseState HOLD_FOR_RELEASE and a matching standing release proceeds normally (skips straight to the GC-staffing check)', () => {
  const fdr = makeFlightData({ assigned: { releaseState: 'HOLD_FOR_RELEASE' }, filed: { route: 'DCT', requestedAltitude: '250', departureAirport: 'LTAG', destinationAirport: 'LTAC' } });
  const ctx = {
    isStaffed: (id) => id === 'GND', consolidatedAt: () => null,
    standingReleases: [{ envelopeId: 'e1', stereoRoute: 'DCT', active: true }],
  };
  const result = computeNla(makeStrip('HELD'), fdr, Date.now(), ctx);
  assert.deepEqual(result, { toState: 'PUSHBACK', transferTo: 'GND' });
});

test('every pre-WP4A caller (ctx.standingReleases omitted) defaults to an empty envelope list — HOLD_FOR_RELEASE is inhibited by default, never a throw', () => {
  const fdr = makeFlightData({ assigned: { releaseState: 'HOLD_FOR_RELEASE' } });
  const result = computeNla(makeStrip('HELD'), fdr, Date.now(), { isStaffed: () => true, consolidatedAt: () => null });
  assert.deepEqual(result, { inhibited: 'outside standing release envelope — file OPERATIONAL_REQUEST' });
});

test('RELEASE_TIME and CLEARANCE_VOID_TIME are unaffected by the standing-release check — only HOLD_FOR_RELEASE triggers it', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const fdr = makeFlightData({ assigned: { releaseState: 'RELEASE_TIME', releaseTimeUtc: now - 1000 } });
  const ctx = { isStaffed: (id) => id === 'GND', consolidatedAt: () => null, standingReleases: [] };
  const result = computeNla(makeStrip('HELD'), fdr, now, ctx);
  assert.deepEqual(result, { toState: 'PUSHBACK', transferTo: 'GND' }); // not the standing-release inhibit
});

// ── isVoidExpired ────────────────────────────────────────────────────────

test('isVoidExpired is true at exactly the deadline and after, false before', () => {
  const deadline = Date.UTC(2026, 0, 1, 12, 30, 0);
  assert.equal(isVoidExpired(makeFlightData({ assigned: { voidDeadlineUtc: deadline } }), deadline), true);
  assert.equal(isVoidExpired(makeFlightData({ assigned: { voidDeadlineUtc: deadline } }), deadline + 1), true);
  assert.equal(isVoidExpired(makeFlightData({ assigned: { voidDeadlineUtc: deadline } }), deadline - 1), false);
});

test('isVoidExpired is false when no voidDeadlineUtc is set', () => {
  assert.equal(isVoidExpired(makeFlightData(), NOW), false);
});

// ── The rest of the straight-line lifecycle ─────────────────────────────

test('PUSHBACK -> TAXI, state-only (still GND\'s own — no boundary crossed)', () => {
  assert.deepEqual(computeNla(makeStrip('PUSHBACK'), makeFlightData(), NOW), { toState: 'TAXI' });
});

test('TAXI is inhibited when TWR is neither occupied nor covered', () => {
  const ctx = { isStaffed: () => false, consolidatedAt: () => null };
  assert.deepEqual(computeNla(makeStrip('TAXI'), makeFlightData(), Date.now(), ctx), { inhibited: 'no receiving Position present' });
});

test('TAXI transitions to RUNWAY_QUEUE, transferring to TWR, once TWR is occupied', () => {
  const ctx = { isStaffed: (id) => id === 'TWR', consolidatedAt: () => null };
  assert.deepEqual(computeNla(makeStrip('TAXI'), makeFlightData(), Date.now(), ctx), { toState: 'RUNWAY_QUEUE', transferTo: 'TWR' });
});

test('RUNWAY_QUEUE -> LUAW -> DEPARTED, state-only, unconditionally in Phase 2 (WP6 inhibits not yet built; both stay TWR\'s own)', () => {
  assert.deepEqual(computeNla(makeStrip('RUNWAY_QUEUE'), makeFlightData(), NOW), { toState: 'LUAW' });
  assert.deepEqual(computeNla(makeStrip('LUAW'), makeFlightData(), NOW), { toState: 'DEPARTED' });
});

// Phase 2 (docs/adr/0007, superseding ADR 0005's always-succeed stub) —
// DEPARTED's NLA is now a real, staffing-gated "Hand Off" to APP.

test('DEPARTED is inhibited when APP is neither occupied nor covered — no receiving Position present', () => {
  const ctx = { isStaffed: () => false, consolidatedAt: () => null };
  assert.deepEqual(computeNla(makeStrip('DEPARTED'), makeFlightData(), Date.now(), ctx), { inhibited: 'no receiving Position present' });
});

test('DEPARTED transitions to HANDED_OFF, transferring to APP, once APP is occupied', () => {
  const ctx = { isStaffed: (id) => id === 'APP', consolidatedAt: () => null };
  assert.deepEqual(computeNla(makeStrip('DEPARTED'), makeFlightData(), Date.now(), ctx), { toState: 'HANDED_OFF', transferTo: 'APP' });
});

test('DEPARTED transitions when APP is unstaffed but covered by another Position', () => {
  const ctx = { isStaffed: () => false, consolidatedAt: (id) => (id === 'APP' ? 'TWR' : null) };
  assert.deepEqual(computeNla(makeStrip('DEPARTED'), makeFlightData(), Date.now(), ctx), { toState: 'HANDED_OFF', transferTo: 'APP' });
});

test('DEPARTED with no ctx supplied at all defaults to inhibited, not a throw — a safe degrade, not a crash', () => {
  assert.deepEqual(computeNla(makeStrip('DEPARTED'), makeFlightData(), NOW), { inhibited: 'no receiving Position present' });
});

test('HANDED_OFF advances to DROPPED', () => {
  assert.deepEqual(computeNla(makeStrip('HANDED_OFF'), makeFlightData(), NOW), { toState: 'DROPPED' });
});

test('DROPPED has no NLA — a terminal state', () => {
  assert.equal(computeNla(makeStrip('DROPPED'), makeFlightData(), NOW), null);
});

// ── ARRIVAL lifecycle (Phase 2, docs/adr/0008 — [SOURCE-DEFINED]) ────────
// INBOUND -> HANDED_TO_TOWER -> FINAL -> LANDED -> TAXI_IN -> DROPPED

function makeArrivalStrip(state) { return { state, role: 'ARRIVAL' }; }

test('every declared ARRIVAL State has exactly one NLA or a rendered inhibit reason — never undefined/unhandled', () => {
  for (const state of ARRIVAL_STATES) {
    const result = computeNla(makeArrivalStrip(state), makeFlightData(), NOW);
    if (state === 'DROPPED') {
      assert.equal(result, null);
    } else {
      assert.ok(result !== undefined, state);
      assert.ok(result === null || 'toState' in result || 'inhibited' in result, state);
    }
  }
});

test('INBOUND is inhibited when TWR is neither occupied nor covered', () => {
  const ctx = { isStaffed: () => false, consolidatedAt: () => null };
  assert.deepEqual(computeNla(makeArrivalStrip('INBOUND'), makeFlightData(), Date.now(), ctx), { inhibited: 'no receiving Position present' });
});

test('INBOUND transitions to HANDED_TO_TOWER, transferring to TWR, once TWR is occupied', () => {
  const ctx = { isStaffed: (id) => id === 'TWR', consolidatedAt: () => null };
  assert.deepEqual(computeNla(makeArrivalStrip('INBOUND'), makeFlightData(), Date.now(), ctx), { toState: 'HANDED_TO_TOWER', transferTo: 'TWR' });
});

test('INBOUND transitions when TWR is unstaffed but covered', () => {
  const ctx = { isStaffed: () => false, consolidatedAt: (id) => (id === 'TWR' ? 'APP' : null) };
  assert.deepEqual(computeNla(makeArrivalStrip('INBOUND'), makeFlightData(), Date.now(), ctx), { toState: 'HANDED_TO_TOWER', transferTo: 'TWR' });
});

// ── WP4A (docs/adr/0014): a CENTER-held INBOUND Strip's next step is the
// cross-Facility HANDOFF, not an intrafacility TWR transfer ────────────

test('INBOUND is inhibited with a HANDOFF-pointing reason when ctx.facilityId is CENTER, even if TWR would otherwise be occupied — there is no TWR at CENTER to transfer to at all', () => {
  const ctx = { isStaffed: () => true, consolidatedAt: () => null, facilityId: 'CENTER' };
  assert.deepEqual(
    computeNla(makeArrivalStrip('INBOUND'), makeFlightData(), Date.now(), ctx),
    { inhibited: 'cross-Facility HANDOFF required — use Coordinate' },
  );
});

test('every pre-WP4A caller (ctx.facilityId omitted entirely) is completely unaffected — INBOUND still resolves via the ordinary LC-staffing path', () => {
  const ctx = { isStaffed: (id) => id === 'TWR', consolidatedAt: () => null };
  assert.equal('facilityId' in ctx, false);
  assert.deepEqual(computeNla(makeArrivalStrip('INBOUND'), makeFlightData(), Date.now(), ctx), { toState: 'HANDED_TO_TOWER', transferTo: 'TWR' });
});

test('HANDED_TO_TOWER -> FINAL -> LANDED, unconditionally (no WP6/WP7A machinery gates these in Phase 2)', () => {
  assert.deepEqual(computeNla(makeArrivalStrip('HANDED_TO_TOWER'), makeFlightData(), NOW), { toState: 'FINAL' });
  assert.deepEqual(computeNla(makeArrivalStrip('FINAL'), makeFlightData(), NOW), { toState: 'LANDED' });
});

test('LANDED is inhibited when GND is neither occupied nor covered', () => {
  const ctx = { isStaffed: () => false, consolidatedAt: () => null };
  assert.deepEqual(computeNla(makeArrivalStrip('LANDED'), makeFlightData(), Date.now(), ctx), { inhibited: 'no receiving Position present' });
});

test('LANDED transitions to TAXI_IN, transferring to GND, once GND is occupied', () => {
  const ctx = { isStaffed: (id) => id === 'GND', consolidatedAt: () => null };
  assert.deepEqual(computeNla(makeArrivalStrip('LANDED'), makeFlightData(), Date.now(), ctx), { toState: 'TAXI_IN', transferTo: 'GND' });
});

test('TAXI_IN advances to DROPPED, matching DEPARTURE\'s own HANDED_OFF -> DROPPED precedent', () => {
  assert.deepEqual(computeNla(makeArrivalStrip('TAXI_IN'), makeFlightData(), NOW), { toState: 'DROPPED' });
});

test('ARRIVAL\'s DROPPED has no NLA — a terminal state, same as DEPARTURE\'s', () => {
  assert.equal(computeNla(makeArrivalStrip('DROPPED'), makeFlightData(), NOW), null);
});

test('a Strip with no role at all (or role:DEPARTURE) is unaffected by ARRIVAL\'s table — dispatch is per-Strip, not global state', () => {
  assert.deepEqual(computeNla(makeStrip('PUSHBACK'), makeFlightData(), NOW), { toState: 'TAXI' });
});

// ── OVERFLIGHT lifecycle (docs/adr/0023 — [SOURCE-DEFINED]) ──────────────
// INBOUND -> IN_SECTOR -> HANDED_OFF -> DROPPED — the guide's own four states
// (docs/adr/0087, superseding 0023's TRANSITING -> DROPPED).

function makeOverflightStrip(state) { return { state, role: 'OVERFLIGHT' }; }

test('every declared OVERFLIGHT State has exactly one NLA or a rendered inhibit reason — never undefined/unhandled', async () => {
  const { OVERFLIGHT_STATES } = await import('../src/efsp/nla.js');
  for (const state of OVERFLIGHT_STATES) {
    const result = computeNla(makeOverflightStrip(state), makeFlightData(), NOW);
    if (state === 'DROPPED') {
      assert.equal(result, null);
    } else {
      assert.ok(result !== undefined, state);
      assert.ok(result === null || 'toState' in result || 'inhibited' in result, state);
    }
  }
});

test('an OVERFLIGHT walks INBOUND -> IN_SECTOR -> HANDED_OFF -> DROPPED, unconditionally — no staffing gating, no transferTo', () => {
  assert.deepEqual(computeNla(makeOverflightStrip('INBOUND'), makeFlightData(), NOW), { toState: 'IN_SECTOR' });
  assert.deepEqual(computeNla(makeOverflightStrip('IN_SECTOR'), makeFlightData(), NOW), { toState: 'HANDED_OFF' });
  assert.deepEqual(computeNla(makeOverflightStrip('HANDED_OFF'), makeFlightData(), NOW), { toState: 'DROPPED' });
});

test('no OVERFLIGHT state is TRANSITING, and the list is the guide\'s four', async () => {
  const { OVERFLIGHT_STATES } = await import('../src/efsp/nla.js');
  assert.deepEqual(OVERFLIGHT_STATES, ['INBOUND', 'IN_SECTOR', 'HANDED_OFF', 'DROPPED']);
  assert.ok(!OVERFLIGHT_STATES.includes('TRANSITING'));
});

test('OVERFLIGHT\'s DROPPED has no NLA — a terminal state, same as every other role\'s', () => {
  assert.equal(computeNla(makeOverflightStrip('DROPPED'), makeFlightData(), NOW), null);
});

// ── MISSION lifecycle (WP4A second slice) ────────────────────────────────
// TASKED -> AIRBORNE -> ON_STATION -> OFF_STATION -> RTB -> DROPPED — the
// guide's own published lifecycle (§9.8, line 215), not invented. No
// staffing gating, no transferTo, same shape as OVERFLIGHT's own table:
// whichever Position originated (or received via TOFI ENTRY) the mission
// works its entire lifecycle solo.

function makeMissionStrip(state) { return { state, role: 'MISSION' }; }

test('every declared MISSION State has exactly one NLA or a rendered inhibit reason — never undefined/unhandled', async () => {
  const { MISSION_STATES } = await import('../src/efsp/nla.js');
  for (const state of MISSION_STATES) {
    const result = computeNla(makeMissionStrip(state), makeFlightData(), NOW);
    if (state === 'DROPPED') {
      assert.equal(result, null);
    } else {
      assert.ok(result !== undefined, state);
      assert.ok(result === null || 'toState' in result || 'inhibited' in result, state);
    }
  }
});

test('MISSION advances linearly through its whole lifecycle, unconditionally — no staffing gating', () => {
  assert.deepEqual(computeNla(makeMissionStrip('TASKED'), makeFlightData(), NOW), { toState: 'AIRBORNE' });
  assert.deepEqual(computeNla(makeMissionStrip('AIRBORNE'), makeFlightData(), NOW), { toState: 'ON_STATION' });
  assert.deepEqual(computeNla(makeMissionStrip('ON_STATION'), makeFlightData(), NOW), { toState: 'OFF_STATION' });
  assert.deepEqual(computeNla(makeMissionStrip('OFF_STATION'), makeFlightData(), NOW), { toState: 'RTB' });
  assert.deepEqual(computeNla(makeMissionStrip('RTB'), makeFlightData(), NOW), { toState: 'DROPPED' });
});

test('MISSION\'s DROPPED has no NLA — a terminal state, same as every other role\'s', () => {
  assert.equal(computeNla(makeMissionStrip('DROPPED'), makeFlightData(), NOW), null);
});

// ── §9.10 stereo routes meet the standing release (docs/adr/0050) ────────

test('HELD + HOLD_FOR_RELEASE clears when the flight was FILED on the envelope\'s stereo route', () => {
  // The interaction the whole slice turns on: the agreement is for a named
  // route, and this is the flight that named it.
  const fdr = makeFlightData({
    assigned: { releaseState: 'HOLD_FOR_RELEASE' },
    filed: { stereoRouteName: 'PACK 1', route: 'LTAG DCT ALPHA DCT LTAG' },
  });
  const ctx = {
    isStaffed: (id) => id === 'GND', consolidatedAt: () => null,
    standingReleases: [{ envelopeId: 'e1', stereoRoute: 'PACK 1', active: true }],
  };
  assert.deepEqual(computeNla(makeStrip('HELD'), fdr, Date.now(), ctx), { toState: 'PUSHBACK', transferTo: 'GND' });
});

test('an envelope naming the EXPANDED route does not release a flight filed under a stereo name', () => {
  const fdr = makeFlightData({
    assigned: { releaseState: 'HOLD_FOR_RELEASE' },
    filed: { stereoRouteName: 'PACK 1', route: 'LTAG DCT ALPHA DCT LTAG' },
  });
  const ctx = {
    isStaffed: (id) => id === 'GND', consolidatedAt: () => null,
    standingReleases: [{ envelopeId: 'e1', stereoRoute: 'LTAG DCT ALPHA DCT LTAG', active: true }],
  };
  assert.deepEqual(computeNla(makeStrip('HELD'), fdr, Date.now(), ctx),
    { inhibited: 'outside standing release envelope — file OPERATIONAL_REQUEST' });
});

test('amending a stereo flight\'s route puts it back outside the envelope — the label cleared with the route', () => {
  // flight-data-store.js's setField clears filed.stereoRouteName on a route
  // amendment; this is what that clearing is FOR. Modelled here as the
  // post-amendment FDR the store would have produced.
  const amended = makeFlightData({
    assigned: { releaseState: 'HOLD_FOR_RELEASE' },
    filed: { stereoRouteName: '', route: 'LTAG DCT DELTA' },
  });
  const ctx = {
    isStaffed: (id) => id === 'GND', consolidatedAt: () => null,
    standingReleases: [{ envelopeId: 'e1', stereoRoute: 'PACK 1', active: true }],
  };
  assert.deepEqual(computeNla(makeStrip('HELD'), amended, Date.now(), ctx),
    { inhibited: 'outside standing release envelope — file OPERATIONAL_REQUEST' });
});

test('computeNla and isVoidExpired refuse to guess the time — `now` is the caller\'s mission clock (docs/adr/0079)', () => {
  assert.throws(() => computeNla(makeStrip('HELD'), makeFlightData()), TypeError);
  assert.throws(() => isVoidExpired(makeFlightData()), TypeError);
});
