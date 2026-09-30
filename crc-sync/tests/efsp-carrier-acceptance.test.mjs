import test from 'node:test';
import assert from 'node:assert/strict';

// WP7A acceptance (EFSPImplementationGuide.md §13, lines 1406-1415) — the
// bullets that belong to lane L4 (1, 2, 5), word for word as test names, plus
// the pure halves of bullet 3 (Case re-renders every Strip) and bullet 8
// (EEAT survives launch → recovery), which L17 completes at the wire and UI.
// Imported through the barrel on purpose: it is what L17 will import.
// docs/adr/0064.

import {
  emptyStack, insertAt, deriveStack, deriveEntry, validateStack, normalizeStack, applyStackOp, STACK_OP_KINDS,
  buildShipState, applyShipStateInput, defaultShipInputs, normDeg, DEFAULT_HULL,
  defaultCarrierFlight, setCarrierFlightField, normalizeCarrierFlight, marshalMessage,
} from '../src/efsp/carrier/index.js';

const CHARLIE = Date.UTC(2026, 8, 30, 14, 30, 0);
const SHIP = Object.freeze({ finalBearingDeg: 115, headingRef: 'TRUE' });

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

function fiveStack({ caseIAngels = null } = {}) {
  const entries = ['fdr-a', 'fdr-b', 'fdr-c', 'fdr-d', 'fdr-e'].map((fdrId, i) => ({
    fdrId, stackIndex: i, status: 'HOLDING', caseIAngels: caseIAngels == null ? null : caseIAngels + i,
  }));
  return deepFreeze({ ...emptyStack({ hullId: 'CVN-72' }), charlieTimeUtc: CHARLIE, entries });
}

test('Inserting an aircraft low in the marshal stack renumbers altitude, DME and push time for everyone above it, in one gesture.', () => {
  const stack = fiveStack();
  const before = deriveStack(stack, { caseValue: 'III', shipState: SHIP });

  const result = insertAt(stack, { fdrId: 'fdr-low', stackIndex: 1 }); // ONE call

  assert.equal(result.ok, true);
  const after = new Map(deriveStack(result.stack, { caseValue: 'III', shipState: SHIP }).map((d) => [d.fdrId, d]));
  // the entry below is untouched
  assert.deepEqual(after.get('fdr-a'), before[0]);
  // every entry formerly at ≥ 1 moved up together: index +1, angels +1, DME +1, push +60 s
  for (const old of before.slice(1)) {
    const now = after.get(old.fdrId);
    assert.equal(now.stackIndex, old.stackIndex + 1, old.fdrId);
    assert.equal(now.angels, old.angels + 1, old.fdrId);
    assert.equal(now.marshalDme, old.marshalDme + 1, old.fdrId);
    assert.equal(now.pushTimeUtc, old.pushTimeUtc + 60_000, old.fdrId);
  }
  // the low-fuel aircraft took the slot and its values
  assert.equal(after.get('fdr-low').angels, 7);
  assert.equal(after.get('fdr-low').marshalDme, 22);
  assert.equal(after.get('fdr-low').pushTimeUtc, CHARLIE + 60_000);
  // one delta: exactly the inserted flight and everyone shifted, in stack order
  assert.deepEqual(result.changed, ['fdr-low', 'fdr-b', 'fdr-c', 'fdr-d', 'fdr-e']);
  // and the input stack is unchanged
  assert.equal(stack.entries[1].fdrId, 'fdr-b');
  assert.equal(stack.entries[1].stackIndex, 1);
});

test('Marshal DME, angels and push time are not independently editable.', () => {
  const stack = fiveStack();
  // (a) no op names them, and trying one is refused
  // SetCaseIAngels is the one exception by name, and not by substance: it sets
  // Case I's squadron-assigned altitude (§9.12 rule 3), which the sequenced
  // derivation never reads — proved right here.
  for (const kind of STACK_OP_KINDS.filter((k) => k !== 'SetCaseIAngels')) assert.doesNotMatch(kind, /angel|dme|push ?time/i);
  const caseI = applyStackOp(stack, { kind: 'SetCaseIAngels', fdrId: 'fdr-b', caseIAngels: 12 });
  assert.equal(caseI.ok, true);
  assert.deepEqual(
    deriveStack(caseI.stack, { caseValue: 'III', shipState: SHIP }),
    deriveStack(stack, { caseValue: 'III', shipState: SHIP }),
  );
  for (const kind of ['SetAngels', 'SetDme', 'SetMarshalDme', 'SetPushTime']) {
    const r = applyStackOp(stack, { kind, fdrId: 'fdr-b', value: 12 });
    assert.equal(r.ok, false, kind);
    assert.equal(r.reason, 'VALIDATION_ERROR');
  }
  // (b) a stored entry carrying one is refused
  for (const key of ['angels', 'marshalDme', 'pushTimeUtc']) {
    const bad = { ...stack, entries: stack.entries.map((e, i) => (i === 2 ? { ...e, [key]: 99 } : e)) };
    const r = validateStack(bad);
    assert.equal(r.ok, false, key);
    assert.match(r.detail, /derived from the stack index \(§9\.12\) and cannot be set/);
  }
  // (c) restore drops them, and the derivation recomputes §9.12's values whatever was supplied
  const junk = { ...stack, entries: stack.entries.map((e) => ({ ...e, angels: 40, marshalDme: 1, pushTimeUtc: 0 })) };
  const restored = normalizeStack(junk).stack;
  const d = deriveStack(restored, { caseValue: 'III', shipState: SHIP })[2];
  assert.equal(d.angels, 8);
  assert.equal(d.marshalDme, 23);
  assert.equal(d.pushTimeUtc, CHARLIE + 120_000);
  assert.equal(deriveEntry({ ...stack.entries[2], angels: 40, marshalDme: 1 }, { caseValue: 'III' }).angels, 8);
  // (d) the derived object is frozen: assigning to it throws (ESM is strict)
  assert.throws(() => { d.marshalDme = 30; }, TypeError);
  assert.throws(() => { d.angels = 9; }, TypeError);
  assert.throws(() => { d.pushTimeUtc = 1; }, TypeError);
});

test('Final bearing is computed from ship heading and cannot be hand-entered.', () => {
  const track = { id: 7, name: 'UNION', type: 'CVN_72', coalition: 3, category: 4, lat: 34.5, lon: 34, heading: 211.4, groundSpeed: 12 };
  const H = track.heading;
  const s = buildShipState({ hull: DEFAULT_HULL, track, now: CHARLIE });
  assert.equal(s.finalBearingDeg, normDeg(Math.round(H) - 9));
  // changing only the heading changes the final bearing
  const turned = buildShipState({ hull: DEFAULT_HULL, track: { ...track, heading: 250 }, now: CHARLIE });
  assert.equal(turned.finalBearingDeg, 241);
  // it cannot be entered
  const typed = applyShipStateInput(defaultShipInputs(), { finalBearingDeg: 200 });
  assert.equal(typed.ok, false);
  assert.equal(typed.reason, 'VALIDATION_ERROR');
  // and a finalBearingDeg riding on any input is ignored
  const sneaky = buildShipState({
    hull: { ...DEFAULT_HULL, finalBearingDeg: 200 },
    track: { ...track, finalBearingDeg: 200, brcDeg: 200 },
    inputs: { altimeterInHg: 29.9, finalBearingDeg: 200 },
    now: CHARLIE,
  });
  assert.equal(sneaky.finalBearingDeg, s.finalBearingDeg);
});

test('Changing the Case re-derives every carrier entry at once — one Case value, every derived field follows', () => {
  const stack = fiveStack({ caseIAngels: 2 });
  const iii = deriveStack(stack, { caseValue: 'III', shipState: SHIP });
  const i = deriveStack(stack, { caseValue: 'I', shipState: SHIP });
  const ii = deriveStack(stack, { caseValue: 'II', shipState: SHIP });
  // one changed input, no stack op: EVERY entry differs in every sequenced field
  assert.equal(iii.length, 5);
  for (let k = 0; k < 5; k++) {
    assert.notEqual(i[k].angels, iii[k].angels, `angels ${k}`);
    assert.notEqual(i[k].marshalDme, iii[k].marshalDme, `dme ${k}`);
    assert.notEqual(i[k].pushTimeUtc, iii[k].pushTimeUtc, `push ${k}`);
    assert.notEqual(i[k].marshalRadialDeg, iii[k].marshalRadialDeg, `radial ${k}`);
    assert.equal(i[k].caseValue, 'I');
    assert.equal(iii[k].caseValue, 'III');
  }
  // Case II derives exactly like Case III outside 10 NM (L4 briefing Q3 default) —
  // asserted so a later change to Case II's derivation is a visible decision.
  for (let k = 0; k < 5; k++) {
    assert.equal(ii[k].angels, iii[k].angels);
    assert.equal(ii[k].marshalDme, iii[k].marshalDme);
    assert.equal(ii[k].pushTimeUtc, iii[k].pushTimeUtc);
    assert.equal(ii[k].marshalRadialDeg, iii[k].marshalRadialDeg);
  }
});

test('EEAT set before launch is still present on the recovery marshal message', () => {
  const EEAT = Date.UTC(2026, 8, 30, 15, 10, 0);
  // E1 — set on the flight while it has only a launch Strip …
  const fdr = {
    fdrId: 'fdr-a',
    identity: { callsign: 'HORNET 11', aircraftType: 'FA18C' },
    military: { carrier: setCarrierFlightField(defaultCarrierFlight(), 'eeatUtc', EEAT).flight },
  };
  // … and later, on recovery, the marshal message built from the stack derivation carries it
  const derived = deriveEntry({ fdrId: 'fdr-a', stackIndex: 0, status: 'HOLDING', caseIAngels: null },
    { caseValue: 'III', charlieTimeUtc: CHARLIE, shipState: SHIP });
  const eeat = marshalMessage({ fdr, derived, caseValue: 'III', shipState: SHIP }).find((x) => x.key === 'eeat');
  assert.equal(eeat.value, EEAT);
  // E2 — the restore path keeps it
  assert.equal(normalizeCarrierFlight(JSON.parse(JSON.stringify(fdr.military.carrier))).eeatUtc, EEAT);
});
