/** The load order (TOLD 1.8 "State"): hash, then storage, then the defaults. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_LOADOUT } from '../src/core/dragindex/loadout-row.ts';
import { DEFAULT_INPUTS } from '../src/core/inputs/inputs.ts';
import { blankDefaults } from '../src/web/inputs.ts';
import { encodeState } from '../src/web/state/hash.ts';
import { initialState } from '../src/web/state/initial.ts';
import { readStored, STORAGE_KEY, writeStored } from '../src/web/state/storage.ts';

const REFUSED = 'This link is from another version of the calculator and was not loaded.';
const DROPPED = 'Part of the loadout in this link could not be read.';
/** The defaults with the defaulted fields (CG, additional drag index, RCR) empty: placeholders on every page. */
const DEFAULTS = { inputs: blankDefaults(DEFAULT_INPUTS), loadout: DEFAULT_LOADOUT };
const FROM_HASH = { inputs: { ...DEFAULT_INPUTS, takeoffGwLb: '30000' }, loadout: DEFAULT_LOADOUT };
const STORED = { inputs: { ...DEFAULT_INPUTS, tempC: '15' }, loadout: DEFAULT_LOADOUT };

test('a good hash wins over storage, with no note', () => {
  assert.deepEqual(initialState(`#${encodeState(FROM_HASH)}`, encodeState(STORED)), {
    state: FROM_HASH,
    notes: [],
    source: 'hash',
  });
});

test('a hash with dropped rows notes it', () => {
  const r = initialState('#v=1&lo=bad', encodeState(STORED));
  assert.deepEqual(r.notes, [DROPPED]);
  assert.deepEqual(r.state.loadout, DEFAULT_LOADOUT);
});

test('a refused hash notes it and loads storage', () => {
  assert.deepEqual(initialState('#v=2', encodeState(STORED)), {
    state: STORED,
    notes: [REFUSED],
    source: 'storage',
  });
  assert.deepEqual(initialState('#v=2', null), { state: DEFAULTS, notes: [REFUSED], source: 'defaults' });
  assert.deepEqual(initialState('#v=2', 'garbage'), { state: DEFAULTS, notes: [REFUSED], source: 'defaults' });
});

test('no hash: storage, else the defaults; a bad stored string is ignored silently', () => {
  assert.deepEqual(initialState('', encodeState(STORED)), { state: STORED, notes: [], source: 'storage' });
  assert.deepEqual(initialState('', null), { state: DEFAULTS, notes: [], source: 'defaults' });
  assert.deepEqual(initialState('', 'v=9'), { state: DEFAULTS, notes: [], source: 'defaults' });
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

test('a state from the defaults carries its defaulted fields empty', () => {
  const { inputs } = initialState('', null).state;
  assert.equal(inputs.cgPct, '');
  assert.equal(inputs.additionalDragIndex, '');
  assert.equal(inputs.rcrDry, '');
  assert.equal(inputs.rcrWet, '');
  assert.ok(encodeState(initialState('', null).state).includes('&cg=&adi=&'));
});
