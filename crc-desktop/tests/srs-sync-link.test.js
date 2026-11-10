// The SRS TCP sync link (app/srs/sync-link.js) against a fake socket and fake timers.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createSyncLink, PING_INTERVAL_MS, DEAD_AFTER_MS, BACKOFF_MS } = require('../app/srs/sync-link');
const { MsgType, SRS_VERSION, radioInfoDict } = require('../app/srs/sync-message');

function fakes() {
  const sockets = [], timers = [];
  const net = { createConnection(opts) {
    const s = new EventEmitter();
    s.opts = opts; s.written = []; s.destroyed = false;
    s.write = (b) => s.written.push(JSON.parse(b.toString()));
    s.destroy = () => { s.destroyed = true; s.emit('close'); };
    sockets.push(s);
    return s;
  } };
  const add = (kind) => (fn, ms) => { const h = { kind, fn, ms, live: true }; timers.push(h); return h; };
  const clear = (h) => { if (h) h.live = false; };
  return { sockets, timers, net, timersApi: { setTimeout: add('timeout'), setInterval: add('interval'), clearTimeout: clear, clearInterval: clear } };
}

function link(f, radios = [{ hz: 251e6, modulation: 0, name: 'a' }]) {
  const states = [];
  const cur = { radios, now: 0 };
  const l = createSyncLink({
    host: 'srs.example', port: 5002, guid: '0123456789abcdefghijkl', name: 'CRC', coalition: 2,
    getRadioInfo: () => radioInfoDict({ radios: cur.radios, unit: 'CRC', unitId: 1, selected: 0 }),
    onState: (s) => states.push(s), net: f.net, timers: f.timersApi, now: () => cur.now,
  });
  return { l, states, cur };
}

test('connect sends SYNC with the whole client and a RADIO_UPDATE, then PING on the keepalive', () => {
  const f = fakes(); const { l, states } = link(f);
  l.start();
  const s = f.sockets[0];
  assert.deepEqual(s.opts, { host: 'srs.example', port: 5002 });
  s.emit('connect');
  assert.equal(s.written[0].MsgType, MsgType.SYNC);
  assert.equal(s.written[0].Version, SRS_VERSION);
  assert.equal(s.written[0].Client.Coalition, 2);
  assert.equal(s.written[0].Client.RadioInfo.radios[0].freq, 251e6);
  assert.equal(s.written[1].MsgType, MsgType.RADIO_UPDATE);
  assert.equal(states.at(-1).connected, true);
  const ping = f.timers.find(t => t.kind === 'interval' && t.live);
  assert.equal(ping.ms, PING_INTERVAL_MS);
  ping.fn();
  assert.equal(s.written[2].MsgType, MsgType.PING);
});

test('RADIO_UPDATE goes out only when the radios change', () => {
  const f = fakes(); const { l, cur } = link(f);
  l.start(); const s = f.sockets[0]; s.emit('connect');
  l.radiosChanged();
  assert.equal(s.written.length, 2, 'unchanged: nothing sent');
  cur.radios = [{ hz: 305.5e6, modulation: 0, name: 'b' }];
  l.radiosChanged();
  assert.equal(s.written[2].MsgType, MsgType.RADIO_UPDATE);
  assert.equal(s.written[2].Client.RadioInfo.radios[0].freq, 305.5e6);
  l.radiosChanged();
  assert.equal(s.written.length, 3);
});

test('a dropped connection reconnects with backoff 1, 2, 5, 10, 30 s, then 30 s', () => {
  const f = fakes(); const { l, states } = link(f);
  l.start();
  const waits = [];
  for (let i = 0; i < 8; i++) {
    f.sockets.at(-1).emit('error', Object.assign(new Error('x'), { code: 'ECONNREFUSED' }));
    f.sockets.at(-1).emit('close');
    const r = f.timers.filter(t => t.kind === 'timeout' && t.live).at(-1);
    waits.push(r.ms); r.live = false; r.fn();
  }
  assert.deepEqual(waits, [1000, 2000, 5000, 10000, 30000, 30000, 30000, 30000]);
  assert.deepEqual(BACKOFF_MS, waits.slice(0, 5));
  assert.match(states.at(-1).error, /ECONNREFUSED/);
  f.sockets.at(-1).emit('connect');
  f.sockets.at(-1).emit('close');
  assert.equal(f.timers.filter(t => t.kind === 'timeout' && t.live).at(-1).ms, 1000, 'a good connection resets the backoff');
});

test('VERSION_MISMATCH is reported and not retried', () => {
  const f = fakes(); const { l, states } = link(f);
  l.start(); const s = f.sockets[0]; s.emit('connect');
  s.emit('data', Buffer.from(JSON.stringify({ MsgType: MsgType.VERSION_MISMATCH, Version: '2.4.0.0' }) + '\n'));
  s.emit('close');
  assert.equal(states.at(-1).versionMismatch, true);
  assert.match(states.at(-1).error, /2\.3\.3\.3.*2\.4\.0\.0/);
  assert.equal(f.timers.filter(t => t.kind === 'timeout' && t.live).length, 0);
});

test('messages split across chunks are reassembled; a bad line is dropped', () => {
  const f = fakes(); const got = [];
  const l = createSyncLink({ host: 'h', port: 1, guid: 'g'.repeat(22), name: 'n', getRadioInfo: () => null,
    onMessage: (m) => got.push(m.MsgType), net: f.net, timers: f.timersApi });
  l.start(); const s = f.sockets[0]; s.emit('connect');
  s.emit('data', Buffer.from('{"MsgType":0}\nnot json\n{"MsgT'));
  s.emit('data', Buffer.from('ype":5}\n'));
  assert.deepEqual(got, [0, 5]);
});

test('stop closes the socket and does not reconnect', () => {
  const f = fakes(); const { l } = link(f);
  l.start(); f.sockets[0].emit('connect');
  l.stop();
  assert.equal(f.sockets[0].destroyed, true);
  assert.equal(f.timers.filter(t => t.live).length, 0);
});

test('45 s with nothing heard drops the link; a UDP echo reported by heard() keeps it', () => {
  const f = fakes(); const { l, cur, states } = link(f);
  l.start(); const s = f.sockets[0]; s.emit('connect');
  const ping = f.timers.find(t => t.kind === 'interval' && t.live);
  cur.now = DEAD_AFTER_MS - 1; ping.fn();
  assert.equal(s.destroyed, false);
  cur.now = DEAD_AFTER_MS + 10_000; l.heard(); ping.fn();
  assert.equal(s.destroyed, false, 'the echo counted');
  cur.now += DEAD_AFTER_MS + 1; ping.fn();
  assert.equal(s.destroyed, true);
  assert.match(states.at(-1).error, /nothing heard/);
  assert.equal(f.timers.filter(t => t.kind === 'timeout' && t.live).length, 1, 'and it reconnects');
});
