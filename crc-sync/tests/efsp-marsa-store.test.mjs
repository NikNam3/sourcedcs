import test from 'node:test';
import assert from 'node:assert/strict';

import { MarsaStore, MARSA_EXPANSION, MIN_PARTICIPANTS } from '../src/efsp/marsa-store.js';

// Unit tests for the relation itself (WP6, §9.2, docs/adr/0051). The
// end-to-end walk — a clearance issued to a joining receiver, and every
// participant Strip carrying the alert — lives in efsp-scenario-marsa.test.mjs,
// because §13's acceptance criterion is about what happens when a controller
// presses a Block, not about what this class does when called directly.

const TANKER = 'fdr-shell71';
const RX1 = 'fdr-viper11';
const RX2 = 'fdr-viper12';
const OUTSIDER = 'fdr-hawg01';

function makeStore({ known = [TANKER, RX1, RX2, OUTSIDER] } = {}) {
  const regimes = new Map();
  const store = new MarsaStore({
    fdrExists: (fdrId) => known.includes(fdrId),
    setSeparationRegime: (fdrId, separationRegime) => {
      regimes.set(fdrId, separationRegime);
      return { ok: true };
    },
  });
  return { store, regimes };
}

let n = 0;
function declare(store, overrides = {}) {
  return store.apply({
    clientMutationId: `cm-${++n}`,
    op: {
      kind: 'DeclareMarsa',
      participants: [TANKER, RX1],
      startEvent: 'TANKER_ACCEPTED',
      endCondition: 'VERTICALLY_POSITIONED',
      declaringCallsign: 'SHELL71',
      ...overrides,
    },
  }, 'CTR', 'ctrl-1');
}

function op(store, marsaId, opBody, { baseRev } = {}) {
  const current = store.getRelation(marsaId);
  return store.apply({
    clientMutationId: `cm-${++n}`,
    marsaId,
    baseRev: baseRev !== undefined ? baseRev : (current ? current.rev : 0),
    op: opBody,
  }, 'CTR', 'ctrl-1');
}

// ── declaring ───────────────────────────────────────────────────────────────

test('DeclareMarsa mints an ACTIVE relation carrying §9.2\'s whole schema', () => {
  const { store } = makeStore();
  const result = declare(store);
  assert.equal(result.ok, true);
  const r = result.relation;
  assert.equal(r.state, 'ACTIVE');
  assert.deepEqual(r.participants, [TANKER, RX1]);
  assert.equal(r.declaringCallsign, 'SHELL71');
  assert.equal(r.startEvent, 'TANKER_ACCEPTED');
  assert.equal(r.endCondition, 'VERTICALLY_POSITIONED');
  assert.ok(r.startedAt);
  assert.equal(r.voidedBy, null);
  assert.equal(r.endedAt, null);
  // The interlock's off switch, absent from the guide's own schema — null is
  // "not yet", i.e. armed.
  assert.equal(r.rendezvousAt, null);
  assert.equal(r.transitions.at(-1).reason, 'DECLARED');
});

test('the declaration writes every participant\'s separation regime (guide §4.8.3)', () => {
  const { store, regimes } = makeStore();
  declare(store);
  assert.equal(regimes.get(TANKER), 'MARSA');
  assert.equal(regimes.get(RX1), 'MARSA');
});

test('a relation needs two flights, a declaring callsign, and valid start/end enums', () => {
  const { store } = makeStore();
  assert.equal(declare(store, { participants: [TANKER] }).reason, 'VALIDATION_ERROR');
  assert.match(declare(store, { participants: [TANKER] }).detail, new RegExp(`${MIN_PARTICIPANTS} or more`));
  // §9.2 rule 1 — the declaration is the tanker's and it is verbal; a relation
  // nobody is named as having declared is an unattributable assertion that ATC
  // is not separating two aircraft.
  assert.equal(declare(store, { declaringCallsign: '' }).reason, 'VALIDATION_ERROR');
  assert.equal(declare(store, { startEvent: 'VIBES' }).reason, 'VALIDATION_ERROR');
  assert.equal(declare(store, { endCondition: 'WHENEVER' }).reason, 'VALIDATION_ERROR');
  assert.equal(declare(store, { participants: [TANKER, 'fdr-ghost'] }).reason, 'NOT_FOUND');
});

test('one flight is in at most one ACTIVE relation — the invariant the auto-void keys on', () => {
  const { store } = makeStore();
  assert.equal(declare(store).ok, true);
  const second = declare(store, { participants: [RX1, RX2] });
  assert.equal(second.ok, false);
  assert.match(second.detail, /already in an active MARSA relation/);
  // But once the first one is over, the same flight may join another.
  const first = store.activeFor(RX1);
  assert.equal(op(store, first.marsaId, { kind: 'EndMarsa' }).ok, true);
  assert.equal(declare(store, { participants: [RX1, RX2] }).ok, true);
});

// ── the lifecycle ───────────────────────────────────────────────────────────

test('MarkRendezvous disarms the interlock and refuses a second press', () => {
  const { store } = makeStore();
  const { marsaId } = declare(store).relation;
  assert.equal(op(store, marsaId, { kind: 'MarkRendezvous' }).ok, true);
  assert.ok(store.getRelation(marsaId).rendezvousAt);
  assert.equal(op(store, marsaId, { kind: 'MarkRendezvous' }).reason, 'VALIDATION_ERROR');
});

test('EndMarsa and VoidMarsa both hand separation back to ATC, and say which happened', () => {
  const { store, regimes } = makeStore();
  const ended = declare(store).relation;
  assert.equal(op(store, ended.marsaId, { kind: 'EndMarsa' }).ok, true);
  const e = store.getRelation(ended.marsaId);
  assert.equal(e.state, 'ENDED');
  assert.equal(e.endedBy, 'END_CONDITION');
  assert.equal(e.voidedBy, null);
  assert.equal(regimes.get(TANKER), 'ATC');

  const voided = declare(store, { participants: [RX1, RX2] }).relation;
  assert.equal(op(store, voided.marsaId, { kind: 'VoidMarsa', note: 'changed my mind' }).ok, true);
  const v = store.getRelation(voided.marsaId);
  assert.equal(v.state, 'VOIDED');
  assert.equal(v.voidedBy, 'MANUAL');
  assert.equal(v.endedBy, null);
  assert.equal(regimes.get(RX2), 'ATC');
});

test('a finished relation refuses every further op', () => {
  const { store } = makeStore();
  const { marsaId } = declare(store).relation;
  op(store, marsaId, { kind: 'EndMarsa' });
  for (const kind of ['MarkRendezvous', 'EndMarsa', 'VoidMarsa']) {
    assert.match(op(store, marsaId, { kind }).detail, /already ENDED/);
  }
  assert.match(op(store, marsaId, { kind: 'AddParticipant', fdrId: RX2 }).detail, /already ENDED/);
});

// ── what a pilot actually asks for (docs/adr/0050's habit) ──────────────────

test('a receiver joining late is added without losing the relation\'s history', () => {
  const { store, regimes } = makeStore();
  const { marsaId } = declare(store).relation;
  assert.equal(op(store, marsaId, { kind: 'AddParticipant', fdrId: RX2 }).ok, true);
  const r = store.getRelation(marsaId);
  assert.deepEqual(r.participants, [TANKER, RX1, RX2]);
  assert.equal(regimes.get(RX2), 'MARSA');
  // The start event, the declaring callsign and the whole history survive —
  // which is the reason this is an op rather than void-and-re-declare.
  assert.equal(r.startEvent, 'TANKER_ACCEPTED');
  assert.equal(r.declaringCallsign, 'SHELL71');
  assert.equal(r.transitions[0].reason, 'DECLARED');
  assert.equal(r.transitions.at(-1).reason, 'PARTICIPANT_ADDED');
});

test('a flight already under MARSA cannot be added to a second relation', () => {
  const { store } = makeStore();
  declare(store);
  const other = declare(store, { participants: [RX2, OUTSIDER] }).relation;
  const refused = op(store, other.marsaId, { kind: 'AddParticipant', fdrId: RX1 });
  assert.equal(refused.ok, false);
  assert.match(refused.detail, /already in an active MARSA relation/);
});

test('one receiver breaking off leaves the rest under MARSA; the last one ends it', () => {
  const { store, regimes } = makeStore();
  const { marsaId } = declare(store).relation;
  op(store, marsaId, { kind: 'AddParticipant', fdrId: RX2 });

  op(store, marsaId, { kind: 'RemoveParticipant', fdrId: RX2 });
  assert.equal(store.getRelation(marsaId).state, 'ACTIVE');
  assert.equal(regimes.get(RX2), 'ATC');   // the one leaving is ATC's again at once
  assert.equal(regimes.get(TANKER), 'MARSA'); // the rest are not

  op(store, marsaId, { kind: 'RemoveParticipant', fdrId: RX1 });
  const r = store.getRelation(marsaId);
  assert.equal(r.state, 'ENDED', 'a one-aircraft relation is not a relation');
  assert.equal(regimes.get(TANKER), 'ATC');
});

test('a flight ending retires it from its relation — and that is not a void', () => {
  const { store, regimes } = makeStore();
  const { marsaId } = declare(store).relation;
  const changed = store.onFdrRetired(TANKER, 'ctrl-1');
  assert.equal(changed.length, 1);
  const r = store.getRelation(marsaId);
  assert.equal(r.state, 'ENDED');
  // The distinction matters on screen: a tanker landing mid-AR is not an
  // interlock firing, and must not render as one.
  assert.equal(r.endedBy, 'PARTICIPANT_RETIRED');
  assert.equal(r.voidedBy, null);
  assert.equal(regimes.get(RX1), 'ATC');
  assert.equal(store.onFdrRetired(OUTSIDER, 'ctrl-1').length, 0, 'a flight in no relation changes nothing');
});

// ── the interlock (§9.2 rule 2) ─────────────────────────────────────────────

test('a course assignment before rendezvous voids the relation and names the cause', () => {
  const { store, regimes } = makeStore();
  const { marsaId } = declare(store).relation;
  const voided = store.voidForAssignment(RX1, {
    cause: 'CONTROLLER_COURSE_CHANGE', blockId: '20', by: 'ctrl-1', actingPositionId: 'CTR',
  });
  assert.ok(voided);
  assert.equal(voided.marsaId, marsaId);
  assert.equal(voided.state, 'VOIDED');
  assert.equal(voided.voidedBy, 'CONTROLLER_COURSE_CHANGE');
  assert.match(voided.voidedDetail, /course assignment/);
  assert.match(voided.voidedDetail, /Block 20/);
  assert.match(voided.voidedDetail, /before rendezvous/);
  // ATC is separating them again from this instant — the half of the void that
  // makes the flight's own fields true, not just the relation's state.
  assert.equal(regimes.get(TANKER), 'ATC');
  assert.equal(regimes.get(RX1), 'ATC');
});

test('an altitude assignment voids it too, with its own cause', () => {
  const { store } = makeStore();
  declare(store);
  const voided = store.voidForAssignment(TANKER, { cause: 'CONTROLLER_ALTITUDE_CHANGE', blockId: '21' });
  assert.equal(voided.voidedBy, 'CONTROLLER_ALTITUDE_CHANGE');
  assert.match(voided.voidedDetail, /altitude assignment/);
});

test('AFTER rendezvous the interlock is spent — an established AR stays up', () => {
  const { store } = makeStore();
  const { marsaId } = declare(store).relation;
  op(store, marsaId, { kind: 'MarkRendezvous' });
  assert.equal(store.voidForAssignment(RX1, { cause: 'CONTROLLER_ALTITUDE_CHANGE', blockId: '21' }), null);
  assert.equal(store.getRelation(marsaId).state, 'ACTIVE');
});

test('an assignment to a flight in no relation voids nothing', () => {
  const { store } = makeStore();
  declare(store);
  assert.equal(store.voidForAssignment(OUTSIDER, { cause: 'CONTROLLER_COURSE_CHANGE' }), null);
});

// ── the audit trail ─────────────────────────────────────────────────────────

test('refusals are audited too — a rejected ask must leave a trace somewhere', () => {
  const { store } = makeStore();
  const entries = [];
  store.setMutationLog({ record: (e) => entries.push(e) });

  const { marsaId } = declare(store).relation;
  op(store, marsaId, { kind: 'AddParticipant', fdrId: 'fdr-ghost' });
  op(store, marsaId, { kind: 'EndMarsa' }, { baseRev: 999 });

  const refusals = entries.filter(e => !e.ok);
  assert.equal(refusals.length, 2);
  assert.deepEqual(refusals.map(e => e.reason), ['NOT_FOUND', 'STALE_REV']);
  // Its own id field — a MARSA op targets a relation BETWEEN flights, so no
  // stripId or fdrId names it.
  assert.equal(refusals[0].marsaId, marsaId);
  assert.equal(entries[0].op, 'DeclareMarsa');
  assert.equal(entries[0].actingPositionId, 'CTR');
});

test('an interlock void is logged under the clientMutationId of the clearance that caused it', () => {
  const { store } = makeStore();
  const entries = [];
  store.setMutationLog({ record: (e) => entries.push(e) });
  declare(store);
  store.voidForAssignment(RX1, {
    cause: 'CONTROLLER_COURSE_CHANGE', blockId: '20',
    clientMutationId: 'the-setblock', actingPositionId: 'APP', by: 'ctrl-2',
  });
  const entry = entries.at(-1);
  assert.equal(entry.clientMutationId, 'the-setblock');
  assert.equal(entry.op, 'VoidMarsa');
  assert.equal(entry.actingPositionId, 'APP');
  assert.equal(entry.after.voidedBy, 'CONTROLLER_COURSE_CHANGE');
});

// ── persistence ─────────────────────────────────────────────────────────────

test('a relation survives a restart INTACT — unlike a correlation record', () => {
  const { store } = makeStore();
  const { marsaId } = declare(store).relation;
  op(store, marsaId, { kind: 'MarkRendezvous' });
  const saved = store.snapshot();

  const { store: reborn, regimes } = makeStore();
  reborn.restore(saved);
  const r = reborn.getRelation(marsaId);
  assert.equal(r.state, 'ACTIVE');
  assert.deepEqual(r.participants, [TANKER, RX1]);
  assert.ok(r.rendezvousAt, 'the rendezvous still happened');
  assert.equal(r.declaringCallsign, 'SHELL71');
  assert.ok(r.transitions.length >= 2);
  // Coming back up with the AR silently reverted to ATC separation would be
  // §4.8.3's "second controller inherits a lie", caused by us.
  assert.ok(reborn.activeFor(TANKER));
  assert.equal(regimes.size, 0, 'restore replays no regime writes — the FDRs came back carrying them');
});

test('a relation whose flights are gone does not come back', () => {
  const { store } = makeStore();
  declare(store);
  const saved = store.snapshot();
  const { store: reborn } = makeStore({ known: [OUTSIDER] });
  reborn.restore(saved);
  assert.deepEqual(reborn.getAll(), []);
});

test('a relation that comes back with one participant left is finished, not active', () => {
  const { store } = makeStore();
  declare(store);
  const saved = store.snapshot();
  const { store: reborn } = makeStore({ known: [TANKER] }); // RX1's FDR is gone
  reborn.restore(saved);
  const r = reborn.getAll()[0];
  assert.equal(r.state, 'ENDED');
  assert.equal(r.endedBy, 'PARTICIPANT_RETIRED');
  assert.equal(reborn.activeFor(TANKER), null);
});

test('evictMissingFdrs forgets relations nobody is in any more', () => {
  const { store } = makeStore();
  declare(store);
  assert.equal(store.evictMissingFdrs(), 0);
  const { store: narrowed } = makeStore({ known: [] });
  narrowed.restore([]);
  assert.equal(narrowed.evictMissingFdrs(), 0);
});

test('the glossary expansion is exported so UI text has one copy (§9.2 rule 6)', () => {
  assert.equal(MARSA_EXPANSION, 'Military Authority Assumes Responsibility for Separation of Aircraft');
});

test('an unknown op is refused rather than silently ignored', () => {
  const { store } = makeStore();
  const { marsaId } = declare(store).relation;
  const result = op(store, marsaId, { kind: 'Hope' });
  assert.equal(result.reason, 'VALIDATION_ERROR');
  assert.match(result.detail, /unknown MARSA op/);
  // Every result carries the relation, refusals included — a rejection that
  // says nothing about current state leaves the client rendering its own guess.
  assert.equal(result.relation.state, 'ACTIVE');
});

test('an op against an unknown relation is NOT_FOUND', () => {
  const { store } = makeStore();
  assert.equal(op(store, 'no-such-relation', { kind: 'EndMarsa' }).reason, 'NOT_FOUND');
});
