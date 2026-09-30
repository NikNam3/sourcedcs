import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// Two controllers at once — the dimension nothing had ever exercised.
//
// Every other sortie in this suite is one person acting in sequence, which is
// not how a squadron flies: several controllers work the same Board, their
// clients each hold a cached copy, and the whole optimistic-concurrency layer
// (STALE_REV, the delta sequence, resync-within-window versus a full
// snapshot, and the client's replay of what was in flight when it dropped)
// only ever runs when two of them collide.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-concurrency-scn-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, JSON.stringify([
  { airspaceId: 'MOA-RACE', name: 'Race MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 140.0 },
]));

const { createEfsp } = await import('../src/efsp/index.js');
const { crew, hold, act, mustAct, airspaceAct, DEPARTURE_FDR, airborneDeparture } = await import('./helpers/efsp-scenario.mjs');

const ATC = { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER' };

/** A raw mutation, so a test can send a deliberately stale baseRev. */
function send(efsp, session, { facilityId = 'INCIRLIK', actingPositionId, stripId, baseRev, op, clientMutationId }) {
  return efsp.handleMessage(session, {
    version: 1, type: 'efsp-mutation', clientMutationId: clientMutationId || crypto.randomUUID(),
    facilityId, actingPositionId, stripId, baseRev, op,
  });
}

// ── two controllers on one Strip ────────────────────────────────────────

test('SCENARIO two controllers act on the same Strip at once — the second is refused, not silently merged', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'RACE1' });

  // Both clients are looking at the same revision. A relieving controller
  // sits down at APP as an Observer and both hold their own cached copy.
  const seen = { stripId: strip.stripId, rev: strip.rev };

  const first = send(efsp, c.APP.session, {
    actingPositionId: 'APP', stripId: seen.stripId, baseRev: seen.rev,
    op: { kind: 'SetBlock', blockId: '9E', value: 'first writer' },
  });
  assert.equal(first.ack.ok, true);

  // The second is working from what it last saw, which is now one behind.
  const second = send(efsp, c.APP.session, {
    actingPositionId: 'APP', stripId: seen.stripId, baseRev: seen.rev,
    op: { kind: 'SetBlock', blockId: '9E', value: 'second writer' },
  });
  assert.equal(second.ack.ok, false);
  assert.equal(second.ack.reason, 'STALE_REV');
  // The rejection carries the current Strip, so the loser can re-render and
  // decide rather than being left showing what it guessed.
  assert.equal(second.ack.strip.rev, first.ack.strip.rev);

  const fdr = efsp.fdrStore.getFdr(strip.fdrId);
  assert.equal(fdr.filed.remarks, 'first writer', 'last writer does NOT win — the first one did');
});

test('the same Mutation sent twice is applied once — a retry after a lost ack is safe', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'RETRY1' });

  // §5.2 idempotent replay: a client that never saw its ack resends the same
  // clientMutationId rather than inventing a second Mutation.
  const id = crypto.randomUUID();
  const opts = {
    actingPositionId: 'APP', stripId: strip.stripId, baseRev: strip.rev, clientMutationId: id,
    op: { kind: 'SetBlock', blockId: '9E', value: 'once' },
  };
  const first = send(efsp, c.APP.session, opts);
  const replay = send(efsp, c.APP.session, opts);

  assert.equal(first.ack.ok, true);
  assert.equal(replay.ack.ok, true, 'a replay is a success, not a STALE_REV rejection');
  assert.equal(replay.ack.strip.rev, first.ack.strip.rev, 'and it did not apply a second time');
});

test('two controllers advancing the same Strip cannot both move it', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  let strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE',
    fdr: { ...DEPARTURE_FDR, callsign: 'ADV1' },
  });

  // Both presses arrive on the same revision. Only one transition may happen
  // — a Strip that advanced twice would skip a Position's whole job.
  const a = send(efsp, c.OPS.session, { actingPositionId: 'OPS', stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'InvokeNla' } });
  const b = send(efsp, c.OPS.session, { actingPositionId: 'OPS', stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'InvokeNla' } });

  assert.equal(a.ack.ok, true);
  assert.equal(b.ack.ok, false);
  assert.equal(efsp.boardStore.getStrip(strip.stripId).state, 'PENDING_CLEARANCE', 'exactly one step taken');
});

// ── two controllers on one airspace ─────────────────────────────────────

test('SCENARIO two controllers act on the same airspace at once', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  const booked = airspaceAct(efsp, c.CTR, 'CTR', 'MOA-RACE', {
    kind: 'ScheduleAirspace', fromUtc: Date.now(), toUtc: Date.now() + 3600000,
  });
  assert.equal(booked.ok, true);
  const staleRev = booked.airspace.rev - 1;

  // The airspace path has its own optimistic concurrency, on the record's own
  // rev — it shares nothing with the Board's.
  const stale = efsp.handleMessage(c.CTR.session, {
    version: 1, type: 'efsp-airspace-mutation', clientMutationId: crypto.randomUUID(),
    airspaceId: 'MOA-RACE', baseRev: staleRev, actingPositionId: 'CTR', op: { kind: 'ApproveActivation' },
  });
  assert.equal(stale.ack.ok, false);
  assert.equal(stale.ack.reason, 'STALE_REV');
  assert.equal(efsp.airspaceStore.getAirspace('MOA-RACE').state, 'SCHEDULED', 'nothing happened');

  assert.equal(airspaceAct(efsp, c.CTR, 'CTR', 'MOA-RACE', { kind: 'ApproveActivation' }).ok, true);
});

// ── a client that fell behind ───────────────────────────────────────────

test('SCENARIO a client that missed a few updates gets a delta, not a whole snapshot', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  const before = efsp.boardStore.currentSeq;
  const first = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'LAG1' });
  airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'LAG2' });

  const resync = efsp.handleMessage(c.APP.session, { type: 'efsp-resync', lastBoardSeq: before, boardEpoch: efsp.snapshotFor().boardEpochByFacility.INCIRLIK });
  assert.equal(resync.ack.type, 'efsp-board-delta', 'inside the ring buffer, so a delta');
  const ids = resync.ack.strips.updated.map(s => s.stripId);
  assert.ok(ids.includes(first.stripId));
  assert.ok(resync.ack.strips.updated.every(s => s.facilityId === 'INCIRLIK'), 'every record is stamped');
});

test('SCENARIO a client that fell too far behind is sent a full snapshot instead', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'FAR1' });

  // Beyond the ring-buffer window there is nothing to replay from, so the
  // only honest answer is the whole Board. Two paths, never a third (§5.6).
  const resync = efsp.handleMessage(c.APP.session, { type: 'efsp-resync', lastBoardSeq: -999999 });
  assert.equal(resync.ack.type, 'efsp-snapshot');
  assert.ok(resync.ack.strips.length > 0);
  assert.ok(Array.isArray(resync.ack.airspaces), 'and the snapshot carries the airspace board too');
});

test('a reconnecting client that never declared its Positions cannot act until it does', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'RECON1' });

  // The client drops and comes back. It has a cached Strip and a pending
  // Mutation to replay — but occupancy is presence, and presence did not
  // survive (§4.8.2 rule 5). Replaying before re-declaring must not work.
  efsp.onDisconnect(c.APP.session);
  const tooSoon = send(efsp, c.APP.session, {
    actingPositionId: 'APP', stripId: strip.stripId, baseRev: strip.rev,
    op: { kind: 'SetBlock', blockId: '9E', value: 'replayed' },
  });
  assert.equal(tooSoon.ack.ok, false);
  assert.equal(tooSoon.ack.reason, 'NOT_HOLDING_POSITION');

  hold(efsp, c.APP.session, 'INCIRLIK', ['APP']);
  const replayed = send(efsp, c.APP.session, {
    actingPositionId: 'APP', stripId: strip.stripId, baseRev: strip.rev,
    op: { kind: 'SetBlock', blockId: '9E', value: 'replayed' },
  });
  assert.equal(replayed.ack.ok, true, 'and once it has, the replay lands');
});

test('a Mutation replayed against a Strip whose role changed while the client was away is refused', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'ROLE1' });
  const cached = { stripId: strip.stripId, rev: strip.rev };

  // The guide calls a silently-lost Mutation the worst failure mode in the
  // system (D6), and the replay path is the answer to it. But a replay has to
  // lose safely too: while this client was away the Strip became an ARRIVAL,
  // and a DEPARTURE-shaped edit against it is no longer the same operation.
  mustAct(efsp, c.APP, 'APP', strip, { kind: 'ConvertToArrival' });

  const replayed = send(efsp, c.APP.session, {
    actingPositionId: 'APP', stripId: cached.stripId, baseRev: cached.rev,
    op: { kind: 'SetBlock', blockId: '8B', value: 'LTAC' }, // DEPARTURE's destination; ARRIVAL has no such Block
  });
  assert.equal(replayed.ack.ok, false);
  assert.equal(replayed.ack.reason, 'STALE_REV', 'caught by the revision, before the Block even resolves');
  assert.equal(replayed.ack.strip.role, 'ARRIVAL', 'and the client is handed what it should have been looking at');
});

// ── two controllers, one flight, both facilities ────────────────────────

test('SCENARIO both ends of a handoff act at the same moment', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'BOTH1' });
  const proposed = mustAct(efsp, c.APP, 'APP', strip, {
    kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR',
  });
  const replica = efsp.boardStoreFor('CENTER').getStrip(proposed.coordination.peerStripId);

  // Center accepts at the same moment Approach tries to advance its own copy.
  // The sender's Strip has an open link, which is what stops it advancing
  // out from under the exchange.
  const senderMoves = act(efsp, c.APP, 'APP', efsp.boardStore.getStrip(proposed.stripId), { kind: 'InvokeNla' });
  assert.equal(senderMoves.ok, false);
  assert.match(senderMoves.detail, /open coordination proposal/);

  assert.equal(mustAct(efsp, c.CTR, 'CTR', replica, { kind: 'HANDOFF', action: 'ACCEPT' }).coordination.state, 'ACTIVE');
  // And once it is resolved, the sender is free again.
  assert.equal(act(efsp, c.APP, 'APP', efsp.boardStore.getStrip(proposed.stripId), { kind: 'InvokeNla' }).ok, true);
});

test('an accept that lands twice resolves the exchange once', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'TWICE1' });
  const proposed = mustAct(efsp, c.APP, 'APP', strip, {
    kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR',
  });
  const replica = efsp.boardStoreFor('CENTER').getStrip(proposed.coordination.peerStripId);

  const first = act(efsp, c.CTR, 'CTR', replica, { kind: 'HANDOFF', action: 'ACCEPT' });
  assert.equal(first.ok, true);
  // The second arrives on the stale revision the accepting client still had.
  const second = act(efsp, c.CTR, 'CTR', replica, { kind: 'HANDOFF', action: 'ACCEPT' });
  assert.equal(second.ok, false);
  assert.equal(efsp.boardStore.getStrip(proposed.stripId).coordination.state, 'ACTIVE');
});

// ── the audit trail under contention ────────────────────────────────────

test('the Mutation log records who did what, including the airspace ops and the refusals', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  airspaceAct(efsp, c.CTR, 'CTR', 'MOA-RACE', { kind: 'ScheduleAirspace', fromUtc: Date.now(), toUtc: Date.now() + 3600000 });
  // A refusal is the interesting half of an authority model — an airspace op
  // somebody was not entitled to make should leave a trace, and it leaves no
  // transition on the record because nothing happened.
  airspaceAct(efsp, c.APP, 'APP', 'MOA-RACE', { kind: 'ApproveActivation' });

  const entries = efsp.mutationLog.readAll();
  const scheduled = entries.find(e => e.op === 'ScheduleAirspace' && e.airspaceId === 'MOA-RACE');
  assert.ok(scheduled, 'airspace ops were invisible to the audit trail until now');
  assert.equal(scheduled.actingPositionId, 'CTR');
  assert.equal(scheduled.ok, true);
  assert.equal(scheduled.stripId, undefined, 'an airspace op targets no Strip');

  const refused = entries.find(e => e.op === 'ApproveActivation' && e.ok === false);
  assert.ok(refused, 'a refusal leaves no transition on the record, so the log is the only trace');
  assert.equal(refused.actingPositionId, 'APP');
  assert.equal(refused.reason, 'PERMISSION_DENIED');
});

// ── what comes back off disk ────────────────────────────────────────────

test('a restored Strip whose beacon code the pool had free gets it re-reserved', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'RECON2' });
  const code = efsp.fdrStore.getFdr(strip.fdrId).identity.beaconAssigned;

  // Corrupt the snapshot the way a partial write or an older format would:
  // the Strip and its FDR survive, the allocated-code map does not.
  const snapshotPath = process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH;
  const data = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  data.fdr.codes = [];
  fs.writeFileSync(snapshotPath, JSON.stringify(data));

  // Left alone, the next CreateStrip would mint this code for a different
  // aircraft — the same failure ADR 0028 fixed, arriving another way.
  const after = createEfsp();
  assert.equal(after.fdrStore._codeAllocator.isAllocated(code), true,
    'a code a live flight is squawking must not be left in the pool');
  assert.equal(after.fdrStore._codeAllocator.holderOf(code), strip.fdrId);
});

test('the snapshot is written atomically, so a crash mid-write cannot empty the Board', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'ATOMIC1' });

  const snapshotPath = process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH;
  // The real guarantee: the live file is only ever replaced by rename, so it
  // is always a whole JSON document, never a partial one.
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(snapshotPath, 'utf8')));
  assert.equal(fs.existsSync(`${snapshotPath}.tmp`), false, 'the scratch file does not outlive the write');
});

test('free text is capped, because a Strip rides whole in every broadcast', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'LONG1' });

  const huge = 'X'.repeat(5000);
  const route = act(efsp, c.APP, 'APP', strip, { kind: 'SetBlock', blockId: '9', value: huge });
  assert.equal(route.ok, false);
  assert.match(route.detail, /limited to \d+ characters/);

  const annotation = act(efsp, c.APP, 'APP', strip, { kind: 'SetBlock', blockId: '24', value: huge });
  assert.equal(annotation.ok, false);
  assert.match(annotation.detail, /annotation is limited/);

  // An ordinary entry is unaffected — the ceiling is for accidents.
  assert.equal(act(efsp, c.APP, 'APP', strip, {
    kind: 'SetBlock', blockId: '9', value: 'LTAG DCT VEDAS DCT LTAC, expect FL280 after VEDAS',
  }).ok, true);
});

test('a coordination note is capped too — it rides in the same broadcast as everything else', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  let strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'NOTE1' });
  strip = mustAct(efsp, c.APP, 'APP', strip, { kind: 'SetBlock', blockId: '5A', value: 'CST' });

  // A degraded track forces the verbal path, so this is the one op kind that
  // REQUIRES a note — and it was the one free-text field left uncapped.
  const proposed = mustAct(efsp, c.APP, 'APP', strip, {
    kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR',
    note: 'Z'.repeat(50000),
  });
  assert.equal(proposed.coordination.note.length, 2000);

  // And the peer's replica carries the bounded note, not the original.
  const replica = efsp.boardStoreFor('CENTER').getStrip(proposed.coordination.peerStripId);
  assert.equal(replica.coordination.note.length, 2000);
});
