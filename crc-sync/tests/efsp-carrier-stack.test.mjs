import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ENTRY_KEYS, STACK_OP_KINDS, STACK_DEFAULTS, DEFAULT_STACK_ID,
  emptyStack, validateStack, normalizeStack, deriveEntry, deriveStack, checkConsistency,
  insertAt, append, move, remove, closeUp, markPushed, setCaseIAngels, applyStackOp,
} from '../src/efsp/carrier/marshal-stack.js';

// Guide §9.12 "Case III — one integer drives four displayed fields", and its
// rules 1–3. docs/adr/0064.

const CHARLIE = Date.UTC(2026, 8, 30, 14, 30, 0); // mission Zulu (decisions H11)
// What the derivation reads (carrier-state.js recoveryInputs): the resolved values, plainly (docs/adr/0113).
const FIX_TO_RAMP = 6 * 60_000;
const inputs = (o = {}) => ({
  caseValue: 'III', rampTimeUtc: null, finalBearingDeg: null, marshalRadialDeg: null, marshalRadialSource: null,
  firstFixDme: 21, fixToRampMs: FIX_TO_RAMP, pushSpacingMs: 60_000, ...o,
});
const withShip = (o = {}) => inputs({ finalBearingDeg: 115, marshalRadialDeg: 295, marshalRadialSource: 'FINAL_BEARING', ...o });

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

function stackOf(ids, { pushed = [], gaps = [] } = {}) {
  const s = emptyStack({ stackId: 'MAIN', hullId: 'CVN-72' });
  let idx = 0;
  const entries = [];
  for (const id of ids) {
    while (gaps.includes(idx)) idx++;
    entries.push({ flightDataId: id, stackIndex: idx, status: pushed.includes(id) ? 'PUSHED' : 'HOLDING', caseIAngels: null });
    idx++;
  }
  return deepFreeze({ ...s, entries });
}

function indexOf(stack, id) {
  const e = stack.entries.find((x) => x.flightDataId === id);
  return e ? e.stackIndex : undefined;
}

// ── Shape ────────────────────────────────────────────────────────────────────

test('emptyStack is keyed by stackId (decisions H29) and holds no derived value', () => {
  const s = emptyStack({ hullId: 'CVN-72' });
  assert.equal(s.stackId, DEFAULT_STACK_ID);
  assert.deepEqual(s, { stackId: 'MAIN', hullId: 'CVN-72', entries: [] });
  assert.deepEqual([...ENTRY_KEYS], ['flightDataId', 'stackIndex', 'status', 'caseIAngels']);
  assert.equal(STACK_DEFAULTS.maxIndex, 19);
});

test('validateStack refuses derived keys by name; normalizeStack drops them', () => {
  for (const k of ['angels', 'marshalDme', 'pushTimeUtc', 'marshalRadialDeg']) {
    const s = { ...emptyStack({ hullId: 'CVN-72' }), entries: [{ flightDataId: 'a', stackIndex: 0, status: 'HOLDING', caseIAngels: null, [k]: 99 }] };
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
  const e = (flightDataId, stackIndex, extra = {}) => ({ flightDataId, stackIndex, status: 'HOLDING', caseIAngels: null, ...extra });
  assert.equal(validateStack({ ...base, entries: [e('a', 0), e('a', 1)] }).ok, false);
  assert.equal(validateStack({ ...base, entries: [e('a', 0), e('b', 0)] }).ok, false);
  assert.equal(validateStack({ ...base, entries: [e('a', 1), e('b', 0)] }).ok, false);
  assert.equal(validateStack({ ...base, entries: [e('a', 20)] }).ok, false);
  assert.equal(validateStack({ ...base, entries: [e('a', 1.5)] }).ok, false);
  assert.equal(validateStack({ ...base, entries: [e('a', 0, { status: 'GONE' })] }).ok, false);
  assert.equal(validateStack({ ...base, entries: [e('a', 0, { caseIAngels: 1 })] }).ok, false);
  assert.equal(validateStack({ ...base, entries: [e('a', 0, { stripId: 's1' })] }).ok, false, 'keyed by flightDataId, never stripId');
  assert.equal(validateStack({ ...base, bogus: 1 }).ok, false);
  assert.equal(validateStack(null).ok, false);
  assert.equal(validateStack({ ...base, entries: [e('a', 0), e('b', 3)] }).ok, true, 'a vacancy is legitimate');
});

test('normalizeStack never refuses; it drops what cannot be kept and says so', () => {
  const n = normalizeStack({
    stackId: 'MAIN', hullId: 'CVN-72', charlieTimeUtc: 'soon', // an older shape's key is dropped, not read
    entries: [
      { flightDataId: 'b', stackIndex: 1, status: 'HOLDING' },
      { flightDataId: 'a', stackIndex: 0, status: 'WEIRD', angels: 6 },
      { flightDataId: 'a', stackIndex: 2 },
      { flightDataId: 'c', stackIndex: 1 },
      { stackIndex: 3 },
      { flightDataId: 'd', stackIndex: 99 },
    ],
  });
  assert.equal(n.ok, true);
  assert.deepEqual(n.stack.entries.map((e) => [e.flightDataId, e.stackIndex, e.status]), [['a', 0, 'HOLDING'], ['b', 1, 'HOLDING']]);
  assert.equal('charlieTimeUtc' in n.stack, false);
  assert.equal(n.dropped.length, 4);
  assert.equal(validateStack(n.stack).ok, true);
  assert.equal(normalizeStack(undefined, { hullId: 'CVN-72' }).stack.hullId, 'CVN-72');
});

// ── Derivation ───────────────────────────────────────────────────────────────

test('deriveEntry Case III: §9.12 worked example — index 2 → angels 8 → DME 23; the EAT is worked back from the ramp time (ADR 0113)', () => {
  const d = deriveEntry({ flightDataId: 'x', stackIndex: 2, status: 'HOLDING', caseIAngels: null },
    withShip({ rampTimeUtc: CHARLIE }));
  assert.equal(d.angels, 8);
  assert.equal(d.marshalDme, 23);
  assert.equal(d.rampEtaUtc, CHARLIE + 2 * 60_000, 'slot 2 lands two minutes behind the first');
  assert.equal(d.pushTimeUtc, CHARLIE + 2 * 60_000 - FIX_TO_RAMP, 'and leaves its fix the fix-to-ramp time earlier');
  assert.deepEqual([...d.pushWindowUtc], [d.pushTimeUtc - 10_000, d.pushTimeUtc + 10_000]);
  assert.equal(d.expectedFinalBearingDeg, 115);
  assert.equal(d.marshalRadialDeg, 295, 'decisions H27: default final bearing + 180');
  assert.equal(d.marshalRadialSource, 'FINAL_BEARING');
  assert.equal(d.minimumAltitudeOk, true);
  assert.ok(Object.isFrozen(d));
});

test('deriveEntry: index 0 is the §9.12 minimum 6,000 ft, and every index stays ≥ 6', () => {
  for (let i = 0; i <= STACK_DEFAULTS.maxIndex; i++) {
    const d = deriveEntry({ flightDataId: 'x', stackIndex: i, status: 'HOLDING', caseIAngels: null }, inputs());
    assert.equal(d.angels, 6 + i);
    assert.equal(d.minimumAltitudeOk, true);
  }
});

test('deriveEntry: a set marshal radial wins over the default (decisions H27)', () => {
  const d = deriveEntry({ flightDataId: 'x', stackIndex: 0, status: 'HOLDING', caseIAngels: null },
    withShip({ marshalRadialDeg: 300, marshalRadialSource: 'SET' }));
  assert.equal(d.marshalRadialDeg, 300);
  assert.equal(d.marshalRadialSource, 'SET');
});

test('deriveEntry: the first fix moves every slot\'s DME (ADR 0113); angels stay 6 + index', () => {
  const d = deriveEntry({ flightDataId: 'x', stackIndex: 2, status: 'HOLDING', caseIAngels: null }, withShip({ firstFixDme: 25 }));
  assert.equal(d.angels, 8);
  assert.equal(d.marshalDme, 27);
  assert.equal(d.firstFixDme, 25);
  assert.deepEqual(checkConsistency([{ ...d, expectedFinalBearingDeg: 115, marshalRadialDeg: 295 }]), [], 'DME - angels is the first fix less 6');
});

test('deriveEntry: unknown ramp time or final bearing → null, never invented', () => {
  const d = deriveEntry({ flightDataId: 'x', stackIndex: 1, status: 'HOLDING', caseIAngels: null }, inputs());
  assert.equal(d.pushTimeUtc, null);
  assert.equal(d.pushWindowUtc, null);
  assert.equal(d.marshalRadialDeg, null);
  assert.equal(d.expectedFinalBearingDeg, null);
  assert.equal(d.angels, 7, 'angels and DME need nothing but the index');
  assert.equal(d.marshalDme, 22);
});

test('deriveEntry Case I: altitude-keyed, no DME, no push, no radial (§9.12 rule 3)', () => {
  const d = deriveEntry({ flightDataId: 'x', stackIndex: 3, status: 'HOLDING', caseIAngels: 4 },
    withShip({ caseValue: 'I', rampTimeUtc: CHARLIE }));
  assert.equal(d.angels, 4);
  assert.equal(d.marshalDme, null);
  assert.equal(d.pushTimeUtc, null);
  assert.equal(d.pushWindowUtc, null);
  assert.equal(d.marshalRadialDeg, null);
  assert.equal(d.expectedFinalBearingDeg, 115);
  const unassigned = deriveEntry({ flightDataId: 'y', stackIndex: 0, status: 'HOLDING', caseIAngels: null }, inputs({ caseValue: 'I' }));
  assert.equal(unassigned.angels, null, 'the Strip shows "assign altitude"');
});

test('checkConsistency passes on every derived stack and fails on a hand-built bad one', () => {
  const s = stackOf(['a', 'b', 'c', 'd']);
  for (const c of ['I', 'II', 'III']) assert.deepEqual(checkConsistency(deriveStack(s, withShip({ caseValue: c }))), []);
  const bad = { flightDataId: 'z', caseValue: 'III', angels: 8, marshalDme: 25, marshalRadialDeg: 90, expectedFinalBearingDeg: 115 };
  const codes = checkConsistency([bad]).map((x) => x.code);
  assert.deepEqual(codes.sort(), ['DME_NOT_ANGELS_PLUS_15', 'RADIAL_NOT_RECIPROCAL_OF_FINAL_BEARING']);
  // a controller-set radial within tolerance is fine; outside it is flagged
  const near = withShip({ marshalRadialDeg: 305, marshalRadialSource: 'SET' });
  assert.deepEqual(checkConsistency(deriveStack(s, near)), []);
  const far = withShip({ marshalRadialDeg: 330, marshalRadialSource: 'SET' });
  assert.equal(checkConsistency(deriveStack(s, far)).length, 4);
  assert.equal(checkConsistency(deriveStack(s, far), { radialToleranceDeg: 40 }).length, 0);
});

// ── Ops ──────────────────────────────────────────────────────────────────────

test('insertAt renumbers everyone at or above, together, in one returned stack', () => {
  const s = stackOf(['a', 'b', 'c', 'd']);
  const r = insertAt(s, { flightDataId: 'low', stackIndex: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.stack.entries.map((e) => [e.flightDataId, e.stackIndex]), [['a', 0], ['low', 1], ['b', 2], ['c', 3], ['d', 4]]);
  assert.deepEqual(r.changed, ['low', 'b', 'c', 'd']);
  assert.equal(indexOf(s, 'b'), 1, 'input untouched');
});

test('insertAt into a vacancy moves nobody; a ripple stops at the first vacancy', () => {
  const s = stackOf(['a', 'b', 'c'], { gaps: [1] }); // a0, _, b2, c3
  const fill = insertAt(s, { flightDataId: 'n', stackIndex: 1 });
  assert.deepEqual(fill.changed, ['n']);
  const s2 = stackOf(['a', 'b', 'c'], { gaps: [2] }); // a0, b1, _, c3
  const ripple = insertAt(s2, { flightDataId: 'n', stackIndex: 0 });
  assert.deepEqual(ripple.stack.entries.map((e) => [e.flightDataId, e.stackIndex]), [['n', 0], ['a', 1], ['b', 2], ['c', 3]]);
  assert.deepEqual(ripple.changed, ['n', 'a', 'b'], 'c, above the gap, keeps its altitude and push');
});

test('insertAt refusals', () => {
  const s = stackOf(['a', 'b', 'c'], { pushed: ['a'] });
  const cases = [
    [{ flightDataId: 'n', stackIndex: 1.5 }, /integer/],
    [{ flightDataId: 'n', stackIndex: -1 }, /≥ 0/],
    [{ flightDataId: 'n', stackIndex: 5 }, /gap/],
    [{ flightDataId: 'b', stackIndex: 1 }, /already in the stack/],
    [{ flightDataId: 'n', stackIndex: 0 }, /already pushed/],
    [{ flightDataId: '', stackIndex: 1 }, /flightDataId/],
    [{ flightDataId: 'n', stackIndex: 1, caseIAngels: 1 }, /caseIAngels/],
  ];
  for (const [op, re] of cases) {
    const r = insertAt(s, op);
    assert.equal(r.ok, false, JSON.stringify(op));
    assert.equal(r.reason, 'VALIDATION_ERROR');
    assert.match(r.detail, re);
  }
  // full: 20 entries (0..19); inserting anywhere pushes the top one above 19
  const full = stackOf(Array.from({ length: 20 }, (_, i) => `f${i}`));
  const r = insertAt(full, { flightDataId: 'n', stackIndex: 5 });
  assert.equal(r.ok, false);
  assert.match(r.detail, /full: f19 at 19/);
  assert.equal(append(full, { flightDataId: 'n' }).ok, false);
  assert.equal(insertAt(full, { flightDataId: 'n', stackIndex: 5 }, { maxIndex: 25 }).ok, true, 'maxIndex is an option');
});

test('append goes to the next free slot above the highest entry', () => {
  const r = append(stackOf(['a', 'b'], { gaps: [1] }), { flightDataId: 'n' }); // a0, _, b2
  assert.equal(indexOf(r.stack, 'n'), 3);
  assert.deepEqual(r.changed, ['n']);
  assert.equal(indexOf(append(emptyStack({ hullId: 'CVN-72' }), { flightDataId: 'first' }).stack, 'first'), 0);
});

test('markPushed does not renumber: every other entry derives exactly as before (trap T4)', () => {
  const s = stackOf(['a', 'b', 'c', 'd']);
  const before = deriveStack(s, withShip());
  const r = markPushed(s, { flightDataId: 'a' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed, ['a']);
  const after = deriveStack(r.stack, withShip());
  for (let i = 1; i < 4; i++) assert.deepEqual(after[i], before[i]);
  assert.equal(after[0].status, 'PUSHED');
  assert.equal(after[0].pushTimeUtc, before[0].pushTimeUtc);
  assert.equal(markPushed(r.stack, { flightDataId: 'a' }).ok, false, 'already pushed');
  assert.equal(markPushed(s, { flightDataId: 'zz' }).reason, 'NOT_FOUND');
});

test('remove leaves a vacancy by default (decisions H28); closeUp shifts down', () => {
  const s = stackOf(['a', 'b', 'c', 'd']);
  const gap = remove(s, { flightDataId: 'b' });
  assert.deepEqual(gap.stack.entries.map((e) => [e.flightDataId, e.stackIndex]), [['a', 0], ['c', 2], ['d', 3]]);
  assert.deepEqual(gap.changed, ['b']);
  const closed = remove(s, { flightDataId: 'b', closeUp: true });
  assert.deepEqual(closed.stack.entries.map((e) => [e.flightDataId, e.stackIndex]), [['a', 0], ['c', 1], ['d', 2]]);
  assert.deepEqual(closed.changed, ['b', 'c', 'd']);
  const later = closeUp(gap.stack, { fromIndex: 1 });
  assert.deepEqual(later.stack.entries, closed.stack.entries);
  assert.deepEqual(later.changed, ['c', 'd']);
  assert.equal(remove(s, { flightDataId: 'zz' }).reason, 'NOT_FOUND');
});

test('closeUp refusals: occupied slot, above the stack, a pushed entry above the gap', () => {
  const s = stackOf(['a', 'b', 'c'], { gaps: [1] });
  assert.match(closeUp(s, { fromIndex: 0 }).detail, /occupied/);
  assert.match(closeUp(s, { fromIndex: 9 }).detail, /nothing to close/);
  assert.equal(closeUp(s, { fromIndex: 'x' }).ok, false);
  const p = stackOf(['a', 'b', 'c'], { gaps: [1], pushed: ['b'] });
  assert.match(closeUp(p, { fromIndex: 1 }).detail, /already pushed/);
  assert.equal(remove(p, { flightDataId: 'a', closeUp: true }).ok, false);
});

test('move down renumbers exactly the entries it passes; move up leaves the vacancy', () => {
  const s = stackOf(['a', 'b', 'c', 'd', 'e']);
  const down = move(s, { flightDataId: 'd', toIndex: 1 });
  assert.equal(down.ok, true);
  assert.deepEqual(down.stack.entries.map((e) => [e.flightDataId, e.stackIndex]), [['a', 0], ['d', 1], ['b', 2], ['c', 3], ['e', 4]]);
  assert.deepEqual(down.changed, ['d', 'b', 'c'], 'e above keeps its slot');
  const up = move(s, { flightDataId: 'b', toIndex: 3 });
  assert.equal(up.ok, true);
  assert.deepEqual(up.stack.entries.map((e) => [e.flightDataId, e.stackIndex]), [['a', 0], ['c', 2], ['b', 3], ['d', 4], ['e', 5]]);
  assert.deepEqual(up.changed, ['b', 'd', 'e']);
  const top = move(s, { flightDataId: 'a', toIndex: 5 });
  assert.equal(top.ok, true, 'to the free slot above the top');
  assert.equal(indexOf(top.stack, 'a'), 5);
});

test('move refusals', () => {
  const s = stackOf(['a', 'b', 'c'], { pushed: ['a'] });
  assert.equal(move(s, { flightDataId: 'zz', toIndex: 1 }).reason, 'NOT_FOUND');
  assert.match(move(s, { flightDataId: 'a', toIndex: 2 }).detail, /already pushed/);
  assert.match(move(s, { flightDataId: 'b', toIndex: 1 }).detail, /already at/);
  assert.match(move(s, { flightDataId: 'c', toIndex: 0 }).detail, /already pushed/);
  assert.match(move(s, { flightDataId: 'b', toIndex: 7 }).detail, /gap/);
});

test('a ramp-time change moves every EAT by the same amount and nothing else (the stack holds no time, ADR 0113)', () => {
  const s = stackOf(['a', 'b', 'c'], { pushed: ['a'] });
  const before = deriveStack(s, withShip({ rampTimeUtc: CHARLIE }));
  const after = deriveStack(s, withShip({ rampTimeUtc: CHARLIE + 5 * 60_000 }));
  for (let i = 0; i < 3; i++) {
    assert.equal(after[i].pushTimeUtc - before[i].pushTimeUtc, 5 * 60_000);
    const { pushTimeUtc: _a, pushWindowUtc: _b, rampEtaUtc: _e, ...restA } = after[i];
    const { pushTimeUtc: _c, pushWindowUtc: _d, rampEtaUtc: _f, ...restB } = before[i];
    assert.deepEqual(restA, restB);
  }
});

test('setCaseIAngels: integer 2..20 or null, one entry changed', () => {
  const s = stackOf(['a', 'b']);
  const r = setCaseIAngels(s, { flightDataId: 'b', caseIAngels: 3 });
  assert.deepEqual(r.changed, ['b']);
  assert.equal(r.stack.entries[1].caseIAngels, 3);
  assert.equal(setCaseIAngels(s, { flightDataId: 'b', caseIAngels: 1 }).ok, false);
  assert.equal(setCaseIAngels(s, { flightDataId: 'b', caseIAngels: 21 }).ok, false);
  assert.equal(setCaseIAngels(s, { flightDataId: 'b', caseIAngels: 2.5 }).ok, false);
  assert.equal(setCaseIAngels(s, { flightDataId: 'b' }).ok, false);
  assert.equal(setCaseIAngels(s, { flightDataId: 'zz', caseIAngels: 3 }).reason, 'NOT_FOUND');
});

test('applyStackOp dispatches every STACK_OP_KIND and refuses anything else', () => {
  const s = stackOf(['a', 'b', 'c'], { gaps: [1] });
  const ops = {
    InsertAt: { flightDataId: 'n', stackIndex: 1 },
    Append: { flightDataId: 'n' },
    Move: { flightDataId: 'c', toIndex: 1 },
    Remove: { flightDataId: 'a' },
    CloseUp: { fromIndex: 1 },
    MarkPushed: { flightDataId: 'a' },
    SetCaseIAngels: { flightDataId: 'a', caseIAngels: 2 },
  };
  assert.deepEqual(Object.keys(ops).sort(), [...STACK_OP_KINDS].sort());
  for (const [kind, op] of Object.entries(ops)) {
    const r = applyStackOp(s, { kind, ...op });
    assert.equal(r.ok, true, kind);
    assert.equal(validateStack(r.stack).ok, true, kind);
  }
  for (const kind of ['SetAngels', 'SetDme', 'SetPushTime', 'SetCharlieTime', 'SetMarshalRadial', 'toString', '__proto__']) {
    const r = applyStackOp(s, { kind, value: 1 });
    assert.equal(r.ok, false, kind);
    assert.equal(r.reason, 'VALIDATION_ERROR');
  }
  assert.equal(applyStackOp(s, null).ok, false);
  assert.equal(applyStackOp(null, { kind: 'Append', flightDataId: 'x' }).ok, false, 'never throws on a bad stack');
});

test('no op mutates its input (deep-frozen inputs do not throw)', () => {
  const s = stackOf(['a', 'b', 'c', 'd'], { gaps: [2] });
  const snapshot = JSON.stringify(s);
  insertAt(s, { flightDataId: 'n', stackIndex: 0 });
  append(s, { flightDataId: 'n' });
  move(s, { flightDataId: 'd', toIndex: 0 });
  remove(s, { flightDataId: 'a', closeUp: true });
  closeUp(s, { fromIndex: 2 });
  markPushed(s, { flightDataId: 'a' });
  setCaseIAngels(s, { flightDataId: 'a', caseIAngels: 5 });
  deriveStack(s, withShip());
  assert.equal(JSON.stringify(s), snapshot);
});
