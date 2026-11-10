import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import WsHub from '../src/ws-hub.js';
import TrackStore from '../src/tracks.js';
import CollaborativeStore from '../src/collab-store.js';
import { fakeWs } from './helpers/ws.mjs';
import serviceMod from '../src/radio/relay-service.js';
import wireMod from '../src/radio/relay-wire.js';
import srsClientMod from '../src/radio/relay-srs-client.js';
import packetMod from '../src/radio/srs/voice-packet.js';

// docs/adr/0160: crc-sync is the one relay node. The service with fake SRS connections, the wire family, the hub
// binding, and one real relay connection against a fake socket.

const { createRelayService } = serviceMod;
const { createRadioRelayWire, LINK_GROUPS } = wireMod;
const { createRelaySrsClient, srsCoalitionOf, RELAY_NAME } = srsClientMod;
const { decodeVoicePacket } = packetMod;

const F1 = '251000:AM', F2 = '122100:AM', F3 = '305500:AM';
const PILOT = 'p'.repeat(22);
const hz = (key) => Number(key.split(':')[0]) * 1000;

function fakeConnections() {
  const conns = [];
  let n = 0;
  const create = ({ onPacket, onState }) => {
    const c = {
      guid: `relay${String(n++).padStart(17, '0')}`, channels: [], sent: [], stopped: false, onPacket, onState,
      setChannels(cs) { c.channels = cs.slice(); }, send(p) { c.sent.push(p); return true; }, stop() { c.stopped = true; },
      state: () => ({ connected: true, udpReady: true, error: null }),
      hear(keys, o = {}) {
        onPacket({ audio: Buffer.from([1]), frequencies: keys.map(hz), modulations: keys.map(() => 0), encryptions: keys.map(() => 0),
          unitId: 9, packetNumber: o.packetNumber ?? 1, retransmissionCount: 0, originalGuid: o.guid || PILOT, guid: o.guid || PILOT }, c);
      },
    };
    conns.push(c);
    return c;
  };
  return { conns, create, open: () => conns.filter(c => !c.stopped) };
}
function service() {
  const f = fakeConnections();
  const delivered = [];
  const s = createRelayService({ endpoint: { host: 'x', port: 1 }, ownCoalition: 3, deliver: (out) => delivered.push(...out), createConnection: f.create });
  return { s, f, delivered };
}
const lastFrame = (frames, session) => frames.filter(o => o.session === session).at(-1).frame;

test('two controllers linking the same frequencies: one network, one connection, exactly one relayed copy', () => {
  const { s, f } = service();
  s.setGroups('a', [{ id: 'g', channels: [F1, F2] }]);
  s.setGroups('b', [{ id: 'h', channels: [F1, F2] }]);
  assert.deepEqual(s.networks(), [{ channels: [F2, F1] }]);
  assert.equal(f.open().length, 1);
  f.open()[0].hear([F1]);
  const sent = f.conns.flatMap(c => c.sent);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].frequencies, [hz(F2)]);
  assert.equal(s.relayedPackets(), 1);
});

test('A {F1,F2} + B {F2,F3}: a pilot on F1 is heard on F2 and F3; B closing shrinks the network at once', () => {
  const { s, f } = service();
  s.setGroups('a', [{ id: 'g', channels: [F1, F2] }]);
  const b = s.setGroups('b', [{ id: 'h', channels: [F2, F3] }]);
  assert.deepEqual(lastFrame(b, 'b').networks, [{ channels: [F2, F1, F3] }]);
  f.open()[0].hear([F1]);
  assert.deepEqual(f.conns[0].sent.at(-1).frequencies.sort(), [hz(F2), hz(F3)].sort());
  const out = s.close('b');
  assert.deepEqual(s.networks(), [{ channels: [F2, F1] }]);
  assert.deepEqual(lastFrame(out, 'a').networks, [{ channels: [F2, F1] }], 'a is told its network shrank');
  assert.deepEqual(f.conns[0].channels, [F2, F1], 'F3 is no longer tuned');
  f.open()[0].hear([F1], { packetNumber: 2 });
  assert.deepEqual(f.conns[0].sent.at(-1).frequencies, [hz(F2)]);
  s.close('a');
  assert.equal(f.open().length, 0, 'no network, no connection');
});

test('status goes only to sessions with a channel in the network, and only when it changed', () => {
  const { s } = service();
  const a = s.setGroups('a', [{ id: 'g', channels: [F1, F2] }]);
  assert.deepEqual(lastFrame(a, 'a'), { version: 1, type: 'radio-relay-status', networks: [{ channels: [F2, F1] }], connected: true });
  const c = s.setGroups('c', [{ id: 'k', channels: [F3, '260000:AM'] }]);
  assert.deepEqual(lastFrame(c, 'c').networks, [{ channels: ['260000:AM', F3] }]);
  assert.equal(c.filter(o => o.session === 'a').length, 0, 'a\'s networks did not change');
});

test('a packet heard on two connections is relayed once (pool dedupe), and the 12th channel opens a second connection', () => {
  const { s, f } = service();
  const many = Array.from({ length: 12 }, (_, i) => `${251000 + i * 25}:AM`);
  s.setGroups('a', [{ id: 'g', channels: many.slice(0, 11) }, { id: 'h', channels: [many[10], many[11]] }]);
  assert.equal(f.open().length, 2);
  assert.deepEqual(f.open().map(c => c.channels.length), [11, 1]);
  const keys = [many.sort()[0], many[11]];
  f.open()[0].hear(keys, { guid: 'c'.repeat(22), packetNumber: 7 });
  f.open()[1].hear(keys, { guid: 'c'.repeat(22), packetNumber: 7 });
  assert.equal(f.conns.flatMap(c => c.sent).length, 1);
});

test('the wire: a malformed message is refused, a good one acked then answered with the status', () => {
  const { s } = service();
  const wire = createRadioRelayWire({ service: s });
  assert.equal(wire.handles(LINK_GROUPS), true);
  for (const groups of [null, [{ id: '', channels: [] }], [{ id: 'g', channels: ['251.000'] }], [{ id: 'g', channels: Array(12).fill(F1) }]]) {
    const [r] = wire.handle('a', { type: LINK_GROUPS, clientMutationId: 'm', groups });
    assert.equal(r.frame.type, 'radio-link-groups-ack');
    assert.equal(r.frame.ok, false);
    assert.equal(r.frame.reason, 'VALIDATION_ERROR');
  }
  const out = wire.handle('a', { type: LINK_GROUPS, clientMutationId: 'm', groups: [{ id: 'g', channels: [F1, F2, F1] }] });
  assert.deepEqual(out.map(o => o.frame.type), ['radio-link-groups-ack', 'radio-relay-status']);
  assert.equal(out[0].frame.ok, true);
  const empty = wire.handle('a', { type: LINK_GROUPS, clientMutationId: 'n', groups: [] });
  assert.deepEqual(lastFrame(empty, 'a'), { version: 1, type: 'radio-relay-status', networks: [], connected: false });
});

test('through the hub: groups in, status out, a close withdraws them at once', () => {
  const { s } = service();
  const radioRelay = createRadioRelayWire({ service: s });
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore(), radioRelay });
  const join = (id) => { const ws = fakeWs(); const sess = { controllerId: id, who: id }; hub._sessions.set(ws, sess); return { ws, sess }; };
  const a = join('a'), b = join('b');
  hub._onMessage(a.ws, a.sess, JSON.stringify({ version: 1, type: LINK_GROUPS, clientMutationId: 'x', groups: [{ id: 'g', channels: [F1, F2] }] }));
  hub._onMessage(b.ws, b.sess, JSON.stringify({ version: 1, type: LINK_GROUPS, clientMutationId: 'y', groups: [{ id: 'h', channels: [F2, F3] }] }));
  assert.equal(a.ws.of('radio-link-groups-ack')[0].ok, true);
  assert.deepEqual(a.ws.of('radio-relay-status').at(-1).networks, [{ channels: [F2, F1, F3] }]);
  hub._sessions.delete(b.ws);
  hub.sendRadioRelay(radioRelay.close(b.sess));
  assert.deepEqual(a.ws.of('radio-relay-status').at(-1).networks, [{ channels: [F2, F1] }]);
});

test('a relay down is in the status, with its reason', () => {
  const f = fakeConnections();
  const delivered = [];
  let up = true;
  const create = (o) => { const c = f.create(o); c.state = () => (up ? { connected: true, udpReady: true, error: null } : { connected: false, udpReady: false, error: 'SRS x:1: ECONNREFUSED' }); return c; };
  const s = createRelayService({ endpoint: { host: 'x', port: 1 }, ownCoalition: 3, deliver: (out) => delivered.push(...out), createConnection: create });
  s.setGroups('a', [{ id: 'g', channels: [F1, F2] }]);
  up = false;
  f.conns[0].onState();
  assert.deepEqual(lastFrame(delivered, 'a'), { version: 1, type: 'radio-relay-status', networks: [{ channels: [F2, F1] }], connected: false, error: 'SRS x:1: ECONNREFUSED' });
});

// One real relay connection, against a fake TCP and UDP socket: what it tells the SRS server, and the packet it sends.
function fakeNet() {
  const sockets = [];
  return {
    sockets,
    createConnection() { const s = new EventEmitter(); s.written = []; s.write = (b) => s.written.push(b.toString()); s.destroy = () => s.emit('close'); s.setNoDelay = () => {}; sockets.push(s); return s; },
  };
}
function fakeDgram() {
  const sockets = [];
  return {
    sockets,
    createSocket() { const s = new EventEmitter(); s.sent = []; s.send = (b) => s.sent.push(Buffer.from(b)); s.connect = (_p, _h, cb) => cb(); s.close = () => {}; sockets.push(s); return s; },
  };
}
const timers = { setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} };

test('a relay connection: SYNC as CRC RELAY in the own coalition, no position, its channels tuned; relays once UDP is ready', () => {
  const net = fakeNet(), dgram = fakeDgram();
  const heard = [];
  const guid = 'r'.repeat(22);
  const c = createRelaySrsClient({ host: 'h', port: 5002, coalition: srsCoalitionOf(3), onPacket: (p) => heard.push(p), deps: { net, dgram, timers, now: () => 0, guid } });
  c.setChannels([F2, F1]);
  net.sockets[0].emit('connect');
  const sync = JSON.parse(net.sockets[0].written[0]);
  assert.equal(sync.MsgType, 2);
  assert.equal(sync.Client.Name, RELAY_NAME);
  assert.equal(sync.Client.Coalition, 2, 'BLUE (DCS-gRPC 3) is SRS 2');
  assert.deepEqual(sync.Client.LatLngPosition, { lat: 0, lng: 0, alt: 0 });
  const radios = sync.Client.RadioInfo.radios;
  assert.deepEqual(radios.slice(0, 2).map(r => [r.freq, r.modulation]), [[hz(F2), 0], [hz(F1), 0]]);
  assert.equal(radios[2].modulation, 3, 'the rest DISABLED');
  assert.equal(srsCoalitionOf(2), 1, 'RED');
  const pkt = { audio: Buffer.from([5]), frequencies: [hz(F2)], modulations: [0], encryptions: [0], unitId: 1, packetNumber: 3, retransmissionCount: 1, originalGuid: PILOT, guid };
  assert.equal(c.send(pkt), false, 'not before the UDP echo');
  dgram.sockets.at(-1).emit('message', Buffer.from(guid, 'latin1'));
  assert.equal(c.state().udpReady, true);
  assert.equal(c.send(pkt), true);
  assert.equal(decodeVoicePacket(dgram.sockets.at(-1).sent.at(-1)).guid, guid);
  c.setChannels([F1]);
  assert.equal(JSON.parse(net.sockets[0].written.at(-1)).MsgType, 3, 'RADIO_UPDATE on a retune');
  c.stop();
});
