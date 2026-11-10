// The local /srs WebSocket (app/srs/srs-route.js): who may connect, and the messages between renderer and session.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('../app/node_modules/ws');
const { attachSrsRoute, isAllowed } = require('../app/srs/srs-route');
const { encodeFrame, decodeFrame } = require('../app/srs/srs-frame');

async function serve(opts) {
  const server = http.createServer((_, res) => res.end());
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const calls = [];
  let hooks = null;
  const route = attachSrsRoute(server, {
    port, srsHost: 'srs', srsPort: 5002, enabled: true, log() {}, ...opts,
    createSession(o) {
      hooks = o; calls.push(['create', o.name, o.guid]);
      return { start: () => calls.push(['start']), stop: () => calls.push(['stop']), setRadios: (r) => calls.push(['radios', r]),
        ptt: (d, ids) => calls.push(['ptt', d, ids]), txFrame: (b) => calls.push(['tx', [...b]]) };
    },
  });
  return { server, port, calls, hooks: () => hooks, route, close: () => { route.close(); server.close(); } };
}

const open = (port, origin = `http://localhost:${port}`) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/srs`, { origin });
  const msgs = [];
  ws.on('message', (d, bin) => msgs.push(bin ? decodeFrame(d) : JSON.parse(d)));
  ws.on('open', () => resolve({ ws, msgs }));
  ws.on('unexpected-response', (_, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  ws.on('error', reject);
});
const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise(r => setTimeout(r, 10)); assert.ok(fn()); };

test('only loopback with this page as Origin is allowed', () => {
  const req = (addr, origin) => ({ socket: { remoteAddress: addr }, headers: { origin } });
  assert.ok(isAllowed(req('127.0.0.1', 'http://localhost:3100'), 3100));
  assert.ok(isAllowed(req('::1', 'http://127.0.0.1:3100'), 3100));
  assert.ok(isAllowed(req('::ffff:127.0.0.1', 'http://localhost:3100'), 3100));
  assert.ok(!isAllowed(req('192.168.1.20', 'http://localhost:3100'), 3100), 'a LAN neighbour');
  assert.ok(!isAllowed(req('127.0.0.1', 'http://evil.example'), 3100), 'a foreign page');
  assert.ok(!isAllowed(req('127.0.0.1', undefined), 3100), 'no Origin');
  assert.ok(!isAllowed(req('127.0.0.1', 'http://localhost:3101'), 3100));
});

test('a foreign Origin is refused with 403', async () => {
  const s = await serve();
  await assert.rejects(open(s.port, 'http://evil.example'), /403/);
  s.close();
});

test('hello starts a session; radios, ptt and binary frames reach it; rx and state come back', async () => {
  const s = await serve();
  const { ws, msgs } = await open(s.port);
  ws.send(JSON.stringify({ type: 'hello', name: '  VIPER CTL ' }));
  await until(() => s.calls.some(c => c[0] === 'start'));
  assert.deepEqual(s.calls[0].slice(0, 2), ['create', 'VIPER CTL']);
  assert.equal(s.calls[0][2], s.route.guid);
  ws.send(JSON.stringify({ type: 'radios', radios: [{ id: 'A', mhz: 251 }] }));
  ws.send(JSON.stringify({ type: 'ptt', down: true, radioIds: ['A'] }));
  ws.send(Buffer.from(encodeFrame({}, new Uint8Array([4, 5]))));
  await until(() => s.calls.some(c => c[0] === 'tx'));
  assert.deepEqual(s.calls.slice(2), [['radios', [{ id: 'A', mhz: 251 }]], ['ptt', true, ['A']], ['tx', [4, 5]]]);
  s.hooks().onState({ connected: true });
  s.hooks().onRx({ header: { radioIds: ['A'] }, opus: Buffer.from([9]) });
  await until(() => msgs.length >= 2);
  assert.deepEqual(msgs[0], { type: 'state', enabled: true, connected: true });
  assert.deepEqual(msgs[1].header, { radioIds: ['A'] });
  ws.close();
  await until(() => s.calls.some(c => c[0] === 'stop'));
  s.close();
});

test('a second connection replaces the first; the GUID stays the same', async () => {
  const s = await serve();
  const a = await open(s.port);
  const closed = new Promise(r => a.ws.on('close', (code) => r(code)));
  await open(s.port);
  assert.equal(await closed, 4000);
  s.close();
});

test('with radioClient not "node" the socket only says the built-in radio is off', async () => {
  const s = await serve({ enabled: false });
  const { ws, msgs } = await open(s.port);
  ws.send(JSON.stringify({ type: 'hello' }));
  await until(() => msgs.length >= 1);
  assert.equal(msgs[0].enabled, false);
  assert.match(msgs[0].error, /radioClient/);
  assert.equal(s.calls.length, 0);
  ws.close(); s.close();
});
