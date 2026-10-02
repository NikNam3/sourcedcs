import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// docs/adr/0102 — the separation regime picked at TOFI ENTRY accept is pending until the flight is inside an airspace
// active for the MRU, or the MRU marks it entered.
// Same three-Facility, fully-wired composition-root pattern
// efsp-board-store-coordination.test.mjs uses for the 5 ATC<->ATC
// primitives, extended with TACTICAL.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tofi-regime-test-'));
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH = path.join(tmpDir, 'incirlik.json');
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER = path.join(tmpDir, 'center.json');
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL = path.join(tmpDir, 'tactical.json');

const { BoardStore } = await import('../src/efsp/board-store.js');
import { fullRules } from "./helpers/full-rules.mjs";
const { FlightDataStore } = await import('../src/efsp/flight-data-store.js');
const { PositionStore } = await import('../src/efsp/position-store.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const blockMap = await import('../src/efsp/block-map.js');
const nla = await import('../src/efsp/nla.js');
const permission = await import('../src/efsp/permission.js');
const { UndoHistory, undoEnv } = await import('../src/efsp/undo/undo-history.js');
const coordination = await import('../src/efsp/coordination.js');

// docs/adr/0102: where the flight is, for accept and MARK_ENTERED. Outside by default.
let LOCATION = { located: false, inside: [], unknown: [] };
const INSIDE = { located: true, inside: [{ airspaceId: 'MOA-1', kind: 'AREA', name: 'MOA' }], unknown: [] };

// docs/adr/0100: one undo history for the three Boards, timed by this wall clock.
let WALL_NOW = 1_000_000;

function makeFacilities() {
  LOCATION = { located: false, inside: [], unknown: [] };
  WALL_NOW = 1_000_000;
  const flightDataStore = new FlightDataStore();
  const facilities = new Map();
  const undoHistory = new UndoHistory({ wallClock: { now: () => WALL_NOW } });
  undoHistory.attach(undoEnv({ boardFor: (id) => { const x = facilities.get(id); return x ? x.boardStore : null; }, flightDataStore }));
  flightDataStore.setWriteObserver((id, paths) => undoHistory.observe({ kind: 'flightData', id, paths }));

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
      canMutate: (actingPositionId, opKind) => permission.canMutate(actingPositionId, opKind),
      canCreateStripType: (actingPositionId, stripType) => permission.canCreateStripType(actingPositionId, stripType),
      canActOnState: (actingPositionId, stripType, state) => permission.canActOnState(actingPositionId, stripType, state),
      isSelfCoordinated: (controllerId, id) => positionStore.isSelfCoordinated(controllerId, id),
      facilityId,
      regimeLocation: () => LOCATION,
      peerBoard: (otherFacilityId) => {
        const other = facilities.get(otherFacilityId);
        return other ? other.boardStore : null;
      },
      coordinationEffect: (primitive) => coordination.coordinationEffect(primitive),
      coordinationEligibleState: (stripType) => coordination.coordinationEligibleState(stripType),
      tofiCounterparts: (actingPositionId) => permission.tofiCounterparts(actingPositionId),
      // Wired as of the mission-line slice. It was absent, and
      // the `if (rules.tofiEligibleState)` guard then in the Board meant
      // docs/adr/0031's (stripType, state) gate was SILENTLY SKIPPED across this
      // entire file — the one place TOFI is tested most densely. 0031's own
      // Consequences blessed the omission while nothing depended on the gate
      // being real; find-before-mint does, so it stops being defensible.
      tofiEligibleState: (stripType) => coordination.tofiEligibleState(stripType),
      // Needed by _releaseFlightDataIfLastStrip once one flight data legitimately carries
      // several Strips. Absent here too, so the beacon-release refcount was
      // reading `0` for every Strip in this file.
      liveStripsForFlightData: (flightDataId, excludeStripId) => {
        let n = 0;
        for (const { boardStore } of facilities.values()) {
          for (const s of boardStore.getAll()) {
            if (s.flightDataId === flightDataId && s.stripId !== excludeStripId && s.state !== 'DROPPED') n++;
          }
        }
        return n;
      },
    };
    const boardStore = new BoardStore(flightDataStore, fullRules(rules), { undoHistory });
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
      flightData: { callsign: 'EAGLE1', aircraftType: 'F15', wakeCategory: 'D', originAirport: 'LTAC', estimatedArrivalTimeUtc: Date.now() + 20 * 60 * 1000 },
      stripType: 'ARRIVAL',
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
    // Taking tactical control now requires saying under which regime
    // (docs/adr/0053) — it comes from the governing agreement, so the MRU
    // controller states it rather than the system deriving it.
    op: { kind: 'TOFI', action: 'ACCEPT', separationRegime: 'MARSA' },
  }), 'TAC_C2', 'tac-c2-controller');
  assert.equal(accepted.ok, true, JSON.stringify(accepted));

  const { boardStore: ctrBoard } = facilities.get('CENTER');
  return { atcStrip: ctrBoard.getStrip(atcStrip0.stripId), missionStrip: accepted.strip };
}


const { evaluateRegime, TofiRegimeMonitor } = await import('../src/efsp/tofi-regime-monitor.js');
const readScope = await import('../src/efsp/read-scope.js');

function logTo(facilities) {
  const entries = [];
  for (const { boardStore } of facilities.values()) boardStore.setMutationLog({ record: (e) => entries.push(e) });
  return entries;
}

function propose(facilities) {
  const atc = createCtrStrip(facilities);
  const proposed = proposeEntry(facilities, atc);
  assert.equal(proposed.ok, true, JSON.stringify(proposed));
  return { atcId: atc.stripId, missionId: proposed.strip.tofiCoordination.peerStripId, flightDataId: atc.flightDataId };
}
function tac(facilities) { return facilities.get('TACTICAL').boardStore; }
function act(facilities, missionId, op) {
  const b = tac(facilities);
  return b.applyMutation(mutation({ stripId: missionId, baseRev: b.getStrip(missionId).rev, op }), 'TAC_C2', 'tac-c2-controller');
}
function accept(facilities, missionId, separationRegime) {
  return act(facilities, missionId, { kind: 'TOFI', action: 'ACCEPT', separationRegime });
}
const tofiOf = (facilities, id) => facilities.get('CENTER').boardStore._flightDataStore.getFlightData(id).tofi;

// ── ACCEPT ───────────────────────────────────────────────────────────────

test('ACCEPT with ATC writes ATC and leaves nothing pending', () => {
  const f = makeFacilities(); const p = propose(f);
  const r = accept(f, p.missionId, 'ATC');
  assert.equal(r.ok, true, JSON.stringify(r));
  const t = tofiOf(f, p.flightDataId);
  assert.equal(t.separationRegime, 'ATC'); assert.equal(t.pendingSeparationRegime, null); assert.equal(t.regimeEffective, null);
});

test('ACCEPT with a non-ATC regime outside any airspace: ATC stays effective, the pick is pending for the accepting MRU', () => {
  const f = makeFacilities(); const p = propose(f);
  const r = accept(f, p.missionId, 'DUE_REGARD');
  assert.equal(r.ok, true);
  const t = tofiOf(f, p.flightDataId);
  assert.equal(t.separationRegime, 'ATC');
  assert.equal(t.pendingSeparationRegime, 'DUE_REGARD');
  assert.equal(t.pendingFacilityId, 'TACTICAL');
  assert.equal(typeof t.pendingSince, 'number');
  assert.equal(r.flightData.tofi.pendingSeparationRegime, 'DUE_REGARD', 'the ack carries it');
});

test('ACCEPT with a non-ATC regime while already inside an active airspace: effective at accept, trigger AIRSPACE, audited', () => {
  const f = makeFacilities(); const log = logTo(f); const p = propose(f);
  LOCATION = INSIDE;
  const r = accept(f, p.missionId, 'USING_AGENCY');
  assert.equal(r.ok, true);
  const t = tofiOf(f, p.flightDataId);
  assert.equal(t.separationRegime, 'USING_AGENCY'); assert.equal(t.pendingSeparationRegime, null);
  assert.equal(t.regimeEffective.trigger, 'AIRSPACE'); assert.equal(t.regimeEffective.airspaceId, 'MOA-1'); assert.equal(t.regimeEffective.facilityId, 'TACTICAL');
  const entry = log.find(e => e.op === 'TOFI' && e.action === 'ACCEPT');
  assert.deepEqual(entry.tofiRegime, { trigger: 'AIRSPACE', airspaceId: 'MOA-1', regime: 'USING_AGENCY', warning: null });
});

test('ACCEPT under an active MARSA relation is refused for a conflicting regime and writes no pending', () => {
  const f = makeFacilities(); const p = propose(f);
  for (const { boardStore } of f.values()) boardStore._rules.activeMarsaFor = () => ({ declaringCallsign: 'TEXACO1' });
  const r = accept(f, p.missionId, 'DUE_REGARD');
  assert.equal(r.ok, false);
  assert.equal(tofiOf(f, p.flightDataId).pendingSeparationRegime, null);
  const ok = accept(f, p.missionId, 'MARSA');
  assert.equal(ok.ok, true);
  assert.equal(tofiOf(f, p.flightDataId).pendingSeparationRegime, null, 'the relation owns the regime');
});

// ── MARK_ENTERED ─────────────────────────────────────────────────────────

test('MARK_ENTERED inside an active airspace: effective, trigger MANUAL, no warning, one audit entry', () => {
  const f = makeFacilities(); const log = logTo(f); const p = propose(f);
  accept(f, p.missionId, 'MARSA');
  LOCATION = INSIDE;
  const r = act(f, p.missionId, { kind: 'TOFI', action: 'MARK_ENTERED' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.warning, undefined);
  const t = tofiOf(f, p.flightDataId);
  assert.equal(t.separationRegime, 'MARSA'); assert.equal(t.pendingSeparationRegime, null);
  assert.equal(t.regimeEffective.trigger, 'MANUAL'); assert.equal(t.regimeEffective.airspaceId, 'MOA-1');
  const entries = log.filter(e => e.op === 'TOFI' && e.action === 'MARK_ENTERED');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].tofiRegime.trigger, 'MANUAL');
});

test('MARK_ENTERED without a containing airspace is allowed with the warning NOT_IN_ACTIVE_AIRSPACE, in the result and the audit', () => {
  const f = makeFacilities(); const log = logTo(f); const p = propose(f);
  accept(f, p.missionId, 'MARSA');
  const r = act(f, p.missionId, { kind: 'TOFI', action: 'MARK_ENTERED' });
  assert.equal(r.ok, true);
  assert.equal(r.warning, 'NOT_IN_ACTIVE_AIRSPACE');
  assert.equal(tofiOf(f, p.flightDataId).separationRegime, 'MARSA');
  assert.equal(tofiOf(f, p.flightDataId).regimeEffective.airspaceId, null);
  assert.equal(log.find(e => e.action === 'MARK_ENTERED').tofiRegime.warning, 'NOT_IN_ACTIVE_AIRSPACE');
});

test('MARK_ENTERED twice is refused; with ATC picked there is nothing to mark; the ATC side cannot mark', () => {
  const f = makeFacilities(); const p = propose(f);
  accept(f, p.missionId, 'MARSA');
  assert.equal(act(f, p.missionId, { kind: 'TOFI', action: 'MARK_ENTERED' }).ok, true);
  const again = act(f, p.missionId, { kind: 'TOFI', action: 'MARK_ENTERED' });
  assert.equal(again.ok, false); assert.match(again.detail, /already effective|waiting/);

  const f2 = makeFacilities(); const p2 = propose(f2);
  accept(f2, p2.missionId, 'ATC');
  assert.equal(act(f2, p2.missionId, { kind: 'TOFI', action: 'MARK_ENTERED' }).ok, false);

  const f3 = makeFacilities(); const p3 = propose(f3);
  accept(f3, p3.missionId, 'MARSA');
  const ctr = f3.get('CENTER').boardStore;
  const refused = ctr.applyMutation(mutation({ stripId: p3.atcId, baseRev: ctr.getStrip(p3.atcId).rev, op: { kind: 'TOFI', action: 'MARK_ENTERED' } }), 'CTR', 'ctr-controller');
  assert.equal(refused.ok, false);
  assert.equal(tofiOf(f3, p3.flightDataId).pendingSeparationRegime, 'MARSA');
});

const undoOf = (ack) => ({ kind: 'Undo', actionId: ack.undoable.actionId });
/** An Undo restores through staffed Positions (docs/adr/0100 "validate, then apply"). */
function staffTactical(f) {
  const ps = f.get('TACTICAL').positionStore;
  ps.setSignedOnPositions('tac-c2-controller', 'TAC C2', ['TAC_C2']);
  ps.setSignedOnPositions('jtac-controller', 'JTAC', ['JTAC']);
}

test('MARK_ENTERED is undoable within 10 s: pending is back and the effective stamp is gone (H95, DR-5 a)', () => {
  const f = makeFacilities(); const p = propose(f);
  accept(f, p.missionId, 'MARSA');
  staffTactical(f);
  const before = { ...tofiOf(f, p.flightDataId) };
  assert.equal(before.pendingSeparationRegime, 'MARSA');
  const marked = act(f, p.missionId, { kind: 'TOFI', action: 'MARK_ENTERED' });
  assert.equal(marked.ok, true, JSON.stringify(marked));
  assert.match(marked.undoable.label, /^Mark entered EAGLE1$/);
  assert.equal(tofiOf(f, p.flightDataId).separationRegime, 'MARSA');
  WALL_NOW += 9_000;
  const undone = act(f, p.missionId, undoOf(marked));
  assert.equal(undone.ok, true, JSON.stringify(undone));
  const t = tofiOf(f, p.flightDataId);
  assert.equal(t.separationRegime, 'ATC'); assert.equal(t.pendingSeparationRegime, 'MARSA');
  assert.equal(t.pendingFacilityId, before.pendingFacilityId); assert.equal(t.pendingSince, before.pendingSince);
  assert.equal(t.regimeEffective, null);
});

test('MARK_ENTERED: at 10 s the answer is UNDO_UNAVAILABLE, and another Position cannot undo it', () => {
  const f = makeFacilities(); const p = propose(f);
  accept(f, p.missionId, 'MARSA');
  staffTactical(f);
  const marked = act(f, p.missionId, { kind: 'TOFI', action: 'MARK_ENTERED' });
  const b = tac(f);
  const other = b.applyMutation(mutation({ stripId: p.missionId, baseRev: b.getStrip(p.missionId).rev, op: undoOf(marked) }), 'JTAC', 'jtac-controller');
  assert.equal(other.ok, false); assert.notEqual(other.reason, 'UNDO_UNAVAILABLE');
  assert.equal(tofiOf(f, p.flightDataId).separationRegime, 'MARSA', 'nothing changed');
  WALL_NOW += 10_000;
  const late = act(f, p.missionId, undoOf(marked));
  assert.equal(late.ok, false); assert.equal(late.reason, 'UNDO_UNAVAILABLE');
  assert.equal(tofiOf(f, p.flightDataId).separationRegime, 'MARSA');
});

test('the other TOFI answers (ACCEPT, REJECT, TRANSFER_COMMS) are not undoable', () => {
  const f = makeFacilities(); const p = propose(f);
  const accepted = accept(f, p.missionId, 'MARSA');
  assert.equal(accepted.ok, true); assert.equal(accepted.undoable, undefined);
});

test('the monitor\'s automatic entry blocks no open undo of the same flight', () => {
  const f = makeFacilities(); const p = propose(f);
  accept(f, p.missionId, 'MARSA');
  staffTactical(f);
  const b = tac(f); const strip = b.getStrip(p.missionId);
  const move = b.applyMutation(mutation({ stripId: p.missionId, baseRev: strip.rev, op: { kind: 'MoveStrip', bayId: strip.bayId, rackId: strip.rackId, beforeStripId: null, afterStripId: null } }), 'TAC_C2', 'tac-c2-controller');
  assert.equal(move.ok, true, JSON.stringify(move));
  assert.ok(move.undoable, 'the move is undoable before the monitor acts');
  const { monitor } = monitorFor(f);
  LOCATION = INSIDE;
  monitor.tick(1000, 1000); monitor.tick(2000, 2000);
  assert.equal(tofiOf(f, p.flightDataId).regimeEffective.trigger, 'AIRSPACE');
  assert.equal(b.undoHistory.recordOf(move.undoable.actionId).blockedBy, null, 'the monitor writes observed paths');
  const undone = act(f, p.missionId, undoOf(move));
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.equal(tofiOf(f, p.flightDataId).separationRegime, 'MARSA', 'the automatic entry stands');
});

// ── SREG, EXIT, REJECT ───────────────────────────────────────────────────

test('SREG before entry replaces the pending regime; ATC clears it; after entry it writes the effective regime as before', () => {
  const f = makeFacilities(); const p = propose(f);
  accept(f, p.missionId, 'MARSA');
  const sreg = (value, ff = f, pp = p) => { const b = ff.get('CENTER').boardStore; return b.applyMutation(mutation({ stripId: pp.atcId, baseRev: b.getStrip(pp.atcId).rev, op: { kind: 'SetBlock', blockId: 'SREG', value } }), 'CTR', 'ctr-controller'); };
  assert.equal(sreg('DUE_REGARD').ok, true);
  let t = tofiOf(f, p.flightDataId);
  assert.equal(t.pendingSeparationRegime, 'DUE_REGARD'); assert.equal(t.separationRegime, 'ATC');
  assert.equal(sreg('ATC').ok, true);
  t = tofiOf(f, p.flightDataId);
  assert.equal(t.pendingSeparationRegime, null); assert.equal(t.separationRegime, 'ATC');

  const g = makeFacilities(); const q = propose(g);
  accept(g, q.missionId, 'MARSA');
  act(g, q.missionId, { kind: 'TOFI', action: 'MARK_ENTERED' });
  assert.equal(sreg('SEE_AND_AVOID', g, q).ok, true);
  t = tofiOf(g, q.flightDataId);
  assert.equal(t.separationRegime, 'SEE_AND_AVOID'); assert.equal(t.pendingSeparationRegime, null);
  sreg('ATC', g, q);
  assert.equal(tofiOf(g, q.flightDataId).regimeEffective, null, 'back to ATC drops the entry stamp');
});

test('EXIT while the regime is still pending passes the SREG gate and clears the pending regime', () => {
  const f = makeFacilities(); const p = propose(f);
  accept(f, p.missionId, 'MARSA');
  const ctr = f.get('CENTER').boardStore;
  const exit = ctr.applyMutation(mutation({ stripId: p.atcId, baseRev: ctr.getStrip(p.atcId).rev, op: { kind: 'TOFI', action: 'PROPOSE', direction: 'EXIT' } }), 'CTR', 'ctr-controller');
  assert.equal(exit.ok, true, JSON.stringify(exit));
  const r = act(f, p.missionId, { kind: 'TOFI', action: 'ACCEPT' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.strip.tofiCoordination.state, 'COMPLETE');
  const t = tofiOf(f, p.flightDataId);
  assert.equal(t.pendingSeparationRegime, null); assert.equal(t.pendingSince, null);
  assert.equal(r.flightData.tofi.pendingSeparationRegime, null, 'the ack carries the cleared record');
});

test('REJECT of an ENTRY leaves no pending regime', () => {
  const f = makeFacilities(); const p = propose(f);
  const r = act(f, p.missionId, { kind: 'TOFI', action: 'REJECT' });
  assert.equal(r.ok, true);
  assert.equal(tofiOf(f, p.flightDataId).pendingSeparationRegime, null);
});

// ── the pure evaluation ──────────────────────────────────────────────────

const CFG = { regimeExitGraceS: 10 };
const IN = [{ airspaceId: 'A1' }];
const ev = (input, mem, now, wall) => evaluateRegime({ pending: null, effective: null, located: true, inside: [], unknown: [], ...input }, mem, now, CFG, wall);

test('entry needs two consecutive inside ticks, not one; a tick outside resets the count', () => {
  const mem = {};
  assert.equal(ev({ pending: 'MARSA', inside: IN }, mem, 0, 0).enter, null);
  assert.equal(ev({ pending: 'MARSA' }, mem, 1000, 1000).enter, null);
  assert.equal(ev({ pending: 'MARSA', inside: IN }, mem, 2000, 2000).enter, null);
  assert.deepEqual(ev({ pending: 'MARSA', inside: IN }, mem, 3000, 3000).enter, { airspaceId: 'A1' });
});

test('overlapping airspaces: the first one returned names the entry', () => {
  const mem = {};
  const two = [{ airspaceId: 'A1' }, { airspaceId: 'A2' }];
  ev({ pending: 'MARSA', inside: two }, mem, 0, 0);
  assert.equal(ev({ pending: 'MARSA', inside: two }, mem, 1, 1).enter.airspaceId, 'A1');
});

test('leaving raises REGIME_OUTSIDE_AIRSPACE only after the wall-clock grace; back inside clears it; mission time stamps since', () => {
  const mem = {};
  assert.equal(ev({ effective: 'MARSA' }, mem, 500000, 0).alert, null);
  assert.equal(ev({ effective: 'MARSA' }, mem, 509000, 9000).alert, null);
  const a = ev({ effective: 'MARSA' }, mem, 999999, 10000).alert;
  assert.deepEqual(a, { kind: 'REGIME_OUTSIDE_AIRSPACE', since: 500000 }, 'since is mission time, the grace is wall time');
  assert.equal(ev({ effective: 'MARSA', inside: IN }, mem, 1, 11000).alert, null);
  assert.equal(ev({ effective: 'MARSA' }, mem, 2, 12000).alert, null, 'the grace starts over');
});

test('the airspace deactivating (nothing inside any more) raises the alert, and the regime stays', () => {
  const mem = {};
  ev({ effective: 'DUE_REGARD', inside: IN }, mem, 0, 0);
  ev({ effective: 'DUE_REGARD' }, mem, 1, 1000);
  assert.equal(ev({ effective: 'DUE_REGARD' }, mem, 2, 12000).alert.kind, 'REGIME_OUTSIDE_AIRSPACE');
});

test('no correlated track and unknown geometry: never an automatic entry, never an outside alert', () => {
  assert.equal(ev({ effective: 'MARSA', located: false }, {}, 0, 99999).alert, null);
  const mem = {};
  ev({ effective: 'MARSA', unknown: IN }, mem, 0, 0);
  assert.equal(ev({ effective: 'MARSA', unknown: IN }, mem, 1, 99999).alert, null, 'unknown is not outside');
  const m2 = {};
  for (let i = 0; i < 5; i++) {
    const o = ev({ pending: 'MARSA', unknown: IN }, m2, i, i);
    assert.equal(o.enter, null);
    assert.equal(o.alert.kind, 'AWAITING_ENTRY_UNKNOWN');
  }
  assert.equal(ev({ pending: 'MARSA', located: false }, {}, 0, 0).alert.kind, 'AWAITING_ENTRY_UNKNOWN');
  assert.equal(ev({ pending: 'MARSA' }, {}, 0, 0).alert, null, 'located and merely outside: waiting is normal');
});

// ── the monitor over real Boards ─────────────────────────────────────────

function monitorFor(f, over = {}) {
  const sent = [];
  const monitor = new TofiRegimeMonitor({
    flightDataStore: f.get('CENTER').boardStore._flightDataStore,
    locate: () => LOCATION,
    activeMarsaFor: () => null,
    enter: (id, info) => {
      const r = f.get(info.facilityId).boardStore.markTofiEntered(id, info);
      return r.ok ? { ok: true, message: { type: 'efsp-board-delta', strip: r.strip.stripId } } : r;
    },
    onEntered: (m) => sent.push(m),
    config: CFG,
    ...over,
  });
  return { monitor, sent };
}

test('the monitor makes a pending regime effective on the second inside tick through the Board: actor system, one audit entry, a delta', () => {
  const f = makeFacilities(); const log = logTo(f); const p = propose(f);
  accept(f, p.missionId, 'USING_AGENCY');
  const { monitor, sent } = monitorFor(f);
  LOCATION = INSIDE;
  monitor.tick(1000, 1000);
  assert.equal(tofiOf(f, p.flightDataId).separationRegime, 'ATC');
  monitor.tick(2000, 2000);
  const t = tofiOf(f, p.flightDataId);
  assert.equal(t.separationRegime, 'USING_AGENCY'); assert.equal(t.regimeEffective.trigger, 'AIRSPACE'); assert.equal(t.regimeEffective.by, 'system');
  assert.equal(sent.length, 1);
  const entries = log.filter(e => e.op === 'TofiRegimeEntered');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].actorId, 'system'); assert.equal(entries[0].clientMutationId, null);
  assert.equal(entries[0].tofiRegime.airspaceId, 'MOA-1');
  monitor.tick(3000, 3000);
  assert.equal(log.filter(e => e.op === 'TofiRegimeEntered').length, 1, 'no second entry');
});

test('the monitor skips a flight in an active MARSA relation, and reports AWAITING_ENTRY_UNKNOWN / REGIME_OUTSIDE_AIRSPACE as alerts', () => {
  const f = makeFacilities(); const p = propose(f);
  accept(f, p.missionId, 'MARSA');
  let marsa = true;
  const { monitor } = monitorFor(f, { activeMarsaFor: () => marsa });
  LOCATION = { located: false, inside: [], unknown: [] };
  assert.equal(monitor.tick(0, 0), false); assert.deepEqual(monitor.getAll(), []);
  marsa = false;
  assert.equal(monitor.tick(1000, 1000), true);
  assert.deepEqual(monitor.getAll(), [{ flightDataId: p.flightDataId, kind: 'AWAITING_ENTRY_UNKNOWN', since: 1000 }]);
  act(f, p.missionId, { kind: 'TOFI', action: 'MARK_ENTERED' });
  LOCATION = { located: true, inside: [], unknown: [] };
  monitor.tick(2000, 2000);
  assert.deepEqual(monitor.getAll(), [], 'the manual mark cleared the awaiting alert');
  monitor.tick(3000, 13000);
  assert.deepEqual(monitor.getAll(), [{ flightDataId: p.flightDataId, kind: 'REGIME_OUTSIDE_AIRSPACE', since: 2000 }]);
  assert.equal(tofiOf(f, p.flightDataId).separationRegime, 'MARSA', 'the regime never changes by itself');
  LOCATION = INSIDE;
  monitor.tick(4000, 14000);
  assert.deepEqual(monitor.getAll(), []);
});

// ── the wire ─────────────────────────────────────────────────────────────

test('efsp-alerts carries tofiRegime, filtered by read scope to the visible flights', () => {
  const msg = { type: 'efsp-alerts', conformance: [], tofiRegime: [{ flightDataId: 'f1', kind: 'REGIME_OUTSIDE_AIRSPACE', since: 1 }, { flightDataId: 'f2', kind: 'AWAITING_ENTRY_UNKNOWN', since: 2 }], obligations: [], surveillance: [] };
  const out = readScope.filterAlerts(msg, { kind: readScope.OWNED }, new Set(['f1']), () => true);
  assert.deepEqual(out.tofiRegime.map(a => a.flightDataId), ['f1']);
  assert.equal(readScope.filterAlerts(msg, { kind: readScope.ALL }, new Set(), () => true), msg);
});
