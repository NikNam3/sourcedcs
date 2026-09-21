import test from 'node:test';
import assert from 'node:assert/strict';

/* The correlation record (guide §6.6 rules 2 and 3).
 *
 * Two properties carry most of the weight here, and neither is obvious from
 * the code alone:
 *
 *   - the warning RETRACTS, because it is a field on a record that arrives
 *     whole in every delta rather than a fire-and-forget alert;
 *   - and nothing is erased when it does — transitions[] holds the raise and
 *     the retraction both (FAA JO 7110.65 para 2-3-1).
 */

const { CorrelationStore, MATCH_KEYS } = await import('../src/efsp/correlation-store.js');
const { MAX_FREE_TEXT } = await import('../src/efsp/fdr-store.js');

const FDR = 'fdr-1';

function store({ fdrs = [FDR] } = {}) {
  return new CorrelationStore({ fdrExists: (id) => fdrs.includes(id) });
}

function bind(s, { fdrId = FDR, trackId = '101', note, baseRev } = {}) {
  const current = s.getCorrelation(fdrId);
  return s.apply({
    clientMutationId: `m-${Math.random()}`,
    fdrId,
    baseRev: baseRev !== undefined ? baseRev : (current ? current.rev : 0),
    op: { kind: 'BindTrack', trackId, note },
  }, 'APP', 'controller-1');
}

function resolvedTo(trackId, matchedBy, state, extra = {}) {
  return { trackId, matchedBy, state, ...extra };
}

// ── shape ──────────────────────────────────────────────────────────────────

test('a record is minted on first ask, uncorrelated and with no history', () => {
  const s = store();
  const record = s.getCorrelation(FDR);
  assert.equal(record, null, 'nothing exists until something asks');

  s.reconcile(new Map([[FDR, null]]));
  const seeded = s.getCorrelation(FDR);
  assert.equal(seeded.state, 'UNCORRELATED');
  assert.equal(seeded.trackId, null);
  assert.deepEqual(seeded.transitions, []);
});

test('the record carries its own rev, independent of any Strip or FDR', () => {
  const s = store();
  bind(s);
  assert.equal(s.getCorrelation(FDR).rev, 1);
  bind(s, { trackId: '102' });
  assert.equal(s.getCorrelation(FDR).rev, 2);
});

// ── controller ops ─────────────────────────────────────────────────────────

test('BindTrack is rung 1: it correlates, records who bound it, and clears any warning', () => {
  const s = store();
  s.reconcile(new Map([[FDR, { warning: { kind: 'TRACK_LOST' } }]]));
  assert.ok(s.getCorrelation(FDR).warning);

  const result = bind(s, { trackId: '101', note: 'visual on him' });
  assert.equal(result.ok, true);
  const record = s.getCorrelation(FDR);
  assert.equal(record.state, 'CORRELATED');
  assert.equal(record.matchedBy, 'BINDING');
  assert.equal(record.trackId, '101');
  assert.equal(record.warning, null);
  assert.equal(record.binding.boundBy, 'controller-1');
  assert.equal(record.binding.boundPositionId, 'APP');
  assert.equal(record.binding.note, 'visual on him');
});

test('BindTrack without a trackId is refused', () => {
  const s = store();
  const result = s.apply({ clientMutationId: 'm', fdrId: FDR, baseRev: 0, op: { kind: 'BindTrack' } }, 'APP', 'c');
  assert.equal(result.ok, false);
  assert.match(result.detail, /needs a trackId/);
});

test('UnbindTrack drops to uncorrelated rather than guessing a lower rung', () => {
  // The next reconcile tick is a second away and is the thing that knows what
  // the live picture holds. A stale trackId left behind would be the silent
  // break rule 3 forbids.
  const s = store();
  bind(s);
  const result = s.apply({
    clientMutationId: 'm2', fdrId: FDR, baseRev: s.getCorrelation(FDR).rev, op: { kind: 'UnbindTrack' },
  }, 'APP', 'controller-1');
  assert.equal(result.ok, true);
  const record = s.getCorrelation(FDR);
  assert.equal(record.state, 'UNCORRELATED');
  assert.equal(record.trackId, null);
  assert.equal(record.binding, null);
});

test('UnbindTrack with nothing bound is refused', () => {
  const s = store();
  s.reconcile(new Map([[FDR, null]]));
  const result = s.apply({
    clientMutationId: 'm', fdrId: FDR, baseRev: s.getCorrelation(FDR).rev, op: { kind: 'UnbindTrack' },
  }, 'APP', 'c');
  assert.equal(result.ok, false);
  assert.match(result.detail, /nothing is explicitly bound/);
});

test('an unknown op kind and an unknown FDR are both refused, not thrown', () => {
  const s = store();
  assert.equal(s.apply({ fdrId: FDR, op: { kind: 'Nope' } }, 'APP', 'c').reason, 'VALIDATION_ERROR');
  assert.equal(s.apply({ fdrId: 'ghost', op: { kind: 'BindTrack', trackId: '1' } }, 'APP', 'c').reason, 'NOT_FOUND');
  assert.equal(s.apply({ op: { kind: 'BindTrack', trackId: '1' } }, 'APP', 'c').reason, 'VALIDATION_ERROR');
});

test('a stale baseRev is refused, and the refusal still carries the current record', () => {
  const s = store();
  bind(s);
  const result = bind(s, { trackId: '999', baseRev: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'STALE_REV');
  assert.equal(result.correlation.trackId, '101', 'so the client renders truth, not its own guess');
});

test('every result carries the record, success or failure', () => {
  const s = store();
  assert.ok(bind(s).correlation);
  assert.ok(s.apply({ fdrId: FDR, baseRev: 0, op: { kind: 'Nope' } }, 'APP', 'c').correlation);
});

test('a binding note is capped at the free-text ceiling that rides every broadcast', () => {
  const s = store();
  bind(s, { note: 'x'.repeat(MAX_FREE_TEXT + 500) });
  assert.equal(s.getCorrelation(FDR).binding.note.length, MAX_FREE_TEXT);
});

// ── the audit trail ────────────────────────────────────────────────────────

test('a controller op is logged against its FDR, and a REFUSAL is logged too', () => {
  const entries = [];
  const s = store();
  s.setMutationLog({ record: (e) => entries.push(e) });

  bind(s, { trackId: '101' });
  s.apply({ clientMutationId: 'bad', fdrId: FDR, baseRev: 0, op: { kind: 'BindTrack', trackId: '9' } }, 'APP', 'c');

  assert.equal(entries.length, 2);
  assert.equal(entries[0].fdrId, FDR);
  assert.equal(entries[0].op, 'BindTrack');
  assert.equal(entries[0].actingPositionId, 'APP');
  assert.equal(entries[0].ok, true);
  assert.equal(entries[0].stripId, undefined, 'a correlation op targets no Strip');
  assert.equal(entries[1].ok, false);
  assert.equal(entries[1].reason, 'STALE_REV');
});

test('reconciler changes are NOT logged — at a tick a second they would drown it', () => {
  const entries = [];
  const s = store();
  s.setMutationLog({ record: (e) => entries.push(e) });
  s.reconcile(new Map([[FDR, resolvedTo('101', 'BEACON', 'CORRELATED')]]));
  s.reconcile(new Map([[FDR, null]]));
  assert.equal(entries.length, 0, 'where it has BEEN lives in transitions[] instead');
});

// ── reconcile ──────────────────────────────────────────────────────────────

test('a first match correlates and records why', () => {
  const s = store();
  const { changed } = s.reconcile(new Map([[FDR, resolvedTo('101', 'BEACON', 'CORRELATED', { observedBeacon: '0041' })]]));
  assert.equal(changed.length, 1);
  const record = s.getCorrelation(FDR);
  assert.equal(record.state, 'CORRELATED');
  assert.equal(record.matchedBy, 'BEACON');
  assert.equal(record.observedBeacon, '0041');
  assert.equal(record.transitions.length, 1);
  assert.equal(record.transitions[0].reason, 'FIRST_MATCH');
});

test('an unchanged match produces no change and no transition — the tick is quiet', () => {
  const s = store();
  const resolution = new Map([[FDR, resolvedTo('101', 'BEACON', 'CORRELATED')]]);
  s.reconcile(resolution);
  const { changed } = s.reconcile(new Map([[FDR, resolvedTo('101', 'BEACON', 'CORRELATED')]]));
  assert.deepEqual(changed, []);
  assert.equal(s.getCorrelation(FDR).transitions.length, 1, 'appended on change only, never per tick');
});

test('a track identity change re-binds and records both ids — the named defect class', () => {
  const s = store();
  s.reconcile(new Map([[FDR, resolvedTo('101', 'BEACON', 'CORRELATED')]]));
  const { changed } = s.reconcile(new Map([[FDR, resolvedTo('500', 'BEACON', 'CORRELATED')]]));

  assert.equal(changed.length, 1);
  const record = s.getCorrelation(FDR);
  assert.equal(record.trackId, '500');
  const last = record.transitions[record.transitions.length - 1];
  assert.equal(last.reason, 'REBOUND_ON_BEACON');
  assert.equal(last.fromTrackId, '101', 'the identity change is legible in one line');
});

test('a re-bind on the callsign rung is recorded as such', () => {
  const s = store();
  s.reconcile(new Map([[FDR, resolvedTo('101', 'CALLSIGN_EXACT', 'CORRELATED')]]));
  s.reconcile(new Map([[FDR, resolvedTo('500', 'CALLSIGN_EXACT', 'CORRELATED')]]));
  const record = s.getCorrelation(FDR);
  assert.equal(record.transitions[record.transitions.length - 1].reason, 'REBOUND_ON_CALLSIGN');
});

test('losing the match drops the state and raises a warning — never silent', () => {
  const s = store();
  s.reconcile(new Map([[FDR, resolvedTo('101', 'BEACON', 'CORRELATED')]]));
  const { changed } = s.reconcile(new Map([[FDR, { warning: { kind: 'TRACK_LOST', detail: 'nothing matches' } }]]));

  assert.equal(changed.length, 1);
  const record = s.getCorrelation(FDR);
  assert.equal(record.state, 'UNCORRELATED');
  assert.equal(record.trackId, null);
  assert.equal(record.warning.kind, 'TRACK_LOST');
  assert.equal(record.warning.lostTrackId, '101');
  assert.equal(record.transitions[record.transitions.length - 1].reason, 'TRACK_GONE');
});

test('a provisional match is carried as such, with its confidence', () => {
  const s = store();
  s.reconcile(new Map([[FDR, resolvedTo('101', 'CALLSIGN_FUZZY', 'PROVISIONAL', { confidence: 0.9 })]]));
  const record = s.getCorrelation(FDR);
  assert.equal(record.state, 'PROVISIONAL');
  assert.equal(record.confidence, 0.9);
});

test('the same contact moving to a weaker rung is a degradation, and to a stronger one a promotion', () => {
  const s = store();
  s.reconcile(new Map([[FDR, resolvedTo('101', 'BEACON', 'CORRELATED')]]));
  s.reconcile(new Map([[FDR, resolvedTo('101', 'CALLSIGN_EXACT', 'PROVISIONAL')]]));
  assert.equal(s.getCorrelation(FDR).transitions.at(-1).reason, 'DEGRADED');
  s.reconcile(new Map([[FDR, resolvedTo('101', 'BEACON', 'CORRELATED')]]));
  assert.equal(s.getCorrelation(FDR).transitions.at(-1).reason, 'PROMOTED');
  assert.ok(MATCH_KEYS.indexOf('BEACON') < MATCH_KEYS.indexOf('CALLSIGN_EXACT'));
});

test('an observed code change alone is broadcast, because a controller can see it', () => {
  // §3.10.2 rule 1's assigned-vs-observed comparison is rendered from this.
  const s = store();
  s.reconcile(new Map([[FDR, resolvedTo('101', 'CALLSIGN_EXACT', 'CORRELATED', { observedBeacon: '0041' })]]));
  const { changed } = s.reconcile(new Map([[FDR, resolvedTo('101', 'CALLSIGN_EXACT', 'CORRELATED', { observedBeacon: '0056' })]]));
  assert.equal(changed.length, 1);
  assert.equal(s.getCorrelation(FDR).observedBeacon, '0056');
});

// ── the retraction, which is the point ─────────────────────────────────────

test('the warning retracts on the next match, and both the raise and the retraction stay in the history', () => {
  const s = store();
  s.reconcile(new Map([[FDR, resolvedTo('101', 'BEACON', 'CORRELATED')]]));
  s.reconcile(new Map([[FDR, { warning: { kind: 'TRACK_IDENTITY_LOST' } }]]));
  assert.ok(s.getCorrelation(FDR).warning, 'raised');

  const { changed } = s.reconcile(new Map([[FDR, resolvedTo('500', 'BEACON', 'CORRELATED')]]));

  const record = s.getCorrelation(FDR);
  assert.equal(record.warning, null, 'the display clears...');
  assert.equal(changed.length, 1, '...and the client is told, with no new mechanism');

  const reasons = record.transitions.map(t => t.reason);
  assert.deepEqual(reasons, ['FIRST_MATCH', 'TRACK_GONE', 'REBOUND_ON_BEACON'],
    '...while the record keeps both. Nothing is erased.');
});

test('a warning retracted without the contact changing is still broadcast', () => {
  const s = store();
  s.reconcile(new Map([[FDR, resolvedTo('101', 'BEACON', 'CORRELATED')]]));
  s.reconcile(new Map([[FDR, { warning: { kind: 'TRACK_LOST' } }]]));
  const { changed } = s.reconcile(new Map([[FDR, resolvedTo('101', 'BEACON', 'CORRELATED')]]));
  assert.equal(changed.length, 1);
  assert.equal(s.getCorrelation(FDR).warning, null);
});

test('an ambiguous resolution is recorded as ambiguity, with the candidates', () => {
  const s = store();
  const { changed } = s.reconcile(new Map([[FDR, {
    warning: { kind: 'AMBIGUOUS_CALLSIGN', candidateTrackIds: ['101', '102'] },
  }]]));
  assert.equal(changed.length, 1);
  const record = s.getCorrelation(FDR);
  assert.equal(record.state, 'UNCORRELATED');
  assert.deepEqual(record.warning.candidateTrackIds, ['101', '102']);
  assert.equal(record.transitions.at(-1).reason, 'AMBIGUOUS');
});

test('a warning detail is capped like every other string that rides a broadcast', () => {
  const s = store();
  s.reconcile(new Map([[FDR, { warning: { kind: 'TRACK_LOST', detail: 'y'.repeat(MAX_FREE_TEXT + 100) } }]]));
  assert.equal(s.getCorrelation(FDR).warning.detail.length, MAX_FREE_TEXT);
});

// ── mission reload ─────────────────────────────────────────────────────────

test('resetPicture drops every record AND its binding, naming why', () => {
  const s = store({ fdrs: [FDR, 'fdr-2'] });
  bind(s, { trackId: '101' });
  s.reconcile(new Map([['fdr-2', resolvedTo('202', 'BEACON', 'CORRELATED')]]));

  const { changed } = s.resetPicture('MISSION_RELOAD');
  assert.equal(changed.length, 2);

  const bound = s.getCorrelation(FDR);
  assert.equal(bound.state, 'UNCORRELATED');
  assert.equal(bound.binding, null, 'the binding named a contact that provably no longer exists');
  assert.equal(bound.warning.kind, 'TRACK_IDENTITY_LOST');
  assert.match(bound.warning.detail, /every track id was re-minted/);
  assert.equal(bound.transitions.at(-1).reason, 'MISSION_RELOAD');
  assert.equal(bound.transitions.at(-1).fromTrackId, '101');
});

test('resetPicture leaves an already-uncorrelated record alone rather than churning it', () => {
  const s = store();
  s.reconcile(new Map([[FDR, null]]));
  const { changed } = s.resetPicture('MISSION_RELOAD');
  assert.deepEqual(changed, []);
});

test('after a reset, the next tick re-binds on the beacon — warn, then re-bind', () => {
  // §6.6 rule 3 permits exactly two outcomes on an identity change. This does
  // both, in order, within one tick of each other.
  const s = store();
  s.reconcile(new Map([[FDR, resolvedTo('101', 'BEACON', 'CORRELATED')]]));
  s.resetPicture('MISSION_RELOAD');
  s.reconcile(new Map([[FDR, resolvedTo('500', 'BEACON', 'CORRELATED')]]));

  const record = s.getCorrelation(FDR);
  assert.equal(record.state, 'CORRELATED');
  assert.equal(record.trackId, '500');
  assert.equal(record.warning, null);
  assert.equal(record.transitions.at(-1).reason, 'REBOUND_ON_BEACON');
});

// ── lookup and lifecycle ───────────────────────────────────────────────────

test('fdrForTrack answers the reverse question the client asks on a map click', () => {
  const s = store({ fdrs: [FDR, 'fdr-2'] });
  s.reconcile(new Map([[FDR, resolvedTo('101', 'BEACON', 'CORRELATED')]]));
  assert.equal(s.fdrForTrack('101'), FDR);
  assert.equal(s.fdrForTrack(101), FDR, 'a numeric id works too');
  assert.equal(s.fdrForTrack('999'), null);
});

test('a record whose FDR is gone is evicted — FDR lifecycle governs correlation lifecycle', () => {
  const fdrs = [FDR];
  const s = new CorrelationStore({ fdrExists: (id) => fdrs.includes(id) });
  s.reconcile(new Map([[FDR, resolvedTo('101', 'BEACON', 'CORRELATED')]]));
  assert.equal(s.getAll().length, 1);
  fdrs.length = 0;
  assert.equal(s.evictMissingFdrs(), 1);
  assert.equal(s.getAll().length, 0);
});

// ── persistence ────────────────────────────────────────────────────────────

test('restore keeps the history but never the contact — a persisted track id is a lie after a restart', () => {
  const s = store();
  bind(s, { trackId: '101', note: 'visual' });
  const snapshot = s.snapshot();
  assert.equal(snapshot[0].trackId, '101', 'the snapshot itself is a faithful record');

  const restored = store();
  restored.restore(snapshot);
  const record = restored.getCorrelation(FDR);
  assert.equal(record.state, 'UNCORRELATED');
  assert.equal(record.trackId, null);
  assert.equal(record.binding, null, 'the explicit binding does not survive a restart');
  assert.equal(record.observedBeacon, null);
  assert.ok(record.transitions.length > 0, 'but that it happened is preserved');
  assert.equal(record.transitions[0].reason, 'EXPLICIT_BIND');
});

test('restore skips a record whose FDR is gone', () => {
  const s = store();
  bind(s);
  const snapshot = s.snapshot();
  const restored = new CorrelationStore({ fdrExists: () => false });
  restored.restore(snapshot);
  assert.equal(restored.getAll().length, 0);
});

test('snapshot omits a record whose FDR has already gone', () => {
  const fdrs = [FDR];
  const s = new CorrelationStore({ fdrExists: (id) => fdrs.includes(id) });
  bind(s);
  fdrs.length = 0;
  assert.deepEqual(s.snapshot(), []);
});

test('restore copes with junk rather than throwing', () => {
  const s = store();
  s.restore(null);
  s.restore([null, {}, { fdrId: 'ghost' }]);
  assert.equal(s.getAll().length, 0);
});
