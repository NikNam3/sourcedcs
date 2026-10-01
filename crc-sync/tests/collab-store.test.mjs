import { test } from 'node:test';
import assert from 'node:assert/strict';
import CollaborativeStore from '../src/collab-store.js';

test('declare / clearDeclare round-trip and drop empty entries', () => {
  const store = new CollaborativeStore();
  store.declare('7', 'hostile', 'Alice');
  assert.equal(store.get('7').iff.state, 'hostile');
  assert.equal(store.get('7').iff.by, 'Alice');

  store.clearDeclare('7');
  assert.equal(store.get('7'), null, 'entry should be dropped once all fields are empty');
});

test('declare rejects an invalid IFF state', () => {
  const store = new CollaborativeStore();
  store.declare('7', 'not-a-real-state', 'Alice');
  assert.equal(store.get('7'), null);
});

test('rename trims/uppercases and clearing an empty rename clears it', () => {
  const store = new CollaborativeStore();
  store.rename('9', '  enfield 1  ', 'Bob');
  assert.equal(store.get('9').rename.value, 'ENFIELD 1');
  store.rename('9', '', 'Bob'); // empty rename == clear
  assert.equal(store.get('9'), null);
});

test('evictStale removes entries for tracks no longer active, keeps active ones', () => {
  const store = new CollaborativeStore();
  store.declare('1', 'hostile', 'Alice');
  store.declare('2', 'bandit', 'Alice');
  const evicted = store.evictStale(new Set(['1'])); // only '1' still active
  assert.equal(evicted, 1);
  assert.ok(store.get('1'));
  assert.equal(store.get('2'), null);
});

test('clear() empties the store: a mission reload wipes it for everybody', () => {
  const store = new CollaborativeStore();
  store.declare('1', 'hostile', 'Alice');
  store.rename('2', 'tanker', 'Bob');
  store.clear();
  assert.equal(store.getAll().length, 0);
});

// ── persistence and unit continuity (docs/adr/0094) ──────────────────────────
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VIPER = { id: 5, name: 'Viper 1-1', type: 'F-16C_50', callsign: 'Viper 1-1', coalition: 2 };
const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'collab-u-')), 'c.json');
const mk = (p, extra = {}) => new CollaborativeStore({ persist: true, path: p, identityOf: () => VIPER, sessionSeq: () => 3, ...extra });

test('a bare store never writes a file', () => {
  const store = new CollaborativeStore();
  store.declare('5', 'hostile', 'A');
  assert.equal(store.getAll().length, 1);
});

test('the clock grace opens the gate when no game time ever arrives', async () => {
  const p = file();
  mk(p).declare('5', 'hostile', 'A');
  const b = mk(p, { clockGraceMs: 30, identityOf: () => null });
  b.noteMissionLoad();
  assert.equal(b.get('5'), null);
  b.observeUnit(VIPER); // streamed while the gate is closed: not shown yet
  assert.equal(b.get('5'), null);
  await new Promise(r => setTimeout(r, 80));
  b.observeUnit(VIPER);
  assert.equal(b.get('5').iff.state, 'hostile');
  b.close();
});

test('a persisted overlay from another session number is discarded at the gate', () => {
  const p = file();
  mk(p).declare('5', 'hostile', 'A');
  const b = mk(p, { sessionSeq: () => 4 });
  b.noteMissionLoad(); b.noteClockSample();
  b.observeUnit(VIPER);
  assert.equal(b.get('5'), null);
  assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).entries.length, 0);
});

test('a corrupt file is kept aside and the store starts empty', () => {
  const p = file();
  fs.writeFileSync(p, '{nope');
  const b = mk(p);
  assert.equal(b.getAll().length, 0);
  assert.ok(fs.readdirSync(path.dirname(p)).some(f => f.includes('corrupt')));
});

test('release drops a despawned unit; parked entries expire', () => {
  let now = 1000;
  const b = mk(file(), { wallNow: () => now });
  b.declare('5', 'hostile', 'A');
  b.release('5');
  assert.equal(b.get('5'), null);
  b.declare('5', 'hostile', 'A');
  b.evictStale(new Set());
  now += CollaborativeStore.PARK_MS + 1;
  b.evictStale(new Set());
  b.observeUnit(VIPER);
  assert.equal(b.get('5'), null);
});
