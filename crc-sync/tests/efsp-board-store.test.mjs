import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

const { BoardStore } = await import('../src/efsp/board-store.js');
const { FdrStore } = await import('../src/efsp/fdr-store.js');

// A minimal, deterministic `rules` fixture standing in for block-map.js /
// facility-config.js / nla.js / position-store.js, which don't exist yet at
// this point in the build sequence (board-store.js is intentionally
// decoupled from all of them via dependency injection).
function makeRules(overrides = {}) {
  return {
    resolveBlockTarget: (blockId) => {
      if (blockId === '5') return { kind: 'fdr', path: 'identity.beaconAssigned' };
      if (blockId === '9E') return { kind: 'fdr', path: 'filed.remarks' };
      if (blockId === '7') return { kind: 'annotation' }; // pretend Block 7 is annotation-routed for this fixture
      if (blockId === 'UNKNOWN') return null;
      return { kind: 'annotation' };
    },
    bayImpliesState: (bayId) => {
      if (bayId === 'pending-clearance') return 'PENDING_CLEARANCE';
      if (bayId === 'runway-queue') return 'RUNWAY_QUEUE';
      return null;
    },
    computeNla: (strip) => {
      if (strip.state === 'PROPOSED') return { toState: 'PENDING_CLEARANCE' };
      if (strip.state === 'PENDING_CLEARANCE') return { toState: 'CLEARED' };
      if (strip.state === 'CLEARED') return { inhibited: 'hold in force' };
      return null;
    },
    isOccupied: (positionId) => positionId !== 'UNMANNED',
    coveringPositionFor: (positionId) => (positionId === 'UNMANNED' ? 'COVER' : null),
    isValidState: (state) => ['PROPOSED', 'PENDING_CLEARANCE', 'CLEARED', 'RUNWAY_QUEUE', 'DEPARTED', 'DROPPED'].includes(state),
    ...overrides,
  };
}

function makeStore(rulesOverrides) {
  const fdrStore = new FdrStore();
  const board = new BoardStore(fdrStore, makeRules(rulesOverrides));
  return { board, fdrStore };
}

function createMutation(overrides = {}) {
  return {
    clientMutationId: crypto.randomUUID(),
    op: {
      kind: 'CreateStrip',
      bayId: 'proposed', rackId: 'main',
      fdr: { callsign: 'VIPER1', aircraftType: 'F16', wakeCategory: 'D', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250' },
    },
    ...overrides,
  };
}

function createStrip(board, actingPositionId = 'OPS', overrides = {}) {
  const result = board.applyMutation(createMutation(overrides), actingPositionId, actingPositionId);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.strip;
}

function mutation(strip, op, overrides = {}) {
  return { clientMutationId: crypto.randomUUID(), stripId: strip.stripId, baseRev: strip.rev, op, ...overrides };
}

// ── CreateStrip ──────────────────────────────────────────────────────────

test('CreateStrip creates a Strip owned by the acting Position, with a minted FDR/beacon', () => {
  const { board } = makeStore();
  const strip = createStrip(board, 'OPS');
  assert.equal(strip.ownerPositionId, 'OPS');
  assert.equal(strip.role, 'DEPARTURE');
  assert.equal(strip.state, 'PROPOSED');
  assert.equal(strip.rev, 1);
  assert.ok(strip.cid);
  assert.ok(strip.fdrId);
});

test('CreateStrip appends new Strips at the end of the target Rack by default', () => {
  const { board } = makeStore();
  const a = createStrip(board, 'OPS', { op: { ...createMutation().op, fdr: { ...createMutation().op.fdr, callsign: 'AAA1111' } } });
  const b = createStrip(board, 'OPS', { op: { ...createMutation().op, fdr: { ...createMutation().op.fdr, callsign: 'BBB2222' } } });
  const rack = board.getRack('proposed', 'main');
  assert.deepEqual(rack.map(s => s.stripId), [a.stripId, b.stripId]);
});

test('CreateStrip with an invalid FDR seed (bad callsign) is rejected and creates no Strip', () => {
  const { board } = makeStore();
  const mut = createMutation({ op: { ...createMutation().op, fdr: { ...createMutation().op.fdr, callsign: 'TOOLONGCALLSIGN' } } });
  const result = board.applyMutation(mut, 'OPS', 'OPS');
  assert.equal(result.ok, false);
  assert.equal(board.getAll().length, 0);
});

// ── Optimistic concurrency (baseRev / STALE_REV, defect D6) ────────────────

test('a Mutation with a stale baseRev is rejected and returns the current Strip', () => {
  const { board } = makeStore();
  const strip = createStrip(board);
  const revAtCreation = strip.rev; // board-store returns/stores live references — snapshot the primitive now, before it mutates in place
  board.applyMutation(mutation(strip, { kind: 'SetFlag', flag: 'offset', value: true }), 'OPS', 'OPS');

  const staleResult = board.applyMutation(
    { clientMutationId: crypto.randomUUID(), stripId: strip.stripId, baseRev: revAtCreation /* stale — real rev is now +1 */, op: { kind: 'SetFlag', flag: 'highlight', value: 'yellow' } },
    'OPS', 'OPS'
  );
  assert.equal(staleResult.ok, false);
  assert.equal(staleResult.reason, 'STALE_REV');
  assert.equal(staleResult.strip.rev, revAtCreation + 1); // current Strip, not the stale one
  assert.equal(staleResult.strip.flags.offset, true);
});

test('a Mutation against an unknown stripId returns NOT_FOUND', () => {
  const { board } = makeStore();
  const result = board.applyMutation(
    { clientMutationId: crypto.randomUUID(), stripId: 'does-not-exist', baseRev: 1, op: { kind: 'SetFlag', flag: 'offset', value: true } },
    'OPS', 'OPS'
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NOT_FOUND');
});

// ── Idempotent replay (clientMutationId, defect D7) ─────────────────────────

test('replaying a Mutation with the same clientMutationId does not double-apply', () => {
  const { board } = makeStore();
  const strip = createStrip(board);
  const revAtCreation = strip.rev; // snapshot the primitive before it mutates in place
  const mut = mutation(strip, { kind: 'SetFlag', flag: 'offset', value: true });

  const r1 = board.applyMutation(mut, 'OPS', 'OPS');
  const r2 = board.applyMutation(mut, 'OPS', 'OPS'); // exact same clientMutationId, replayed
  assert.equal(r1.ok, true);
  assert.deepEqual(r2, r1); // cached result returned verbatim, not reapplied
  assert.equal(board.getStrip(strip.stripId).rev, revAtCreation + 1); // only bumped once
});

test('idempotent replay works even for a Mutation that originally failed', () => {
  const { board } = makeStore();
  const strip = createStrip(board);
  const badMut = mutation(strip, { kind: 'SetFlag', flag: 'not-a-real-flag', value: true });
  const r1 = board.applyMutation(badMut, 'OPS', 'OPS');
  const r2 = board.applyMutation(badMut, 'OPS', 'OPS');
  assert.equal(r1.ok, false);
  assert.deepEqual(r2, r1);
});

// ── Ownership (guide §4.4 rule 2) ───────────────────────────────────────────

test('a Mutation from a Position that does not own the Strip is rejected as NOT_OWNER', () => {
  const { board } = makeStore();
  const strip = createStrip(board, 'OPS');
  const result = board.applyMutation(mutation(strip, { kind: 'SetFlag', flag: 'offset', value: true }), 'GND', 'GND');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NOT_OWNER');
});

// ── MoveStrip + Bay-implies-state coupling ──────────────────────────────────

test('MoveStrip changes Bay/Rack placement and orderKey', () => {
  const { board } = makeStore();
  const strip = createStrip(board);
  const result = board.applyMutation(mutation(strip, { kind: 'MoveStrip', bayId: 'pending', rackId: 'main' }), 'OPS', 'OPS');
  assert.equal(result.ok, true);
  assert.equal(result.strip.bayId, 'pending');
  assert.ok(result.strip.orderKey);
});

test('MoveStrip into a Bay configured with bayImpliesState atomically sets the Strip state too, in one rev bump, when it is the strip\'s legal next state', () => {
  const { board } = makeStore();
  const strip = createStrip(board); // PROPOSED — fixture's legal next state is PENDING_CLEARANCE
  const revBefore = strip.rev;
  const result = board.applyMutation(mutation(strip, { kind: 'MoveStrip', bayId: 'pending-clearance', rackId: 'main' }), 'OPS', 'OPS');
  assert.equal(result.ok, true);
  assert.equal(result.strip.state, 'PENDING_CLEARANCE');
  assert.equal(result.strip.rev, revBefore + 1); // exactly one bump, not two
});

test('MoveStrip into a Bay whose implied state SKIPS AHEAD of the strip\'s legal next state is rejected outright, not silently applied — this is the doctrine-bypass bug: dragging must not let a Strip skip every NLA check (flight plan, beacon code, ...) that InvokeNla would have enforced', () => {
  const { board } = makeStore();
  const strip = createStrip(board); // PROPOSED — legal next state is PENDING_CLEARANCE, NOT RUNWAY_QUEUE
  const result = board.applyMutation(mutation(strip, { kind: 'MoveStrip', bayId: 'runway-queue', rackId: 'rwy-27' }), 'OPS', 'OPS');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
  assert.equal(board.getStrip(strip.stripId).state, 'PROPOSED'); // untouched — the whole Mutation was rejected, not partially applied
  assert.equal(board.getStrip(strip.stripId).bayId, strip.bayId); // Bay/owner also untouched
});

test('MoveStrip into a Bay whose implied state matches the strip\'s legal next state, but that transition is currently INHIBITED, is rejected with the inhibit reason', () => {
  const { board } = makeStore();
  const strip = createStrip(board);
  board.applyMutation(mutation(strip, { kind: 'SetState', toState: 'CLEARED' }), 'OPS', 'OPS'); // fixture: CLEARED's next transition is inhibited ("hold in force")
  const cleared = board.getStrip(strip.stripId);
  const result = board.applyMutation(mutation(cleared, { kind: 'MoveStrip', bayId: 'runway-queue', rackId: 'rwy-27' }), 'OPS', 'OPS');
  // Neither bay implies CLEARED's own state, nor is there a legal next
  // transition to compare against — computeNla returns {inhibited:...}
  // for CLEARED regardless of target Bay, so this is rejected as inhibited.
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NLA_INHIBITED');
  assert.equal(result.detail, 'hold in force');
});

test('MoveStrip into a Bay with no implied state leaves the Strip state unchanged', () => {
  const { board } = makeStore();
  const strip = createStrip(board);
  const result = board.applyMutation(mutation(strip, { kind: 'MoveStrip', bayId: 'pending', rackId: 'main' }), 'OPS', 'OPS');
  assert.equal(result.strip.state, strip.state);
});

test('MoveStrip resolves orderKey between explicit afterStripId/beforeStripId neighbors', () => {
  const { board } = makeStore();
  const a = createStrip(board, 'OPS', { op: { ...createMutation().op, fdr: { ...createMutation().op.fdr, callsign: 'AAA1111' } } });
  const b = createStrip(board, 'OPS', { op: { ...createMutation().op, fdr: { ...createMutation().op.fdr, callsign: 'BBB2222' } } });
  const c = createStrip(board, 'OPS', { op: { ...createMutation().op, fdr: { ...createMutation().op.fdr, callsign: 'CCC3333' } } });
  // Move c between a and b.
  const result = board.applyMutation(
    mutation(c, { kind: 'MoveStrip', bayId: 'proposed', rackId: 'main', afterStripId: a.stripId, beforeStripId: b.stripId }),
    'OPS', 'OPS'
  );
  assert.equal(result.ok, true);
  const rack = board.getRack('proposed', 'main');
  assert.deepEqual(rack.map(s => s.stripId), [a.stripId, c.stripId, b.stripId]);
});

test('MoveStrip triggers a Rack rebalance transparently when orderKey headroom is exhausted', () => {
  const { board } = makeStore();
  const a = createStrip(board, 'OPS', { op: { ...createMutation().op, fdr: { ...createMutation().op.fdr, callsign: 'AAA1111' } } });
  const b = createStrip(board, 'OPS', { op: { ...createMutation().op, fdr: { ...createMutation().op.fdr, callsign: 'BBB2222' } } });

  // Force b's orderKey into the exact "a + minDigit" exhaustion shape by
  // repeatedly moving b to sit directly after a until we can't any more —
  // simpler: directly manipulate via many MoveStrip-before-b calls isn't
  // deterministic given jitter, so instead assert the *mechanism* works by
  // moving a third strip between two strips whose keys are already forced
  // adjacent through repeated inserts, and confirming the Rack stays sorted
  // no matter how many times we insert at the same tight slot.
  let prev = a, mid = b;
  for (let i = 0; i < 40; i++) {
    const c = createStrip(board, 'OPS', { op: { ...createMutation().op, fdr: { ...createMutation().op.fdr, callsign: 'C' + i.toString().padStart(6, '0') } } });
    const result = board.applyMutation(
      mutation(c, { kind: 'MoveStrip', bayId: 'proposed', rackId: 'main', afterStripId: prev.stripId, beforeStripId: mid.stripId }),
      'OPS', 'OPS'
    );
    assert.equal(result.ok, true, `insertion ${i} failed: ${JSON.stringify(result)}`);
    mid = result.strip;
  }
  const rack = board.getRack('proposed', 'main');
  const keys = rack.map(s => s.orderKey);
  assert.deepEqual(keys, [...keys].sort());
});

// ── SetBlock: fdr-routed and annotation-routed ──────────────────────────────

test('SetBlock routed to an fdr path writes through fdr-store and bumps the Strip rev too', () => {
  const { board, fdrStore } = makeStore();
  const strip = createStrip(board);
  const revBefore = strip.rev; // snapshot the primitive — `strip` and `result.strip` below are the same live object
  const result = board.applyMutation(mutation(strip, { kind: 'SetBlock', blockId: '9E', value: 'NORDO PRACTICE' }), 'OPS', 'OPS');
  assert.equal(result.ok, true);
  assert.equal(fdrStore.getFdr(strip.fdrId).filed.remarks, 'NORDO PRACTICE');
  assert.equal(result.strip.rev, revBefore + 1);
});

test('SetBlock routed to beaconAssigned surfaces a duplicate warning without failing (defect D23)', () => {
  const { board, fdrStore } = makeStore();
  const a = createStrip(board, 'OPS', { op: { ...createMutation().op, fdr: { ...createMutation().op.fdr, callsign: 'AAA1111' } } });
  const b = createStrip(board, 'OPS', { op: { ...createMutation().op, fdr: { ...createMutation().op.fdr, callsign: 'BBB2222' } } });
  const aCode = fdrStore.getFdr(a.fdrId).identity.beaconAssigned;

  const result = board.applyMutation(mutation(b, { kind: 'SetBlock', blockId: '5', value: aCode }), 'OPS', 'OPS');
  assert.equal(result.ok, true);
  assert.equal(result.warning, 'DUPLICATE_IGNORED_WARNING');
});

test('SetBlock routed to an fdr path fails cleanly on invalid input (reserved beacon code) and does not bump rev', () => {
  const { board } = makeStore();
  const strip = createStrip(board);
  const revBefore = strip.rev; // snapshot the primitive — board.getStrip() below returns the same live object as `strip`, so comparing them directly would be a tautology regardless of correctness
  const result = board.applyMutation(mutation(strip, { kind: 'SetBlock', blockId: '5', value: '7700' }), 'OPS', 'OPS');
  assert.equal(result.ok, false);
  assert.equal(board.getStrip(strip.stripId).rev, revBefore);
});

test('SetBlock on an unknown blockId is rejected as VALIDATION_ERROR', () => {
  const { board } = makeStore();
  const strip = createStrip(board);
  const result = board.applyMutation(mutation(strip, { kind: 'SetBlock', blockId: 'UNKNOWN', value: 'x' }), 'OPS', 'OPS');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
});

test('SetBlock routed to an annotation appends an ACTIVE entry and marks the prior one SUPERSEDED, never STRUCK', () => {
  const { board } = makeStore();
  const strip = createStrip(board);
  board.applyMutation(mutation(strip, { kind: 'SetBlock', blockId: '7', value: '250' }), 'OPS', 'OPS');
  const afterFirst = board.getStrip(strip.stripId);
  const r2 = board.applyMutation(mutation(afterFirst, { kind: 'SetBlock', blockId: '7', value: '270' }), 'OPS', 'OPS');

  const cell = r2.strip.annotations['7'];
  assert.equal(cell.entries.length, 2);
  assert.equal(cell.entries[0].value, '250');
  assert.equal(cell.entries[0].status, 'SUPERSEDED');
  assert.equal(cell.entries[1].value, '270');
  assert.equal(cell.entries[1].status, 'ACTIVE');
});

test('confirmVacated marks the active annotation entry STRUCK, not SUPERSEDED, and appends nothing new', () => {
  const { board } = makeStore();
  const strip = createStrip(board);
  board.applyMutation(mutation(strip, { kind: 'SetBlock', blockId: '7', value: '250' }), 'OPS', 'OPS');
  const afterFirst = board.getStrip(strip.stripId);
  const r2 = board.applyMutation(mutation(afterFirst, { kind: 'SetBlock', blockId: '7', value: null, confirmVacated: true }), 'OPS', 'OPS');

  const cell = r2.strip.annotations['7'];
  assert.equal(cell.entries.length, 1); // no new entry appended
  assert.equal(cell.entries[0].status, 'STRUCK');
});

test('confirmVacated with no active entry to strike is rejected', () => {
  const { board } = makeStore();
  const strip = createStrip(board);
  const result = board.applyMutation(mutation(strip, { kind: 'SetBlock', blockId: '7', value: null, confirmVacated: true }), 'OPS', 'OPS');
  assert.equal(result.ok, false);
});

// ── SetFlag ──────────────────────────────────────────────────────────────

test('SetFlag sets one of the four paper-gesture flags in a single Mutation (§7.3 one-input cost ceiling)', () => {
  const { board } = makeStore();
  const strip = createStrip(board);
  for (const [flag, value] of [['offset', true], ['flipped', true], ['highlight', 'yellow'], ['attention', 'red']]) {
    const s = board.getStrip(strip.stripId);
    const result = board.applyMutation(mutation(s, { kind: 'SetFlag', flag, value }), 'OPS', 'OPS');
    assert.equal(result.ok, true, flag);
    assert.equal(result.strip.flags[flag], value);
  }
});

test('SetFlag rejects an unknown flag name', () => {
  const { board } = makeStore();
  const strip = createStrip(board);
  const result = board.applyMutation(mutation(strip, { kind: 'SetFlag', flag: 'bogus', value: true }), 'OPS', 'OPS');
  assert.equal(result.ok, false);
});

// ── SetState / InvokeNla ────────────────────────────────────────────────────

test('SetState is a direct path, independent of InvokeNla (§3.5 rule 4)', () => {
  const { board } = makeStore();
  const strip = createStrip(board);
  const result = board.applyMutation(mutation(strip, { kind: 'SetState', toState: 'DEPARTED' }), 'OPS', 'OPS');
  assert.equal(result.ok, true);
  assert.equal(result.strip.state, 'DEPARTED');
});

test('SetState rejects a state unknown to isValidState when the rule is supplied', () => {
  const { board } = makeStore();
  const strip = createStrip(board);
  const result = board.applyMutation(mutation(strip, { kind: 'SetState', toState: 'NOT_A_REAL_STATE' }), 'OPS', 'OPS');
  assert.equal(result.ok, false);
});

test('InvokeNla applies computeNla\'s toState when not inhibited', () => {
  const { board } = makeStore();
  const strip = createStrip(board); // state: PROPOSED, fixture computeNla returns PENDING_CLEARANCE
  const result = board.applyMutation(mutation(strip, { kind: 'InvokeNla' }), 'OPS', 'OPS');
  assert.equal(result.ok, true);
  assert.equal(result.strip.state, 'PENDING_CLEARANCE');
});

test('InvokeNla returns NLA_INHIBITED with the reason, and does not change state, when inhibited', () => {
  const { board } = makeStore();
  const strip = createStrip(board);
  board.applyMutation(mutation(strip, { kind: 'SetState', toState: 'CLEARED' }), 'OPS', 'OPS');
  const cleared = board.getStrip(strip.stripId);
  const result = board.applyMutation(mutation(cleared, { kind: 'InvokeNla' }), 'OPS', 'OPS');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NLA_INHIBITED');
  assert.equal(result.detail, 'hold in force');
  assert.equal(board.getStrip(strip.stripId).state, 'CLEARED');
});

test('InvokeNla with no NLA defined for the current state is inhibited generically', () => {
  const { board } = makeStore();
  const strip = createStrip(board);
  board.applyMutation(mutation(strip, { kind: 'SetState', toState: 'DEPARTED' }), 'OPS', 'OPS'); // fixture computeNla returns null for DEPARTED
  const departed = board.getStrip(strip.stripId);
  const result = board.applyMutation(mutation(departed, { kind: 'InvokeNla' }), 'OPS', 'OPS');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NLA_INHIBITED');
});

// ── InvokeNla double-tap guard + Undo (guide §3.5 rules 3 and 5) ────────────

test('a second InvokeNla within 400ms is discarded (idempotent), not applied a second time', () => {
  const { board } = makeStore();
  const strip = createStrip(board); // PROPOSED -> PENDING_CLEARANCE on first InvokeNla
  const r1 = board.applyMutation(mutation(strip, { kind: 'InvokeNla' }), 'OPS', 'OPS'); // mutation() mints a fresh clientMutationId
  assert.equal(r1.strip.state, 'PENDING_CLEARANCE');

  // A second, DIFFERENT clientMutationId (simulating an actual double-tap,
  // not a replay) against the now-current rev, within the 400ms window.
  const afterFirst = board.getStrip(strip.stripId);
  const r2 = board.applyMutation(
    { clientMutationId: crypto.randomUUID(), stripId: afterFirst.stripId, baseRev: afterFirst.rev, op: { kind: 'InvokeNla' } },
    'OPS', 'OPS'
  );
  assert.equal(r2.ok, true);
  assert.equal(r2.strip.state, 'PENDING_CLEARANCE'); // unchanged — not advanced to CLEARED
});

test('InvokeNla after the 400ms window applies normally', async () => {
  // The shared fixture's computeNla only defines PROPOSED and CLEARED;
  // this test needs a second real transition (PENDING_CLEARANCE ->
  // CLEARED) to prove the SECOND call actually re-applied rather than
  // just happening to no-op — supply a fuller local override.
  const { board } = makeStore({
    computeNla: (strip) => {
      if (strip.state === 'PROPOSED') return { toState: 'PENDING_CLEARANCE' };
      if (strip.state === 'PENDING_CLEARANCE') return { toState: 'CLEARED' };
      return null;
    },
  });
  const strip = createStrip(board);
  board.applyMutation(mutation(strip, { kind: 'InvokeNla' }), 'OPS', 'OPS');

  await new Promise(resolve => setTimeout(resolve, 420));

  const afterFirst = board.getStrip(strip.stripId);
  const result = board.applyMutation(mutation(afterFirst, { kind: 'InvokeNla' }), 'OPS', 'OPS');
  assert.equal(result.ok, true);
  assert.equal(result.strip.state, 'CLEARED');
});

test('Undo reverts the last NLA-driven transition within the 30s window', () => {
  const { board } = makeStore();
  const strip = createStrip(board); // PROPOSED
  board.applyMutation(mutation(strip, { kind: 'InvokeNla' }), 'OPS', 'OPS'); // -> PENDING_CLEARANCE
  const afterNla = board.getStrip(strip.stripId);
  assert.equal(afterNla.state, 'PENDING_CLEARANCE');

  const result = board.applyMutation(mutation(afterNla, { kind: 'Undo' }), 'OPS', 'OPS');
  assert.equal(result.ok, true);
  assert.equal(result.strip.state, 'PROPOSED');
});

test('Undo with no prior NLA transition is rejected', () => {
  const { board } = makeStore();
  const strip = createStrip(board);
  const result = board.applyMutation(mutation(strip, { kind: 'Undo' }), 'OPS', 'OPS');
  assert.equal(result.ok, false);
});

test('Undo consumes the window — a second Undo immediately after has nothing left to revert', () => {
  const { board } = makeStore();
  const strip = createStrip(board);
  board.applyMutation(mutation(strip, { kind: 'InvokeNla' }), 'OPS', 'OPS');
  const afterNla = board.getStrip(strip.stripId);
  board.applyMutation(mutation(afterNla, { kind: 'Undo' }), 'OPS', 'OPS');

  const afterUndo = board.getStrip(strip.stripId);
  const result = board.applyMutation(mutation(afterUndo, { kind: 'Undo' }), 'OPS', 'OPS');
  assert.equal(result.ok, false);
});

// ── Transfer-shaped NLA transitions (Phase 2, docs/adr/0007) ────────────
// computeNla() can return {toState, transferTo} — e.g. DEPARTED's real
// Hand Off to APP — routing through the exact same atomic _applyTransferStrip
// a controller-initiated drag transfer uses, not a separate path.

function makeTransferNlaRules(overrides = {}) {
  return {
    resolveBlockTarget: () => ({ kind: 'annotation' }),
    bayImpliesState: (bayId) => (bayId === 'app-departures' ? 'HANDED_OFF' : null),
    bayForImpliedState: (positionId, state) =>
      (positionId === 'APP' && state === 'HANDED_OFF' ? { bayId: 'app-departures', rackIds: ['main'] } : null),
    computeNla: (strip) => (strip.state === 'DEPARTED' ? { toState: 'HANDED_OFF', transferTo: 'APP' } : null),
    isOccupied: (positionId) => positionId === 'APP',
    coveringPositionFor: () => null,
    isValidState: () => true,
    ...overrides,
  };
}

test('a transfer-shaped InvokeNla changes owner, Bay, and state atomically, in one Mutation', () => {
  const fdrStore = new FdrStore();
  const board = new BoardStore(fdrStore, makeTransferNlaRules());
  const strip = createStrip(board, 'TWR', { op: { ...createMutation().op, bayId: 'twr-airborne', rackId: 'main' } });
  board.applyMutation({ clientMutationId: crypto.randomUUID(), stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'SetState', toState: 'DEPARTED' } }, 'TWR', 'TWR');
  const departed = board.getStrip(strip.stripId);

  const result = board.applyMutation(mutation(departed, { kind: 'InvokeNla' }), 'TWR', 'TWR');
  assert.equal(result.ok, true);
  assert.equal(result.strip.ownerPositionId, 'APP');
  assert.equal(result.strip.bayId, 'app-departures');
  assert.equal(result.strip.state, 'HANDED_OFF');
});

test('a transfer-shaped InvokeNla to an unoccupied, uncovered Position is rejected via _applyTransferStrip\'s own occupancy gate, and the Strip stays with the sender — defense in depth even when computeNla itself doesn\'t pre-check occupancy (the real nla.js does; this fixture deliberately doesn\'t, to exercise board-store.js\'s own gate)', () => {
  const fdrStore = new FdrStore();
  const board = new BoardStore(fdrStore, makeTransferNlaRules({ isOccupied: () => false, coveringPositionFor: () => null }));
  const strip = createStrip(board, 'TWR', { op: { ...createMutation().op, bayId: 'twr-airborne', rackId: 'main' } });
  board.applyMutation({ clientMutationId: crypto.randomUUID(), stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'SetState', toState: 'DEPARTED' } }, 'TWR', 'TWR');
  const departed = board.getStrip(strip.stripId);

  const result = board.applyMutation(mutation(departed, { kind: 'InvokeNla' }), 'TWR', 'TWR');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NO_RECEIVING_POSITION');
  assert.equal(board.getStrip(strip.stripId).ownerPositionId, 'TWR');
});

test('a transfer-shaped InvokeNla is NOT recorded into the Undo window (docs/adr/0009) — Undo reports unavailable right after', () => {
  const fdrStore = new FdrStore();
  const board = new BoardStore(fdrStore, makeTransferNlaRules());
  const strip = createStrip(board, 'TWR', { op: { ...createMutation().op, bayId: 'twr-airborne', rackId: 'main' } });
  board.applyMutation({ clientMutationId: crypto.randomUUID(), stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'SetState', toState: 'DEPARTED' } }, 'TWR', 'TWR');
  const departed = board.getStrip(strip.stripId);
  board.applyMutation(mutation(departed, { kind: 'InvokeNla' }), 'TWR', 'TWR');

  const handedOff = board.getStrip(strip.stripId);
  const undoResult = board.applyMutation(mutation(handedOff, { kind: 'Undo' }), 'APP', 'APP');
  assert.equal(undoResult.ok, false);
});

test('an ordinary TransferStrip clears any PENDING Undo window for that Strip — a stale state-only Undo must not fire after ownership has moved', () => {
  const { board } = makeStore({
    bayImpliesState: () => null, // the destination Bay in this test implies no state, so the transfer is a pure ownership move
  });
  const strip = createStrip(board); // PROPOSED
  board.applyMutation(mutation(strip, { kind: 'InvokeNla' }), 'OPS', 'OPS'); // -> PENDING_CLEARANCE, recorded in _nlaHistory
  const afterNla = board.getStrip(strip.stripId);

  board.applyMutation(mutation(afterNla, { kind: 'TransferStrip', toPositionId: 'MANNED', bayId: 'somewhere', rackId: 'main' }), 'OPS', 'OPS');
  const afterTransfer = board.getStrip(strip.stripId);

  const undoResult = board.applyMutation(mutation(afterTransfer, { kind: 'Undo' }), 'MANNED', 'MANNED');
  assert.equal(undoResult.ok, false);
});

// ── Per-State authority (guide §3.4 "normally owned by", permission.js's
// canActOnState) — checked in ADDITION to raw ownership. The hazard this
// closes: a Position that legitimately OWNS a Strip (nothing transfers
// ownership automatically) could otherwise invoke ANY NLA on it, including
// ones that are doctrinally another Position's job — e.g. OPS pressing
// "Mark Cleared" on a Strip it created and simply never handed to CD.

function makeStateOwnerRules(overrides = {}) {
  return {
    canActOnState: (actingPositionId, role, state) => {
      const owners = { PROPOSED: ['OPS'], PENDING_CLEARANCE: ['CD'], CLEARED: ['CD'] };
      return !!owners[state] && owners[state].includes(actingPositionId);
    },
    bayImpliesState: (bayId) => {
      if (bayId === 'pending-clearance') return 'PENDING_CLEARANCE';
      if (bayId === 'cleared') return 'CLEARED';
      return null;
    },
    computeNla: (strip) => {
      if (strip.state === 'PROPOSED') return { toState: 'PENDING_CLEARANCE' };
      if (strip.state === 'PENDING_CLEARANCE') return { toState: 'CLEARED' };
      return null;
    },
    resolveBlockTarget: () => ({ kind: 'annotation' }),
    isOccupied: () => true,
    coveringPositionFor: () => null,
    isValidState: () => true,
    ...overrides,
  };
}

function makeStateOwnerStore(rulesOverrides) {
  const fdrStore = new FdrStore();
  const board = new BoardStore(fdrStore, makeStateOwnerRules(rulesOverrides));
  return { board, fdrStore };
}

test('InvokeNla succeeds for the Position that IS the current state\'s normal owner', () => {
  const { board } = makeStateOwnerStore();
  const strip = createStrip(board, 'OPS'); // PROPOSED, owned by OPS — OPS owns PROPOSED per this fixture
  const result = board.applyMutation(mutation(strip, { kind: 'InvokeNla' }), 'OPS', 'OPS');
  assert.equal(result.ok, true);
  assert.equal(result.strip.state, 'PENDING_CLEARANCE');
});

test('InvokeNla is rejected PERMISSION_DENIED for a Position that owns the Strip but is NOT the current state\'s normal owner — the exact hazard: OPS still holds a PENDING_CLEARANCE Strip it never transferred to CD, and must not be able to advance it', () => {
  const { board } = makeStateOwnerStore();
  const strip = createStrip(board, 'OPS'); // PROPOSED, still owned by OPS
  // SetState (the direct/admin path, §3.5 rule 4) simulates "OPS legitimately
  // advanced this via Send to Clearance a moment ago" without exercising
  // InvokeNla's own 400ms double-tap guard, which would otherwise discard a
  // second back-to-back InvokeNla call as a no-op before this test's real
  // assertion — a different mechanism than the one under test here.
  board.applyMutation({ clientMutationId: crypto.randomUUID(), stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'SetState', toState: 'PENDING_CLEARANCE' } }, 'OPS', 'OPS');
  const pending = board.getStrip(strip.stripId);
  assert.equal(pending.ownerPositionId, 'OPS'); // still OPS — nothing transfers ownership automatically

  const result = board.applyMutation(mutation(pending, { kind: 'InvokeNla' }), 'OPS', 'OPS');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PERMISSION_DENIED');
  assert.match(result.detail, /PENDING_CLEARANCE/);
  assert.equal(board.getStrip(strip.stripId).state, 'PENDING_CLEARANCE'); // unchanged
});

test('the legitimate owner (CD) CAN advance a PENDING_CLEARANCE Strip it actually owns', () => {
  const { board } = makeStateOwnerStore();
  const strip = createStrip(board, 'CD'); // created directly owned by CD for this focused test
  board.applyMutation({ clientMutationId: crypto.randomUUID(), stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'SetState', toState: 'PENDING_CLEARANCE' } }, 'CD', 'CD');
  const pending = board.getStrip(strip.stripId);

  const result = board.applyMutation(mutation(pending, { kind: 'InvokeNla' }), 'CD', 'CD');
  assert.equal(result.ok, true);
  assert.equal(result.strip.state, 'CLEARED');
});

test('the SAME authority gate applies to the drag path (MoveStrip into an implied-state Bay), not just the NLA button — closing the trivial bypass guide §3.5 rule 4 would otherwise leave open', () => {
  const { board } = makeStateOwnerStore();
  const strip = createStrip(board, 'OPS'); // PROPOSED
  board.applyMutation(mutation(strip, { kind: 'InvokeNla' }), 'OPS', 'OPS'); // legit: OPS -> PENDING_CLEARANCE
  const pending = board.getStrip(strip.stripId);

  // OPS attempts to drag the still-OPS-owned Strip directly into a Bay
  // implying CLEARED — the same "Mark Cleared" advance, just via drag
  // instead of the button.
  const result = board.applyMutation(mutation(pending, { kind: 'MoveStrip', bayId: 'cleared', rackId: 'main' }), 'OPS', 'OPS');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PERMISSION_DENIED');
  assert.equal(board.getStrip(strip.stripId).state, 'PENDING_CLEARANCE'); // unchanged
});

test('without a canActOnState rule supplied, this gate is simply skipped (opt-in hook, existing fixtures/tests unaffected)', () => {
  const { board } = makeStore(); // the module's default fixture — no canActOnState defined
  const strip = createStrip(board, 'OPS');
  // SetState for setup, not a second InvokeNla — avoids the unrelated
  // 400ms double-tap guard, which would make this test pass for the wrong
  // reason (a discarded double-tap also returns ok:true).
  board.applyMutation({ clientMutationId: crypto.randomUUID(), stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'SetState', toState: 'PENDING_CLEARANCE' } }, 'OPS', 'OPS');
  const pending = board.getStrip(strip.stripId);
  const result = board.applyMutation(mutation(pending, { kind: 'InvokeNla' }), 'OPS', 'OPS'); // fixture's computeNla: PENDING_CLEARANCE -> CLEARED
  assert.equal(result.ok, true);
});

// ── TransferStrip: occupancy gating + covering chain (guide §4.5) ──────────

test('TransferStrip to an occupied Position succeeds and changes owner + Bay/Rack atomically', () => {
  const { board } = makeStore();
  const strip = createStrip(board, 'OPS');
  const result = board.applyMutation(
    mutation(strip, { kind: 'TransferStrip', toPositionId: 'CD', bayId: 'pending-clearance', rackId: 'main' }),
    'OPS', 'OPS'
  );
  assert.equal(result.ok, true);
  assert.equal(result.strip.ownerPositionId, 'CD');
  assert.equal(result.strip.bayId, 'pending-clearance');
  assert.equal(result.routedTo, null);
});

test('TransferStrip into a Bay configured with bayImpliesState atomically sets the Strip state too, in one rev bump, when it is the strip\'s legal next state', () => {
  const { board } = makeStore();
  const strip = createStrip(board, 'OPS'); // PROPOSED — fixture's legal next state is PENDING_CLEARANCE
  const revBefore = strip.rev;
  const result = board.applyMutation(
    mutation(strip, { kind: 'TransferStrip', toPositionId: 'CD', bayId: 'pending-clearance', rackId: 'main' }),
    'OPS', 'OPS'
  );
  assert.equal(result.ok, true);
  assert.equal(result.strip.state, 'PENDING_CLEARANCE');
  assert.equal(result.strip.ownerPositionId, 'CD');
  assert.equal(result.strip.rev, revBefore + 1); // exactly one bump, not two
});

test('TransferStrip into a Bay whose implied state SKIPS AHEAD of the strip\'s legal next state is rejected outright — the exact self-coordination bug: a single controller holding both sides (or two controllers) must not be able to drag a Strip past every doctrine check NLA would enforce', () => {
  const { board } = makeStore();
  const strip = createStrip(board, 'OPS'); // PROPOSED — legal next state is PENDING_CLEARANCE, NOT RUNWAY_QUEUE
  const result = board.applyMutation(
    mutation(strip, { kind: 'TransferStrip', toPositionId: 'CD', bayId: 'runway-queue', rackId: 'rwy-27' }),
    'OPS', 'OPS'
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
  const stillWithOps = board.getStrip(strip.stripId);
  assert.equal(stillWithOps.state, 'PROPOSED');
  assert.equal(stillWithOps.ownerPositionId, 'OPS'); // ownership untouched too — the whole Mutation was rejected, nothing partially applied
});

test('TransferStrip into a Bay with no implied state leaves the Strip state unchanged', () => {
  const { board } = makeStore();
  const strip = createStrip(board, 'OPS');
  const result = board.applyMutation(
    mutation(strip, { kind: 'TransferStrip', toPositionId: 'CD', bayId: 'coordination', rackId: 'main' }),
    'OPS', 'OPS'
  );
  assert.equal(result.strip.state, strip.state);
});

test('TransferStrip to an unmanned Position with no covering Position is rejected with NO_RECEIVING_POSITION and the Strip stays with the sender', () => {
  const { board } = makeStore({ coveringPositionFor: () => null });
  const strip = createStrip(board, 'OPS');
  const result = board.applyMutation(
    mutation(strip, { kind: 'TransferStrip', toPositionId: 'UNMANNED', bayId: 'x', rackId: 'y' }),
    'OPS', 'OPS'
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NO_RECEIVING_POSITION');
  assert.equal(board.getStrip(strip.stripId).ownerPositionId, 'OPS');
});

test('TransferStrip to an unmanned Position with an occupied covering Position routes there instead, and reports routedTo', () => {
  const { board } = makeStore(); // fixture: UNMANNED -> covered by COVER, and COVER is occupied
  const strip = createStrip(board, 'OPS');
  const result = board.applyMutation(
    mutation(strip, { kind: 'TransferStrip', toPositionId: 'UNMANNED', bayId: 'x', rackId: 'y' }),
    'OPS', 'OPS'
  );
  assert.equal(result.ok, true);
  assert.equal(result.strip.ownerPositionId, 'COVER');
  assert.equal(result.routedTo, 'COVER');
});

test('TransferStrip is itself owner-gated — a non-owning Position cannot initiate it', () => {
  const { board } = makeStore();
  const strip = createStrip(board, 'OPS');
  const result = board.applyMutation(
    mutation(strip, { kind: 'TransferStrip', toPositionId: 'CD', bayId: 'x', rackId: 'y' }),
    'GND', 'GND'
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NOT_OWNER');
});

// ── reassignPositionStrips — system-initiated, covering-chain routing (guide §4.8.6 rule 2) ──

test('reassignPositionStrips moves every non-DROPPED Strip owned by the vacated Position to the covering Position', () => {
  const { board } = makeStore();
  const a = createStrip(board, 'GND', { op: { ...createMutation().op, fdr: { ...createMutation().op.fdr, callsign: 'AAA1111' } } });
  const b = createStrip(board, 'GND', { op: { ...createMutation().op, fdr: { ...createMutation().op.fdr, callsign: 'BBB2222' } } });

  const reassigned = board.reassignPositionStrips('GND', 'TWR');
  assert.deepEqual(reassigned.sort(), [a.stripId, b.stripId].sort());
  assert.equal(board.getStrip(a.stripId).ownerPositionId, 'TWR');
  assert.equal(board.getStrip(b.stripId).ownerPositionId, 'TWR');
});

test('reassignPositionStrips leaves a DROPPED Strip untouched (it is not stranded traffic)', () => {
  const { board } = makeStore();
  const strip = createStrip(board, 'GND');
  board.applyMutation(mutation(strip, { kind: 'DropStrip', reason: 'x' }), 'GND', 'GND');

  const reassigned = board.reassignPositionStrips('GND', 'TWR');
  assert.deepEqual(reassigned, []);
  assert.equal(board.getStrip(strip.stripId).ownerPositionId, 'GND'); // unchanged
});

test('reassignPositionStrips is recorded in the mutation log as a system action, not attributed to any acting Position', () => {
  const { board } = makeStore();
  const recorded = [];
  board.setMutationLog({ record: (entry) => recorded.push(entry) });
  createStrip(board, 'GND');
  recorded.length = 0;

  board.reassignPositionStrips('GND', 'TWR');
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].op, 'SystemReassign');
  assert.equal(recorded[0].actingPositionId, null);
  assert.equal(recorded[0].actorId, 'system');
  assert.equal(recorded[0].before.ownerPositionId, 'GND');
  assert.equal(recorded[0].after.ownerPositionId, 'TWR');
});

test('reassignPositionStrips with nothing owned by the source Position returns an empty array and touches nothing', () => {
  const { board } = makeStore();
  const reassigned = board.reassignPositionStrips('GND', 'TWR');
  assert.deepEqual(reassigned, []);
});

test('TransferStrip stamps selfCoordinated=true when isSelfCoordinated says the sender also holds the destination Position', () => {
  const { board } = makeStore({ isSelfCoordinated: (by, toPositionId) => by === 'controller-A' && toPositionId === 'CD' });
  const strip = createStrip(board, 'OPS');
  const result = board.applyMutation(
    mutation(strip, { kind: 'TransferStrip', toPositionId: 'CD', bayId: 'x', rackId: 'y' }),
    'OPS', 'controller-A'
  );
  assert.equal(result.ok, true);
  assert.equal(result.selfCoordinated, true);
});

test('a self-coordinated TransferStrip is recorded distinctly in the mutation log, never silently collapsed (defect D20)', () => {
  const { board } = makeStore({ isSelfCoordinated: () => true });
  const recorded = [];
  board.setMutationLog({ record: (entry) => recorded.push(entry) });

  const strip = createStrip(board, 'OPS');
  recorded.length = 0;
  board.applyMutation(mutation(strip, { kind: 'TransferStrip', toPositionId: 'CD', bayId: 'x', rackId: 'y' }), 'OPS', 'controller-A');

  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].selfCoordinated, true);
});

test('a two-party TransferStrip (isSelfCoordinated=false) is recorded as such, not conflated with a self-coordinated one', () => {
  const { board } = makeStore({ isSelfCoordinated: () => false });
  const recorded = [];
  board.setMutationLog({ record: (entry) => recorded.push(entry) });

  const strip = createStrip(board, 'OPS');
  recorded.length = 0;
  board.applyMutation(mutation(strip, { kind: 'TransferStrip', toPositionId: 'CD', bayId: 'x', rackId: 'y' }), 'OPS', 'controller-A');

  assert.equal(recorded[0].selfCoordinated, false);
});

// ── Per-acting-Position permission (guide §4.8.4, defect D21) ──────────────

test('when a canMutate rule is supplied, a denied (actingPosition, opKind) combination is rejected with PERMISSION_DENIED before ownership is even checked', () => {
  const { board } = makeStore({ canMutate: (actingPositionId, opKind) => !(actingPositionId === 'GND' && opKind === 'DropStrip') });
  const strip = createStrip(board, 'GND');
  const result = board.applyMutation(mutation(strip, { kind: 'DropStrip', reason: 'x' }), 'GND', 'GND');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PERMISSION_DENIED');
});

test('CreateStrip itself is gated by canMutate (only OPS may originate an FDR, guide §4.1 rule 3)', () => {
  const { board } = makeStore({ canMutate: (actingPositionId, opKind) => !(opKind === 'CreateStrip' && actingPositionId !== 'OPS') });
  const result = board.applyMutation(createMutation(), 'GND', 'GND');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PERMISSION_DENIED');
  assert.equal(board.getAll().length, 0);
});

test('without a canMutate rule supplied, permission checking is simply skipped (opt-in hook, existing callers/tests unaffected)', () => {
  const { board } = makeStore(); // fixture makeRules() defines no canMutate
  const result = board.applyMutation(createMutation(), 'GND', 'GND');
  assert.equal(result.ok, true);
});

// ── CreateStrip role-scoped permission (Phase 2, docs/adr/0008) ─────────

test('CreateStrip is rejected PERMISSION_DENIED when canCreateStripRole says no for this (Position, role) pair, before touching fdrStore', () => {
  const { board, fdrStore } = makeStore({
    canCreateStripRole: (actingPositionId, role) => actingPositionId === 'OPS' && role === 'DEPARTURE',
  });
  const result = board.applyMutation(createMutation({ op: { ...createMutation().op, role: 'ARRIVAL' } }), 'OPS', 'OPS');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PERMISSION_DENIED');
  assert.equal(fdrStore.getAll().length, 0); // no side effect on a denied CreateStrip
});

test('CreateStrip succeeds when canCreateStripRole allows this (Position, role) pair', () => {
  const { board } = makeStore({
    canCreateStripRole: (actingPositionId, role) => actingPositionId === 'APP' && role === 'ARRIVAL',
  });
  const result = board.applyMutation(createMutation({ op: { ...createMutation().op, role: 'ARRIVAL' } }), 'APP', 'APP');
  assert.equal(result.ok, true);
  assert.equal(result.strip.role, 'ARRIVAL');
});

test('CreateStrip defaults to role DEPARTURE when op.role is omitted', () => {
  const { board } = makeStore({ canCreateStripRole: (id, role) => id === 'OPS' && role === 'DEPARTURE' });
  const result = board.applyMutation(createMutation(), 'OPS', 'OPS'); // no op.role at all
  assert.equal(result.ok, true);
  assert.equal(result.strip.role, 'DEPARTURE');
});

test('an ARRIVAL CreateStrip defaults its initial state to INBOUND, not PROPOSED', () => {
  const { board } = makeStore({ canCreateStripRole: () => true });
  const result = board.applyMutation(createMutation({ op: { ...createMutation().op, role: 'ARRIVAL' } }), 'APP', 'APP');
  assert.equal(result.ok, true);
  assert.equal(result.strip.state, 'INBOUND');
});

test('CreateStrip with an unknown role is rejected VALIDATION_ERROR when isValidRole is supplied', () => {
  const { board } = makeStore({ isValidRole: (role) => ['DEPARTURE', 'ARRIVAL'].includes(role) });
  const result = board.applyMutation(createMutation({ op: { ...createMutation().op, role: 'OVERFLIGHT' } }), 'OPS', 'OPS');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
});

test('without isValidRole/canCreateStripRole rules supplied, CreateStrip role-gating is simply skipped (opt-in hooks, existing fixtures unaffected)', () => {
  const { board } = makeStore(); // fixture makeRules() defines neither
  const result = board.applyMutation(createMutation(), 'ANY_POSITION', 'ANY_POSITION');
  assert.equal(result.ok, true);
});

// ── DropStrip (guide §3.4) ───────────────────────────────────────────────

test('DropStrip sets state DROPPED and removeIndicator, but the Strip remains queryable via getStrip/getAll', () => {
  const { board } = makeStore();
  const strip = createStrip(board);
  const result = board.applyMutation(mutation(strip, { kind: 'DropStrip', reason: 'cancelled' }), 'OPS', 'OPS');
  assert.equal(result.ok, true);
  assert.equal(result.strip.state, 'DROPPED');
  assert.equal(result.strip.flags.removeIndicator, true);
  assert.ok(board.getStrip(strip.stripId)); // still queryable
  assert.equal(board.getAll().some(s => s.stripId === strip.stripId), true);
});

test('a DROPPED Strip leaves the visible Board — getRack excludes it', () => {
  const { board } = makeStore();
  const strip = createStrip(board);
  board.applyMutation(mutation(strip, { kind: 'DropStrip', reason: 'cancelled' }), 'OPS', 'OPS');
  assert.equal(board.getRack(strip.bayId, strip.rackId).some(s => s.stripId === strip.stripId), false);
});

test('DropStrip releases the FDR\'s beacon code back to the allocator', () => {
  const { board, fdrStore } = makeStore();
  const strip = createStrip(board);
  const code = fdrStore.getFdr(strip.fdrId).identity.beaconAssigned;
  board.applyMutation(mutation(strip, { kind: 'DropStrip', reason: 'cancelled' }), 'OPS', 'OPS');
  assert.equal(fdrStore.codeAllocator.isAllocated(code), false);
});

// ── Mutation log wiring ─────────────────────────────────────────────────────

test('a successful Mutation is recorded to the attached mutation log with actingPositionId/actorId/before/after', () => {
  const { board } = makeStore();
  const recorded = [];
  board.setMutationLog({ record: (entry) => recorded.push(entry) });

  const strip = createStrip(board, 'OPS', {}); // CreateStrip itself is recorded too
  board.applyMutation(mutation(strip, { kind: 'SetFlag', flag: 'offset', value: true }), 'OPS', 'controller-A');

  assert.equal(recorded.length, 2); // CreateStrip + SetFlag
  const setFlagEntry = recorded[1];
  assert.equal(setFlagEntry.op, 'SetFlag');
  assert.equal(setFlagEntry.actingPositionId, 'OPS');
  assert.equal(setFlagEntry.actorId, 'controller-A');
  assert.equal(setFlagEntry.before.flags.offset, false);
  assert.equal(setFlagEntry.after.flags.offset, true);
});

test('a failed Mutation is NOT recorded to the mutation log', () => {
  const { board } = makeStore();
  const recorded = [];
  board.setMutationLog({ record: (entry) => recorded.push(entry) });

  const strip = createStrip(board);
  recorded.length = 0; // ignore the CreateStrip entry
  board.applyMutation(mutation(strip, { kind: 'SetFlag', flag: 'bogus', value: true }), 'OPS', 'OPS');
  assert.equal(recorded.length, 0);
});

// ── Restart / persistence (WP4's explicit "test with an actual restart") ──

test('a Strip snapshot/restore round-trip resolves to exactly one owner, unchanged (D7)', () => {
  const { board } = makeStore();
  const strip = createStrip(board, 'OPS');
  board.applyMutation(mutation(strip, { kind: 'TransferStrip', toPositionId: 'CD', bayId: 'pending-clearance', rackId: 'main' }), 'OPS', 'OPS');

  const snap = board.snapshot();

  // Simulate an actual restart: a brand-new BoardStore/FdrStore instance,
  // as would happen on process restart, restoring only from persisted data.
  const freshFdrStore = new FdrStore();
  const freshBoard = new BoardStore(freshFdrStore, makeRules());
  freshBoard.restore(snap);

  const restored = freshBoard.getStrip(strip.stripId);
  assert.ok(restored);
  assert.equal(restored.ownerPositionId, 'CD');
  assert.equal(freshBoard.getAll().filter(s => s.stripId === strip.stripId).length, 1); // exactly one, never duplicated
});

test('restore() preserves the cid sequence so future CreateStrip calls do not reuse an old cid', () => {
  const { board } = makeStore();
  const first = createStrip(board);
  const snap = board.snapshot();

  const freshFdrStore = new FdrStore();
  const freshBoard = new BoardStore(freshFdrStore, makeRules());
  freshBoard.restore(snap);
  const second = createStrip(freshBoard, 'OPS', { op: { ...createMutation().op, fdr: { ...createMutation().op.fdr, callsign: 'ZZZ9999' } } });

  assert.notEqual(second.cid, first.cid);
});
