import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { slot } from './helpers/wire-slots.mjs';

const paths = withPaths('efsp-ws-coordination-test-', { ...FACILITIES }).apply();
const tmpDir = paths.dir;

const { handleMessage } = await import('../src/efsp/efsp-ws.js');
const { BoardStore } = await import('../src/efsp/board-store.js');
import { fullRules } from "./helpers/full-rules.mjs";
import { withPaths, FACILITIES } from './helpers/with-paths.mjs';
const { FlightDataStore } = await import('../src/efsp/flight-data-store.js');
const { PositionStore } = await import('../src/efsp/position-store.js');
const facilityConfig = (await import('../src/efsp/facility-config.js')).createFacilityConfig();
const blockMap = await import('../src/efsp/block-map.js');
const nla = await import('../src/efsp/nla.js');
const permission = await import('../src/efsp/permission.js');
const classPermission = (await import('./helpers/permission.mjs')).classPermission();
const coordination = await import('../src/efsp/coordination.js');

// Full ctx, mirroring index.js's real multi-Facility composition exactly —
// this is the tier that exercises the actual wire message shape
// (facilityId routing) a real client sends, one layer above
// efsp-board-store-coordination.test.mjs's direct applyMutation() calls.
function makeCtx() {
  const flightDataStore = new FlightDataStore();
  const facilities = new Map();

  for (const facilityId of facilityConfig.getFacilityIds()) {
    const positionStore = new PositionStore(facilityConfig.getPositionSet(facilityId), facilityConfig.getConsolidation(facilityId));
    const rules = {
      resolveBlockTarget: (blockId, stripType) => blockMap.resolveBlockTarget(stripType, blockId),
      bayImpliesState: (bayId) => facilityConfig.bayImpliesState(bayId, facilityId),
      bayForImpliedState: (positionId, state) => facilityConfig.bayForImpliedState(positionId, state, facilityId),
      coordinationBayFor: (positionId) => facilityConfig.coordinationBayFor(positionId, facilityId),
      computeNla: (strip, flightData, now, ctx) => nla.computeNla(strip, flightData, now, ctx),
      isValidState: (state, stripType) => nla.isValidState(state, stripType),
      isValidStripType: (stripType) => blockMap.isValidStripType(stripType),
      isStaffed: (id) => positionStore.isStaffed(id),
      consolidatedAt: (id) => positionStore.consolidatedAt(id),
      canMutate: (actingPositionId, opKind) => classPermission.canMutate(actingPositionId, opKind),
      canCreateStripType: (actingPositionId, stripType) => permission.canCreateStripType(actingPositionId, stripType),
      canActOnState: (actingPositionId, stripType, state) => permission.canActOnState(actingPositionId, stripType, state),
      isSelfCoordinated: (controllerId, id) => positionStore.isSelfCoordinated(controllerId, id),
      facilityId,
      peerBoard: (otherFacilityId) => (facilities.get(otherFacilityId) || {}).boardStore || null,
      coordinationEffect: (primitive) => coordination.coordinationEffect(primitive),
      tofiCounterparts: (actingPositionId) => permission.tofiCounterparts(actingPositionId),
    };
    const boardStore = new BoardStore(flightDataStore, fullRules(rules));
    facilities.set(facilityId, { boardStore, positionStore });
  }

  return {
    flightDataStore, facilityConfig,
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
      kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', stripType: 'ARRIVAL',
      flightData: { callsign: 'EAGLE1', aircraftType: 'F15', wakeCategory: 'D', originAirport: 'LTAC' },
    },
    ...overrides,
  };
}

const CTR_SESSION = { controllerId: 'ctr-controller', who: 'Ctr1' };
const AP_SESSION = { controllerId: 'ap-controller', who: 'App1' };

// A real client sends efsp-set-positions before it ever mutates, and
// efsp-ws.js now requires the acting Position to be one the sending session
// is Primary at. Fixtures declare the same thing, the same way.
function holding(ctx, session, facilityId, signedOn) {
  handleMessage(ctx, session, { type: 'efsp-set-positions', facilityId, signedOn }, noopPersist);
}

// ── Every message carries an OPTIONAL facilityId, defaulting to INCIRLIK ─

test('a message with no facilityId at all behaves exactly like it targeted INCIRLIK — full back-compat with pre-WP4A messages', () => {
  const ctx = makeCtx();
  const msg = {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), actingPositionId: 'OPS',
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', flightData: { callsign: 'VIPER1', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250' } },
  };
  const opsSession = { controllerId: 'ops1', who: 'Ops1' };
  holding(ctx, opsSession, 'INCIRLIK', ['OPS']);
  const result = handleMessage(ctx, opsSession, msg, noopPersist);
  assert.equal(result.ack.ok, true, JSON.stringify(result.ack));
  assert.equal(ctx.boardStoreFor('INCIRLIK').getAll().length, 1); // landed on the INCIRLIK alias
  assert.equal(ctx.boardStoreFor('CENTER').getAll().length, 0);
});

test('a message with an unknown facilityId is rejected, not a throw', () => {
  const ctx = makeCtx();
  const result = handleMessage(ctx, CTR_SESSION, createCtrStripMsg({ facilityId: 'ATLANTIS' }), noopPersist);
  assert.equal(result.ack.ok, false);
});

// ── End-to-end HANDOFF across the wire-message boundary ──────────────────

test('CTR originates an ARRIVAL Strip, proposes HANDOFF to AP, and AP accepts it — full round trip through handleMessage with facilityId routing', () => {
  const ctx = makeCtx();
  holding(ctx, CTR_SESSION, 'CENTER', ['CTR']);
  holding(ctx, AP_SESSION, 'INCIRLIK', ['AP']);

  const created = handleMessage(ctx, CTR_SESSION, createCtrStripMsg(), noopPersist);
  assert.equal(created.ack.ok, true, JSON.stringify(created.ack));
  const senderStrip = created.ack.strip;

  const proposeMsg = {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: 'CENTER', actingPositionId: 'CTR', stripId: senderStrip.stripId, baseRev: senderStrip.rev,
    op: { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'AP' },
  };
  const proposed = handleMessage(ctx, CTR_SESSION, proposeMsg, noopPersist);
  assert.equal(proposed.ack.ok, true, JSON.stringify(proposed.ack));
  assert.ok(slot(proposed, 'primary'), 'a successful mutation broadcasts');
  assert.equal(slot(proposed, 'primary').facilityId, 'CENTER');

  // Bug found in live testing: this is what was missing entirely — nothing
  // told any client signed on at a Position at INCIRLIK that a brand-new
  // replica had just landed in their Coordination Bay. Without
  // peerBroadcast, a connected client would never see it appear at all
  // outside of a full reconnect/resync.
  assert.ok(slot(proposed, 'peer'), 'PROPOSE also broadcasts the new replica to the PEER Facility');
  assert.equal(slot(proposed, 'peer').facilityId, 'INCIRLIK');
  assert.equal(slot(proposed, 'peer').strips.updated.length, 1);
  const receiverStripId = proposed.ack.strip.coordination.peerStripId;
  assert.equal(slot(proposed, 'peer').strips.updated[0].stripId, receiverStripId);
  assert.equal(slot(proposed, 'peer').strips.updated[0].facilityId, 'INCIRLIK');
  assert.equal(slot(proposed, 'peer').strips.updated[0].bayId, 'ap-coordination');

  const receiverStrip = ctx.boardStoreFor('INCIRLIK').getStrip(receiverStripId);
  assert.equal(receiverStrip.ownerPositionId, 'AP');
  assert.equal(receiverStrip.bayId, 'ap-coordination');

  const acceptMsg = {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: 'INCIRLIK', actingPositionId: 'AP', stripId: receiverStripId, baseRev: receiverStrip.rev,
    op: { kind: 'HANDOFF', action: 'ACCEPT' },
  };
  const accepted = handleMessage(ctx, AP_SESSION, acceptMsg, noopPersist);
  assert.equal(accepted.ack.ok, true, JSON.stringify(accepted.ack));
  assert.equal(accepted.ack.strip.bayId, 'ap-inbound');
  assert.equal(accepted.ack.strip.state, 'INBOUND');

  // ACCEPT also needs to tell CENTER the sender-side Strip is now ACTIVE —
  // same gap, other direction.
  assert.ok(slot(accepted, 'peer'), 'ACCEPT also broadcasts the sender-side update to the PEER Facility');
  assert.equal(slot(accepted, 'peer').facilityId, 'CENTER');
  assert.equal(slot(accepted, 'peer').strips.updated[0].stripId, senderStrip.stripId);
  assert.equal(slot(accepted, 'peer').strips.updated[0].coordination.state, 'ACTIVE');
});

test('efsp-resync is facility-scoped — resyncing CENTER never returns INCIRLIK\'s strips or vice versa', () => {
  const ctx = makeCtx();
  const opsSession = { controllerId: 'ops1', who: 'Ops1' };
  holding(ctx, CTR_SESSION, 'CENTER', ['CTR']);
  holding(ctx, opsSession, 'INCIRLIK', ['OPS']);
  handleMessage(ctx, CTR_SESSION, createCtrStripMsg(), noopPersist);
  handleMessage(ctx, opsSession, {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), actingPositionId: 'OPS',
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', flightData: { callsign: 'VIPER1', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250' } },
  }, noopPersist);

  const centerSnapshot = handleMessage(ctx, CTR_SESSION, { type: 'efsp-resync', facilityId: 'CENTER', lastBoardSeq: -999999 }, noopPersist);
  assert.equal(centerSnapshot.ack.answer, 'snapshot');
  // The snapshot itself is global (both Facilities, guide §4.8.5's "one
  // client can act across both Boards") — but the STRIPS in it are
  // correctly facility-stamped, and the CENTER-scoped ones are the ones
  // CTR actually created.
  const centerStrips = centerSnapshot.ack.strips.filter(s => s.facilityId === 'CENTER');
  const incirlikStrips = centerSnapshot.ack.strips.filter(s => s.facilityId === 'INCIRLIK');
  assert.equal(centerStrips.length, 1);
  assert.equal(incirlikStrips.length, 1);
  assert.equal(centerStrips[0].stripType, 'ARRIVAL');
  assert.equal(incirlikStrips[0].stripType, 'DEPARTURE');
});

test('docs/adr/0022: the snapshot carries aitAuthorizedByFacility for every Facility, so the client can proactively disable the AIT option', () => {
  const ctx = makeCtx();
  const snapshot = handleMessage(ctx, CTR_SESSION, { type: 'efsp-resync', facilityId: 'CENTER', lastBoardSeq: -999999 }, noopPersist);
  assert.deepEqual(snapshot.ack.aitAuthorizedByFacility, { INCIRLIK: false, CENTER: false, TACTICAL: false, CARRIER: false, RANGES: false });
});

test('docs/adr/0088: the snapshot carries every Facility\'s position letters for the ATC scope', () => {
  const ctx = makeCtx();
  const snapshot = handleMessage(ctx, CTR_SESSION, { type: 'efsp-resync', facilityId: 'CENTER', lastBoardSeq: -999999 }, noopPersist);
  assert.equal(snapshot.ack.positionLetters.INCIRLIK.LC, 'T');
  assert.equal(snapshot.ack.positionLetters.CENTER.CTR, 'C');
  assert.equal(snapshot.ack.positionLetters.TACTICAL.TAC_C2, 'M');
});

test('efsp-set-positions is facility-scoped — holding CTR at CENTER does not touch INCIRLIK\'s PositionStore', () => {
  const ctx = makeCtx();
  const result = handleMessage(ctx, CTR_SESSION, { type: 'efsp-set-positions', facilityId: 'CENTER', signedOn: ['CTR'] }, noopPersist);
  assert.deepEqual(result.ack.signedOn, ['CTR']);
  assert.equal(ctx.positionStoreFor('CENTER').isStaffed('CTR'), true);
  assert.equal(ctx.positionStoreFor('INCIRLIK').isStaffed('AP'), false);
});

test('every Strip record in an efsp-mutation ack AND its broadcast delta carries facilityId, not just the snapshot — a client that only ever sees deltas after its first connect must still be able to filter by Facility', () => {
  const ctx = makeCtx();
  holding(ctx, CTR_SESSION, 'CENTER', ['CTR']);
  const created = handleMessage(ctx, CTR_SESSION, createCtrStripMsg(), noopPersist);
  assert.equal(created.ack.strip.facilityId, 'CENTER');
  assert.equal(slot(created, 'primary').strips.updated[0].facilityId, 'CENTER');
});

test('a resync-within-window delta also stamps facilityId on every updated Strip', () => {
  const ctx = makeCtx();
  holding(ctx, CTR_SESSION, 'CENTER', ['CTR']);
  const before = ctx.boardStoreFor('CENTER').currentSeq;
  handleMessage(ctx, CTR_SESSION, createCtrStripMsg(), noopPersist);

  const result = handleMessage(ctx, CTR_SESSION, { type: 'efsp-resync', facilityId: 'CENTER', lastBoardSeq: before, boardEpoch: ctx.boardStoreFor('CENTER').epoch }, noopPersist);
  assert.equal(result.ack.answer, 'delta');
  assert.equal(result.ack.strips.updated.length, 1);
  assert.equal(result.ack.strips.updated[0].facilityId, 'CENTER');
});

test('a snapshot includes every Facility\'s Bays, each correctly stamped', async () => {
  const ctx = makeCtx();
  const { snapshotMessage } = await import('../src/efsp/efsp-ws.js');
  const snap = snapshotMessage(ctx);
  assert.equal([...snap.facilities].sort().join(','), 'CARRIER,CENTER,INCIRLIK,RANGES,TACTICAL');
  assert.ok(snap.bays.some(b => b.bayId === 'ctr-enroute' && b.facilityId === 'CENTER'));
  assert.ok(snap.bays.some(b => b.bayId === 'ap-coordination' && b.facilityId === 'INCIRLIK'));
  assert.ok(snap.bays.some(b => b.bayId === 'tac-c2-coordination' && b.facilityId === 'TACTICAL'));
  assert.equal(snap.facilities[0], 'INCIRLIK', 'the default Facility comes first');
  assert.equal('boardSeq' in snap || 'facility' in snap, false, 'the back-compat aliases are gone (docs/adr/0104)');
  assert.equal(typeof snap.boardSeqByFacility.INCIRLIK, 'number');
  assert.equal(typeof snap.boardSeqByFacility.CENTER, 'number');
  assert.equal(typeof snap.boardSeqByFacility.TACTICAL, 'number');
});

// ── docs/adr/0081 (L27): the peer's side of one Board event ──────────────

test('a coordination proposal that rebalances the peer\'s coordination Rack puts the re-keyed peer Strips in peerBroadcast', () => {
  const ctx = makeCtx();
  holding(ctx, CTR_SESSION, 'CENTER', ['CTR']);
  holding(ctx, AP_SESSION, 'INCIRLIK', ['AP']);
  const propose = (strip) => handleMessage(ctx, CTR_SESSION, {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: 'CENTER', actingPositionId: 'CTR', stripId: strip.stripId, baseRev: strip.rev,
    op: { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'AP' },
  }, noopPersist);

  const first = handleMessage(ctx, CTR_SESSION, createCtrStripMsg(), noopPersist).ack.strip;
  const p1 = propose(first);
  assert.equal(p1.ack.ok, true, JSON.stringify(p1.ack));
  const replica1 = p1.ack.strip.coordination.peerStripId;
  // A key past REBALANCE_KEY_LENGTH: the next replica placed after it forces a proactive rebalance.
  const incirlik = ctx.boardStoreFor('INCIRLIK');
  incirlik.getStrip(replica1).orderKey = 'z'.repeat(45);
  const revBefore = incirlik.getStrip(replica1).rev;

  const second = handleMessage(ctx, CTR_SESSION, createCtrStripMsg({ op: { ...createCtrStripMsg().op, flightData: { ...createCtrStripMsg().op.flightData, callsign: 'SECND22' } } }), noopPersist).ack.strip;
  const p2 = propose(second);
  assert.equal(p2.ack.ok, true, JSON.stringify(p2.ack));
  assert.ok(incirlik.getStrip(replica1).rev > revBefore, 'the first replica was re-keyed');
  const peerSent = new Map(slot(p2, 'peer').strips.updated.map(s => [s.stripId, s]));
  assert.equal(slot(p2, 'peer').strips.updated[0].stripId, p2.ack.strip.coordination.peerStripId, 'the new replica leads');
  assert.ok(peerSent.has(replica1), 'the re-keyed peer Strip rides in peerBroadcast');
  assert.equal(peerSent.get(replica1).orderKey, incirlik.getStrip(replica1).orderKey);
  assert.equal(peerSent.get(replica1).rev, incirlik.getStrip(replica1).rev);
  assert.ok(incirlik.getStrip(replica1).orderKey.length <= 40);
  assert.deepEqual(incirlik.drainTouched(), [], 'the peer Board was drained by the broadcast');
});
