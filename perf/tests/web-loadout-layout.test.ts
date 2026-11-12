/** A decoded loadout back on the station layout (`src/web/state/loadout-layout.ts`, final review I2). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_LOADOUT } from '../src/core/dragindex/loadout-row.ts';
import type { LoadoutRow } from '../src/core/dragindex/loadout-row.ts';
import { decodeState } from '../src/web/state/hash.ts';
import { initialState } from '../src/web/state/initial.ts';
import { normaliseLoadout } from '../src/web/state/loadout-layout.ts';

const stationsOf = (rows: readonly LoadoutRow[]): string[] => rows.map((r) => r.stations.join('/'));

function loadoutOf(lo: string): readonly LoadoutRow[] {
  const d = decodeState(`v=1&lo=${encodeURIComponent(lo)}`);
  assert.ok(d.kind === 'ok');
  return d.state.loadout;
}

test('the default loadout is unchanged, and no rows give the default loadout', () => {
  assert.deepEqual(normaliseLoadout(DEFAULT_LOADOUT), DEFAULT_LOADOUT);
  assert.deepEqual(normaliseLoadout([]), DEFAULT_LOADOUT);
});

test('lo= is the default loadout', () => {
  assert.deepEqual(loadoutOf(''), DEFAULT_LOADOUT);
  assert.deepEqual(initialState('#v=1&lo=', null).state.loadout, DEFAULT_LOADOUT);
});

test('a dropped pair comes back as its empty pair, where the default has it', () => {
  // The 3/7 row has a count above 3 per station: dropped.
  const rows = loadoutOf('1-9:::2;3-7:::9');
  assert.deepEqual(stationsOf(rows), ['1/9', '2/8', '3/7', '4/6', '5', '5L', '5R']);
  assert.deepEqual(rows, DEFAULT_LOADOUT);
});

test('a split pair with one half dropped gets that half as a single empty row next to the other', () => {
  const rows = loadoutOf('1-9:::2;2-8:::2;3:k::1;7:::9;4-6:::2;5:::1;5L:::1;5R:::1');
  assert.deepEqual(stationsOf(rows), ['1/9', '2/8', '3', '7', '4/6', '5', '5L', '5R']);
  assert.deepEqual(rows[3], { stations: ['7'], storeKey: null, suspension: null, count: 1 });
  const other = loadoutOf('1-9:::2;2-8:::2;3:::9;7:k::1;4-6:::2;5:::1;5L:::1;5R:::1');
  assert.deepEqual(stationsOf(other), ['1/9', '2/8', '3', '7', '4/6', '5', '5L', '5R']);
  assert.deepEqual(other[2], { stations: ['3'], storeKey: null, suspension: null, count: 1 });
});

test('kept rows keep their order and content; only uncovered stations are added', () => {
  const kept: LoadoutRow[] = [
    { stations: ['2', '8'], storeKey: 'y', suspension: 's', count: 2 },
    { stations: ['5R'], storeKey: 'x', suspension: null, count: 1 },
  ];
  const out = normaliseLoadout(kept);
  assert.deepEqual(stationsOf(out), ['1/9', '2/8', '3/7', '4/6', '5', '5L', '5R']);
  assert.equal(out[1], kept[0]);
  assert.equal(out[6], kept[1]);
});
