import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import crcLog from '../src/log.js';

// U22 (docs/adr/0100 §9): the metrics tap counts undos by the op they undid, the Mutations by another Position an
// undo voided, and undone transfers beside an unchanged §11.1 transfer rate.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-metrics-'));
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
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, JSON.stringify({ Test: [
  { airspaceId: 'MOA-TAP', name: 'Tap MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 134.25 },
] }));

const { createEfsp } = await import('../src/efsp/index.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const { createEfspInstrumentation } = await import('../src/efsp/metrics.js');
const { crew, hold, act, mustAct, jumpTo, advance, DEPARTURE_FLIGHT_DATA, airborneDeparture } = await import('./helpers/efsp-scenario.mjs');

function quiet(fn) {
  const cap = crcLog.capture();
  try { return fn(); } finally { cap.stop(); }
}

const efsp = createEfsp({ currentTheater: () => 'Test' });
const instr = quiet(() => createEfspInstrumentation({
  efsp, facilityConfig,
  correlationStats: () => ({ rate: null, eligible: 0 }),
  obligationStats: () => ({ VOID_TIME_EXPIRED: { met: 1, missed: 2 } }),
}));
const c = crew(efsp, { OPS: 'INCIRLIK', LC: 'INCIRLIK', AP: 'INCIRLIK', CTR: 'CENTER' });

const body = () => instr.metrics.buildMetricsBody();
const logFor = (cmid) => efsp.mutationLog.readAll().filter(e => e.clientMutationId === cmid);

function send(member, msg) {
  return efsp.handleMessage(member.session, { version: 1, facilityId: member.facilityId, ...msg });
}

function newStrip(callsign, flightData = {}) {
  return mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...DEPARTURE_FLIGHT_DATA, callsign, ...flightData },
  });
}

test('U22: undos by op, undoVoided, undoneTransfers; the transfer counts stay as they were', () => {
  let s = newStrip('MET1');
  s = jumpTo(efsp, c.OPS, 'OPS', s, 'DEPARTED');
  s = mustAct(efsp, c.OPS, 'OPS', s, { kind: 'TransferStrip', toPositionId: 'LC', bayId: 'lc-airborne', rackId: 'main' });
  const before = body().metrics.transfers;
  const handoff = act(efsp, c.LC, 'LC', s, { kind: 'InvokeNla' });
  assert.ok(handoff.undoable, JSON.stringify(handoff));
  const afterHandoff = body().metrics.transfers;
  assert.equal(afterHandoff.attempts, before.attempts + 1);
  assert.equal(act(efsp, c.AP, 'AP', efsp.boardStoreFor('INCIRLIK').getStrip(s.stripId), { kind: 'SetBlock', blockId: '9A', value: 'RV' }).ok, true);
  const u = act(efsp, c.LC, 'LC', efsp.boardStoreFor('INCIRLIK').getStrip(s.stripId), { kind: 'Undo', actionId: handoff.undoable.actionId });
  assert.equal(u.ok, true, JSON.stringify(u));
  const m = body().metrics;
  assert.equal(m.undo.undos, 1);
  assert.deepEqual(m.undo.byOp, { InvokeNla: 1 });
  assert.equal(m.undo.undoVoided, 1);
  assert.equal(m.undo.undoneTransfers, 1);
  assert.equal(m.transfers.attempts, afterHandoff.attempts, 'an undone transfer stays a transfer attempt');
  assert.equal(m.transfers.succeeded, afterHandoff.succeeded);
  assert.deepEqual(m.formations, { formationSplits: 0, formationJoins: 0 });
  const rec = instr.sessionRecords().find(r => r.controllerId === 'c-LC');
  assert.deepEqual([rec.undos, rec.undoVoided], [1, 1]);
});
