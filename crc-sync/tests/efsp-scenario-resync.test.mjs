import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';

// Scenario: a client that misses a Board delta (or meets a restarted server)
// asks for a resync and converges (S-12, docs/adr/0081). The server is a real
// createEfsp(); the client is the shipped efsp-state.js + efsp-ws.js run in a
// vm with sendToSync wired straight into handleMessage.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resync-scn-'));
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
const { crew, mustAct, DEPARTURE_FDR } = await import('./helpers/efsp-scenario.mjs');

const CLIENT_DIR = path.join(import.meta.dirname, '../../crc-desktop/app/public/js/panels/efsp');

/** The shipped client sync code, its network replaced by an outbox. */
function makeClient() {
  const outbox = [];
  const ctx = vm.createContext({
    console: { warn() {}, log() {}, error() {} }, crypto: { randomUUID: () => 'x' },
    isSyncOpen: () => true, sendToSync: (m) => outbox.push(m),
  });
  for (const f of ['efsp-state.js', 'efsp-ws.js']) vm.runInContext(fs.readFileSync(path.join(CLIENT_DIR, f), 'utf8'), ctx, { filename: f });
  const run = (code) => vm.runInContext(code, ctx);
  return {
    outbox, run,
    /** app.js's efsp cases, in the order it runs them. */
    deliver(msg) {
      ctx.__m = msg;
      switch (msg.type) {
        case 'efsp-snapshot': run('applyEfspSnapshot(__m); noteEfspSnapshotLanded()'); break;
        case 'efsp-board-delta': run('noteEfspBoardMessageForSync(__m); applyEfspDelta(__m); if (!efspEpochChangeOf(__m)) noteEfspResyncAnswered(__m.facilityId || getEfspFacility())'); break;
        case 'efsp-mutation-ack': run('noteEfspBoardMessageForSync(__m); applyEfspMutationAck(__m)'); break;
        case 'efsp-heartbeat': run('noteEfspHeartbeatForSync(__m)'); break;
        default: throw new Error(msg.type);
      }
    },
    stripIds: () => run('JSON.stringify(getAllEfspStrips().map(s => s.stripId + ":" + s.rev).sort())') && JSON.parse(run('JSON.stringify(getAllEfspStrips().map(s => s.stripId + ":" + s.rev).sort())')),
    seq: (f) => run(`efspResyncPositionFor(${JSON.stringify(f)}).lastBoardSeq`),
  };
}

const serverStrips = (efsp) => efsp.boardStoreFor('INCIRLIK').getAll().filter(s => s.state !== 'DROPPED').map(s => s.stripId + ':' + s.rev).sort();
const create = (efsp, c, callsign) => mustAct(efsp, c.OPS, 'OPS', null,
  { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, callsign } });

/** Runs the server's reply to every resync in the outbox back into the client; returns what types came back. */
function serveResyncs(efsp, session, client) {
  const replies = [];
  while (client.outbox.length) {
    const m = client.outbox.shift();
    assert.equal(m.type, 'efsp-resync');
    const r = efsp.handleMessage(session, m);
    replies.push(r.ack.type);
    client.deliver(r.ack);
  }
  return replies;
}

test('a client that misses a delta sees the gap at the heartbeat, resyncs, and converges on a delta', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK' });
  const b = makeClient();
  b.deliver(efsp.snapshotFor(c.CD.session));
  assert.deepEqual(b.stripIds(), serverStrips(efsp));

  // two changes; the second one's broadcast never reaches client B
  const first = efsp.handleMessage(c.OPS.session, { version: 1, type: 'efsp-mutation', clientMutationId: 'm1', facilityId: 'INCIRLIK', actingPositionId: 'OPS',
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, callsign: 'RSYNC1' } } });
  b.deliver(first.broadcast);
  const second = efsp.handleMessage(c.OPS.session, { version: 1, type: 'efsp-mutation', clientMutationId: 'm2', facilityId: 'INCIRLIK', actingPositionId: 'OPS',
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, callsign: 'RSYNC2' } } });
  assert.equal(second.ack.ok, true); // broadcast lost
  assert.notDeepEqual(b.stripIds(), serverStrips(efsp));

  const beat = { type: 'efsp-heartbeat', boardSeq: efsp.boardStore.currentSeq };
  b.deliver(beat);
  assert.equal(b.outbox.length, 0, 'one beat behind is not yet a gap (a delta may be in flight)');
  b.deliver(beat);
  assert.equal(b.outbox.length, 1);
  assert.equal(b.outbox[0].lastBoardSeq, first.broadcast.boardSeq);
  assert.equal(b.outbox[0].boardEpoch, efsp.boardStoreFor('INCIRLIK').epoch);
  b.deliver(beat); // a third beat while the resync is in flight sends nothing more
  assert.equal(b.outbox.length, 1);

  assert.deepEqual(serveResyncs(efsp, c.CD.session, b), ['efsp-board-delta']);
  assert.deepEqual(b.stripIds(), serverStrips(efsp));
  b.deliver(beat);
  b.deliver(beat);
  assert.equal(b.outbox.length, 0, 'converged: no more resyncs');
});

test('a delta from another Board lifetime (server restarted) triggers a resync that is answered with a snapshot', () => {
  const efsp1 = createEfsp();
  const c1 = crew(efsp1, { OPS: 'INCIRLIK', CD: 'INCIRLIK' });
  create(efsp1, c1, 'EPOCH1');
  const b = makeClient();
  b.deliver(efsp1.snapshotFor(c1.CD.session));

  const efsp2 = createEfsp(); // a new lifetime restoring the same snapshot
  const c2 = crew(efsp2, { OPS: 'INCIRLIK', CD: 'INCIRLIK' });
  assert.notEqual(efsp2.boardStoreFor('INCIRLIK').epoch, efsp1.boardStoreFor('INCIRLIK').epoch);
  const r = efsp2.handleMessage(c2.OPS.session, { version: 1, type: 'efsp-mutation', clientMutationId: 'e1', facilityId: 'INCIRLIK', actingPositionId: 'OPS',
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, callsign: 'EPOCH2' } } });
  b.deliver(r.broadcast);
  assert.equal(b.outbox.length, 1);
  assert.equal(b.run('efspResyncPositionFor("INCIRLIK").boardEpoch'), efsp1.boardStoreFor('INCIRLIK').epoch, 'the new lifetime\'s epoch is not adopted from a delta');
  assert.deepEqual(serveResyncs(efsp2, c2.CD.session, b), ['efsp-snapshot']);
  assert.deepEqual(b.stripIds(), serverStrips(efsp2));
  assert.equal(b.seq('INCIRLIK'), efsp2.boardStoreFor('INCIRLIK').currentSeq);
});

test('a reconnect with a Board in hand resyncs; with none it sends nothing', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK' });
  const b = makeClient();
  b.run('resyncHeldEfspBoardsOnOpen()');
  assert.equal(b.outbox.length, 0, 'first connect: the snapshot is the answer');
  b.deliver(efsp.snapshotFor(c.CD.session));
  create(efsp, c, 'RECON1'); // missed while the socket was down
  b.run('resyncHeldEfspBoardsOnOpen()');
  const sent = b.outbox.map(m => m.facilityId).sort();
  assert.ok(sent.includes('INCIRLIK'));
  const replies = serveResyncs(efsp, c.CD.session, b);
  assert.ok(replies.every(t => t === 'efsp-board-delta'), replies.join());
  assert.deepEqual(b.stripIds(), serverStrips(efsp));
});
