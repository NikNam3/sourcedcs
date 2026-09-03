import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// facility-config.js reads its paths once at module load — override both
// before import (same isolation efsp-facility-config.test.mjs uses).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-board-store-coordination-test-'));
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH = path.join(tmpDir, 'incirlik.json');
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER = path.join(tmpDir, 'center.json');

const { BoardStore } = await import('../src/efsp/board-store.js');
const { FdrStore } = await import('../src/efsp/fdr-store.js');
const { PositionStore } = await import('../src/efsp/position-store.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const blockMap = await import('../src/efsp/block-map.js');
const nla = await import('../src/efsp/nla.js');
const permission = await import('../src/efsp/permission.js');
const coordination = await import('../src/efsp/coordination.js');

/**
 * Builds two real, fully-wired {boardStore, positionStore} pairs — one per
 * Facility — sharing one FdrStore, wired via peerBoard exactly like
 * index.js's real composition root (docs/adr/0013). This is the direct,
 * BoardStore-level test tier for the D13 replication mechanism itself,
 * below the WS boundary (efsp-ws-coordination.test.mjs covers that layer).
 */
function makeFacilities() {
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
      peerBoard: (otherFacilityId) => {
        const other = facilities.get(otherFacilityId);
        return other ? other.boardStore : null;
      },
      coordinationEffect: (primitive) => coordination.coordinationEffect(primitive),
    };
    const boardStore = new BoardStore(fdrStore, rules);
    facilities.set(facilityId, { boardStore, positionStore });
  }
  return facilities;
}

function mutation(overrides = {}) {
  return { clientMutationId: crypto.randomUUID(), stripId: null, baseRev: null, op: {}, ...overrides };
}

/** CTR originates an ARRIVAL Strip locally (docs/adr/0014's new terminus stub, mirroring ADR 0008's original shape). */
function createCtrStrip(facilities, overrides = {}) {
  const { boardStore } = facilities.get('CENTER');
  const result = boardStore.applyMutation(mutation({
    op: {
      kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main',
      fdr: { callsign: 'EAGLE1', aircraftType: 'F15', wakeCategory: 'D', originAirport: 'LTAC', estimatedArrivalTimeUtc: Date.now() + 20 * 60 * 1000 },
      role: 'ARRIVAL',
      ...overrides.fdrOverrides,
    },
  }), 'CTR', 'ctr-controller');
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.strip;
}

function proposeHandoff(facilities, strip, overrides = {}) {
  const { boardStore } = facilities.get('CENTER');
  return boardStore.applyMutation(mutation({
    stripId: strip.stripId, baseRev: strip.rev,
    op: { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'APP', ...overrides },
  }), 'CTR', 'ctr-controller');
}

// ── The core D13 acceptance criterion: two independent replicas ─────────

test('HANDOFF PROPOSE mints a brand-new, independent Strip in the receiving Facility\'s own Board — not the same object, not the same stripId', () => {
  const facilities = makeFacilities();
  const senderStrip = createCtrStrip(facilities);

  const proposed = proposeHandoff(facilities, senderStrip);
  assert.equal(proposed.ok, true, JSON.stringify(proposed));
  assert.equal(proposed.strip.coordination.state, 'PROPOSED');
  assert.equal(proposed.strip.coordination.peerFacilityId, 'INCIRLIK');

  const receiverStripId = proposed.strip.coordination.peerStripId;
  assert.notEqual(receiverStripId, senderStrip.stripId);

  const { boardStore: appBoard } = facilities.get('INCIRLIK');
  const receiverStrip = appBoard.getStrip(receiverStripId);
  assert.ok(receiverStrip);
  assert.equal(receiverStrip.ownerPositionId, 'APP');
  assert.equal(receiverStrip.bayId, 'app-coordination');
  assert.equal(receiverStrip.coordination.state, 'PROPOSED');
  assert.equal(receiverStrip.coordination.peerStripId, senderStrip.stripId);
  assert.equal(receiverStrip.coordination.peerFacilityId, 'CENTER');
  assert.equal(receiverStrip.fdrId, senderStrip.fdrId); // one logical FDR, shared — docs/adr/0013's simplification
});

test('ACCEPT moves the receiver replica into its normal INBOUND Bay, sets both sides ACTIVE, and moves data ownership + separation responsibility to the receiver (HANDOFF\'s full-jurisdiction-transfer row)', () => {
  const facilities = makeFacilities();
  const senderStrip = createCtrStrip(facilities);
  const proposed = proposeHandoff(facilities, senderStrip);
  const receiverStripId = proposed.strip.coordination.peerStripId;

  const { boardStore: appBoard } = facilities.get('INCIRLIK');
  const receiverBefore = appBoard.getStrip(receiverStripId);
  const accepted = appBoard.applyMutation(mutation({
    stripId: receiverStripId, baseRev: receiverBefore.rev,
    op: { kind: 'HANDOFF', action: 'ACCEPT' },
  }), 'APP', 'app-controller');

  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(accepted.strip.bayId, 'app-inbound');
  assert.equal(accepted.strip.state, 'INBOUND');
  assert.equal(accepted.strip.coordination.state, 'ACTIVE');
  assert.deepEqual(accepted.strip.coordination.dataOwnerPositionRef, { facilityId: 'INCIRLIK', positionId: 'APP' });
  assert.deepEqual(accepted.strip.coordination.separationResponsibilityRef, { facilityId: 'INCIRLIK', positionId: 'APP' });
  assert.equal(accepted.strip.coordination.radarIdTransferred, true);
  assert.equal(accepted.strip.coordination.commsTransferred, true);

  // The SENDER's own Strip is also updated to ACTIVE — both replicas agree.
  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const senderAfter = ctrBoard.getStrip(senderStrip.stripId);
  assert.equal(senderAfter.coordination.state, 'ACTIVE');
  assert.deepEqual(senderAfter.coordination.dataOwnerPositionRef, { facilityId: 'INCIRLIK', positionId: 'APP' });
});

test('D13 acceptance criterion, literally: each replica is independently removable — dropping one has zero effect on the other', () => {
  const facilities = makeFacilities();
  const senderStrip = createCtrStrip(facilities);
  const proposed = proposeHandoff(facilities, senderStrip);
  const receiverStripId = proposed.strip.coordination.peerStripId;

  const { boardStore: appBoard } = facilities.get('INCIRLIK');
  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const receiver = appBoard.getStrip(receiverStripId);
  appBoard.applyMutation(mutation({
    stripId: receiverStripId, baseRev: receiver.rev, op: { kind: 'HANDOFF', action: 'ACCEPT' },
  }), 'APP', 'app-controller');

  // Drop the RECEIVER's replica.
  const receiverNow = appBoard.getStrip(receiverStripId);
  const dropped = appBoard.applyMutation(mutation({
    stripId: receiverStripId, baseRev: receiverNow.rev, op: { kind: 'DropStrip' },
  }), 'APP', 'app-controller');
  assert.equal(dropped.ok, true);
  assert.equal(appBoard.getStrip(receiverStripId).state, 'DROPPED');

  // The SENDER's Strip is completely untouched — still ACTIVE, still there,
  // still on CTR's own Board. Structurally cannot have been reached by
  // appBoard's _applyDropStrip, since it lives in a different _strips Map.
  const senderStill = ctrBoard.getStrip(senderStrip.stripId);
  assert.equal(senderStill.state, 'INBOUND');
  assert.equal(senderStill.coordination.state, 'ACTIVE');

  // And the reverse holds too — dropping the sender doesn't touch the
  // (already-dropped) receiver's Board at all.
  const dropSender = ctrBoard.applyMutation(mutation({
    stripId: senderStrip.stripId, baseRev: senderStill.rev, op: { kind: 'DropStrip' },
  }), 'CTR', 'ctr-controller');
  assert.equal(dropSender.ok, true);
  assert.equal(appBoard.getStrip(receiverStripId).state, 'DROPPED'); // unchanged by the sender-side drop
});

// ── REJECT ────────────────────────────────────────────────────────────

test('REJECT marks both replicas REJECTED and does not move anything', () => {
  const facilities = makeFacilities();
  const senderStrip = createCtrStrip(facilities);
  const proposed = proposeHandoff(facilities, senderStrip);
  const receiverStripId = proposed.strip.coordination.peerStripId;

  const { boardStore: appBoard } = facilities.get('INCIRLIK');
  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const receiver = appBoard.getStrip(receiverStripId);
  const rejected = appBoard.applyMutation(mutation({
    stripId: receiverStripId, baseRev: receiver.rev, op: { kind: 'HANDOFF', action: 'REJECT' },
  }), 'APP', 'app-controller');

  assert.equal(rejected.ok, true);
  assert.equal(rejected.strip.coordination.state, 'REJECTED');
  assert.equal(rejected.strip.bayId, 'app-coordination'); // never moved out

  const senderAfter = ctrBoard.getStrip(senderStrip.stripId);
  assert.equal(senderAfter.coordination.state, 'REJECTED');
});

// ── POINT_OUT — the split-jurisdiction case (guide rule 1) ──────────────

test('POINT_OUT on ACCEPT moves separation responsibility but leaves data ownership with the initiator', () => {
  const facilities = makeFacilities();
  const senderStrip = createCtrStrip(facilities);
  const proposed = proposeHandoff(facilities, senderStrip, { kind: 'POINT_OUT' });
  assert.equal(proposed.ok, true, JSON.stringify(proposed));
  const receiverStripId = proposed.strip.coordination.peerStripId;

  const { boardStore: appBoard } = facilities.get('INCIRLIK');
  const receiver = appBoard.getStrip(receiverStripId);
  const accepted = appBoard.applyMutation(mutation({
    stripId: receiverStripId, baseRev: receiver.rev, op: { kind: 'POINT_OUT', action: 'ACCEPT' },
  }), 'APP', 'app-controller');

  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.deepEqual(accepted.strip.coordination.dataOwnerPositionRef, { facilityId: 'CENTER', positionId: 'CTR' }); // stays with initiator
  assert.deepEqual(accepted.strip.coordination.separationResponsibilityRef, { facilityId: 'INCIRLIK', positionId: 'APP' }); // moves
  assert.equal(accepted.strip.coordination.commsTransferred, false); // guide's table: POINT_OUT comms does not transfer
});

// ── Validation and permission gates ──────────────────────────────────────

test('PROPOSE is rejected without a toFacilityId/toPositionId', () => {
  const facilities = makeFacilities();
  const strip = createCtrStrip(facilities);
  const result = proposeHandoff(facilities, strip, { toFacilityId: undefined, toPositionId: undefined });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
});

test('PROPOSE targeting one\'s own Facility is rejected', () => {
  const facilities = makeFacilities();
  const strip = createCtrStrip(facilities);
  const result = proposeHandoff(facilities, strip, { toFacilityId: 'CENTER' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
});

test('PROPOSE to an unknown Facility is rejected, not a throw', () => {
  const facilities = makeFacilities();
  const strip = createCtrStrip(facilities);
  const result = proposeHandoff(facilities, strip, { toFacilityId: 'ATLANTIS' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
});

test('PROPOSE to a Position with no Coordination Bay is rejected', () => {
  const facilities = makeFacilities();
  const strip = createCtrStrip(facilities);
  const result = proposeHandoff(facilities, strip, { toPositionId: 'NOT_A_POSITION' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
});

test('a Strip cannot have two open coordination links at once — a second PROPOSE while one is already PROPOSED/ACTIVE is rejected', () => {
  const facilities = makeFacilities();
  const strip = createCtrStrip(facilities);
  const first = proposeHandoff(facilities, strip);
  assert.equal(first.ok, true);

  const second = proposeHandoff(facilities, first.strip);
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'VALIDATION_ERROR');
});

test('D21 regression: only APP/CTR may PROPOSE a coordination primitive — GND is refused even though it owns its own Strip', () => {
  const facilities = makeFacilities();
  const { boardStore: incirlikBoard, positionStore: incirlikPositions } = facilities.get('INCIRLIK');
  incirlikPositions.setHeldPositions('gnd-controller', 'Gnd1', ['GND']); // occupy GND so the TransferStrip fixture setup below can route to it
  const created = incirlikBoard.applyMutation(mutation({
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', fdr: { callsign: 'VIPER1', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250' } },
  }), 'OPS', 'ops-controller');
  const transferred = incirlikBoard.applyMutation(mutation({
    stripId: created.strip.stripId, baseRev: created.strip.rev,
    op: { kind: 'TransferStrip', toPositionId: 'GND', bayId: 'gnd-coordination', rackId: 'main' },
  }), 'OPS', 'ops-controller');
  assert.equal(transferred.ok, true, JSON.stringify(transferred));

  const result = incirlikBoard.applyMutation(mutation({
    stripId: transferred.strip.stripId, baseRev: transferred.strip.rev,
    op: { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' },
  }), 'GND', 'ops-controller');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PERMISSION_DENIED');
});

test('ACCEPT/REJECT with no pending PROPOSED coordination on the Strip is rejected', () => {
  const facilities = makeFacilities();
  const strip = createCtrStrip(facilities);
  const { boardStore } = facilities.get('CENTER');
  const result = boardStore.applyMutation(mutation({
    stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'HANDOFF', action: 'ACCEPT' },
  }), 'CTR', 'ctr-controller');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
});

// ── Track-degradation soft interlock (guide §4.6 rule 5), docs/adr/0019 ──

test('PROPOSE is rejected without a note when the FDR carries a non-NONE track-degradation flag', () => {
  const facilities = makeFacilities();
  const strip = createCtrStrip(facilities);
  const { boardStore, } = facilities.get('CENTER');
  const fdrStore = boardStore._fdrStore; // internal, test-only reach-in — mirrors other test files' direct-field access pattern
  fdrStore.setField(strip.fdrId, 'identity.trackDegradationFlag', 'CST', { by: 'CTR' });

  const withoutNote = proposeHandoff(facilities, strip, { note: undefined });
  assert.equal(withoutNote.ok, false);
  assert.equal(withoutNote.reason, 'VALIDATION_ERROR');
  assert.match(withoutNote.detail, /track degradation/);

  const withNote = proposeHandoff(facilities, strip, { note: 'verbal coordination via UHF guard' });
  assert.equal(withNote.ok, true, JSON.stringify(withNote));
});

// ── OPERATIONAL_REQUEST — the "nothing transfers" primitive ─────────────

test('OPERATIONAL_REQUEST APPROVE creates a replica and updates both sides like every other primitive, but moves neither data ownership nor separation responsibility (guide: "stays with requester")', () => {
  const facilities = makeFacilities();
  const strip = createCtrStrip(facilities);
  const proposed = proposeHandoff(facilities, strip, { kind: 'OPERATIONAL_REQUEST', note: 'request early descent clearance' });
  assert.equal(proposed.ok, true, JSON.stringify(proposed));

  const { boardStore: appBoard } = facilities.get('INCIRLIK');
  const receiver = appBoard.getStrip(proposed.strip.coordination.peerStripId);
  const approved = appBoard.applyMutation(mutation({
    stripId: receiver.stripId, baseRev: receiver.rev, op: { kind: 'OPERATIONAL_REQUEST', action: 'ACCEPT' },
  }), 'APP', 'app-controller');

  assert.equal(approved.ok, true, JSON.stringify(approved));
  assert.deepEqual(approved.strip.coordination.dataOwnerPositionRef, { facilityId: 'CENTER', positionId: 'CTR' });
  assert.deepEqual(approved.strip.coordination.separationResponsibilityRef, { facilityId: 'CENTER', positionId: 'CTR' });
  assert.equal(approved.strip.coordination.radarIdTransferred, false);
});
