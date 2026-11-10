// One SRS session (app/srs/srs-session.js): radios to slots, PTT to packets, packets to the renderer.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createSrsSession } = require('../app/srs/srs-session');
const { encodeVoicePacket, decodeVoicePacket } = require('../app/srs/voice-packet');
const { MsgType } = require('../app/srs/sync-message');

const G = '0123456789abcdefghijkl';
const OTHER = 'ZYXWVUTSRQPONMLKJIHGFE';

function rig() {
  const tcp = [], udp = [];
  const deps = {
    net: { createConnection() { const s = new EventEmitter(); s.written = []; s.write = (b) => s.written.push(JSON.parse(b)); s.destroy = () => s.emit('close'); tcp.push(s); return s; } },
    dgram: { createSocket() { const s = new EventEmitter(); s.sent = []; s.connect = (p, h, cb) => cb(); s.send = (b) => s.sent.push(Buffer.from(b)); s.close = () => {}; udp.push(s); return s; } },
    timers: { setTimeout: () => ({}), clearTimeout() {}, setInterval: () => ({}), clearInterval() {} },
    now: () => 0,
  };
  const states = [], rx = [];
  const s = createSrsSession({ host: 'srs', port: 5002, guid: G, name: 'VIPER CTL', onState: (x) => states.push(x), onRx: (x) => rx.push(x), deps });
  s.start();
  tcp[0].emit('connect');
  return { s, tcp, udp, states, rx, echo: () => udp.at(-1).emit('message', Buffer.from(G)) };
}

const RADIOS = [
  { id: 'GUARD:UHF', mhz: 243, modulation: 'AM', label: 'Guard UHF' },
  { id: 'POSITION:p1:UHF', mhz: 251, modulation: 'AM', label: 'APP' },
  { id: 'POSITION:p1:VHF', mhz: 122.1, modulation: 'AM', label: 'APP VHF' },
  { id: 'MANUAL:1', mhz: 251, modulation: 'AM', label: 'spare' },
];

test('the radios go to SRS as slots, one per channel, named after the label', () => {
  const { s, tcp } = rig();
  s.setRadios(RADIOS);
  const msg = tcp[0].written.at(-1);
  assert.equal(msg.MsgType, MsgType.RADIO_UPDATE);
  const r = msg.Client.RadioInfo.radios;
  assert.deepEqual(r.slice(0, 4).map(x => x.freq), [243e6, 251e6, 122.1e6, 1]);
  assert.equal(r[1].Name, 'app');
  assert.equal(r[1].Model, 'crc');
  assert.equal(msg.Client.Name, 'VIPER CTL');
});

test('the voice socket opens when the sync link connects, and PTT is refused until UDP is ready', () => {
  const { s, udp, states, echo } = rig();
  assert.equal(udp.length, 1);
  s.setRadios(RADIOS);
  s.ptt(true, ['POSITION:p1:UHF']);
  assert.match(states.at(-1).error, /not ready/);
  assert.equal(s.txFrame(Buffer.from([1])), false);
  echo();
  s.ptt(true, ['POSITION:p1:UHF']);
  assert.equal(states.at(-1).error, null);
});

test('a group transmits each frame as one packet with all its frequencies, own GUID twice, count 0', () => {
  const { s, udp, tcp, states, echo } = rig();
  echo();
  s.setRadios(RADIOS);
  s.ptt(true, ['POSITION:p1:UHF', 'POSITION:p1:VHF', 'MANUAL:1']);
  assert.deepEqual(states.at(-1).txRadioIds, ['POSITION:p1:UHF', 'MANUAL:1', 'POSITION:p1:VHF']);
  assert.equal(tcp[0].written.at(-1).Client.RadioInfo.radioIndex, 1, 'the selected slot follows the key');
  s.txFrame(Buffer.from([7, 7])); s.txFrame(Buffer.from([8]));
  const sent = udp[0].sent.filter(b => b.length > 22).map(decodeVoicePacket);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].frequencies, [251e6, 122.1e6]);
  assert.deepEqual([sent[0].packetNumber, sent[1].packetNumber], [1, 2]);
  assert.equal(sent[0].guid, G); assert.equal(sent[0].originalGuid, G); assert.equal(sent[0].retransmissionCount, 0);
  s.ptt(false);
  assert.equal(s.txFrame(Buffer.from([9])), false);
  assert.deepEqual(states.at(-1).txRadioIds, []);
});

test('a received packet goes to the renderer with every matching radio; an unmatched one is counted', () => {
  const { s, udp, rx, states, echo } = rig();
  echo();
  s.setRadios(RADIOS);
  const pkt = (freqs) => encodeVoicePacket({ audio: Buffer.from([1, 2]), frequencies: freqs, modulations: freqs.map(() => 0),
    encryptions: freqs.map(() => 0), unitId: 5, packetNumber: 3, retransmissionCount: 0, originalGuid: OTHER, guid: OTHER });
  udp[0].emit('message', pkt([251e6]));
  udp[0].emit('message', pkt([300e6]));
  assert.equal(rx.length, 1);
  assert.deepEqual(rx[0].header, { radioIds: ['POSITION:p1:UHF', 'MANUAL:1'], guid: OTHER, originalGuid: OTHER, packetNumber: 3, retransmissionCount: 0 });
  assert.deepEqual([...rx[0].opus], [1, 2]);
  s.setRadios(RADIOS);
  assert.equal(states.at(-1).unmatchedPackets, 1);
});

test('crc-sync\'s relay (ADR 0160): its copy of a pilot already heard plays once, our own voice relayed back not at all', () => {
  const { s, udp, rx, states, echo } = rig();
  echo();
  s.setRadios(RADIOS);
  const RELAY = 'R'.repeat(22);
  const pkt = (hz, o) => encodeVoicePacket({ audio: Buffer.from([1]), frequencies: [hz], modulations: [0], encryptions: [0],
    unitId: 1, packetNumber: 9, retransmissionCount: 0, originalGuid: OTHER, guid: OTHER, ...o });
  udp[0].emit('message', pkt(251e6));
  udp[0].emit('message', pkt(122.1e6, { guid: RELAY, retransmissionCount: 1 }));
  assert.equal(rx.length, 1, 'the relay\'s copy on the other frequency is dropped');
  udp[0].emit('message', pkt(122.1e6, { guid: RELAY, retransmissionCount: 1, packetNumber: 10 }));
  assert.equal(rx.length, 2, 'a packet heard only through the relay plays');
  udp[0].emit('message', pkt(122.1e6, { guid: RELAY, retransmissionCount: 1, originalGuid: G }));
  assert.equal(rx.length, 2, 'our own voice, relayed onto a frequency we hear, is no echo');
  s.setRadios(RADIOS);
  assert.equal(states.at(-1).duplicatePackets, 1);
});

test('more than eleven channels: the rest is an error in the state', () => {
  const { s, states } = rig();
  s.setRadios(Array.from({ length: 12 }, (_, i) => ({ id: `M${i}`, mhz: 250 + i })));
  assert.match(states.at(-1).error, /11/);
});

test('intercom: the unit id follows setIntercomUnit into RADIO_UPDATE and packets; the client list is in the state', () => {
  const { s, tcp, udp, states, echo } = rig();
  echo();
  s.setRadios([{ id: 'IC', mhz: 0, modulation: 'INTERCOM', label: 'Intercom' }, ...RADIOS]);
  tcp[0].emit('data', Buffer.from(JSON.stringify({ MsgType: MsgType.SYNC, Clients: [
    { ClientGuid: OTHER, Name: 'Viper 1-1', RadioInfo: { unitId: 4242 } },
    { ClientGuid: 'x'.repeat(22), Name: 'spectator', RadioInfo: { unitId: 0 } },
    { ClientGuid: G, Name: 'us', RadioInfo: { unitId: 1 } }] }) + '\n'));
  assert.deepEqual(states.at(-1).srsClients, [{ name: 'Viper 1-1', unitId: 4242 }]);
  s.setIntercomUnit(4242);
  const ri = tcp[0].written.at(-1).Client.RadioInfo;
  assert.equal(ri.unitId, 4242);
  assert.equal(ri.radios[0].modulation, 2);
  assert.equal(ri.radios[0].IntercomUnitId, 4242);
  assert.equal(ri.radios[1].IntercomUnitId, 0);
  s.ptt(true, ['IC']); s.txFrame(Buffer.from([1]));
  const p = decodeVoicePacket(udp[0].sent.at(-1));
  assert.deepEqual([p.unitId, p.frequencies, p.modulations], [4242, [100], [2]]);
  tcp[0].emit('data', Buffer.from(JSON.stringify({ MsgType: MsgType.CLIENT_DISCONNECT, Client: { ClientGuid: OTHER } }) + '\n'));
  assert.deepEqual(states.at(-1).srsClients, []);
  s.setIntercomUnit(null);
  assert.equal(states.at(-1).unitId, 1);
});
