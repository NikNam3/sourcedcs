import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fakeWs } from './helpers/ws.mjs';

// docs/adr/0100 §6 at the hub (S-UNDO0): an Undo's `efsp-undo-voided` goes, after the round trip's broadcasts, to
// the sessions signed on to the voided Position and to nobody else, and respects the read scope (docs/adr/0080).

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-hub-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '{}');

const WsHub = (await import('../src/ws-hub.js')).default;
const TrackStore = (await import('../src/tracks.js')).default;
const CollaborativeStore = (await import('../src/collab-store.js')).default;
const { createEfsp } = await import('../src/efsp/index.js');
const { DEPARTURE_FLIGHT_DATA } = await import('./helpers/efsp-scenario.mjs');


function world() {
  fs.rmSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, { force: true });
  const efsp = createEfsp();
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore(), efsp });
  const clients = new Set();
  hub._wss = { clients };
  const connect = (name, signedOn) => {
    const ws = fakeWs();
    clients.add(ws);
    hub._onConnect(ws, { crcUser: { name } });
    const session = hub._sessions.get(ws);
    for (const [facilityId, ids] of Object.entries(signedOn)) hub._onMessage(ws, session, JSON.stringify({ type: 'efsp-set-positions', facilityId, signedOn: ids }));
    ws.sent.length = 0;
    return { ws, session };
  };
  let n = 0;
  const send = (who, facilityId, positionId, strip, op) => {
    const clientMutationId = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    hub._onMessage(who.ws, who.session, JSON.stringify({
      version: 1, type: 'efsp-mutation', clientMutationId, facilityId, actingPositionId: positionId,
      stripId: strip ? strip.stripId : undefined, baseRev: strip ? strip.rev : undefined, op,
    }));
    return who.ws.sent.filter(m => m.type === 'efsp-mutation-ack' && m.clientMutationId === clientMutationId).pop();
  };
  return { efsp, connect, send };
}

test('two sessions: the one signed on to the voided Position gets efsp-undo-voided after the broadcasts; the other gets none', () => {
  const w = world();
  const ops = w.connect('c-OPS', { INCIRLIK: ['OPS'] });
  const lc = w.connect('c-LC', { INCIRLIK: ['LC'] });
  const ap = w.connect('c-AP', { INCIRLIK: ['AP'] });
  const board = w.efsp.boardStoreFor('INCIRLIK');
  let s = w.send(ops, 'INCIRLIK', 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...DEPARTURE_FLIGHT_DATA, callsign: 'HUB1' } }).strip;
  s = w.send(ops, 'INCIRLIK', 'OPS', s, { kind: 'SetState', toState: 'DEPARTED' }).strip;
  s = w.send(ops, 'INCIRLIK', 'OPS', s, { kind: 'TransferStrip', toPositionId: 'LC', bayId: 'lc-airborne', rackId: 'main' }).strip;
  const handoff = w.send(lc, 'INCIRLIK', 'LC', s, { kind: 'InvokeNla' });
  assert.ok(handoff.undoable, JSON.stringify(handoff));
  assert.equal(w.send(ap, 'INCIRLIK', 'AP', board.getStrip(s.stripId), { kind: 'SetBlock', blockId: '9A', value: 'RV' }).ok, true);
  for (const x of [ops, lc, ap]) x.ws.sent.length = 0;

  const undone = w.send(lc, 'INCIRLIK', 'LC', board.getStrip(s.stripId), { kind: 'Undo', actionId: handoff.undoable.actionId });
  assert.equal(undone.ok, true, JSON.stringify(undone));
  const [msg] = ap.ws.of('efsp-undo-voided');
  assert.ok(msg, 'AP is told');
  assert.deepEqual([msg.positionId, msg.undoneBy, msg.voided.length], ['AP', 'LC', 1]);
  const types = ap.ws.sent.map(m => m.type);
  assert.ok(types.indexOf('efsp-board-delta') < types.indexOf('efsp-undo-voided'), `after the Board event: ${types}`);
  assert.equal(ops.ws.of('efsp-undo-voided').length, 0, 'not to a session not signed on to AP');
  assert.equal(lc.ws.of('efsp-undo-voided').length, 0, 'not to the undoer');
});

test('read scope: a session that reads only what it owns is not told of a Strip it cannot see', () => {
  const w = world();
  const tac = w.connect('c-TAC_C2', { TACTICAL: ['TAC_C2'] });
  const jtac = w.connect('c-JTAC', { TACTICAL: ['JTAC'] });
  const board = w.efsp.boardStoreFor('TACTICAL');
  let line = w.send(tac, 'TACTICAL', 'TAC_C2', null, { kind: 'CreateStrip', bayId: 'tac-c2-tasked', rackId: 'main', stripType: 'MISSION', flightData: { callsign: 'JT9' } }).strip;
  line = w.send(tac, 'TACTICAL', 'TAC_C2', line, { kind: 'SetState', toState: 'AIRBORNE' }).strip;
  line = w.send(tac, 'TACTICAL', 'TAC_C2', line, { kind: 'SetState', toState: 'ON_STATION' }).strip;
  const handTo = w.send(tac, 'TACTICAL', 'TAC_C2', line, { kind: 'TransferStrip', toPositionId: 'JTAC', bayId: 'jtac-mission', rackId: 'main' });
  assert.ok(handTo.undoable, JSON.stringify(handTo));
  const back = w.send(jtac, 'TACTICAL', 'JTAC', board.getStrip(line.stripId), { kind: 'TransferStrip', toPositionId: 'TAC_C2', bayId: 'tac-c2-on-station', rackId: 'main' });
  assert.equal(back.ok, true, JSON.stringify(back));
  jtac.ws.sent.length = 0;
  // TAC_C2 undoes its hand-to: the Strip goes back before JTAC's hand-back (voided), and is TAC_C2's, not JTAC's.
  const undone = w.send(tac, 'TACTICAL', 'TAC_C2', board.getStrip(line.stripId), { kind: 'Undo', actionId: handTo.undoable.actionId });
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.deepEqual(undone.voided.map(v => v.actingPositionId), ['JTAC']);
  assert.equal(board.getStrip(line.stripId).ownerPositionId, 'TAC_C2');
  assert.equal(jtac.ws.of('efsp-undo-voided').length, 0, 'JTAC reads only its own Strips, and this one is not');
});
