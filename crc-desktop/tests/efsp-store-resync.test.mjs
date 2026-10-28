/* SYNC-B-C (crc-sync docs/adr/0106): the five stores outside the Board (six until docs/adr/0117 removed the SFA's) heal like a Board. A lost delta, a restarted
 * store and a missed heartbeat each end in ONE efsp-resync naming that store and the slice replacing its client state.
 * Unit level: efsp-state.js's position bookkeeping, then the real efsp-ws.js / efsp-messages.js through the registry. */

import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/client-env.mjs';
import { freshGraph } from './helpers/fresh-graph.mjs';

const KEYS = ['airspaces', 'correlations', 'marsa', 'runwayStatuses', 'carriers'];
const snap = () => ({
  facilities: ['INCIRLIK'], boardSeqByFacility: { INCIRLIK: 1 }, boardEpochByFacility: { INCIRLIK: 'b' },
  strips: [], flightDataList: [], positions: [], bays: [],
  airspaces: [{ airspaceId: 'A1', defRev: 1, definition: {} }], correlations: [{ flightDataId: 'f1', trackId: 't1' }], marsa: [],
  runwayStatuses: [{ facilityId: 'INCIRLIK', n: 1 }], carriers: [{ hullId: 'CV', caseValue: 'I' }],
  storeSeqs: Object.fromEntries(KEYS.map(k => [k, 3])), storeEpochs: Object.fromEntries(KEYS.map(k => [k, `e-${k}`])),
});

async function load() {
  const g = freshGraph();
  const S = await g.import('panels/efsp/efsp-state.js');
  const C = await g.import('panels/efsp/sync-cursor.js');
  S._resetEfspStateForTest();
  S.applyEfspSnapshot(snap());
  return { S, C, g };
}

test('the snapshot names every store position; a store it does not name is held as nothing', async () => {
  const { S, C } = await load();
  for (const k of KEYS) assert.deepEqual(S.getEfspStoreSync(k), { seq: 3, epoch: `e-${k}` });
  const s = snap(); delete s.storeSeqs.marsa; delete s.storeEpochs.marsa;
  S.applyEfspSnapshot(s);
  assert.equal(S.getEfspStoreSync('marsa'), null);
  assert.equal(C.resyncPositionOf('store:marsa'), null);
});

for (const [key, seqKey, epochKey, gapFromDeltas] of [
  ['airspaces', 'airspaceSeq', 'airspaceEpoch', true], ['correlations', 'correlationSeq', 'correlationEpoch', false],
  ['marsa', 'marsaSeq', 'marsaEpoch', false], ['runwayStatuses', 'runwayStatusSeq', 'runwayStatusEpoch', true],
  ['carriers', 'carrierSeq', 'carrierEpoch', false],
]) {
  test(`${key}: the next delta is adopted, a skipped one ${gapFromDeltas ? 'asks at once' : 'is left to the heartbeat'}, another epoch asks at once`, async () => {
    const { S, C } = await load();
    const e = `e-${key}`;
    assert.deepEqual(S.efspFrameGapsOf({ [seqKey]: 4, [epochKey]: e }), []);
    assert.equal(S.getEfspStoreSync(key).seq, 4);
    assert.deepEqual(S.efspFrameGapsOf({ [seqKey]: 4, [epochKey]: e }), [], 'an ack repeating its delta is no gap');
    assert.deepEqual(S.efspFrameGapsOf({ [seqKey]: 6, [epochKey]: e }), gapFromDeltas ? [`store:${key}`] : []);
    assert.equal(S.getEfspStoreSync(key).seq, 4, 'a jump is never adopted');
    assert.deepEqual(S.efspFrameGapsOf({ [seqKey]: 5, [epochKey]: 'other' }), [`store:${key}`]);
    assert.equal(S.getEfspStoreSync(key).epoch, e);
    assert.deepEqual(S.efspFrameGapsOf({ [seqKey]: 5 }), [], 'no epoch on the frame: not a change');
    // the heartbeat: behind on two beats, epoch at once, equal resets
    const beat = (seq, epoch = e) => ({ stores: { [key]: { seq, epoch } } });
    assert.deepEqual(C.heartbeatGaps(beat(7)), []);
    assert.deepEqual(C.heartbeatGaps(beat(7)), [`store:${key}`]);
    assert.deepEqual(C.heartbeatGaps(beat(5)), []);
    assert.deepEqual(C.heartbeatGaps(beat(5, 'restarted')), [`store:${key}`]);
    // the slice replaces the state and adopts the position
    assert.deepEqual(S.applyEfspStoreSlices({ [key]: { seq: 9, epoch: 'new', slice: [] } }), [key]);
    assert.deepEqual(S.getEfspStoreSync(key), { seq: 9, epoch: 'new' });
    assert.deepEqual(C.resyncPositionOf(`store:${key}`), { stores: { [key]: { lastSeq: 9, epoch: 'new' } } });
  });
}

test('a slice replaces that store only: its records go, the others stay', async () => {
  const { S, C } = await load();
  assert.equal(S.getAllEfspAirspaces().length, 1);
  S.applyEfspStoreSlices({ airspaces: { seq: 8, epoch: 'e-airspaces', slice: [{ airspaceId: 'A2', defRev: 1, definition: {} }] } });
  assert.deepEqual(S.getAllEfspAirspaces().map(a => a.airspaceId), ['A2']);
  assert.equal(S.getAllEfspCorrelations().length, 1);
  assert.equal(S.getEfspStoreSync('correlations').seq, 3);
});

test('a heartbeat for a store we hold no position for changes nothing', async () => {
  const { S, C } = await load();
  assert.deepEqual(C.heartbeatGaps({ stores: { nope: { seq: 9, epoch: 'x' } } }), []);
  assert.deepEqual(C.heartbeatGaps({}), []);
});

// ── through the registry: the request, one in flight, the reply ──────────────
async function wired() {
  const g = freshGraph();
  const S = await g.import('panels/efsp/efsp-state.js');
  const ws = await g.import('panels/efsp/efsp-ws.js');
  const reg = await g.import('panels/efsp/efsp-message-registry.js');
  for (const m of ['efsp-messages', 'airspace-panel', 'carrier-panel', 'runway-status-panel']) await g.import(`panels/efsp/${m}.js`);
  S._resetEfspStateForTest();
  S.applyEfspSnapshot(snap());
  const sent = [];
  ws.setEfspSender('_sendEfsp', (m) => sent.push(m));
  const resyncs = () => sent.filter(m => m.type === 'efsp-resync');
  return { S, ws, reg, sent, resyncs };
}

test('a skipped airspace delta asks for one airspace resync, a second is held while it is in flight, the reply heals it', async () => {
  const { S, ws, reg, resyncs } = await wired();
  reg.dispatchEfspMessage({ type: 'efsp-airspace-delta', airspaceSeq: 5, airspaceEpoch: 'e-airspaces', airspaces: { updated: [], removed: [] } });
  assert.deepEqual(resyncs(), [{ version: 1, type: 'efsp-resync', stores: { airspaces: { lastSeq: 3, epoch: 'e-airspaces' } } }]);
  reg.dispatchEfspMessage({ type: 'efsp-airspace-delta', airspaceSeq: 6, airspaceEpoch: 'e-airspaces', airspaces: { updated: [], removed: [] } });
  assert.equal(resyncs().length, 1, 'one in flight');
  reg.dispatchEfspMessage({ type: 'efsp-resync-reply', answer: 'stores', stores: { airspaces: { seq: 6, epoch: 'e-airspaces', slice: [{ airspaceId: 'A9', defRev: 2, definition: {} }] } } });
  assert.deepEqual(S.getAllEfspAirspaces().map(a => a.airspaceId), ['A9']);
  assert.deepEqual(S.getEfspStoreSync('airspaces'), { seq: 6, epoch: 'e-airspaces' });
  reg.dispatchEfspMessage({ type: 'efsp-airspace-delta', airspaceSeq: 8, airspaceEpoch: 'e-airspaces', airspaces: { updated: [], removed: [] } });
  assert.equal(resyncs().length, 2, 'answered, so a new gap may ask again');
});

test('a heartbeat two beats behind in a store asks for that store, and only that one; an epoch change asks at once', async () => {
  const { reg, resyncs } = await wired();
  const beat = (stores) => ({ type: 'efsp-heartbeat', stores });
  const ok = Object.fromEntries(KEYS.map(k => [k, { seq: 3, epoch: `e-${k}` }]));
  reg.dispatchEfspMessage(beat({ ...ok, correlations: { seq: 4, epoch: 'e-correlations' } }));
  assert.equal(resyncs().length, 0);
  reg.dispatchEfspMessage(beat({ ...ok, correlations: { seq: 4, epoch: 'e-correlations' }, carriers: { seq: 3, epoch: 'restarted' } }));
  assert.deepEqual(resyncs().map(m => Object.keys(m.stores)).flat().sort(), ['carriers', 'correlations']);
});

test('a lost reply is retried after ten heartbeats', async () => {
  const { reg, resyncs } = await wired();
  const beat = { type: 'efsp-heartbeat', stores: { marsa: { seq: 3, epoch: 'other' } } };
  reg.dispatchEfspMessage(beat);
  assert.equal(resyncs().length, 1);
  for (let i = 0; i < 8; i++) reg.dispatchEfspMessage(beat);
  assert.equal(resyncs().length, 1);
  reg.dispatchEfspMessage(beat);
  reg.dispatchEfspMessage(beat);
  assert.equal(resyncs().length, 2);
});

test('a delta answer\'s stores are applied beside the Board delta, and a snapshot answer clears the in-flight stores', async () => {
  const { S, reg, resyncs } = await wired();
  reg.dispatchEfspMessage({ type: 'efsp-heartbeat', stores: { carriers: { seq: 3, epoch: 'new' } } });
  assert.equal(resyncs().length, 1);
  reg.dispatchEfspMessage({ type: 'efsp-resync-reply', answer: 'delta', facilityId: 'INCIRLIK', boardSeq: 2, boardEpoch: 'b',
    strips: { updated: [], gone: [] }, flightDataList: { updated: [] }, positions: { updated: [] },
    stores: { carriers: { seq: 4, epoch: 'new', slice: [{ hullId: 'CV2', caseValue: 'II' }] } } });
  assert.deepEqual(S.getEfspStoreSync('carriers'), { seq: 4, epoch: 'new' });
  assert.equal(S.efspResyncPositionFor(S.getEfspFacility()).lastBoardSeq, 2);
  reg.dispatchEfspMessage({ type: 'efsp-heartbeat', stores: { carriers: { seq: 4, epoch: 'again' } } });
  assert.equal(resyncs().length, 2);
  reg.dispatchEfspMessage({ type: 'efsp-resync-reply', answer: 'snapshot', ...snap() });
  reg.dispatchEfspMessage({ type: 'efsp-heartbeat', stores: { carriers: { seq: 3, epoch: 'third' } } });
  assert.equal(resyncs().length, 3, 'the snapshot cleared the one in flight');
});

test('every store has a redraw, and a slice redraws through it instead of dispatching a synthetic frame', async () => {
  const { S, reg } = await wired();
  assert.deepEqual(reg.registeredEfspStoreRedraws(), S.STORE_SYNC.map(d => d.key).sort());
  const dispatched = [];
  const observer = (m) => dispatched.push(m.type);
  reg.addEfspMessageObserver(observer);
  reg.dispatchEfspMessage({ type: 'efsp-resync-reply', answer: 'stores', stores: { airspaces: { seq: 4, epoch: 'e-airspaces', slice: [] } } });
  assert.deepEqual(dispatched, ['efsp-resync-reply'], 'no efsp-airspace-delta was faked');
  assert.deepEqual(S.getAllEfspAirspaces(), []);
});

test('Board and store requests share one in-flight rule: a Board epoch change asks once, the delta of the new lifetime does not answer it', async () => {
  const { reg, resyncs } = await wired();
  const stale = { type: 'efsp-board-delta', facilityId: 'INCIRLIK', boardSeq: 1, boardEpoch: 'other', strips: { updated: [], gone: [] }, flightDataList: { updated: [] }, positions: { updated: [] } };
  reg.dispatchEfspMessage(stale);
  reg.dispatchEfspMessage(stale);
  assert.deepEqual(resyncs(), [{ version: 1, type: 'efsp-resync', facilityId: 'INCIRLIK', lastBoardSeq: 1, boardEpoch: 'b' }]);
  reg.dispatchEfspMessage({ ...stale, boardSeq: 2, boardEpoch: 'b' });
  reg.dispatchEfspMessage(stale);
  assert.equal(resyncs().length, 2, 'a delta from our own lifetime answered it');
});
