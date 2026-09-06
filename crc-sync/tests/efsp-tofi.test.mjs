import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// WP4A second slice — TOFI (guide §4.6.3), the ATC<->MRU sub-protocol.
// Same three-Facility, fully-wired composition-root pattern
// efsp-board-store-coordination.test.mjs uses for the 5 ATC<->ATC
// primitives, extended with TACTICAL.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-tofi-test-'));
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH = path.join(tmpDir, 'incirlik.json');
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER = path.join(tmpDir, 'center.json');
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL = path.join(tmpDir, 'tactical.json');

const { BoardStore } = await import('../src/efsp/board-store.js');
const { FdrStore } = await import('../src/efsp/fdr-store.js');
const { PositionStore } = await import('../src/efsp/position-store.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const blockMap = await import('../src/efsp/block-map.js');
const nla = await import('../src/efsp/nla.js');
const permission = await import('../src/efsp/permission.js');
const coordination = await import('../src/efsp/coordination.js');

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
      coordinationEligibleState: (role) => coordination.coordinationEligibleState(role),
      tofiCounterparts: (actingPositionId) => permission.tofiCounterparts(actingPositionId),
    };
    const boardStore = new BoardStore(fdrStore, rules);
    facilities.set(facilityId, { boardStore, positionStore });
  }
  return facilities;
}

function mutation(overrides = {}) {
  return { clientMutationId: crypto.randomUUID(), stripId: null, baseRev: null, op: {}, ...overrides };
}

/** CTR originates an ARRIVAL Strip locally — the ATC-side Strip TOFI will be proposed from. */
function createCtrStrip(facilities) {
  const { boardStore } = facilities.get('CENTER');
  const result = boardStore.applyMutation(mutation({
    op: {
      kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main',
      fdr: { callsign: 'EAGLE1', aircraftType: 'F15', wakeCategory: 'D', originAirport: 'LTAC', estimatedArrivalTimeUtc: Date.now() + 20 * 60 * 1000 },
      role: 'ARRIVAL',
    },
  }), 'CTR', 'ctr-controller');
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.strip;
}

function proposeEntry(facilities, strip, overrides = {}) {
  const { boardStore } = facilities.get('CENTER');
  return boardStore.applyMutation(mutation({
    stripId: strip.stripId, baseRev: strip.rev,
    op: { kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2', ...overrides },
  }), 'CTR', 'ctr-controller');
}

/** Full ENTRY exchange: CTR proposes, TAC_C2 accepts. Returns { atcStrip, missionStrip }. */
function completeEntry(facilities) {
  const atcStrip0 = createCtrStrip(facilities);
  const proposed = proposeEntry(facilities, atcStrip0);
  assert.equal(proposed.ok, true, JSON.stringify(proposed));
  const missionStripId = proposed.strip.tofiCoordination.peerStripId;

  const { boardStore: tacBoard } = facilities.get('TACTICAL');
  const missionBefore = tacBoard.getStrip(missionStripId);
  const accepted = tacBoard.applyMutation(mutation({
    stripId: missionStripId, baseRev: missionBefore.rev,
    op: { kind: 'TOFI', action: 'ACCEPT' },
  }), 'TAC_C2', 'tac-c2-controller');
  assert.equal(accepted.ok, true, JSON.stringify(accepted));

  const { boardStore: ctrBoard } = facilities.get('CENTER');
  return { atcStrip: ctrBoard.getStrip(atcStrip0.stripId), missionStrip: accepted.strip };
}

// ── PROPOSE (ENTRY) mints a real MISSION Strip sharing the ATC Strip's FDR ──

test('TOFI ENTRY PROPOSE mints a brand-new MISSION Strip on TACTICAL\'s own Board, sharing the ATC-side Strip\'s fdrId (guide §9.8\'s binding)', () => {
  const facilities = makeFacilities();
  const atcStrip = createCtrStrip(facilities);
  const proposed = proposeEntry(facilities, atcStrip);

  assert.equal(proposed.ok, true, JSON.stringify(proposed));
  assert.equal(proposed.strip.tofiCoordination.direction, 'ENTRY');
  assert.equal(proposed.strip.tofiCoordination.state, 'PROPOSED');
  assert.equal(proposed.strip.tofiCoordination.peerFacilityId, 'TACTICAL');
  assert.equal(proposed.strip.tofiCoordination.peerPositionId, 'TAC_C2');

  const missionStripId = proposed.strip.tofiCoordination.peerStripId;
  assert.notEqual(missionStripId, atcStrip.stripId);

  const { boardStore: tacBoard } = facilities.get('TACTICAL');
  const missionStrip = tacBoard.getStrip(missionStripId);
  assert.ok(missionStrip);
  assert.equal(missionStrip.role, 'MISSION');
  assert.equal(missionStrip.state, 'TASKED');
  assert.equal(missionStrip.ownerPositionId, 'TAC_C2');
  assert.equal(missionStrip.bayId, 'tac-c2-coordination');
  assert.equal(missionStrip.fdrId, atcStrip.fdrId); // shared FDR, not a fresh one
  assert.equal(missionStrip.tofiCoordination.direction, 'ENTRY');
  assert.equal(missionStrip.tofiCoordination.state, 'PROPOSED');
  assert.equal(missionStrip.tofiCoordination.peerStripId, atcStrip.stripId);
  assert.equal(missionStrip.tofiCoordination.peerFacilityId, 'CENTER');
});

test('a second ENTRY PROPOSE while one is already open is rejected', () => {
  const facilities = makeFacilities();
  const atcStrip = createCtrStrip(facilities);
  proposeEntry(facilities, atcStrip);
  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const atcNow = ctrBoard.getStrip(atcStrip.stripId);
  const second = proposeEntry(facilities, atcNow);
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'VALIDATION_ERROR');
});

test('guide §4.6 rule 5: a degraded track forces verbal coordination — ENTRY PROPOSE is rejected without a note, accepted with one', () => {
  const facilities = makeFacilities();
  const atcStrip = createCtrStrip(facilities);
  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const flagged = ctrBoard.applyMutation(mutation({
    stripId: atcStrip.stripId, baseRev: atcStrip.rev, op: { kind: 'SetBlock', blockId: '5A', value: 'CST' },
  }), 'CTR', 'ctr-controller');
  assert.equal(flagged.ok, true, JSON.stringify(flagged));

  const withoutNote = proposeEntry(facilities, flagged.strip);
  assert.equal(withoutNote.ok, false);
  assert.equal(withoutNote.reason, 'VALIDATION_ERROR');

  const withNote = proposeEntry(facilities, flagged.strip, { note: 'verbally coordinated on GUARD' });
  assert.equal(withNote.ok, true, JSON.stringify(withNote));
  assert.equal(withNote.strip.tofiCoordination.note, 'verbally coordinated on GUARD');
});

test('PROPOSE with an invalid TOFI counterpart is rejected (defense in depth beyond the picker UI)', () => {
  const facilities = makeFacilities();
  const atcStrip = createCtrStrip(facilities);
  const result = proposeEntry(facilities, atcStrip, { toPositionId: 'JTAC' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
});

// ── ACCEPT (ENTRY) ────────────────────────────────────────────────────────

test('ENTRY ACCEPT relocates the MISSION Strip out of the Coordination Bay into its normal working Bay, sets both sides ACTIVE', () => {
  const facilities = makeFacilities();
  const { atcStrip, missionStrip } = completeEntry(facilities);

  assert.equal(missionStrip.bayId, 'tac-c2-tasked');
  assert.equal(missionStrip.tofiCoordination.state, 'ACTIVE');
  assert.equal(atcStrip.tofiCoordination.state, 'ACTIVE');
});

test('guide rule 2: the ATC-side Strip stays live — DropStrip is rejected outright while tactical control is ACTIVE, on EITHER side', () => {
  const facilities = makeFacilities();
  const { atcStrip, missionStrip } = completeEntry(facilities);

  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const dropAtc = ctrBoard.applyMutation(mutation({
    stripId: atcStrip.stripId, baseRev: atcStrip.rev, op: { kind: 'DropStrip' },
  }), 'CTR', 'ctr-controller');
  assert.equal(dropAtc.ok, false);
  assert.equal(dropAtc.reason, 'VALIDATION_ERROR');

  const { boardStore: tacBoard } = facilities.get('TACTICAL');
  const dropMission = tacBoard.applyMutation(mutation({
    stripId: missionStrip.stripId, baseRev: missionStrip.rev, op: { kind: 'DropStrip' },
  }), 'TAC_C2', 'tac-c2-controller');
  assert.equal(dropMission.ok, false);
  assert.equal(dropMission.reason, 'VALIDATION_ERROR');
});

// ── TRANSFER_COMMS — a distinct action from ACCEPT ───────────────────────

test('TRANSFER_COMMS is a separate action from ACCEPT, mirrored to the peer, and cannot fire twice', () => {
  const facilities = makeFacilities();
  const { atcStrip, missionStrip } = completeEntry(facilities);
  assert.equal(atcStrip.tofiCoordination.commsTransferred, false);
  assert.equal(missionStrip.tofiCoordination.commsTransferred, false);

  const { boardStore: tacBoard } = facilities.get('TACTICAL');
  const transferred = tacBoard.applyMutation(mutation({
    stripId: missionStrip.stripId, baseRev: missionStrip.rev, op: { kind: 'TOFI', action: 'TRANSFER_COMMS' },
  }), 'TAC_C2', 'tac-c2-controller');
  assert.equal(transferred.ok, true, JSON.stringify(transferred));
  assert.equal(transferred.strip.tofiCoordination.commsTransferred, true);

  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const atcAfter = ctrBoard.getStrip(atcStrip.stripId);
  assert.equal(atcAfter.tofiCoordination.commsTransferred, true);

  const secondAttempt = tacBoard.applyMutation(mutation({
    stripId: transferred.strip.stripId, baseRev: transferred.strip.rev, op: { kind: 'TOFI', action: 'TRANSFER_COMMS' },
  }), 'TAC_C2', 'tac-c2-controller');
  assert.equal(secondAttempt.ok, false);
});

// ── EXIT — the safety-critical direction (rule 3) ────────────────────────

test('EXIT PROPOSE re-enters the SAME MISSION Strip\'s link — never mints a new Strip', () => {
  const facilities = makeFacilities();
  const { atcStrip } = completeEntry(facilities);
  const missionStripId = atcStrip.tofiCoordination.peerStripId;

  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const exitProposed = ctrBoard.applyMutation(mutation({
    stripId: atcStrip.stripId, baseRev: atcStrip.rev,
    op: { kind: 'TOFI', action: 'PROPOSE', direction: 'EXIT' },
  }), 'CTR', 'ctr-controller');
  assert.equal(exitProposed.ok, true, JSON.stringify(exitProposed));
  assert.equal(exitProposed.strip.tofiCoordination.direction, 'EXIT');
  assert.equal(exitProposed.strip.tofiCoordination.state, 'PROPOSED');
  assert.equal(exitProposed.strip.tofiCoordination.peerStripId, missionStripId); // unchanged — same link

  const { boardStore: tacBoard } = facilities.get('TACTICAL');
  const missionAfterExitPropose = tacBoard.getStrip(missionStripId);
  assert.equal(missionAfterExitPropose.tofiCoordination.direction, 'EXIT');
  assert.equal(missionAfterExitPropose.tofiCoordination.state, 'PROPOSED');
});

test('rule 3: EXIT ACCEPT is refused unless separation_regime has already been set back to ATC — a hard precondition, never auto-derived', () => {
  const facilities = makeFacilities();
  const { atcStrip } = completeEntry(facilities);
  const missionStripId = atcStrip.tofiCoordination.peerStripId;

  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const exitProposed = ctrBoard.applyMutation(mutation({
    stripId: atcStrip.stripId, baseRev: atcStrip.rev,
    op: { kind: 'TOFI', action: 'PROPOSE', direction: 'EXIT' },
  }), 'CTR', 'ctr-controller');

  const { boardStore: tacBoard } = facilities.get('TACTICAL');
  const missionBefore = tacBoard.getStrip(missionStripId);

  // No separation_regime set yet — ACCEPT must be refused.
  const acceptDenied = tacBoard.applyMutation(mutation({
    stripId: missionStripId, baseRev: missionBefore.rev, op: { kind: 'TOFI', action: 'ACCEPT' },
  }), 'TAC_C2', 'tac-c2-controller');
  assert.equal(acceptDenied.ok, false);
  assert.equal(acceptDenied.reason, 'VALIDATION_ERROR');

  // Controller explicitly sets separation_regime back to ATC via the Block.
  const setRegime = ctrBoard.applyMutation(mutation({
    stripId: exitProposed.strip.stripId, baseRev: exitProposed.strip.rev,
    op: { kind: 'SetBlock', blockId: 'SREG', value: 'ATC' },
  }), 'CTR', 'ctr-controller');
  assert.equal(setRegime.ok, true, JSON.stringify(setRegime));
  assert.equal(setRegime.fdr.tofi.separationRegime, 'ATC');

  const acceptAllowed = tacBoard.applyMutation(mutation({
    stripId: missionStripId, baseRev: tacBoard.getStrip(missionStripId).rev, op: { kind: 'TOFI', action: 'ACCEPT' },
  }), 'TAC_C2', 'tac-c2-controller');
  assert.equal(acceptAllowed.ok, true, JSON.stringify(acceptAllowed));
  assert.equal(acceptAllowed.strip.tofiCoordination.state, 'COMPLETE');

  const atcAfter = ctrBoard.getStrip(atcStrip.stripId);
  assert.equal(atcAfter.tofiCoordination.state, 'COMPLETE');
});

test('after EXIT COMPLETEs, DropStrip is allowed again on the ATC-side Strip', () => {
  const facilities = makeFacilities();
  const { atcStrip } = completeEntry(facilities);
  const missionStripId = atcStrip.tofiCoordination.peerStripId;
  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const { boardStore: tacBoard } = facilities.get('TACTICAL');

  ctrBoard.applyMutation(mutation({
    stripId: atcStrip.stripId, baseRev: atcStrip.rev, op: { kind: 'TOFI', action: 'PROPOSE', direction: 'EXIT' },
  }), 'CTR', 'ctr-controller');
  const atcMid = ctrBoard.getStrip(atcStrip.stripId);
  ctrBoard.applyMutation(mutation({
    stripId: atcMid.stripId, baseRev: atcMid.rev, op: { kind: 'SetBlock', blockId: 'SREG', value: 'ATC' },
  }), 'CTR', 'ctr-controller');
  tacBoard.applyMutation(mutation({
    stripId: missionStripId, baseRev: tacBoard.getStrip(missionStripId).rev, op: { kind: 'TOFI', action: 'ACCEPT' },
  }), 'TAC_C2', 'tac-c2-controller');

  const atcFinal = ctrBoard.getStrip(atcStrip.stripId);
  const dropped = ctrBoard.applyMutation(mutation({
    stripId: atcFinal.stripId, baseRev: atcFinal.rev, op: { kind: 'DropStrip' },
  }), 'CTR', 'ctr-controller');
  assert.equal(dropped.ok, true, JSON.stringify(dropped));
});

// ── REJECT ────────────────────────────────────────────────────────────────

test('REJECT marks both sides REJECTED and does not relocate the MISSION Strip', () => {
  const facilities = makeFacilities();
  const atcStrip = createCtrStrip(facilities);
  const proposed = proposeEntry(facilities, atcStrip);
  const missionStripId = proposed.strip.tofiCoordination.peerStripId;

  const { boardStore: tacBoard } = facilities.get('TACTICAL');
  const missionBefore = tacBoard.getStrip(missionStripId);
  const rejected = tacBoard.applyMutation(mutation({
    stripId: missionStripId, baseRev: missionBefore.rev, op: { kind: 'TOFI', action: 'REJECT' },
  }), 'TAC_C2', 'tac-c2-controller');
  assert.equal(rejected.ok, true, JSON.stringify(rejected));
  assert.equal(rejected.strip.tofiCoordination.state, 'REJECTED');
  assert.equal(rejected.strip.bayId, 'tac-c2-coordination'); // never moved

  const { boardStore: ctrBoard } = facilities.get('CENTER');
  const atcAfter = ctrBoard.getStrip(atcStrip.stripId);
  assert.equal(atcAfter.tofiCoordination.state, 'REJECTED');
});

// ── D12 at the dispatch level — not merely a permission.js unit test ─────

test('D12, end-to-end through applyMutation: a HANDOFF attempted by TAC_C2 is rejected with PERMISSION_DENIED, even on a Strip TAC_C2 legitimately owns', () => {
  const facilities = makeFacilities();
  const { missionStrip } = completeEntry(facilities);
  const { boardStore: tacBoard } = facilities.get('TACTICAL');
  const result = tacBoard.applyMutation(mutation({
    stripId: missionStrip.stripId, baseRev: missionStrip.rev,
    op: { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' },
  }), 'TAC_C2', 'tac-c2-controller');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PERMISSION_DENIED');
});

// ── MISSION's own independent lifecycle continues normally ───────────────

test('the MISSION Strip advances through its own lifecycle via ordinary InvokeNla, independent of the TOFI exchange state', () => {
  const facilities = makeFacilities();
  const { missionStrip } = completeEntry(facilities);
  const { boardStore: tacBoard } = facilities.get('TACTICAL');
  const advanced = tacBoard.applyMutation(mutation({
    stripId: missionStrip.stripId, baseRev: missionStrip.rev, op: { kind: 'InvokeNla' },
  }), 'TAC_C2', 'tac-c2-controller');
  assert.equal(advanced.ok, true, JSON.stringify(advanced));
  assert.equal(advanced.strip.state, 'AIRBORNE');
});
