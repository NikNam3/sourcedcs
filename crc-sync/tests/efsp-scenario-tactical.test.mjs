import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The two tactical Positions no sortie had ever walked: AIC and JTAC.
//
// The unit permission tables (efsp-permission.test.mjs) already say what each
// Position is granted. These walks prove the WIRING a real message goes
// through — handleMessage → the session-bound acting Position (ADR 0029) →
// canMutate → ownership → per-state authority — which is where a grant that
// looks right in a table can still do the wrong thing on the Board.
//
// The model they hold the server to (docs/parallel/decisions.md):
//  - H2: TAC_C2 transfers a mission line to AIC at check-in (ON_STATION). AIC
//    moves it between On Station and Committed and annotates it, never
//    advances its state, and transfers it back to TAC_C2 to go OFF_STATION.
//  - H40: a JTAC sees only the Strips TAC_C2 handed it, with the same
//    transfer-in / transfer-back model as AIC.
//
// Where the server does not do that yet, the test is written as the correct
// behaviour and marked `todo` with its bug number; docs/wip/L8.md has the
// repro. A todo test turns into a plain pass when its bug is fixed, and the
// fixing lane deletes the `todo` option.
//
// H2 also asks for this to be built MODULARLY, because AIC's capabilities
// will grow. So the refusal checks below are tables (`for (const op of …)`),
// and the helpers take a Position rather than hard-coding AIC, so a later
// capability is one row, not a rewrite.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-tactical-scn-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');

const { createEfsp } = await import('../src/efsp/index.js');
const facilityConfig = (await import('../src/efsp/facility-config.js')).default;
const {
  crew, hold, act, mustAct, marsaAct, jumpTo, DEPARTURE_FDR, airborneDeparture, handedToCenter,
} = await import('./helpers/efsp-scenario.mjs');

const ALL = { OPS: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER', TAC_C2: 'TACTICAL', GCI: 'TACTICAL', AIC: 'TACTICAL', JTAC: 'TACTICAL' };
const COORDINATION_KINDS = ['HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT'];

// The Board is durable (ADR 0002): every createEfsp() in one file restores the
// previous test's snapshot. Vacate warnings count EVERY Strip a Position owns,
// so a leftover from an earlier sortie changes them. Start each sortie empty.
function freshEfsp() {
  fs.rmSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, { force: true });
  return createEfsp();
}
const tac = (efsp, id) => efsp.boardStoreFor('TACTICAL').getStrip(id);
const ctrOf = (efsp, id) => efsp.boardStoreFor('CENTER').getStrip(id);

/** Asserts a refusal by reason AND (where the server gives one) detail — a bare ok:false cannot tell PERMISSION_DENIED from NOT_OWNER. */
function refused(ack, reason, detail, label = '') {
  assert.equal(ack.ok, false, `${label} should be refused: ${JSON.stringify(ack)}`);
  assert.equal(ack.reason, reason, `${label}: ${JSON.stringify(ack)}`);
  if (detail) assert.match(ack.detail, detail, label);
}

/** CTR hands tactical control to TAC_C2 (MARSA), and the mission line walks to ON_STATION. */
function onStationUnderTofi(efsp, c, callsign) {
  const atCenter = handedToCenter(efsp, c, airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign }));
  const proposed = mustAct(efsp, c.CTR, 'CTR', atCenter, {
    kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2',
  });
  // ADR 0053: accepting tactical control names the separation regime.
  let mission = mustAct(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, proposed.tofiCoordination.peerStripId), {
    kind: 'TOFI', action: 'ACCEPT', separationRegime: 'MARSA',
  });
  mission = jumpTo(efsp, c.TAC_C2, 'TAC_C2', mission, 'AIRBORNE');
  mission = jumpTo(efsp, c.TAC_C2, 'TAC_C2', mission, 'ON_STATION');
  return { ctr: ctrOf(efsp, atCenter.stripId), mission };
}

/** A mission line TAC_C2 tasks itself (no TOFI, ADR 0054's standalone origination), set to `state`. */
function taskedLine(efsp, c, callsign, state = 'ON_STATION') {
  let line = mustAct(efsp, c.TAC_C2, 'TAC_C2', null, {
    kind: 'CreateStrip', bayId: 'tac-c2-tasked', rackId: 'main', role: 'MISSION', fdr: { callsign },
  });
  // jumpTo is SetState, the unchecked escape hatch: used here only to SET UP a
  // state, never to prove somebody may advance to it (see A1 and B7).
  for (const s of ['AIRBORNE', 'ON_STATION', 'OFF_STATION']) {
    if (line.state === state) break;
    line = jumpTo(efsp, c.TAC_C2, 'TAC_C2', line, s);
  }
  return line;
}

/** TAC_C2 hands a mission line to a working Position's Bay (H2 / H40's transfer-in). */
function handTo(efsp, c, strip, positionId, bayId) {
  return mustAct(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, strip.stripId), {
    kind: 'TransferStrip', toPositionId: positionId, bayId, rackId: 'main',
  });
}
const toAic = (efsp, c, m) => handTo(efsp, c, m, 'AIC', 'aic-on-station');

/** The Bays a Position's panel is built from — a Strip anywhere else is off its screen. */
const baysOf = (positionId) => facilityConfig.getBaysFor(positionId, 'TACTICAL').map(b => b.bayId);

// ── AIC ─────────────────────────────────────────────────────────────────

test('SCENARIO A1 AIC works a mission line it is handed, and nothing more (H2)', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  const { mission } = onStationUnderTofi(efsp, c, 'AIC11');

  // Transfer-in at check-in. aic-on-station implies ON_STATION, which is the
  // state the line is already in, so this is a legal transfer.
  let m = toAic(efsp, c, mission);
  assert.equal(m.ownerPositionId, 'AIC');
  assert.equal(m.bayId, 'aic-on-station');
  assert.equal(m.state, 'ON_STATION');

  // Annotate.
  m = mustAct(efsp, c.AIC, 'AIC', tac(efsp, m.stripId), { kind: 'SetBlock', blockId: 'M2', value: 'PKG-A' });
  assert.equal(efsp.fdrStore.getFdr(m.fdrId).mission.packageId, 'PKG-A');
  m = mustAct(efsp, c.AIC, 'AIC', tac(efsp, m.stripId), { kind: 'SetFlag', flag: 'highlight', value: 'yellow' });

  // On Station ↔ Committed. aic-committed implies no state, so the move is free.
  m = mustAct(efsp, c.AIC, 'AIC', tac(efsp, m.stripId), { kind: 'MoveStrip', bayId: 'aic-committed', rackId: 'main' });
  assert.equal(m.bayId, 'aic-committed');
  assert.equal(m.state, 'ON_STATION');
  m = mustAct(efsp, c.AIC, 'AIC', tac(efsp, m.stripId), { kind: 'MoveStrip', bayId: 'aic-on-station', rackId: 'main' });
  assert.equal(m.bayId, 'aic-on-station');

  // Never advances state — and the advisory the NLA button shows agrees with
  // what the press gets (F-408: advisory and press must never disagree).
  refused(act(efsp, c.AIC, 'AIC', tac(efsp, m.stripId), { kind: 'InvokeNla' }),
    'PERMISSION_DENIED', /ON_STATION is not AIC's to advance/, 'AIC InvokeNla');
  assert.deepEqual(efsp.boardStoreFor('TACTICAL').nlaStatusFor(tac(efsp, m.stripId)),
    { inhibited: "ON_STATION is not AIC's to advance", reason: 'PERMISSION_DENIED' });

  // Works UNDER TAC_C2's TOFI and holds none of its own (ADR 0025).
  for (const op of [
    { kind: 'TOFI', action: 'PROPOSE', direction: 'EXIT' },
    { kind: 'TOFI', action: 'TRANSFER_COMMS' },
  ]) refused(act(efsp, c.AIC, 'AIC', tac(efsp, m.stripId), op), 'PERMISSION_DENIED', null, `AIC TOFI ${op.action}`);

  // D12 (guide §4.1 rule 1): none of the 5 coordination primitives.
  for (const kind of COORDINATION_KINDS) {
    refused(act(efsp, c.AIC, 'AIC', tac(efsp, m.stripId), {
      kind, action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR',
    }), 'PERMISSION_DENIED', null, `AIC ${kind}`);
  }

  // Does not originate mission lines.
  refused(act(efsp, c.AIC, 'AIC', null, {
    kind: 'CreateStrip', bayId: 'aic-on-station', rackId: 'main', role: 'MISSION', fdr: { callsign: 'X' },
  }), 'PERMISSION_DENIED', null, 'AIC CreateStrip');

  // §4.6.3 rule 2 holds whoever owns the Strip: no Drop under tactical control.
  refused(act(efsp, c.AIC, 'AIC', tac(efsp, m.stripId), { kind: 'DropStrip' }),
    'VALIDATION_ERROR', /active tactical control/, 'AIC DropStrip');

  // Ownership is per Position (§4.8.1): TAC_C2 handed it over and cannot write it.
  refused(act(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, m.stripId), { kind: 'SetBlock', blockId: 'M2', value: 'PKG-B' }),
    'NOT_OWNER', null, 'TAC_C2 SetBlock on an AIC-held line');

  // Transfer-back, and TAC_C2 takes it OFF_STATION.
  m = mustAct(efsp, c.AIC, 'AIC', tac(efsp, m.stripId), {
    kind: 'TransferStrip', toPositionId: 'TAC_C2', bayId: 'tac-c2-on-station', rackId: 'main',
  });
  assert.equal(m.ownerPositionId, 'TAC_C2');
  const off = mustAct(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, m.stripId), { kind: 'InvokeNla' });
  assert.equal(off.state, 'OFF_STATION');
  assert.equal(efsp.fdrStore.getFdr(off.fdrId).mission.packageId, 'PKG-A', 'AIC\'s annotation travels with the line');
});

test('SCENARIO A2 CTR asks for the exit while AIC holds the line — today only a hand-back unblocks it (B2)', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  let { ctr, mission } = onStationUnderTofi(efsp, c, 'AIC12');
  const m = toAic(efsp, c, mission);

  // EXIT's ACCEPT needs CTR's SREG back at ATC before the proposal.
  ctr = mustAct(efsp, c.CTR, 'CTR', ctrOf(efsp, ctr.stripId), { kind: 'SetBlock', blockId: 'SREG', value: 'ATC' });
  mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'TOFI', action: 'PROPOSE', direction: 'EXIT' });
  assert.equal(tac(efsp, m.stripId).tofiCoordination.direction, 'EXIT');
  assert.equal(tac(efsp, m.stripId).tofiCoordination.state, 'PROPOSED');

  // Pinned as it is today (B2): nobody can answer the safety-critical
  // direction (§4.6.3 rule 3) while AIC holds the line.
  refused(act(efsp, c.AIC, 'AIC', tac(efsp, m.stripId), { kind: 'TOFI', action: 'ACCEPT' }),
    'PERMISSION_DENIED', null, 'AIC accepts the EXIT');
  refused(act(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, m.stripId), { kind: 'TOFI', action: 'ACCEPT' }),
    'NOT_OWNER', null, 'TAC_C2 accepts the EXIT on an AIC-held line');

  // The only way out: AIC hands it back, then TAC_C2 accepts.
  mustAct(efsp, c.AIC, 'AIC', tac(efsp, m.stripId), {
    kind: 'TransferStrip', toPositionId: 'TAC_C2', bayId: 'tac-c2-on-station', rackId: 'main',
  });
  mustAct(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, m.stripId), { kind: 'TOFI', action: 'ACCEPT' });
  assert.equal(ctrOf(efsp, ctr.stripId).tofiCoordination.state, 'COMPLETE');
});

test('SCENARIO A2\' TAC_C2, whose TOFI it is, answers CTR\'s EXIT on a line AIC is working', { todo: 'L8 B2 — see docs/wip/L8.md' }, () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  let { ctr, mission } = onStationUnderTofi(efsp, c, 'AIC13');
  const m = toAic(efsp, c, mission);
  ctr = mustAct(efsp, c.CTR, 'CTR', ctrOf(efsp, ctr.stripId), { kind: 'SetBlock', blockId: 'SREG', value: 'ATC' });
  mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'TOFI', action: 'PROPOSE', direction: 'EXIT' });

  // Guide §4.1: AIC "works under TAC_C2's TOFI" — the exchange is TAC_C2's.
  // (The alternative fix, refusing a transfer to AIC while TOFI is ACTIVE, is
  // named in docs/wip/L8.md; H2's check-in transfer makes it the worse one.)
  const ack = act(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, m.stripId), { kind: 'TOFI', action: 'ACCEPT' });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.equal(ctrOf(efsp, ctr.stripId).tofiCoordination.state, 'COMPLETE');
});

test('SCENARIO A3 AIC walks away and the line routes to TAC_C2 (§4.8.6 rule 2)', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  const m = toAic(efsp, c, taskedLine(efsp, c, 'VAC11'));

  const ack = hold(efsp, c.AIC.session, 'TACTICAL', []).ack;
  assert.deepEqual(ack.warnings, [{ positionId: 'AIC', count: 1, routedTo: 'TAC_C2' }]);
  assert.equal(tac(efsp, m.stripId).ownerPositionId, 'TAC_C2');
  assert.equal(mustAct(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, m.stripId), { kind: 'InvokeNla' }).state, 'OFF_STATION',
    'the covering controller can work it');

  // Pinned as it is today (B3): the owner moved, the Bay did not. TAC_C2 now
  // owns a Strip sitting in AIC's Bay, which is not one TAC_C2's panel builds.
  assert.equal(tac(efsp, m.stripId).bayId, 'aic-on-station');
});

test('SCENARIO A3\' a covering reassignment lands the line in a Bay the covering Position has', { todo: 'L8 B3 — see docs/wip/L8.md' }, () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  const m = toAic(efsp, c, taskedLine(efsp, c, 'VAC13'));
  hold(efsp, c.AIC.session, 'TACTICAL', []);
  const after = tac(efsp, m.stripId);
  assert.equal(after.ownerPositionId, 'TAC_C2');
  assert.ok(baysOf('TAC_C2').includes(after.bayId), `TAC_C2 owns it but it sits in ${after.bayId}`);
});

test('SCENARIO A3\'\' the same holds at Incirlik: GND walks away and TWR gets the Strip in a TWR Bay', { todo: 'L8 B3 — see docs/wip/L8.md' }, () => {
  const efsp = freshEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK' });
  const strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, callsign: 'VAC14' },
  });
  mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'TransferStrip', toPositionId: 'GND', bayId: 'gnd-coordination', rackId: 'main' });
  hold(efsp, c.GND.session, 'INCIRLIK', []);
  const after = efsp.boardStoreFor('INCIRLIK').getStrip(strip.stripId);
  assert.equal(after.ownerPositionId, 'TWR');
  const twrBays = facilityConfig.getBaysFor('TWR', 'INCIRLIK').map(b => b.bayId);
  assert.ok(twrBays.includes(after.bayId), `TWR owns it but it sits in ${after.bayId}`);
});

test('SCENARIO A4 with TAC_C2 gone too, the chain bottoms out inside TACTICAL and says so (D19)', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  const m = toAic(efsp, c, taskedLine(efsp, c, 'VAC12'));

  assert.deepEqual(hold(efsp, c.TAC_C2.session, 'TACTICAL', []).ack.warnings, [], 'TAC_C2 owns nothing');
  // Guide §4.8.6 writes the chain as AIC/GCI → TAC_C2 → CTR. The TAC_C2 → CTR
  // hop is deliberately not built: it would cross a Facility, and
  // coveringPositionFor() is scoped to one Facility's PositionStore
  // (facility-config.js's TACTICAL coveringChain comment; ADR 0013 point 4
  // rejected the identical APP → CTR extension). Warn, do not block.
  assert.deepEqual(hold(efsp, c.AIC.session, 'TACTICAL', []).ack.warnings,
    [{ positionId: 'AIC', count: 1, routedTo: null }]);
  assert.equal(tac(efsp, m.stripId).ownerPositionId, 'AIC', 'visibly stranded, not silently orphaned');
});

test('SCENARIO A5 a hand-off to an empty AIC is caught by TAC_C2, and the ack says where it went', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  hold(efsp, c.AIC.session, 'TACTICAL', []);
  const line = taskedLine(efsp, c, 'VAC15');

  const ack = act(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, line.stripId), {
    kind: 'TransferStrip', toPositionId: 'AIC', bayId: 'aic-on-station', rackId: 'main',
  });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.equal(ack.routedTo, 'TAC_C2', 'the sender is told the line came back to it');
  assert.equal(tac(efsp, line.stripId).ownerPositionId, 'TAC_C2');
  // B3 again, by the other path: TAC_C2's line, in AIC's Bay.
  assert.equal(tac(efsp, line.stripId).bayId, 'aic-on-station');
});

test('SCENARIO A5\' a transfer is refused into a Bay that is not the receiving Position\'s', { todo: 'L8 B4 — see docs/wip/L8.md' }, () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  const line = taskedLine(efsp, c, 'BAY11');
  // tac-c2-tanker has no implied state, so only the Bay's owner is at issue.
  const ack = act(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, line.stripId), {
    kind: 'TransferStrip', toPositionId: 'AIC', bayId: 'tac-c2-tanker', rackId: 'main',
  });
  assert.equal(ack.ok, false, `AIC now owns a Strip in TAC_C2's Bay: ${JSON.stringify(ack)}`);
  assert.equal(ack.reason, 'VALIDATION_ERROR');
});

test('SCENARIO A6 one controller holding CTR and AIC still gets no coordination primitive (D12/D21, §4.8.4)', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER', TAC_C2: 'TACTICAL', JTAC: 'TACTICAL' });

  // A mission line on a flight CTR is working (the taskMissionLine shape).
  const ctrStrip = handedToCenter(efsp, c, airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'CMB11' }));
  let line = mustAct(efsp, c.TAC_C2, 'TAC_C2', null, {
    kind: 'CreateStrip', bayId: 'tac-c2-tasked', rackId: 'main', role: 'MISSION', fdrId: ctrStrip.fdrId,
  });
  line = jumpTo(efsp, c.TAC_C2, 'TAC_C2', line, 'AIRBORNE');
  line = jumpTo(efsp, c.TAC_C2, 'TAC_C2', line, 'ON_STATION');

  // The CTR controller hands the seat to the combined one, who then holds CTR
  // at CENTER and AIC at TACTICAL on ONE session — which is what military's
  // "holding both CTR and TAC_C2" sortie names but, with two sessions, does not do.
  hold(efsp, c.CTR.session, 'CENTER', []);
  const s = { controllerId: 'c-combo', who: 'combo' };
  hold(efsp, s, 'CENTER', ['CTR']);
  hold(efsp, s, 'TACTICAL', ['AIC']);
  assert.equal(efsp.positionStoreFor('CENTER').primaryOf('CTR'), 'c-combo');
  assert.equal(efsp.positionStoreFor('TACTICAL').primaryOf('AIC'), 'c-combo');
  // act() sends the crew member's facilityId: it must be the STRIP's Facility.
  const combo = { session: s, facilityId: 'TACTICAL' };

  const m = toAic(efsp, c, line);

  for (const kind of COORDINATION_KINDS) {
    refused(act(efsp, combo, 'AIC', tac(efsp, m.stripId), {
      kind, action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR',
    }), 'PERMISSION_DENIED', null, `combined AIC ${kind}`);
  }
  // CTR's hat does not reach into TACTICAL: combination does not merge Facilities.
  refused(act(efsp, combo, 'CTR', tac(efsp, m.stripId), {
    kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'APP',
  }), 'NOT_HOLDING_POSITION', null, 'CTR hat on a TACTICAL Strip');

  // The AIC hat works, and only as AIC.
  mustAct(efsp, combo, 'AIC', tac(efsp, m.stripId), { kind: 'SetBlock', blockId: 'M2', value: 'PKG-C' });

  // Negative control (ADR 0029): a session that does not hold AIC cannot act as it.
  refused(act(efsp, c.JTAC, 'AIC', tac(efsp, m.stripId), { kind: 'SetBlock', blockId: 'M2', value: 'PKG-D' }),
    'NOT_HOLDING_POSITION', null, 'JTAC claiming AIC');
});

test('SCENARIO A7 AIC cannot move a line past its state with the SetState escape hatch (H2)', { todo: 'L8 B7 — see docs/wip/L8.md' }, () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  const m = toAic(efsp, c, taskedLine(efsp, c, 'AIC14'));
  // H2: AIC "never advances state; transfers back to TAC_C2 to go OFF_STATION".
  // InvokeNla already refuses (A1); SetState is the same move by another name.
  for (const toState of ['OFF_STATION', 'RTB']) {
    refused(act(efsp, c.AIC, 'AIC', tac(efsp, m.stripId), { kind: 'SetState', toState }),
      'PERMISSION_DENIED', null, `AIC SetState ${toState}`);
  }
});

// ── JTAC ────────────────────────────────────────────────────────────────

test('SCENARIO J1 JTAC writes nothing on a line it has not been handed', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  const m = taskedLine(efsp, c, 'JT11');

  // canMutate runs before ownership (board-store.js _dispatch), so a grant
  // JTAC lacks is PERMISSION_DENIED even on a Strip it does not own.
  for (const op of [
    { kind: 'SetBlock', blockId: 'M2', value: 'PKG-J' },
    { kind: 'SetFlag', flag: 'highlight', value: 'yellow' },
    { kind: 'InvokeNla' },
    { kind: 'SetState', toState: 'OFF_STATION' },
    { kind: 'MoveStrip', bayId: 'jtac-mission', rackId: 'main' },
    { kind: 'DropStrip' },
    { kind: 'Undo' },
    { kind: 'TOFI', action: 'ACCEPT', separationRegime: 'MARSA' },
    { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' },
  ]) refused(act(efsp, c.JTAC, 'JTAC', tac(efsp, m.stripId), op), 'PERMISSION_DENIED', null, `JTAC ${op.kind}`);

  // H40 gives JTAC a transfer-BACK. Once B1 is fixed, a transfer of a line it
  // was never handed may come back NOT_OWNER instead — either is a refusal.
  const take = act(efsp, c.JTAC, 'JTAC', tac(efsp, m.stripId), {
    kind: 'TransferStrip', toPositionId: 'JTAC', bayId: 'jtac-mission', rackId: 'main',
  });
  assert.equal(take.ok, false, JSON.stringify(take));
  assert.ok(['PERMISSION_DENIED', 'NOT_OWNER'].includes(take.reason), JSON.stringify(take));

  refused(act(efsp, c.JTAC, 'JTAC', null, {
    kind: 'CreateStrip', bayId: 'jtac-mission', rackId: 'main', role: 'MISSION', fdr: { callsign: 'JX' },
  }), 'PERMISSION_DENIED', null, 'JTAC CreateStrip');

  assert.equal(tac(efsp, m.stripId).rev, m.rev, 'nothing JTAC sent touched the line');

  // JTAC is never a TOFI counterpart.
  const ctrStrip = handedToCenter(efsp, c, airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'JT12' }));
  refused(act(efsp, c.CTR, 'CTR', ctrStrip, {
    kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'JTAC',
  }), 'VALIDATION_ERROR', /not a valid TOFI counterpart/, 'TOFI to JTAC');
});

test('SCENARIO J2 TAC_C2 hands a line to JTAC and JTAC hands it back (H40)', { todo: 'L8 B1 — see docs/wip/L8.md' }, () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  const line = taskedLine(efsp, c, 'JT13');

  const m = handTo(efsp, c, line, 'JTAC', 'jtac-mission');
  assert.equal(m.ownerPositionId, 'JTAC');
  assert.equal(m.bayId, 'jtac-mission');

  const back = act(efsp, c.JTAC, 'JTAC', tac(efsp, m.stripId), {
    kind: 'TransferStrip', toPositionId: 'TAC_C2', bayId: 'tac-c2-on-station', rackId: 'main',
  });
  assert.equal(back.ok, true, `JTAC is stranded with the line: ${JSON.stringify(back)}`);
  assert.equal(tac(efsp, m.stripId).ownerPositionId, 'TAC_C2');
  assert.equal(mustAct(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, m.stripId), { kind: 'InvokeNla' }).state, 'OFF_STATION');
});

test('SCENARIO J3 a JTAC has no scope, so it neither binds a contact nor declares MARSA', { todo: 'L8 B5 — see docs/wip/L8.md' }, () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  const a = taskedLine(efsp, c, 'JT14');
  const b = taskedLine(efsp, c, 'JT15');

  const current = efsp.correlationStore.getCorrelation(a.fdrId);
  const bind = efsp.handleMessage(c.JTAC.session, {
    version: 1, type: 'efsp-correlation-mutation', clientMutationId: crypto.randomUUID(),
    fdrId: a.fdrId, baseRev: current ? current.rev : 0, actingPositionId: 'JTAC',
    op: { kind: 'BindTrack', trackId: '777' },
  }).ack;
  // canCorrelate's own argument for refusing RANGE ("no scope either") holds
  // for JTAC: positionRadars.JTAC is [] (facility-config.js).
  assert.equal(bind.ok, false, `JTAC bound a track: ${JSON.stringify(bind)}`);

  const marsa = marsaAct(efsp, c.JTAC, 'JTAC', null, {
    kind: 'DeclareMarsa', participants: [a.fdrId, b.fdrId],
    startEvent: 'LOCAL_DECLARATION', endCondition: 'ATC_SEPARATION_ESTABLISHED', declaringCallsign: 'JT14',
  });
  assert.equal(marsa.ok, false, `JTAC declared MARSA: ${JSON.stringify(marsa)}`);
});

test('SCENARIO J4 a JTAC is sent only the Strips TAC_C2 has handed it (H40)', { todo: 'L8 B6 — see docs/wip/L8.md' }, () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  const handed = handTo(efsp, c, taskedLine(efsp, c, 'JT16'), 'JTAC', 'jtac-mission');
  const kept = taskedLine(efsp, c, 'JT17');
  airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'JT18' });

  // A reconnecting JTAC's full resync is the one read path that is already
  // per-session on the wire; the connect-time snapshot and the broadcast
  // deltas have to follow the same rule, which this does not reach.
  const reply = efsp.handleMessage(c.JTAC.session, { type: 'efsp-resync', facilityId: 'TACTICAL', lastBoardSeq: -1 }).ack;
  const ids = reply.strips.map(s => s.stripId);
  assert.ok(ids.includes(handed.stripId), 'the handed line is visible');
  assert.ok(!ids.includes(kept.stripId), 'TAC_C2\'s own line is not');
  assert.deepEqual(reply.strips.filter(s => s.ownerPositionId !== 'JTAC').map(s => s.stripId), [],
    'nothing a JTAC was not handed');
});
