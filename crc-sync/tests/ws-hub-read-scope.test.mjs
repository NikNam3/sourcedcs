import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// B6 at the hub (docs/adr/0080): every path that carries EFSP state to a
// session goes through the read scope. L8's J4 reaches only the resync; these
// walk the connect snapshot, every broadcast, the alerts and a held-set change,
// with a real EFSP facade behind a real WsHub and a fake socket per session.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-hub-scope-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');

const WsHub = (await import('../src/ws-hub.js')).default;
const TrackStore = (await import('../src/tracks.js')).default;
const CollaborativeStore = (await import('../src/collab-store.js')).default;
const { createEfsp } = await import('../src/efsp/index.js');
const { crew, mustAct, jumpTo, airborneDeparture, DEPARTURE_FDR } = await import('./helpers/efsp-scenario.mjs');

const OPEN = 1;
const fakeWs = () => {
  const sent = [];
  return { readyState: OPEN, send: (raw) => sent.push(JSON.parse(raw)), on() {}, sent, of(type) { return sent.filter(m => m.type === type); } };
};

/** A hub over a fresh EFSP with TAC_C2 holding two lines, one handed to JTAC, and one Incirlik departure. */
function world() {
  fs.rmSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, { force: true });
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', APP: 'INCIRLIK', TAC_C2: 'TACTICAL', JTAC: 'TACTICAL' });
  const line = (callsign) => {
    let l = mustAct(efsp, c.TAC_C2, 'TAC_C2', null, { kind: 'CreateStrip', bayId: 'tac-c2-tasked', rackId: 'main', role: 'MISSION', fdr: { callsign } });
    l = jumpTo(efsp, c.TAC_C2, 'TAC_C2', l, 'AIRBORNE');
    return jumpTo(efsp, c.TAC_C2, 'TAC_C2', l, 'ON_STATION');
  };
  const handed = mustAct(efsp, c.TAC_C2, 'TAC_C2', line('HND11'), { kind: 'TransferStrip', toPositionId: 'JTAC', bayId: 'jtac-mission', rackId: 'main' });
  const kept = line('KPT11');
  const dep = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'DEP11' });
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore(), efsp });
  const clients = new Set();
  hub._wss = { clients };
  const connect = (name, held = []) => {
    const ws = fakeWs();
    clients.add(ws);
    hub._onConnect(ws, { crcUser: { name } });
    const session = hub._sessions.get(ws);
    for (const [facilityId, ids] of Object.entries(held)) hub._onMessage(ws, session, JSON.stringify({ type: 'efsp-set-positions', facilityId, held: ids }));
    ws.sent.length = 0;
    return { ws, session };
  };
  const send = ({ ws, session }, msg) => hub._onMessage(ws, session, JSON.stringify(msg));
  return { efsp, hub, c, handed, kept, dep, connect, send, clients };
}
const tacStrip = (w, id) => w.efsp.boardStoreFor('TACTICAL').getStrip(id);
let cmid = 0;
const mut = (w, positionId, strip, op, facilityId = 'TACTICAL') => ({
  version: 1, type: 'efsp-mutation', clientMutationId: `00000000-0000-4000-8000-${String(++cmid).padStart(12, '0')}`,
  facilityId, actingPositionId: positionId, stripId: strip.stripId, baseRev: strip.rev, op,
});

test('the connect snapshot a JTAC-only session receives carries only its handed Strips and their FDRs', () => {
  const w = world();
  // Connect WITHOUT the helper's clearing: the snapshot is the first thing sent.
  const ws = fakeWs();
  w.clients.add(ws);
  // The JTAC (c-JTAC, already Primary there) reconnects: the position store is keyed by controller.
  w.hub._onConnect(ws, { crcUser: { name: 'c-JTAC' } });
  const [snap] = ws.of('efsp-snapshot');
  assert.deepEqual(snap.strips.map(s => s.stripId), [w.handed.stripId]);
  assert.deepEqual(snap.fdrs.map(f => f.fdrId), [w.handed.fdrId]);
  assert.ok(snap.positions.length >= 4 && snap.bays.length > 0, 'occupancy and Bays are not flights (Q7)');
  const [alerts] = ws.of('efsp-alerts');
  assert.ok(alerts, 'the alerts are sent, scoped');
});

test('a Mutation broadcast reaches a JTAC session with the other Strips removed and the seq intact', () => {
  const w = world();
  const jt = w.connect('c-JTAC', { TACTICAL: ['JTAC'] });
  const tc = w.connect('c-TAC_C2', { TACTICAL: ['TAC_C2'] });
  jt.ws.sent.length = 0; tc.ws.sent.length = 0;
  w.send(tc, mut(w, 'TAC_C2', tacStrip(w, w.kept.stripId), { kind: 'SetBlock', blockId: 'M2', value: 'PKG-1' }));
  const [jd] = jt.ws.of('efsp-board-delta');
  const [td] = tc.ws.of('efsp-board-delta');
  assert.ok(jd, 'sent even though nothing of the JTAC\'s changed: the seq stays continuous');
  assert.deepEqual(jd.strips.updated, []);
  assert.deepEqual(jd.strips.gone, [w.kept.stripId]);
  assert.equal(jd.boardSeq, td.boardSeq);
  assert.deepEqual(jd.fdrs.updated, []);
  assert.deepEqual(td.strips.updated.map(s => s.stripId), [w.kept.stripId], 'TAC_C2 is sent it as ever');
});

test('a line handed back to TAC_C2 arrives in the JTAC session\'s gone list', () => {
  const w = world();
  const jt = w.connect('c-JTAC', { TACTICAL: ['JTAC'] });
  w.send(jt, mut(w, 'JTAC', tacStrip(w, w.handed.stripId), { kind: 'TransferStrip', toPositionId: 'TAC_C2', bayId: 'tac-c2-on-station', rackId: 'main' }));
  const ack = jt.ws.of('efsp-mutation-ack')[0];
  assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.equal(ack.strip.stripId, w.handed.stripId, 'its own ack still carries the Strip it acted on');
  const [delta] = jt.ws.of('efsp-board-delta');
  assert.deepEqual(delta.strips.updated, []);
  assert.deepEqual(delta.strips.gone, [w.handed.stripId]);
});

test('the NLA-monitor sweep and the set-positions re-stamp are filtered too', () => {
  const w = world();
  const jt = w.connect('c-JTAC', { TACTICAL: ['JTAC'] });
  const tc = w.connect('c-TAC_C2', { TACTICAL: ['TAC_C2'] });
  jt.ws.sent.length = 0; tc.ws.sent.length = 0;
  const all = w.efsp.boardStoreFor('TACTICAL').getAll().filter(s => s.state !== 'DROPPED');
  // The monitor's payload shape (broadcastEfspBoardDelta): every changed Strip.
  w.hub.broadcastEfspBoardDelta({ facilityId: 'TACTICAL', boardSeq: 1, strips: all, gone: [] });
  assert.deepEqual(jt.ws.of('efsp-board-delta')[0].strips.updated.map(s => s.stripId), [w.handed.stripId]);
  assert.equal(tc.ws.of('efsp-board-delta')[0].strips.updated.length, all.length);
  jt.ws.sent.length = 0;
  // A third controller giving up a Position re-sends every live Strip of the Facility.
  const gci = w.connect('gci', { TACTICAL: ['GCI'] });
  w.send(gci, { type: 'efsp-set-positions', facilityId: 'TACTICAL', held: [] });
  const restamp = jt.ws.of('efsp-board-delta').pop();
  assert.ok(restamp);
  assert.deepEqual(restamp.strips.updated.map(s => s.stripId), [w.handed.stripId]);
  assert.ok(restamp.positions.updated.length > 0, 'occupancy is not filtered');
});

test('correlation and MARSA deltas carry only the JTAC\'s flights, and are skipped when none is left', () => {
  const w = world();
  const jt = w.connect('c-JTAC', { TACTICAL: ['JTAC'] });
  const tc = w.connect('c-TAC_C2', { TACTICAL: ['TAC_C2'] });
  jt.ws.sent.length = 0; tc.ws.sent.length = 0;
  w.hub.broadcastEfspCorrelationDelta({ correlations: [{ fdrId: w.handed.fdrId }, { fdrId: w.kept.fdrId }], stats: {} });
  assert.deepEqual(jt.ws.of('efsp-correlation-delta')[0].correlations.updated.map(c => c.fdrId), [w.handed.fdrId]);
  assert.equal(tc.ws.of('efsp-correlation-delta')[0].correlations.updated.length, 2);
  w.hub.broadcastEfspCorrelationDelta({ correlations: [{ fdrId: w.kept.fdrId }], stats: {} });
  assert.equal(jt.ws.of('efsp-correlation-delta').length, 1, 'nothing of the JTAC\'s: skipped');
  w.hub._broadcastEfsp({ type: 'efsp-marsa-delta', marsaSeq: 1, marsa: { updated: [{ marsaId: 'm1', participants: [w.kept.fdrId, w.dep.fdrId] }, { marsaId: 'm2', participants: [w.handed.fdrId, w.kept.fdrId] }] } });
  assert.deepEqual(jt.ws.of('efsp-marsa-delta')[0].marsa.updated.map(r => r.marsaId), ['m2']);
  assert.equal(tc.ws.of('efsp-marsa-delta')[0].marsa.updated.length, 2);
});

test('efsp-alerts\' conformance and obligations are scoped the same way', () => {
  const w = world();
  const jt = w.connect('c-JTAC', { TACTICAL: ['JTAC'] });
  const tc = w.connect('c-TAC_C2', { TACTICAL: ['TAC_C2'] });
  jt.ws.sent.length = 0; tc.ws.sent.length = 0;
  w.hub.broadcastEfspAlerts({
    conformance: [{ fdrId: w.handed.fdrId, alerts: [{ kind: 'ALT' }] }, { fdrId: w.kept.fdrId, alerts: [{ kind: 'ALT' }] }],
    stca: [],
    obligations: [{ facilityId: 'TACTICAL', stripId: w.handed.stripId, obligationType: 'X' }, { facilityId: 'TACTICAL', stripId: w.kept.stripId, obligationType: 'X' }],
  });
  const [ja] = jt.ws.of('efsp-alerts');
  assert.deepEqual(ja.conformance.map(c => c.fdrId), [w.handed.fdrId]);
  assert.deepEqual(ja.obligations.map(o => o.stripId), [w.handed.stripId]);
  const [ta] = tc.ws.of('efsp-alerts');
  assert.equal(ta.conformance.length, 2);
  assert.equal(ta.obligations.length, 2);
});

test('a controller holding JTAC and TAC_C2 sees everything; giving up TAC_C2 sends a filtered snapshot; taking it back sends a full one', () => {
  const w = world();
  const both = w.connect('both', { TACTICAL: ['JTAC', 'TAC_C2'] });
  w.hub.broadcastEfspBoardDelta({ facilityId: 'TACTICAL', boardSeq: 1, strips: w.efsp.boardStoreFor('TACTICAL').getAll(), gone: [] });
  assert.equal(both.ws.of('efsp-board-delta')[0].strips.updated.length, 2, 'union semantics: TAC_C2 reads ALL');
  both.ws.sent.length = 0;

  w.send(both, { type: 'efsp-set-positions', facilityId: 'TACTICAL', held: ['JTAC'] });
  const [narrow] = both.ws.of('efsp-snapshot');
  assert.ok(narrow, 'the scope narrowed: a fresh snapshot');
  assert.deepEqual(narrow.strips.map(s => s.stripId), [w.handed.stripId]);
  assert.equal(both.ws.of('efsp-alerts').length, 1);
  both.ws.sent.length = 0;

  w.send(both, { type: 'efsp-set-positions', facilityId: 'TACTICAL', held: ['JTAC', 'TAC_C2'] });
  const [wide] = both.ws.of('efsp-snapshot');
  assert.ok(wide, 'the scope widened: a fresh snapshot');
  assert.ok(wide.strips.length >= 3, 'every Strip again');
  both.ws.sent.length = 0;

  // A change that does not change the scope sends no snapshot.
  w.send(both, { type: 'efsp-set-positions', facilityId: 'TACTICAL', held: ['JTAC', 'TAC_C2', 'GCI'] });
  assert.equal(both.ws.of('efsp-snapshot').length, 0);
});

test('a session holding nothing still sees everything (H58)', () => {
  const w = world();
  const nobody = w.connect('nobody');
  w.hub.broadcastEfspBoardDelta({ facilityId: 'TACTICAL', boardSeq: 1, strips: w.efsp.boardStoreFor('TACTICAL').getAll(), gone: [] });
  assert.equal(nobody.ws.of('efsp-board-delta')[0].strips.updated.length, 2);
  const late = fakeWs();
  w.clients.add(late);
  w.hub._onConnect(late, { crcUser: { name: 'nobody2' } });
  assert.ok(late.of('efsp-snapshot')[0].strips.length >= 3);
});

test('an ALL session receives the identical message object (fast path), and a JTAC session a copy', () => {
  const w = world();
  const tc = w.connect('c-TAC_C2', { TACTICAL: ['TAC_C2'] });
  const jt = w.connect('c-JTAC', { TACTICAL: ['JTAC'] });
  const msg = { type: 'efsp-board-delta', boardSeq: 3, facilityId: 'TACTICAL', strips: { updated: [tacStrip(w, w.kept.stripId)], gone: [] }, fdrs: { updated: [] }, positions: { updated: [] } };
  assert.equal(w.efsp.filterForSession(tc.session, msg), msg);
  assert.notEqual(w.efsp.filterForSession(jt.session, msg), msg);
  assert.equal(msg.strips.updated.length, 1, 'the shared message is not mutated');
  assert.equal(w.hub._efspFilter(tc.session, msg), msg);
});

test('an OWNED session\'s resync is always a snapshot, even with a valid epoch and seq (the ring is unfiltered history); an ALL session gets its delta', () => {
  const w = world();
  const board = w.efsp.boardStoreFor('TACTICAL');
  const jt = w.connect('c-JTAC', { TACTICAL: ['JTAC'] });
  const tc = w.connect('c-TAC_C2', { TACTICAL: ['TAC_C2'] });
  const seq = board.currentSeq;
  w.send(tc, mut(w, 'TAC_C2', tacStrip(w, w.kept.stripId), { kind: 'SetBlock', blockId: 'M2', value: 'PKG-9' }));
  jt.ws.sent.length = 0; tc.ws.sent.length = 0;
  w.send(jt, { type: 'efsp-resync', facilityId: 'TACTICAL', lastBoardSeq: seq, boardEpoch: board.epoch });
  w.send(tc, { type: 'efsp-resync', facilityId: 'TACTICAL', lastBoardSeq: seq, boardEpoch: board.epoch });
  const jr = jt.ws.sent[0];
  assert.equal(jr.type, 'efsp-resync-reply');
  assert.equal(jr.answer, 'snapshot');
  assert.deepEqual(jr.strips.map(s => s.stripId), [w.handed.stripId]);
  assert.equal(tc.ws.sent[0].type, 'efsp-resync-reply');
  assert.equal(tc.ws.sent[0].answer, 'delta');
});

test('a line handed to the JTAC after it connected arrives with its FDR, and its correlation and MARSA records', () => {
  const w = world();
  const jt = w.connect('c-JTAC', { TACTICAL: ['JTAC'] });
  const tc = w.connect('c-TAC_C2', { TACTICAL: ['TAC_C2'] });
  // A flight TAC_C2 keeps, with a correlation record and a MARSA relation naming it.
  const line = mustAct(w.efsp, w.c.TAC_C2, 'TAC_C2', tacStrip(w, w.kept.stripId), { kind: 'SetBlock', blockId: 'M2', value: 'PKG' });
  w.efsp.correlationStore.getCorrelation = (id) => (id === line.fdrId ? { fdrId: id, state: 'CORRELATED', rev: 3 } : null);
  w.efsp.marsaStore.getAll = () => [{ marsaId: 'm1', participants: [line.fdrId, w.dep.fdrId], state: 'ACTIVE' }];
  jt.ws.sent.length = 0;
  w.send(tc, mut(w, 'TAC_C2', tacStrip(w, w.kept.stripId), { kind: 'TransferStrip', toPositionId: 'JTAC', bayId: 'jtac-mission', rackId: 'main' }));
  const delta = jt.ws.of('efsp-board-delta')[0];
  assert.deepEqual(delta.strips.updated.map(s => s.stripId), [w.kept.stripId]);
  assert.deepEqual(delta.fdrs.updated.map(f => f.fdrId), [w.kept.fdrId], 'its FDR came with it');
  assert.equal(delta.fdrs.updated[0].identity.callsign, 'KPT11');
  assert.deepEqual(jt.ws.of('efsp-correlation-delta')[0].correlations.updated.map(c => c.fdrId), [w.kept.fdrId]);
  assert.deepEqual(jt.ws.of('efsp-marsa-delta')[0].marsa.updated.map(r => r.marsaId), ['m1']);
  assert.equal(tc.ws.of('efsp-correlation-delta').length, 0, 'a session that reads everything gets no extras');
});
