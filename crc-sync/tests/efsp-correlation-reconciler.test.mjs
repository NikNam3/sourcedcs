import test from 'node:test';
import assert from 'node:assert/strict';

/* The correlation sweep (guide §6.6 rules 1 and 6).
 *
 * Three things here are worth more than the rest:
 *   - the ordered claim sweep, so a higher rung always claims a contact
 *     before a lower one and one contact never correlates to two flights;
 *   - the eligibility EXCLUSION list, with a test that forces a decision
 *     whenever a new EfspState is added (docs/adr/0041's lesson);
 *   - the §10.3 ring fence: nothing in here may move a Strip.
 */

const { CorrelationReconciler, computeCorrelationRate, INELIGIBLE_STATES } =
  await import('../src/efsp/correlation-reconciler.js');
const { CorrelationStore } = await import('../src/efsp/correlation-store.js');
const { STATES_BY_ROLE } = await import('../src/efsp/nla.js');

// ── harness ────────────────────────────────────────────────────────────────

function fakeTrackStore(tracks) {
  return { getAll: () => tracks };
}

/** An FdrStore stand-in: just identity, plus the observed-code setter. */
function fakeFdrStore(fdrs) {
  const observed = new Map();
  return {
    getAll: () => fdrs,
    getFdr: (id) => fdrs.find(f => f.fdrId === id) || null,
    setBeaconObserved: (id, code) => { observed.set(id, code); return { ok: true, changed: true }; },
    observed,
  };
}

function fdr(fdrId, callsign, beaconAssigned) {
  return { fdrId, identity: { callsign, beaconAssigned } };
}

function strip(fdrId, state = 'AIRBORNE') {
  return { stripId: `s-${fdrId}`, fdrId, state };
}

function track(id, callsign, squawk = null) {
  return { id, callsign, squawk, category: 1, lat: 37, lon: 35, alt: 6000 };
}

function build({ fdrs = [], strips = [], tracks = [] } = {}) {
  const fdrStore = fakeFdrStore(fdrs);
  const store = new CorrelationStore({ fdrExists: (id) => !!fdrStore.getFdr(id) });
  const deltas = [];
  const reconciler = new CorrelationReconciler({
    trackStore: fakeTrackStore(tracks),
    fdrStore,
    correlationStore: store,
    boardStoreFor: (facilityId) => (facilityId === 'INCIRLIK' ? { getAll: () => strips } : { getAll: () => [] }),
    facilityConfig: { getFacilityIds: () => ['INCIRLIK', 'CENTER'] },
    onDelta: (payload) => deltas.push(payload),
  });
  return { reconciler, store, fdrStore, deltas };
}

// ── the rate ───────────────────────────────────────────────────────────────

test('computeCorrelationRate counts a provisional match as matched — §6.6 measured "matched at all"', () => {
  const rate = computeCorrelationRate([
    { state: 'CORRELATED' }, { state: 'PROVISIONAL' }, { state: 'UNCORRELATED' }, { state: 'CORRELATED' },
  ]);
  assert.equal(rate.eligible, 4);
  assert.equal(rate.correlated, 2);
  assert.equal(rate.provisional, 1);
  assert.equal(rate.rate, 0.75);
});

test('an empty board reports null, never 1.0 — otherwise the 95% gate passes vacuously', () => {
  assert.equal(computeCorrelationRate([]).rate, null);
  assert.equal(computeCorrelationRate(null).rate, null);
});

// ── eligibility ────────────────────────────────────────────────────────────

test('every EfspState is either on the ineligible list or eligible — adding one forces the decision', () => {
  // docs/adr/0041's lesson: an inclusion list would let a state added in WP6
  // or WP7 silently leave the denominator, and the rate would silently RISE.
  // With an exclusion list a new state defaults to eligible, so the rate FALLS
  // and somebody notices. This assertion is what makes that a decision rather
  // than a default.
  const all = new Set();
  for (const states of Object.values(STATES_BY_ROLE)) for (const s of states) all.add(s);
  assert.ok(all.size > 10, 'sanity: the state sets loaded');
  for (const state of INELIGIBLE_STATES) {
    assert.ok(all.has(state), `${state} is on the ineligible list but is not an EfspState any more`);
  }
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

test('one eligible Strip is enough, even beside an ineligible one on the same FDR', () => {
  assert.equal(CorrelationReconciler.isEligible([strip('f', 'PROPOSED'), strip('f', 'AIRBORNE')]), true);
});

test('an FDR with no live Strip at all is not swept', () => {
  const { reconciler, store } = build({
    fdrs: [fdr('f1', 'VIPER1', '0041')], strips: [], tracks: [track(1, 'VIPER1', 41)],
  });
  reconciler.tick();
  assert.equal(store.getCorrelation('f1'), null);
});

// ── the ladder ─────────────────────────────────────────────────────────────

test('an explicit binding outranks everything the sweep could work out', () => {
  const { reconciler, store } = build({
    fdrs: [fdr('f1', 'VIPER1', '0041')],
    strips: [strip('f1')],
    // Contact 1 squawks the assigned code and answers to the callsign; the
    // controller has bound contact 2 anyway, because they can see it.
    tracks: [track(1, 'VIPER1', 41), track(2, 'UNKNOWN', null)],
  });
  store.apply({ fdrId: 'f1', baseRev: 0, op: { kind: 'BindTrack', trackId: '2' } }, 'APP', 'c');
  reconciler.tick();
  const record = store.getCorrelation('f1');
  assert.equal(record.matchedBy, 'BINDING');
  assert.equal(record.trackId, '2');
});

test('a binding to a contact that no longer exists lets the lower rungs have a go', () => {
  const { reconciler, store } = build({
    fdrs: [fdr('f1', 'VIPER1', '0041')], strips: [strip('f1')], tracks: [track(1, 'VIPER1', 41)],
  });
  store.apply({ fdrId: 'f1', baseRev: 0, op: { kind: 'BindTrack', trackId: '999' } }, 'APP', 'c');
  reconciler.tick();
  const record = store.getCorrelation('f1');
  assert.equal(record.matchedBy, 'BEACON');
  assert.equal(record.trackId, '1');
});

test('the assigned beacon code correlates, and the observed code is pushed onto the FDR', () => {
  const { reconciler, store, fdrStore } = build({
    fdrs: [fdr('f1', 'VIPER1', '0041')], strips: [strip('f1')], tracks: [track(1, 'SOMETHINGELSE', 41)],
  });
  reconciler.tick();
  const record = store.getCorrelation('f1');
  assert.equal(record.state, 'CORRELATED');
  assert.equal(record.matchedBy, 'BEACON');
  assert.equal(record.observedBeacon, '0041');
  assert.equal(fdrStore.observed.get('f1'), '0041', '§3.10.2 rule 1 has real data behind it');
});

test('an exact callsign match correlates when no beacon evidence contradicts it', () => {
  const { reconciler, store } = build({
    fdrs: [fdr('f1', 'VIPER1', '0041')], strips: [strip('f1')], tracks: [track(1, 'VIPER1', null)],
  });
  reconciler.tick();
  const record = store.getCorrelation('f1');
  assert.equal(record.matchedBy, 'CALLSIGN_EXACT');
  assert.equal(record.state, 'CORRELATED');
});

test('an exact callsign match is only provisional when the contact squawks a different code', () => {
  // The name agrees and the transponder does not. That is real evidence
  // against the identity, and §3.10.2 rule 1 exists so a controller can see it.
  const { reconciler, store } = build({
    fdrs: [fdr('f1', 'VIPER1', '0041')], strips: [strip('f1')], tracks: [track(1, 'VIPER1', 56)],
  });
  reconciler.tick();
  const record = store.getCorrelation('f1');
  assert.equal(record.matchedBy, 'CALLSIGN_EXACT');
  assert.equal(record.state, 'PROVISIONAL');
  assert.equal(record.observedBeacon, '0056');
});

test('a formation match is fuzzy and always provisional, with its confidence', () => {
  const { reconciler, store } = build({
    fdrs: [fdr('f1', 'VIPER1', '0041')], strips: [strip('f1')], tracks: [track(1, 'VIPER11', null)],
  });
  reconciler.tick();
  const record = store.getCorrelation('f1');
  assert.equal(record.matchedBy, 'CALLSIGN_FUZZY');
  assert.equal(record.state, 'PROVISIONAL');
  assert.equal(record.confidence, 0.9);
});

test('nothing matching raises TRACK_LOST rather than leaving the record silent', () => {
  const { reconciler, store } = build({
    fdrs: [fdr('f1', 'VIPER1', '0041')], strips: [strip('f1')], tracks: [track(1, 'HORNET1', 77)],
  });
  reconciler.tick();
  const record = store.getCorrelation('f1');
  assert.equal(record.state, 'UNCORRELATED');
  assert.equal(record.warning.kind, 'TRACK_LOST');
});

// ── the ordered claim sweep ────────────────────────────────────────────────

test('the beacon rung claims first, so the callsign rung gets the contact that is left', () => {
  // This assertion is what pays for sweeping in rung order rather than
  // resolving each FDR independently.
  const { reconciler, store } = build({
    fdrs: [fdr('f1', 'VIPER1', '0041'), fdr('f2', 'VIPER1', '0042')],
    strips: [strip('f1'), strip('f2')],
    tracks: [track(1, 'VIPER1', null), track(2, 'VIPER1', 42)],
  });
  reconciler.tick();
  // f2's code is observed on contact 2, so f2 claims it on the beacon rung;
  // f1 then has exactly one VIPER1 left and takes it on the callsign rung.
  assert.equal(store.getCorrelation('f2').trackId, '2');
  assert.equal(store.getCorrelation('f2').matchedBy, 'BEACON');
  assert.equal(store.getCorrelation('f1').trackId, '1');
  assert.equal(store.getCorrelation('f1').matchedBy, 'CALLSIGN_EXACT');
});

test('one contact never correlates to two flights', () => {
  const { reconciler, store } = build({
    fdrs: [fdr('f1', 'VIPER1', '0041'), fdr('f2', 'VIPER1', '0042')],
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
    fdrs: [fdr('f1', 'VIPER1', '0041')], strips: [strip('f1')],
    tracks: [track(1, 'SOMEONE', 41), track(2, 'SOMEONEELSE', 41)],
  });
  reconciler.tick();
  const record = store.getCorrelation('f1');
  assert.equal(record.state, 'UNCORRELATED');
  assert.equal(record.warning.kind, 'AMBIGUOUS_BEACON');
  assert.deepEqual(record.warning.candidateTrackIds.sort(), ['1', '2']);
  assert.match(record.warning.detail, /bind one/, 'and the way out is rung 1');
});

test('two contacts answering a callsign equally well is ambiguous too', () => {
  const { reconciler, store } = build({
    fdrs: [fdr('f1', 'VIPER1', '0041')], strips: [strip('f1')],
    tracks: [track(1, 'VIPER1', null), track(2, 'VIPER1', null)],
  });
  reconciler.tick();
  const record = store.getCorrelation('f1');
  assert.equal(record.warning.kind, 'AMBIGUOUS_CALLSIGN');
  assert.deepEqual(record.warning.candidateTrackIds.sort(), ['1', '2']);
});

test('a better fuzzy match wins outright rather than being called ambiguous', () => {
  const { reconciler, store } = build({
    fdrs: [fdr('f1', 'VIPER1', '0041')], strips: [strip('f1')],
    // VIPER11 is formation numbering (0.9); VIPER2 is same-stem (0.7).
    tracks: [track(1, 'VIPER11', null), track(2, 'VIPER2', null)],
  });
  reconciler.tick();
  assert.equal(store.getCorrelation('f1').trackId, '1');
  assert.equal(store.getCorrelation('f1').confidence, 0.9);
});

// ── broadcasting ───────────────────────────────────────────────────────────

test('onDelta fires once per tick, with only the records that changed', () => {
  const { reconciler, deltas } = build({
    fdrs: [fdr('f1', 'VIPER1', '0041'), fdr('f2', 'HORNET1', '0042')],
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
    fdrs: [fdr('f1', 'VIPER1', '0041')], strips: [strip('f1')], tracks: [track(1, 'VIPER1', 41)],
  });
  reconciler.tick();
  assert.equal(deltas.length, 1);
  reconciler.tick();
  assert.equal(deltas.length, 1, 'nothing changed, so nothing was sent');
});

test('one flight changing does not drag every other record into the delta', () => {
  const { reconciler, deltas, store } = build({
    fdrs: [fdr('f1', 'VIPER1', '0041'), fdr('f2', 'HORNET1', '0042')],
    strips: [strip('f1'), strip('f2')],
    tracks: [track(1, 'VIPER1', 41), track(2, 'HORNET1', 42)],
  });
  reconciler.tick();
  deltas.length = 0;

  // Re-bind f1 only, by hand, then tick: f2 is untouched.
  store.apply({ fdrId: 'f1', baseRev: store.getCorrelation('f1').rev, op: { kind: 'BindTrack', trackId: '1' } }, 'APP', 'c');
  reconciler.tick();
  assert.equal(deltas.length, 0, 'the binding agreed with the sweep, so the sweep changed nothing');
});

// ── the rate, reported ─────────────────────────────────────────────────────

test('the rate is reported, and accumulates across ticks for a session figure', () => {
  const { reconciler } = build({
    fdrs: [fdr('f1', 'VIPER1', '0041'), fdr('f2', 'HORNET1', '0042'), fdr('f3', 'EAGLE1', '0043')],
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
    fdrs: [fdr('f1', 'VIPER1', '0041'), fdr('f2', 'HORNET1', '0042')],
    strips: [strip('f1'), strip('f2')],
    tracks: [track(1, 'VIPER1', 41), track(9, 'MYSTERY', null)],
  });
  assert.ok(reconciler.tick().stats.rate < 1);
  store.apply({ fdrId: 'f2', baseRev: store.getCorrelation('f2').rev, op: { kind: 'BindTrack', trackId: '9' } }, 'APP', 'c');
  assert.equal(reconciler.tick().stats.rate, 1);
});

test('a ramp-bound departure is not eligible and does not drag the rate down', () => {
  const { reconciler } = build({
    fdrs: [fdr('f1', 'VIPER1', '0041'), fdr('f2', 'HORNET1', '0042')],
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
    fdrs: [fdr('f1', 'VIPER1', '0041')], strips: [strip('f1')], tracks,
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
    fdrs: [fdr('f1', 'VIPER1', '0041')], strips: [strip('f1')], tracks: [track(101, 'VIPER1', 41)],
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
    fdrs: [fdr('f1', 'VIPER1', '0041')], strips, tracks: [track(1, 'VIPER1', 41)],
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
    fdrs: [fdr('f1', 'VIPER1', '0041')], strips, tracks: [track(1, 'VIPER1', 41)],
  });
  reconciler.tick();
  assert.equal(store.getCorrelation('f1').state, 'CORRELATED', 'it correlates...');
  assert.deepEqual(strips, before, '...and moves nothing');
});
