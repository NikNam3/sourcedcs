// The SRS UDP voice link (app/srs/voice-link.js) against a fake dgram socket.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createVoiceLink, KEEPALIVE_MS } = require('../app/srs/voice-link');
const { encodeVoicePacket } = require('../app/srs/voice-packet');

const G = '0123456789abcdefghijkl';

function fake() {
  const sockets = [], timers = [];
  return {
    sockets, timers,
    dgram: { createSocket(type) {
      const s = new EventEmitter(); s.type = type; s.sent = []; s.closed = false;
      s.connect = (port, host, cb) => { s.target = [host, port]; cb(); };
      s.send = (b) => s.sent.push(Buffer.from(b));
      s.close = () => { s.closed = true; };
      sockets.push(s); return s;
    } },
    timersApi: { setInterval: (fn, ms) => { const h = { fn, ms, live: true }; timers.push(h); return h; }, clearInterval: (h) => { h.live = false; } },
  };
}

test('open sends the GUID, keeps it alive every 15 s, and becomes ready on the echo', () => {
  const f = fake(); const ready = []; let echoes = 0;
  const v = createVoiceLink({ host: 'srs', port: 5002, guid: G, onPacket() {}, onReady: (r) => ready.push(r), onEcho: () => echoes++, dgram: f.dgram, timers: f.timersApi });
  v.open();
  const s = f.sockets[0];
  assert.equal(s.type, 'udp4');
  assert.deepEqual(s.target, ['srs', 5002]);
  assert.equal(s.sent[0].toString(), G);
  assert.equal(v.send(Buffer.from('x')), false, 'not ready: nothing sent');
  assert.equal(f.timers[0].ms, KEEPALIVE_MS);
  f.timers[0].fn();
  assert.equal(s.sent.length, 2);
  s.emit('message', Buffer.from(G));
  assert.deepEqual(ready, [true]);
  assert.equal(echoes, 1);
  assert.equal(v.send(Buffer.from('x')), true);
});

test('a voice datagram is decoded and handed on; a broken one is dropped and counted', () => {
  const f = fake(); const got = [];
  const v = createVoiceLink({ host: 'h', port: 1, guid: G, onPacket: (p) => got.push(p), dgram: f.dgram, timers: f.timersApi });
  v.open();
  const pkt = encodeVoicePacket({ audio: Buffer.from([1, 2, 3]), frequencies: [251e6], modulations: [0], encryptions: [0],
    unitId: 1, packetNumber: 9, retransmissionCount: 0, originalGuid: 'B'.repeat(22), guid: 'B'.repeat(22) });
  f.sockets[0].emit('message', pkt);
  f.sockets[0].emit('message', Buffer.from('not a voice packet at all'));
  assert.equal(got.length, 1);
  assert.equal(got[0].packetNumber, 9);
  assert.equal(v.droppedPackets(), 1);
});

test('reopen closes the old socket, drops ready, and greets the server again', () => {
  const f = fake(); const ready = [];
  const v = createVoiceLink({ host: 'h', port: 1, guid: G, onPacket() {}, onReady: (r) => ready.push(r), dgram: f.dgram, timers: f.timersApi });
  v.open(); f.sockets[0].emit('message', Buffer.from(G));
  v.reopen();
  assert.equal(f.sockets[0].closed, true);
  assert.equal(f.timers[0].live, false);
  assert.deepEqual(ready, [true, false]);
  assert.equal(f.sockets[1].sent[0].toString(), G);
  f.sockets[0].emit('message', Buffer.from(G));
  assert.equal(v.isReady(), false, 'the old socket no longer counts');
});
