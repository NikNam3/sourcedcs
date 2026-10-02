import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { slot } from './helpers/wire-slots.mjs';

// Scenario: a client that misses a Board delta (or meets a restarted server)
// asks for a resync and converges (S-12, docs/adr/0081). The server is a real
// createEfsp(); the client is the shipped efsp-state.js + efsp-ws.js, a fresh
// module graph per client (ESM-1), with sendToSync wired straight into an outbox.

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
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '{}');

const { createEfsp } = await import('../src/efsp/index.js');
const { crew, mustAct, DEPARTURE_FLIGHT_DATA } = await import('./helpers/efsp-scenario.mjs');

// The client is ES modules (ESM-1): its browser-ish globals first, then a fresh module graph per client.
await import('../../crc-desktop/tests/helpers/client-env.mjs');
const { freshGraph } = await import('../../crc-desktop/tests/helpers/fresh-graph.mjs');

/** The shipped client sync code, its network replaced by an outbox. */
async function makeClient() {
  const outbox = [];
  const g = freshGraph();
  const sync = await g.import('sync.js');
  sync.setSendToSync((m) => outbox.push(m));
  sync.setIsSyncOpen(() => true);
  const ctx = { ...(await g.import('panels/efsp/efsp-state.js')), ...(await g.import('panels/efsp/efsp-ws.js')) };
  // Evaluates a snippet against the two modules' exports, as the old vm context did against their globals.
  const run = (code) => new Function('__ctx', `with (__ctx) { return eval(${JSON.stringify(code)}); }`)(ctx);
  return {
    outbox, run,
    /** app.js's efsp cases, in the order it runs them. */
    deliver(msg) {
      ctx.__m = msg;
      if (msg.type === 'efsp-resync-reply') return this.deliver(run('efspResyncReplyAsMessage(__m)'));
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
  { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...DEPARTURE_FLIGHT_DATA, callsign } });

/** Runs the server's reply to every resync in the outbox back into the client; returns what types came back. */
function serveResyncs(efsp, session, client) {
  const replies = [];
  while (client.outbox.length) {
    const m = client.outbox.shift();
    assert.equal(m.type, 'efsp-resync');
    const r = efsp.handleMessage(session, m);
    assert.equal(r.ack.type, 'efsp-resync-reply');
    replies.push(r.ack.answer);
    client.deliver(r.ack);
  }
  return replies;
}

test('a client that misses a delta sees the gap at the heartbeat, resyncs, and converges on a delta', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK' });
  const b = await makeClient();
  b.deliver(efsp.snapshotFor(c.CD.session));
  assert.deepEqual(b.stripIds(), serverStrips(efsp));

  // two changes; the second one's broadcast never reaches client B
  const first = efsp.handleMessage(c.OPS.session, { version: 1, type: 'efsp-mutation', clientMutationId: 'm1', facilityId: 'INCIRLIK', actingPositionId: 'OPS',
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...DEPARTURE_FLIGHT_DATA, callsign: 'RSYNC1' } } });
  b.deliver(slot(first, 'primary'));
  const second = efsp.handleMessage(c.OPS.session, { version: 1, type: 'efsp-mutation', clientMutationId: 'm2', facilityId: 'INCIRLIK', actingPositionId: 'OPS',
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...DEPARTURE_FLIGHT_DATA, callsign: 'RSYNC2' } } });
  assert.equal(second.ack.ok, true); // broadcast lost
  assert.notDeepEqual(b.stripIds(), serverStrips(efsp));

  const beat = { type: 'efsp-heartbeat', boards: efsp.heartbeatBoardsAll() };
  b.deliver(beat);
  assert.equal(b.outbox.length, 0, 'one beat behind is not yet a gap (a delta may be in flight)');
  b.deliver(beat);
  assert.equal(b.outbox.length, 1);
  assert.equal(b.outbox[0].lastBoardSeq, slot(first, 'primary').boardSeq);
  assert.equal(b.outbox[0].boardEpoch, efsp.boardStoreFor('INCIRLIK').epoch);
  b.deliver(beat); // a third beat while the resync is in flight sends nothing more
  assert.equal(b.outbox.length, 1);

  assert.deepEqual(serveResyncs(efsp, c.CD.session, b), ['delta']);
  assert.deepEqual(b.stripIds(), serverStrips(efsp));
  b.deliver(beat);
  b.deliver(beat);
  assert.equal(b.outbox.length, 0, 'converged: no more resyncs');
});

test('a delta from another Board lifetime (server restarted) triggers a resync that is answered with a snapshot', async () => {
  const efsp1 = createEfsp();
  const c1 = crew(efsp1, { OPS: 'INCIRLIK', CD: 'INCIRLIK' });
  create(efsp1, c1, 'EPOCH1');
  const b = await makeClient();
  b.deliver(efsp1.snapshotFor(c1.CD.session));

  const efsp2 = createEfsp(); // a new lifetime restoring the same snapshot
  const c2 = crew(efsp2, { OPS: 'INCIRLIK', CD: 'INCIRLIK' });
  assert.notEqual(efsp2.boardStoreFor('INCIRLIK').epoch, efsp1.boardStoreFor('INCIRLIK').epoch);
  const r = efsp2.handleMessage(c2.OPS.session, { version: 1, type: 'efsp-mutation', clientMutationId: 'e1', facilityId: 'INCIRLIK', actingPositionId: 'OPS',
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...DEPARTURE_FLIGHT_DATA, callsign: 'EPOCH2' } } });
  b.deliver(slot(r, 'primary'));
  assert.equal(b.outbox.length, 1);
  assert.equal(b.run('efspResyncPositionFor("INCIRLIK").boardEpoch'), efsp1.boardStoreFor('INCIRLIK').epoch, 'the new lifetime\'s epoch is not adopted from a delta');
  assert.deepEqual(serveResyncs(efsp2, c2.CD.session, b), ['snapshot']);
  assert.deepEqual(b.stripIds(), serverStrips(efsp2));
  assert.equal(b.seq('INCIRLIK'), efsp2.boardStoreFor('INCIRLIK').currentSeq);
});

test('a reconnect sends no resync: the connect-time snapshot is the recovery (R3-47)', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK' });
  const b = await makeClient();
  b.deliver(efsp.snapshotFor(c.CD.session));
  create(efsp, c, 'RECON1'); // missed while the socket was down
  assert.notDeepEqual(b.stripIds(), serverStrips(efsp));
  assert.equal(b.run('typeof resyncHeldEfspBoardsOnOpen'), 'undefined', 'the reconnect trigger is gone');
  assert.equal(b.outbox.length, 0, 'nothing is sent on open');
  b.deliver(efsp.snapshotFor(c.CD.session)); // what ws-hub sends on every connect
  assert.deepEqual(b.stripIds(), serverStrips(efsp));
  assert.equal(b.outbox.length, 0);
});
