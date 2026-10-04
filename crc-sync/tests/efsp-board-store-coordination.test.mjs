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
import { fullRules } from "./helpers/full-rules.mjs";
const { FlightDataStore } = await import('../src/efsp/flight-data-store.js');
const { PositionStore } = await import('../src/efsp/position-store.js');
const facilityConfig = (await import('../src/efsp/facility-config.js')).createFacilityConfig();
const blockMap = await import('../src/efsp/block-map.js');
const nla = await import('../src/efsp/nla.js');
const permission = await import('../src/efsp/permission.js');
const classPermission = (await import('./helpers/permission.mjs')).classPermission();
const coordination = await import('../src/efsp/coordination.js');

/**
 * Builds two real, fully-wired {boardStore, positionStore} pairs — one per
 * Facility — sharing one FlightDataStore, wired via peerBoard exactly like
 * index.js's real composition root (docs/adr/0013). This is the direct,
 * BoardStore-level test tier for the D13 replication mechanism itself,
 * below the WS boundary (efsp-ws-coordination.test.mjs covers that layer).
 */
function makeFacilities({ aitAuthorized = {} } = {}) {
  const flightDataStore = new FlightDataStore();
  const facilities = new Map();

  for (const facilityId of facilityConfig.getFacilityIds()) {
    const positionStore = new PositionStore(facilityConfig.getPositionSet(facilityId), facilityConfig.getHatMaps(facilityId));
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
      aitAuthorized: !!aitAuthorized[facilityId],
      peerBoard: (otherFacilityId) => {
        const other = facilities.get(otherFacilityId);
        return other ? other.boardStore : null;
      },
      coordinationEffect: (primitive) => coordination.coordinationEffect(primitive),
      coordinationEligibleState: (stripType) => coordination.coordinationEligibleState(stripType),
    };
    const boardStore = new BoardStore(flightDataStore, fullRules(rules));
    facilities.set(facilityId, { boardStore, positionStore });
  }
  return facilities;
}

/**
 * AP originates a DEPARTURE Strip already at HANDED_OFF, so it's eligible
 * to PROPOSE coordination to CTR (docs/adr/0022's
 * COORDINATION_ELIGIBLE_STATES.DEPARTURE). SetState first (bypasses the
 * bay-implied-transition sequence check entirely — mirrors this repo's
 * existing test fixtures' use of SetState as a raw jump, e.g.
 * efsp-board-store.test.mjs), THEN TransferStrip into ap-departures —
 * by then strip.state already equals that Bay's impliesState, so
 * board/placement.js's `validateBayImpliedTransition`'s "already there" short-circuit applies
 * and the transfer is never itself treated as an advancing transition.
 */
function createAppHandedOffStrip(facilities) {
  const { boardStore: incirlikBoard, positionStore: incirlikPositions } = facilities.get('INCIRLIK');
  incirlikPositions.setSignedOnPositions('ap-controller', 'App1', ['AP']);
  const created = incirlikBoard.applyMutation(mutation({
    op: {
      kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main',
      flightData: { callsign: 'VIPER1', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250' },
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
    op: { kind: 'TransferStrip', toPositionId: 'AP', bayId: 'ap-departures', rackId: 'main' },
  }), 'OPS', 'ops-controller');
  assert.equal(transferred.ok, true, JSON.stringify(transferred));
  return transferred.strip;
}

/** AP proposes coordination to CTR — the mirror of proposeHandoff, other direction. */
function proposeFromApp(facilities, strip, overrides = {}) {
  const { boardStore } = facilities.get('INCIRLIK');
  return boardStore.applyMutation(mutation({
    stripId: strip.stripId, baseRev: strip.rev,
    op: { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR', ...overrides },
  }), 'AP', 'ap-controller');
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
      flightData: { callsign: 'EAGLE1', aircraftType: 'F15', wakeCategory: 'D', originAirport: 'LTAC', estimatedArrivalTimeUtc: Date.now() + 20 * 60 * 1000 },
      stripType: 'ARRIVAL',
      ...overrides.flightDataOverrides,
    },
  }), 'CTR', 'ctr-controller');
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.strip;
}

function proposeHandoff(facilities, strip, overrides = {}) {
  const { boardStore } = facilities.get('CENTER');
  return boardStore.applyMutation(mutation({
    stripId: strip.stripId, baseRev: strip.rev,
    op: { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'AP', ...overrides },
  }), 'CTR', 'ctr-controller');
}

// ── The core D13 acceptance criterion: two independent replicas ─────────

test('HANDOFF PROPOSE mints a brand-new, independent Strip in the receiving Facility\'s own Board — not the same object, not the same stripId', () => {
  const facilities = makeFacilities();
  const senderStrip = createCtrStrip(facilities);

  const proposed = proposeHandoff(facilities, senderStrip);
  assert.equal(proposed.ok, true, JSON.stringify(proposed));
  assert.equal(proposed.strip.coordination.state, 'INITIATED');
  assert.equal(proposed.strip.coordination.peerFacilityId, 'INCIRLIK');

  const receiverStripId = proposed.strip.coordination.peerStripId;
  assert.notEqual(receiverStripId, senderStrip.stripId);

  const { boardStore: appBoard } = facilities.get('INCIRLIK');
  const receiverStrip = appBoard.getStrip(receiverStripId);
  assert.ok(receiverStrip);
  assert.equal(receiverStrip.ownerPositionId, 'AP');
  assert.equal(receiverStrip.bayId, 'ap-coordination');
  assert.equal(receiverStrip.coordination.state, 'INITIATED');
  assert.equal(receiverStrip.coordination.peerStripId, senderStrip.stripId);
  assert.equal(receiverStrip.coordination.peerFacilityId, 'CENTER');
  assert.equal(receiverStrip.flightDataId, senderStrip.flightDataId); // one logical flight data, shared — docs/adr/0013's simplification
});

test('ACCEPT moves the receiver replica into its normal INBOUND Bay, sets both sides ACTIVE, and moves data ownership (not control or comms) to the receiver', () => {
  const facilities = makeFacilities();
  const senderStrip = createCtrStrip(facilities);
  const proposed = proposeHandoff(facilities, senderStrip);
  const receiverStripId = proposed.strip.coordination.peerStripId;

  const { boardStore: appBoard } = facilities.get('INCIRLIK');
  const receiverBefore = appBoard.getStrip(receiverStripId);
  const accepted = appBoard.applyMutation(mutation({
    stripId: receiverStripId, baseRev: receiverBefore.rev,
    op: { kind: 'HANDOFF', action: 'ACCEPT' },
  }), 'AP', 'ap-controller');

  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(accepted.strip.bayId, 'ap-inbound');
  assert.equal(accepted.strip.state, 'INBOUND');
  assert.equal(accepted.strip.coordination.state, 'ACTIVE');
  assert.deepEqual(accepted.strip.coordination.dataOwnerPositionRef, { facilityId: 'INCIRLIK', positionId: 'AP' });
  // docs/adr/0101: control and comms stay with the transferring side until their own steps.
  assert.deepEqual(accepted.strip.coordination.separationResponsibilityRef, { facilityId: 'CENTER', positionId: 'CTR' });
  assert.equal(accepted.strip.coordination.radarIdTransferred, true);
  assert.equal(accepted.strip.coordination.comms.transferred, false);
  assert.equal(accepted.strip.coordination.control.holder, 'TRANSFERRING');

  // The SENDER's own Strip is also updated to ACTIVE — both replicas agree.
  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const senderAfter = ctrBoard.getStrip(senderStrip.stripId);
  assert.equal(senderAfter.coordination.state, 'ACTIVE');
  assert.deepEqual(senderAfter.coordination.dataOwnerPositionRef, { facilityId: 'INCIRLIK', positionId: 'AP' });
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
  }), 'AP', 'ap-controller');

  // Drop the RECEIVER's replica.
  const receiverNow = appBoard.getStrip(receiverStripId);
  const dropped = appBoard.applyMutation(mutation({
    stripId: receiverStripId, baseRev: receiverNow.rev, op: { kind: 'DropStrip' },
  }), 'AP', 'ap-controller');
  assert.equal(dropped.ok, true);
  assert.equal(appBoard.getStrip(receiverStripId).state, 'DROPPED');

  // The SENDER's Strip is not removed and not moved — still there, still in
  // its state, still on CTR's own Board (appBoard's _applyDropStrip cannot
  // reach a different _strips Map). Only its exchange ends: the replica that
  // could answer it is gone, and a link nobody can answer strands the Strip
  // (U7, docs/adr/0080). The criterion is about removal, and nothing is removed.
  const senderStill = ctrBoard.getStrip(senderStrip.stripId);
  assert.equal(senderStill.state, 'INBOUND');
  assert.equal(senderStill.coordination, null);

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
  }), 'AP', 'ap-controller');

  assert.equal(rejected.ok, true);
  assert.equal(rejected.strip.coordination.state, 'REJECTED');
  assert.equal(rejected.strip.bayId, 'ap-coordination'); // never moved out

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
  }), 'AP', 'ap-controller');

  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.deepEqual(accepted.strip.coordination.dataOwnerPositionRef, { facilityId: 'CENTER', positionId: 'CTR' }); // stays with initiator
  assert.deepEqual(accepted.strip.coordination.separationResponsibilityRef, { facilityId: 'INCIRLIK', positionId: 'AP' }); // moves
  assert.equal(accepted.strip.coordination.comms, undefined); // guide's table: POINT_OUT comms does not transfer, and it has no comms step
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

test('D21 regression: only AP/CTR may PROPOSE a coordination primitive — GC is refused even though it owns its own Strip', () => {
  const facilities = makeFacilities();
  const { boardStore: incirlikBoard, positionStore: incirlikPositions } = facilities.get('INCIRLIK');
  incirlikPositions.setSignedOnPositions('gc-controller', 'Gnd1', ['GC']); // occupy GC so the TransferStrip fixture setup below can route to it
  const created = incirlikBoard.applyMutation(mutation({
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', flightData: { callsign: 'VIPER1', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250' } },
  }), 'OPS', 'ops-controller');
  const transferred = incirlikBoard.applyMutation(mutation({
    stripId: created.strip.stripId, baseRev: created.strip.rev,
    op: { kind: 'TransferStrip', toPositionId: 'GC', bayId: 'gc-coordination', rackId: 'main' },
  }), 'OPS', 'ops-controller');
  assert.equal(transferred.ok, true, JSON.stringify(transferred));

  const result = incirlikBoard.applyMutation(mutation({
    stripId: transferred.strip.stripId, baseRev: transferred.strip.rev,
    op: { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' },
  }), 'GC', 'ops-controller');
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

test('PROPOSE is rejected without a note when the flight data carries a non-NONE track-degradation flag', () => {
  const facilities = makeFacilities();
  const strip = createCtrStrip(facilities);
  const { boardStore, } = facilities.get('CENTER');
  const flightDataStore = boardStore._flightDataStore; // internal, test-only reach-in — mirrors other test files' direct-field access pattern
  flightDataStore.setField(strip.flightDataId, 'identity.trackDegradationFlag', 'CST', { by: 'CTR' });

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
  }), 'AP', 'ap-controller');

  assert.equal(approved.ok, true, JSON.stringify(approved));
  assert.deepEqual(approved.strip.coordination.dataOwnerPositionRef, { facilityId: 'CENTER', positionId: 'CTR' });
  assert.deepEqual(approved.strip.coordination.separationResponsibilityRef, { facilityId: 'CENTER', positionId: 'CTR' });
  assert.equal(approved.strip.coordination.radarIdTransferred, false);
});

// ── docs/adr/0022: AP -> CTR DEPARTURE coordination (the gap-closure) ──

test('AP -> CTR HANDOFF PROPOSE mints a DEPARTURE/HANDED_OFF replica at CTR — the previously-hardcoded ARRIVAL/INBOUND shape is now the sender\'s actual role/state', () => {
  const facilities = makeFacilities();
  const senderStrip = createAppHandedOffStrip(facilities);
  assert.equal(senderStrip.stripType, 'DEPARTURE');
  assert.equal(senderStrip.state, 'HANDED_OFF');

  const proposed = proposeFromApp(facilities, senderStrip);
  assert.equal(proposed.ok, true, JSON.stringify(proposed));

  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const receiver = ctrBoard.getStrip(proposed.strip.coordination.peerStripId);
  assert.ok(receiver);
  assert.equal(receiver.stripType, 'DEPARTURE');
  assert.equal(receiver.state, 'HANDED_OFF');
  assert.equal(receiver.bayId, 'ctr-ap-coordination');
});

test('AP -> CTR HANDOFF ACCEPT moves the replica into ctr-departures (not ctr-enroute) and each side stays independently droppable', () => {
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

test('PROPOSE is rejected when the Strip is not in an eligible (stripType, state) combo — a DEPARTURE Strip at AP but still PROPOSED (not yet HANDED_OFF) cannot propose HANDOFF', () => {
  const facilities = makeFacilities();
  const { boardStore: incirlikBoard, positionStore } = facilities.get('INCIRLIK');
  positionStore.setSignedOnPositions('ap-controller', 'App1', ['AP']);
  const created = incirlikBoard.applyMutation(mutation({
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', flightData: { callsign: 'VIPER2', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250' } },
  }), 'OPS', 'ops-controller');
  // ap-coordination has no impliesState, so this transfer is never itself
  // treated as an advancing transition — lands a still-PROPOSED DEPARTURE
  // Strip at AP, isolating the (stripType, state) eligibility check below from
  // permission.js's separate canMutate gate (AP has full coordination
  // permissions, unlike the D21 test above's GC).
  const transferred = incirlikBoard.applyMutation(mutation({
    stripId: created.strip.stripId, baseRev: created.strip.rev,
    op: { kind: 'TransferStrip', toPositionId: 'AP', bayId: 'ap-coordination', rackId: 'main' },
  }), 'OPS', 'ops-controller');
  assert.equal(transferred.ok, true, JSON.stringify(transferred));
  assert.equal(transferred.strip.state, 'PROPOSED');

  const result = incirlikBoard.applyMutation(mutation({
    stripId: transferred.strip.stripId, baseRev: transferred.strip.rev,
    op: { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' },
  }), 'AP', 'ops-controller');
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
  }), 'AP', 'ap-controller');

  assert.equal(stoodBy.ok, true, JSON.stringify(stoodBy));
  assert.equal(stoodBy.strip.coordination.state, 'INITIATED'); // unresolved
  assert.ok(stoodBy.strip.coordination.lastStandByAt);

  const senderAfter = ctrBoard.getStrip(strip.stripId);
  assert.equal(senderAfter.coordination.state, 'INITIATED');
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
  }), 'AP', 'ap-controller');
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
// (flight-data-store.js's setField() already validated this field via WRITABLE_PATHS
// since docs/adr/0019 — the gap was purely that no Block ever routed a
// SetBlock at it; Block '5A' closes that.)

test('SetBlock on the new track-degradation Block (5A) round-trips through flight-data-store.js\'s existing setField validation', () => {
  const facilities = makeFacilities();
  const strip = createCtrStrip(facilities);
  const { boardStore } = facilities.get('CENTER');
  const result = boardStore.applyMutation(mutation({
    stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'SetBlock', blockId: '5A', value: 'CST' },
  }), 'CTR', 'ctr-controller');
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.flightData.identity.trackDegradationFlag, 'CST');
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
  }), 'AP', 'ap-controller');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
  assert.match(result.detail, /open coordination proposal/);

  // The peer's replica is untouched — still there, still PROPOSED.
  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const receiver = ctrBoard.getStrip(proposed.strip.coordination.peerStripId);
  assert.equal(receiver.state, 'HANDED_OFF');
  assert.equal(receiver.coordination.state, 'INITIATED');
});

test('the explicit DropStrip op is rejected the same way while a coordination proposal is open', () => {
  const facilities = makeFacilities();
  const senderStrip = createAppHandedOffStrip(facilities);
  const proposed = proposeFromApp(facilities, senderStrip);

  const { boardStore: appBoard } = facilities.get('INCIRLIK');
  const result = appBoard.applyMutation(mutation({
    stripId: proposed.strip.stripId, baseRev: proposed.strip.rev, op: { kind: 'DropStrip' },
  }), 'AP', 'ap-controller');
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
  }), 'AP', 'ap-controller');
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
  assert.equal(rejected.strip.bayId, 'ctr-ap-coordination'); // never moved out — still the replica's Bay

  const retried = ctrBoard.applyMutation(mutation({
    stripId: rejected.strip.stripId, baseRev: rejected.strip.rev,
    op: { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'AP' },
  }), 'CTR', 'ctr-controller');
  assert.equal(retried.ok, false);
  assert.equal(retried.reason, 'VALIDATION_ERROR');
  // Refused by `StripOps#dispatch`'s rejected-replica gate (F-303) before the
  // coordination-Bay check in board/coordination.js's `_applyCoordinationPropose` is ever reached.
  assert.match(retried.detail, /rejected — the replica is inert/);
});

// ── Bug found in live testing: DEPARTURE_STATE_OWNERS.HANDED_OFF only
// listed AP, so a CENTER-held HANDED_OFF replica — accepted or rejected
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

test('ConvertToArrival turns a HANDED_OFF DEPARTURE Strip into an INBOUND ARRIVAL Strip in place — same stripId, same flightDataId (so the same beacon code, trivially, never a duplicate)', () => {
  const facilities = makeFacilities();
  const strip = createAppHandedOffStrip(facilities);
  const { boardStore } = facilities.get('INCIRLIK');

  const converted = boardStore.applyMutation(mutation({
    stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'ConvertToArrival' },
  }), 'AP', 'ap-controller');

  assert.equal(converted.ok, true, JSON.stringify(converted));
  assert.equal(converted.strip.stripId, strip.stripId); // same Strip
  assert.equal(converted.strip.flightDataId, strip.flightDataId);     // same flight data — same beacon code, no copy needed
  assert.equal(converted.strip.stripType, 'ARRIVAL');
  assert.equal(converted.strip.state, 'INBOUND');
  assert.equal(converted.strip.bayId, 'ap-inbound');
  assert.equal(converted.strip.ownerPositionId, 'AP');

  // Only one Strip exists for this flight — not two.
  assert.equal(boardStore.getAll().filter(s => s.flightDataId === strip.flightDataId).length, 1);
});

// Bug found in live testing: DEPARTURE and ARRIVAL read DIFFERENT flight data
// fields for the same idea (departureAirport vs originAirport) — an
// in-place conversion that never touched the flight data left originAirport
// permanently blank even though departureAirport still held the value.
test('ConvertToArrival maps the departure record\'s departureAirport onto the new ARRIVAL Strip\'s originAirport, and returns the updated flightData so the client actually sees it', () => {
  const facilities = makeFacilities();
  const strip = createAppHandedOffStrip(facilities); // departureAirport: 'LTAG'
  const { boardStore } = facilities.get('INCIRLIK');
  const flightDataStore = boardStore._flightDataStore; // internal, test-only reach-in — mirrors other tests in this file

  const converted = boardStore.applyMutation(mutation({
    stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'ConvertToArrival' },
  }), 'AP', 'ap-controller');

  assert.equal(converted.ok, true, JSON.stringify(converted));
  assert.equal(converted.flightData.filed.originAirport, 'LTAG');
  assert.equal(converted.flightData.filed.departureAirport, 'LTAG'); // untouched, just no longer the field ARRIVAL reads
  assert.equal(flightDataStore.getFlightData(strip.flightDataId).filed.originAirport, 'LTAG'); // persisted, not just echoed in the result
});

test('ConvertToArrival resets annotations/flags/coordination to fresh-Strip defaults — none of them mean the same thing under the new role', () => {
  const facilities = makeFacilities();
  const { boardStore, positionStore } = facilities.get('INCIRLIK');
  positionStore.setSignedOnPositions('ap-controller', 'App1', ['AP']);
  const strip = createAppHandedOffStrip(facilities);
  const flagged = boardStore.applyMutation(mutation({
    stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'SetFlag', flag: 'attention', value: 'red' },
  }), 'AP', 'ap-controller');
  assert.equal(flagged.ok, true, JSON.stringify(flagged));

  const converted = boardStore.applyMutation(mutation({
    stripId: flagged.strip.stripId, baseRev: flagged.strip.rev, op: { kind: 'ConvertToArrival' },
  }), 'AP', 'ap-controller');
  assert.equal(converted.ok, true, JSON.stringify(converted));
  assert.deepEqual(converted.strip.annotations, {});
  assert.equal(converted.strip.flags.attention, null);
  assert.equal(converted.strip.coordination, null);
});

test('a Strip carries no correlation field at all — it is keyed by flightDataId, not stripId', () => {
  // This assertion used to read the other way: a per-Strip
  // `correlation: { state: 'UNCORRELATED' }` was set on creation and reset by
  // ConvertToArrival. Both were wrong, and docs/adr/0045 explains why — one
  // flight data legitimately has several Strips, so a per-Strip correlation lets two
  // replicas of one airframe disagree about which contact it is, and
  // ConvertToArrival threw away a correct binding for an aircraft that was
  // still airborne and still squawking the code docs/adr/0023 kept for it.
  const facilities = makeFacilities();
  const { boardStore, positionStore } = facilities.get('INCIRLIK');
  positionStore.setSignedOnPositions('ap-controller', 'App1', ['AP']);
  const strip = createAppHandedOffStrip(facilities);
  assert.equal('correlation' in strip, false, 'not set on creation');

  const converted = boardStore.applyMutation(mutation({
    stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'ConvertToArrival' },
  }), 'AP', 'ap-controller');
  assert.equal(converted.ok, true, JSON.stringify(converted));
  assert.equal('correlation' in converted.strip, false, 'and not written by a stripType change');
  assert.equal(converted.strip.flightDataId, strip.flightDataId, 'the same airframe, throughout');
});

test('a pre-WP5 snapshot’s per-Strip correlation field stops the restore (no quiet drop, ARCH-D5)', () => {
  const facilities = makeFacilities();
  const { boardStore } = facilities.get('INCIRLIK');
  assert.throws(() => boardStore.restore({
    strips: [{ stripId: 's1', flightDataId: 'f1', rev: 1, state: 'PROPOSED', correlation: { state: 'UNCORRELATED' } }],
    cidSeq: 3, replay: [], droppedWallAt: [],
  }), /Strip s1 still has the per-Strip "correlation" field/);
  assert.throws(() => boardStore.restore({ strips: [], cidSeq: 3 }), /not in the current shape/);
});

test('ConvertToArrival is rejected on anything other than a DEPARTURE Strip at HANDED_OFF', () => {
  const facilities = makeFacilities();
  const { boardStore, positionStore } = facilities.get('INCIRLIK');
  positionStore.setSignedOnPositions('ap-controller', 'App1', ['AP']);
  const created = boardStore.applyMutation(mutation({
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', flightData: { callsign: 'VIPER3', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250' } },
  }), 'OPS', 'ops-controller');
  // ap-coordination has no impliesState, so this transfer is never itself
  // treated as an advancing transition (see the D21-isolation test above
  // for the same pattern) — lands a still-PROPOSED DEPARTURE Strip at AP.
  const transferred = boardStore.applyMutation(mutation({
    stripId: created.strip.stripId, baseRev: created.strip.rev,
    op: { kind: 'TransferStrip', toPositionId: 'AP', bayId: 'ap-coordination', rackId: 'main' },
  }), 'OPS', 'ops-controller');
  assert.equal(transferred.ok, true, JSON.stringify(transferred));
  assert.equal(transferred.strip.state, 'PROPOSED'); // still not HANDED_OFF

  const result = boardStore.applyMutation(mutation({
    stripId: transferred.strip.stripId, baseRev: transferred.strip.rev, op: { kind: 'ConvertToArrival' },
  }), 'AP', 'ap-controller');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
});

test('D21 regression: LC may not ConvertToArrival even a Strip it happens to own — only AP/CTR ever get this op kind at all', () => {
  const facilities = makeFacilities();
  const { boardStore, positionStore } = facilities.get('INCIRLIK');
  positionStore.setSignedOnPositions('lc-controller', 'Twr1', ['LC']);
  const created = boardStore.applyMutation(mutation({
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', flightData: { callsign: 'VIPER4', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250' } },
  }), 'OPS', 'ops-controller');
  const setState = boardStore.applyMutation(mutation({
    stripId: created.strip.stripId, baseRev: created.strip.rev, op: { kind: 'SetState', toState: 'HANDED_OFF' },
  }), 'OPS', 'ops-controller');
  const transferred = boardStore.applyMutation(mutation({
    stripId: setState.strip.stripId, baseRev: setState.strip.rev,
    op: { kind: 'TransferStrip', toPositionId: 'LC', bayId: 'lc-coordination', rackId: 'main' },
  }), 'OPS', 'ops-controller');
  assert.equal(transferred.ok, true, JSON.stringify(transferred));

  const result = boardStore.applyMutation(mutation({
    stripId: transferred.strip.stripId, baseRev: transferred.strip.rev, op: { kind: 'ConvertToArrival' },
  }), 'LC', 'ops-controller');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PERMISSION_DENIED');
});

test('ConvertToArrival works identically at CTR (CENTER Facility) — a departure handed off from AP, then converted for its return leg', () => {
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
  assert.equal(converted.strip.stripType, 'ARRIVAL');
  assert.equal(converted.strip.state, 'INBOUND');
  assert.equal(converted.strip.bayId, 'ctr-enroute');
  assert.equal(converted.strip.flightDataId, senderStrip.flightDataId); // same flight data, all the way through both the HANDOFF and the conversion
});
