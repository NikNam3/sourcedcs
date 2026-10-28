import { test } from 'node:test';
import assert from 'node:assert/strict';

// The undo contract (docs/adr/0100): every op module declares `undo` (U17), and the history's frames, records,
// voiding, blocking and scope-escape rules (U18), on a fake wall clock (no sleeps).

const OPS = (await import('../src/efsp/board/ops/index.js')).default;
const { UndoHistory, UNDO_WINDOW_MS, undoDeclarationProblem } = await import('../src/efsp/undo/undo-history.js');

function fakeWall(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; }, set: (v) => { t = v; } };
}

const S = (stripId, facilityId = 'INCIRLIK') => ({ facilityId, stripId });
const meta = (over = {}) => ({ facilityId: 'INCIRLIK', actingPositionId: 'LC', actorId: 'c1', op: 'InvokeNla', label: 'Hand off', ...over });
const strip = (id, fac = 'INCIRLIK') => ({ kind: 'strip', facilityId: fac, id });

test('U17: every module in the op table declares undo, none or a valid declaration', () => {
  assert.ok(OPS.length > 0);
  for (const entry of OPS) assert.equal(undoDeclarationProblem(entry), null, entry.kind);
  assert.match(undoDeclarationProblem({ kind: 'X' }), /declares no undo/);
  assert.match(undoDeclarationProblem({ kind: 'X', undo: { scope() {} } }), /label/);
  assert.equal(UNDO_WINDOW_MS, 10_000);
});

test('U17: a scope that returns null makes that one action not undoable (per-action decision)', () => {
  const entry = { kind: 'Multi', undo: { label: () => 'x', scope: (ctx, strip, op) => (op.action === 'MARK' ? { strips: [S(strip.stripId)] } : null) } };
  assert.equal(undoDeclarationProblem(entry), null);
  const h = new UndoHistory({ wallClock: fakeWall() });
  for (const [id, action] of [['m1', 'MARK'], ['r1', 'RELEASE']]) {
    h.begin(id, meta({ op: 'Multi' }), entry.undo.scope(null, { stripId: 's1' }, { action }));
    h.observe(strip('s1'));
    const undoable = h.commit({ ok: true });
    assert.equal(!!undoable, action === 'MARK', action);
  }
});

test('an action that changed nothing is not undoable', () => {
  const h = new UndoHistory({ wallClock: fakeWall() });
  h.begin('a1', meta(), { strips: [S('s1')] });
  assert.equal(h.commit({ ok: true }), null);
});

test('U17: StripOps refuses an op table with a module that declares no undo', async () => {
  const { StripOps } = await import('../src/efsp/board/strip-ops.js');
  assert.throws(() => new StripOps({ ops: [{ kind: 'Bogus', apply() {} }] }), /declares no undo/);
});

test('an undoable frame inside its scope becomes a record for exactly 10 s', () => {
  const wall = fakeWall();
  const h = new UndoHistory({ wallClock: wall });
  h.begin('a1', meta(), { strips: [S('s1')] });
  h.observe(strip('s1'));
  const undoable = h.commit({ ok: true });
  assert.deepEqual(undoable, { actionId: 'a1', label: 'Hand off', windowMs: 10_000 });
  wall.advance(9_999);
  assert.equal(h.undo('a1', 'LC').ok, true);
  wall.advance(1);
  const r = h.undo('a1', 'LC');
  assert.equal(r.reason, 'UNDO_UNAVAILABLE');
});

test('unkeyed, unscoped and refused actions are never undoable', () => {
  const h = new UndoHistory({ wallClock: fakeWall() });
  h.begin(null, meta(), { strips: [S('s1')] });
  assert.equal(h.commit({ ok: true }), null);
  h.begin('a2', meta(), null);
  assert.equal(h.commit({ ok: true }), null);
  h.begin('a3', meta(), { strips: [S('s1')] });
  assert.equal(h.commit({ ok: false }), null);
  assert.equal(h.size, 0);
});

test('U18: a footprint outside the declared scope makes the action not undoable', () => {
  const h = new UndoHistory({ wallClock: fakeWall() });
  h.begin('a1', meta(), { strips: [S('s1')] });
  h.observe(strip('s1'));
  h.observe(strip('s2'));
  assert.equal(h.commit({ ok: true }), null);
  assert.equal(h.undo('a1', 'LC').reason, 'UNDO_UNAVAILABLE');
});

test('created records and placement-only touches stay inside the footprint check', () => {
  const h = new UndoHistory({ wallClock: fakeWall() });
  h.begin('a1', meta(), { strips: [S('s1')] });
  h.observe(strip('s1'));
  h.observe({ ...strip('n1'), unobserved: true });
  h.observe(strip('m1', 'MRU'));
  assert.ok(h.commit({ ok: true }, { created: { strips: [S('m1', 'MRU')] } }));
});

test('only the performing Position may undo (Q-U5 a)', () => {
  const h = new UndoHistory({ wallClock: fakeWall() });
  h.begin('a1', meta(), { strips: [S('s1')] });
  h.observe(strip('s1'));
  h.commit({ ok: true });
  assert.equal(h.undo('a1', 'AP').reason, 'PERMISSION_DENIED');
});

test('a later Mutation inside the scope at the same Facility is voided and listed', () => {
  const h = new UndoHistory({ wallClock: fakeWall() });
  h.begin('a1', meta(), { strips: [S('s1')], flightData: ['f1'] });
  h.observe(strip('s1'));
  h.commit({ ok: true });
  h.begin('b1', meta({ actingPositionId: 'AP', op: 'SetBlock', at: 5 }), null);
  h.observe(strip('s1'));
  h.observe({ kind: 'flightData', id: 'f1', paths: ['clearance.altitude'] });
  h.commit({ ok: true });
  const r = h.undo('a1', 'LC');
  assert.equal(r.ok, true);
  assert.deepEqual(r.plan.voided.map(v => [v.clientMutationId, v.op, v.actingPositionId]), [['b1', 'SetBlock', 'AP']]);
  assert.deepEqual([...r.plan.paths.get('f1')], ['clearance.altitude']);
});

test('a later change from another Facility, a system change, or one reaching outside the scope blocks (Q-U3 a)', () => {
  for (const [label, act] of [
    ['other Facility', (h) => { h.begin('b1', meta({ facilityId: 'MRU', actingPositionId: 'TAC_C2', op: 'TOFI' }), null); h.observe(strip('s1')); h.commit({ ok: true }); }],
    ['system', (h) => { h.observe({ ...strip('s1'), op: 'SystemReassign' }); }],
    ['outside', (h) => { h.begin('b1', meta({ actingPositionId: 'AP', op: 'X' }), null); h.observe(strip('s1')); h.observe(strip('s9')); h.commit({ ok: true }); }],
  ]) {
    const h = new UndoHistory({ wallClock: fakeWall() });
    h.begin('a1', meta(), { strips: [S('s1')] });
    h.observe(strip('s1'));
    h.commit({ ok: true });
    act(h);
    const r = h.undo('a1', 'LC');
    assert.equal(r.reason, 'UNDO_BLOCKED', label);
    assert.ok(r.detail.length > 0);
  }
});

test('complete() drops the undone record, the records it voided, and every overlapping record (U21 shape)', () => {
  const h = new UndoHistory({ wallClock: fakeWall() });
  for (const id of ['n1', 'n2']) {
    h.begin(id, meta(), { strips: [S('s1')] });
    h.observe(strip('s1'));
    h.commit({ ok: true });
  }
  h.begin('other', meta(), { strips: [S('s7')] });
  h.observe(strip('s7'));
  h.commit({ ok: true });
  const r = h.undo('n1', 'LC');
  assert.deepEqual(r.plan.voided.map(v => v.clientMutationId), ['n2']);
  h.complete(r.plan);
  assert.equal(h.recordOf('n1'), null);
  assert.equal(h.recordOf('n2'), null);
  assert.ok(h.recordOf('other'));
});

test('the Undo frame itself neither voids nor blocks the records it restores', () => {
  const h = new UndoHistory({ wallClock: fakeWall() });
  h.begin('a1', meta(), { strips: [S('s1')] });
  h.observe(strip('s1'));
  h.commit({ ok: true });
  h.begin('u1', meta({ op: 'Undo', undo: true }), null);
  h.observe(strip('s1'));
  h.commit({ ok: true });
  assert.equal(h.recordOf('a1').voided.length, 0);
  assert.equal(h.recordOf('a1').blockedBy, null);
});

test('the scope is captured before the op through the attached capture', () => {
  const h = new UndoHistory({ wallClock: fakeWall() });
  const live = { s1: { stripId: 's1', state: 'A' } };
  h.attach({ strip: (f, id) => ({ strip: structuredClone(live[id]), placement: { bayId: 'B', rackId: 'R', afterStripId: null } }), flightData: () => null });
  h.begin('a1', meta(), { strips: [S('s1')] });
  live.s1.state = 'B';
  h.observe(strip('s1'));
  h.commit({ ok: true });
  assert.equal(h.undo('a1', 'LC').plan.images.strips[0].strip.state, 'A');
});

test('the wall clock is injected, never read from Date', () => {
  assert.throws(() => new UndoHistory({}), /wall clock/);
});
