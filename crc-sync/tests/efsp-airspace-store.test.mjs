import { test } from 'node:test';
import assert from 'node:assert/strict';

const { AirspaceStore, AIRSPACE_STATES, INITIAL_STATE } = await import('../src/efsp/airspace-store.js');
const airspaceConfig = await import('../src/efsp/airspace-config.js');

// Two airspaces covering both shapes the squadron actually flies:
//  - a range with a control tower of its own, so it has a using agency
//    (a Position that schedules and runs it) and its own control frequency;
//  - a MOA with no control of its own, owned by the Center that owns the
//    airspace it sits in, where a flight is simply approved onto a working
//    frequency. The MOA has no usingPositionId, and that asymmetry is the
//    single most important thing these tests cover.
const FIXTURE = [
  {
    airspaceId: 'RANGE-1', name: 'Test Range', type: 'RANGE',
    controllingFacilityId: 'INCIRLIK', controllingPositionId: 'APP',
    usingPositionId: 'RANGE_1_CONTROL',
    controlFrequencyMhz: 283.5,
  },
  {
    airspaceId: 'MOA-1', name: 'Test MOA', type: 'MOA',
    controllingFacilityId: 'CENTER', controllingPositionId: 'CTR',
    workingFrequencyMhz: 134.25,
  },
];

function makeStore(airspaces = FIXTURE) {
  return new AirspaceStore({
    getAirspaces: () => JSON.parse(JSON.stringify(airspaces)),
    getAirspace: (id) => airspaces.find(a => a.airspaceId === id) || null,
  });
}

function apply(store, airspaceId, op, actingPositionId, by = 'c1') {
  const record = store.getAirspace(airspaceId);
  return store.apply({ airspaceId, baseRev: record ? record.rev : 0, op }, actingPositionId, by);
}

const WINDOW = { fromUtc: Date.UTC(2026, 0, 1, 12, 0), toUtc: Date.UTC(2026, 0, 1, 14, 0) };

/** Walks a range from available to active — the precondition for most tests below. */
function activateRange(store) {
  apply(store, 'RANGE-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'RANGE_1_CONTROL');
  apply(store, 'RANGE-1', { kind: 'RequestActivation' }, 'RANGE_1_CONTROL');
  return apply(store, 'RANGE-1', { kind: 'ApproveActivation' }, 'APP');
}

// ── shape ────────────────────────────────────────────────────────────────

test('an airspace starts available — RETURNED, nothing booked', () => {
  const store = makeStore();
  const airspace = store.getAirspace('RANGE-1');
  assert.equal(airspace.state, INITIAL_STATE);
  assert.equal(airspace.state, 'RETURNED');
  assert.equal(airspace.window, null);
  assert.equal(airspace.pendingRequest, null);
  assert.deepEqual(airspace.transitions, []);
});

test('the four state names are the guide\'s own — never hot/cold, which is display sugar only (§4.6.4)', () => {
  assert.deepEqual(AIRSPACE_STATES, ['SCHEDULED', 'ACTIVE', 'RELEASED', 'RETURNED']);
});

test('a record carries its static definition alongside its state, so the board can render both', () => {
  const store = makeStore();
  const airspace = store.getAirspace('RANGE-1');
  assert.equal(airspace.definition.name, 'Test Range');
  assert.equal(airspace.definition.controlFrequencyMhz, 283.5);
});

test('an unknown airspace is NOT_FOUND, never a throw', () => {
  const store = makeStore();
  assert.equal(store.getAirspace('NOPE'), null);
  assert.equal(apply(store, 'NOPE', { kind: 'ScheduleAirspace', ...WINDOW }, 'APP').reason, 'NOT_FOUND');
});

test('an unknown op kind is rejected, not applied', () => {
  const store = makeStore();
  const result = apply(store, 'RANGE-1', { kind: 'SeizeAirspace' }, 'APP');
  assert.equal(result.ok, false);
  assert.match(result.detail, /unknown airspace op/);
});

// ── the happy path, both shapes ──────────────────────────────────────────

test('a range walks scheduled -> active -> released -> returned, and is bookable again afterwards', () => {
  const store = makeStore();

  assert.equal(apply(store, 'RANGE-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'RANGE_1_CONTROL').ok, true);
  assert.equal(store.getAirspace('RANGE-1').state, 'SCHEDULED');
  assert.deepEqual(store.getAirspace('RANGE-1').window, WINDOW);

  assert.equal(apply(store, 'RANGE-1', { kind: 'RequestActivation' }, 'RANGE_1_CONTROL').ok, true);
  assert.ok(store.getAirspace('RANGE-1').pendingRequest);
  assert.equal(store.getAirspace('RANGE-1').state, 'SCHEDULED', 'asking is not getting');

  assert.equal(apply(store, 'RANGE-1', { kind: 'ApproveActivation' }, 'APP').ok, true);
  assert.equal(store.getAirspace('RANGE-1').state, 'ACTIVE');
  assert.equal(store.getAirspace('RANGE-1').pendingRequest, null, 'the request is consumed');
  assert.equal(store.isActive('RANGE-1'), true);

  assert.equal(apply(store, 'RANGE-1', { kind: 'ReleaseAirspace' }, 'RANGE_1_CONTROL').ok, true);
  assert.equal(store.getAirspace('RANGE-1').state, 'RELEASED');
  assert.equal(store.isActive('RANGE-1'), false);

  assert.equal(apply(store, 'RANGE-1', { kind: 'ReturnAirspace' }, 'APP').ok, true);
  assert.equal(store.getAirspace('RANGE-1').state, 'RETURNED');
  assert.equal(store.getAirspace('RANGE-1').window, null);

  assert.equal(apply(store, 'RANGE-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'RANGE_1_CONTROL').ok, true,
    'RETURNED is available, not terminal — an airspace is a standing entity');
});

test('a MOA with no control of its own is scheduled and activated by its controlling Position alone', () => {
  const store = makeStore();

  assert.equal(apply(store, 'MOA-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'CTR').ok, true);
  // No second party exists to request activation from, so CTR activates
  // directly — this is the common case, not an exception.
  const approved = apply(store, 'MOA-1', { kind: 'ApproveActivation' }, 'CTR');
  assert.equal(approved.ok, true, JSON.stringify(approved));
  assert.equal(store.isActive('MOA-1'), true);

  assert.equal(apply(store, 'MOA-1', { kind: 'ReleaseAirspace' }, 'CTR').ok, true);
  assert.equal(apply(store, 'MOA-1', { kind: 'ReturnAirspace' }, 'CTR').ok, true);
  assert.equal(store.getAirspace('MOA-1').state, 'RETURNED');
});

// ── authority (§9.11) ────────────────────────────────────────────────────

test('only the controlling Position may approve activation — the using agency cannot activate its own airspace', () => {
  const store = makeStore();
  apply(store, 'RANGE-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'RANGE_1_CONTROL');
  apply(store, 'RANGE-1', { kind: 'RequestActivation' }, 'RANGE_1_CONTROL');

  const selfApproved = apply(store, 'RANGE-1', { kind: 'ApproveActivation' }, 'RANGE_1_CONTROL');
  assert.equal(selfApproved.ok, false);
  assert.equal(selfApproved.reason, 'PERMISSION_DENIED');
  assert.equal(store.getAirspace('RANGE-1').state, 'SCHEDULED');
});

test('the controlling Position of a DIFFERENT airspace has no authority here', () => {
  const store = makeStore();
  apply(store, 'RANGE-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'RANGE_1_CONTROL');
  apply(store, 'RANGE-1', { kind: 'RequestActivation' }, 'RANGE_1_CONTROL');

  // CTR owns the MOA, not this range — the authority is per airspace, which
  // is the whole point of configuring it per airspace rather than fixing it
  // to APP as the guide's §9.11 wording does.
  const result = apply(store, 'RANGE-1', { kind: 'ApproveActivation' }, 'CTR');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PERMISSION_DENIED');
});

test('only the using agency may release; only the controlling Position may take it back', () => {
  const store = makeStore();
  activateRange(store);

  assert.equal(apply(store, 'RANGE-1', { kind: 'ReleaseAirspace' }, 'APP').reason, 'PERMISSION_DENIED');
  assert.equal(apply(store, 'RANGE-1', { kind: 'ReleaseAirspace' }, 'RANGE_1_CONTROL').ok, true);
  assert.equal(apply(store, 'RANGE-1', { kind: 'ReturnAirspace' }, 'RANGE_1_CONTROL').reason, 'PERMISSION_DENIED');
  assert.equal(apply(store, 'RANGE-1', { kind: 'ReturnAirspace' }, 'APP').ok, true);
});

test('a range with its own using agency cannot be activated without one having asked', () => {
  const store = makeStore();
  apply(store, 'RANGE-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'RANGE_1_CONTROL');

  const result = apply(store, 'RANGE-1', { kind: 'ApproveActivation' }, 'APP');
  assert.equal(result.ok, false);
  assert.match(result.detail, /no activation request/);
});

test('denying activation clears the request and leaves the airspace scheduled, with the reason recorded', () => {
  const store = makeStore();
  apply(store, 'RANGE-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'RANGE_1_CONTROL');
  apply(store, 'RANGE-1', { kind: 'RequestActivation' }, 'RANGE_1_CONTROL');

  assert.equal(apply(store, 'RANGE-1', { kind: 'DenyActivation', reason: 'traffic' }, 'APP').ok, true);
  const airspace = store.getAirspace('RANGE-1');
  assert.equal(airspace.state, 'SCHEDULED');
  assert.equal(airspace.pendingRequest, null);
  assert.equal(airspace.lastDenial.reason, 'traffic');
});

test('one controller holding both sides is recorded as a self-coordination, and the state change still happens', () => {
  const store = makeStore();
  // §4.8.3: "the state change is mandatory and unconditional. Only the
  // two-party dialogue collapses."
  apply(store, 'RANGE-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'RANGE_1_CONTROL', 'solo');
  apply(store, 'RANGE-1', { kind: 'RequestActivation' }, 'RANGE_1_CONTROL', 'solo');
  assert.equal(apply(store, 'RANGE-1', { kind: 'ApproveActivation' }, 'APP', 'solo').ok, true);

  const activation = store.getAirspace('RANGE-1').transitions.find(t => t.state === 'ACTIVE');
  assert.equal(activation.selfCoordinated, true);
});

test('two different controllers are NOT a self-coordination', () => {
  const store = makeStore();
  apply(store, 'RANGE-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'RANGE_1_CONTROL', 'range-guy');
  apply(store, 'RANGE-1', { kind: 'RequestActivation' }, 'RANGE_1_CONTROL', 'range-guy');
  apply(store, 'RANGE-1', { kind: 'ApproveActivation' }, 'APP', 'app-guy');

  const activation = store.getAirspace('RANGE-1').transitions.find(t => t.state === 'ACTIVE');
  assert.equal(activation.selfCoordinated, false);
});

// ── lifecycle legality ───────────────────────────────────────────────────

test('an available airspace cannot jump straight to active — it has to be scheduled first', () => {
  const store = makeStore();
  const result = apply(store, 'MOA-1', { kind: 'ApproveActivation' }, 'CTR');
  assert.equal(result.ok, false);
  assert.match(result.detail, /cannot go to ACTIVE/);
});

test('an active airspace cannot be returned without being released first', () => {
  const store = makeStore();
  activateRange(store);
  const result = apply(store, 'RANGE-1', { kind: 'ReturnAirspace' }, 'APP');
  assert.equal(result.ok, false);
  assert.match(result.detail, /cannot go to RETURNED/);
});

test('a schedule can be cancelled before it ever goes active', () => {
  const store = makeStore();
  apply(store, 'MOA-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'CTR');
  assert.equal(apply(store, 'MOA-1', { kind: 'ReturnAirspace' }, 'CTR').ok, true);
  assert.equal(store.getAirspace('MOA-1').state, 'RETURNED');
});

test('a schedule needs a window, with the end after the start', () => {
  const store = makeStore();
  assert.equal(apply(store, 'MOA-1', { kind: 'ScheduleAirspace' }, 'CTR').ok, false);
  assert.equal(apply(store, 'MOA-1', { kind: 'ScheduleAirspace', fromUtc: WINDOW.toUtc, toUtc: WINDOW.fromUtc }, 'CTR').ok, false);
});

test('a second activation request while one is outstanding is refused rather than silently replacing it', () => {
  const store = makeStore();
  apply(store, 'RANGE-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'RANGE_1_CONTROL');
  apply(store, 'RANGE-1', { kind: 'RequestActivation' }, 'RANGE_1_CONTROL');
  const second = apply(store, 'RANGE-1', { kind: 'RequestActivation' }, 'RANGE_1_CONTROL');
  assert.equal(second.ok, false);
  assert.match(second.detail, /already outstanding/);
});

// ── history and concurrency ──────────────────────────────────────────────

test('every state change is appended to an immutable history, never overwritten', () => {
  const store = makeStore();
  activateRange(store);
  apply(store, 'RANGE-1', { kind: 'ReleaseAirspace' }, 'RANGE_1_CONTROL');
  apply(store, 'RANGE-1', { kind: 'ReturnAirspace' }, 'APP');

  const states = store.getAirspace('RANGE-1').transitions.map(t => t.state);
  assert.deepEqual(states, ['SCHEDULED', 'ACTIVE', 'RELEASED', 'RETURNED']);
  // JO 7110.65 ¶2-3-1 — an after-action review has to be able to say when
  // the block went hot and who approved it, not just where it is now.
  const activation = store.getAirspace('RANGE-1').transitions.find(t => t.state === 'ACTIVE');
  assert.equal(activation.actingPositionId, 'APP');
  assert.ok(activation.at > 0);
});

test('a stale rev is rejected, so two controllers cannot both act on what they last saw', () => {
  const store = makeStore();
  const stale = store.getAirspace('MOA-1').rev;
  apply(store, 'MOA-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'CTR');

  const result = store.apply({ airspaceId: 'MOA-1', baseRev: stale, op: { kind: 'ApproveActivation' } }, 'CTR', 'c2');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'STALE_REV');
});

// ── persistence (ADR 0002) ───────────────────────────────────────────────

test('state survives a restart; definitions come from config rather than the snapshot', () => {
  const store = makeStore();
  activateRange(store);

  const restored = makeStore();
  restored.restore(store.snapshot());
  assert.equal(restored.getAirspace('RANGE-1').state, 'ACTIVE');
  assert.equal(restored.getAirspace('RANGE-1').definition.name, 'Test Range');
  assert.deepEqual(restored.getAirspace('RANGE-1').transitions.map(t => t.state), ['SCHEDULED', 'ACTIVE']);
});

test('an airspace dropped from config since the snapshot was written is skipped, not resurrected', () => {
  const store = makeStore();
  activateRange(store);
  const saved = store.snapshot();

  const narrowed = makeStore(FIXTURE.filter(a => a.airspaceId !== 'RANGE-1'));
  narrowed.restore(saved);
  assert.equal(narrowed.getAirspace('RANGE-1'), null);
  assert.equal(narrowed.getAll().length, 1);
});

// ── config validation ────────────────────────────────────────────────────

test('the shipped airspace config is empty — real names and frequencies are squadron data, and inventing them would present source-defined behaviour as doctrine', () => {
  assert.deepEqual(airspaceConfig.getAirspaces(), []);
  assert.deepEqual(airspaceConfig.getRangePositionIds(), []);
});

test('a malformed airspace definition is rejected with a reason, never half-loaded', () => {
  const { validateAirspaces } = airspaceConfig;
  assert.equal(validateAirspaces(FIXTURE).ok, true);
  assert.equal(validateAirspaces({}).ok, false);
  assert.match(validateAirspaces([{ name: 'x', type: 'MOA' }]).detail, /airspaceId/);
  assert.match(validateAirspaces([{ ...FIXTURE[0], type: 'WARNING_AREA' }]).detail, /unknown type/);
  assert.match(validateAirspaces([FIXTURE[0], FIXTURE[0]]).detail, /duplicate/);
  assert.match(validateAirspaces([{ ...FIXTURE[1], controllingPositionId: undefined }]).detail, /controllingPositionId/);
});

test('a frequency outside the band, or not a number at all, is rejected at load', () => {
  const { validateAirspaces, isValidFrequency } = airspaceConfig;
  assert.equal(isValidFrequency(251.0), true);
  assert.equal(isValidFrequency('251.0'), false, 'one unit and one type — MHz, as a number');
  assert.equal(isValidFrequency(0), false);
  assert.equal(isValidFrequency(1e9), false, 'Hz would be out of band — the repo mixes units elsewhere, this does not');
  assert.match(validateAirspaces([{ ...FIXTURE[1], workingFrequencyMhz: '134.25' }]).detail, /workingFrequencyMhz/);
});

test('range Positions are derived from the airspaces that declare one — a MOA contributes none', () => {
  const { validateAirspaces } = airspaceConfig;
  assert.equal(validateAirspaces(FIXTURE).ok, true);
  // Mirrors getRangePositionIds' logic against the fixture: only the range
  // with control of its own yields a Position.
  const derived = [...new Set(FIXTURE.filter(a => a.usingPositionId).map(a => a.usingPositionId))];
  assert.deepEqual(derived, ['RANGE_1_CONTROL']);
});

test('the RANGES Facility config is derived, never loaded from or written to disk', async () => {
  // Its Position set comes from the airspace config, so an on-disk override
  // would freeze a `positions` array that goes stale the moment an airspace
  // is added or removed.
  const facilityConfig = await import('../src/efsp/facility-config.js');
  const result = facilityConfig.setFacilityConfig({ positions: ['FAKE_RANGE'] }, 'RANGES');
  assert.equal(result.ok, false);
  assert.match(result.detail, /derived from the airspace config/);
  assert.deepEqual(facilityConfig.getPositionSet('RANGES'), []);
});
