import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-ws-coordination-test-'));
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH = path.join(tmpDir, 'incirlik.json');
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER = path.join(tmpDir, 'center.json');

const { handleMessage } = await import('../src/efsp/efsp-ws.js');
const { BoardStore } = await import('../src/efsp/board-store.js');
const { FdrStore } = await import('../src/efsp/fdr-store.js');
const { PositionStore } = await import('../src/efsp/position-store.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const blockMap = await import('../src/efsp/block-map.js');
const nla = await import('../src/efsp/nla.js');
const permission = await import('../src/efsp/permission.js');
const coordination = await import('../src/efsp/coordination.js');

// Full ctx, mirroring index.js's real multi-Facility composition exactly —
// this is the tier that exercises the actual wire message shape
// (facilityId routing) a real client sends, one layer above
// efsp-board-store-coordination.test.mjs's direct applyMutation() calls.
function makeCtx() {
  const fdrStore = new FdrStore();
  const facilities = new Map();

  for (const facilityId of facilityConfig.getFacilityIds()) {
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
      peerBoard: (otherFacilityId) => (facilities.get(otherFacilityId) || {}).boardStore || null,
      coordinationEffect: (primitive) => coordination.coordinationEffect(primitive),
    };
    const boardStore = new BoardStore(fdrStore, rules);
    facilities.set(facilityId, { boardStore, positionStore });
  }

  const defaultFacility = facilities.get(facilityConfig.DEFAULT_FACILITY_ID);
  return {
    boardStore: defaultFacility.boardStore,
    positionStore: defaultFacility.positionStore,
    fdrStore, facilityConfig,
    boardStoreFor: (facilityId = facilityConfig.DEFAULT_FACILITY_ID) => (facilities.get(facilityId) || {}).boardStore || null,
    positionStoreFor: (facilityId = facilityConfig.DEFAULT_FACILITY_ID) => (facilities.get(facilityId) || {}).positionStore || null,
  };
}

function noopPersist() {}

function createCtrStripMsg(overrides = {}) {
  return {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: 'CENTER', actingPositionId: 'CTR',
    op: {
      kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', role: 'ARRIVAL',
      fdr: { callsign: 'EAGLE1', aircraftType: 'F15', wakeCategory: 'D', originAirport: 'LTAC' },
    },
    ...overrides,
  };
}

const CTR_SESSION = { controllerId: 'ctr-controller', who: 'Ctr1' };
const APP_SESSION = { controllerId: 'app-controller', who: 'App1' };

// ── Every message carries an OPTIONAL facilityId, defaulting to INCIRLIK ─

test('a message with no facilityId at all behaves exactly like it targeted INCIRLIK — full back-compat with pre-WP4A messages', () => {
  const ctx = makeCtx();
  const msg = {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), actingPositionId: 'OPS',
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', fdr: { callsign: 'VIPER1', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250' } },
  };
  const result = handleMessage(ctx, { controllerId: 'ops1', who: 'Ops1' }, msg, noopPersist);
  assert.equal(result.ack.ok, true, JSON.stringify(result.ack));
  assert.equal(ctx.boardStore.getAll().length, 1); // landed on the INCIRLIK alias
  assert.equal(ctx.boardStoreFor('CENTER').getAll().length, 0);
});

test('a message with an unknown facilityId is rejected, not a throw', () => {
  const ctx = makeCtx();
  const result = handleMessage(ctx, CTR_SESSION, createCtrStripMsg({ facilityId: 'ATLANTIS' }), noopPersist);
  assert.equal(result.ack.ok, false);
});

// ── End-to-end HANDOFF across the wire-message boundary ──────────────────

test('CTR originates an ARRIVAL Strip, proposes HANDOFF to APP, and APP accepts it — full round trip through handleMessage with facilityId routing', () => {
  const ctx = makeCtx();

  const created = handleMessage(ctx, CTR_SESSION, createCtrStripMsg(), noopPersist);
  assert.equal(created.ack.ok, true, JSON.stringify(created.ack));
  const senderStrip = created.ack.strip;

  const proposeMsg = {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: 'CENTER', actingPositionId: 'CTR', stripId: senderStrip.stripId, baseRev: senderStrip.rev,
    op: { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'APP' },
  };
  const proposed = handleMessage(ctx, CTR_SESSION, proposeMsg, noopPersist);
  assert.equal(proposed.ack.ok, true, JSON.stringify(proposed.ack));
  assert.ok(proposed.broadcast, 'a successful mutation broadcasts');
  assert.equal(proposed.broadcast.facilityId, 'CENTER');

  const receiverStripId = proposed.ack.strip.coordination.peerStripId;
  const receiverStrip = ctx.boardStoreFor('INCIRLIK').getStrip(receiverStripId);
  assert.equal(receiverStrip.ownerPositionId, 'APP');
  assert.equal(receiverStrip.bayId, 'app-coordination');

  const acceptMsg = {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: 'INCIRLIK', actingPositionId: 'APP', stripId: receiverStripId, baseRev: receiverStrip.rev,
    op: { kind: 'HANDOFF', action: 'ACCEPT' },
  };
  const accepted = handleMessage(ctx, APP_SESSION, acceptMsg, noopPersist);
  assert.equal(accepted.ack.ok, true, JSON.stringify(accepted.ack));
  assert.equal(accepted.ack.strip.bayId, 'app-inbound');
  assert.equal(accepted.ack.strip.state, 'INBOUND');
});

test('efsp-resync is facility-scoped — resyncing CENTER never returns INCIRLIK\'s strips or vice versa', () => {
  const ctx = makeCtx();
  handleMessage(ctx, CTR_SESSION, createCtrStripMsg(), noopPersist);
  handleMessage(ctx, { controllerId: 'ops1', who: 'Ops1' }, {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), actingPositionId: 'OPS',
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', fdr: { callsign: 'VIPER1', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250' } },
  }, noopPersist);

  const centerSnapshot = handleMessage(ctx, CTR_SESSION, { type: 'efsp-resync', facilityId: 'CENTER', lastBoardSeq: -999999 }, noopPersist);
  assert.equal(centerSnapshot.ack.type, 'efsp-snapshot');
  // The snapshot itself is global (both Facilities, guide §4.8.5's "one
  // client can act across both Boards") — but the STRIPS in it are
  // correctly facility-stamped, and the CENTER-scoped ones are the ones
  // CTR actually created.
  const centerStrips = centerSnapshot.ack.strips.filter(s => s.facilityId === 'CENTER');
  const incirlikStrips = centerSnapshot.ack.strips.filter(s => s.facilityId === 'INCIRLIK');
  assert.equal(centerStrips.length, 1);
  assert.equal(incirlikStrips.length, 1);
  assert.equal(centerStrips[0].role, 'ARRIVAL');
  assert.equal(incirlikStrips[0].role, 'DEPARTURE');
});

test('efsp-set-positions is facility-scoped — holding CTR at CENTER does not touch INCIRLIK\'s PositionStore', () => {
  const ctx = makeCtx();
  const result = handleMessage(ctx, CTR_SESSION, { type: 'efsp-set-positions', facilityId: 'CENTER', held: ['CTR'] }, noopPersist);
  assert.deepEqual(result.ack.held, ['CTR']);
  assert.equal(ctx.positionStoreFor('CENTER').isOccupied('CTR'), true);
  assert.equal(ctx.positionStoreFor('INCIRLIK').isOccupied('APP'), false);
});

test('every Strip record in an efsp-mutation ack AND its broadcast delta carries facilityId, not just the snapshot — a client that only ever sees deltas after its first connect must still be able to filter by Facility', () => {
  const ctx = makeCtx();
  const created = handleMessage(ctx, CTR_SESSION, createCtrStripMsg(), noopPersist);
  assert.equal(created.ack.strip.facilityId, 'CENTER');
  assert.equal(created.broadcast.strips.updated[0].facilityId, 'CENTER');
});

test('a resync-within-window delta also stamps facilityId on every updated Strip', () => {
  const ctx = makeCtx();
  const before = ctx.boardStoreFor('CENTER').currentSeq;
  handleMessage(ctx, CTR_SESSION, createCtrStripMsg(), noopPersist);

  const result = handleMessage(ctx, CTR_SESSION, { type: 'efsp-resync', facilityId: 'CENTER', lastBoardSeq: before }, noopPersist);
  assert.equal(result.ack.type, 'efsp-board-delta');
  assert.equal(result.ack.strips.updated.length, 1);
  assert.equal(result.ack.strips.updated[0].facilityId, 'CENTER');
});

test('a snapshot includes both Facilities\' Bays, each correctly stamped', async () => {
  const ctx = makeCtx();
  const { snapshotMessage } = await import('../src/efsp/efsp-ws.js');
  const snap = snapshotMessage(ctx);
  assert.equal(snap.facilities.sort().join(','), 'CENTER,INCIRLIK');
  assert.ok(snap.bays.some(b => b.bayId === 'ctr-enroute' && b.facilityId === 'CENTER'));
  assert.ok(snap.bays.some(b => b.bayId === 'app-coordination' && b.facilityId === 'INCIRLIK'));
  assert.equal(snap.facility, 'INCIRLIK'); // back-compat alias
  assert.equal(typeof snap.boardSeq, 'number'); // back-compat alias
  assert.equal(typeof snap.boardSeqByFacility.INCIRLIK, 'number');
  assert.equal(typeof snap.boardSeqByFacility.CENTER, 'number');
});
