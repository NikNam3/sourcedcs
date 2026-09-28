import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// The server half of the EFSP UI catalogue (docs/ui-findings/) — the findings
// whose cause turned out to be in crc-sync rather than in the panel:
//
//   F-102  a state-only NLA left the Strip in the Bay for its OLD state
//   F-111  a MARSA declare/void wrote the separation regime and told nobody
//   F-206  whether the server accepts CLEARING an enum Block
//   F-303  a rejected coordination replica was still fully workable
//   F-306  the regime stated when accepting TOFI reached neither screen
//   F-408  an NLA the server would refuse looked exactly like one it wouldn't
//
// Driven through createEfsp() + handleMessage — the real composition root and
// the real wire path — because every one of these is about what actually
// reaches a client, and a hand-built rules object cannot answer that.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-ui-findings-test-'));
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH = path.join(tmpDir, 'incirlik.json');
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER = path.join(tmpDir, 'center.json');
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL = path.join(tmpDir, 'tactical.json');
process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH = path.join(tmpDir, 'board.json');
process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH = path.join(tmpDir, 'mutations.jsonl');
process.env.CRCSYNC_EFSP_AIRSPACES_PATH = path.join(tmpDir, 'airspaces.json');
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, JSON.stringify([]));

const { createEfsp } = await import('../src/efsp/index.js');

// ── harness ───────────────────────────────────────────────────────────────

function crew(efsp, spec) {
  const sessions = {};
  for (const [positionId, facilityId] of Object.entries(spec)) {
    const session = { controllerId: `c-${positionId}`, who: positionId };
    efsp.handleMessage(session, { type: 'efsp-set-positions', facilityId, held: [positionId] });
    sessions[positionId] = { session, facilityId };
  }
  return sessions;
}

function send(efsp, crewMember, positionId, strip, op) {
  return efsp.handleMessage(crewMember.session, {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: crewMember.facilityId, actingPositionId: positionId,
    stripId: strip ? strip.stripId : undefined, baseRev: strip ? strip.rev : undefined,
    op,
  });
}

function act(efsp, crewMember, positionId, strip, op) {
  return send(efsp, crewMember, positionId, strip, op).ack;
}

function mustAct(efsp, crewMember, positionId, strip, op) {
  const ack = act(efsp, crewMember, positionId, strip, op);
  assert.equal(ack.ok, true, `${op.kind} as ${positionId}: ${JSON.stringify(ack)}`);
  return ack.strip;
}

const NLA_DOUBLE_TAP_MS = 400; // board-store.js's _applyInvokeNla guard
async function advance(efsp, crewMember, positionId, strip) {
  await new Promise(resolve => setTimeout(resolve, NLA_DOUBLE_TAP_MS + 10));
  return mustAct(efsp, crewMember, positionId, strip, { kind: 'InvokeNla' });
}

const FILED = {
  aircraftType: 'F16', wakeCategory: 'D',
  departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250',
};

function createDeparture(efsp, c, callsign, filed = FILED) {
  return mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE',
    fdr: { callsign, ...filed },
  });
}

// ── F-102 — Bay membership expresses operational state ────────────────────

test('F-102: every NLA in the departure chain leaves the Strip in the Bay for its NEW state', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK' });
  let strip = createDeparture(efsp, c, 'VPR102');

  // The exact table docs/ui-findings/lane1.md F-102 measured, made to come out
  // right. LUAW is the deliberate blank: TWR has no Bay implying it, so the
  // Strip correctly stays where it was.
  const walk = [
    ['OPS', 'cd-pending-clearance', 'PENDING_CLEARANCE'],
    ['CD',  'cd-cleared',           'CLEARED'],
    ['CD',  'gnd-pushback',         'PUSHBACK'],
    ['GND', 'gnd-taxi-out',         'TAXI'],
    ['GND', 'twr-runway-queue',     'RUNWAY_QUEUE'],
    ['TWR', 'twr-runway-queue',     'LUAW'],
    ['TWR', 'twr-airborne',         'DEPARTED'],
    ['TWR', 'app-departures',       'HANDED_OFF'],
  ];
  for (const [positionId, bayId, state] of walk) {
    strip = await advance(efsp, c[positionId], positionId, strip);
    assert.equal(strip.state, state);
    assert.equal(strip.bayId, bayId, `after reaching ${state}`);
  }
});

test('F-102: a relocated Strip lands at the END of the destination Rack, not on top of it', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK' });

  // Two Strips already sitting in cd-cleared, so "append" and "prepend" are
  // distinguishable at all.
  const sitting = [];
  for (const callsign of ['SIT01', 'SIT02']) {
    let s = createDeparture(efsp, c, callsign);
    s = await advance(efsp, c.OPS, 'OPS', s);
    sitting.push(await advance(efsp, c.CD, 'CD', s));
  }
  assert.deepEqual(sitting.map(s => s.bayId), ['cd-cleared', 'cd-cleared']);

  let late = createDeparture(efsp, c, 'LATE01');
  late = await advance(efsp, c.OPS, 'OPS', late);
  late = await advance(efsp, c.CD, 'CD', late);

  const rack = efsp.boardStoreFor('INCIRLIK').getRack('cd-cleared', 'main');
  assert.deepEqual(rack.map(s => s.stripId), [...sitting.map(s => s.stripId), late.stripId]);
});

test('F-102: Undo puts the Strip back in the Bay it came from, not just the state', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK' });
  let strip = createDeparture(efsp, c, 'UND102');
  strip = await advance(efsp, c.OPS, 'OPS', strip);
  strip = await advance(efsp, c.CD, 'CD', strip);
  assert.equal(strip.bayId, 'cd-cleared');

  const undone = mustAct(efsp, c.CD, 'CD', strip, { kind: 'Undo' });
  assert.equal(undone.state, 'PENDING_CLEARANCE');
  assert.equal(undone.bayId, 'cd-pending-clearance');
});

// ── F-408 — the inhibit reason is on the wire before the press ────────────

test('F-408: every Strip on the wire carries what its NLA would do and why it would be refused', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK' });
  const strip = createDeparture(efsp, c, 'ADV408', { ...FILED, route: '', requestedAltitude: '' });

  // The ack's own Strip record carries it, so the client that made the change
  // has it without waiting for anything else.
  const proposed = mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'SetFlag', flag: 'highlight', value: 'RED' });
  assert.deepEqual(proposed.nla, { toState: 'PENDING_CLEARANCE', transferTo: 'CD' });

  const atCd = await advance(efsp, c.OPS, 'OPS', proposed);
  assert.equal(atCd.nla.reason, 'NLA_INHIBITED');
  assert.equal(atCd.nla.inhibited, 'flight plan incomplete — ALT, RTE not filed');

  // ...and the reason is EXACTLY what pressing it returns. One wording, one
  // source (board-store's _nlaPrecheck / nla.js's own table).
  const refused = act(efsp, c.CD, 'CD', atCd, { kind: 'InvokeNla' });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, atCd.nla.reason);
  assert.equal(refused.detail, atCd.nla.inhibited);
});

test('F-408: giving up the receiving Position re-sends every Strip with its new inhibit reason', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK' });
  let strip = createDeparture(efsp, c, 'REL408');
  strip = mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'SetFlag', flag: 'attention', value: null });
  assert.equal(strip.nla.toState, 'PENDING_CLEARANCE');

  // CD goes away. Nothing covers it, so Send to Clearance is now inhibited —
  // and the Strip it applies to was not itself touched by this message, which
  // is the whole reason the broadcast carries the Board rather than a diff.
  const out = efsp.handleMessage(c.CD.session, { type: 'efsp-set-positions', facilityId: 'INCIRLIK', held: [] });
  const sent = out.broadcast.strips.updated.find(s => s.stripId === strip.stripId);
  assert.ok(sent, 'the untouched Strip is in the broadcast');
  assert.deepEqual(sent.nla, { inhibited: 'no receiving Position present', reason: 'NLA_INHIBITED' });

  // Advisory only — the press is still refused server-side, with the same words.
  const refused = act(efsp, c.OPS, 'OPS', strip, { kind: 'InvokeNla' });
  assert.equal(refused.ok, false);
  assert.equal(refused.detail, 'no receiving Position present');
});

test('F-408: a terminal state has no NLA at all, and says so as null rather than an inhibit', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK' });
  const strip = createDeparture(efsp, c, 'TRM408');
  const snapshot = efsp.snapshotFor();
  assert.ok(snapshot.strips.find(s => s.stripId === strip.stripId).nla, 'a live Strip has one');

  const dropped = mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'DropStrip' });
  assert.equal(dropped.state, 'DROPPED');
  assert.equal(dropped.nla, null);
});

// ── F-111 / F-306 — an FDR written as a side effect reaches the clients ───

test('F-111: declaring MARSA broadcasts the participants\' FDRs, not just the relation', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK' });
  const a = createDeparture(efsp, c, 'TNK111');
  const b = createDeparture(efsp, c, 'VPR111');

  const out = efsp.handleMessage(c.OPS.session, {
    version: 1, type: 'efsp-marsa-mutation', clientMutationId: crypto.randomUUID(),
    actingPositionId: 'OPS',
    op: {
      kind: 'DeclareMarsa', participants: [a.fdrId, b.fdrId],
      declaringCallsign: 'SHELL71', startEvent: 'TANKER_ACCEPTED', endCondition: 'VERTICALLY_POSITIONED',
    },
  });
  assert.equal(out.ack.ok, true, JSON.stringify(out.ack));
  assert.equal(out.marsaBroadcast.type, 'efsp-marsa-delta');

  const fdrs = out.broadcast.fdrs.updated;
  assert.equal(out.broadcast.type, 'efsp-board-delta');
  assert.deepEqual(fdrs.map(f => f.fdrId).sort(), [a.fdrId, b.fdrId].sort());
  for (const fdr of fdrs) assert.equal(fdr.tofi.separationRegime, 'MARSA');
});

test('F-111: ending a relation broadcasts the regime going back to ATC', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK' });
  const a = createDeparture(efsp, c, 'TNK112');
  const b = createDeparture(efsp, c, 'VPR112');
  const marsa = (op, relation) => efsp.handleMessage(c.OPS.session, {
    version: 1, type: 'efsp-marsa-mutation', clientMutationId: crypto.randomUUID(),
    marsaId: relation ? relation.marsaId : undefined, baseRev: relation ? relation.rev : undefined,
    actingPositionId: 'OPS', op,
  });

  const declared = marsa({
    kind: 'DeclareMarsa', participants: [a.fdrId, b.fdrId],
    declaringCallsign: 'SHELL71', startEvent: 'TANKER_ACCEPTED', endCondition: 'VERTICALLY_POSITIONED',
  }).ack.marsa;

  const ended = marsa({ kind: 'EndMarsa' }, declared);
  assert.equal(ended.ack.ok, true, JSON.stringify(ended.ack));
  const fdrs = ended.broadcast.fdrs.updated;
  assert.deepEqual(fdrs.map(f => f.fdrId).sort(), [a.fdrId, b.fdrId].sort());
  for (const fdr of fdrs) assert.equal(fdr.tofi.separationRegime, 'ATC');
});

test('F-111: the interlock void rides the same board-delta as the clearance that caused it', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK' });
  const a = createDeparture(efsp, c, 'TNK113');
  const b = createDeparture(efsp, c, 'VPR113');
  efsp.handleMessage(c.OPS.session, {
    version: 1, type: 'efsp-marsa-mutation', clientMutationId: crypto.randomUUID(),
    actingPositionId: 'OPS',
    op: {
      kind: 'DeclareMarsa', participants: [a.fdrId, b.fdrId],
      declaringCallsign: 'SHELL71', startEvent: 'TANKER_ACCEPTED', endCondition: 'VERTICALLY_POSITIONED',
    },
  });

  // Block 21 is INIT ALT on a DEPARTURE — an altitude assignment before
  // rendezvous, which voids the relation (§9.2 rule 2).
  const fresh = efsp.boardStoreFor('INCIRLIK').getStrip(a.stripId);
  const out = send(efsp, c.OPS, 'OPS', fresh, { kind: 'SetBlock', blockId: '21', value: '5000' });
  assert.equal(out.ack.ok, true, JSON.stringify(out.ack));
  assert.equal(out.marsaBroadcast.marsa.updated[0].state, 'VOIDED');

  const byId = new Map(out.broadcast.fdrs.updated.map(f => [f.fdrId, f]));
  assert.deepEqual([...byId.keys()].sort(), [a.fdrId, b.fdrId].sort(), 'both participants, not just the one cleared');
  for (const fdr of byId.values()) assert.equal(fdr.tofi.separationRegime, 'ATC');
});

// ── F-206 — clearing an enum Block ────────────────────────────────────────

test('F-206: SREG and RSVC accept being cleared; the four Blocks with no "unset" value do not', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK' });
  let strip = createDeparture(efsp, c, 'CLR206');

  // Set then clear, for the two whose FDR field genuinely starts as null.
  for (const [blockId, value, field] of [['SREG', 'DUE_REGARD', 'separationRegime'], ['RSVC', 'ACTIVE', 'radarService']]) {
    strip = mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'SetBlock', blockId, value });
    assert.equal(efsp.fdrStore.getFdr(strip.fdrId).tofi[field], value);
    strip = mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'SetBlock', blockId, value: '' });
    assert.equal(efsp.fdrStore.getFdr(strip.fdrId).tofi[field], null, `${blockId} cleared`);
  }

  // The other four have no null state to return to — their "cleared" value is
  // a member of the enum itself (NONE / CLEAN), or the field is exhaustive
  // (14A's release states, 24A's two ownership directions). The server refuses,
  // which is the answer the client needs in order not to offer "—" for them.
  for (const blockId of ['5A', '14A', '24A', '3G']) {
    const refused = act(efsp, c.OPS, 'OPS', strip, { kind: 'SetBlock', blockId, value: '' });
    assert.equal(refused.ok, false, `${blockId} clear`);
    assert.equal(refused.reason, 'VALIDATION_ERROR', `${blockId} clear`);
  }
});

// ── F-303 — a rejected replica is inert ───────────────────────────────────

test('F-303: the facility that rejected a coordination cannot then work the replica', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', APP: 'INCIRLIK', TWR: 'INCIRLIK', CTR: 'CENTER' });

  // A CENTER-held INBOUND ARRIVAL, point-outed to INCIRLIK's APP.
  const ctrStrip = mustAct(efsp, c.CTR, 'CTR', null, {
    kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', role: 'ARRIVAL',
    fdr: { callsign: 'DED303', aircraftType: 'F16', wakeCategory: 'D', originAirport: 'LTAC', destinationAirport: 'LTAG', route: 'DCT', requestedAltitude: '250' },
  });
  const proposed = mustAct(efsp, c.CTR, 'CTR', ctrStrip, {
    kind: 'POINT_OUT', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'APP',
  });

  const incirlik = efsp.boardStoreFor('INCIRLIK');
  const replica = incirlik.getStrip(proposed.coordination.peerStripId);
  const rejected = mustAct(efsp, c.APP, 'APP', replica, { kind: 'POINT_OUT', action: 'REJECT' });
  assert.equal(rejected.coordination.state, 'REJECTED');
  assert.equal(rejected.bayId, 'app-coordination', 'left inert where it landed, not reaped');

  // The panel is told before the press (F-408's shape)...
  assert.equal(rejected.nla.reason, 'VALIDATION_ERROR');
  assert.match(rejected.nla.inhibited, /rejected — the replica is inert/);

  // ...and the press itself is refused, which is the half that matters.
  const handed = act(efsp, c.APP, 'APP', rejected, { kind: 'InvokeNla' });
  assert.equal(handed.ok, false);
  assert.equal(handed.reason, 'VALIDATION_ERROR');
  assert.match(handed.detail, /POINT_OUT was rejected/);
  assert.equal(incirlik.getStrip(replica.stripId).state, 'INBOUND', 'never reached HANDED_TO_TOWER');

  // Nor by dragging it into a Bay that implies the state the button would have set.
  const dragged = act(efsp, c.APP, 'APP', rejected, {
    kind: 'MoveStrip', bayId: 'twr-arrivals', rackId: 'main',
  });
  assert.equal(dragged.ok, false);
  assert.match(dragged.detail, /POINT_OUT was rejected/);
});

test('F-303: the SENDER\'s own Strip reads REJECTED too, and stays fully workable', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { APP: 'INCIRLIK', TWR: 'INCIRLIK', CTR: 'CENTER' });
  const ctrStrip = mustAct(efsp, c.CTR, 'CTR', null, {
    kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', role: 'ARRIVAL',
    fdr: { callsign: 'SND303', aircraftType: 'F16', wakeCategory: 'D', originAirport: 'LTAC', destinationAirport: 'LTAG', route: 'DCT', requestedAltitude: '250' },
  });
  const proposed = mustAct(efsp, c.CTR, 'CTR', ctrStrip, {
    kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'APP',
  });
  const replica = efsp.boardStoreFor('INCIRLIK').getStrip(proposed.coordination.peerStripId);
  mustAct(efsp, c.APP, 'APP', replica, { kind: 'HANDOFF', action: 'REJECT' });

  // CENTER still owns the flight and must be able to carry on working it —
  // including proposing the handoff again. Both records read REJECTED, so
  // telling them apart is the whole of _isRejectedReplica.
  const sender = efsp.boardStoreFor('CENTER').getStrip(ctrStrip.stripId);
  assert.equal(sender.coordination.state, 'REJECTED');
  const retried = act(efsp, c.CTR, 'CTR', sender, {
    kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'APP',
  });
  assert.equal(retried.ok, true, JSON.stringify(retried));
});

test('F-303: Drop is the one NLA a dead replica keeps — it is how it gets cleared', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER' });
  const appStrip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE',
    fdr: { callsign: 'DRP303', ...FILED },
  });
  const handedOff = mustAct(efsp, c.OPS, 'OPS', appStrip, { kind: 'SetState', toState: 'HANDED_OFF' });
  const atApp = mustAct(efsp, c.OPS, 'OPS', handedOff, {
    kind: 'TransferStrip', toPositionId: 'APP', bayId: 'app-departures', rackId: 'main',
  });
  const proposed = mustAct(efsp, c.APP, 'APP', atApp, {
    kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR',
  });
  const replica = efsp.boardStoreFor('CENTER').getStrip(proposed.coordination.peerStripId);
  const rejected = mustAct(efsp, c.CTR, 'CTR', replica, { kind: 'HANDOFF', action: 'REJECT' });

  // HANDED_OFF's only NLA is Drop, and it must still work.
  assert.deepEqual(rejected.nla, { toState: 'DROPPED' });
  const dropped = mustAct(efsp, c.CTR, 'CTR', rejected, { kind: 'InvokeNla' });
  assert.equal(dropped.state, 'DROPPED');
});

// APP → CTR HANDOFF of a DEPARTURE, answered by CTR. Returns CENTER's replica.
function handoffToCenter(efsp, c, callsign, answer) {
  const created = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE',
    fdr: { callsign, ...FILED },
  });
  const handedOff = mustAct(efsp, c.OPS, 'OPS', created, { kind: 'SetState', toState: 'HANDED_OFF' });
  const atApp = mustAct(efsp, c.OPS, 'OPS', handedOff, {
    kind: 'TransferStrip', toPositionId: 'APP', bayId: 'app-departures', rackId: 'main',
  });
  const proposed = mustAct(efsp, c.APP, 'APP', atApp, {
    kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR',
  });
  const replica = efsp.boardStoreFor('CENTER').getStrip(proposed.coordination.peerStripId);
  if (!answer) return { sender: proposed, replica };
  return { sender: proposed, replica: mustAct(efsp, c.CTR, 'CTR', replica, { kind: 'HANDOFF', action: answer }) };
}

test('F-303: a rejected replica refuses every op except the ones that clear it away', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER', TAC_C2: 'TACTICAL' });
  const { replica } = handoffToCenter(efsp, c, 'INR303', 'REJECT');
  assert.equal(replica.coordination.state, 'REJECTED');

  // The user-reported case first: CTR rejected APP's handoff and could then
  // open tactical control on the dead copy, minting a MISSION Strip on
  // TACTICAL for a flight APP still worked.
  const refusedOps = [
    { kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2' },
    { kind: 'ConvertToArrival' },
    { kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-EAST' },
    { kind: 'ClearAirspaceEntry' },
    { kind: 'SetBlock', blockId: '22', value: '251.000' },
    { kind: 'SetFlag', flag: 'highlight', value: 'RED' },
    { kind: 'SetState', toState: 'INBOUND' },
    { kind: 'TransferStrip', toPositionId: 'CTR', bayId: 'ctr-departures', rackId: 'main' },
    { kind: 'Undo' },
    { kind: 'POINT_OUT', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'APP' },
  ];
  for (const op of refusedOps) {
    const ack = act(efsp, c.CTR, 'CTR', replica, op);
    assert.equal(ack.ok, false, `${op.kind} must be refused`);
    assert.equal(ack.reason, 'VALIDATION_ERROR', op.kind);
    assert.match(ack.detail, /HANDOFF was rejected — the replica is inert, and APP still works the flight/, op.kind);
  }
  assert.equal(efsp.boardStoreFor('TACTICAL').getAll().length, 0, 'no MISSION Strip was minted');

  // Moving it aside, and dropping it, both still work.
  const moved = mustAct(efsp, c.CTR, 'CTR', replica, { kind: 'MoveStrip', bayId: 'ctr-app-coordination', rackId: 'main' });
  const dropped = mustAct(efsp, c.CTR, 'CTR', moved, { kind: 'DropStrip' });
  assert.equal(dropped.state, 'DROPPED');
});

test('F-303: the sender of a rejected handoff keeps working its own Strip', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER' });
  const { sender } = handoffToCenter(efsp, c, 'SND304', 'REJECT');
  const own = efsp.boardStoreFor('INCIRLIK').getStrip(sender.stripId);
  assert.equal(own.coordination.state, 'REJECTED');
  mustAct(efsp, c.APP, 'APP', own, { kind: 'SetBlock', blockId: '22', value: '251.000' });
});

test('a TOFI cannot be opened while a coordination proposal on the same Strip is still open', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER', TAC_C2: 'TACTICAL' });
  const { replica } = handoffToCenter(efsp, c, 'PND303');
  assert.equal(replica.coordination.state, 'PROPOSED');

  const ack = act(efsp, c.CTR, 'CTR', replica, {
    kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2',
  });
  assert.equal(ack.ok, false);
  assert.match(ack.detail, /while a coordination proposal is open/);
  assert.equal(efsp.boardStoreFor('TACTICAL').getAll().length, 0);

  // Once accepted, the same proposal goes through.
  const accepted = mustAct(efsp, c.CTR, 'CTR', replica, { kind: 'HANDOFF', action: 'ACCEPT' });
  mustAct(efsp, c.CTR, 'CTR', accepted, {
    kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2',
  });
});

// ── F-306 — the regime stated when accepting TOFI ─────────────────────────

test('F-306: accepting a TOFI ENTRY carries the regime it wrote in the ack AND the broadcast', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { CTR: 'CENTER', TAC_C2: 'TACTICAL' });

  // ctr-enroute implies INBOUND, which is where an ARRIVAL Strip may open a
  // TOFI ENTRY (coordination.js's TOFI_ELIGIBLE_STATES).
  const ctrStrip = mustAct(efsp, c.CTR, 'CTR', null, {
    kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', role: 'ARRIVAL',
    fdr: { callsign: 'SRG306', aircraftType: 'F16', wakeCategory: 'D', originAirport: 'LTAC', destinationAirport: 'LTAG', route: 'DCT', requestedAltitude: '250' },
  });
  const proposed = mustAct(efsp, c.CTR, 'CTR', ctrStrip, {
    kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2',
  });

  const mission = efsp.boardStoreFor('TACTICAL').getStrip(proposed.tofiCoordination.peerStripId);
  const out = send(efsp, c.TAC_C2, 'TAC_C2', mission, {
    kind: 'TOFI', action: 'ACCEPT', separationRegime: 'DUE_REGARD',
  });
  assert.equal(out.ack.ok, true, JSON.stringify(out.ack));

  // The accepter's own page gets it on the ack...
  assert.equal(out.ack.fdr.tofi.separationRegime, 'DUE_REGARD');
  // ...and the proposer's, from the broadcast every client receives. Without
  // this the write landed and neither screen ever showed it (F-306).
  const broadcast = out.broadcast.fdrs.updated.find(f => f.fdrId === mission.fdrId);
  assert.ok(broadcast, 'the FDR is in the board-delta');
  assert.equal(broadcast.tofi.separationRegime, 'DUE_REGARD');
});

// ── F-408, the clock-driven half — the sweep ──────────────────────────────
//
// A release time passing, an EDCT window closing, a void deadline reached:
// none of these is a message, so nothing re-stamps the Strip and the panel
// goes on showing advice that has just gone wrong. Ticked with an explicit
// `now` rather than by waiting, so a sweep of minute-scale deadlines can be
// tested in milliseconds.

/** The swept record for one Strip across a tick's payloads, or null. */
function stripIn(payloads, stripId) {
  for (const payload of payloads) {
    const found = payload.strips.find(s => s.stripId === stripId);
    if (found) return found;
  }
  return null;
}

/** A HELD Strip at CD with a release time — the F-408 reason that is purely a clock. */
function heldWithReleaseTime(efsp, c, callsign, releaseAt) {
  let strip = createDeparture(efsp, c, callsign);
  strip = mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'SetState', toState: 'HELD' });
  strip = mustAct(efsp, c.OPS, 'OPS', strip, {
    kind: 'TransferStrip', toPositionId: 'CD', bayId: 'cd-held', rackId: 'main',
  });
  assert.equal(efsp.fdrStore.setField(strip.fdrId, 'assigned.releaseState', 'RELEASE_TIME', { by: 'CD' }).ok, true);
  assert.equal(efsp.fdrStore.setField(strip.fdrId, 'assigned.releaseTimeUtc', releaseAt, { by: 'CD' }).ok, true);
  return strip;
}

test('F-408: a release time passing is broadcast exactly once, and a second tick sends nothing', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK' });
  const releaseAt = Date.now() + 10 * 60 * 1000;
  const strip = heldWithReleaseTime(efsp, c, 'HLD408', releaseAt);

  // Settle first. The Board is durable and shared across the tests in this
  // file, and the FDR above was edited outside the Mutation path, so a fresh
  // monitor legitimately has a backlog to state before "only what moved" means
  // anything.
  const settled = efsp.nlaStatusMonitor.tick(releaseAt - 60 * 1000);
  assert.equal(stripIn(settled, strip.stripId).nla.inhibited, 'release time not reached');

  const sent = [];
  efsp.nlaStatusMonitor.setOnDelta(p => sent.push(p));

  // A quiet Board says nothing at all. This is the property that stops the
  // sweep pushing a delta at every client on a fixed interval forever.
  efsp.nlaStatusMonitor.tick(releaseAt - 30 * 1000);
  assert.deepEqual(sent, []);

  // The clock crosses the deadline. Nothing touched the Strip.
  efsp.nlaStatusMonitor.tick(releaseAt + 1000);
  assert.equal(sent.length, 1, 'exactly one broadcast');
  const [payload] = sent;
  assert.equal(payload.facilityId, 'INCIRLIK');
  assert.equal(payload.strips.length, 1);
  assert.equal(payload.strips[0].stripId, strip.stripId);
  assert.deepEqual(payload.strips[0].nla, { toState: 'PUSHBACK', transferTo: 'GND' });
  assert.equal(payload.strips[0].facilityId, 'INCIRLIK', 'stamped like any other board-delta record');

  // And it does not keep saying so.
  efsp.nlaStatusMonitor.tick(releaseAt + 60 * 1000);
  assert.equal(sent.length, 1, 'the second tick adds nothing');
});

test('F-408: the sweep never re-sends a status a Mutation already put on the wire', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK' });
  efsp.nlaStatusMonitor.tick(); // settle whatever the shared Board restored

  const sent = [];
  efsp.nlaStatusMonitor.setOnDelta(p => sent.push(p));

  const strip = createDeparture(efsp, c, 'DUP408');
  efsp.nlaStatusMonitor.tick();
  assert.deepEqual(sent, [], 'the CreateStrip ack already carried this status');

  await advance(efsp, c.OPS, 'OPS', strip); // PROPOSED -> PENDING_CLEARANCE, a new status
  efsp.nlaStatusMonitor.tick();
  assert.deepEqual(sent, [], 'and so did the InvokeNla ack and its board-delta');
});

test('F-408: a void deadline expiring reaches the sweep too, and the reason is the press\'s own wording', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK' });
  let strip = createDeparture(efsp, c, 'VOD408');
  strip = mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'SetState', toState: 'HELD' });
  strip = mustAct(efsp, c.OPS, 'OPS', strip, {
    kind: 'TransferStrip', toPositionId: 'CD', bayId: 'cd-held', rackId: 'main',
  });
  // fdr-store derives voidDeadlineUtc from the void time (§3.8, 30 minutes).
  // Set in the past, so the derived deadline has already gone by at the real
  // clock the press below reads — the sweep takes an explicit `now`, the
  // Mutation path does not.
  const voidAt = Date.now() - 31 * 60 * 1000;
  efsp.fdrStore.setField(strip.fdrId, 'assigned.releaseState', 'CLEARANCE_VOID_TIME', { by: 'CD' });
  efsp.fdrStore.setField(strip.fdrId, 'assigned.voidTimeUtc', voidAt, { by: 'CD' });
  const deadline = efsp.fdrStore.getFdr(strip.fdrId).assigned.voidDeadlineUtc;
  assert.ok(Number.isFinite(deadline), 'the deadline is derived');

  efsp.nlaStatusMonitor.tick(deadline - 1000); // settle
  const sent = [];
  efsp.nlaStatusMonitor.setOnDelta(p => sent.push(p));

  efsp.nlaStatusMonitor.tick(deadline + 1000);
  assert.equal(sent.length, 1);
  const swept = stripIn(sent, strip.stripId);
  assert.equal(swept.nla.inhibited, 'void time expired');
  assert.equal(swept.nla.reason, 'NLA_INHIBITED');

  // Identical to what the press returns — the one-wording rule, now across
  // three surfaces: the press, the wire stamp, and this sweep.
  const fresh = efsp.boardStoreFor('INCIRLIK').getStrip(strip.stripId);
  const refused = act(efsp, c.CD, 'CD', fresh, { kind: 'InvokeNla' });
  assert.equal(refused.ok, false);
  assert.equal(refused.detail, swept.nla.inhibited);
});

test('F-408: the sweep forgets a Strip once it leaves the Board', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK' });
  const strip = createDeparture(efsp, c, 'RIP408');
  efsp.nlaStatusMonitor.tick();

  const sent = [];
  efsp.nlaStatusMonitor.setOnDelta(p => sent.push(p));
  mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'DropStrip' });
  efsp.nlaStatusMonitor.tick();
  assert.equal(stripIn(sent, strip.stripId), null, 'a DROPPED Strip is not swept');
  assert.equal(efsp.nlaStatusMonitor._last.has(strip.stripId), false, 'and its cache entry is reaped');
});
