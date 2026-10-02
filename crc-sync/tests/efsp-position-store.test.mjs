import { test } from 'node:test';
import assert from 'node:assert/strict';

const { PositionStore } = await import('../src/efsp/position-store.js');

const POSITIONS = ['OPS', 'CD', 'GND', 'TWR'];
const CONSOLIDATION = { CD: 'GND', GND: 'TWR' }; // Phase-1-truncated at TWR; OPS and TWR have no covering Position, matching the guide's own chain table

function freshStore() {
  return new PositionStore(POSITIONS, CONSOLIDATION);
}

test('a freshly created Position is unstaffed', () => {
  const store = freshStore();
  assert.equal(store.isStaffed('GND'), false);
  assert.equal(store.primaryOf('GND'), null);
});

test('the first controller to select an unstaffed Position becomes Primary', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GND']);
  assert.equal(store.isStaffed('GND'), true);
  assert.equal(store.primaryOf('GND'), 'c1');
});

test('a second controller selecting an already-Primary\'d Position becomes an Observer, never a second Primary (defect D18)', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GND']);
  store.setSignedOnPositions('c2', 'Bob', ['GND']);
  assert.equal(store.primaryOf('GND'), 'c1');
  assert.deepEqual(store.observersOf('GND').map(o => o.controllerId), ['c2']);
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
  for (const id of shuffled) store.setSignedOnPositions(id, id, ['GND']);

  let primaryCount = 0;
  // Cross-check via the store's own bookkeeping: exactly one controller's
  // held-set includes GND as the one who "won" Primary, and getAll()
  // agrees.
  const all = store.getAll().find(p => p.positionId === 'GND');
  assert.ok(all.primary);
  for (const id of controllerIds) {
    if (store.primaryOf('GND') === id) primaryCount++;
  }
  assert.equal(primaryCount, 1);
  // Everyone who isn't Primary is an Observer, not silently dropped.
  assert.equal(all.observers.length, controllerIds.length - 1);
});

test('a handover (Primary A -> Primary B for the same Position) is purely an staffing change — PositionStore itself never touches Strip data (it has none to touch)', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GND']);
  store.setSignedOnPositions('c2', 'Bob', ['GND']);
  const req = store.requestPrimary('c2', 'GND');
  assert.equal(req.ok, true);
  const release = store.releasePrimaryTo('GND', 'c2');
  assert.equal(release.ok, true);
  assert.equal(store.primaryOf('GND'), 'c2');
  assert.deepEqual(store.observersOf('GND').map(o => o.controllerId), ['c1']); // old Primary demoted to Observer, not dropped
});

test('requestPrimary is refused for a non-Observer (not currently holding that Position at all)', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GND']);
  const result = store.requestPrimary('c2', 'GND');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NOT_OBSERVER');
});

test('requestPrimary is refused for the Position\'s own current Primary', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GND']);
  const result = store.requestPrimary('c1', 'GND');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ALREADY_PRIMARY');
});

test('releasePrimaryTo requires the target to actually be an Observer', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GND']);
  const result = store.releasePrimaryTo('GND', 'c2');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NOT_OBSERVER');
});

// ── Vacate / covering chain (defect D19) ────────────────────────────────────

test('D19: vacating a Position with no successor routes down the covering chain to the nearest occupied covering Position', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GND']);
  store.setSignedOnPositions('c2', 'Bob', ['TWR']);
  // GND has no Observer, so vacating leaves it unstaffed; its covering
  // chain (CD -> GND -> TWR from GND's perspective is just "GND -> TWR")
  // should resolve to TWR, which IS occupied.
  const result = store.setSignedOnPositions('c1', 'Alice', []); // vacate GND
  assert.deepEqual(result.vacated, ['GND']);
  assert.equal(store.isStaffed('GND'), false);
  assert.equal(store.consolidatedAt('GND'), 'TWR');
});

test('D19: covering chain walks past an also-unoccupied intermediate Position to the next one that IS occupied', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['TWR']); // only TWR occupied; CD and GND are not
  // CD's chain is CD -> GND -> TWR; GND is unstaffed too, so it should skip to TWR.
  assert.equal(store.consolidatedAt('CD'), 'TWR');
});

test('D19: when the entire covering chain is unstaffed, consolidatedAt returns null — a distinct, checkable "nobody at all" condition, not a silent wrong answer', () => {
  const store = freshStore();
  // Nobody holds anything.
  assert.equal(store.consolidatedAt('CD'), null);
  assert.equal(store.consolidatedAt('GND'), null);
});

test('OPS and TWR have no covering Position at all, matching the guide\'s own chain table (CD->GND->TWR; OPS uncovered)', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['OPS']);
  store.setSignedOnPositions('c2', 'Bob', ['CD']);
  store.setSignedOnPositions('c3', 'Carol', ['GND']);
  store.setSignedOnPositions('c4', 'Dave', ['TWR']);
  assert.equal(store.consolidatedAt('OPS'), null);
  assert.equal(store.consolidatedAt('TWR'), null);
});

test('a non-abrupt vacate with a waiting Observer does NOT auto-promote — promotion is an explicit prompt (guide §4.8.6 rule 1)', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GND']);
  store.setSignedOnPositions('c2', 'Bob', ['GND']); // c2 becomes Observer
  store.setSignedOnPositions('c1', 'Alice', []); // Alice explicitly deselects GND
  assert.equal(store.isStaffed('GND'), false); // NOT auto-promoted
  assert.deepEqual(store.observersOf('GND').map(o => o.controllerId), ['c2']); // Bob is still just an Observer
});

test('onDisconnect (abrupt) DOES auto-promote the longest-waiting Observer', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GND']);
  store.setSignedOnPositions('c2', 'Bob', ['GND']);
  store.setSignedOnPositions('c3', 'Carol', ['GND']); // Bob is longest-waiting Observer, Carol second
  store.onDisconnect('c1');
  assert.equal(store.primaryOf('GND'), 'c2'); // Bob promoted, not Carol
  assert.deepEqual(store.observersOf('GND').map(o => o.controllerId), ['c3']);
});

test('onDisconnect with no waiting Observer simply leaves the Position unstaffed', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GND']);
  store.onDisconnect('c1');
  assert.equal(store.isStaffed('GND'), false);
});

test('onDisconnect releases every Position the controller held, not just one', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GND', 'TWR']);
  store.onDisconnect('c1');
  assert.equal(store.isStaffed('GND'), false);
  assert.equal(store.isStaffed('TWR'), false);
});

// ── setSignedOnPositions diffing / recomposition (guide §4.8.5) ────────────────

test('setSignedOnPositions only touches Positions that actually changed — holding an unrelated Position stays untouched across a change', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GND', 'TWR']);
  store.setSignedOnPositions('c1', 'Alice', ['GND']); // drops TWR, keeps GND
  assert.equal(store.primaryOf('GND'), 'c1'); // GND untouched, still c1's
  assert.equal(store.isStaffed('TWR'), false);
});

test('setSignedOnPositions filters out unknown Position ids rather than throwing', () => {
  const store = freshStore();
  const result = store.setSignedOnPositions('c1', 'Alice', ['GND', 'NOT_REAL']);
  assert.deepEqual(result.held, ['GND']);
});

test('re-declaring the exact same held set is a no-op — no spurious vacate/reclaim', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GND']);
  const result = store.setSignedOnPositions('c1', 'Alice', ['GND']);
  assert.deepEqual(result.vacated, []);
  assert.equal(store.primaryOf('GND'), 'c1');
});

// ── Combination across Positions (guide §4.8) ───────────────────────────────

test('one controller can hold multiple Positions simultaneously, each independently tracked', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['CD', 'GND', 'TWR']);
  assert.deepEqual(store.signedOnBy('c1').sort(), ['CD', 'GND', 'TWR']);
  assert.equal(store.primaryOf('CD'), 'c1');
  assert.equal(store.primaryOf('GND'), 'c1');
  assert.equal(store.primaryOf('TWR'), 'c1');
});

// ── Self-coordination (guide §4.8.3, defect D20) ────────────────────────────

test('isSelfCoordinated is true when the controller holds Primary at the destination Position', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GND', 'TWR']);
  assert.equal(store.isSelfCoordinated('c1', 'TWR'), true);
});

test('isSelfCoordinated is false for a different controller, or a Position the controller does not hold', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GND']);
  store.setSignedOnPositions('c2', 'Bob', ['TWR']);
  assert.equal(store.isSelfCoordinated('c1', 'TWR'), false);
  assert.equal(store.isSelfCoordinated('c2', 'GND'), false);
});

test('isSelfCoordinated is false when the controller is merely an Observer at the destination, not Primary', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['TWR']);
  store.setSignedOnPositions('c2', 'Bob', ['TWR']); // Bob is Observer
  assert.equal(store.isSelfCoordinated('c2', 'TWR'), false);
});

// ── getAll() shape ───────────────────────────────────────────────────────

test('getAll returns every configured Position, including unstaffed ones', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['GND']);
  const all = store.getAll();
  assert.deepEqual(all.map(p => p.positionId).sort(), POSITIONS.slice().sort());
});

test('getAll\'s coveringFor lists the unstaffed Positions currently routing through this one', () => {
  const store = freshStore();
  store.setSignedOnPositions('c1', 'Alice', ['TWR']); // CD and GND unstaffed, both eventually cover to TWR
  const twr = store.getAll().find(p => p.positionId === 'TWR');
  assert.deepEqual(twr.coveringFor.sort(), ['CD', 'GND']);
});
