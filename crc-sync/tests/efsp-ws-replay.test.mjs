import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// docs/adr/0081 (L27): the non-Board paths are idempotent by clientMutationId
// (L6's F13), and every efsp-board-delta names its Board lifetime (F2).
// Walked through the real composition root, so the cache is the one index.js
// builds and the gates are the real ones.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-ws-replay-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, JSON.stringify([
  { airspaceId: 'MOA-RPLY', name: 'Replay MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 134.25 },
]));

const { createEfsp } = await import('../src/efsp/index.js');
const { ReplayCache } = await import('../src/efsp/replay-cache.js');
const WsHub = (await import('../src/ws-hub.js')).default;
const { crew, hold, mustAct, DEPARTURE_FDR, airborneDeparture } = await import('./helpers/efsp-scenario.mjs');

const ATC = { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER' };

function logLines(cmid) {
  return fs.readFileSync(process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(e => e.clientMutationId === cmid);
}

function send(efsp, member, msg) {
  return efsp.handleMessage(member.session, { version: 1, clientMutationId: crypto.randomUUID(), ...msg });
}

// ── F13: one kind at a time ─────────────────────────────────────────────

test('a retried DeclareMarsa returns the first relation and mints no second one', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const tanker = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'SHELL1' });
  const rx = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'VIPER1' });
  const before = efsp.marsaStore.getAll().length;
  const msg = {
    version: 1, type: 'efsp-marsa-mutation', clientMutationId: crypto.randomUUID(), actingPositionId: 'APP',
    op: { kind: 'DeclareMarsa', participants: [tanker.fdrId, rx.fdrId], startEvent: 'TANKER_ACCEPTED', endCondition: 'VERTICALLY_POSITIONED', declaringCallsign: 'SHELL1' },
  };
  const first = efsp.handleMessage(c.APP.session, msg);
  assert.equal(first.ack.ok, true, JSON.stringify(first.ack));
  const retry = efsp.handleMessage(c.APP.session, JSON.parse(JSON.stringify(msg)));
  assert.equal(retry.ack.ok, true);
  assert.equal(retry.ack.marsa.marsaId, first.ack.marsa.marsaId, 'the first relation, as it is now');
  assert.equal(efsp.marsaStore.getAll().length, before + 1, 'one relation, not two');
  assert.equal(retry.marsaBroadcast, undefined);
  assert.equal(retry.broadcast, undefined);
  assert.equal(logLines(msg.clientMutationId).length, 1, 'audited once');
});

test('a retried BindTrack is acked once, audited once', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const strip = mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, callsign: 'BIND1' } });
  const cur = efsp.correlationStore.getCorrelation(strip.fdrId);
  const msg = {
    version: 1, type: 'efsp-correlation-mutation', clientMutationId: crypto.randomUUID(), actingPositionId: 'OPS',
    fdrId: strip.fdrId, baseRev: cur ? cur.rev : 0, op: { kind: 'BindTrack', trackId: '4242' },
  };
  const first = efsp.handleMessage(c.OPS.session, msg);
  assert.equal(first.ack.ok, true, JSON.stringify(first.ack));
  const seq = efsp.correlationStore.currentSeq;
  const retry = efsp.handleMessage(c.OPS.session, JSON.parse(JSON.stringify(msg)));
  assert.equal(retry.ack.ok, true, 'the original outcome, not a STALE_REV');
  assert.equal(retry.ack.correlation.fdrId, strip.fdrId);
  assert.equal(retry.ack.correlation.rev, efsp.correlationStore.getCorrelation(strip.fdrId).rev);
  assert.equal(efsp.correlationStore.currentSeq, seq, 'not applied again');
  assert.equal(retry.broadcast, undefined);
  assert.equal(logLines(msg.clientMutationId).length, 1);
});

test('a retried airspace op is not re-applied', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const cur = efsp.airspaceStore.getAirspace('MOA-RPLY');
  const msg = {
    version: 1, type: 'efsp-airspace-mutation', clientMutationId: crypto.randomUUID(), actingPositionId: 'CTR',
    airspaceId: 'MOA-RPLY', baseRev: cur.rev, op: { kind: 'ScheduleAirspace', fromUtc: Date.now(), toUtc: Date.now() + 3600000 },
  };
  const first = efsp.handleMessage(c.CTR.session, msg);
  assert.equal(first.ack.ok, true, JSON.stringify(first.ack));
  const seq = efsp.airspaceStore.currentSeq;
  const retry = efsp.handleMessage(c.CTR.session, JSON.parse(JSON.stringify(msg)));
  assert.equal(retry.ack.ok, true, JSON.stringify(retry.ack));
  assert.equal(retry.ack.airspace.rev, efsp.airspaceStore.getAirspace('MOA-RPLY').rev);
  assert.equal(efsp.airspaceStore.currentSeq, seq, 'not applied again');
  assert.equal(retry.broadcast, undefined);
});

test('a retried field-state op is not re-applied', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const cur = efsp.fieldStateStore.getFieldState('INCIRLIK');
  const msg = {
    version: 1, type: 'efsp-field-state-mutation', clientMutationId: crypto.randomUUID(), facilityId: 'INCIRLIK',
    actingPositionId: 'TWR', baseRev: cur.rev, op: { kind: 'CloseRunway', runwayId: '05/23', reason: 'FOD' },
  };
  const first = efsp.handleMessage(c.TWR.session, msg);
  assert.equal(first.ack.ok, true, JSON.stringify(first.ack));
  const seq = efsp.fieldStateStore.currentSeq;
  const retry = efsp.handleMessage(c.TWR.session, JSON.parse(JSON.stringify(msg)));
  assert.equal(retry.ack.ok, true, JSON.stringify(retry.ack));
  assert.equal(retry.ack.fieldState.rev, efsp.fieldStateStore.getFieldState('INCIRLIK').rev);
  assert.equal(efsp.fieldStateStore.currentSeq, seq, 'not applied again');
  assert.equal(retry.broadcast, undefined);
  assert.equal(logLines(msg.clientMutationId).length, 1);
  // Leave the runway open for whoever shares this file's durable state.
  const back = send(efsp, c.TWR, { type: 'efsp-field-state-mutation', facilityId: 'INCIRLIK', actingPositionId: 'TWR', baseRev: efsp.fieldStateStore.getFieldState('INCIRLIK').rev, op: { kind: 'OpenRunway', runwayId: '05/23' } });
  assert.equal(back.ack.ok, true);
});

test('a NOT_HOLDING_POSITION refusal is not cached: the retry after selecting the Position applies', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const tanker = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'SHELL2' });
  const rx = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'VIPER2' });
  const late = { controllerId: 'c-late', who: 'Late' };
  const msg = {
    version: 1, type: 'efsp-marsa-mutation', clientMutationId: crypto.randomUUID(), actingPositionId: 'CTR',
    op: { kind: 'DeclareMarsa', participants: [tanker.fdrId, rx.fdrId], startEvent: 'TANKER_ACCEPTED', endCondition: 'VERTICALLY_POSITIONED', declaringCallsign: 'SHELL2' },
  };
  const refused = efsp.handleMessage(late, msg);
  assert.equal(refused.ack.reason, 'NOT_HOLDING_POSITION');
  // CTR's controller leaves, the late one takes CTR, and retries.
  hold(efsp, c.CTR.session, 'CENTER', []);
  hold(efsp, late, 'CENTER', ['CTR']);
  const retry = efsp.handleMessage(late, JSON.parse(JSON.stringify(msg)));
  assert.equal(retry.ack.ok, true, JSON.stringify(retry.ack));
  hold(efsp, late, 'CENTER', []);
  hold(efsp, c.CTR.session, 'CENTER', ['CTR']);
});

test('ReplayCache evicts the oldest entry past its cap and ignores an empty clientMutationId', () => {
  const cache = new ReplayCache({ cap: 2 });
  cache.set('marsa', 'a', { ok: true, id: 'm1' });
  cache.set('marsa', 'b', { ok: true, id: 'm2' });
  cache.set('airspace', 'a', { ok: false, reason: 'STALE_REV', id: 'x' });
  assert.equal(cache.get('marsa', 'a'), null, 'evicted');
  assert.equal(cache.get('marsa', 'b').id, 'm2');
  assert.equal(cache.get('airspace', 'a').reason, 'STALE_REV', 'kinds are separate');
  cache.set('marsa', '', { ok: true });
  assert.equal(cache.get('marsa', ''), null);
  assert.ok(Object.isFrozen(cache.get('marsa', 'b')));
  assert.throws(() => cache.get('board', 'x'));
});

// ── F2: every efsp-board-delta carries boardEpoch ────────────────────────

test('every efsp-board-delta carries boardEpoch', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const epochOf = (fid) => efsp.boardStoreFor(fid).epoch;
  const cases = [];

  // _handleMutation's broadcast, and peerBroadcast (a coordination proposal).
  const arr = mustAct(efsp, c.CTR, 'CTR', null, { kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', role: 'ARRIVAL', fdr: { callsign: 'EPOCH1', aircraftType: 'F15', wakeCategory: 'D', originAirport: 'LTAC' } });
  const proposed = send(efsp, c.CTR, { type: 'efsp-mutation', facilityId: 'CENTER', actingPositionId: 'CTR', stripId: arr.stripId, baseRev: arr.rev, op: { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'APP' } });
  assert.equal(proposed.ack.ok, true, JSON.stringify(proposed.ack));
  assert.equal(proposed.ack.boardEpoch, epochOf('CENTER'), 'the ack too');
  cases.push(['mutation broadcast', proposed.broadcast, 'CENTER']);
  cases.push(['peerBroadcast', proposed.peerBroadcast, 'INCIRLIK']);

  // _handleMarsaMutation's FDR-only delta.
  const tanker = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'SHELL3' });
  const rx = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'VIPER3' });
  const declared = send(efsp, c.APP, { type: 'efsp-marsa-mutation', actingPositionId: 'APP', op: { kind: 'DeclareMarsa', participants: [tanker.fdrId, rx.fdrId], startEvent: 'TANKER_ACCEPTED', endCondition: 'VERTICALLY_POSITIONED', declaringCallsign: 'SHELL3' } });
  assert.equal(declared.ack.ok, true, JSON.stringify(declared.ack));
  cases.push(['MARSA regime delta', declared.broadcast, 'INCIRLIK']);

  // _handleSetPositions.
  cases.push(['set-positions', hold(efsp, c.CD.session, 'INCIRLIK', ['CD']) && efsp.handleMessage(c.CD.session, { type: 'efsp-set-positions', facilityId: 'INCIRLIK', held: ['CD'] }).broadcast, 'INCIRLIK']);

  // _handleResync's delta.
  const resync = efsp.handleMessage(c.APP.session, { type: 'efsp-resync', facilityId: 'INCIRLIK', lastBoardSeq: efsp.boardStoreFor('INCIRLIK').currentSeq, boardEpoch: epochOf('INCIRLIK') });
  cases.push(['resync delta', resync.ack, 'INCIRLIK']);

  // ws-hub's broadcastEfspBoardDelta (the NLA-status monitor, and L24's archiver).
  const hub = new WsHub({ trackStore: { getAll: () => [] }, collabStore: {}, efsp });
  const sent = [];
  hub._broadcastEfsp = (m) => sent.push(m);
  hub.broadcastEfspBoardDelta({ facilityId: 'INCIRLIK', boardSeq: efsp.boardStoreFor('INCIRLIK').currentSeq, strips: [] });
  cases.push(['ws-hub broadcastEfspBoardDelta', sent[0], 'INCIRLIK']);

  for (const [name, msg, fid] of cases) {
    assert.ok(msg, `${name}: no message`);
    assert.equal(msg.type, 'efsp-board-delta', name);
    assert.equal(msg.boardEpoch, epochOf(fid), `${name} carries its Board's epoch`);
  }
  const snap = efsp.snapshotFor();
  for (const fid of Object.keys(snap.boardSeqByFacility)) assert.equal(snap.boardEpochByFacility[fid], epochOf(fid));
});
