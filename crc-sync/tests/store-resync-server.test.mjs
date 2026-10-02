import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// SYNC-B-S (docs/adr/0105): every store outside the Board has an epoch, names its seq and epoch on acks, deltas, the snapshot and the
// heartbeat, and answers an efsp-resync `stores` request with its snapshot slice.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-resync-'));
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
const { STORE_SYNC } = await import('../src/efsp/stores.js');
const { crew, mustCarrierAct, mustAct, DEPARTURE_FLIGHT_DATA } = await import('./helpers/efsp-scenario.mjs');
const families = (await import('../src/efsp/wire/families/index.js')).default;

const storeOf = (efsp, registryKey) => efsp[{ airspaces: 'airspaceStore', correlations: 'correlationStore', marsa: 'marsaStore', runwayStatuses: 'runwayStatusStore', carriers: 'carrierStore', sfaRotation: 'sfaStore' }[registryKey]];
const KEYS = ['airspaces', 'correlations', 'marsa', 'runwayStatuses', 'carriers', 'sfaRotation'];
const resync = (efsp, session, stores, extra = {}) => efsp.handleMessage(session, { version: 1, type: 'efsp-resync', stores, ...extra }).ack;

test('six stores declare their sync, each on its own snapshot key, with an epoch of its own', () => {
  assert.deepEqual(STORE_SYNC.map(d => d.key), KEYS);
  const efsp = createEfsp();
  const epochs = new Set();
  for (const d of STORE_SYNC) {
    const store = storeOf(efsp, d.registryKey);
    assert.equal(typeof store.epoch, 'string', d.key);
    assert.equal(store.currentSeq, store.currentSeq);
    epochs.add(store.epoch);
    assert.equal(families.bySnapshotKey[d.key].deltaType, d.deltaType, `${d.key}: the family's delta type`);
  }
  assert.equal(epochs.size, 6, 'one lifetime per store');
  assert.notEqual(createEfsp().airspaceStore.epoch, efsp.airspaceStore.epoch, 'a new process is a new lifetime');
});

test('the snapshot carries storeSeqs and storeEpochs; the heartbeat names every store', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { CD: 'INCIRLIK' });
  const snap = efsp.snapshotFor(c.CD.session);
  const beat = efsp.heartbeatStores();
  assert.deepEqual(Object.keys(snap.storeSeqs).sort(), [...KEYS].sort());
  for (const d of STORE_SYNC) {
    const store = storeOf(efsp, d.registryKey);
    assert.equal(snap.storeSeqs[d.key], store.currentSeq);
    assert.equal(snap.storeEpochs[d.key], store.epoch);
    assert.deepEqual(beat[d.key], { seq: store.currentSeq, epoch: store.epoch });
  }
});

test('a carrier ack and delta carry carrierSeq and carrierEpoch', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { CV_PRIFLY: 'CARRIER' });
  const r = mustCarrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCase', to: 'II' });
  const delta = r.broadcasts.find(f => f.type === 'efsp-carrier-delta');
  for (const m of [r.ack, delta]) {
    assert.equal(m.carrierSeq, efsp.carrierStore.currentSeq);
    assert.equal(m.carrierEpoch, efsp.carrierStore.epoch);
  }
  assert.ok(efsp.heartbeatStores().carriers.seq > 0);
});

test('a stores-only resync answers each store whose seq or epoch differs with its slice, and only those', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { CV_PRIFLY: 'CARRIER', CD: 'INCIRLIK' });
  mustCarrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCase', to: 'I' });
  const beat = efsp.heartbeatStores();
  const have = Object.fromEntries(KEYS.map(k => [k, { lastSeq: beat[k].seq, epoch: beat[k].epoch }]));

  assert.deepEqual(resync(efsp, c.CD.session, have).stores, {}, 'a client that is current is sent nothing');
  const r = resync(efsp, c.CD.session, { ...have, carriers: { lastSeq: 0, epoch: beat.carriers.epoch } });
  assert.equal(r.type, 'efsp-resync-reply');
  assert.equal(r.answer, 'stores');
  assert.deepEqual(Object.keys(r.stores), ['carriers'], 'behind: that store only');
  assert.equal(r.stores.carriers.seq, beat.carriers.seq);
  assert.equal(r.stores.carriers.epoch, beat.carriers.epoch);
  assert.deepEqual(r.stores.carriers.slice, efsp.carrierStore.getAll());

  // another lifetime (a restarted server) with the same seq: the epoch alone triggers it
  const e = resync(efsp, c.CD.session, { ...have, marsa: { lastSeq: beat.marsa.seq, epoch: 'an-older-lifetime' } });
  assert.deepEqual(Object.keys(e.stores), ['marsa']);
  // a client ahead of the server (rewound) is answered too
  assert.deepEqual(Object.keys(resync(efsp, c.CD.session, { ...have, sfaRotation: { lastSeq: 99, epoch: beat.sfaRotation.epoch } }).stores), ['sfaRotation']);
  // unknown keys are ignored, a missing key is not asked about
  assert.deepEqual(resync(efsp, c.CD.session, { nonsense: { lastSeq: 0 } }).stores, {});
});

test('a delta answer carries the slices beside it; a snapshot answer does not (it carries every store)', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { CD: 'INCIRLIK' });
  const board = efsp.boardStoreFor('INCIRLIK');
  const stale = { airspaces: { lastSeq: -1, epoch: 'x' } };
  const delta = resync(efsp, c.CD.session, stale, { facilityId: 'INCIRLIK', lastBoardSeq: board.currentSeq, boardEpoch: board.epoch });
  assert.equal(delta.answer, 'delta');
  assert.deepEqual(Object.keys(delta.stores), ['airspaces']);
  const snap = resync(efsp, c.CD.session, stale, { facilityId: 'INCIRLIK', lastBoardSeq: -1 });
  assert.equal(snap.answer, 'snapshot');
  assert.equal(snap.stores, undefined);
  assert.ok(snap.storeSeqs && snap.storeEpochs);
});

test('an owned-scope session is sent no correlation or MARSA slice outside its scope', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK', JTAC: 'TACTICAL' });
  mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...DEPARTURE_FLIGHT_DATA, callsign: 'OWNED1' } });
  efsp.correlationStore.reconcile(new Map(efsp.flightDataStore.getAll().map(f => [f.flightDataId, null])));
  const all = resync(efsp, c.CD.session, { correlations: { lastSeq: -1, epoch: 'x' }, marsa: { lastSeq: -1, epoch: 'x' } });
  assert.ok(efsp.correlationStore.getAll().length > 0);
  assert.equal(all.stores.correlations.slice.length, efsp.correlationStore.getAll().length);
  const own = resync(efsp, c.JTAC.session, { correlations: { lastSeq: -1, epoch: 'x' }, marsa: { lastSeq: -1, epoch: 'x' } });
  assert.deepEqual(own.stores.correlations.slice, [], 'the JTAC holds none of those flights');
  assert.deepEqual(own.stores.marsa.slice, []);
  assert.equal(own.stores.correlations.seq, efsp.correlationStore.currentSeq, 'the seq is the store\'s: filtered deltas keep it continuous');
});
