'use strict';

// The wire surface (docs/adr/0103): what a client and the server must agree on, computed from the code. Shared by
// tests/wire-protocol.test.mjs (compares it with tests/fixtures/wire-surface.json) and tools/wire-record.js (records it).
// Scans source text for message types (the same approach as the freeze table `tables-wire-message-types`, which is
// opt-in and so is not read here) and builds a few frames from a real hub for their top-level keys. Well under a second.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);
}
const read = (f) => fs.readFileSync(f, 'utf8');
const uniq = (a) => [...new Set(a)].sort();
const grab = (text, re) => [...text.matchAll(re)].map(m => m[1]);
function fnBody(text, head) {
  const start = text.indexOf(head);
  if (start < 0) throw new Error(`wire-surface: ${head} not found; update tools/wire-surface.js`);
  return text.slice(start, text.indexOf('\n  }\n', start));
}

function messageTypes() {
  const hub = read(path.join(SRC, 'ws-hub.js'));
  const efspWs = read(path.join(SRC, 'efsp', 'efsp-ws.js'));
  const families = require(path.join(SRC, 'efsp', 'wire', 'families'));
  const dispatchStart = efspWs.indexOf('function handleMessage(');
  const dispatch = efspWs.slice(dispatchStart, efspWs.indexOf('\n}\n', dispatchStart));
  const onMessage = fnBody(hub, '  _onMessage(ws, session, raw) {');

  const clientToServer = uniq([
    ...grab(dispatch, /case '(efsp-[a-z-]+)'/g),
    ...families.FAMILIES.map(f => f.type),
    ...grab(onMessage, /case '([A-Za-z-]+)'/g),
    ...grab(onMessage, /msg\.type === '([A-Za-z-]+)'/g),
  ]);

  const outbound = new Set(grab(hub, /version:\s*VERSION,\s*type:\s*'([A-Za-z-]+)'/g));
  const efspFiles = [...fs.readdirSync(path.join(SRC, 'efsp')).filter(f => f.endsWith('.js')).map(f => path.join(SRC, 'efsp', f)),
    ...walk(path.join(SRC, 'efsp', 'wire'))];
  for (const f of [...efspFiles, path.join(SRC, 'ws-hub.js')]) for (const t of grab(read(f), /type: '(efsp-[a-z-]+)'/g)) outbound.add(t);
  for (const f of families.FAMILIES) { outbound.delete(f.type); for (const t of [f.ackType, f.deltaType]) if (t) outbound.add(t); }
  return { clientToServer, serverToClient: uniq([...outbound]) };
}

function frameKeys() {
  const WsHub = require(path.join(SRC, 'ws-hub.js'));
  const TrackStore = require(path.join(SRC, 'tracks.js'));
  const Collab = require(path.join(SRC, 'collab-store.js'));
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new Collab() });
  hub._weather = { pressurePa: 101325, tempK: 288 };
  hub._missionId = 'm';
  hub._missionData = { bullseye: null, airports: [], waypoints: [], drawings: [], theatre: 'T' };
  const keys = (m) => Object.keys(m).sort();
  return {
    'status': keys(hub._statusMsg()),
    'weather': keys(hub._weatherMsg()),
    'game-time': keys(hub._gameTimeMsg()),
    'atis': keys(hub._atisMsg()),
    'apt-config': keys(hub._aptConfigMsg()),
    'init': keys(hub._initMsg()),
    'update-required': keys(new WsHub({ trackStore: new TrackStore(), collabStore: new Collab(), downloadUrl: 'x' })._updateRequiredMsg(1)),
  };
}

function efspOpKinds() {
  return [...require(path.join(SRC, 'efsp', 'authority', 'op-kinds.js')).OP_KINDS].sort();
}

function computeSurface() {
  const { clientToServer, serverToClient } = messageTypes();
  return { clientToServer, serverToClient, efspOpKinds: efspOpKinds(), frameKeys: frameKeys() };
}

module.exports = { computeSurface };
