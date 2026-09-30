import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// The tap (docs/adr/0065): createEfspInstrumentation() reassigns the facade's
// handleMessage/onDisconnect, and every EFSP message, its session and its ack
// pass through it. Real createEfsp(), real wire path, own paths (T11).

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-metrics-tap-'));
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
  { airspaceId: 'MOA-TAP', name: 'Tap MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 134.25 },
]));

const { createEfsp } = await import('../src/efsp/index.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const { createEfspInstrumentation } = await import('../src/efsp/metrics.js');
const { crew, hold, act, mustAct, jumpTo, advance, DEPARTURE_FDR, airborneDeparture } = await import('./helpers/efsp-scenario.mjs');

function quiet(fn) {
  const orig = console.warn;
  console.warn = () => {};
  try { return fn(); } finally { console.warn = orig; }
}

const efsp = createEfsp();
const instr = quiet(() => createEfspInstrumentation({
  efsp, facilityConfig,
  correlationStats: () => ({ rate: null, eligible: 0 }),
  obligationStats: () => ({ VOID_TIME_EXPIRED: { met: 1, missed: 2 } }),
}));
const c = crew(efsp, { OPS: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER' });

const body = () => instr.metrics.buildMetricsBody();
const logFor = (cmid) => efsp.mutationLog.readAll().filter(e => e.clientMutationId === cmid);

function send(member, msg) {
  return efsp.handleMessage(member.session, { version: 1, facilityId: member.facilityId, ...msg });
}

function newStrip(callsign, fdr = {}) {
  return mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, callsign, ...fdr },
  });
}

test('a refused SetBlock (STALE_REV) is counted AND reaches the Mutation log; replaying it changes neither (T1, T2)', () => {
  const strip = newStrip('TAP1');
  const before = body().metrics.rejectedMutations;
  const msg = {
    type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), actingPositionId: 'OPS',
    stripId: strip.stripId, baseRev: strip.rev - 1, op: { kind: 'SetBlock', blockId: '24', value: 'X' },
  };
  assert.equal(send(c.OPS, msg).ack.reason, 'STALE_REV');
  let after = body().metrics.rejectedMutations;
  assert.equal((after.byReason.STALE_REV || 0) - (before.byReason.STALE_REV || 0), 1);
  const [entry] = logFor(msg.clientMutationId);
  assert.equal(entry.ok, false);
  assert.equal(entry.source, 'wire');
  assert.equal(entry.reason, 'STALE_REV');
  assert.equal(entry.stripId, strip.stripId);
  assert.equal(entry.facilityId, 'INCIRLIK');
  assert.equal(entry.type, 'efsp-mutation');

  send(c.OPS, msg); // a reconnect replaying its queue
  after = body().metrics.rejectedMutations;
  assert.equal((after.byReason.STALE_REV || 0) - (before.byReason.STALE_REV || 0), 1, 'counted once');
  assert.equal(after.mutations - before.mutations, 1);
  assert.equal(logFor(msg.clientMutationId).length, 1, 'logged once');
});

test('NOT_HOLDING_POSITION on an airspace Mutation is counted and logged; a store-logged airspace refusal is not logged twice', () => {
  const cmid = crypto.randomUUID();
  const ack = send(c.OPS, { type: 'efsp-airspace-mutation', clientMutationId: cmid, airspaceId: 'MOA-TAP', actingPositionId: 'CTR', op: { kind: 'ScheduleAirspace' } }).ack;
  assert.equal(ack.reason, 'NOT_HOLDING_POSITION');
  assert.equal(logFor(cmid).length, 1);
  assert.equal(logFor(cmid)[0].source, 'wire');
  assert.ok(body().metrics.rejectedMutations.byType['efsp-airspace-mutation'] >= 1);

  // A refusal the airspace store logs itself. (efsp-ws.js does not hand the
  // store the clientMutationId, so its entry carries none — an audit gap noted
  // in docs/wip/L5.md; count by airspace instead.)
  const logged = () => efsp.mutationLog.readAll().filter(e => e.airspaceId === 'MOA-TAP' && e.ok === false);
  const before = logged().length;
  const refused = send(c.CTR, { type: 'efsp-airspace-mutation', clientMutationId: crypto.randomUUID(), airspaceId: 'MOA-TAP', actingPositionId: 'CTR', op: { kind: 'Nonsense' } }).ack;
  assert.equal(refused.ok, false);
  const added = logged().slice(before);
  assert.equal(added.length, 1, 'the store logged it; the tap did not add a second');
  assert.notEqual(added[0].source, 'wire');
});

test('a message type nobody has heard of that ends in -mutation is still counted (the suffix rule, T14)', () => {
  const stubbed = { ...efsp, handleMessage: () => ({ ack: { ok: false, reason: 'X' } }), onDisconnect: () => {} };
  const other = quiet(() => createEfspInstrumentation({
    efsp: stubbed, facilityConfig,
    metricsPath: path.join(tmpDir, 'suffix-metrics.json'), trafficCountPath: path.join(tmpDir, 'suffix-count.jsonl'),
  }));
  other.trafficCount.close();
  stubbed.handleMessage({ controllerId: 'c-x' }, { type: 'efsp-field-state-mutation', clientMutationId: 'fs-1', actingPositionId: 'TWR', op: { kind: 'CloseRunway' } });
  const r = other.metrics.buildMetricsBody().metrics.rejectedMutations;
  assert.equal(r.byType['efsp-field-state-mutation'], 1);
  assert.equal(r.byReason.X, 1);
});

test('transfers: no receiving Position is a failure with its cause; a covered transfer is routed; neither is a non-transfer', () => {
  const before = body().metrics.transfers;
  const strip = newStrip('TAP2');
  hold(efsp, c.TWR.session, 'INCIRLIK', []);
  hold(efsp, c.APP.session, 'INCIRLIK', []);
  const refused = act(efsp, c.OPS, 'OPS', strip, { kind: 'TransferStrip', toPositionId: 'CD', bayId: 'cd-coordination', rackId: 'main' });
  assert.equal(refused.reason, 'NO_RECEIVING_POSITION');
  hold(efsp, c.APP.session, 'INCIRLIK', ['APP']);
  const routed = mustAct(efsp, c.OPS, 'OPS', efsp.boardStore.getStrip(strip.stripId), { kind: 'TransferStrip', toPositionId: 'CD', bayId: 'cd-coordination', rackId: 'main' });
  assert.equal(routed.ownerPositionId, 'APP');
  hold(efsp, c.TWR.session, 'INCIRLIK', ['TWR']);

  const t = body().metrics.transfers;
  assert.equal(t.attempts - before.attempts, 2);
  assert.equal(t.failed - before.failed, 1);
  assert.equal(t.succeeded - before.succeeded, 1);
  assert.equal(t.routedToCovering - before.routedToCovering, 1);
  assert.equal((t.byCause.NO_RECEIVING_POSITION || 0) - (before.byCause.NO_RECEIVING_POSITION || 0), 1);
  assert.equal(t.byKind.TRANSFER.attempts - before.byKind.TRANSFER.attempts, 2);
});

test('transfers: a transfer-shaped NLA is NLA_TRANSFER; a terminal NLA is not a transfer; a non-owner\'s press is not one (T4)', async () => {
  let strip = newStrip('TAP3');
  strip = jumpTo(efsp, c.OPS, 'OPS', strip, 'DEPARTED');
  strip = mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'TransferStrip', toPositionId: 'TWR', bayId: 'twr-airborne', rackId: 'main' });
  const before = body().metrics.transfers;

  // A press by someone who does not own it: refused, and not a transfer.
  assert.equal(act(efsp, c.APP, 'APP', strip, { kind: 'InvokeNla' }).reason, 'NOT_OWNER');
  assert.equal(body().metrics.transfers.attempts, before.attempts);

  strip = await advance(efsp, c.TWR, 'TWR', strip); // TWR DEPARTED -> APP HANDED_OFF
  assert.equal(strip.ownerPositionId, 'APP');
  let t = body().metrics.transfers;
  assert.equal(t.byKind.NLA_TRANSFER.attempts - before.byKind.NLA_TRANSFER.attempts, 1);

  await advance(efsp, c.APP, 'APP', strip); // HANDED_OFF -> DROPPED: not a transfer
  t = body().metrics.transfers;
  assert.equal(t.attempts - before.attempts, 1);
});

test('an owner pressing NLA against its own inhibit is an inhibitedPress, not a transfer attempt (S-R2-5)', async () => {
  const cd = { session: { controllerId: 'c-CD', who: 'CD' }, facilityId: 'INCIRLIK' };
  hold(efsp, cd.session, 'INCIRLIK', ['CD']);
  try {
    let strip = mustAct(efsp, c.OPS, 'OPS', null, {
      kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { callsign: 'TAP4' },
    });
    strip = jumpTo(efsp, c.OPS, 'OPS', strip, 'PENDING_CLEARANCE');
    strip = mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'TransferStrip', toPositionId: 'CD', bayId: 'cd-pending-clearance', rackId: 'main' });
    const status = efsp.boardStore.nlaStatusFor(efsp.boardStore.getStrip(strip.stripId));
    assert.ok(status && status.inhibited, `precondition: the NLA is inhibited (${JSON.stringify(status)})`);
    const before = body().metrics.transfers;
    assert.equal(act(efsp, cd, 'CD', strip, { kind: 'InvokeNla' }).ok, false);
    const t = body().metrics.transfers;
    assert.equal(t.attempts, before.attempts);
    assert.equal(t.inhibitedPress - before.inhibitedPress, 1);
  } finally {
    hold(efsp, cd.session, 'INCIRLIK', []);
  }
});

test('SetFlag offset is counted as a server-side OFFSET gesture', () => {
  const strip = newStrip('TAP5');
  const before = body().metrics.gestureInputs.serverSetFlagMutations.OFFSET;
  mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'SetFlag', flag: 'offset', value: true });
  assert.equal(body().metrics.gestureInputs.serverSetFlagMutations.OFFSET - before, 1);
});

test('efsp-metrics-report: the reporter must hold the Position; an Observer may; mixed batches are partly accepted; duplicates count once', () => {
  const report = (session, reportId, events, positionId = 'OPS') => efsp.handleMessage(session, {
    version: 1, type: 'efsp-metrics-report', reportId, facilityId: 'INCIRLIK', positionId, events,
  }).ack;

  const stranger = { controllerId: 'c-stranger', who: 'x' };
  const denied = report(stranger, 'r1', [{ kind: 'SEARCH' }]);
  assert.equal(denied.type, 'efsp-metrics-report-ack');
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, 'NOT_HOLDING_POSITION');

  const observer = { controllerId: 'c-observer', who: 'y' };
  hold(efsp, observer, 'INCIRLIK', ['OPS']);
  assert.equal(report(observer, 'r2', [{ kind: 'SEARCH' }]).accepted, 1, 'an Observer measures too');

  const mixed = report(c.OPS.session, 'r3', [
    { kind: 'SEARCH', bayId: 'ops-proposed' },
    { kind: 'TIME_TO_FIND', latencyMs: -5 },
    { kind: 'GESTURE', gesture: 'OFFSET', inputs: 1 },
    { kind: 'WAVE' },
  ]);
  assert.equal(mixed.ok, true);
  assert.equal(mixed.accepted, 2);
  assert.deepEqual(mixed.rejected.map(r => [r.index, r.reason]), [[1, 'VALIDATION_ERROR'], [3, 'VALIDATION_ERROR']]);

  const total = () => body().metrics.searchInvocations.total;
  const t0 = total();
  report(c.OPS.session, 'r4', [{ kind: 'SEARCH' }]);
  const dup = report(c.OPS.session, 'r4', [{ kind: 'SEARCH' }]);
  assert.equal(dup.duplicate, true);
  assert.equal(total() - t0, 1);

  const flood = report(c.OPS.session, 'r5', Array.from({ length: 101 }, () => ({ kind: 'SEARCH' })));
  assert.equal(flood.ok, false);
  assert.equal(flood.reason, 'VALIDATION_ERROR');
  hold(efsp, observer, 'INCIRLIK', []);
});

test('efsp-metrics-request answers the sender with requestId echoed, and the traffic body when asked', () => {
  const ack = efsp.handleMessage(c.OPS.session, {
    version: 1, type: 'efsp-metrics-request', requestId: 'q-1', hours: 2, trafficCount: { facilityId: 'INCIRLIK' },
  }).ack;
  assert.equal(ack.type, 'efsp-metrics');
  assert.equal(ack.requestId, 'q-1');
  assert.equal(ack.ok, true);
  assert.equal(ack.metrics.windowHours, 2);
  assert.ok(ack.trafficCount.facilities.INCIRLIK);
  assert.deepEqual(ack.metrics.metrics.obligations.live, { VOID_TIME_EXPIRED: { met: 1, missed: 2 } });

  const bad = efsp.handleMessage(c.OPS.session, { type: 'efsp-metrics-request', requestId: 'q-2', hours: 0 }).ack;
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'VALIDATION_ERROR');
  assert.equal(bad.requestId, 'q-2');
});

test('nothing on the wire names a controller (H35); per-connection records exist in memory only', () => {
  const ack = efsp.handleMessage(c.OPS.session, { type: 'efsp-metrics-request', requestId: 'q-3' }).ack;
  const wire = JSON.stringify(ack);
  for (const id of ['c-OPS', 'c-TWR', 'c-APP', 'c-CTR']) assert.ok(!wire.includes(id), `${id} leaked onto the wire`);
  assert.ok(!('sessions' in ack.metrics.metrics.rejectedMutations));
  assert.ok(instr.sessionRecords().some(r => r.controllerId === 'c-OPS' && r.endedAt === null));
});

test('onDisconnect ends the session record and the original still runs (Positions released)', () => {
  const s = { controllerId: 'c-leaver', who: 'z' };
  const member = { session: s, facilityId: 'INCIRLIK' };
  hold(efsp, s, 'INCIRLIK', ['CD']);
  act(efsp, member, 'CD', { stripId: 'nope', rev: 1 }, { kind: 'SetFlag', flag: 'offset', value: true });
  assert.ok(instr.sessionRecords().some(r => r.controllerId === 'c-leaver' && r.endedAt === null));
  efsp.onDisconnect(s);
  assert.equal(efsp.positionStoreFor('INCIRLIK').primaryOf('CD'), null, 'the wrapped onDisconnect released CD');
  const rec = instr.sessionRecords().find(r => r.controllerId === 'c-leaver');
  assert.notEqual(rec.endedAt, null);
});

test('the tap swallows its own failure and returns exactly what the wrapped handler returned', () => {
  let returned = null;
  const spied = { ...efsp };
  spied.handleMessage = (session, msg) => { returned = efsp.handleMessage(session, msg); return returned; };
  const other = quiet(() => createEfspInstrumentation({
    efsp: spied, facilityConfig,
    metricsPath: path.join(tmpDir, 'spy-metrics.json'), trafficCountPath: path.join(tmpDir, 'spy-count.jsonl'),
  }));
  other.trafficCount.close();
  other.metrics.recordMutation = () => { throw new Error('metrics bug'); };
  const strip = newStrip('TAP6');
  const result = quiet(() => spied.handleMessage(c.OPS.session, {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), facilityId: 'INCIRLIK', actingPositionId: 'OPS',
    stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'SetBlock', blockId: '24', value: 'OK' },
  }));
  assert.equal(result, returned, 'the very same object');
  assert.equal(result.ack.ok, true);
});

test('efsp-set-positions and efsp-resync are neither mutations nor rejections', () => {
  const before = body().metrics.rejectedMutations.mutations;
  hold(efsp, c.OPS.session, 'INCIRLIK', ['OPS']);
  efsp.handleMessage(c.OPS.session, { version: 1, type: 'efsp-resync', facilityId: 'INCIRLIK' });
  assert.equal(body().metrics.rejectedMutations.mutations, before);
});

test('a SystemReassign in the log is counted', () => {
  const before = body().metrics.systemReassigned.total;
  let strip = newStrip('TAP7');
  strip = jumpTo(efsp, c.OPS, 'OPS', strip, 'DEPARTED');
  mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'TransferStrip', toPositionId: 'TWR', bayId: 'twr-airborne', rackId: 'main' });
  hold(efsp, c.TWR.session, 'INCIRLIK', []); // TWR vacates; APP covers it and the Strip follows
  assert.equal(efsp.boardStore.getStrip(strip.stripId).ownerPositionId, 'APP');
  hold(efsp, c.TWR.session, 'INCIRLIK', ['TWR']);
  const moved = efsp.mutationLog.readAll().filter(e => e.op === 'SystemReassign').length;
  assert.ok(efsp.mutationLog.readAll().some(e => e.op === 'SystemReassign' && e.stripId === strip.stripId));
  assert.equal(body().metrics.systemReassigned.total, moved, 'one per reassigned Strip, every one in the log');
  assert.ok(body().metrics.systemReassigned.total > before);
});
