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
const { CorrelationStore } = await import('../src/efsp/correlation-store.js');
const { PositionStore } = await import('../src/efsp/position-store.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const blockMap = await import('../src/efsp/block-map.js');
const nla = await import('../src/efsp/nla.js');
const permission = await import('../src/efsp/permission.js');
const coordination = await import('../src/efsp/coordination.js');

// Mirrors index.js's real multi-Facility `rules`/ctx wiring exactly (not a
// hand-simplified subset) — otherwise this fixture would silently diverge
// from what the running server actually does. WP4A (docs/adr/0013): one
// {BoardStore, PositionStore} pair per Facility, one shared FdrStore,
// `ctx.boardStore`/`ctx.positionStore` kept as direct INCIRLIK aliases so
// every pre-WP4A test below (which references them directly) is unchanged.
function makeCtx() {
  const fdrStore = new FdrStore();
  const facilityIds = facilityConfig.getFacilityIds();
  const facilities = new Map();

  for (const facilityId of facilityIds) {
    const positionStore = new PositionStore(facilityConfig.getPositionSet(facilityId), facilityConfig.getCoveringChain(facilityId));
    const rules = {
      resolveBlockTarget: (blockId, role) => blockMap.resolveBlockTarget(role, blockId),
      bayImpliesState: (bayId) => facilityConfig.bayImpliesState(bayId, facilityId),
      bayForImpliedState: (positionId, state) => facilityConfig.bayForImpliedState(positionId, state, facilityId),
      coordinationBayFor: (positionId) => facilityConfig.coordinationBayFor(positionId, facilityId),
      computeNla: (strip, fdr, now, ctx) => nla.computeNla(strip, fdr, now, ctx),
      isValidState: (state, role) => nla.isValidState(state, role),
      isValidRole: (role) => blockMap.isValidRole(role),
      isOccupied: (id) => positionStore.isOccupied(id),
      coveringPositionFor: (id) => positionStore.coveringPositionFor(id),
      canMutate: (actingPositionId, opKind) => permission.canMutate(actingPositionId, opKind),
      canCreateStripRole: (actingPositionId, role) => permission.canCreateStripRole(actingPositionId, role),
      canActOnState: (actingPositionId, role, state) => permission.canActOnState(actingPositionId, role, state),
      isSelfCoordinated: (controllerId, id) => positionStore.isSelfCoordinated(controllerId, id),
      facilityId,
      peerBoard: (otherFacilityId) => {
        const other = facilities.get(otherFacilityId);
        return other ? other.boardStore : null;
      },
      coordinationEffect: (primitive) => coordination.coordinationEffect(primitive),
    };
    const boardStore = new BoardStore(fdrStore, rules);
    facilities.set(facilityId, { boardStore, positionStore });
  }

  const defaultFacility = facilities.get(facilityConfig.DEFAULT_FACILITY_ID);
  // WP5 (docs/adr/0045) — the fourth store, wired exactly as index.js does it,
  // so the correlation dispatch path below is exercised against the real ctx
  // shape rather than a hand-simplified one.
  const correlationStore = new CorrelationStore({ fdrExists: (id) => !!fdrStore.getFdr(id) });
  return {
    boardStore: defaultFacility.boardStore,
    positionStore: defaultFacility.positionStore,
    fdrStore, facilityConfig, correlationStore,
    boardStoreFor: (facilityId = facilityConfig.DEFAULT_FACILITY_ID) => (facilities.get(facilityId) || {}).boardStore || null,
    positionStoreFor: (facilityId = facilityConfig.DEFAULT_FACILITY_ID) => (facilities.get(facilityId) || {}).positionStore || null,
  };
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

// A real client sends efsp-set-positions before it ever mutates, and
// efsp-ws.js now requires the acting Position to be one the sending session
// is Primary at. Fixtures declare the same thing, the same way.
function holding(ctx, session, held) {
  handleMessage(ctx, session, { type: 'efsp-set-positions', held }, noopPersist);
}

// Only OPS may CreateStrip (guide §4.1 rule 3, enforced by permission.js) —
// tests that need a Strip owned by GND/TWR/etc. must create it as OPS and
// then TransferStrip it, exactly like a real controller would.
function createStripOwnedBy(ctx, toPositionId, bayId) {
  const opsSession = { controllerId: 'controller-ops', who: 'Ops1' };
  holding(ctx, opsSession, ['OPS']);
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
  holding(ctx, SESSION, ['OPS']);
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
  holding(ctx, SESSION, ['OPS']);
  const created = handleMessage(ctx, SESSION, createStripMsg(), noopPersist); // PROPOSED
  const strip = created.ack.strip;
  // PROPOSED's own NLA is now transfer-shaped (transfers to CD) — occupy CD
  // so the doctrine-bypass check below is actually reached, rather than
  // this Mutation instead being rejected earlier for "no receiving Position
  // present", which isn't what this test is about.
  ctx.positionStore.setHeldPositions('controller-cd', 'CD-Holder', ['CD']);

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
  holding(ctx, SESSION, ['OPS']);
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

test('resync from a client AHEAD of the server returns a snapshot — the server restarted', () => {
  // The case a cleared or rolled-back Board produces, and the one the window
  // check missed for its whole life: `currentSeq - lastSeq` goes NEGATIVE, which
  // is trivially <= the window, so the server replayed a delta from an empty
  // ring, found nothing, and told a client holding a whole Board of Strips that
  // nothing had changed. They never went away.
  const ctx = makeCtx();
  const ahead = ctx.boardStore.currentSeq + 50;

  const result = handleMessage(ctx, SESSION, { type: 'efsp-resync', lastBoardSeq: ahead }, noopPersist);
  assert.equal(result.ack.type, 'efsp-snapshot', 'a client ahead of the server must be re-seeded, not patched');
  // And the snapshot is authoritative about emptiness: applyEfspSnapshot
  // clears before it fills, so this is what actually removes the stale Strips.
  assert.deepEqual(result.ack.strips, []);
});

test('resync never returns a third message type — only efsp-board-delta or efsp-snapshot', () => {
  const ctx = makeCtx();
  handleMessage(ctx, SESSION, createStripMsg(), noopPersist);
  for (const lastBoardSeq of [ctx.boardStore.currentSeq, 0, -1, ctx.boardStore.currentSeq - RESYNC_RING_WINDOW, ctx.boardStore.currentSeq + 1]) {
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

// ── WP5 correlation ops — the third dispatch path (docs/adr/0045) ─────────

function bindMsg(overrides = {}) {
  return {
    version: 1, type: 'efsp-correlation-mutation',
    clientMutationId: crypto.randomUUID(),
    actingPositionId: 'OPS',
    op: { kind: 'BindTrack', trackId: '101' },
    ...overrides,
  };
}

/** A DEPARTURE Strip at OPS. A correlation op needs only an FDR that exists. */
function createOpsStrip(ctx, session) {
  const created = handleMessage(ctx, session, createStripMsg(), noopPersist);
  if (!created.ack.ok) throw new Error('fixture setup failed: ' + JSON.stringify(created.ack));
  return created.ack.strip;
}

test('efsp-correlation-mutation routes, binds, and broadcasts its own delta type', () => {
  const ctx = makeCtx();
  const session = { controllerId: 'c-app', who: 'App1' };
  holding(ctx, session, ['OPS']);
  const strip = createOpsStrip(ctx, session);

  const result = handleMessage(ctx, session, bindMsg({ fdrId: strip.fdrId, baseRev: 0 }), noopPersist);

  assert.equal(result.ack.type, 'efsp-correlation-ack');
  assert.equal(result.ack.ok, true, JSON.stringify(result.ack));
  assert.equal(result.ack.correlation.trackId, '101');
  assert.equal(result.ack.correlation.matchedBy, 'BINDING');
  // Its own delta type with its own seq — not a section of efsp-board-delta,
  // because a correlation is not a Strip and rides no Board's sequence.
  assert.equal(result.broadcast.type, 'efsp-correlation-delta');
  assert.equal(result.broadcast.correlations.updated.length, 1);
  assert.ok(Number.isFinite(result.broadcast.correlationSeq));
  assert.equal(result.broadcast.strips, undefined);
});

test('UnbindTrack routes through the same path', () => {
  const ctx = makeCtx();
  const session = { controllerId: 'c-app', who: 'App1' };
  holding(ctx, session, ['OPS']);
  const strip = createOpsStrip(ctx, session);
  handleMessage(ctx, session, bindMsg({ fdrId: strip.fdrId, baseRev: 0 }), noopPersist);

  const rev = ctx.correlationStore.getCorrelation(strip.fdrId).rev;
  const result = handleMessage(ctx, session, bindMsg({
    fdrId: strip.fdrId, baseRev: rev, op: { kind: 'UnbindTrack' },
  }), noopPersist);
  assert.equal(result.ack.ok, true, JSON.stringify(result.ack));
  assert.equal(result.ack.correlation.binding, null);
});

test('a correlation op from a session that is not Primary anywhere is refused (docs/adr/0029, third dispatch path)', () => {
  const ctx = makeCtx();
  const owner = { controllerId: 'c-ops3', who: 'Ops3' };
  holding(ctx, owner, ['OPS']);
  const strip = createOpsStrip(ctx, owner);

  // Somebody else claims APP without holding it.
  const impostor = { controllerId: 'c-nobody', who: 'Nobody' };
  const result = handleMessage(ctx, impostor, bindMsg({ fdrId: strip.fdrId, baseRev: 0 }), noopPersist);
  assert.equal(result.ack.ok, false);
  assert.equal(result.ack.reason, 'NOT_HOLDING_POSITION');
  assert.equal(result.broadcast, undefined);
});

test('any Primary may bind, whichever Facility holds a Strip for that flight', () => {
  // A correlation is not a clearance, and the FDR is shared theater-wide
  // (docs/adr/0013). A controller who can see the contact must be able to say
  // so, even if the Strip is somebody else's.
  const ctx = makeCtx();
  const ops = { controllerId: 'c-ops2', who: 'Ops2' };
  holding(ctx, ops, ['OPS']);
  const strip = createOpsStrip(ctx, ops);

  const ctr = { controllerId: 'c-ctr', who: 'Ctr1' };
  handleMessage(ctx, ctr, { type: 'efsp-set-positions', facilityId: 'CENTER', held: ['CTR'] }, noopPersist);
  const result = handleMessage(ctx, ctr, bindMsg({
    fdrId: strip.fdrId, baseRev: 0, actingPositionId: 'CTR',
  }), noopPersist);

  assert.equal(result.ack.ok, true, JSON.stringify(result.ack));
  assert.equal(result.ack.correlation.binding.boundPositionId, 'CTR', 'and the audit says who');
});

test('a refused correlation op still carries the record, so the client renders truth', () => {
  const ctx = makeCtx();
  const session = { controllerId: 'c-app', who: 'App1' };
  holding(ctx, session, ['OPS']);
  const strip = createOpsStrip(ctx, session);
  handleMessage(ctx, session, bindMsg({ fdrId: strip.fdrId, baseRev: 0 }), noopPersist);

  const stale = handleMessage(ctx, session, bindMsg({ fdrId: strip.fdrId, baseRev: 0, op: { kind: 'BindTrack', trackId: '999' } }), noopPersist);
  assert.equal(stale.ack.ok, false);
  assert.equal(stale.ack.reason, 'STALE_REV');
  assert.equal(stale.ack.correlation.trackId, '101');
});

test('a correlation op for an unknown FDR is refused, not thrown', () => {
  const ctx = makeCtx();
  const session = { controllerId: 'c-ops4', who: 'Ops4' };
  holding(ctx, session, ['OPS']);
  const result = handleMessage(ctx, session, bindMsg({ fdrId: 'ghost', baseRev: 0 }), noopPersist);
  assert.equal(result.ack.ok, false);
  assert.equal(result.ack.reason, 'NOT_FOUND');
});

test('the snapshot carries correlation records alongside airspaces', () => {
  const ctx = makeCtx();
  const session = { controllerId: 'c-app', who: 'App1' };
  holding(ctx, session, ['OPS']);
  const strip = createOpsStrip(ctx, session);
  handleMessage(ctx, session, bindMsg({ fdrId: strip.fdrId, baseRev: 0 }), noopPersist);

  const snapshot = handleMessage(ctx, session, { type: 'efsp-resync', lastBoardSeq: -1 }, noopPersist).ack;
  assert.equal(snapshot.type, 'efsp-snapshot');
  assert.equal(snapshot.correlations.length, 1);
  assert.equal(snapshot.correlations[0].fdrId, strip.fdrId);
});

test('efsp-resync has no correlation branch — a reconnecting client gets the snapshot and the next tick', () => {
  // §5.6's "two paths only" is preserved because correlation never joins the
  // board-seq delta path (_handleResync's own reasoning for FDRs/Positions).
  const ctx = makeCtx();
  const session = { controllerId: 'c-app', who: 'App1' };
  holding(ctx, session, ['OPS']);
  createOpsStrip(ctx, session);

  const delta = handleMessage(ctx, session, { type: 'efsp-resync', lastBoardSeq: 0 }, noopPersist).ack;
  assert.equal(delta.type, 'efsp-board-delta');
  assert.equal(delta.correlations, undefined);
});
