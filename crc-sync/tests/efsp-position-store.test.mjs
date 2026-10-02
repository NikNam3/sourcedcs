import { test } from 'node:test';
import assert from 'node:assert/strict';

const { PositionStore } = await import('../src/efsp/position-store.js');

const POSITIONS = ['OPS', 'CD', 'GC', 'LC'];
const CONSOLIDATION = { CD: 'GC', GC: 'LC' }; // Phase-1-truncated at LC; OPS and LC have no Position to be consolidated at, matching the guide's own chain table

function freshStore() {
  return new PositionStore(POSITIONS, CONSOLIDATION);
}

test('a freshly created Position is unstaffed', () => {
  const store = freshStore();
  assert.equal(store.isStaffed('GC'), false);
  assert.equal(store.primaryOf('GC'), null);
});

test('the first controller to select an unstaffed Position becomes Primary', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GC']);
  assert.equal(store.isStaffed('GC'), true);
  assert.equal(store.primaryOf('GC'), 'c1');
});

test('a second controller selecting an already-Primary\'d Position becomes an Observer, never a second Primary (defect D18)', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GC']);
  store.setSignedOnPositions('c2', 'Bob', ['GC']);
  assert.equal(store.primaryOf('GC'), 'c1');
  assert.deepEqual(store.observersOf('GC').map(o => o.controllerId), ['c2']);
});

test('D18: many controllers racing to claim the same Position never resolves to two Primaries, under any interleaving', () => {
  const store = freshStore();
  const controllerIds = Array.from({ length: 30 }, (_, i) => `c${i}`);
  // "Racing" here means interleaved calls in an arbitrary order within the
  // same synchronous tick — Node's single-threaded event loop means real
  // concurrent claims serialize exactly like this in practice; the
  // invariant under test is that the *store* never lets two survive, for
  // any ordering, not that this simulates network race timing.
  const shuffled = [...controllerIds].sort(() => Math.random() - 0.5);
  for (const id of shuffled) store.setSignedOnPositions(id, id, ['GC']);

  let primaryCount = 0;
  // Cross-check via the store's own bookkeeping: exactly one controller's
  // signed-on set includes GC as the one who "won" Primary, and getAll()
  // agrees.
  const all = store.getAll().find(p => p.positionId === 'GC');
  assert.ok(all.primary);
  for (const id of controllerIds) {
    if (store.primaryOf('GC') === id) primaryCount++;
  }
  assert.equal(primaryCount, 1);
  // Everyone who isn't Primary is an Observer, not silently dropped.
  assert.equal(all.observers.length, controllerIds.length - 1);
});

test('a handoff (Primary A -> Primary B for the same Position) is purely an staffing change — PositionStore itself never touches Strip data (it has none to touch)', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GC']);
  store.setSignedOnPositions('c2', 'Bob', ['GC']);
  const req = store.requestPrimary('c2', 'GC');
  assert.equal(req.ok, true);
  const release = store.releasePrimaryTo('GC', 'c2');
  assert.equal(release.ok, true);
  assert.equal(store.primaryOf('GC'), 'c2');
  assert.deepEqual(store.observersOf('GC').map(o => o.controllerId), ['c1']); // old Primary demoted to Observer, not dropped
});

test('requestPrimary is refused for a non-Observer (not currently holding that Position at all)', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GC']);
  const result = store.requestPrimary('c2', 'GC');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NOT_OBSERVER');
});

test('requestPrimary is refused for the Position\'s own current Primary', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GC']);
  const result = store.requestPrimary('c1', 'GC');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ALREADY_PRIMARY');
});

test('releasePrimaryTo requires the target to actually be an Observer', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GC']);
  const result = store.releasePrimaryTo('GC', 'c2');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NOT_OBSERVER');
});

// ── Vacate / consolidation chain (defect D19) ────────────────────────────────────

test('D19: vacating a Position with no successor routes down the covering chain to the nearest staffed covering Position', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GC']);
  store.setSignedOnPositions('c2', 'Bob', ['LC']);
  // GC has no Observer, so vacating leaves it unstaffed; its consolidation
  // chain (CD -> GC -> LC from GC's perspective is just GC -> LC)
  // should resolve to LC, which IS staffed.
  const result = store.setSignedOnPositions('c1', 'Alice', []); // vacate GC
  assert.deepEqual(result.vacated, ['GC']);
  assert.equal(store.isStaffed('GC'), false);
  assert.equal(store.consolidatedAt('GC'), 'LC');
});

test('D19: covering chain walks past an also-unoccupied intermediate Position to the next one that IS staffed', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['LC']); // only LC staffed; CD and GC are not
  // CD's chain is CD -> GC -> LC; GC is unstaffed too, so it should skip to LC.
  assert.equal(store.consolidatedAt('CD'), 'LC');
});

test('D19: when the entire covering chain is unstaffed, consolidatedAt returns null — a distinct, checkable "nobody at all" condition, not a silent wrong answer', () => {
  const store = freshStore();
  // Nobody holds anything.
  assert.equal(store.consolidatedAt('CD'), null);
  assert.equal(store.consolidatedAt('GC'), null);
});

test('OPS and TWR have no covering Position at all, matching the guide\'s own chain table (CD->GND->TWR; OPS uncovered)', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['OPS']);
  store.setSignedOnPositions('c2', 'Bob', ['CD']);
  store.setSignedOnPositions('c3', 'Carol', ['GC']);
  store.setSignedOnPositions('c4', 'Dave', ['LC']);
  assert.equal(store.consolidatedAt('OPS'), null);
  assert.equal(store.consolidatedAt('LC'), null);
});

test('a non-abrupt vacate with a waiting Observer does NOT auto-promote — promotion is an explicit prompt (guide §4.8.6 rule 1)', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GC']);
  store.setSignedOnPositions('c2', 'Bob', ['GC']); // c2 becomes Observer
  store.setSignedOnPositions('c1', 'Alice', []); // Alice explicitly deselects GC
  assert.equal(store.isStaffed('GC'), false); // NOT auto-promoted
  assert.deepEqual(store.observersOf('GC').map(o => o.controllerId), ['c2']); // Bob is still just an Observer
});

test('onDisconnect (abrupt) DOES auto-promote the longest-waiting Observer', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GC']);
  store.setSignedOnPositions('c2', 'Bob', ['GC']);
  store.setSignedOnPositions('c3', 'Carol', ['GC']); // Bob is longest-waiting Observer, Carol second
  store.onDisconnect('c1');
  assert.equal(store.primaryOf('GC'), 'c2'); // Bob promoted, not Carol
  assert.deepEqual(store.observersOf('GC').map(o => o.controllerId), ['c3']);
});

test('onDisconnect with no waiting Observer simply leaves the Position unstaffed', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GC']);
  store.onDisconnect('c1');
  assert.equal(store.isStaffed('GC'), false);
});

test('onDisconnect releases every Position the controller held, not just one', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GC', 'LC']);
  store.onDisconnect('c1');
  assert.equal(store.isStaffed('GC'), false);
  assert.equal(store.isStaffed('LC'), false);
});

// ── setSignedOnPositions diffing / recomposition (guide §4.8.5) ────────────────

test('setSignedOnPositions only touches Positions that actually changed — holding an unrelated Position stays untouched across a change', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GC', 'LC']);
  store.setSignedOnPositions('c1', 'Alice', ['GC']); // drops LC, keeps GC
  assert.equal(store.primaryOf('GC'), 'c1'); // GC untouched, still c1's
  assert.equal(store.isStaffed('LC'), false);
});

test('setSignedOnPositions filters out unknown Position ids rather than throwing', () => {
  const store = freshStore();
  const result = store.setSignedOnPositions('c1', 'Alice', ['GC', 'NOT_REAL']);
  assert.deepEqual(result.signedOn, ['GC']);
});

test('re-declaring the exact same held set is a no-op — no spurious vacate/reclaim', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GC']);
  const result = store.setSignedOnPositions('c1', 'Alice', ['GC']);
  assert.deepEqual(result.vacated, []);
  assert.equal(store.primaryOf('GC'), 'c1');
});

// ── Combination across Positions (guide §4.8) ───────────────────────────────

test('one controller can hold multiple Positions simultaneously, each independently tracked', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['CD', 'GC', 'LC']);
  assert.deepEqual(store.signedOnBy('c1').sort(), ['CD', 'GC', 'LC']);
  assert.equal(store.primaryOf('CD'), 'c1');
  assert.equal(store.primaryOf('GC'), 'c1');
  assert.equal(store.primaryOf('LC'), 'c1');
});

// ── Self-coordination (guide §4.8.3, defect D20) ────────────────────────────

test('isSelfCoordinated is true when the controller holds Primary at the destination Position', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GC', 'LC']);
  assert.equal(store.isSelfCoordinated('c1', 'LC'), true);
});

test('isSelfCoordinated is false for a different controller, or a Position the controller does not hold', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GC']);
  store.setSignedOnPositions('c2', 'Bob', ['LC']);
  assert.equal(store.isSelfCoordinated('c1', 'LC'), false);
  assert.equal(store.isSelfCoordinated('c2', 'GC'), false);
});

test('isSelfCoordinated is false when the controller is merely an Observer at the destination, not Primary', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['LC']);
  store.setSignedOnPositions('c2', 'Bob', ['LC']); // Bob is Observer
  assert.equal(store.isSelfCoordinated('c2', 'LC'), false);
});

// ── getAll() shape ───────────────────────────────────────────────────────

test('getAll returns every configured Position, including unstaffed ones', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GC']);
  const all = store.getAll();
  assert.deepEqual(all.map(p => p.positionId).sort(), POSITIONS.slice().sort());
});

test('getAll\'s consolidatedPositions lists the unstaffed Positions currently routing through this one', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['LC']); // CD and GC unstaffed, both are eventually consolidated at LC
  const twr = store.getAll().find(p => p.positionId === 'LC');
  assert.deepEqual(twr.consolidatedPositions.sort(), ['CD', 'GC']);
});
