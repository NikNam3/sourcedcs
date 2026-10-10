import test from 'node:test';
import assert from 'node:assert/strict';

// The recovery board's server half (docs/adr/0114): the time a flight commenced is stored and never rewritten, Delta (CV NATOPS
// 6.4.9) moves holding flights only and tells the top of the stack first, Back to stack takes the next free slot at the top, a
// new ramp time starts the schedule afresh, and the walks the pilot requests make.

const { CarrierStore } = await import('../src/efsp/carrier-store.js');
const hullConfig = await import('../src/efsp/carrier/hull-config.js');
const { delta, backToStack, markPushed, validateStack } = await import('../src/efsp/carrier/marshal-stack.js');

const T0 = Date.UTC(2026, 5, 1, 20, 30);
const MIN = 60_000;

function rig() {
  const t = { v: T0 };
  const clock = { now: () => t.v, source: 'TEST' };
  const store = new CarrierStore({ hulls: hullConfig.getHulls(), clock });
  let n = 0;
  const op = (o, pos = 'CV_MARSHAL') => store.apply({ clientMutationId: `m${n++}`, op: o }, pos, `u-${pos}`);
  const set = (field, value, pos = 'CV_PRIFLY') => op({ kind: 'SetCarrierState', field, value }, pos);
  const flights = (k) => { for (let i = 0; i < k; i++) op({ kind: 'Append', flightDataId: `f${i}` }); };
  const entry = (id) => store.getRecord().stacks.MAIN.entries.find((e) => e.flightDataId === id);
  const derived = (id) => store.view().derived.MAIN.find((e) => e.flightDataId === id);
  const eat = (id) => derived(id).pushTimeUtc;
  const commence = (id) => store.applyEffect('MARK_PUSHED', id, { by: 'm', actingPositionId: 'CV_MARSHAL' });
  return { store, t, op, set, flights, entry, derived, eat, commence };
}

const FIX = 6 * MIN; // fixToRampSec 360

test('commencing stores when the flight left and the EAT it worked to; a later ramp-time change never rewrites them', () => {
  const r = rig();
  r.flights(4);
  r.set('rampTime', '2040');
  const ramp = r.store.state().rampTime.value;
  r.t.v = T0 + 5 * MIN;
  const eatBefore = r.eat('f0');
  assert.equal(r.commence('f0').ok, true);
  assert.deepEqual([r.entry('f0').status, r.entry('f0').pushedAtUtc, r.entry('f0').eatUtc], ['PUSHED', T0 + 5 * MIN, eatBefore]);
  assert.equal(eatBefore, ramp - FIX);
  // the Marshal retimes the recovery: the holding flights follow, the one that pushed does not
  r.set('rampTime', '2100', 'CV_MARSHAL');
  const ramp2 = r.store.state().rampTime.value;
  assert.equal(r.eat('f0'), eatBefore, 'the pushed flight keeps the EAT it worked to');
  assert.equal(r.derived('f0').pushedAtUtc, T0 + 5 * MIN);
  assert.equal(r.eat('f1'), ramp2 + MIN - FIX);
  assert.equal(r.eat('f3'), ramp2 + 3 * MIN - FIX);
  assert.equal(r.derived('f0').status, 'PUSHED');
});

test('Delta: even minutes, never less than four; holding flights only; the new EATs are issued top of the stack down', () => {
  const r = rig();
  r.flights(4);
  r.set('rampTime', '2040');
  r.commence('f0');
  const eats = ['f0', 'f1', 'f2', 'f3'].map(r.eat);
  for (const bad of [2, 3, 5, 0, -4, 4.5, '4', 62, undefined]) {
    const x = r.op({ kind: 'Delta', minutes: bad });
    assert.deepEqual([x.ok, x.reason], [false, 'VALIDATION_ERROR'], String(bad));
  }
  assert.deepEqual(['f0', 'f1', 'f2', 'f3'].map(r.eat), eats, 'a refusal moves nothing');
  const d = r.op({ kind: 'Delta', minutes: 4 });
  assert.equal(d.ok, true);
  assert.deepEqual(d.changed, ['f3', 'f2', 'f1'], 'top of the stack first, the commenced flight not at all');
  assert.equal(r.eat('f0'), eats[0], 'a commenced flight is not given a new EAT');
  assert.deepEqual(['f1', 'f2', 'f3'].map(r.eat), [eats[1] + 4 * MIN, eats[2] + 4 * MIN, eats[3] + 4 * MIN]);
  // each Delta adds to the last
  r.op({ kind: 'Delta', minutes: 6 });
  assert.equal(r.eat('f1'), eats[1] + 10 * MIN);
  assert.equal(r.store.getRecord().stacks.MAIN.deltaMs, 10 * MIN);
});

test('Delta needs a ramp time and somebody holding; a Position that does not sequence the stack is refused', () => {
  const r = rig();
  r.flights(2);
  assert.match(r.op({ kind: 'Delta', minutes: 4 }).detail, /no ramp time/);
  r.set('rampTime', '2040');
  for (const pos of ['CV_PRIFLY', 'CV_APP1', 'CV_APP2', 'LC']) {
    const x = r.op({ kind: 'Delta', minutes: 4 }, pos);
    assert.deepEqual([x.ok, x.reason], [false, 'PERMISSION_DENIED'], pos);
  }
  r.commence('f0'); r.commence('f1');
  assert.match(r.op({ kind: 'Delta', minutes: 4 }).detail, /nobody is holding/);
});

test('a new ramp time starts the schedule afresh: the Delta is cleared with it', () => {
  const r = rig();
  r.flights(2);
  r.set('rampTime', '2040');
  r.op({ kind: 'Delta', minutes: 4 });
  assert.equal(r.store.getRecord().stacks.MAIN.deltaMs, 4 * MIN);
  r.set('rampTime', '2050', 'CV_MARSHAL');
  const ramp = r.store.state().rampTime.value;
  assert.equal(r.store.getRecord().stacks.MAIN.deltaMs, 0);
  assert.equal(r.eat('f0'), ramp - FIX);
  // the same value typed again is not a new schedule
  r.op({ kind: 'Delta', minutes: 4 });
  r.set('rampTime', '2050', 'CV_MARSHAL');
  assert.equal(r.store.getRecord().stacks.MAIN.deltaMs, 4 * MIN);
});

test('Back to stack: the commenced flight takes the next free slot at the top, with that slot\'s angels and EAT; nobody else moves', () => {
  const r = rig();
  r.flights(4);
  r.set('rampTime', '2040');
  r.commence('f1');
  const others = ['f0', 'f2', 'f3'].map((id) => [id, r.entry(id).stackIndex, r.eat(id)]);
  const b = r.op({ kind: 'BackToStack', flightDataId: 'f1' });
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.deepEqual([r.entry('f1').stackIndex, r.entry('f1').status, r.entry('f1').pushedAtUtc, r.entry('f1').eatUtc], [4, 'HOLDING', null, null]);
  const d = r.derived('f1');
  assert.deepEqual([d.angels, d.marshalDme], [10, 25]);
  assert.equal(d.pushTimeUtc, r.store.state().rampTime.value + 4 * MIN - FIX);
  assert.deepEqual(['f0', 'f2', 'f3'].map((id) => [id, r.entry(id).stackIndex, r.eat(id)]), others);
  // a holding flight is not "commenced": nothing to send back; an unknown flight is not found
  assert.equal(r.op({ kind: 'BackToStack', flightDataId: 'f0' }).ok, false);
  assert.equal(r.op({ kind: 'BackToStack', flightDataId: 'nope' }).reason, 'NOT_FOUND');
  assert.equal(r.op({ kind: 'BackToStack', flightDataId: 'f1' }, 'CV_PRIFLY').reason, 'PERMISSION_DENIED');
});

test('back to stack, then a Delta: the returned flight is holding again, so it takes the Delta with the rest', () => {
  const r = rig();
  r.flights(3);
  r.set('rampTime', '2040');
  r.commence('f0');
  r.op({ kind: 'BackToStack', flightDataId: 'f0' });
  const slot = r.entry('f0').stackIndex;
  assert.equal(slot, 3);
  const e0 = r.eat('f0');
  const d = r.op({ kind: 'Delta', minutes: 4 });
  assert.deepEqual(d.changed, ['f0', 'f2', 'f1'], 'top of the stack first');
  assert.equal(r.eat('f0'), e0 + 4 * MIN);
});

test('a Delta with a commenced flight: it is not moved, and a Delta then Commence records the EAT with the Delta in it', () => {
  const r = rig();
  r.flights(3);
  r.set('rampTime', '2040');
  r.commence('f0');
  const pushedEat = r.eat('f0');
  r.op({ kind: 'Delta', minutes: 6 });
  assert.equal(r.eat('f0'), pushedEat);
  const f1 = r.eat('f1');
  assert.equal(r.commence('f1').ok, true);
  assert.equal(r.entry('f1').eatUtc, f1, 'the EAT it worked to includes the Delta');
});

test('a flight leaving the stack mid-sequence (divert, bingo) leaves a vacancy; Delta and the EATs of the rest do not move', () => {
  const r = rig();
  r.flights(4);
  r.set('rampTime', '2040');
  r.op({ kind: 'Delta', minutes: 4 });
  const before = ['f0', 'f2', 'f3'].map(r.eat);
  assert.equal(r.store.onFlightDataRetired('f1', 'sys'), true);
  assert.deepEqual(['f0', 'f2', 'f3'].map(r.eat), before);
  assert.deepEqual(r.store.getRecord().stacks.MAIN.entries.map((e) => e.stackIndex), [0, 2, 3]);
  // a commenced flight that diverts is removed the same way and its push time goes with it
  r.commence('f0');
  r.store.onFlightDataRetired('f0', 'sys');
  assert.equal(r.entry('f0'), undefined);
});

test('two marshal controllers: the second Back to stack for the same flight is refused, a Delta and a Move interleave', () => {
  const r = rig();
  r.flights(4);
  r.set('rampTime', '2040');
  r.commence('f0');
  assert.equal(r.op({ kind: 'BackToStack', flightDataId: 'f0' }).ok, true);
  const again = r.op({ kind: 'BackToStack', flightDataId: 'f0' });
  assert.deepEqual([again.ok, again.reason], [false, 'VALIDATION_ERROR']);
  // controller one drags f3 to the front while controller two sends a Delta: both land, the EATs are the sum
  assert.equal(r.op({ kind: 'Move', flightDataId: 'f3', toIndex: 0 }).ok, true);
  assert.equal(r.op({ kind: 'Delta', minutes: 4 }).ok, true);
  const ramp = r.store.state().rampTime.value;
  assert.equal(r.eat('f3'), ramp + 4 * MIN - FIX);
});

test('a stored push time survives a restart; a holding entry carrying one is refused', () => {
  const r = rig();
  r.flights(2);
  r.set('rampTime', '2040');
  r.t.v = T0 + MIN;
  r.commence('f0');
  r.op({ kind: 'Delta', minutes: 4 });
  const snap = r.store.snapshot();
  const r2 = rig();
  r2.store.restore(snap);
  assert.deepEqual([r2.entry('f0').pushedAtUtc, r2.entry('f0').eatUtc, r2.store.getRecord().stacks.MAIN.deltaMs], [T0 + MIN, r.entry('f0').eatUtc, 4 * MIN]);
  const stack = r.store.getRecord().stacks.MAIN;
  const bad = { ...stack, entries: stack.entries.map((e) => (e.flightDataId === 'f1' ? { ...e, pushedAtUtc: T0 } : e)) };
  assert.equal(validateStack(bad).ok, false);
});

test('the pure ops: Delta and Back to stack never mutate the stack they are given', () => {
  const stack = Object.freeze({ stackId: 'MAIN', hullId: 'X', deltaMs: 0, entries: Object.freeze([
    Object.freeze({ flightDataId: 'a', stackIndex: 0, status: 'PUSHED', caseIAngels: null, pushedAtUtc: 5, eatUtc: 4 }),
    Object.freeze({ flightDataId: 'b', stackIndex: 1, status: 'HOLDING', caseIAngels: null, pushedAtUtc: null, eatUtc: null }),
  ]) });
  assert.equal(delta(stack, { minutes: 4 }).ok, true);
  assert.equal(backToStack(stack, { flightDataId: 'a' }).stack.entries.find((e) => e.flightDataId === 'a').stackIndex, 2);
  assert.equal(markPushed(stack, { flightDataId: 'b' }, { nowMs: 9, eatUtc: 8 }).stack.entries[1].pushedAtUtc, 9);
});
