import test from 'node:test';
import assert from 'node:assert/strict';

/* The correlation sweep (guide §6.6 rules 1 and 6).
 *
 * Three things here are worth more than the rest:
 *   - the ordered claim sweep, so a binding always claims a contact before
 *     the beacon rung and one contact never correlates to two flights, and
 *     there is no callsign rung at all (H165, docs/adr/0142);
 *   - the eligibility EXCLUSION list, with a test that forces a decision
 *     whenever a new EfspState is added (docs/adr/0041's lesson);
 *   - the §10.3 ring fence: nothing in here may move a Strip.
 */

const { CorrelationReconciler, computeCorrelationRate, INELIGIBLE_STATES } =
  await import('../src/efsp/correlation-reconciler.js');
const { octalCode } = await import('../src/surveillance/transponder.js');
const { CorrelationStore } = await import('../src/efsp/correlation-store.js');
const { STATES_BY_STRIP_TYPE } = await import('../src/efsp/nla.js');

// ── harness ────────────────────────────────────────────────────────────────

function fakeTrackStore(tracks) {
  return { getAll: () => tracks };
}

/** An FlightDataStore stand-in: just identity, plus the observed-code setter. */
function fakeFlightDataStore(flightDataList) {
  const observed = new Map();
  return {
    getAll: () => flightDataList,
    getFlightData: (id) => flightDataList.find(f => f.flightDataId === id) || null,
    setBeaconObserved: (id, code) => { observed.set(id, code); return { ok: true, changed: true }; },
    observed,
  };
}

function flightData(flightDataId, callsign, beaconAssigned) {
  return { flightDataId, identity: { callsign, beaconAssigned } };
}

function strip(flightDataId, state = 'AIRBORNE') {
  return { stripId: `s-${flightDataId}`, flightDataId, state };
}

function track(id, callsign, squawk = null) {
  return { id, callsign, squawk, category: 1, lat: 37, lon: 35, alt: 6000 };
}

function build({ flightDataList = [], strips = [], tracks = [] } = {}) {
  const flightDataStore = fakeFlightDataStore(flightDataList);
  const store = new CorrelationStore({ flightDataExists: (id) => !!flightDataStore.getFlightData(id) });
  const deltas = [];
  const reconciler = new CorrelationReconciler({
    beaconOf: (t) => octalCode(t.squawk),
    trackStore: fakeTrackStore(tracks),
    flightDataStore,
    correlationStore: store,
    boardStoreFor: (facilityId) => (facilityId === 'INCIRLIK' ? { getAll: () => strips } : { getAll: () => [] }),
    facilityConfig: { getFacilityIds: () => ['INCIRLIK', 'CENTER'] },
    onDelta: (payload) => deltas.push(payload),
  });
  return { reconciler, store, flightDataStore, deltas };
}

// ── the rate ───────────────────────────────────────────────────────────────

test('computeCorrelationRate is correlated over eligible', () => {
  const rate = computeCorrelationRate([
    { state: 'CORRELATED' }, { state: 'UNCORRELATED' }, { state: 'UNCORRELATED' }, { state: 'CORRELATED' },
  ]);
  assert.equal(rate.eligible, 4);
  assert.equal(rate.correlated, 2);
  assert.equal(rate.uncorrelated, 2);
  assert.equal(rate.provisional, undefined, 'there is no provisional state any more (docs/adr/0142)');
  assert.equal(rate.rate, 0.5);
});

test('an empty board reports null, never 1.0 — otherwise the 95% gate passes vacuously', () => {
  assert.equal(computeCorrelationRate([]).rate, null);
  assert.equal(computeCorrelationRate(null).rate, null);
});

// ── eligibility ────────────────────────────────────────────────────────────

// Every state a Strip can be in, classified one way or the other. The module holds the
// ineligible side; this is the eligible side. A state added to the authority registry's
// STATES_BY_STRIP_TYPE fails here until it is put on one side (docs/adr/0041's lesson).
const ELIGIBLE = new Set([
  'PUSHBACK', 'TAXI', 'RUNWAY_QUEUE', 'LUAW', 'DEPARTED', 'HANDED_OFF', 'INBOUND', 'HANDED_TO_TOWER', 'TRAFFIC_PATTERN', 'FINAL', 'LANDED',
  'TAXI_IN', 'IN_SECTOR', 'AIRBORNE', 'ON_STATION', 'OFF_STATION', 'RTB',
  'LAUNCH', 'IN_STACK', 'COMMENCED', 'ON_FINAL', 'BALL', 'BOLTER_WAVEOFF', 'IN_PATTERN', 'RECOVERED',
]);

test('every state of every strip type is classified: ELIGIBLE here plus INELIGIBLE_STATES equals the registry\'s states', () => {
  const all = new Set();
  for (const states of Object.values(STATES_BY_STRIP_TYPE)) for (const s of states) all.add(s);
  assert.ok(all.size > 10, 'sanity: the state sets loaded');
  const overlap = [...ELIGIBLE].filter(s => INELIGIBLE_STATES.has(s));
  assert.deepEqual(overlap, [], 'a state is on both sides');
  const classified = new Set([...ELIGIBLE, ...INELIGIBLE_STATES]);
  const unclassified = [...all].filter(s => !classified.has(s));
  const stale = [...classified].filter(s => !all.has(s));
  assert.deepEqual(unclassified, [], `new state(s) on neither side: put each on ELIGIBLE here or in INELIGIBLE_STATES`);
  assert.deepEqual(stale, [], 'classified here but no longer a state of any strip type');
});

test('a pre-movement flight is not eligible, so it does not drag the rate down', () => {
  for (const state of ['PROPOSED', 'PENDING_CLEARANCE', 'CLEARED', 'HELD', 'TASKED', 'DROPPED']) {
    assert.equal(CorrelationReconciler.isEligible([strip('f', state)]), false, state);
  }
});

test('everything from pushback onward is eligible — an aircraft on the ramp is a DCS unit', () => {
  for (const state of ['PUSHBACK', 'TAXI', 'LUAW', 'DEPARTED', 'HANDED_OFF', 'INBOUND', 'AIRBORNE']) {
    assert.equal(CorrelationReconciler.isEligible([strip('f', state)]), true, state);
  }
});

test('one eligible Strip is enough, even beside an ineligible one on the same flight data', () => {
  assert.equal(CorrelationReconciler.isEligible([strip('f', 'PROPOSED'), strip('f', 'AIRBORNE')]), true);
});

test('flight data with no live Strip at all is not swept', () => {
  const { reconciler, store } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041')], strips: [], tracks: [track(1, 'VIPER1', 41)],
  });
  reconciler.tick();
  assert.equal(store.getCorrelation('f1'), null);
});

// ── the ladder ─────────────────────────────────────────────────────────────

test('an explicit binding outranks everything the sweep could work out', () => {
  const { reconciler, store } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041')],
    strips: [strip('f1')],
    // Contact 1 squawks the assigned code; the controller has bound contact 2
    // anyway, because they can see it.
    tracks: [track(1, 'VIPER1', 41), track(2, 'UNKNOWN', null)],
  });
  store.apply({ flightDataId: 'f1', baseRev: 0, op: { kind: 'BindTrack', trackId: '2' } }, 'AP', 'c');
  reconciler.tick();
  const record = store.getCorrelation('f1');
  assert.equal(record.matchedBy, 'BINDING');
  assert.equal(record.trackId, '2');
});

test('a binding to a contact that no longer exists lets the beacon rung have a go', () => {
  const { reconciler, store } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041')], strips: [strip('f1')], tracks: [track(1, 'VIPER1', 41)],
  });
  store.apply({ flightDataId: 'f1', baseRev: 0, op: { kind: 'BindTrack', trackId: '999' } }, 'AP', 'c');
  reconciler.tick();
  const record = store.getCorrelation('f1');
  assert.equal(record.matchedBy, 'BEACON');
  assert.equal(record.trackId, '1');
});

test('the assigned beacon code correlates, and the observed code is pushed onto the flight data', () => {
  const { reconciler, store, flightDataStore } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041')], strips: [strip('f1')], tracks: [track(1, 'SOMETHINGELSE', 41)],
  });
  reconciler.tick();
  const record = store.getCorrelation('f1');
  assert.equal(record.state, 'CORRELATED');
  assert.equal(record.matchedBy, 'BEACON');
  assert.equal(record.observedBeacon, '0041');
  assert.equal(flightDataStore.observed.get('f1'), '0041', '§3.10.2 rule 1 has real data behind it');
});

test('no callsign correlation: an exact callsign match with no code is NO TRK (H165)', () => {
  const { reconciler, store } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041')], strips: [strip('f1')], tracks: [track(1, 'VIPER1', null)],
  });
  reconciler.tick();
  const record = store.getCorrelation('f1');
  assert.equal(record.state, 'UNCORRELATED');
  assert.equal(record.trackId, null);
  assert.equal(record.warning.kind, 'TRACK_LOST');
});

test('no callsign correlation: an exact callsign squawking another code is NO TRK, not provisional', () => {
  const { reconciler, store } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041')], strips: [strip('f1')], tracks: [track(1, 'VIPER1', 56)],
  });
  reconciler.tick();
  const record = store.getCorrelation('f1');
  assert.equal(record.state, 'UNCORRELATED');
  assert.equal(record.trackId, null);
});

test('no callsign correlation: a near callsign (COLT11 flying, COLT1 filed) is NO TRK — the H165 case', () => {
  const { reconciler, store } = build({
    flightDataList: [flightData('f1', 'COLT1', '0041')], strips: [strip('f1')],
    tracks: [track(1, 'COLT11', null), track(2, 'COLT12', 6012)],
  });
  reconciler.tick();
  const record = store.getCorrelation('f1');
  assert.equal(record.state, 'UNCORRELATED');
  assert.equal(record.trackId, null);
  assert.equal(record.warning.kind, 'TRACK_LOST');
  assert.equal(record.matchedBy, null);
});

test('nothing matching raises TRACK_LOST rather than leaving the record silent', () => {
  const { reconciler, store } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041')], strips: [strip('f1')], tracks: [track(1, 'HORNET1', 77)],
  });
  reconciler.tick();
  const record = store.getCorrelation('f1');
  assert.equal(record.state, 'UNCORRELATED');
  assert.equal(record.warning.kind, 'TRACK_LOST');
});

// ── the ordered claim sweep ────────────────────────────────────────────────

test('a binding claims first, so the beacon rung cannot take the bound contact', () => {
  const { reconciler, store } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041'), flightData('f2', 'HAWG1', '0042')],
    strips: [strip('f1'), strip('f2')],
    tracks: [track(1, 'X', 42)],
  });
  store.apply({ flightDataId: 'f1', baseRev: 0, op: { kind: 'BindTrack', trackId: '1' } }, 'AP', 'c');
  reconciler.tick();
  assert.equal(store.getCorrelation('f1').trackId, '1');
  assert.equal(store.getCorrelation('f1').matchedBy, 'BINDING');
  assert.equal(store.getCorrelation('f2').state, 'UNCORRELATED');
  assert.equal(store.getCorrelation('f2').warning.detail, 'the contact squawking 0042 is correlated to VIPER1');
});

test('one contact never correlates to two flights', () => {
  const { reconciler, store } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041'), flightData('f2', 'VIPER1', '0042')],
    strips: [strip('f1'), strip('f2')],
    tracks: [track(1, 'VIPER1', 41)],
  });
  reconciler.tick();
  assert.equal(store.getCorrelation('f1').trackId, '1');
  assert.notEqual(store.getCorrelation('f2').trackId, '1');
});

test('two contacts squawking one assigned code is ambiguous, and neither is guessed at', () => {
  // §3.10.2 rule 7: duplicates are structural and accepted. Guessing is not.
  const { reconciler, store } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041')], strips: [strip('f1')],
    tracks: [track(1, 'SOMEONE', 41), track(2, 'SOMEONEELSE', 41)],
  });
  reconciler.tick();
  const record = store.getCorrelation('f1');
  assert.equal(record.state, 'UNCORRELATED');
  assert.equal(record.warning.kind, 'AMBIGUOUS_BEACON');
  assert.deepEqual(record.warning.candidateTrackIds.sort(), ['1', '2']);
  assert.match(record.warning.detail, /bind one/, 'and the way out is rung 1');
});

// ── broadcasting ───────────────────────────────────────────────────────────

test('onDelta fires once per tick, with only the records that changed', () => {
  const { reconciler, deltas } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041'), flightData('f2', 'HORNET1', '0042')],
    strips: [strip('f1'), strip('f2')],
    tracks: [track(1, 'VIPER1', 41), track(2, 'HORNET1', 42)],
  });
  reconciler.tick();
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].correlations.length, 2);
  assert.ok(deltas[0].stats, 'the rate rides along with it');
});

test('a quiet tick broadcasts nothing at all', () => {
  const { reconciler, deltas } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041')], strips: [strip('f1')], tracks: [track(1, 'VIPER1', 41)],
  });
  reconciler.tick();
  assert.equal(deltas.length, 1);
  reconciler.tick();
  assert.equal(deltas.length, 1, 'nothing changed, so nothing was sent');
});

test('one flight changing does not drag every other record into the delta', () => {
  const { reconciler, deltas, store } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041'), flightData('f2', 'HORNET1', '0042')],
    strips: [strip('f1'), strip('f2')],
    tracks: [track(1, 'VIPER1', 41), track(2, 'HORNET1', 42)],
  });
  reconciler.tick();
  deltas.length = 0;

  // Re-bind f1 only, by hand, then tick: f2 is untouched.
  store.apply({ flightDataId: 'f1', baseRev: store.getCorrelation('f1').rev, op: { kind: 'BindTrack', trackId: '1' } }, 'AP', 'c');
  reconciler.tick();
  assert.equal(deltas.length, 0, 'the binding agreed with the sweep, so the sweep changed nothing');
});

// ── the rate, reported ─────────────────────────────────────────────────────

test('the rate is reported, and accumulates across ticks for a session figure', () => {
  const { reconciler } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041'), flightData('f2', 'HORNET1', '0042'), flightData('f3', 'EAGLE1', '0043')],
    strips: [strip('f1'), strip('f2'), strip('f3')],
    tracks: [track(1, 'VIPER1', 41), track(2, 'HORNET1', 42)],
  });
  const { stats } = reconciler.tick();
  assert.equal(stats.eligible, 3);
  assert.ok(Math.abs(stats.rate - 2 / 3) < 1e-9);
  assert.ok(Math.abs(stats.sessionRate - 2 / 3) < 1e-9);
  assert.equal(stats.target, 0.95);
  assert.ok(stats.minRateSeen <= stats.rate);
  assert.equal(stats.matchKeyCounts.BEACON, 2);
});

test('binding the missing flight takes the rate to 1.0', () => {
  const { reconciler, store } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041'), flightData('f2', 'HORNET1', '0042')],
    strips: [strip('f1'), strip('f2')],
    tracks: [track(1, 'VIPER1', 41), track(9, 'MYSTERY', null)],
  });
  assert.ok(reconciler.tick().stats.rate < 1);
  store.apply({ flightDataId: 'f2', baseRev: store.getCorrelation('f2').rev, op: { kind: 'BindTrack', trackId: '9' } }, 'AP', 'c');
  assert.equal(reconciler.tick().stats.rate, 1);
});

test('a ramp-bound departure is not eligible and does not drag the rate down', () => {
  const { reconciler } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041'), flightData('f2', 'HORNET1', '0042')],
    strips: [strip('f1', 'AIRBORNE'), strip('f2', 'PROPOSED')],
    tracks: [track(1, 'VIPER1', 41)],
  });
  const { stats } = reconciler.tick();
  assert.equal(stats.eligible, 1);
  assert.equal(stats.rate, 1);
});

test('re-binds and warnings are counted, which is what a rate alone would not show', () => {
  const tracks = [track(101, 'VIPER1', 41)];
  const { reconciler } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041')], strips: [strip('f1')], tracks,
  });
  reconciler.tick();
  assert.equal(reconciler.getStats().rebinds, 0);

  // The same aircraft comes back with a new id, as DCS does on a reload.
  tracks.length = 0;
  tracks.push(track(500, 'VIPER1', 41));
  reconciler.tick();
  assert.equal(reconciler.getStats().rebinds, 1);
});

// ── mission reload ─────────────────────────────────────────────────────────

test('resetPicture warns on every record and broadcasts once', () => {
  const { reconciler, store, deltas } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041')], strips: [strip('f1')], tracks: [track(101, 'VIPER1', 41)],
  });
  reconciler.tick();
  deltas.length = 0;

  reconciler.resetPicture('MISSION_RELOAD');
  assert.equal(deltas.length, 1);
  assert.equal(store.getCorrelation('f1').warning.kind, 'TRACK_IDENTITY_LOST');
});

// ── the §10.3 ring fence ───────────────────────────────────────────────────

test('nothing in the sweep can move a Strip — §10.3 is a MUST NOT, enforced by construction', () => {
  // "MUST NOT move Strips between Bays based on detected aircraft position."
  // The ring fence is that the reconciler is handed a read-only view of the
  // Boards and never a BoardStore it could mutate; this asserts the Strips it
  // saw came back untouched.
  const strips = [strip('f1', 'AIRBORNE')];
  const before = JSON.parse(JSON.stringify(strips));
  const { reconciler } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041')], strips, tracks: [track(1, 'VIPER1', 41)],
  });
  reconciler.tick();
  reconciler.resetPicture('MISSION_RELOAD');
  assert.deepEqual(strips, before, 'no state, no bayId, nothing');
});

test('the sweep never touches a Strip even when the contact contradicts its state', () => {
  // An airborne contact under a Strip still at PUSHBACK is exactly the case
  // §10.3's suggestion chip is for — and the chip is deferred (docs/adr/0047),
  // so the correct behaviour here is to leave the Strip entirely alone.
  const strips = [strip('f1', 'PUSHBACK')];
  const before = JSON.parse(JSON.stringify(strips));
  const { reconciler, store } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041')], strips, tracks: [track(1, 'VIPER1', 41)],
  });
  reconciler.tick();
  assert.equal(store.getCorrelation('f1').state, 'CORRELATED', 'it correlates...');
  assert.deepEqual(strips, before, '...and moves nothing');
});

// ── flights that are over ─────────────────────────────────────────────────

test('a flight with no live Strip left is retired, not kept forever with a stale contact', () => {
  // Found by walking the sortie: releaseFlightData only frees the beacon code, it does
  // not delete the flight data — so a flight data record with nothing but DROPPED Strips lives
  // forever, and its correlation record lived with it. Never swept again
  // (eligibility needs a live Strip), stuck at whatever it last was, still
  // carrying a trackId, and still sent in every snapshot.
  const strips = [strip('f1', 'AIRBORNE')];
  const { reconciler, store } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041')], strips, tracks: [track(1, 'VIPER1', 41)],
  });
  reconciler.tick();
  assert.equal(store.getCorrelation('f1').trackId, '1');

  strips[0] = strip('f1', 'DROPPED');
  reconciler.tick();

  assert.equal(store.getCorrelation('f1'), null, 'the flight is over, so the record goes');
  assert.deepEqual(store.getAll(), [], 'and the snapshot stops carrying it');
});

test('a live-but-ineligible Strip is NOT retired — it has no contact yet, which is different', () => {
  const strips = [strip('f1', 'AIRBORNE')];
  const { reconciler, store } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0041')], strips, tracks: [track(1, 'VIPER1', 41)],
  });
  reconciler.tick();

  // Back to a pre-movement state: still a live Strip, just nothing to find.
  strips[0] = strip('f1', 'PROPOSED');
  reconciler.tick();

  assert.ok(store.getCorrelation('f1'), 'the record survives a flight going quiet');
});

// ── S-L27 is gone with the callsign rungs (docs/adr/0142) ──

test('a finished flight\'s lingering aircraft is not the next flight\'s, by construction (S-L27)', () => {
  // VIPER1 flew (bound), its Strip was dropped, its aircraft is still in the
  // air. A NEW flight files VIPER1 with another code: nothing matches.
  const strips = [strip('f1', 'AIRBORNE')];
  const flightDataList = [flightData('f1', 'VIPER1', null)];
  const tracks = [track(1, 'VIPER1')];
  const { reconciler, store } = build({ flightDataList, strips, tracks });
  store.apply({ flightDataId: 'f1', baseRev: 0, op: { kind: 'BindTrack', trackId: '1' } }, 'AP', 'c');
  reconciler.tick();
  assert.equal(store.getCorrelation('f1').trackId, '1');

  strips.length = 0;
  strips.push(strip('f2', 'PUSHBACK'));
  flightDataList.length = 0; flightDataList.push(flightData('f2', 'VIPER1', '0042'));
  reconciler.tick();
  const rec = store.getCorrelation('f2');
  assert.equal(rec.state, 'UNCORRELATED');
  assert.equal(rec.trackId, null);
});

test('an explicit binding can take a finished flight\'s contact (S-L27)', () => {
  const strips = [strip('f1', 'AIRBORNE')];
  const flightDataList = [flightData('f1', 'VIPER1', null)];
  const { reconciler, store } = build({ flightDataList, strips, tracks: [track(1, 'VIPER1')] });
  store.apply({ flightDataId: 'f1', baseRev: 0, op: { kind: 'BindTrack', trackId: '1' } }, 'AP', 'c');
  reconciler.tick();
  strips.length = 0; strips.push(strip('f2', 'PUSHBACK'));
  flightDataList.length = 0; flightDataList.push(flightData('f2', 'VIPER1', null));
  reconciler.tick();
  const r = store.apply({ clientMutationId: 'm1', flightDataId: 'f2', baseRev: store.getCorrelation('f2').rev, op: { kind: 'BindTrack', trackId: '1' } }, 'GCI', 'u1');
  reconciler.tick();
  assert.equal(store.getCorrelation('f2').trackId, '1', JSON.stringify(r));
});

// ── H135 / T12: the beacon rung has no former-holder exclusion ──
// JO 7110.65BB ¶5-3-3 d, ¶5-3-4 a: automation acquires the target squawking an
// active flight's assigned discrete code; a finished flight holds no code.

test('the assigned code acquires a contact a finished flight once held (H135, T12)', () => {
  // The jet flew as f1 (bound), f1's Strip was dropped, and the same jet now
  // squawks the code a NEW flight was assigned.
  const strips = [strip('f1', 'AIRBORNE')];
  const flightDataList = [flightData('f1', 'VIPER1', null)];
  const tracks = [track(1, 'VIPER1', null)];
  const { reconciler, store } = build({ flightDataList, strips, tracks });
  store.apply({ flightDataId: 'f1', baseRev: 0, op: { kind: 'BindTrack', trackId: '1' } }, 'AP', 'c');
  reconciler.tick();
  assert.equal(store.getCorrelation('f1').trackId, '1');

  strips.length = 0; strips.push(strip('f2', 'INBOUND'));
  flightDataList.length = 0; flightDataList.push(flightData('f2', 'HAWG1', '0003'));
  tracks[0] = track(1, 'VIPER1', 3);
  reconciler.tick();
  const rec = store.getCorrelation('f2');
  assert.equal(rec.state, 'CORRELATED');
  assert.equal(rec.matchedBy, 'BEACON');
  assert.equal(rec.trackId, '1');
});

test('a code whose contact went to another flight says which flight, not "no contact" (T12)', () => {
  // Two live flights assigned one code (§3.10.2 rule 7 accepts the duplicate
  // with a warning): the first claims the contact; the second's NO TRK names it.
  const { reconciler, store } = build({
    flightDataList: [flightData('f1', 'VIPER1', '0003'), flightData('f2', 'HAWG1', '0003')],
    strips: [strip('f1'), strip('f2')],
    tracks: [track(1, 'SOMEONE', 3)],
  });
  reconciler.tick();
  assert.equal(store.getCorrelation('f1').trackId, '1');
  const rec = store.getCorrelation('f2');
  assert.equal(rec.state, 'UNCORRELATED');
  assert.equal(rec.warning.kind, 'TRACK_LOST');
  assert.equal(rec.warning.detail, 'the contact squawking 0003 is correlated to VIPER1');
});

// ── docs/adr/0142: an AI flight correlates on the synthetic code a controller enters ──

test('an AI aircraft\'s synthetic code typed into the Strip correlates it on the beacon rung', () => {
  const flightDataList = [flightData('f1', 'COLT1', '0041')];
  const tracks = [track(7, 'COLT11', 6012)];
  const { reconciler, store } = build({ flightDataList, strips: [strip('f1')], tracks });
  reconciler.tick();
  assert.equal(store.getCorrelation('f1').state, 'UNCORRELATED', 'COLT1 filed, COLT11 flying: no callsign match');

  flightDataList[0] = flightData('f1', 'COLT1', '6012'); // the controller reads 6012 off the scope
  reconciler.tick();
  const rec = store.getCorrelation('f1');
  assert.equal(rec.state, 'CORRELATED');
  assert.equal(rec.matchedBy, 'BEACON');
  assert.equal(rec.trackId, '7');
  assert.equal(rec.observedBeacon, '6012');
});

test('a synthetic code re-minted to a different AI aircraft is not followed (CODE_REISSUED)', () => {
  const flightDataList = [flightData('f1', 'COLT1', '6012')];
  const tracks = [track(7, 'COLT11', 6012)];
  const { reconciler, store, deltas } = build({ flightDataList, strips: [strip('f1')], tracks });
  reconciler.tick();
  assert.equal(store.getCorrelation('f1').trackId, '7');

  // COLT11 lands and despawns: its code goes back to the block. The Strip is NO TRK.
  tracks.length = 0;
  reconciler.tick();
  assert.equal(store.getCorrelation('f1').warning.kind, 'TRACK_LOST');

  // A new AI unit spawns and crc-sync happens to mint it 6012.
  tracks.push(track(8, 'HAWG21', 6012));
  deltas.length = 0;
  reconciler.tick();
  const rec = store.getCorrelation('f1');
  assert.equal(rec.state, 'UNCORRELATED', 'the Strip did not jump to the new holder');
  assert.equal(rec.trackId, null);
  assert.equal(rec.warning.kind, 'CODE_REISSUED');
  assert.deepEqual(rec.warning.candidateTrackIds, ['8']);
  assert.match(rec.warning.detail, /6012 is now squawked by a different AI aircraft/);
  assert.equal(deltas.length, 1, 'and the controller is told: the warning change is broadcast');
});

test('the re-mint in the same tick as the old aircraft leaves is not followed either', () => {
  const tracks = [track(7, 'COLT11', 6012)];
  const { reconciler, store } = build({ flightDataList: [flightData('f1', 'COLT1', '6012')], strips: [strip('f1')], tracks });
  reconciler.tick();
  tracks[0] = track(8, 'HAWG21', 6012);
  reconciler.tick();
  const rec = store.getCorrelation('f1');
  assert.equal(rec.state, 'UNCORRELATED');
  assert.equal(rec.warning.kind, 'CODE_REISSUED');
});

test('the original AI aircraft coming back with its code correlates again', () => {
  const tracks = [track(7, 'COLT11', 6012)];
  const { reconciler, store } = build({ flightDataList: [flightData('f1', 'COLT1', '6012')], strips: [strip('f1')], tracks });
  reconciler.tick();
  tracks.length = 0;
  reconciler.tick(); // out of everyone's picture for a moment (the track store dropped it)
  tracks.push(track(7, 'COLT11', 6012));
  reconciler.tick();
  assert.equal(store.getCorrelation('f1').trackId, '7');
  assert.equal(store.getCorrelation('f1').state, 'CORRELATED');
});

test('after a re-mint, binding the new aircraft settles it, and an unbind leaves the beacon match on it', () => {
  const tracks = [track(7, 'COLT11', 6012)];
  const { reconciler, store } = build({ flightDataList: [flightData('f1', 'COLT1', '6012')], strips: [strip('f1')], tracks });
  reconciler.tick();
  tracks[0] = track(8, 'HAWG21', 6012);
  reconciler.tick();
  assert.equal(store.getCorrelation('f1').warning.kind, 'CODE_REISSUED');

  store.apply({ flightDataId: 'f1', baseRev: store.getCorrelation('f1').rev, op: { kind: 'BindTrack', trackId: '8' } }, 'AP', 'c');
  reconciler.tick();
  assert.equal(store.getCorrelation('f1').matchedBy, 'BINDING');
  assert.equal(store.getCorrelation('f1').trackId, '8');

  store.apply({ flightDataId: 'f1', baseRev: store.getCorrelation('f1').rev, op: { kind: 'UnbindTrack' } }, 'AP', 'c');
  reconciler.tick();
  const rec = store.getCorrelation('f1');
  assert.equal(rec.matchedBy, 'BEACON', 'the controller chose aircraft 8, so its code is now this Strip\'s');
  assert.equal(rec.trackId, '8');
});

test('after a re-mint, entering another code (the aircraft the controller means) correlates on it', () => {
  const flightDataList = [flightData('f1', 'COLT1', '6012')];
  const tracks = [track(7, 'COLT11', 6012)];
  const { reconciler, store } = build({ flightDataList, strips: [strip('f1')], tracks });
  reconciler.tick();
  tracks[0] = track(8, 'HAWG21', 6012);
  tracks.push(track(9, 'COLT11', 6030)); // COLT11 respawned with a new code
  reconciler.tick();
  assert.equal(store.getCorrelation('f1').warning.kind, 'CODE_REISSUED');

  flightDataList[0] = flightData('f1', 'COLT1', '6030');
  reconciler.tick();
  assert.equal(store.getCorrelation('f1').trackId, '9');
  assert.equal(store.getCorrelation('f1').matchedBy, 'BEACON');

  // And changing it back to 6012 is a fresh choice: the controller is pointing at aircraft 8 now.
  flightDataList[0] = flightData('f1', 'COLT1', '6012');
  reconciler.tick();
  assert.equal(store.getCorrelation('f1').trackId, '8');
});

test('a discrete (non-synthetic) code is acquired by whichever aircraft squawks it (H135, unchanged)', () => {
  const tracks = [track(1, 'VIPER11', 41)];
  const { reconciler, store } = build({ flightDataList: [flightData('f1', 'VIPER1', '0041')], strips: [strip('f1')], tracks });
  reconciler.tick();
  tracks[0] = track(2, 'VIPER11', 41);
  reconciler.tick();
  assert.equal(store.getCorrelation('f1').trackId, '2');
  assert.equal(store.getCorrelation('f1').matchedBy, 'BEACON');
});

test('two contacts on one synthetic code are ambiguous (TRK ×2), never guessed', () => {
  // A player can dial an AI's code by hand: the reserved block is ours, not the cockpit's.
  const { reconciler, store } = build({
    flightDataList: [flightData('f1', 'COLT1', '6012')], strips: [strip('f1')],
    tracks: [track(7, 'COLT11', 6012), track(8, 'PLAYER', 6012)],
  });
  reconciler.tick();
  const rec = store.getCorrelation('f1');
  assert.equal(rec.warning.kind, 'AMBIGUOUS_BEACON');
  assert.deepEqual(rec.warning.candidateTrackIds.sort(), ['7', '8']);
});

test('a mission reload forgets which AI aircraft held a synthetic code', () => {
  const tracks = [track(7, 'COLT11', 6012)];
  const { reconciler, store } = build({ flightDataList: [flightData('f1', 'COLT1', '6012')], strips: [strip('f1')], tracks });
  reconciler.tick();
  reconciler.resetPicture('MISSION_RELOAD');
  tracks[0] = track(80, 'COLT11', 6012); // every id re-minted
  reconciler.tick();
  assert.equal(store.getCorrelation('f1').trackId, '80');
});
