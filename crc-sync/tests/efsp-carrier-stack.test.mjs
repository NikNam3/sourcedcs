import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ENTRY_KEYS, STACK_OP_KINDS, STACK_DEFAULTS, DEFAULT_STACK_ID,
  emptyStack, validateStack, normalizeStack, deriveEntry, deriveStack, checkConsistency,
  insertAt, append, move, remove, closeUp, markPushed, setCharlieTime, setCaseIAngels,
  setMarshalRadial, applyStackOp,
} from '../src/efsp/carrier/marshal-stack.js';

// Guide §9.12 "Case III — one integer drives four displayed fields", and its
// rules 1–3. docs/adr/0064.

const CHARLIE = Date.UTC(2026, 8, 30, 14, 30, 0); // mission Zulu (decisions H11)
const SHIP = Object.freeze({ finalBearingDeg: 115, brcDeg: 124 });

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

function stackOf(ids, { charlie = CHARLIE, pushed = [], gaps = [] } = {}) {
  let s = emptyStack({ stackId: 'MAIN', hullId: 'CVN-72' });
  s = { ...s, charlieTimeUtc: charlie };
  let idx = 0;
  const entries = [];
  for (const id of ids) {
    while (gaps.includes(idx)) idx++;
    entries.push({ fdrId: id, stackIndex: idx, status: pushed.includes(id) ? 'PUSHED' : 'HOLDING', caseIAngels: null });
    idx++;
  }
  return deepFreeze({ ...s, entries });
}

function indexOf(stack, id) {
  const e = stack.entries.find((x) => x.fdrId === id);
  return e ? e.stackIndex : undefined;
}

// ── Shape ────────────────────────────────────────────────────────────────────

test('emptyStack is keyed by stackId (decisions H29) and holds no derived value', () => {
  const s = emptyStack({ hullId: 'CVN-72' });
  assert.equal(s.stackId, DEFAULT_STACK_ID);
  assert.deepEqual(s, { stackId: 'MAIN', hullId: 'CVN-72', charlieTimeUtc: null, marshalRadialDeg: null, entries: [] });
  assert.deepEqual([...ENTRY_KEYS], ['fdrId', 'stackIndex', 'status', 'caseIAngels']);
  assert.equal(STACK_DEFAULTS.maxIndex, 19);
});

test('validateStack refuses derived keys by name; normalizeStack drops them', () => {
  for (const k of ['angels', 'marshalDme', 'pushTimeUtc', 'marshalRadialDeg']) {
    const s = { ...emptyStack({ hullId: 'CVN-72' }), entries: [{ fdrId: 'a', stackIndex: 0, status: 'HOLDING', caseIAngels: null, [k]: 99 }] };
    const r = validateStack(s);
    assert.equal(r.ok, false, k);
    assert.equal(r.reason, 'VALIDATION_ERROR');
    assert.match(r.detail, /derived from the stack index/);
    const n = normalizeStack(s);
    assert.equal(n.ok, true);
    assert.deepEqual(Object.keys(n.stack.entries[0]).sort(), [...ENTRY_KEYS].sort());
    assert.equal(validateStack(n.stack).ok, true);
  }
});

test('validateStack refuses duplicates, bad indices, disorder, unknown keys', () => {
  const base = emptyStack({ hullId: 'CVN-72' });
  const e = (fdrId, stackIndex, extra = {}) => ({ fdrId, stackIndex, status: 'HOLDING', caseIAngels: null, ...extra });
  assert.equal(validateStack({ ...base, entries: [e('a', 0), e('a', 1)] }).ok, false);
  assert.equal(validateStack({ ...base, entries: [e('a', 0), e('b', 0)] }).ok, false);
  assert.equal(validateStack({ ...base, entries: [e('a', 1), e('b', 0)] }).ok, false);
  assert.equal(validateStack({ ...base, entries: [e('a', 20)] }).ok, false);
  assert.equal(validateStack({ ...base, entries: [e('a', 1.5)] }).ok, false);
  assert.equal(validateStack({ ...base, entries: [e('a', 0, { status: 'GONE' })] }).ok, false);
  assert.equal(validateStack({ ...base, entries: [e('a', 0, { caseIAngels: 1 })] }).ok, false);
  assert.equal(validateStack({ ...base, entries: [e('a', 0, { stripId: 's1' })] }).ok, false, 'keyed by fdrId, never stripId');
  assert.equal(validateStack({ ...base, bogus: 1 }).ok, false);
  assert.equal(validateStack(null).ok, false);
  assert.equal(validateStack({ ...base, entries: [e('a', 0), e('b', 3)] }).ok, true, 'a vacancy is legitimate');
});

test('normalizeStack never refuses; it drops what cannot be kept and says so', () => {
  const n = normalizeStack({
    stackId: 'MAIN', hullId: 'CVN-72', charlieTimeUtc: 'soon',
    entries: [
      { fdrId: 'b', stackIndex: 1, status: 'HOLDING' },
      { fdrId: 'a', stackIndex: 0, status: 'WEIRD', angels: 6 },
      { fdrId: 'a', stackIndex: 2 },
      { fdrId: 'c', stackIndex: 1 },
      { stackIndex: 3 },
      { fdrId: 'd', stackIndex: 99 },
    ],
  });
  assert.equal(n.ok, true);
  assert.deepEqual(n.stack.entries.map((e) => [e.fdrId, e.stackIndex, e.status]), [['a', 0, 'HOLDING'], ['b', 1, 'HOLDING']]);
  assert.equal(n.stack.charlieTimeUtc, null);
  assert.equal(n.dropped.length, 4);
  assert.equal(validateStack(n.stack).ok, true);
  assert.equal(normalizeStack(undefined, { hullId: 'CVN-72' }).stack.hullId, 'CVN-72');
});

// ── Derivation ───────────────────────────────────────────────────────────────

test('deriveEntry Case III: §9.12 worked example — index 2 → angels 8 → DME 23', () => {
  const d = deriveEntry({ fdrId: 'x', stackIndex: 2, status: 'HOLDING', caseIAngels: null },
    { caseValue: 'III', charlieTimeUtc: CHARLIE, shipState: SHIP });
  assert.equal(d.angels, 8);
  assert.equal(d.marshalDme, 23);
  assert.equal(d.pushTimeUtc, CHARLIE + 2 * 60_000);
  assert.deepEqual([...d.pushWindowUtc], [d.pushTimeUtc - 10_000, d.pushTimeUtc + 10_000]);
  assert.equal(d.expectedFinalBearingDeg, 115);
  assert.equal(d.marshalRadialDeg, 295, 'decisions H27: default final bearing + 180');
  assert.equal(d.marshalRadialSource, 'FINAL_BEARING');
  assert.equal(d.minimumAltitudeOk, true);
  assert.ok(Object.isFrozen(d));
});

test('deriveEntry: index 0 is the §9.12 minimum 6,000 ft, and every index stays ≥ 6', () => {
  for (let i = 0; i <= STACK_DEFAULTS.maxIndex; i++) {
    const d = deriveEntry({ fdrId: 'x', stackIndex: i, status: 'HOLDING', caseIAngels: null }, { caseValue: 'III' });
    assert.equal(d.angels, 6 + i);
    assert.equal(d.minimumAltitudeOk, true);
  }
});

test('deriveEntry: a set marshal radial wins over the default (decisions H27)', () => {
  const d = deriveEntry({ fdrId: 'x', stackIndex: 0, status: 'HOLDING', caseIAngels: null },
    { caseValue: 'III', marshalRadialDeg: 300, shipState: SHIP });
  assert.equal(d.marshalRadialDeg, 300);
  assert.equal(d.marshalRadialSource, 'SET');
});

test('deriveEntry: unknown Charlie time or ship state → null, never invented', () => {
  const d = deriveEntry({ fdrId: 'x', stackIndex: 1, status: 'HOLDING', caseIAngels: null }, { caseValue: 'III' });
  assert.equal(d.pushTimeUtc, null);
  assert.equal(d.pushWindowUtc, null);
  assert.equal(d.marshalRadialDeg, null);
  assert.equal(d.expectedFinalBearingDeg, null);
  assert.equal(d.angels, 7, 'angels and DME need nothing but the index');
  assert.equal(d.marshalDme, 22);
});

test('deriveEntry Case I: altitude-keyed, no DME, no push, no radial (§9.12 rule 3)', () => {
  const d = deriveEntry({ fdrId: 'x', stackIndex: 3, status: 'HOLDING', caseIAngels: 4 },
    { caseValue: 'I', charlieTimeUtc: CHARLIE, shipState: SHIP });
  assert.equal(d.angels, 4);
  assert.equal(d.marshalDme, null);
  assert.equal(d.pushTimeUtc, null);
  assert.equal(d.pushWindowUtc, null);
  assert.equal(d.marshalRadialDeg, null);
  assert.equal(d.expectedFinalBearingDeg, 115);
  const unassigned = deriveEntry({ fdrId: 'y', stackIndex: 0, status: 'HOLDING', caseIAngels: null }, { caseValue: 'I' });
  assert.equal(unassigned.angels, null, 'the Strip shows "assign altitude"');
});

test('checkConsistency passes on every derived stack and fails on a hand-built bad one', () => {
  const s = stackOf(['a', 'b', 'c', 'd']);
  for (const c of ['I', 'II', 'III']) assert.deepEqual(checkConsistency(deriveStack(s, { caseValue: c, shipState: SHIP })), []);
  const bad = { fdrId: 'z', caseValue: 'III', angels: 8, marshalDme: 25, marshalRadialDeg: 90, expectedFinalBearingDeg: 115 };
  const codes = checkConsistency([bad]).map((x) => x.code);
  assert.deepEqual(codes.sort(), ['DME_NOT_ANGELS_PLUS_15', 'RADIAL_NOT_RECIPROCAL_OF_FINAL_BEARING']);
  // a controller-set radial within tolerance is fine; outside it is flagged
  const near = setMarshalRadial(s, { marshalRadialDeg: 305 }).stack;
  assert.deepEqual(checkConsistency(deriveStack(near, { caseValue: 'III', shipState: SHIP })), []);
  const far = setMarshalRadial(s, { marshalRadialDeg: 330 }).stack;
  assert.equal(checkConsistency(deriveStack(far, { caseValue: 'III', shipState: SHIP })).length, 4);
  assert.equal(checkConsistency(deriveStack(far, { caseValue: 'III', shipState: SHIP }), { radialToleranceDeg: 40 }).length, 0);
});

// ── Ops ──────────────────────────────────────────────────────────────────────

test('insertAt renumbers everyone at or above, together, in one returned stack', () => {
  const s = stackOf(['a', 'b', 'c', 'd']);
  const r = insertAt(s, { fdrId: 'low', stackIndex: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.stack.entries.map((e) => [e.fdrId, e.stackIndex]), [['a', 0], ['low', 1], ['b', 2], ['c', 3], ['d', 4]]);
  assert.deepEqual(r.changed, ['low', 'b', 'c', 'd']);
  assert.equal(indexOf(s, 'b'), 1, 'input untouched');
});

test('insertAt into a vacancy moves nobody; a ripple stops at the first vacancy', () => {
  const s = stackOf(['a', 'b', 'c'], { gaps: [1] }); // a0, _, b2, c3
  const fill = insertAt(s, { fdrId: 'n', stackIndex: 1 });
  assert.deepEqual(fill.changed, ['n']);
  const s2 = stackOf(['a', 'b', 'c'], { gaps: [2] }); // a0, b1, _, c3
  const ripple = insertAt(s2, { fdrId: 'n', stackIndex: 0 });
  assert.deepEqual(ripple.stack.entries.map((e) => [e.fdrId, e.stackIndex]), [['n', 0], ['a', 1], ['b', 2], ['c', 3]]);
  assert.deepEqual(ripple.changed, ['n', 'a', 'b'], 'c, above the gap, keeps its altitude and push');
});

test('insertAt refusals', () => {
  const s = stackOf(['a', 'b', 'c'], { pushed: ['a'] });
  const cases = [
    [{ fdrId: 'n', stackIndex: 1.5 }, /integer/],
    [{ fdrId: 'n', stackIndex: -1 }, /≥ 0/],
    [{ fdrId: 'n', stackIndex: 5 }, /gap/],
    [{ fdrId: 'b', stackIndex: 1 }, /already in the stack/],
    [{ fdrId: 'n', stackIndex: 0 }, /already pushed/],
    [{ fdrId: '', stackIndex: 1 }, /fdrId/],
    [{ fdrId: 'n', stackIndex: 1, caseIAngels: 1 }, /caseIAngels/],
  ];
  for (const [op, re] of cases) {
    const r = insertAt(s, op);
    assert.equal(r.ok, false, JSON.stringify(op));
    assert.equal(r.reason, 'VALIDATION_ERROR');
    assert.match(r.detail, re);
  }
  // full: 20 entries (0..19); inserting anywhere pushes the top one above 19
  const full = stackOf(Array.from({ length: 20 }, (_, i) => `f${i}`));
  const r = insertAt(full, { fdrId: 'n', stackIndex: 5 });
  assert.equal(r.ok, false);
  assert.match(r.detail, /full: f19 at 19/);
  assert.equal(append(full, { fdrId: 'n' }).ok, false);
  assert.equal(insertAt(full, { fdrId: 'n', stackIndex: 5 }, { maxIndex: 25 }).ok, true, 'maxIndex is an option');
});

test('append goes to the next free slot above the highest entry', () => {
  const r = append(stackOf(['a', 'b'], { gaps: [1] }), { fdrId: 'n' }); // a0, _, b2
  assert.equal(indexOf(r.stack, 'n'), 3);
  assert.deepEqual(r.changed, ['n']);
  assert.equal(indexOf(append(emptyStack({ hullId: 'CVN-72' }), { fdrId: 'first' }).stack, 'first'), 0);
});

test('markPushed does not renumber: every other entry derives exactly as before (trap T4)', () => {
  const s = stackOf(['a', 'b', 'c', 'd']);
  const before = deriveStack(s, { caseValue: 'III', shipState: SHIP });
  const r = markPushed(s, { fdrId: 'a' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed, ['a']);
  const after = deriveStack(r.stack, { caseValue: 'III', shipState: SHIP });
  for (let i = 1; i < 4; i++) assert.deepEqual(after[i], before[i]);
  assert.equal(after[0].status, 'PUSHED');
  assert.equal(after[0].pushTimeUtc, before[0].pushTimeUtc);
  assert.equal(markPushed(r.stack, { fdrId: 'a' }).ok, false, 'already pushed');
  assert.equal(markPushed(s, { fdrId: 'zz' }).reason, 'NOT_FOUND');
});

test('remove leaves a vacancy by default (decisions H28); closeUp shifts down', () => {
  const s = stackOf(['a', 'b', 'c', 'd']);
  const gap = remove(s, { fdrId: 'b' });
  assert.deepEqual(gap.stack.entries.map((e) => [e.fdrId, e.stackIndex]), [['a', 0], ['c', 2], ['d', 3]]);
  assert.deepEqual(gap.changed, ['b']);
  const closed = remove(s, { fdrId: 'b', closeUp: true });
  assert.deepEqual(closed.stack.entries.map((e) => [e.fdrId, e.stackIndex]), [['a', 0], ['c', 1], ['d', 2]]);
  assert.deepEqual(closed.changed, ['b', 'c', 'd']);
  const later = closeUp(gap.stack, { fromIndex: 1 });
  assert.deepEqual(later.stack.entries, closed.stack.entries);
  assert.deepEqual(later.changed, ['c', 'd']);
  assert.equal(remove(s, { fdrId: 'zz' }).reason, 'NOT_FOUND');
});

test('closeUp refusals: occupied slot, above the stack, a pushed entry above the gap', () => {
  const s = stackOf(['a', 'b', 'c'], { gaps: [1] });
  assert.match(closeUp(s, { fromIndex: 0 }).detail, /occupied/);
  assert.match(closeUp(s, { fromIndex: 9 }).detail, /nothing to close/);
  assert.equal(closeUp(s, { fromIndex: 'x' }).ok, false);
  const p = stackOf(['a', 'b', 'c'], { gaps: [1], pushed: ['b'] });
  assert.match(closeUp(p, { fromIndex: 1 }).detail, /already pushed/);
  assert.equal(remove(p, { fdrId: 'a', closeUp: true }).ok, false);
});

test('move down renumbers exactly the entries it passes; move up leaves the vacancy', () => {
  const s = stackOf(['a', 'b', 'c', 'd', 'e']);
  const down = move(s, { fdrId: 'd', toIndex: 1 });
  assert.equal(down.ok, true);
  assert.deepEqual(down.stack.entries.map((e) => [e.fdrId, e.stackIndex]), [['a', 0], ['d', 1], ['b', 2], ['c', 3], ['e', 4]]);
  assert.deepEqual(down.changed, ['d', 'b', 'c'], 'e above keeps its slot');
  const up = move(s, { fdrId: 'b', toIndex: 3 });
  assert.equal(up.ok, true);
  assert.deepEqual(up.stack.entries.map((e) => [e.fdrId, e.stackIndex]), [['a', 0], ['c', 2], ['b', 3], ['d', 4], ['e', 5]]);
  assert.deepEqual(up.changed, ['b', 'd', 'e']);
  const top = move(s, { fdrId: 'a', toIndex: 5 });
  assert.equal(top.ok, true, 'to the free slot above the top');
  assert.equal(indexOf(top.stack, 'a'), 5);
});

test('move refusals', () => {
  const s = stackOf(['a', 'b', 'c'], { pushed: ['a'] });
  assert.equal(move(s, { fdrId: 'zz', toIndex: 1 }).reason, 'NOT_FOUND');
  assert.match(move(s, { fdrId: 'a', toIndex: 2 }).detail, /already pushed/);
  assert.match(move(s, { fdrId: 'b', toIndex: 1 }).detail, /already at/);
  assert.match(move(s, { fdrId: 'c', toIndex: 0 }).detail, /already pushed/);
  assert.match(move(s, { fdrId: 'b', toIndex: 7 }).detail, /gap/);
});

test('setCharlieTime changes every push time and nothing else', () => {
  const s = stackOf(['a', 'b', 'c'], { pushed: ['a'] });
  const r = setCharlieTime(s, { charlieTimeUtc: CHARLIE + 5 * 60_000 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed, ['b', 'c'], 'every HOLDING entry');
  const before = deriveStack(s, { caseValue: 'III', shipState: SHIP });
  const after = deriveStack(r.stack, { caseValue: 'III', shipState: SHIP });
  for (let i = 0; i < 3; i++) {
    assert.equal(after[i].pushTimeUtc - before[i].pushTimeUtc, 5 * 60_000);
    const { pushTimeUtc: _a, pushWindowUtc: _b, ...restA } = after[i];
    const { pushTimeUtc: _c, pushWindowUtc: _d, ...restB } = before[i];
    assert.deepEqual(restA, restB);
  }
  assert.equal(setCharlieTime(s, { charlieTimeUtc: 'now' }).ok, false);
  assert.equal(setCharlieTime(s, { charlieTimeUtc: CHARLIE }).ok, false, 'unchanged');
  assert.equal(setCharlieTime(s, { charlieTimeUtc: null }).ok, true, 'clearable');
});

test('setCaseIAngels: integer 2..20 or null, one entry changed', () => {
  const s = stackOf(['a', 'b']);
  const r = setCaseIAngels(s, { fdrId: 'b', caseIAngels: 3 });
  assert.deepEqual(r.changed, ['b']);
  assert.equal(r.stack.entries[1].caseIAngels, 3);
  assert.equal(setCaseIAngels(s, { fdrId: 'b', caseIAngels: 1 }).ok, false);
  assert.equal(setCaseIAngels(s, { fdrId: 'b', caseIAngels: 21 }).ok, false);
  assert.equal(setCaseIAngels(s, { fdrId: 'b', caseIAngels: 2.5 }).ok, false);
  assert.equal(setCaseIAngels(s, { fdrId: 'b' }).ok, false);
  assert.equal(setCaseIAngels(s, { fdrId: 'zz', caseIAngels: 3 }).reason, 'NOT_FOUND');
});

test('setMarshalRadial: Marshal sets it, null restores the default; every entry changes', () => {
  const s = stackOf(['a', 'b']);
  const r = setMarshalRadial(s, { marshalRadialDeg: 290 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed, ['a', 'b']);
  assert.equal(deriveStack(r.stack, { caseValue: 'III', shipState: SHIP })[0].marshalRadialDeg, 290);
  const back = setMarshalRadial(r.stack, { marshalRadialDeg: null });
  assert.equal(deriveStack(back.stack, { caseValue: 'III', shipState: SHIP })[0].marshalRadialDeg, 295);
  assert.equal(setMarshalRadial(s, { marshalRadialDeg: 360 }).ok, false);
  assert.equal(setMarshalRadial(s, { marshalRadialDeg: -5 }).ok, false);
  assert.equal(setMarshalRadial(s, { marshalRadialDeg: null }).ok, false, 'unchanged');
});

test('applyStackOp dispatches every STACK_OP_KIND and refuses anything else', () => {
  const s = stackOf(['a', 'b', 'c'], { gaps: [1] });
  const ops = {
    InsertAt: { fdrId: 'n', stackIndex: 1 },
    Append: { fdrId: 'n' },
    Move: { fdrId: 'c', toIndex: 1 },
    Remove: { fdrId: 'a' },
    CloseUp: { fromIndex: 1 },
    MarkPushed: { fdrId: 'a' },
    SetCharlieTime: { charlieTimeUtc: CHARLIE + 1 },
    SetCaseIAngels: { fdrId: 'a', caseIAngels: 2 },
    SetMarshalRadial: { marshalRadialDeg: 10 },
  };
  assert.deepEqual(Object.keys(ops).sort(), [...STACK_OP_KINDS].sort());
  for (const [kind, op] of Object.entries(ops)) {
    const r = applyStackOp(s, { kind, ...op });
    assert.equal(r.ok, true, kind);
    assert.equal(validateStack(r.stack).ok, true, kind);
  }
  for (const kind of ['SetAngels', 'SetDme', 'SetPushTime', 'toString', '__proto__']) {
    const r = applyStackOp(s, { kind, value: 1 });
    assert.equal(r.ok, false, kind);
    assert.equal(r.reason, 'VALIDATION_ERROR');
  }
  assert.equal(applyStackOp(s, null).ok, false);
  assert.equal(applyStackOp(null, { kind: 'Append', fdrId: 'x' }).ok, false, 'never throws on a bad stack');
});

test('no op mutates its input (deep-frozen inputs do not throw)', () => {
  const s = stackOf(['a', 'b', 'c', 'd'], { gaps: [2] });
  const snapshot = JSON.stringify(s);
  insertAt(s, { fdrId: 'n', stackIndex: 0 });
  append(s, { fdrId: 'n' });
  move(s, { fdrId: 'd', toIndex: 0 });
  remove(s, { fdrId: 'a', closeUp: true });
  closeUp(s, { fromIndex: 2 });
  markPushed(s, { fdrId: 'a' });
  setCharlieTime(s, { charlieTimeUtc: 1 });
  setCaseIAngels(s, { fdrId: 'a', caseIAngels: 5 });
  setMarshalRadial(s, { marshalRadialDeg: 5 });
  deriveStack(s, { caseValue: 'III', shipState: SHIP });
  assert.equal(JSON.stringify(s), snapshot);
});
