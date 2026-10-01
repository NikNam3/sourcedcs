import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// L23's own walks (docs/adr/0080), beside L8's efsp-scenario-tactical.test.mjs:
// the capability table's rules on the wire, the Bay that follows an owner (B3/
// B4), the TOFI answerer (B2), SetState's owner check (B7), the covering return
// (F10), the retire path (S-L24) and a coordination link that outlives its peer
// (U7). Same prologue as L8's file: every scenario file owns its snapshot paths.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-tactical-l23-'));
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
const permission = await import('../src/efsp/permission.js');
const { BoardStore } = await import('../src/efsp/board-store.js');
const { FdrStore } = await import('../src/efsp/fdr-store.js');
const {
  crew, hold, act, mustAct, jumpTo, advance, DEPARTURE_FDR, airborneDeparture, handedToCenter,
} = await import('./helpers/efsp-scenario.mjs');

const ALL = { OPS: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER', TAC_C2: 'TACTICAL', GCI: 'TACTICAL', AIC: 'TACTICAL', JTAC: 'TACTICAL' };

function freshEfsp() {
  fs.rmSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, { force: true });
  return createEfsp();
}
const tac = (efsp, id) => efsp.boardStoreFor('TACTICAL').getStrip(id);
const inc = (efsp, id) => efsp.boardStoreFor('INCIRLIK').getStrip(id);
const ctrOf = (efsp, id) => efsp.boardStoreFor('CENTER').getStrip(id);

function refused(ack, reason, detail, label = '') {
  assert.equal(ack.ok, false, `${label} should be refused: ${JSON.stringify(ack)}`);
  assert.equal(ack.reason, reason, `${label}: ${JSON.stringify(ack)}`);
  if (detail) assert.match(ack.detail, detail, label);
}

function taskedLine(efsp, c, callsign, state = 'ON_STATION') {
  let line = mustAct(efsp, c.TAC_C2, 'TAC_C2', null, {
    kind: 'CreateStrip', bayId: 'tac-c2-tasked', rackId: 'main', role: 'MISSION', fdr: { callsign },
  });
  for (const s of ['AIRBORNE', 'ON_STATION', 'OFF_STATION']) {
    if (line.state === state) break;
    line = jumpTo(efsp, c.TAC_C2, 'TAC_C2', line, s);
  }
  return line;
}
const handTo = (efsp, c, strip, positionId, bayId) => mustAct(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, strip.stripId), {
  kind: 'TransferStrip', toPositionId: positionId, bayId, rackId: 'main',
});
const baysOf = (positionId, facilityId = 'TACTICAL') => facilityConfig.getBaysFor(positionId, facilityId).map(b => b.bayId);

/** CTR hands tactical control to TAC_C2 (as L8's file does), leaving an ON_STATION mission line under TOFI. */
function onStationUnderTofi(efsp, c, callsign) {
  const atCenter = handedToCenter(efsp, c, airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign }));
  const proposed = mustAct(efsp, c.CTR, 'CTR', atCenter, {
    kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2',
  });
  let mission = mustAct(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, proposed.tofiCoordination.peerStripId), {
    kind: 'TOFI', action: 'ACCEPT', separationRegime: 'MARSA',
  });
  mission = jumpTo(efsp, c.TAC_C2, 'TAC_C2', mission, 'AIRBORNE');
  mission = jumpTo(efsp, c.TAC_C2, 'TAC_C2', mission, 'ON_STATION');
  return { ctr: ctrOf(efsp, atCenter.stripId), mission };
}

// ── B1: JTAC and AIC hand back, to TAC_C2 only ─────────────────────────────

test('B1 a JTAC may transfer a line to TAC_C2 and to nobody else; every other Position of TACTICAL is refused with a reason', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  const handed = handTo(efsp, c, taskedLine(efsp, c, 'L23A1'), 'JTAC', 'jtac-mission');
  for (const to of facilityConfig.getPositionSet('TACTICAL').filter(p => p !== 'TAC_C2')) {
    for (const bayId of baysOf(to)) {
      refused(act(efsp, c.JTAC, 'JTAC', tac(efsp, handed.stripId), { kind: 'TransferStrip', toPositionId: to, bayId, rackId: 'main' }),
        'PERMISSION_DENIED', /JTAC may only hand a line back to TAC_C2/, `JTAC -> ${to}/${bayId}`);
    }
  }
  assert.equal(tac(efsp, handed.stripId).ownerPositionId, 'JTAC', 'nothing moved');
});

test('B1 (Q1) the same table narrows AIC: it hands back to TAC_C2 and to nobody else', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  const m = handTo(efsp, c, taskedLine(efsp, c, 'L23A2'), 'AIC', 'aic-on-station');
  refused(act(efsp, c.AIC, 'AIC', tac(efsp, m.stripId), { kind: 'TransferStrip', toPositionId: 'GCI', bayId: 'gci-on-station', rackId: 'main' }),
    'PERMISSION_DENIED', /AIC may only hand a line back to TAC_C2/, 'AIC -> GCI');
  refused(act(efsp, c.AIC, 'AIC', tac(efsp, m.stripId), { kind: 'TransferStrip', toPositionId: 'JTAC', bayId: 'jtac-mission', rackId: 'main' }),
    'PERMISSION_DENIED', /only hand a line back/, 'AIC -> JTAC');
  mustAct(efsp, c.AIC, 'AIC', tac(efsp, m.stripId), { kind: 'TransferStrip', toPositionId: 'TAC_C2', bayId: 'tac-c2-on-station', rackId: 'main' });
});

test('B1 TAC_C2 (no row) still transfers anywhere, and a JTAC refused a line it was never handed is told who holds it (Q9)', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  const line = taskedLine(efsp, c, 'L23A3');
  refused(act(efsp, c.JTAC, 'JTAC', tac(efsp, line.stripId), { kind: 'TransferStrip', toPositionId: 'TAC_C2', bayId: 'tac-c2-on-station', rackId: 'main' }),
    'NOT_OWNER', /TAC_C2 holds this Strip/, 'JTAC on a line it was never handed');
  handTo(efsp, c, line, 'GCI', 'gci-on-station');
});

test('B1 (Q2) a JTAC who walks away leaves the line with TAC_C2, in TAC_C2\'s own Bay', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  const m = handTo(efsp, c, taskedLine(efsp, c, 'L23A4'), 'JTAC', 'jtac-mission');
  const ack = hold(efsp, c.JTAC.session, 'TACTICAL', []).ack;
  assert.deepEqual(ack.warnings, [{ positionId: 'JTAC', count: 1, routedTo: 'TAC_C2' }]);
  const after = tac(efsp, m.stripId);
  assert.equal(after.ownerPositionId, 'TAC_C2');
  assert.equal(after.bayId, 'tac-c2-on-station');
});

// ── B3 / B4: the Bay follows the owner ────────────────────────────────────

test('B3 the covering Bay is the one implying the state; else the first Bay implying none; the Strip never sits in the absent Position\'s Bay', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  // OFF_STATION: no TAC_C2 Bay implies it, so the first Bay with no implied state.
  const off = handTo(efsp, c, taskedLine(efsp, c, 'L23B1', 'OFF_STATION'), 'AIC', 'aic-committed');
  hold(efsp, c.AIC.session, 'TACTICAL', []);
  const after = tac(efsp, off.stripId);
  assert.equal(after.ownerPositionId, 'TAC_C2');
  assert.equal(after.bayId, 'tac-c2-tanker');
  assert.ok(baysOf('TAC_C2').includes(after.bayId));
});

test('B3 the routed TransferStrip lands in the covering Position\'s Bay too, and the ack keeps routedTo', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  hold(efsp, c.AIC.session, 'TACTICAL', []);
  const line = taskedLine(efsp, c, 'L23B2', 'AIRBORNE');
  const ack = act(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, line.stripId), { kind: 'TransferStrip', toPositionId: 'AIC', bayId: 'aic-committed', rackId: 'main' });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.equal(ack.routedTo, 'TAC_C2');
  assert.equal(tac(efsp, line.stripId).bayId, 'tac-c2-airborne', 'implied-state Bay wins');
});

test('B3 with no Bay to fit, the Strip keeps its Bay and the reassignment says so', () => {
  const rules = {
    resolveBlockTarget: () => ({ kind: 'annotation' }), isOccupied: () => true, coveringPositionFor: () => null,
    baysFor: (p) => (p === 'B' ? [{ bayId: 'b-only', rackIds: ['main'], impliesState: 'OTHER' }] : [{ bayId: 'a-1', rackIds: ['main'] }]),
    isValidState: () => true,
  };
  const board = new BoardStore(new FdrStore(), rules);
  assert.equal(board._bayForNewOwner('B', 'PROPOSED'), null);
  assert.deepEqual(board._bayForNewOwner('B', 'OTHER'), { bayId: 'b-only', rackId: 'main' });
  assert.deepEqual(board._bayForNewOwner('A', 'ANY'), { bayId: 'a-1', rackId: 'main' });
  const made = board.applyMutation({
    clientMutationId: '00000000-0000-4000-8000-000000000001', op: { kind: 'CreateStrip', bayId: 'a-1', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, callsign: 'L23B3' } },
  }, 'A', 'A');
  assert.equal(made.ok, true, JSON.stringify(made));
  const ids = board.reassignPositionStrips('A', 'B');
  assert.equal(ids.unplaced.length, 1, 'no Bay of B fits');
  assert.equal(board.getStrip(made.strip.stripId).bayId, 'a-1');
});

test('B4 a transfer into a Bay of another Position is refused, and the detail names both', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  const line = taskedLine(efsp, c, 'L23B4');
  refused(act(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, line.stripId), { kind: 'TransferStrip', toPositionId: 'AIC', bayId: 'tac-c2-tanker', rackId: 'main' }),
    'VALIDATION_ERROR', /tac-c2-tanker is not a Bay of AIC/, 'B4');
});

// ── B2: the TOFI answer, and nothing else ─────────────────────────────────

test('B2 the exception is TOFI on a MISSION line for the one Position the table names: GCI answers nothing on an AIC line', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  let { ctr, mission } = onStationUnderTofi(efsp, c, 'L23C1');
  const m = handTo(efsp, c, mission, 'AIC', 'aic-on-station');
  ctr = mustAct(efsp, c.CTR, 'CTR', ctrOf(efsp, ctr.stripId), { kind: 'SetBlock', blockId: 'SREG', value: 'ATC' });
  mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'TOFI', action: 'PROPOSE', direction: 'EXIT' });
  refused(act(efsp, c.GCI, 'GCI', tac(efsp, m.stripId), { kind: 'TOFI', action: 'ACCEPT' }), 'NOT_OWNER', /AIC holds this Strip/, 'GCI accepts');
  refused(act(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, m.stripId), { kind: 'SetFlag', flag: 'highlight', value: 'yellow' }), 'NOT_OWNER', /AIC holds/, 'TAC_C2 SetFlag');
  refused(act(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, m.stripId), { kind: 'InvokeNla' }), 'NOT_OWNER', /AIC holds/, 'TAC_C2 InvokeNla');
  const ok = act(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, m.stripId), { kind: 'TOFI', action: 'ACCEPT' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ctrOf(efsp, ctr.stripId).tofiCoordination.state, 'COMPLETE');
  assert.equal(tac(efsp, m.stripId).ownerPositionId, 'AIC', 'answering does not move the line');
});

test('B2 the exception is MISSION-only and TOFI-only, and OPS\'s 14E exception is DEPARTURE-only and ends at DROPPED', () => {
  const { mayActBesideOwner } = permission;
  const mission = { role: 'MISSION', ownerPositionId: 'AIC', state: 'ON_STATION' };
  assert.equal(mayActBesideOwner('TAC_C2', mission, { kind: 'TOFI', action: 'ACCEPT' }), true);
  assert.equal(mayActBesideOwner('TAC_C2', mission, { kind: 'TOFI', action: 'PROPOSE' }), false);
  assert.equal(mayActBesideOwner('TAC_C2', { ...mission, role: 'DEPARTURE' }, { kind: 'TOFI', action: 'ACCEPT' }), false);
  assert.equal(mayActBesideOwner('TAC_C2', { ...mission, ownerPositionId: 'GCI' }, { kind: 'TOFI', action: 'ACCEPT' }), false, 'GCI has no row: nobody answers for it');
  assert.equal(mayActBesideOwner('TAC_C2', mission, { kind: 'SetBlock', blockId: 'M2' }), false);
  const dep = { role: 'DEPARTURE', ownerPositionId: 'TWR', state: 'RUNWAY_QUEUE' };
  assert.equal(mayActBesideOwner('OPS', dep, { kind: 'SetBlock', blockId: '14E' }), true);
  assert.equal(mayActBesideOwner('OPS', dep, { kind: 'SetBlock', blockId: '8A' }), false);
  assert.equal(mayActBesideOwner('GND', dep, { kind: 'SetBlock', blockId: '14E' }), false);
  assert.equal(mayActBesideOwner('OPS', { ...dep, state: 'DROPPED' }, { kind: 'SetBlock', blockId: '14E' }), false);
  assert.equal(mayActBesideOwner('OPS', { ...dep, role: 'ARRIVAL' }, { kind: 'SetBlock', blockId: '14E' }), false);
});

// ── B7: SetState is owner-checked, for every Role ─────────────────────────

test('B7 SetState needs the Position that owns the current state, and the refusal says whose state it is', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  const m = handTo(efsp, c, taskedLine(efsp, c, 'L23D1'), 'AIC', 'aic-on-station');
  refused(act(efsp, c.AIC, 'AIC', tac(efsp, m.stripId), { kind: 'SetState', toState: 'OFF_STATION' }),
    'PERMISSION_DENIED', /ON_STATION is not AIC's to change/, 'AIC SetState');
  // A DEPARTURE at PROPOSED is OPS's; once it is at PENDING_CLEARANCE OPS may not SetState it though it still owns it.
  let dep = mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, callsign: 'L23D2' } });
  dep = mustAct(efsp, c.OPS, 'OPS', dep, { kind: 'SetState', toState: 'PENDING_CLEARANCE' });
  refused(act(efsp, c.OPS, 'OPS', dep, { kind: 'SetState', toState: 'CLEARED' }), 'PERMISSION_DENIED', /PENDING_CLEARANCE is not OPS's to change/, 'OPS SetState');
});

test('B7 a legal SetState that leaves the Strip in a Bay implying another state says so and moves nothing (Q5)', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  const line = handTo(efsp, c, taskedLine(efsp, c, 'L23D3'), 'GCI', 'gci-on-station');
  const ack = act(efsp, c.GCI, 'GCI', tac(efsp, line.stripId), { kind: 'SetState', toState: 'RTB' });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.match(ack.warning, /no GCI Bay for RTB; the Strip stays in gci-on-station/);
  assert.equal(tac(efsp, line.stripId).bayId, 'gci-on-station');
});

// ── S-L24: every route to DROPPED goes through the retire path ─────────────

test('S-L24 SetState to DROPPED is the Drop: same guards, remove indicator, archive clock', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  const board = efsp.boardStoreFor('TACTICAL');
  const line = taskedLine(efsp, c, 'L23E1', 'OFF_STATION');
  const rtb = jumpTo(efsp, c.TAC_C2, 'TAC_C2', line, 'RTB');
  const ack = act(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, rtb.stripId), { kind: 'SetState', toState: 'DROPPED' });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.equal(tac(efsp, rtb.stripId).state, 'DROPPED');
  assert.equal(tac(efsp, rtb.stripId).flags.removeIndicator, true);
  assert.ok(board._droppedWallAt.has(rtb.stripId), 'the archive clock started');
});

test('S-L24 SetState to DROPPED under active tactical control is refused like a Drop', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  const { mission } = onStationUnderTofi(efsp, c, 'L23E2');
  const off = jumpTo(efsp, c.TAC_C2, 'TAC_C2', mission, 'OFF_STATION');
  const rtb = jumpTo(efsp, c.TAC_C2, 'TAC_C2', off, 'RTB');
  refused(act(efsp, c.TAC_C2, 'TAC_C2', tac(efsp, rtb.stripId), { kind: 'SetState', toState: 'DROPPED' }),
    'VALIDATION_ERROR', /active tactical control/, 'SetState DROPPED under TOFI');
});

test('S-L24 a refused TOFI retires the strip it minted through the same path (archive clock, remove indicator)', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  const atCenter = handedToCenter(efsp, c, airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'L23E3' }));
  const proposed = mustAct(efsp, c.CTR, 'CTR', atCenter, {
    kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2',
  });
  const minted = tac(efsp, proposed.tofiCoordination.peerStripId);
  mustAct(efsp, c.TAC_C2, 'TAC_C2', minted, { kind: 'TOFI', action: 'REJECT' });
  const after = tac(efsp, minted.stripId);
  assert.equal(after.state, 'DROPPED');
  assert.equal(after.flags.removeIndicator, true);
  assert.ok(efsp.boardStoreFor('TACTICAL')._droppedWallAt.has(minted.stripId));
});

// ── F10: a covering Position gives the Strips back ────────────────────────

test('F10 Strips routed to a covering Position go back, into the returning Position\'s Bay, when it is manned again', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK' });
  let s = mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, callsign: 'L23F1' } });
  s = mustAct(efsp, c.OPS, 'OPS', s, { kind: 'InvokeNla' }); // Send to Clearance: the Strip is CD's now
  assert.equal(inc(efsp, s.stripId).ownerPositionId, 'CD');
  assert.equal(inc(efsp, s.stripId).state, 'PENDING_CLEARANCE');

  hold(efsp, c.CD.session, 'INCIRLIK', []);
  assert.equal(inc(efsp, s.stripId).ownerPositionId, 'GND', 'covered by GND');
  assert.equal(inc(efsp, s.stripId).coveredFrom, 'CD');
  assert.ok(baysOf('GND', 'INCIRLIK').includes(inc(efsp, s.stripId).bayId));

  const newCd = { controllerId: 'c-CD2', who: 'CD2' };
  const back = hold(efsp, newCd, 'INCIRLIK', ['CD']);
  const after = inc(efsp, s.stripId);
  assert.equal(after.ownerPositionId, 'CD', 'returned');
  assert.equal(after.bayId, 'cd-pending-clearance');
  assert.equal(after.coveredFrom, undefined);
  assert.ok(back.broadcast.strips.updated.some(x => x.stripId === s.stripId), 'the return is broadcast');
});

test('F10 a Strip the covering Position transferred on by decision does not come back', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK' });
  let s = mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, callsign: 'L23F2' } });
  s = mustAct(efsp, c.OPS, 'OPS', s, { kind: 'InvokeNla' });
  hold(efsp, c.CD.session, 'INCIRLIK', []);
  mustAct(efsp, c.GND, 'GND', inc(efsp, s.stripId), { kind: 'TransferStrip', toPositionId: 'TWR', bayId: 'twr-coordination', rackId: 'main' });
  hold(efsp, { controllerId: 'c-CD3', who: 'CD3' }, 'INCIRLIK', ['CD']);
  assert.equal(inc(efsp, s.stripId).ownerPositionId, 'TWR');
});

// ── U7: a coordination link cannot outlive the side that could answer it ───

function poBoards(efsp) { return { app: efsp.boardStoreFor('INCIRLIK'), ctr: efsp.boardStoreFor('CENTER') }; }

for (const primitive of ['POINT_OUT', 'HANDOFF']) {
  test(`U7 ${primitive}: propose, accept, the receiver drops its side -> the proposer's link ends (audited) and it can act again`, () => {
    const efsp = freshEfsp();
    const c = crew(efsp, ALL);
    const dep = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: `L23U1${primitive[0]}` });
    const sent = mustAct(efsp, c.APP, 'APP', dep, { kind: primitive, action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' });
    const replica = ctrOf(efsp, sent.coordination.peerStripId);
    const accepted = mustAct(efsp, c.CTR, 'CTR', replica, { kind: primitive, action: 'ACCEPT' });
    assert.equal(inc(efsp, dep.stripId).coordination.state, 'ACTIVE');

    // The receiver drops its side (DropStrip goes through the retire path).
    const dropped = act(efsp, c.CTR, 'CTR', accepted, { kind: 'DropStrip' });
    assert.equal(dropped.ok, true, JSON.stringify(dropped));

    const mine = inc(efsp, dep.stripId);
    assert.equal(mine.coordination, null, 'return it to no coordination');
    assert.equal(mine.state, 'HANDED_OFF');
    // ...and the proposer is not stuck: it can propose again.
    const again = mustAct(efsp, c.APP, 'APP', mine, { kind: primitive, action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' });
    assert.equal(again.coordination.state, 'PROPOSED');
  });

  test(`U7 ${primitive}: the wire tells the proposer's Facility (peer broadcast) and the log names the system change`, () => {
    const efsp = freshEfsp();
    const c = crew(efsp, ALL);
    const dep = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: `L23U2${primitive[0]}` });
    const sent = mustAct(efsp, c.APP, 'APP', dep, { kind: primitive, action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' });
    const accepted = mustAct(efsp, c.CTR, 'CTR', ctrOf(efsp, sent.coordination.peerStripId), { kind: primitive, action: 'ACCEPT' });
    const res = efsp.handleMessage(c.CTR.session, {
      version: 1, type: 'efsp-mutation', clientMutationId: '00000000-0000-4000-8000-0000000000aa', facilityId: 'CENTER',
      actingPositionId: 'CTR', stripId: accepted.stripId, baseRev: accepted.rev, op: { kind: 'DropStrip' },
    });
    assert.equal(res.ack.ok, true);
    assert.ok(res.peerBroadcast, 'the proposer\'s Board is told');
    const seen = res.peerBroadcast.strips.updated.find(x => x.stripId === dep.stripId);
    assert.equal(seen.coordination, null);
    const log = fs.readFileSync(process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH, 'utf8');
    assert.match(log, /SystemCoordinationEnd/);
  });

  test(`U7 ${primitive}: propose, and the receiver's side ends before it answers -> the proposer is not left waiting`, () => {
    const efsp = freshEfsp();
    const c = crew(efsp, ALL);
    const dep = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: `L23U3${primitive[0]}` });
    const sent = mustAct(efsp, c.APP, 'APP', dep, { kind: primitive, action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' });
    // A controller cannot Drop an unanswered proposal (the open-link guard), so
    // the replica is retired the way a system path would (an archive, a state
    // override): the store must still end the proposer's link.
    const replica = ctrOf(efsp, sent.coordination.peerStripId);
    efsp.boardStoreFor('CENTER')._retireStrip(replica, null);
    assert.equal(inc(efsp, dep.stripId).coordination, null);
  });

  test(`U7 ${primitive}: the proposer can always cancel its own exchange (unanswered, accepted, refused); the replica cannot`, () => {
    const efsp = freshEfsp();
    const c = crew(efsp, ALL);
    // Unanswered: the replica is retired with the proposal.
    let dep = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: `L23U4${primitive[0]}` });
    let sent = mustAct(efsp, c.APP, 'APP', dep, { kind: primitive, action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' });
    const replica = ctrOf(efsp, sent.coordination.peerStripId);
    refused(act(efsp, c.CTR, 'CTR', replica, { kind: primitive, action: 'CANCEL' }), 'VALIDATION_ERROR', /only the proposer can cancel/, 'replica cancels');
    let cancelled = mustAct(efsp, c.APP, 'APP', sent, { kind: primitive, action: 'CANCEL' });
    assert.equal(cancelled.coordination, null);
    assert.equal(ctrOf(efsp, replica.stripId).state, 'DROPPED');

    // Accepted: the receiver's working Strip stays, minus the link.
    sent = mustAct(efsp, c.APP, 'APP', cancelled, { kind: primitive, action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' });
    const second = mustAct(efsp, c.CTR, 'CTR', ctrOf(efsp, sent.coordination.peerStripId), { kind: primitive, action: 'ACCEPT' });
    cancelled = mustAct(efsp, c.APP, 'APP', inc(efsp, dep.stripId), { kind: primitive, action: 'CANCEL' });
    assert.equal(cancelled.coordination, null);
    assert.notEqual(ctrOf(efsp, second.stripId).state, 'DROPPED');
    assert.equal(ctrOf(efsp, second.stripId).coordination, null);

    // Nothing to cancel.
    refused(act(efsp, c.APP, 'APP', inc(efsp, dep.stripId), { kind: primitive, action: 'CANCEL' }), 'VALIDATION_ERROR', /no coordination link/, 'cancel twice');
  });
}

test('U7 a receiver that Rejected and then dropped leaves the proposer\'s REJECTED record alone (only a live exchange is ended)', () => {
  const efsp = freshEfsp();
  const c = crew(efsp, ALL);
  const dep = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'L23U5' });
  const sent = mustAct(efsp, c.APP, 'APP', dep, { kind: 'POINT_OUT', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' });
  const rejected = mustAct(efsp, c.CTR, 'CTR', ctrOf(efsp, sent.coordination.peerStripId), { kind: 'POINT_OUT', action: 'REJECT' });
  act(efsp, c.CTR, 'CTR', rejected, { kind: 'DropStrip' });
  assert.equal(inc(efsp, dep.stripId).coordination.state, 'REJECTED');
});
