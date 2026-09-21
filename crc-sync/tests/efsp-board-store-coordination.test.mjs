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
function makeFacilities({ aitAuthorized = {} } = {}) {
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
      aitAuthorized: !!aitAuthorized[facilityId],
      peerBoard: (otherFacilityId) => {
        const other = facilities.get(otherFacilityId);
        return other ? other.boardStore : null;
      },
      coordinationEffect: (primitive) => coordination.coordinationEffect(primitive),
      coordinationEligibleState: (role) => coordination.coordinationEligibleState(role),
    };
    const boardStore = new BoardStore(fdrStore, rules);
    facilities.set(facilityId, { boardStore, positionStore });
  }
  return facilities;
}

/**
 * APP originates a DEPARTURE Strip already at HANDED_OFF, so it's eligible
 * to PROPOSE coordination to CTR (docs/adr/0022's
 * COORDINATION_ELIGIBLE_STATES.DEPARTURE). SetState first (bypasses the
 * bay-implied-transition sequence check entirely — mirrors this repo's
 * existing test fixtures' use of SetState as a raw jump, e.g.
 * efsp-board-store.test.mjs), THEN TransferStrip into app-departures —
 * by then strip.state already equals that Bay's impliesState, so
 * _validateBayImpliedTransition's "already there" short-circuit applies
 * and the transfer is never itself treated as an advancing transition.
 */
function createAppHandedOffStrip(facilities) {
  const { boardStore: incirlikBoard, positionStore: incirlikPositions } = facilities.get('INCIRLIK');
  incirlikPositions.setHeldPositions('app-controller', 'App1', ['APP']);
  const created = incirlikBoard.applyMutation(mutation({
    op: {
      kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main',
      fdr: { callsign: 'VIPER1', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250' },
    },
  }), 'OPS', 'ops-controller');
  assert.equal(created.ok, true, JSON.stringify(created));
  const setState = incirlikBoard.applyMutation(mutation({
    stripId: created.strip.stripId, baseRev: created.strip.rev,
    op: { kind: 'SetState', toState: 'HANDED_OFF' },
  }), 'OPS', 'ops-controller');
  assert.equal(setState.ok, true, JSON.stringify(setState));
  const transferred = incirlikBoard.applyMutation(mutation({
    stripId: setState.strip.stripId, baseRev: setState.strip.rev,
    op: { kind: 'TransferStrip', toPositionId: 'APP', bayId: 'app-departures', rackId: 'main' },
  }), 'OPS', 'ops-controller');
  assert.equal(transferred.ok, true, JSON.stringify(transferred));
  return transferred.strip;
}

/** APP proposes coordination to CTR — the mirror of proposeHandoff, other direction. */
function proposeFromApp(facilities, strip, overrides = {}) {
  const { boardStore } = facilities.get('INCIRLIK');
  return boardStore.applyMutation(mutation({
    stripId: strip.stripId, baseRev: strip.rev,
    op: { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR', ...overrides },
  }), 'APP', 'app-controller');
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

// ── docs/adr/0022: APP -> CTR DEPARTURE coordination (the gap-closure) ──

test('APP -> CTR HANDOFF PROPOSE mints a DEPARTURE/HANDED_OFF replica at CTR — the previously-hardcoded ARRIVAL/INBOUND shape is now the sender\'s actual role/state', () => {
  const facilities = makeFacilities();
  const senderStrip = createAppHandedOffStrip(facilities);
  assert.equal(senderStrip.role, 'DEPARTURE');
  assert.equal(senderStrip.state, 'HANDED_OFF');

  const proposed = proposeFromApp(facilities, senderStrip);
  assert.equal(proposed.ok, true, JSON.stringify(proposed));

  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const receiver = ctrBoard.getStrip(proposed.strip.coordination.peerStripId);
  assert.ok(receiver);
  assert.equal(receiver.role, 'DEPARTURE');
  assert.equal(receiver.state, 'HANDED_OFF');
  assert.equal(receiver.bayId, 'ctr-app-coordination');
});

test('APP -> CTR HANDOFF ACCEPT moves the replica into ctr-departures (not ctr-enroute) and each side stays independently droppable', () => {
  const facilities = makeFacilities();
  const senderStrip = createAppHandedOffStrip(facilities);
  const proposed = proposeFromApp(facilities, senderStrip);
  const receiverStripId = proposed.strip.coordination.peerStripId;

  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const { boardStore: appBoard } = facilities.get('INCIRLIK');
  const receiver = ctrBoard.getStrip(receiverStripId);
  const accepted = ctrBoard.applyMutation(mutation({
    stripId: receiverStripId, baseRev: receiver.rev, op: { kind: 'HANDOFF', action: 'ACCEPT' },
  }), 'CTR', 'ctr-controller');

  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(accepted.strip.bayId, 'ctr-departures');
  assert.equal(accepted.strip.state, 'HANDED_OFF'); // accept relocates, never advances state
  assert.equal(accepted.strip.coordination.state, 'ACTIVE');

  const dropped = ctrBoard.applyMutation(mutation({
    stripId: receiverStripId, baseRev: accepted.strip.rev, op: { kind: 'DropStrip' },
  }), 'CTR', 'ctr-controller');
  assert.equal(dropped.ok, true);
  const senderStill = appBoard.getStrip(senderStrip.stripId);
  assert.equal(senderStill.state, 'HANDED_OFF'); // untouched — independent replicas, D13
});

test('PROPOSE is rejected when the Strip is not in an eligible (role, state) combo — a DEPARTURE Strip at APP but still PROPOSED (not yet HANDED_OFF) cannot propose HANDOFF', () => {
  const facilities = makeFacilities();
  const { boardStore: incirlikBoard, positionStore } = facilities.get('INCIRLIK');
  positionStore.setHeldPositions('app-controller', 'App1', ['APP']);
  const created = incirlikBoard.applyMutation(mutation({
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', fdr: { callsign: 'VIPER2', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250' } },
  }), 'OPS', 'ops-controller');
  // app-coordination has no impliesState, so this transfer is never itself
  // treated as an advancing transition — lands a still-PROPOSED DEPARTURE
  // Strip at APP, isolating the (role, state) eligibility check below from
  // permission.js's separate canMutate gate (APP has full coordination
  // permissions, unlike the D21 test above's GND).
  const transferred = incirlikBoard.applyMutation(mutation({
    stripId: created.strip.stripId, baseRev: created.strip.rev,
    op: { kind: 'TransferStrip', toPositionId: 'APP', bayId: 'app-coordination', rackId: 'main' },
  }), 'OPS', 'ops-controller');
  assert.equal(transferred.ok, true, JSON.stringify(transferred));
  assert.equal(transferred.strip.state, 'PROPOSED');

  const result = incirlikBoard.applyMutation(mutation({
    stripId: transferred.strip.stripId, baseRev: transferred.strip.rev,
    op: { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' },
  }), 'APP', 'ops-controller');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
});

// ── docs/adr/0022: OPERATIONAL_REQUEST's STAND_BY response ──────────────

test('STAND_BY leaves the request PROPOSED on both replicas and stamps lastStandByAt', () => {
  const facilities = makeFacilities();
  const strip = createCtrStrip(facilities);
  const proposed = proposeHandoff(facilities, strip, { kind: 'OPERATIONAL_REQUEST', note: 'request early descent clearance' });
  assert.equal(proposed.ok, true, JSON.stringify(proposed));

  const { boardStore: appBoard } = facilities.get('INCIRLIK');
  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const receiver = appBoard.getStrip(proposed.strip.coordination.peerStripId);
  const stoodBy = appBoard.applyMutation(mutation({
    stripId: receiver.stripId, baseRev: receiver.rev, op: { kind: 'OPERATIONAL_REQUEST', action: 'STAND_BY' },
  }), 'APP', 'app-controller');

  assert.equal(stoodBy.ok, true, JSON.stringify(stoodBy));
  assert.equal(stoodBy.strip.coordination.state, 'PROPOSED'); // unresolved
  assert.ok(stoodBy.strip.coordination.lastStandByAt);

  const senderAfter = ctrBoard.getStrip(strip.stripId);
  assert.equal(senderAfter.coordination.state, 'PROPOSED');
  assert.ok(senderAfter.coordination.lastStandByAt);
});

test('STAND_BY is rejected for any primitive other than OPERATIONAL_REQUEST', () => {
  const facilities = makeFacilities();
  const strip = createCtrStrip(facilities);
  const proposed = proposeHandoff(facilities, strip); // default kind: HANDOFF
  const { boardStore: appBoard } = facilities.get('INCIRLIK');
  const receiver = appBoard.getStrip(proposed.strip.coordination.peerStripId);
  const result = appBoard.applyMutation(mutation({
    stripId: receiver.stripId, baseRev: receiver.rev, op: { kind: 'HANDOFF', action: 'STAND_BY' },
  }), 'APP', 'app-controller');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
});

// ── docs/adr/0022: AIT requires a written directive on file ─────────────

test('AIT PROPOSE is rejected when the Facility is not authorized (aitAuthorized: false, the default)', () => {
  const facilities = makeFacilities();
  const strip = createCtrStrip(facilities);
  const result = proposeHandoff(facilities, strip, { kind: 'AIT' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
  assert.match(result.detail, /written directive/);
});

test('AIT PROPOSE succeeds once the sending Facility is configured as authorized', () => {
  const facilities = makeFacilities({ aitAuthorized: { CENTER: true } });
  const strip = createCtrStrip(facilities);
  const result = proposeHandoff(facilities, strip, { kind: 'AIT' });
  assert.equal(result.ok, true, JSON.stringify(result));
});

// ── docs/adr/0022: trackDegradationFlag's Block Map wiring ──────────────
// (fdr-store.js's setField() already validated this field via WRITABLE_PATHS
// since docs/adr/0019 — the gap was purely that no Block ever routed a
// SetBlock at it; Block '5A' closes that.)

test('SetBlock on the new track-degradation Block (5A) round-trips through fdr-store.js\'s existing setField validation', () => {
  const facilities = makeFacilities();
  const strip = createCtrStrip(facilities);
  const { boardStore } = facilities.get('CENTER');
  const result = boardStore.applyMutation(mutation({
    stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'SetBlock', blockId: '5A', value: 'CST' },
  }), 'CTR', 'ctr-controller');
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.fdr.identity.trackDegradationFlag, 'CST');
});

test('SetBlock on the track-degradation Block rejects a value outside TRACK_DEGRADATION_FLAGS', () => {
  const facilities = makeFacilities();
  const strip = createCtrStrip(facilities);
  const { boardStore } = facilities.get('CENTER');
  const result = boardStore.applyMutation(mutation({
    stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'SetBlock', blockId: '5A', value: 'NOT_A_FLAG' },
  }), 'CTR', 'ctr-controller');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
});

// ── Bug found in live testing: dropping a Strip with an open coordination
// proposal silently orphaned the peer's replica (nothing notified it, since
// only ACCEPT/REJECT call receiveCoordinationResponse) ──────────────────

test('InvokeNla is rejected while a coordination proposal is still open (PROPOSED) — a DEPARTURE Strip at HANDED_OFF cannot be Dropped out from under a pending HANDOFF', () => {
  const facilities = makeFacilities();
  const senderStrip = createAppHandedOffStrip(facilities);
  const proposed = proposeFromApp(facilities, senderStrip);
  assert.equal(proposed.ok, true, JSON.stringify(proposed));

  const { boardStore: appBoard } = facilities.get('INCIRLIK');
  const result = appBoard.applyMutation(mutation({
    stripId: proposed.strip.stripId, baseRev: proposed.strip.rev, op: { kind: 'InvokeNla' },
  }), 'APP', 'app-controller');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
  assert.match(result.detail, /open coordination proposal/);

  // The peer's replica is untouched — still there, still PROPOSED.
  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const receiver = ctrBoard.getStrip(proposed.strip.coordination.peerStripId);
  assert.equal(receiver.state, 'HANDED_OFF');
  assert.equal(receiver.coordination.state, 'PROPOSED');
});

test('the explicit DropStrip op is rejected the same way while a coordination proposal is open', () => {
  const facilities = makeFacilities();
  const senderStrip = createAppHandedOffStrip(facilities);
  const proposed = proposeFromApp(facilities, senderStrip);

  const { boardStore: appBoard } = facilities.get('INCIRLIK');
  const result = appBoard.applyMutation(mutation({
    stripId: proposed.strip.stripId, baseRev: proposed.strip.rev, op: { kind: 'DropStrip' },
  }), 'APP', 'app-controller');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
});

test('InvokeNla/DropStrip both work again once the proposal resolves (ACCEPT moves jurisdiction; REJECT closes the link)', () => {
  const facilities = makeFacilities();
  const senderStrip = createAppHandedOffStrip(facilities);
  const proposed = proposeFromApp(facilities, senderStrip);
  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const receiver = ctrBoard.getStrip(proposed.strip.coordination.peerStripId);
  ctrBoard.applyMutation(mutation({
    stripId: receiver.stripId, baseRev: receiver.rev, op: { kind: 'HANDOFF', action: 'REJECT' },
  }), 'CTR', 'ctr-controller');

  const { boardStore: appBoard } = facilities.get('INCIRLIK');
  const senderAfter = appBoard.getStrip(senderStrip.stripId);
  assert.equal(senderAfter.coordination.state, 'REJECTED'); // no longer PROPOSED
  const dropped = appBoard.applyMutation(mutation({
    stripId: senderAfter.stripId, baseRev: senderAfter.rev, op: { kind: 'InvokeNla' },
  }), 'APP', 'app-controller');
  assert.equal(dropped.ok, true, JSON.stringify(dropped));
  assert.equal(dropped.strip.state, 'DROPPED');
});

// ── Bug found in live testing: a REJECTED receiver-side replica, still
// sitting in its own Coordination Bay, could PROPOSE a new coordination
// link right back to its own sender — a spurious third replica, "handing
// off to yourself" ────────────────────────────────────────────────────

test('a REJECTED replica sitting in its owner\'s Coordination Bay cannot PROPOSE a new coordination link', () => {
  const facilities = makeFacilities();
  const senderStrip = createAppHandedOffStrip(facilities);
  const proposed = proposeFromApp(facilities, senderStrip);
  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const receiver = ctrBoard.getStrip(proposed.strip.coordination.peerStripId);

  const rejected = ctrBoard.applyMutation(mutation({
    stripId: receiver.stripId, baseRev: receiver.rev, op: { kind: 'HANDOFF', action: 'REJECT' },
  }), 'CTR', 'ctr-controller');
  assert.equal(rejected.ok, true, JSON.stringify(rejected));
  assert.equal(rejected.strip.coordination.state, 'REJECTED');
  assert.equal(rejected.strip.bayId, 'ctr-app-coordination'); // never moved out — still the replica's Bay

  const retried = ctrBoard.applyMutation(mutation({
    stripId: rejected.strip.stripId, baseRev: rejected.strip.rev,
    op: { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'APP' },
  }), 'CTR', 'ctr-controller');
  assert.equal(retried.ok, false);
  assert.equal(retried.reason, 'VALIDATION_ERROR');
  assert.match(retried.detail, /coordination replica/);
});

// ── Bug found in live testing: DEPARTURE_STATE_OWNERS.HANDED_OFF only
// listed APP, so a CENTER-held HANDED_OFF replica — accepted or rejected
// — had NO way to ever be Dropped ─────────────────────────────────────

test('CTR can Drop a HANDED_OFF DEPARTURE Strip it owns, whether accepted-and-relocated or rejected-and-inert', () => {
  const facilities = makeFacilities();

  const senderA = createAppHandedOffStrip(facilities);
  const proposedA = proposeFromApp(facilities, senderA);
  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const receiverA = ctrBoard.getStrip(proposedA.strip.coordination.peerStripId);
  const acceptedA = ctrBoard.applyMutation(mutation({
    stripId: receiverA.stripId, baseRev: receiverA.rev, op: { kind: 'HANDOFF', action: 'ACCEPT' },
  }), 'CTR', 'ctr-controller');
  assert.equal(acceptedA.ok, true, JSON.stringify(acceptedA));
  const droppedA = ctrBoard.applyMutation(mutation({
    stripId: acceptedA.strip.stripId, baseRev: acceptedA.strip.rev, op: { kind: 'InvokeNla' },
  }), 'CTR', 'ctr-controller');
  assert.equal(droppedA.ok, true, JSON.stringify(droppedA));
  assert.equal(droppedA.strip.state, 'DROPPED');

  const senderB = createAppHandedOffStrip(facilities);
  const proposedB = proposeFromApp(facilities, senderB);
  const receiverB = ctrBoard.getStrip(proposedB.strip.coordination.peerStripId);
  const rejectedB = ctrBoard.applyMutation(mutation({
    stripId: receiverB.stripId, baseRev: receiverB.rev, op: { kind: 'HANDOFF', action: 'REJECT' },
  }), 'CTR', 'ctr-controller');
  assert.equal(rejectedB.ok, true, JSON.stringify(rejectedB));
  const droppedB = ctrBoard.applyMutation(mutation({
    stripId: rejectedB.strip.stripId, baseRev: rejectedB.strip.rev, op: { kind: 'InvokeNla' },
  }), 'CTR', 'ctr-controller');
  assert.equal(droppedB.ok, true, JSON.stringify(droppedB));
  assert.equal(droppedB.strip.state, 'DROPPED');
});

// ── docs/adr/0023: ConvertToArrival — in-place role conversion, replacing
// the earlier "spawn a second Strip/FDR" design after live testing found
// that approach left a stale departure Strip AND a duplicated beacon code
// behind, plus required copying every field by hand ─────────────────────

test('ConvertToArrival turns a HANDED_OFF DEPARTURE Strip into an INBOUND ARRIVAL Strip in place — same stripId, same fdrId (so the same beacon code, trivially, never a duplicate)', () => {
  const facilities = makeFacilities();
  const strip = createAppHandedOffStrip(facilities);
  const { boardStore } = facilities.get('INCIRLIK');

  const converted = boardStore.applyMutation(mutation({
    stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'ConvertToArrival' },
  }), 'APP', 'app-controller');

  assert.equal(converted.ok, true, JSON.stringify(converted));
  assert.equal(converted.strip.stripId, strip.stripId); // same Strip
  assert.equal(converted.strip.fdrId, strip.fdrId);     // same FDR — same beacon code, no copy needed
  assert.equal(converted.strip.role, 'ARRIVAL');
  assert.equal(converted.strip.state, 'INBOUND');
  assert.equal(converted.strip.bayId, 'app-inbound');
  assert.equal(converted.strip.ownerPositionId, 'APP');

  // Only one Strip exists for this flight — not two.
  assert.equal(boardStore.getAll().filter(s => s.fdrId === strip.fdrId).length, 1);
});

// Bug found in live testing: DEPARTURE and ARRIVAL read DIFFERENT FDR
// fields for the same idea (departureAirport vs originAirport) — an
// in-place conversion that never touched the FDR left originAirport
// permanently blank even though departureAirport still held the value.
test('ConvertToArrival maps the departure record\'s departureAirport onto the new ARRIVAL Strip\'s originAirport, and returns the updated fdr so the client actually sees it', () => {
  const facilities = makeFacilities();
  const strip = createAppHandedOffStrip(facilities); // departureAirport: 'LTAG'
  const { boardStore } = facilities.get('INCIRLIK');
  const fdrStore = boardStore._fdrStore; // internal, test-only reach-in — mirrors other tests in this file

  const converted = boardStore.applyMutation(mutation({
    stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'ConvertToArrival' },
  }), 'APP', 'app-controller');

  assert.equal(converted.ok, true, JSON.stringify(converted));
  assert.equal(converted.fdr.filed.originAirport, 'LTAG');
  assert.equal(converted.fdr.filed.departureAirport, 'LTAG'); // untouched, just no longer the field ARRIVAL reads
  assert.equal(fdrStore.getFdr(strip.fdrId).filed.originAirport, 'LTAG'); // persisted, not just echoed in the result
});

test('ConvertToArrival resets annotations/flags/coordination to fresh-Strip defaults — none of them mean the same thing under the new role', () => {
  const facilities = makeFacilities();
  const { boardStore, positionStore } = facilities.get('INCIRLIK');
  positionStore.setHeldPositions('app-controller', 'App1', ['APP']);
  const strip = createAppHandedOffStrip(facilities);
  const flagged = boardStore.applyMutation(mutation({
    stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'SetFlag', flag: 'attention', value: 'red' },
  }), 'APP', 'app-controller');
  assert.equal(flagged.ok, true, JSON.stringify(flagged));

  const converted = boardStore.applyMutation(mutation({
    stripId: flagged.strip.stripId, baseRev: flagged.strip.rev, op: { kind: 'ConvertToArrival' },
  }), 'APP', 'app-controller');
  assert.equal(converted.ok, true, JSON.stringify(converted));
  assert.deepEqual(converted.strip.annotations, {});
  assert.equal(converted.strip.flags.attention, null);
  assert.equal(converted.strip.coordination, null);
});

test('a Strip carries no correlation field at all — it is keyed by fdrId, not stripId', () => {
  // This assertion used to read the other way: a per-Strip
  // `correlation: { state: 'UNCORRELATED' }` was set on creation and reset by
  // ConvertToArrival. Both were wrong, and docs/adr/0045 explains why — one
  // FDR legitimately has several Strips, so a per-Strip correlation lets two
  // replicas of one airframe disagree about which contact it is, and
  // ConvertToArrival threw away a correct binding for an aircraft that was
  // still airborne and still squawking the code docs/adr/0023 kept for it.
  const facilities = makeFacilities();
  const { boardStore, positionStore } = facilities.get('INCIRLIK');
  positionStore.setHeldPositions('app-controller', 'App1', ['APP']);
  const strip = createAppHandedOffStrip(facilities);
  assert.equal('correlation' in strip, false, 'not set on creation');

  const converted = boardStore.applyMutation(mutation({
    stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'ConvertToArrival' },
  }), 'APP', 'app-controller');
  assert.equal(converted.ok, true, JSON.stringify(converted));
  assert.equal('correlation' in converted.strip, false, 'and not written by a role change');
  assert.equal(converted.strip.fdrId, strip.fdrId, 'the same airframe, throughout');
});

test('a pre-WP5 snapshot’s stale per-Strip correlation is dropped on restore, not carried forward', () => {
  const facilities = makeFacilities();
  const { boardStore } = facilities.get('INCIRLIK');
  boardStore.restore({
    strips: [{ stripId: 's1', fdrId: 'f1', rev: 1, state: 'PROPOSED', correlation: { state: 'UNCORRELATED' } }],
    cidSeq: 3,
  });
  const restored = boardStore.getStrip('s1');
  assert.equal('correlation' in restored, false,
    'a second, stale answer to "which contact is this" must not survive a restore');
});

test('ConvertToArrival is rejected on anything other than a DEPARTURE Strip at HANDED_OFF', () => {
  const facilities = makeFacilities();
  const { boardStore, positionStore } = facilities.get('INCIRLIK');
  positionStore.setHeldPositions('app-controller', 'App1', ['APP']);
  const created = boardStore.applyMutation(mutation({
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', fdr: { callsign: 'VIPER3', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250' } },
  }), 'OPS', 'ops-controller');
  // app-coordination has no impliesState, so this transfer is never itself
  // treated as an advancing transition (see the D21-isolation test above
  // for the same pattern) — lands a still-PROPOSED DEPARTURE Strip at APP.
  const transferred = boardStore.applyMutation(mutation({
    stripId: created.strip.stripId, baseRev: created.strip.rev,
    op: { kind: 'TransferStrip', toPositionId: 'APP', bayId: 'app-coordination', rackId: 'main' },
  }), 'OPS', 'ops-controller');
  assert.equal(transferred.ok, true, JSON.stringify(transferred));
  assert.equal(transferred.strip.state, 'PROPOSED'); // still not HANDED_OFF

  const result = boardStore.applyMutation(mutation({
    stripId: transferred.strip.stripId, baseRev: transferred.strip.rev, op: { kind: 'ConvertToArrival' },
  }), 'APP', 'app-controller');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
});

test('D21 regression: TWR may not ConvertToArrival even a Strip it happens to own — only APP/CTR ever get this op kind at all', () => {
  const facilities = makeFacilities();
  const { boardStore, positionStore } = facilities.get('INCIRLIK');
  positionStore.setHeldPositions('twr-controller', 'Twr1', ['TWR']);
  const created = boardStore.applyMutation(mutation({
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', fdr: { callsign: 'VIPER4', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250' } },
  }), 'OPS', 'ops-controller');
  const setState = boardStore.applyMutation(mutation({
    stripId: created.strip.stripId, baseRev: created.strip.rev, op: { kind: 'SetState', toState: 'HANDED_OFF' },
  }), 'OPS', 'ops-controller');
  const transferred = boardStore.applyMutation(mutation({
    stripId: setState.strip.stripId, baseRev: setState.strip.rev,
    op: { kind: 'TransferStrip', toPositionId: 'TWR', bayId: 'twr-coordination', rackId: 'main' },
  }), 'OPS', 'ops-controller');
  assert.equal(transferred.ok, true, JSON.stringify(transferred));

  const result = boardStore.applyMutation(mutation({
    stripId: transferred.strip.stripId, baseRev: transferred.strip.rev, op: { kind: 'ConvertToArrival' },
  }), 'TWR', 'ops-controller');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PERMISSION_DENIED');
});

test('ConvertToArrival works identically at CTR (CENTER Facility) — a departure handed off from APP, then converted for its return leg', () => {
  const facilities = makeFacilities();
  const senderStrip = createAppHandedOffStrip(facilities);
  const proposed = proposeFromApp(facilities, senderStrip);
  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const receiver = ctrBoard.getStrip(proposed.strip.coordination.peerStripId);
  const accepted = ctrBoard.applyMutation(mutation({
    stripId: receiver.stripId, baseRev: receiver.rev, op: { kind: 'HANDOFF', action: 'ACCEPT' },
  }), 'CTR', 'ctr-controller');
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(accepted.strip.bayId, 'ctr-departures');

  const converted = ctrBoard.applyMutation(mutation({
    stripId: accepted.strip.stripId, baseRev: accepted.strip.rev, op: { kind: 'ConvertToArrival' },
  }), 'CTR', 'ctr-controller');
  assert.equal(converted.ok, true, JSON.stringify(converted));
  assert.equal(converted.strip.role, 'ARRIVAL');
  assert.equal(converted.strip.state, 'INBOUND');
  assert.equal(converted.strip.bayId, 'ctr-enroute');
  assert.equal(converted.strip.fdrId, senderStrip.fdrId); // same FDR, all the way through both the HANDOFF and the conversion
});
