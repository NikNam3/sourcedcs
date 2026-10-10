import test from 'node:test';
import assert from 'node:assert/strict';

// The "changed, not yet passed" marks of the recovery board live on the server (decisions H123, docs/adr/0115): the stack entry
// carries `unpassed` (the angels and/or EAT that changed since the pilot was last told), the server alone decides what counts as
// a change, and PassClearance, the Marshal's click on the row, clears it as an audited Mutation. Shared by every Marshal
// controller, kept with the stack across a restart.

const { CarrierStore } = await import('../src/efsp/carrier-store.js');
const hullConfig = await import('../src/efsp/carrier/hull-config.js');
const { markClearanceChanges, passClearance, validateStack, normalizeStack } = await import('../src/efsp/carrier/marshal-stack.js');

const T0 = Date.UTC(2026, 5, 1, 20, 30);
const MIN = 60_000;

function rig() {
  const t = { v: T0 };
  const clock = { now: () => t.v, source: 'TEST' };
  const audit = [];
  const store = new CarrierStore({ hulls: hullConfig.getHulls(), clock, mutationLog: { record: (x) => audit.push(x) } });
  let n = 0;
  const op = (o, pos = 'CV_MARSHAL') => store.apply({ clientMutationId: `m${n++}`, op: o }, pos, `u-${pos}`);
  const set = (field, value, pos = 'CV_PRIFLY') => op({ kind: 'SetCarrierState', field, value }, pos);
  const flights = (k) => { for (let i = 0; i < k; i++) op({ kind: 'Append', flightDataId: `f${i}` }); };
  const entry = (id) => store.getRecord().stacks.MAIN.entries.find((e) => e.flightDataId === id);
  const derived = (id) => store.view().derived.MAIN.find((e) => e.flightDataId === id);
  const marks = (id) => derived(id).unpassed;
  const all = () => Object.fromEntries(store.view().derived.MAIN.map((e) => [e.flightDataId, [...e.unpassed]]));
  const pass = (id, pos = 'CV_MARSHAL') => {
    const d = derived(id);
    return op({ kind: 'PassClearance', flightDataId: id, angels: d.angels, eatUtc: d.pushTimeUtc }, pos);
  };
  const commence = (id) => store.applyEffect('MARK_PUSHED', id, { by: 'm', actingPositionId: 'CV_MARSHAL' });
  return { store, t, audit, op, set, flights, entry, derived, marks, all, pass, commence };
}

test('a flight joining the stack and a ramp time first set mark nothing: a value that appears from nothing was never told', () => {
  const r = rig();
  r.flights(3);
  assert.deepEqual(r.all(), { f0: [], f1: [], f2: [] });
  r.set('rampTime', '2040');
  assert.deepEqual(r.all(), { f0: [], f1: [], f2: [] });
  // a new arrival at the top is told its clearance as it checks in; the ones below did not move
  r.op({ kind: 'Append', flightDataId: 'f3' });
  assert.deepEqual(r.all(), { f0: [], f1: [], f2: [], f3: [] });
});

test('Delta marks every holding EAT, never the angels and never a commenced flight', () => {
  const r = rig();
  r.flights(3);
  r.set('rampTime', '2040');
  r.commence('f0');
  assert.equal(r.op({ kind: 'Delta', minutes: 4 }).ok, true);
  assert.deepEqual(r.all(), { f0: [], f1: ['eat'], f2: ['eat'] });
});

test('a re-sequence marks the moved flight and everyone it shifted (angels and EAT), and nobody else', () => {
  const r = rig();
  r.flights(4);
  r.set('rampTime', '2040');
  assert.equal(r.op({ kind: 'Move', flightDataId: 'f3', toIndex: 1 }).ok, true);
  // f3 3 -> 1, f1 1 -> 2, f2 2 -> 3; f0 untouched
  assert.deepEqual(r.all(), { f0: [], f3: ['angels', 'eat'], f1: ['angels', 'eat'], f2: ['angels', 'eat'] });
});

test('a ramp-time change marks the EATs; a cleared ramp time adds nothing; a Case change marks the Case I altitude that moved', () => {
  const r = rig();
  r.flights(2);
  r.set('rampTime', '2040');
  r.set('rampTime', '2050', 'CV_MARSHAL');
  assert.deepEqual(r.all(), { f0: ['eat'], f1: ['eat'] });
  r.pass('f0'); r.pass('f1');
  r.set('rampTime', null);
  assert.deepEqual(r.all(), { f0: [], f1: [] }, 'an EAT that goes away leaves nothing to pass');
  // Case I: the typed altitude; first typed is not a change, re-typed is; to Case III it becomes 6 + slot
  r.set('case', 'I');
  assert.deepEqual(r.all(), { f0: [], f1: [] }, 'Case I has no altitude until one is typed');
  r.op({ kind: 'SetCaseIAngels', flightDataId: 'f0', caseIAngels: 3 });
  assert.deepEqual(r.marks('f0'), []);
  r.op({ kind: 'SetCaseIAngels', flightDataId: 'f0', caseIAngels: 4 });
  assert.deepEqual(r.marks('f0'), ['angels']);
  r.pass('f0');
  r.set('case', 'III');
  assert.deepEqual(r.all(), { f0: ['angels'], f1: [] });
});

test('Back to stack marks both, whatever they read; Commence clears what was not passed', () => {
  const r = rig();
  r.flights(2);
  r.set('rampTime', '2040');
  r.op({ kind: 'Delta', minutes: 4 });
  assert.deepEqual(r.marks('f0'), ['eat']);
  r.commence('f0');
  assert.deepEqual([r.entry('f0').status, r.entry('f0').unpassed], ['PUSHED', []]);
  assert.equal(r.op({ kind: 'BackToStack', flightDataId: 'f0' }).ok, true);
  assert.deepEqual(r.marks('f0'), ['angels', 'eat']);
  assert.deepEqual(r.marks('f1'), ['eat'], 'nobody else moves, nobody else is marked');
});

test('PassClearance: the Marshal clears it, audited with who, when, which fields and values; nothing left to pass is a no-op', () => {
  const r = rig();
  r.flights(2);
  r.set('rampTime', '2040');
  r.op({ kind: 'Delta', minutes: 4 });
  r.t.v = T0 + 3 * MIN;
  const d = r.derived('f1');
  const rev = r.store.getRecord().rev;
  const p = r.pass('f1');
  assert.deepEqual([p.ok, p.changed], [true, ['f1']]);
  assert.deepEqual(r.all(), { f0: ['eat'], f1: [] });
  assert.equal(r.store.getRecord().rev, rev + 1);
  const line = r.audit.at(-1);
  assert.deepEqual([line.op, line.ok, line.actorId, line.actingPositionId, line.at, line.flightDataId, line.passed, line.angels, line.eatUtc],
    ['PassClearance', true, 'u-CV_MARSHAL', 'CV_MARSHAL', T0 + 3 * MIN, 'f1', ['eat'], d.angels, d.pushTimeUtc]);
  // the second Marshal clicks the same row a moment later: nothing to pass, nothing written, no refusal
  const again = r.pass('f1');
  assert.deepEqual([again.ok, again.unchanged], [true, true]);
  assert.equal(r.store.getRecord().rev, rev + 1);
});

test('PassClearance is refused when the clearance changed again since it was read, for a commenced flight, and for any Position but the Marshal', () => {
  const r = rig();
  r.flights(2);
  r.set('rampTime', '2040');
  r.op({ kind: 'Delta', minutes: 4 });
  const seen = r.derived('f1');
  r.op({ kind: 'Delta', minutes: 4 }); // the other Marshal's Delta lands before the click
  const stale = r.op({ kind: 'PassClearance', flightDataId: 'f1', angels: seen.angels, eatUtc: seen.pushTimeUtc });
  assert.deepEqual([stale.ok, stale.reason], [false, 'VALIDATION_ERROR']);
  assert.match(stale.detail, /changed again/);
  assert.deepEqual(r.marks('f1'), ['eat']);
  assert.equal(r.pass('f1', 'CV_PRIFLY').reason, 'PERMISSION_DENIED');
  assert.equal(r.op({ kind: 'PassClearance', flightDataId: 'f1' }).reason, 'VALIDATION_ERROR', 'it names the values passed');
  assert.equal(r.op({ kind: 'PassClearance', flightDataId: 'zz', angels: null, eatUtc: null }).reason, 'NOT_FOUND');
  r.commence('f0');
  const pushed = r.op({ kind: 'PassClearance', flightDataId: 'f0', angels: 6, eatUtc: null });
  assert.deepEqual([pushed.ok, pushed.reason], [false, 'VALIDATION_ERROR']);
});

test('a mark stays until passed, even when the value moves back; once passed, the next change marks again', () => {
  const r = rig();
  r.flights(3);
  r.set('rampTime', '2040');
  r.op({ kind: 'Move', flightDataId: 'f2', toIndex: 0 });
  r.op({ kind: 'Move', flightDataId: 'f2', toIndex: 2 });
  assert.deepEqual(r.marks('f0'), ['angels', 'eat']);
  r.pass('f0');
  assert.deepEqual(r.marks('f0'), []);
  r.op({ kind: 'Delta', minutes: 4 });
  assert.deepEqual(r.marks('f0'), ['eat']);
});

test('the marks survive a restart (persisted with the stack); a pushed entry carrying one, or an unknown field, is refused', () => {
  const r = rig();
  r.flights(2);
  r.set('rampTime', '2040');
  r.op({ kind: 'Delta', minutes: 4 });
  r.commence('f0');
  r.op({ kind: 'BackToStack', flightDataId: 'f0' });
  const r2 = rig();
  r2.store.restore(JSON.parse(JSON.stringify(r.store.snapshot())));
  assert.deepEqual(r2.all(), { f1: ['eat'], f0: ['angels', 'eat'] });
  const stack = r.store.getRecord().stacks.MAIN;
  const withMark = (e, m) => ({ ...stack, entries: stack.entries.map((x) => (x.flightDataId === e ? { ...x, ...m } : x)) });
  assert.equal(validateStack(withMark('f1', { unpassed: ['dme'] })).ok, false);
  assert.equal(validateStack(withMark('f1', { unpassed: ['eat', 'eat'] })).ok, false);
  const pushed = { ...stack, entries: [{ flightDataId: 'p', stackIndex: 5, status: 'PUSHED', caseIAngels: null, pushedAtUtc: 1, eatUtc: 1, unpassed: ['eat'] }] };
  assert.equal(validateStack(pushed).ok, false);
  // an entry from before this build has no `unpassed`: it reads as nothing to pass
  const old = normalizeStack({ stackId: 'MAIN', entries: [{ flightDataId: 'a', stackIndex: 0, status: 'HOLDING', caseIAngels: null }] });
  assert.deepEqual(old.stack.entries[0].unpassed, []);
});

test('undo of Back to stack restores the entry whole (no marks); undo of Commence brings back what was not passed', () => {
  const r = rig();
  r.flights(2);
  r.set('rampTime', '2040');
  r.op({ kind: 'Delta', minutes: 4 });
  const holdImage = r.store.entryImage('f0');
  r.commence('f0');
  const pushedImage = r.store.entryImage('f0');
  r.op({ kind: 'BackToStack', flightDataId: 'f0' });
  assert.deepEqual(r.marks('f0'), ['angels', 'eat']);
  assert.equal(r.store.restoreEntry('f0', pushedImage, { causedBy: 'u1', by: 'x' }).ok, true);
  assert.deepEqual([r.entry('f0').status, r.entry('f0').unpassed], ['PUSHED', []]);
  assert.equal(r.store.restoreEntry('f0', holdImage, { causedBy: 'u2', by: 'x' }).ok, true);
  assert.deepEqual([r.entry('f0').status, r.marks('f0')], ['HOLDING', ['eat']]);
});

test('a marked flight that diverts or is dropped leaves with its mark; the mission reset clears every mark', () => {
  const r = rig();
  r.flights(2);
  r.set('rampTime', '2040');
  r.op({ kind: 'Delta', minutes: 4 });
  r.store.onFlightDataRetired('f0', 'sys');
  assert.deepEqual(r.all(), { f1: ['eat'] });
  r.store.resetForMission();
  assert.deepEqual(r.all(), {});
});

test('the pure rule: markClearanceChanges and passClearance never mutate their input', () => {
  const e = (id, i, extra = {}) => Object.freeze({ flightDataId: id, stackIndex: i, status: 'HOLDING', caseIAngels: null, pushedAtUtc: null, eatUtc: null, unpassed: Object.freeze([]), ...extra });
  const stack = Object.freeze({ stackId: 'MAIN', hullId: 'X', deltaMs: 0, entries: Object.freeze([e('a', 0), e('b', 1, { unpassed: Object.freeze(['eat']) })]) });
  const d = (id, angels, push, status = 'HOLDING') => ({ flightDataId: id, status, angels, pushTimeUtc: push });
  const out = markClearanceChanges(stack, [d('a', 6, 100), d('b', 7, 200)], [d('a', 6, 160), d('b', 8, 200)]);
  assert.deepEqual(out.entries.map((x) => x.unpassed), [['eat'], ['angels', 'eat']]);
  assert.equal(markClearanceChanges(stack, [d('a', 6, 100)], [d('a', 6, 100)]), stack, 'nothing moved: the same stack back');
  assert.equal(markClearanceChanges(stack, [d('a', 6, null)], [d('a', 6, 100)]), stack, 'appeared from nothing: no mark');
  const p = passClearance(stack, { flightDataId: 'b', angels: 7, eatUtc: 200 }, { current: { angels: 7, eatUtc: 200 } });
  assert.deepEqual([p.ok, p.passed, p.stack.entries[1].unpassed], [true, ['eat'], []]);
});
