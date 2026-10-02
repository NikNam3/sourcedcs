import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';

// The wire protocol handshake (docs/adr/0103) against a real `ws` server: the check runs in the connection listener, so
// a refused client gets exactly one update-required frame and close 4426 and nothing else; an admitted one is served as before.

const WsHub = (await import('../src/ws-hub.js')).default;
const TrackStore = (await import('../src/tracks.js')).default;
const CollaborativeStore = (await import('../src/collab-store.js')).default;
const { WIRE_PROTOCOL } = (await import('../src/wire-protocol.js')).default;

async function start(hubOpts = {}) {
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore(), ...hubOpts });
  const server = http.createServer();
  hub.attach(server);
  // verifyClient wants a ticket; bypass it the way a ticket would: set the user on the request.
  hub._wss.options.verifyClient = (info, cb) => { info.req.crcUser = { name: 'ADMIT1' }; cb(true); };
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { hub, server, port: server.address().port, close: () => { hub.stop(); hub._wss.close(); server.close(); } };
}

function connect(port, query) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/feed?ticket=x${query}`);
    const frames = [];
    ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
    ws.on('close', (code) => resolve({ frames, code }));
    // An admitted client is never closed by the server: end it after the connect-time frames have arrived.
    setTimeout(() => { if (ws.readyState === WebSocket.OPEN) ws.close(1000); }, 400);
  });
}

test('a matching protocol is admitted and gets the normal connect sequence', async () => {
  const s = await start();
  try {
    const { frames, code } = await connect(s.port, `&protocol=${WIRE_PROTOCOL}&client=1.2.3`);
    assert.notEqual(code, 4426);
    assert.equal(frames[0].type, 'status');
    assert.ok(frames.some(f => f.type === 'snapshot'));
    assert.ok(!frames.some(f => f.type === 'update-required'));
  } finally { s.close(); }
});

for (const [label, query] of [['missing', ''], ['lower', '&protocol=1'], ['higher', `&protocol=${WIRE_PROTOCOL + 1}`], ['junk', '&protocol=abc']]) {
  test(`a ${label} protocol gets one update-required frame, close 4426, nothing else`, async () => {
    const s = await start({ downloadUrl: 'https://example.test/download' });
    try {
      const { frames, code } = await connect(s.port, query + '&client=0.9.0');
      assert.equal(code, 4426);
      assert.equal(frames.length, 1);
      const clientProtocol = query.includes('protocol=') && /protocol=(\d+)/.test(query) ? Number(/protocol=(\d+)/.exec(query)[1]) : 1;
      assert.deepEqual(frames[0], { version: 1, type: 'update-required', serverProtocol: WIRE_PROTOCOL, clientProtocol, downloadUrl: 'https://example.test/download' });
      assert.equal(s.hub._sessions.size, 0, 'no session is created');
    } finally { s.close(); }
  });
}

test('without a download URL the frame omits the key', async () => {
  const s = await start();
  try {
    const { frames } = await connect(s.port, '');
    assert.ok(!('downloadUrl' in frames[0]));
  } finally { s.close(); }
});

test('setWireProtocolForTest changes what is admitted', async () => {
  const s = await start();
  try {
    s.hub.setWireProtocolForTest(WIRE_PROTOCOL + 5);
    const { frames, code } = await connect(s.port, `&protocol=${WIRE_PROTOCOL}`);
    assert.equal(code, 4426);
    assert.equal(frames[0].serverProtocol, WIRE_PROTOCOL + 5);
  } finally { s.close(); }
});
