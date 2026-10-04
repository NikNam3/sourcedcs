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

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { readClient, readServer, matchAll, SERVER_SRC, CLIENT_JS } from './helpers/mirror-source.mjs';
import { permissive } from './helpers/client-env.mjs';
import { freshGraph } from './helpers/fresh-graph.mjs';

const require = createRequire(import.meta.url);
// The wire families (efsp-ws.js's skeleton dispatches them): their request, ack and delta types come from the registry.
const { FAMILIES } = require(path.join(SERVER_SRC, 'efsp/wire/families'));

// ── server -> client ────────────────────────────────────────────────────────
// Every wire envelope the server builds is `{ version: VERSION, type: '...' }`.
const SERVER_FILES = ['ws-hub.js', 'efsp/efsp-ws.js', 'efsp/metrics.js', 'efsp/wire/frames.js'];
const FAMILY_FILES = ['airspace', 'correlation', 'marsa', 'runway-status', 'carrier', 'sfa', 'ato'].map(n => `efsp/wire/families/${n}.js`);
const SENT_BY_SERVER = [...new Set([
  ...matchAll([...SERVER_FILES, ...FAMILY_FILES].map(readServer).join('\n'), /version:\s*VERSION,\s*type:\s*'([^']+)'/g),
  ...FAMILIES.flatMap(f => [f.ackType, f.deltaType].filter(Boolean)),
  // airspace-calendar.js builds its frame with the literal `version: 1` (AIRSP-2S-B), which the scan above does not match.
  ...matchAll(readServer('efsp/airspace-calendar.js'), /version:\s*1,\s*type:\s*'([^']+)'/g),
])].sort();

// The client's dispatcher: app.js's ws.onmessage routes every `efsp-*` frame through dispatchEfspMessage(), and each
// family's module registers its types at load (CMSG, panels/efsp/efsp-message-registry.js). The registry is read live:
// every module under panels/ is loaded into one fresh graph so each registration runs.
const APP = readClient('app.js');
const MESSAGES = readClient('panels/efsp/efsp-messages.js');
const SWITCH_FROM = APP.indexOf('switch (msg.type)');
const CORE_CASES = (() => {
  assert.ok(SWITCH_FROM > 0, 'app.js no longer has `switch (msg.type)`');
  const rest = APP.slice(SWITCH_FROM);
  // the switch ends at the first line that closes it at its own indent
  const end = rest.search(/\n    \}\n/);
  return matchAll(rest.slice(0, end > 0 ? end : rest.length), /case '([a-z][a-z-]*)':/g);
})();
const REGISTERED = await (async () => {
  globalThis.setInterval = () => 0;
  document.getElementById = () => permissive();
  process.on('unhandledRejection', () => {});
  const g = freshGraph();
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : (e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
  await g.import('app.js');
  for (const f of walk(path.join(CLIENT_JS, 'panels'))) await g.import(f);
  return (await g.import('panels/efsp/efsp-message-registry.js')).registeredEfspTypes();
})();
const HANDLED_BY_CLIENT = [...new Set([...CORE_CASES, ...REGISTERED])].sort();

// Server types the client deliberately does not switch on. Must stay empty
// unless a reason is written next to the entry.
const SERVER_ONLY_OK = {
  // connect()'s onmessage handles it before the switch, because it ends the connection (crc-sync docs/adr/0103).
  'update-required': 'handled in app.js connect() ahead of the switch',
};

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
  const efsp = [...matchAll(body, /case '([^']+)':/g), ...FAMILIES.map(f => f.type)];
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
// has to be acknowledged here (and the reason kept honest). Empty since S-12 was
// wired (efsp-resync is sent on a Board epoch change and on a heartbeat gap, not on a reconnect: R3-47).
const ACCEPTED_BUT_NEVER_SENT_BY_UI = {};

test('every type the server accepts is either sent by the client or a known unreachable path', () => {
  const orphan = ACCEPTED_BY_SERVER.filter(t => !SENT_BY_CLIENT.includes(t) && !(t in ACCEPTED_BUT_NEVER_SENT_BY_UI));
  assert.deepEqual(orphan, [], `server accepts type(s) no client file sends: ${orphan.join(', ')}`);
});

// S-12 / R3-47: efsp-resync has no `-ack` type; its answer is an `efsp-resync-reply`, a snapshot or a
// delta tagged `answer`. Pin that, so a third kind of answer cannot appear without app.js hearing of it.
test('efsp-resync is answered with an efsp-resync-reply (answer: snapshot | delta), which app.js handles', () => {
  assert.equal(SENT_BY_SERVER.includes('efsp-resync-ack'), false);
  const from = EFSP_DISPATCH.indexOf('function _asResyncReply(');
  assert.ok(from > 0, '_asResyncReply moved');
  const body = EFSP_DISPATCH.slice(from, EFSP_DISPATCH.indexOf('\n}\n', from));
  assert.match(body, /type:\s*'efsp-resync-reply'/);
  assert.match(body, /'snapshot'/);
  assert.match(body, /'delta'/);
  assert.ok(HANDLED_BY_CLIENT.includes('efsp-resync-reply'), 'app.js has no case for efsp-resync-reply');
  // _handleResync answers through it, and only through it
  const h = EFSP_DISPATCH.indexOf('function _handleResync(');
  assert.ok(h > 0, '_handleResync moved');
  assert.match(EFSP_DISPATCH.slice(h, EFSP_DISPATCH.indexOf('\n}\n', h)), /_asResyncReply\(/);
});

// S-12 (ruling in decisions.md): the resync path is reachable from the shipped UI. A sender
// that nothing calls is the dead path the todo here used to name.
test('S-12: efsp-resync is wired: one registry observer in efsp-ws.js reaches sendEfspResync for both triggers (no reconnect trigger, R3-47)', () => {
  const WS = readClient('panels/efsp/efsp-ws.js');
  assert.match(WS, /type:\s*'efsp-resync'/);
  // the one trigger is the registry's observer, so every frame passes it before its handler ...
  assert.match(WS, /addEfspMessageObserver\(noteEfspFrameForSync\)/);
  const from = WS.indexOf('function noteEfspFrameForSync(');
  assert.ok(from > 0, 'noteEfspFrameForSync missing from efsp-ws.js');
  const body = WS.slice(from, WS.indexOf('\n}\n', from));
  // ... which asks for a resync on a frame gap (Board or store lifetime, skipped store seq) and on a heartbeat gap
  assert.match(body, /efspFrameGapsOf\(msg\)[\s\S]*requestEfspResync\(/, 'a frame gap does not request a resync');
  assert.match(body, /heartbeatGaps\(msg\)[\s\S]*requestEfspResync\(/, 'a heartbeat gap does not request a resync');
  // the handlers no longer call a trigger themselves
  for (const gone of ['noteEfspBoardMessageForSync', 'noteEfspHeartbeatForSync', 'noteEfspStoreAnswerLanded']) assert.equal((APP + MESSAGES + WS).includes(gone), false, `${gone} is back`);
  // R3-47: a reconnect is recovered by the connect snapshot, so nothing resyncs on open
  assert.equal((APP + MESSAGES).includes('resyncHeldEfspBoardsOnOpen'), false, 'app.js resyncs on reconnect again');
  assert.equal(WS.includes('function resyncHeldEfspBoardsOnOpen('), false);
  const req = WS.indexOf('function requestEfspResync(');
  assert.match(WS.slice(req, WS.indexOf('\n}\n', req)), /_sendEfsp\(\{ version: 1, type: 'efsp-resync'/);
});

// CMSG: the registry itself. A type registered twice would let a later module silently replace an earlier handler.
test('the EFSP message registry throws on a duplicate type, ignores an unknown one, and routes by type', async () => {
  const { registerEfspMessage, dispatchEfspMessage, registeredEfspTypes } = await freshGraph().import('panels/efsp/efsp-message-registry.js');
  const seen = [];
  registerEfspMessage('efsp-x', (m) => seen.push(m.n));
  assert.throws(() => registerEfspMessage('efsp-x', () => {}), /already registered/);
  assert.equal(dispatchEfspMessage({ type: 'efsp-nope' }), false);
  assert.equal(dispatchEfspMessage({ type: 'efsp-x', n: 1 }), true);
  assert.deepEqual(seen, [1]);
  assert.deepEqual(registeredEfspTypes(), ['efsp-x']);
  assert.ok(REGISTERED.includes('efsp-snapshot') && REGISTERED.length >= 22, `registered: ${REGISTERED.join(', ')}`);
});
