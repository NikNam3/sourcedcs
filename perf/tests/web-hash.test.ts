/** The URL hash (TOLD 1.8 "State"): every Inputs field and the loadout round-trip; a bad link never throws. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_LOADOUT } from '../src/core/dragindex/loadout-row.ts';
import type { Loadout } from '../src/core/dragindex/loadout-row.ts';
import { DEFAULT_INPUTS } from '../src/core/inputs/inputs.ts';
import type { Inputs } from '../src/core/inputs/inputs.ts';
import { decodeState, encodeState } from '../src/web/state/hash.ts';
import type { AppState } from '../src/web/state/hash.ts';

const INPUTS: Inputs = {
  takeoffGwLb: '37,240',
  landingGwLb: '',
  cgPct: '30 & 2',
  additionalDragIndex: 'a=b',
  runway: '22L #2',
  headingDeg: ' 220 ',
  lengthFt: '9,000',
  nearElevFt: '-12',
  farElevFt: '%41',
  altimeterInHg: '29.92',
  tempC: '37,',
  wind: '230 / 08 G15',
  rcrDry: '',
  rcrWet: '8+1',
};

const STORE = '3|PYLONS|AIM-120 & co; x:y|3,7';
/** Covers every station, so decoding adds no default row. */
const LOADOUT: Loadout = [
  { stations: ['1', '9'], storeKey: 'noTipMissile', suspension: null, count: 2 },
  { stations: ['3'], storeKey: STORE, suspension: 'LAU-129/A: one', count: 1 },
  { stations: ['7'], storeKey: null, suspension: null, count: 1 },
  { stations: ['2', '8'], storeKey: 'k', suspension: 'TER (16S1750) + WEAPON PYLON*', count: 6 },
  { stations: ['4', '6'], storeKey: null, suspension: null, count: 2 },
  { stations: ['5'], storeKey: null, suspension: null, count: 1 },
  { stations: ['5L'], storeKey: 'unknown|key', suspension: null, count: 1 },
  { stations: ['5R'], storeKey: null, suspension: null, count: 1 },
];

function decodedOk(text: string): { state: AppState; droppedRows: number } {
  const d = decodeState(text);
  assert.ok(d.kind === 'ok', JSON.stringify(d));
  return d;
}

test('encodeState starts with v=1& and writes every key, empty ones too', () => {
  const text = encodeState({ inputs: DEFAULT_INPUTS, loadout: [] });
  assert.ok(text.startsWith('v=1&'));
  const keys = [...new URLSearchParams(text).keys()];
  assert.deepEqual(keys, [
    'v',
    'tgw',
    'lgw',
    'cg',
    'adi',
    'rwy',
    'hdg',
    'len',
    'ne',
    'fe',
    'alt',
    't',
    'w',
    'rd',
    'rw',
    'lo',
  ]);
});

test('every Inputs field and the loadout round-trip, with or without #', () => {
  const state = { inputs: INPUTS, loadout: LOADOUT };
  const text = encodeState(state);
  assert.deepEqual(decodeState(text), { kind: 'ok', state, droppedRows: 0 });
  assert.deepEqual(decodeState(`#${text}`), { kind: 'ok', state, droppedRows: 0 });
});

test('each field round-trips on its own, including the default loadout; an empty one decodes as the default', () => {
  for (const key of Object.keys(DEFAULT_INPUTS) as (keyof Inputs)[]) {
    const inputs = { ...DEFAULT_INPUTS, [key]: 'x &=# y' };
    assert.deepEqual(decodedOk(encodeState({ inputs, loadout: DEFAULT_LOADOUT })).state.inputs, inputs);
  }
  assert.deepEqual(
    decodedOk(encodeState({ inputs: DEFAULT_INPUTS, loadout: DEFAULT_LOADOUT })).state.loadout,
    DEFAULT_LOADOUT,
  );
  assert.deepEqual(decodedOk(encodeState({ inputs: DEFAULT_INPUTS, loadout: [] })).state.loadout, DEFAULT_LOADOUT);
});

test('a split pair keeps its order, and the noTipMissile row is a normal row with its literal store part', () => {
  const text = encodeState({ inputs: DEFAULT_INPUTS, loadout: LOADOUT });
  const lo = new URLSearchParams(text).get('lo') ?? '';
  assert.ok(lo.startsWith('1-9:noTipMissile::2;3:'));
  assert.ok(lo.includes(';7:::1;'));
});

test('no hash, or no v: none', () => {
  assert.deepEqual(decodeState(''), { kind: 'none' });
  assert.deepEqual(decodeState('#'), { kind: 'none' });
  assert.deepEqual(decodeState('#tgw=30000'), { kind: 'none' });
});

test('v other than 1 is refused', () => {
  assert.deepEqual(decodeState('#v=2&tgw=30000'), { kind: 'refused' });
  assert.deepEqual(decodeState('v='), { kind: 'refused' });
  assert.deepEqual(decodeState('v=01'), { kind: 'refused' });
});

test('a missing key takes its default, an unknown key is ignored, no lo is the default loadout', () => {
  const d = decodedOk('#v=1&tgw=30000&zz=1');
  assert.deepEqual(d.state.inputs, { ...DEFAULT_INPUTS, takeoffGwLb: '30000' });
  assert.deepEqual(d.state.loadout, DEFAULT_LOADOUT);
  assert.equal(d.droppedRows, 0);
});

test('rows that do not decode are dropped and counted; an unknown store key is kept', () => {
  const rows = [
    '3-7:k::2', // kept
    '3-7:k:TER (16S1750) + WEAPON PYLON*:6', // kept: two TERs, 3 each
    '3-7:k:2', // three parts
    '3-7:k::7', // above 3 per station
    '3:k::4', // above 3 on one station
    '3-7:k::0', // zero
    '3-7:k::06', // leading zero
    '3-7:k::1.5', // not an integer
    '3-7:k::-1', // negative
    '3-7:k::', // empty count
    '3-10:k::1', // unknown station
    ':k::1', // no station
    '3--7:k::1', // empty station
    '3:%E0%A4%A:x:1', // malformed escape
    '5R:never-heard-of-it::1', // kept: unknown store key
  ];
  const d = decodedOk(`v=1&lo=${encodeURIComponent(rows.join(';'))}`);
  assert.equal(d.droppedRows, 12);
  const [p19, p28, , p46, s5, s5l] = DEFAULT_LOADOUT;
  assert.deepEqual(d.state.loadout, [
    p19,
    p28,
    { stations: ['3', '7'], storeKey: 'k', suspension: null, count: 2 },
    { stations: ['3', '7'], storeKey: 'k', suspension: 'TER (16S1750) + WEAPON PYLON*', count: 6 },
    p46,
    s5,
    s5l,
    { stations: ['5R'], storeKey: 'never-heard-of-it', suspension: null, count: 1 },
  ]);
});

test('decodeState never throws on random strings', () => {
  const alphabet = 'v=1&#%;:-|lo9GL ,.—\uD800abc';
  let seed = 12345;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  for (let i = 0; i < 200; i++) {
    const length = next() % 60;
    let text = i % 2 === 0 ? 'v=1&lo=' : '';
    for (let j = 0; j < length; j++) text += alphabet[next() % alphabet.length] ?? '';
    assert.doesNotThrow(() => decodeState(text), text);
  }
});
