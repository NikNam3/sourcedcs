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
