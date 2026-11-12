/** The load order (TOLD 1.8 "State"): hash, then storage, then the defaults. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_LOADOUT } from '../src/core/dragindex/loadout-row.ts';
import { DEFAULT_INPUTS } from '../src/core/inputs/inputs.ts';
import { encodeState } from '../src/web/state/hash.ts';
import { initialState } from '../src/web/state/initial.ts';
import { readStored, STORAGE_KEY, writeStored } from '../src/web/state/storage.ts';

const REFUSED = 'This link is from another version of the calculator and was not loaded.';
const DROPPED = 'Part of the loadout in this link could not be read.';
const DEFAULTS = { inputs: DEFAULT_INPUTS, loadout: DEFAULT_LOADOUT };
const FROM_HASH = { inputs: { ...DEFAULT_INPUTS, takeoffGwLb: '30000' }, loadout: [] };
const STORED = { inputs: { ...DEFAULT_INPUTS, tempC: '15' }, loadout: [] };

test('a good hash wins over storage, with no note', () => {
  assert.deepEqual(initialState(`#${encodeState(FROM_HASH)}`, encodeState(STORED)), { state: FROM_HASH, notes: [] });
});

test('a hash with dropped rows notes it', () => {
  const r = initialState('#v=1&lo=bad', encodeState(STORED));
  assert.deepEqual(r.notes, [DROPPED]);
  assert.deepEqual(r.state.loadout, []);
});

test('a refused hash notes it and loads storage', () => {
  assert.deepEqual(initialState('#v=2', encodeState(STORED)), { state: STORED, notes: [REFUSED] });
  assert.deepEqual(initialState('#v=2', null), { state: DEFAULTS, notes: [REFUSED] });
  assert.deepEqual(initialState('#v=2', 'garbage'), { state: DEFAULTS, notes: [REFUSED] });
});

test('no hash: storage, else the defaults; a bad stored string is ignored silently', () => {
  assert.deepEqual(initialState('', encodeState(STORED)), { state: STORED, notes: [] });
  assert.deepEqual(initialState('', null), { state: DEFAULTS, notes: [] });
  assert.deepEqual(initialState('', 'v=9'), { state: DEFAULTS, notes: [] });
  assert.deepEqual(initialState('', 'v=1&lo=bad').notes, []);
});

test('storage: the key, and storage that throws or is missing is ignored', () => {
  assert.equal(STORAGE_KEY, 'perf.f16.v1');
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string): string | null => map.get(k) ?? null,
    setItem: (k: string, v: string): void => void map.set(k, v),
  };
  writeStored(storage, 'v=1');
  assert.equal(map.get(STORAGE_KEY), 'v=1');
  assert.equal(readStored(storage), 'v=1');
  const throwing = {
    getItem: (): string | null => {
      throw new Error('denied');
    },
    setItem: (): void => {
      throw new Error('denied');
    },
  };
  assert.equal(readStored(throwing), null);
  assert.doesNotThrow(() => {
    writeStored(throwing, 'v=1');
  });
  assert.equal(readStored(null), null);
  assert.doesNotThrow(() => {
    writeStored(null, 'v=1');
  });
});
