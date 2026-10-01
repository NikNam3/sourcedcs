import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Payload-field contract (docs/wip/PARITY.md, D-9): the fields crc-desktop's
// efsp-state.js reads off the efsp-snapshot, efsp-board-delta and
// efsp-mutation-ack are produced by a REAL crc-sync (createEfsp), not a
// hand-written fixture. A field the client reads that the server stopped
// sending is the silent kind of drift: `msg.positionLetters || {}` just
// becomes {} and nothing throws.
//
// Source-scans the client file (read-only) for `msg.<field>` inside the three
// apply functions; runs the server. Does not touch nla.js / block-map.js /
// permission.js directly (L17).

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wire-contract-'));
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
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');

const { createEfsp } = await import('../src/efsp/index.js');
const { crew, DEPARTURE_FDR } = await import('./helpers/efsp-scenario.mjs');

const CLIENT_STATE = fs.readFileSync(path.join(import.meta.dirname, '../../crc-desktop/app/public/js/panels/efsp/efsp-state.js'), 'utf8');
const CLIENT_APP = fs.readFileSync(path.join(import.meta.dirname, '../../crc-desktop/app/public/js/app.js'), 'utf8');

/** The `msg.<field>` names read inside `function <name>(...) { ... }` (first top-level close). */
function fieldsReadBy(src, fnName) {
  const from = src.indexOf(`function ${fnName}(`);
  assert.ok(from >= 0, `client function ${fnName} moved or was renamed`);
  const body = src.slice(from, src.indexOf('\n}\n', from));
  return [...new Set([...body.matchAll(/\bmsg\.([A-Za-z_]\w*)/g)].map(m => m[1]))].sort();
}

const efsp = createEfsp();
const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER' });

test('every field applyEfspSnapshot reads is on a real efsp-snapshot', () => {
  const read = fieldsReadBy(CLIENT_STATE, 'applyEfspSnapshot');
  assert.ok(read.length >= 10, `scan found ${read}`);
  const snap = efsp.snapshotFor(c.OPS.session);
  assert.equal(snap.type, 'efsp-snapshot');
  const missing = read.filter(f => !(f in snap));
  assert.deepEqual(missing, [], `the client reads snapshot field(s) the server does not send: ${missing}`);
});

test('every field applyEfspDelta reads is on a real efsp-board-delta (broadcast of an accepted Mutation)', () => {
  // the seq/epoch/facility reads moved into the two helpers applyEfspDelta calls (S-12 resync wiring)
  const read = [...new Set(['applyEfspDelta', '_boardSyncOf', '_adoptBoardSeq'].flatMap(f => fieldsReadBy(CLIENT_STATE, f)))].sort();
  assert.ok(read.length >= 4, `scan found ${read}`);
  const result = efsp.handleMessage(c.OPS.session, {
    version: 1, type: 'efsp-mutation', clientMutationId: 'wire-1', facilityId: 'INCIRLIK', actingPositionId: 'OPS',
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: DEPARTURE_FDR },
  });
  assert.equal(result.ack.ok, true, JSON.stringify(result.ack));
  const delta = result.broadcast;
  assert.equal(delta.type, 'efsp-board-delta');
  const missing = read.filter(f => !(f in delta));
  assert.deepEqual(missing, [], `the client reads delta field(s) the server does not send: ${missing}`);
  // fdrs.gone rides only an archive sweep (docs/adr/0082): covered by efsp-archiver.test.mjs.
  for (const [k, sub] of [['strips', ['updated', 'gone']], ['fdrs', ['updated']], ['positions', ['updated']]]) {
    for (const s of sub) assert.ok(s in delta[k], `delta.${k}.${s}`);
  }
});

test('every field applyEfspMutationAck and the efsp-mutation-ack case read is on a real ack (success) or a rejection', () => {
  const read = fieldsReadBy(CLIENT_STATE, 'applyEfspMutationAck');
  const caseFrom = CLIENT_APP.indexOf("case 'efsp-mutation-ack'");
  const caseBody = CLIENT_APP.slice(caseFrom, CLIENT_APP.indexOf("case 'efsp-positions-ack'"));
  const inCase = [...new Set([...caseBody.matchAll(/\bmsg\.([A-Za-z_]\w*)/g)].map(m => m[1]))];
  const wanted = [...new Set([...read, ...inCase])].sort();
  assert.ok(wanted.length >= 6, `scan found ${wanted}`);

  const ok = efsp.handleMessage(c.OPS.session, {
    version: 1, type: 'efsp-mutation', clientMutationId: 'wire-2', facilityId: 'INCIRLIK', actingPositionId: 'OPS',
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, callsign: 'WIRE2' } },
  }).ack;
  const bad = efsp.handleMessage(c.OPS.session, {
    version: 1, type: 'efsp-mutation', clientMutationId: 'wire-3', facilityId: 'INCIRLIK', actingPositionId: 'OPS',
    stripId: ok.strip.stripId, baseRev: -5, op: { kind: 'InvokeNla' },
  }).ack;
  assert.equal(ok.ok, true);
  assert.equal(bad.ok, false);
  const seen = new Set([...Object.keys(ok), ...Object.keys(bad)]);
  // `warning` is only attached when a warn-class check fires; `detail` only on a refusal that has prose.
  const sometimes = new Set(['warning', 'detail']);
  const efspWs = fs.readFileSync(path.join(import.meta.dirname, '../src/efsp/efsp-ws.js'), 'utf8') + fs.readFileSync(path.join(import.meta.dirname, '../src/efsp/board-store.js'), 'utf8');
  for (const f of wanted) {
    if (seen.has(f)) continue;
    assert.ok(sometimes.has(f) && efspWs.includes(f), `the client reads ack field "${f}" which neither a success nor a refusal carries`);
  }
});

test('S-12: an efsp-resync is answered with an efsp-resync-reply, a snapshot or a delta, never a third type', () => {
  const board = efsp.boardStoreFor('INCIRLIK');
  const answers = [
    efsp.handleMessage(c.OPS.session, { type: 'efsp-resync', facilityId: 'INCIRLIK', lastBoardSeq: board.currentSeq, boardEpoch: board.epoch }),
    efsp.handleMessage(c.OPS.session, { type: 'efsp-resync', facilityId: 'INCIRLIK', lastBoardSeq: 0, boardEpoch: 'a-different-epoch' }),
    efsp.handleMessage(c.OPS.session, { type: 'efsp-resync', facilityId: 'INCIRLIK' }),
  ];
  const acks = answers.map(a => a && a.ack);
  for (const a of acks) {
    assert.equal(a.type, 'efsp-resync-reply');
    assert.ok(['delta', 'snapshot'].includes(a.answer), `resync answered with ${a.answer}`);
  }
  assert.deepEqual(acks.map(a => a.answer), ['delta', 'snapshot', 'snapshot']);
  // and the client has a case for the reply type
  assert.ok(CLIENT_APP.includes("case 'efsp-resync-reply'"), 'app.js has no case for efsp-resync-reply');
});
