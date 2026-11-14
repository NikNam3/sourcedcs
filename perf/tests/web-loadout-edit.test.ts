import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_LOADOUT, type Loadout, type LoadoutRow } from '../src/core/dragindex/loadout.ts';
import { join, maxCount, setCount, setStore, setSuspension, split } from '../src/web/told/loadout-edit.ts';

const row = (index: number, l: Loadout = DEFAULT_LOADOUT): LoadoutRow => {
  const found = l[index];
  assert.ok(found !== undefined, `row ${String(index)}`);
  return found;
};

const MK84 = '6||MK 84 LDGP|3,4,6, OR 7';
const loaded = (count: number, suspension: string | null = 'WEAPON PYLON* (16S1700)'): Loadout =>
  setSuspension(setCount(setStore(DEFAULT_LOADOUT, 2, MK84), 2, count), 2, suspension);

test('setStore sets the key, resets the suspension and sets the count to the stations', () => {
  const l = setCount(setSuspension(setStore(DEFAULT_LOADOUT, 2, MK84), 2, 'TER (16S1750) + WEAPON PYLON*'), 2, 5);
  const next = setStore(l, 2, 'other');
  assert.deepEqual(row(2, next), { stations: ['3', '7'], storeKey: 'other', suspension: null, count: 2 });
  assert.deepEqual(row(0, setStore(DEFAULT_LOADOUT, 0, 'noTipMissile')).storeKey, 'noTipMissile');
  assert.equal(row(2, setStore(l, 2, null)).storeKey, null);
});

test('the edits leave the input and the other rows alone', () => {
  const before = JSON.stringify(DEFAULT_LOADOUT);
  const next = setStore(DEFAULT_LOADOUT, 2, MK84);
  assert.equal(JSON.stringify(DEFAULT_LOADOUT), before);
  assert.equal(row(1, next), row(1));
  assert.equal(row(3, next), row(3));
});

test('setSuspension sets the name, or null for the default', () => {
  assert.equal(row(2, loaded(2)).suspension, 'WEAPON PYLON* (16S1700)');
  assert.equal(row(2, setSuspension(loaded(2), 2, null)).suspension, null);
});

test('setCount clamps to 1 .. 3 per station and rounds to a whole number', () => {
  assert.equal(row(2, setCount(DEFAULT_LOADOUT, 2, 0)).count, 1);
  assert.equal(row(2, setCount(DEFAULT_LOADOUT, 2, -3)).count, 1);
  assert.equal(row(2, setCount(DEFAULT_LOADOUT, 2, 4)).count, 4);
  assert.equal(row(2, setCount(DEFAULT_LOADOUT, 2, 9)).count, 6);
  assert.equal(row(4, setCount(DEFAULT_LOADOUT, 4, 9)).count, 3);
  assert.equal(row(2, setCount(DEFAULT_LOADOUT, 2, 2.6)).count, 3);
  assert.equal(row(2, setCount(DEFAULT_LOADOUT, 2, Number.NaN)).count, 1);
  assert.equal(maxCount(['3', '7']), 6);
  assert.equal(maxCount(['5']), 3);
});

test('an index outside the loadout changes nothing', () => {
  assert.equal(setStore(DEFAULT_LOADOUT, 9, MK84), DEFAULT_LOADOUT);
  assert.equal(setSuspension(DEFAULT_LOADOUT, -1, null), DEFAULT_LOADOUT);
  assert.equal(setCount(DEFAULT_LOADOUT, 7, 1), DEFAULT_LOADOUT);
  assert.equal(split(DEFAULT_LOADOUT, 7), DEFAULT_LOADOUT);
  assert.equal(join(DEFAULT_LOADOUT, 7), DEFAULT_LOADOUT);
});

test('split: a pair becomes two single-station rows with the same store, the count shared out', () => {
  const s = split(loaded(5), 2);
  assert.equal(s.length, DEFAULT_LOADOUT.length + 1);
  assert.deepEqual(row(2, s), { stations: ['3'], storeKey: MK84, suspension: 'WEAPON PYLON* (16S1700)', count: 3 });
  assert.deepEqual(row(3, s), { stations: ['7'], storeKey: MK84, suspension: 'WEAPON PYLON* (16S1700)', count: 2 });
  assert.deepEqual(row(4, s), row(3));
});

test('split at count 1: the second station is empty (a pair at 1 loads only its first)', () => {
  const s = split(loaded(1), 2);
  assert.deepEqual(row(2, s), { stations: ['3'], storeKey: MK84, suspension: 'WEAPON PYLON* (16S1700)', count: 1 });
  assert.deepEqual(row(3, s), { stations: ['7'], storeKey: null, suspension: null, count: 1 });
});

test('split only splits a pair', () => {
  assert.equal(split(DEFAULT_LOADOUT, 4), DEFAULT_LOADOUT);
  const once = split(loaded(2), 2);
  assert.equal(split(once, 2), once);
});

test('split then join gives the loadout back, at every count and for an empty pair', () => {
  for (let count = 1; count <= 6; count += 1) {
    assert.deepEqual(join(split(loaded(count), 2), 2), loaded(count), `count ${String(count)}`);
  }
  assert.deepEqual(join(split(loaded(2, null), 2), 2), loaded(2, null));
  assert.deepEqual(join(split(DEFAULT_LOADOUT, 2), 2), DEFAULT_LOADOUT);
  assert.deepEqual(
    join(split(setStore(DEFAULT_LOADOUT, 0, 'noTipMissile'), 0), 0),
    setStore(DEFAULT_LOADOUT, 0, 'noTipMissile'),
  );
});

test('join after different stores: the first station wins, its count on both', () => {
  const s = setStore(split(loaded(2), 2), 3, 'other');
  assert.deepEqual(row(2, join(s, 2)), {
    stations: ['3', '7'],
    storeKey: MK84,
    suspension: 'WEAPON PYLON* (16S1700)',
    count: 2,
  });
});

test('join with only the second station loaded takes its store', () => {
  const s = setStore(setStore(split(DEFAULT_LOADOUT, 2), 3, MK84), 2, null);
  assert.deepEqual(row(2, join(s, 2)), { stations: ['3', '7'], storeKey: MK84, suspension: null, count: 1 });
});

test('join needs the first of two split rows of one pair', () => {
  const s = split(loaded(2), 2);
  assert.equal(join(s, 3), s); // the second of the two
  assert.equal(join(DEFAULT_LOADOUT, 2), DEFAULT_LOADOUT); // a pair
  assert.equal(join(DEFAULT_LOADOUT, 4), DEFAULT_LOADOUT); // 5 then 5L
});
