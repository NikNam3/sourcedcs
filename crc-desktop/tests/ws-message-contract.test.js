'use strict';

// The WebSocket message-type contract between crc-sync (ws-hub.js, efsp-ws.js,
// metrics.js) and crc-desktop (app.js's onmessage switch, the send helpers).
// Nothing compiles the two sides against each other: a type the server starts
// sending that app.js has no `case` for is dropped silently, and a type a
// client send helper emits that no server dispatcher knows is a dead button.
// Source-scanning on purpose: it needs no sockets, and a renamed type fails
// here on the spot (docs/wip/PARITY.md, concern S-12 / D-9).
//
// Read-only on production code. Does not depend on nla.js, block-map.js or
// permission.js (L17).

const test = require('node:test');
const assert = require('node:assert/strict');
const { readClient, readServer, matchAll } = require('./helpers/mirror-source.js');

// ── server -> client ────────────────────────────────────────────────────────
// Every wire envelope the server builds is `{ version: VERSION, type: '...' }`.
const SERVER_FILES = ['ws-hub.js', 'efsp/efsp-ws.js', 'efsp/metrics.js'];
const SENT_BY_SERVER = matchAll(SERVER_FILES.map(readServer).join('\n'), /version:\s*VERSION,\s*type:\s*'([^']+)'/g);

// The client's single dispatcher.
const APP = readClient('app.js');
const SWITCH_FROM = APP.indexOf('switch (msg.type)');
const HANDLED_BY_CLIENT = (() => {
  assert.ok(SWITCH_FROM > 0, 'app.js no longer has `switch (msg.type)`');
  const rest = APP.slice(SWITCH_FROM);
  // the switch ends at the first line that closes it at its own indent
  const end = rest.search(/\n    \}\n/);
  return matchAll(rest.slice(0, end > 0 ? end : rest.length), /case '([a-z][a-z-]*)':/g);
})();

// Server types the client deliberately does not switch on. Must stay empty
// unless a reason is written next to the entry.
const SERVER_ONLY_OK = {};

test('the scans find the wire at all (guards against a regex that silently matches nothing)', () => {
  assert.ok(SENT_BY_SERVER.length >= 15, `only found ${SENT_BY_SERVER.join(', ')}`);
  assert.ok(HANDLED_BY_CLIENT.length >= 15, `only found ${HANDLED_BY_CLIENT.join(', ')}`);
  for (const t of ['snapshot', 'delta', 'init', 'efsp-snapshot', 'efsp-mutation-ack']) {
    assert.ok(SENT_BY_SERVER.includes(t), `server scan missed ${t}`);
    assert.ok(HANDLED_BY_CLIENT.includes(t), `client scan missed ${t}`);
  }
});

test('every message type the server sends is handled by app.js', () => {
  const unhandled = SENT_BY_SERVER.filter(t => !HANDLED_BY_CLIENT.includes(t) && !(t in SERVER_ONLY_OK));
  assert.deepEqual(unhandled, [], `server sends type(s) app.js has no case for: ${unhandled.join(', ')}`);
});

test('every case in app.js\'s dispatcher is a type the server actually sends', () => {
  const dead = HANDLED_BY_CLIENT.filter(t => !SENT_BY_SERVER.includes(t));
  assert.deepEqual(dead, [], `app.js handles type(s) no server file sends: ${dead.join(', ')}`);
});

// ── client -> server ────────────────────────────────────────────────────────
const CLIENT_SEND_FILES = [
  'panels/efsp/efsp-ws.js', 'panels/efsp/ato-import.js', 'panels/efsp/efsp-metrics-client.js',
  'panels/metrics-panel.js', 'panels/aprt-panel.js', 'geo.js', 'iff.js',
];
const SENT_BY_CLIENT = matchAll(CLIENT_SEND_FILES.map(readClient).join('\n'),
  /(?:version:\s*1,\s*type|sendToSync\(\{\s*type):\s*'([^']+)'/g);

// What the server accepts: efsp-ws.js's dispatcher, metrics.js's tap, ws-hub.js's own types.
const EFSP_DISPATCH = readServer('efsp/efsp-ws.js');
const ACCEPTED_BY_SERVER = (() => {
  const from = EFSP_DISPATCH.indexOf('function handleMessage(');
  assert.ok(from > 0, 'efsp-ws.js no longer has handleMessage()');
  const body = EFSP_DISPATCH.slice(from, EFSP_DISPATCH.indexOf('\n}\n', from));
  const efsp = matchAll(body, /case '([^']+)':/g);
  const metrics = matchAll(readServer('efsp/metrics.js'), /msg\.type === '(efsp-[^']+)'/g);
  const hub = readServer('ws-hub.js');
  const hubSwitch = hub.slice(hub.indexOf('switch (msg.type)'));
  return [...new Set([
    ...efsp, ...metrics,
    ...matchAll(hubSwitch.slice(0, hubSwitch.indexOf('default:')), /case '([^']+)':/g),
    ...matchAll(hub, /msg\.type === '(aptConfigSet)'/g),
  ])].sort();
})();

test('the send scan finds the client\'s sends', () => {
  assert.ok(SENT_BY_CLIENT.length >= 15, `only found ${SENT_BY_CLIENT.join(', ')}`);
  assert.ok(ACCEPTED_BY_SERVER.length >= 15, `only found ${ACCEPTED_BY_SERVER.join(', ')}`);
});

test('every message type a client send helper emits is accepted by a server dispatcher', () => {
  const dead = SENT_BY_CLIENT.filter(t => !ACCEPTED_BY_SERVER.includes(t));
  assert.deepEqual(dead, [], `client sends type(s) no server dispatcher accepts: ${dead.join(', ')}`);
});

// The server accepts a few types the shipped client never sends. Listed so a NEW one
// has to be acknowledged here (and the reason kept honest).
const ACCEPTED_BUT_NEVER_SENT_BY_UI = {
  // S-12 / briefing L6 F1: sendEfspResync() exists but nothing calls it, the reconnect path
  // relies on the fresh snapshot instead. The server half is built, tested and unreachable.
  'efsp-resync': 'sendEfspResync is defined and never called',
};

test('every type the server accepts is either sent by the client or a known unreachable path', () => {
  const orphan = ACCEPTED_BY_SERVER.filter(t => !SENT_BY_CLIENT.includes(t) && !(t in ACCEPTED_BUT_NEVER_SENT_BY_UI));
  assert.deepEqual(orphan, [], `server accepts type(s) no client file sends: ${orphan.join(', ')}`);
});

// S-12: efsp-resync has no `-ack` type of its own. Its reply is one of two types that
// already exist; pin that, so a third reply type cannot appear without app.js hearing of it.
test('efsp-resync has no ack type of its own; its reply is a snapshot or a board delta, both handled by app.js', () => {
  assert.equal(SENT_BY_SERVER.includes('efsp-resync-ack'), false);
  const from = EFSP_DISPATCH.indexOf('function _handleResync(');
  assert.ok(from > 0, '_handleResync moved');
  const body = EFSP_DISPATCH.slice(from, EFSP_DISPATCH.indexOf('\n}\n', from));
  const replyTypes = matchAll(body, /type:\s*'([^']+)'/g);
  for (const t of replyTypes) assert.ok(HANDLED_BY_CLIENT.includes(t), `_handleResync can answer ${t}, which app.js does not handle`);
  assert.match(body, /_snapshot|snapshotMessage|efsp-snapshot|efsp-board-delta/, '_handleResync no longer replies with a snapshot or delta');
});

test.todo('S-12: the shipped client never sends efsp-resync (sendEfspResync has no caller); wire it or delete the dead path (supervisor decision)');
