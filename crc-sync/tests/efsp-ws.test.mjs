import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// facility-config.js reads its path at module load — override before import.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-ws-test-'));
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH = path.join(tmpDir, 'facility.json');

const { handleMessage, RESYNC_RING_WINDOW } = await import('../src/efsp/efsp-ws.js');
const { BoardStore } = await import('../src/efsp/board-store.js');
const { FdrStore } = await import('../src/efsp/fdr-store.js');
const { PositionStore } = await import('../src/efsp/position-store.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const blockMap = await import('../src/efsp/block-map.js');
const nla = await import('../src/efsp/nla.js');
const permission = await import('../src/efsp/permission.js');

function makeCtx() {
  const fdrStore = new FdrStore();
  const positionStore = new PositionStore(facilityConfig.getPositionSet(), facilityConfig.getCoveringChain());
  // Mirrors index.js's real `rules` wiring exactly (not a hand-simplified
  // subset) — otherwise this fixture would silently diverge from what the
  // running server actually does, especially now that CreateStrip's
  // role-gating (canCreateStripRole) and computeNla's occupancy ctx are
  // load-bearing, not just decorative.
  const rules = {
    resolveBlockTarget: (blockId, role) => blockMap.resolveBlockTarget(role, blockId),
    bayImpliesState: (bayId) => facilityConfig.bayImpliesState(bayId),
    bayForImpliedState: (positionId, state) => facilityConfig.bayForImpliedState(positionId, state),
    computeNla: (strip, fdr, now, ctx) => nla.computeNla(strip, fdr, now, ctx),
    isValidState: (state, role) => nla.isValidState(state, role),
    isValidRole: (role) => blockMap.isValidRole(role),
    isOccupied: (id) => positionStore.isOccupied(id),
    coveringPositionFor: (id) => positionStore.coveringPositionFor(id),
    canMutate: (actingPositionId, opKind) => permission.canMutate(actingPositionId, opKind),
    canCreateStripRole: (actingPositionId, role) => permission.canCreateStripRole(actingPositionId, role),
    canActOnState: (actingPositionId, role, state) => permission.canActOnState(actingPositionId, role, state),
    isSelfCoordinated: (controllerId, id) => positionStore.isSelfCoordinated(controllerId, id),
  };
  const boardStore = new BoardStore(fdrStore, rules);
  return { boardStore, fdrStore, positionStore, facilityConfig };
}

function noopPersist() {}

function createStripMsg(overrides = {}) {
  return {
    version: 1, type: 'efsp-mutation',
    clientMutationId: crypto.randomUUID(),
    actingPositionId: 'OPS',
    op: {
      kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main',
      fdr: { callsign: 'VIPER1', aircraftType: 'F16', wakeCategory: 'D', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250' },
    },
    ...overrides,
  };
}

const SESSION = { controllerId: 'controller-1', who: 'Alice' };

// Only OPS may CreateStrip (guide §4.1 rule 3, enforced by permission.js) —
// tests that need a Strip owned by GND/TWR/etc. must create it as OPS and
// then TransferStrip it, exactly like a real controller would.
function createStripOwnedBy(ctx, toPositionId, bayId) {
  const opsSession = { controllerId: 'controller-ops', who: 'Ops1' };
  const created = handleMessage(ctx, opsSession, createStripMsg(), noopPersist);
  if (!created.ack.ok) throw new Error('fixture setup failed: ' + JSON.stringify(created.ack));
  const strip = created.ack.strip;

  const transferMsg = {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
    actingPositionId: 'OPS', stripId: strip.stripId, baseRev: strip.rev,
    op: { kind: 'TransferStrip', toPositionId, bayId, rackId: 'main' },
  };
  const transferred = handleMessage(ctx, opsSession, transferMsg, noopPersist);
  if (!transferred.ack.ok) throw new Error('fixture setup (transfer) failed: ' + JSON.stringify(transferred.ack));
  return transferred.ack.strip;
}

test('an unrecognized message type returns null (not an EFSP message)', () => {
  const ctx = makeCtx();
  const result = handleMessage(ctx, SESSION, { type: 'not-efsp' }, noopPersist);
  assert.equal(result, null);
});

test('a successful efsp-mutation returns both an ack and a broadcast, and calls persist', () => {
  const ctx = makeCtx();
  let persisted = false;
  const result = handleMessage(ctx, SESSION, createStripMsg(), () => { persisted = true; });

  assert.equal(result.ack.type, 'efsp-mutation-ack');
  assert.equal(result.ack.ok, true);
  assert.ok(result.ack.strip);
  assert.ok(result.broadcast);
  assert.equal(result.broadcast.type, 'efsp-board-delta');
  assert.equal(result.broadcast.strips.updated.length, 1);
  assert.equal(persisted, true);
});

test('a failed efsp-mutation returns only an ack (no broadcast), and does not persist', () => {
  const ctx = makeCtx();
  let persisted = false;
  const badMsg = createStripMsg({ op: { ...createStripMsg().op, fdr: { ...createStripMsg().op.fdr, callsign: 'WAYTOOLONGACALLSIGN' } } });
  const result = handleMessage(ctx, SESSION, badMsg, () => { persisted = true; });

  assert.equal(result.ack.ok, false);
  assert.equal(result.broadcast, undefined);
  assert.equal(persisted, false);
});

test('a rejected mutation\'s ack includes the human-readable detail, not just the bare reason code', () => {
  const ctx = makeCtx();
  const created = handleMessage(ctx, SESSION, createStripMsg(), noopPersist); // PROPOSED
  const strip = created.ack.strip;

  // Drop straight into a Bay whose implied state (RUNWAY_QUEUE) skips
  // ahead of PROPOSED's legal next state (PENDING_CLEARANCE) — the exact
  // doctrine-bypass case board-store.js's _validateBayImpliedTransition
  // exists to reject, with a detail string explaining why.
  const moveMsg = {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
    actingPositionId: 'OPS', stripId: strip.stripId, baseRev: strip.rev,
    op: { kind: 'MoveStrip', bayId: 'twr-runway-queue', rackId: 'rwy-05' },
  };
  const result = handleMessage(ctx, SESSION, moveMsg, noopPersist);
  assert.equal(result.ack.ok, false);
  assert.equal(result.ack.reason, 'VALIDATION_ERROR');
  assert.match(result.ack.detail, /only valid next state/);
});

test('a DropStrip mutation broadcasts the stripId under "gone", not "updated"', () => {
  const ctx = makeCtx();
  const created = handleMessage(ctx, SESSION, createStripMsg(), noopPersist);
  const strip = created.ack.strip;

  const dropMsg = {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
    actingPositionId: 'OPS', stripId: strip.stripId, baseRev: strip.rev,
    op: { kind: 'DropStrip', reason: 'test' },
  };
  const result = handleMessage(ctx, SESSION, dropMsg, noopPersist);
  assert.equal(result.ack.ok, true);
  assert.deepEqual(result.broadcast.strips.updated, []);
  assert.deepEqual(result.broadcast.strips.gone, [strip.stripId]);
});

// ── efsp-resync: exactly two paths ──────────────────────────────────────

test('resync within the ring-buffer window returns an efsp-board-delta, not a snapshot', () => {
  const ctx = makeCtx();
  const before = ctx.boardStore.currentSeq;
  handleMessage(ctx, SESSION, createStripMsg(), noopPersist);

  const result = handleMessage(ctx, SESSION, { type: 'efsp-resync', lastBoardSeq: before }, noopPersist);
  assert.equal(result.ack.type, 'efsp-board-delta');
});

test('resync with lastBoardSeq far outside the window returns a full efsp-snapshot', () => {
  const ctx = makeCtx();
  handleMessage(ctx, SESSION, createStripMsg(), noopPersist);

  const result = handleMessage(ctx, SESSION, { type: 'efsp-resync', lastBoardSeq: -999999 }, noopPersist);
  assert.equal(result.ack.type, 'efsp-snapshot');
  assert.ok(Array.isArray(result.ack.strips));
  assert.ok(Array.isArray(result.ack.fdrs));
  assert.ok(Array.isArray(result.ack.positions));
  assert.ok(Array.isArray(result.ack.bays));
});

test('resync with a missing/non-finite lastBoardSeq is treated as TOO_OLD (snapshot), the safe default', () => {
  const ctx = makeCtx();
  const result = handleMessage(ctx, SESSION, { type: 'efsp-resync' }, noopPersist);
  assert.equal(result.ack.type, 'efsp-snapshot');
});

test('resync never returns a third message type — only efsp-board-delta or efsp-snapshot', () => {
  const ctx = makeCtx();
  handleMessage(ctx, SESSION, createStripMsg(), noopPersist);
  for (const lastBoardSeq of [ctx.boardStore.currentSeq, 0, -1, ctx.boardStore.currentSeq - RESYNC_RING_WINDOW]) {
    const result = handleMessage(ctx, SESSION, { type: 'efsp-resync', lastBoardSeq }, noopPersist);
    assert.ok(['efsp-board-delta', 'efsp-snapshot'].includes(result.ack.type));
  }
});

// ── efsp-set-positions ───────────────────────────────────────────────────

test('setting held positions acks with the actually-held set and broadcasts positions', () => {
  const ctx = makeCtx();
  const result = handleMessage(ctx, SESSION, { type: 'efsp-set-positions', held: ['GND', 'TWR'] }, noopPersist);
  assert.deepEqual(result.ack.held.sort(), ['GND', 'TWR']);
  assert.equal(result.ack.warnings.length, 0);
  assert.equal(result.broadcast.type, 'efsp-board-delta');
  assert.equal(result.broadcast.positions.updated.length, 5); // all of INCIRLIK's Phase 2 Positions reported
});

test('vacating a Position with Strips and an occupied covering Position reassigns them and reports the warning with routedTo', () => {
  const ctx = makeCtx();
  handleMessage(ctx, SESSION, { type: 'efsp-set-positions', held: ['GND'] }, noopPersist); // Alice holds GND
  handleMessage(ctx, { controllerId: 'controller-2', who: 'Bob' }, { type: 'efsp-set-positions', held: ['TWR'] }, noopPersist); // Bob holds TWR (GND's covering Position)

  // gnd-coordination (not gnd-taxi-in) — this fixture just needs "GND owns
  // a Strip", and gnd-taxi-in now implies TAXI_IN (Phase 2), which a fresh
  // PROPOSED Strip can't legally jump straight to (correctly rejected by
  // _validateBayImpliedTransition). gnd-coordination implies no state.
  const strip = createStripOwnedBy(ctx, 'GND', 'gnd-coordination');

  const result = handleMessage(ctx, SESSION, { type: 'efsp-set-positions', held: [] }, noopPersist); // Alice vacates GND
  assert.equal(result.ack.warnings.length, 1);
  assert.deepEqual(result.ack.warnings[0], { positionId: 'GND', count: 1, routedTo: 'TWR' });
  assert.equal(result.broadcast.strips.updated.length, 1);
  assert.equal(result.broadcast.strips.updated[0].stripId, strip.stripId);
  assert.equal(ctx.boardStore.getStrip(strip.stripId).ownerPositionId, 'TWR');
});

test('vacating a Position with Strips and NO occupied covering Position anywhere reports routedTo:null, distinctly, and does not silently drop the Strip', () => {
  const ctx = makeCtx();
  handleMessage(ctx, SESSION, { type: 'efsp-set-positions', held: ['GND'] }, noopPersist); // GND held, but nobody holds TWR
  // gnd-coordination (not gnd-taxi-in) — this fixture just needs "GND owns
  // a Strip", and gnd-taxi-in now implies TAXI_IN (Phase 2), which a fresh
  // PROPOSED Strip can't legally jump straight to (correctly rejected by
  // _validateBayImpliedTransition). gnd-coordination implies no state.
  const strip = createStripOwnedBy(ctx, 'GND', 'gnd-coordination');

  const result = handleMessage(ctx, SESSION, { type: 'efsp-set-positions', held: [] }, noopPersist);
  assert.deepEqual(result.ack.warnings, [{ positionId: 'GND', count: 1, routedTo: null }]);
  // Strip ownership is untouched — still GND, which is now unoccupied; this
  // is the D19 boundary condition itself, surfaced rather than hidden.
  assert.equal(ctx.boardStore.getStrip(strip.stripId).ownerPositionId, 'GND');
});

test('vacating a Position that owns no Strips produces no warnings at all', () => {
  const ctx = makeCtx();
  handleMessage(ctx, SESSION, { type: 'efsp-set-positions', held: ['GND'] }, noopPersist);
  const result = handleMessage(ctx, SESSION, { type: 'efsp-set-positions', held: [] }, noopPersist);
  assert.deepEqual(result.ack.warnings, []);
});

test('a non-abrupt vacate does NOT auto-promote a waiting Observer, so its Strips still need routing (position-store.js\'s promotion-is-a-prompt rule feeds straight into the strand check)', () => {
  const ctx = makeCtx();
  handleMessage(ctx, SESSION, { type: 'efsp-set-positions', held: ['GND'] }, noopPersist); // Alice Primary
  handleMessage(ctx, { controllerId: 'controller-2', who: 'Bob' }, { type: 'efsp-set-positions', held: ['GND'] }, noopPersist); // Bob Observer

  createStripOwnedBy(ctx, 'GND', 'gnd-coordination'); // see the comment above the other two uses of this fixture

  const result = handleMessage(ctx, SESSION, { type: 'efsp-set-positions', held: [] }, noopPersist); // Alice explicitly vacates
  assert.equal(ctx.positionStore.isOccupied('GND'), false); // Bob was NOT auto-promoted — an explicit prompt is required, not built here
  assert.equal(result.ack.warnings.length, 1); // so the Strip genuinely needed routing, and GND has no covering Position occupied in this fixture
  assert.equal(result.ack.warnings[0].routedTo, null);
});
