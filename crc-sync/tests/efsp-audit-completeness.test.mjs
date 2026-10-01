import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// L26 / docs/adr/0083: every EFSP Mutation outcome that reaches crc-sync produces
// exactly one Mutation-log entry, and every entry names its Facility and its FDR(s).
// Driven through createEfsp() and createEfspInstrumentation() together, as
// efsp-metrics-tap.test.mjs does.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-audit-completeness-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
  CRCSYNC_EFSP_TRAFFIC_COUNT_PATH: 'traffic-count.jsonl',
  CRCSYNC_EFSP_METRICS_PATH: 'metrics.json',
  CRCSYNC_EFSP_INSTRUMENTATION_CONFIG_PATH: 'instrumentation.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, JSON.stringify([
  { airspaceId: 'MOA-AUD', name: 'Audit MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 134.25 },
]));

const { createEfsp } = await import('../src/efsp/index.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const { createEfspInstrumentation } = await import('../src/efsp/metrics.js');
const { crew, hold, mustAct, jumpTo, airborneDeparture, handedToCenter, DEPARTURE_FDR } = await import('./helpers/efsp-scenario.mjs');

function quiet(fn) {
  const orig = console.warn;
  console.warn = () => {};
  try { return fn(); } finally { console.warn = orig; }
}

const efsp = createEfsp();
quiet(() => createEfspInstrumentation({
  efsp, facilityConfig,
  correlationStats: () => ({ rate: null, eligible: 0 }),
  obligationStats: () => ({}),
}));
const c = crew(efsp, { OPS: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER', TAC_C2: 'TACTICAL', JTAC: 'TACTICAL' });

const entriesFor = (cmid) => efsp.mutationLog.readAll().filter(e => e.clientMutationId === cmid);
const send = (member, msg) => efsp.handleMessage(member.session, { version: 1, facilityId: member.facilityId, ...msg });

// ── G1 ──

test('an airspace entry carries the clientMutationId of the message that caused it', () => {
  const cmid = crypto.randomUUID();
  const rec = efsp.airspaceStore.getAirspace('MOA-AUD');
  const r = send(c.CTR, {
    type: 'efsp-airspace-mutation', clientMutationId: cmid, airspaceId: 'MOA-AUD', baseRev: rec.rev, actingPositionId: 'CTR',
    op: { kind: 'ScheduleAirspace', fromUtc: Date.now(), toUtc: Date.now() + 3600000 },
  });
  assert.equal(r.ack.ok, true, JSON.stringify(r.ack));
  const [entry] = entriesFor(cmid);
  assert.ok(entry, 'one entry under the message\'s cmid');
  assert.equal(entry.airspaceId, 'MOA-AUD');
  assert.equal(entry.facilityId, 'CENTER', 'the airspace\'s own Facility');
  assert.equal(entriesFor(cmid).length, 1);
});

// ── G2 ──

function refusals() {
  const strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, callsign: 'AUD1' },
  });
  const rev = efsp.airspaceStore.getAirspace('MOA-AUD').rev;
  const fs0 = efsp.fieldStateStore.getFieldState('INCIRLIK');
  return [
    // Board path: the tap logs every efsp-mutation refusal.
    ['board: unknown facilityId', c.OPS, { type: 'efsp-mutation', facilityId: 'NOWHERE', actingPositionId: 'OPS', stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'SetFlag', flag: 'highlight', value: true } }, 'VALIDATION_ERROR'],
    ['board: NOT_HOLDING_POSITION', c.OPS, { type: 'efsp-mutation', actingPositionId: 'APP', stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'SetFlag', flag: 'highlight', value: true } }, 'NOT_HOLDING_POSITION'],
    ['board: STALE_REV', c.OPS, { type: 'efsp-mutation', actingPositionId: 'OPS', stripId: strip.stripId, baseRev: strip.rev - 1, op: { kind: 'SetBlock', blockId: '24', value: 'X' } }, 'STALE_REV'],
    ['board: PERMISSION_DENIED', c.TWR, { type: 'efsp-mutation', actingPositionId: 'TWR', op: { kind: 'CreateStrip', bayId: 'twr-airborne', rackId: 'main', role: 'DEPARTURE', fdr: DEPARTURE_FDR } }, 'PERMISSION_DENIED'],
    // Airspace: two store refusals that were never logged, one the store always logged, one pre-store.
    ['airspace: NOT_FOUND', c.CTR, { type: 'efsp-airspace-mutation', airspaceId: 'NO-SUCH', baseRev: 0, actingPositionId: 'CTR', op: { kind: 'ScheduleAirspace' } }, 'NOT_FOUND'],
    ['airspace: STALE_REV', c.CTR, { type: 'efsp-airspace-mutation', airspaceId: 'MOA-AUD', baseRev: rev + 5, actingPositionId: 'CTR', op: { kind: 'ScheduleAirspace' } }, 'STALE_REV'],
    ['airspace: PERMISSION_DENIED (store)', c.APP, { type: 'efsp-airspace-mutation', airspaceId: 'MOA-AUD', baseRev: rev, actingPositionId: 'APP', op: { kind: 'ApproveActivation' } }, 'PERMISSION_DENIED'],
    ['airspace: NOT_HOLDING_POSITION', c.APP, { type: 'efsp-airspace-mutation', airspaceId: 'MOA-AUD', baseRev: rev, actingPositionId: 'CTR', op: { kind: 'ApproveActivation' } }, 'NOT_HOLDING_POSITION'],
    // Correlation.
    ['correlation: NOT_HOLDING_POSITION', c.APP, { type: 'efsp-correlation-mutation', fdrId: strip.fdrId, baseRev: 0, actingPositionId: 'CTR', op: { kind: 'BindTrack', trackId: '1' } }, 'NOT_HOLDING_POSITION'],
    ['correlation: class PERMISSION_DENIED', c.JTAC, { type: 'efsp-correlation-mutation', fdrId: strip.fdrId, baseRev: 0, actingPositionId: 'JTAC', op: { kind: 'BindTrack', trackId: '1' } }, 'PERMISSION_DENIED'],
    ['correlation: store refusal', c.OPS, { type: 'efsp-correlation-mutation', fdrId: 'no-such-fdr', baseRev: 0, actingPositionId: 'OPS', op: { kind: 'BindTrack', trackId: '1' } }, null],
    // MARSA.
    ['marsa: NOT_HOLDING_POSITION', c.APP, { type: 'efsp-marsa-mutation', actingPositionId: 'CTR', op: { kind: 'DeclareMarsa', participants: [strip.fdrId] } }, 'NOT_HOLDING_POSITION'],
    ['marsa: class PERMISSION_DENIED', c.JTAC, { type: 'efsp-marsa-mutation', actingPositionId: 'JTAC', op: { kind: 'DeclareMarsa', participants: [strip.fdrId] } }, 'PERMISSION_DENIED'],
    ['marsa: store refusal', c.OPS, { type: 'efsp-marsa-mutation', actingPositionId: 'OPS', op: { kind: 'DeclareMarsa', participants: [] } }, null],
    // Field state.
    ['field state: NOT_HOLDING_POSITION', c.OPS, { type: 'efsp-field-state-mutation', actingPositionId: 'TWR', baseRev: fs0 && fs0.rev, op: { kind: 'CloseRunway' } }, 'NOT_HOLDING_POSITION'],
    ['field state: store refusal', c.OPS, { type: 'efsp-field-state-mutation', actingPositionId: 'OPS', baseRev: fs0 && fs0.rev, op: { kind: 'NoSuchOp' } }, null],
    // ATO import.
    ['ato: NOT_HOLDING_POSITION', c.OPS, { type: 'efsp-ato-mutation', actingPositionId: 'APP', op: { kind: 'ImportAto', text: 'x' } }, 'NOT_HOLDING_POSITION'],
  ];
}

test('every refusal is logged exactly once', () => {
  for (const [name, member, msg, reason] of refusals()) {
    const cmid = crypto.randomUUID();
    const result = send(member, { ...msg, clientMutationId: cmid });
    assert.equal(result.ack.ok, false, `${name}: ${JSON.stringify(result.ack)}`);
    if (reason) assert.equal(result.ack.reason, reason, name);
    assert.equal('unaudited' in result.ack, false, `${name}: unaudited never reaches the wire (T2)`);
    const entries = entriesFor(cmid);
    assert.equal(entries.length, 1, `${name}: ${entries.length} entries`);
    assert.equal(entries[0].ok, false, name);
    assert.equal(entries[0].reason, result.ack.reason, name);
    assert.ok('facilityId' in entries[0], `${name}: names its facilityId (a value or null)`);
    // A retry of the same message is not logged again.
    send(member, { ...msg, clientMutationId: cmid });
    assert.equal(entriesFor(cmid).length, 1, `${name}: a replay adds no line`);
  }
});

// ── G4 ──

test('every entry written by any path names its facilityId, and its FDR where it has one', () => {
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'AUD2' });
  const handed = handedToCenter(efsp, c, strip);
  // A correlation and a MARSA, a field-state op, a covering reassignment.
  send(c.OPS, { type: 'efsp-correlation-mutation', clientMutationId: crypto.randomUUID(), fdrId: handed.fdrId, baseRev: 0, actingPositionId: 'OPS', op: { kind: 'BindTrack', trackId: '9' } });
  const other = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'AUD3' });
  send(c.OPS, { type: 'efsp-marsa-mutation', clientMutationId: crypto.randomUUID(), actingPositionId: 'OPS', op: { kind: 'DeclareMarsa', participants: [strip.fdrId, other.fdrId], startEvent: 'LOCAL_DECLARATION', endCondition: 'MTR_COMPLETE', declaringCallsign: 'AUD2' } });
  send(c.OPS, { type: 'efsp-field-state-mutation', clientMutationId: crypto.randomUUID(), actingPositionId: 'TWR', op: { kind: 'CloseRunway' } });
  let tw = mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, callsign: 'AUD8' } });
  tw = jumpTo(efsp, c.OPS, 'OPS', tw, 'DEPARTED');
  mustAct(efsp, c.OPS, 'OPS', tw, { kind: 'TransferStrip', toPositionId: 'TWR', bayId: 'twr-airborne', rackId: 'main' });
  hold(efsp, c.TWR.session, 'INCIRLIK', []); // TWR vacates; APP covers it
  hold(efsp, c.TWR.session, 'INCIRLIK', ['TWR']);

  const all = efsp.mutationLog.readAll();
  const missing = all.filter(e => !('facilityId' in e)).map(e => e.op);
  assert.deepEqual(missing, [], 'every entry carries a facilityId key');
  for (const e of all.filter(x => x.type === undefined && x.stripId && x.op !== 'Archive')) {
    assert.ok(e.fdrId, `${e.op} on a Strip names its FDR`);
  }
  assert.ok(all.some(e => e.op === 'SystemReassign' && e.facilityId === 'INCIRLIK' && e.fdrId));
  const correlation = all.find(e => e.op === 'BindTrack' && e.ok);
  if (correlation) assert.equal(correlation.facilityId, null, 'theater-wide');
  const marsa = all.find(e => e.op === 'DeclareMarsa' && e.ok);
  assert.ok(marsa, JSON.stringify(all.filter(e => e.op === 'DeclareMarsa')));
  assert.equal(marsa.facilityId, null);
  assert.deepEqual([...marsa.fdrIds].sort(), [strip.fdrId, other.fdrId].sort());
  const field = all.find(e => e.op === 'CloseRunway');
  assert.equal(field.facilityId, 'INCIRLIK');
});

test('a SetBlock entry records the Block id and value; a coordination entry its action', () => {
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'AUD4' });
  const cmid = crypto.randomUUID();
  const r = send(c.APP, { type: 'efsp-mutation', clientMutationId: cmid, actingPositionId: 'APP', stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'SetBlock', blockId: '24', value: 'RED 1' } });
  assert.equal(r.ack.ok, true, JSON.stringify(r.ack));
  const [e] = entriesFor(cmid);
  assert.equal(e.blockId, '24');
  assert.equal(e.value, 'RED 1');
  const pcmid = crypto.randomUUID();
  const p = send(c.APP, { type: 'efsp-mutation', clientMutationId: pcmid, actingPositionId: 'APP', stripId: strip.stripId, baseRev: r.ack.strip.rev, op: { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' } });
  assert.equal(p.ack.ok, true, JSON.stringify(p.ack));
  assert.equal(entriesFor(pcmid)[0].action, 'PROPOSE');
  const ccmid = crypto.randomUUID();
  const x = send(c.APP, { type: 'efsp-mutation', clientMutationId: ccmid, actingPositionId: 'APP', stripId: strip.stripId, baseRev: p.ack.strip.rev, op: { kind: 'HANDOFF', action: 'CANCEL' } });
  assert.equal(x.ack.ok, true, JSON.stringify(x.ack));
  assert.equal(entriesFor(ccmid)[0].action, 'CANCEL');
  const peers = efsp.mutationLog.readAll().filter(en => en.causedBy === ccmid);
  assert.deepEqual(peers.map(en => en.op), ['PeerCoordinationCancel']);
});

// ── G3 ──

function sendOp(member, positionId, strip, op) {
  const cmid = crypto.randomUUID();
  const r = send(member, { type: 'efsp-mutation', clientMutationId: cmid, actingPositionId: positionId, stripId: strip.stripId, baseRev: strip.rev, op });
  assert.equal(r.ack.ok, true, `${op.kind}: ${JSON.stringify(r.ack)}`);
  return { cmid, strip: r.ack.strip };
}
const peerLines = (cmid) => efsp.mutationLog.readAll().filter(e => e.causedBy === cmid && e.source === 'peer');

test('a coordination proposal writes one entry on each Board, linked by causedBy', () => {
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'AUD5' });
  const proposed = sendOp(c.APP, 'APP', strip, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' });
  const own = entriesFor(proposed.cmid);
  assert.equal(own.length, 1);
  assert.equal(own[0].facilityId, 'INCIRLIK');
  const [peer] = peerLines(proposed.cmid);
  assert.equal(peer.op, 'PeerCoordinationProposal');
  assert.equal(peer.clientMutationId, null, 'a peer line is never a second application (Q2)');
  assert.equal(peer.facilityId, 'CENTER');
  assert.equal(peer.fromFacilityId, 'INCIRLIK');
  assert.equal(peer.fdrId, strip.fdrId);
  assert.equal(peer.before, null);

  const replica = efsp.boardStoreFor('CENTER').getStrip(proposed.strip.coordination.peerStripId);
  const accepted = sendOp(c.CTR, 'CTR', replica, { kind: 'HANDOFF', action: 'ACCEPT' });
  const [resp] = peerLines(accepted.cmid);
  assert.equal(resp.op, 'PeerCoordinationResponse');
  assert.equal(resp.action, 'ACCEPT');
  assert.equal(resp.facilityId, 'INCIRLIK');
  assert.equal(resp.fromFacilityId, 'CENTER');
  assert.equal(resp.stripId, strip.stripId);
  assert.equal(resp.after.coordination.state, 'ACTIVE');
});

test('each TOFI step writes a linked entry on the other Board, and none of them is a drop (T5)', () => {
  const strip = handedToCenter(efsp, c, airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'AUD6' }));
  const entry = sendOp(c.CTR, 'CTR', strip, { kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2' });
  const [p1] = peerLines(entry.cmid);
  assert.equal(p1.op, 'PeerTofiProposal');
  assert.equal(p1.facilityId, 'TACTICAL');
  assert.equal(p1.fromFacilityId, 'CENTER');
  const mission = efsp.boardStoreFor('TACTICAL').getStrip(entry.strip.tofiCoordination.peerStripId);
  const acc = sendOp(c.TAC_C2, 'TAC_C2', mission, { kind: 'TOFI', action: 'ACCEPT', separationRegime: 'MARSA' });
  const [p2] = peerLines(acc.cmid);
  assert.equal(p2.op, 'PeerTofiResponse');
  assert.equal(p2.action, 'ACCEPT');
  assert.equal(p2.facilityId, 'CENTER');
  const missionNow = efsp.boardStoreFor('TACTICAL').getStrip(mission.stripId);
  const comms = sendOp(c.TAC_C2, 'TAC_C2', missionNow, { kind: 'TOFI', action: 'TRANSFER_COMMS' });
  assert.equal(peerLines(comms.cmid)[0].action, 'TRANSFER_COMMS');
  // EXIT: the ATC side proposes, the MISSION side's replica is re-entered.
  const ctrNow = efsp.boardStoreFor('CENTER').getStrip(strip.stripId);
  const ctrReg = sendOp(c.CTR, 'CTR', ctrNow, { kind: 'SetBlock', blockId: 'SREG', value: 'ATC' });
  const exit = sendOp(c.CTR, 'CTR', ctrReg.strip, { kind: 'TOFI', action: 'PROPOSE', direction: 'EXIT' });
  assert.equal(peerLines(exit.cmid)[0].op, 'PeerTofiExitProposal');
  const exitAcc = sendOp(c.TAC_C2, 'TAC_C2', efsp.boardStoreFor('TACTICAL').getStrip(mission.stripId), { kind: 'TOFI', action: 'ACCEPT' });
  assert.equal(peerLines(exitAcc.cmid)[0].after.tofiCoordination.state, 'COMPLETE');

  // No peer entry is a drop transition, and none carries a cmid.
  for (const e of efsp.mutationLog.readAll().filter(x => x.source === 'peer')) {
    assert.equal(e.clientMutationId, null);
    assert.ok(e.causedBy, `${e.op} says what caused it`);
  }
});

test('no two entries share a non-null clientMutationId except a refusal and its retry', () => {
  const seen = new Map();
  for (const e of efsp.mutationLog.readAll()) {
    if (e.clientMutationId === null || e.clientMutationId === undefined) continue;
    if (!seen.has(e.clientMutationId)) seen.set(e.clientMutationId, []);
    seen.get(e.clientMutationId).push(e);
  }
  for (const [cmid, list] of seen) {
    if (list.length > 1) assert.ok(list.some(e => e.ok === false), `${cmid} appears ${list.length} times`);
  }
});

test('a backfilled drop of a Strip no Board still holds keeps its Facility from the entry', async () => {
  const { TrafficCount } = await import('../src/efsp/traffic-count.js');
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'AUD7' });
  const dropped = mustAct(efsp, c.APP, 'APP', jumpTo(efsp, c.APP, 'APP', strip, 'HANDED_OFF'), { kind: 'DropStrip' });
  assert.equal(dropped.state, 'DROPPED');
  const noBoards = quiet(() => new TrafficCount({
    mutationLog: efsp.mutationLog, fdrStore: { getFdr: () => null }, boardStoreFor: () => null,
    facilityIds: facilityConfig.getFacilityIds(), config: { retentionDays: 400, homeAirports: {} },
    path: path.join(tmpDir, 'no-boards.jsonl'),
  }));
  noBoards.close();
  const rec = noBoards.records().find(r => r.stripId === dropped.stripId);
  assert.ok(rec, 'the drop is backfilled');
  assert.equal(rec.facilityId, 'INCIRLIK');
});

test('the field state on the wire carries the configured acknowledgers and inspection authority (S-L1b)', () => {
  const state = efsp.fieldStateStore.getFieldState('INCIRLIK');
  assert.deepEqual(state.runwayChangeAcknowledgers, ['OPS', 'APP']);
  assert.equal(state.inspectionAuthorityPositionId, 'OPS');
  state.runwayChangeAcknowledgers.push('X');
  assert.deepEqual(efsp.fieldStateStore.getFieldState('INCIRLIK').runwayChangeAcknowledgers, ['OPS', 'APP'], 'a copy');
});
