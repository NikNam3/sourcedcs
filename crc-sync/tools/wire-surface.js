'use strict';

// The wire surface (docs/adr/0103): what a client and the server must agree on, computed from the code. Shared by
// tests/wire-protocol.test.mjs (compares it with tests/fixtures/wire-surface.json) and tools/wire-record.js (records it).
// Scans source text for message types (the same approach as the freeze table `tables-wire-message-types`, which is
// opt-in and so is not read here), reads the server's own op-kind and key lists (never a copy of them), and builds
// frames from a real hub, the frame builders and a real CarrierStore for their keys. Well under a second.
//
// What it covers: message types; the efsp-mutation op kinds (the Board op table); each store family's op kinds, keyed by
// its message type; the carrier's named values (handoffs, Case, SetCarrierState fields, stack-entry statuses) and the
// keys of its stack, stack entry, hull view and derived entry; the PAR final's conversion and call names and the SFA pool's frequency uses; each synced store's sync keys;
// the top-level keys of the hub frames and of every store delta. Not covered (docs/wip/WIRE-RECORD.md): the keys inside
// a Strip, a flight-data record or another store's record, ack payloads, and the snapshot's fixed keys.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const EFSP = path.join(SRC, 'efsp');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);
}
const read = (f) => fs.readFileSync(f, 'utf8');
const uniq = (a) => [...new Set(a)].sort();
const grab = (text, re) => [...text.matchAll(re)].map(m => m[1]);
const keys = (m) => Object.keys(m).sort();
function fnBody(text, head) {
  const start = text.indexOf(head);
  if (start < 0) throw new Error(`wire-surface: ${head} not found; update tools/wire-surface.js`);
  return text.slice(start, text.indexOf('\n  }\n', start));
}

function messageTypes() {
  const hub = read(path.join(SRC, 'ws-hub.js'));
  const efspWs = read(path.join(EFSP, 'efsp-ws.js'));
  const families = require(path.join(EFSP, 'wire', 'families'));
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
  const efspFiles = [...fs.readdirSync(EFSP).filter(f => f.endsWith('.js')).map(f => path.join(EFSP, f)),
    ...walk(path.join(EFSP, 'wire'))];
  for (const f of [...efspFiles, path.join(SRC, 'ws-hub.js')]) for (const t of grab(read(f), /type: '(efsp-[a-z-]+)'/g)) outbound.add(t);
  for (const f of families.FAMILIES) { outbound.delete(f.type); for (const t of [f.ackType, f.deltaType]) if (t) outbound.add(t); }
  return { clientToServer, serverToClient: uniq([...outbound]) };
}

/** A stub of a synced store: what a delta builder reads off it. */
const stubStore = (extra = {}) => ({ currentSeq: 1, epoch: 'e', ...extra });

/** A CarrierStore on the shipped hulls with one flight in its stack, so the view carries a derived entry. */
function carrierStoreWithEntry() {
  const { CarrierStore } = require(path.join(EFSP, 'carrier-store.js'));
  const hulls = require(path.join(EFSP, 'carrier', 'hull-config.js')).getHulls();
  const store = new CarrierStore({ hulls, clock: { now: () => 0 } });
  const hullId = store.defaultHullId;
  const r = store.apply({ clientMutationId: 'wire-surface', hullId, baseRev: 0, op: { kind: 'Append', flightDataId: 'fd-wire-surface' } }, 'CV_MARSHAL', 'wire-surface');
  if (!r.ok) throw new Error(`wire-surface: could not stack a flight on the carrier (${r.reason}: ${r.detail}); update tools/wire-surface.js`);
  return { store, hullId };
}

function frameKeys() {
  const WsHub = require(path.join(SRC, 'ws-hub.js'));
  const TrackStore = require(path.join(SRC, 'tracks.js'));
  const Collab = require(path.join(SRC, 'collab-store.js'));
  const frames = require(path.join(EFSP, 'wire', 'frames.js'));
  const airspaceFamily = require(path.join(EFSP, 'wire', 'families', 'airspace.js'));
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new Collab() });
  hub._weather = { pressurePa: 101325, tempK: 288 };
  hub._missionId = 'm';
  hub._missionData = { bullseye: null, airports: [], waypoints: [], drawings: [], theatre: 'T' };
  const airspaceStore = stubStore({ currentTheater: () => 'T' });
  const airspaceDelta = airspaceFamily.broadcasts({ theater: 'T', airspace: {} }, { airspaceStore }).primary;
  return {
    'status': keys(hub._statusMsg()),
    'weather': keys(hub._weatherMsg()),
    'game-time': keys(hub._gameTimeMsg()),
    'atis': keys(hub._atisMsg()),
    'apt-config': keys(hub._aptConfigMsg()),
    'init': keys(hub._initMsg()),
    'update-required': keys(new WsHub({ trackStore: new TrackStore(), collabStore: new Collab(), downloadUrl: 'x' })._updateRequiredMsg(1)),
    'par-sample': keys(hub._parSampleMsg([])),
    // The alert state (docs/adr/0119 added `airspaceEntry`): its slices are its top-level keys.
    'efsp-alerts': keys(hub._efspAlertsMsg(null)),
    // Every store delta, from the builder the server sends it with (frames.js; the airspace delta is built in its family).
    'efsp-board-delta': keys(frames.boardDelta(null, stubStore(), 'F', [], [], [], ['gone'])),
    'efsp-airspace-delta': keys(airspaceDelta),
    'efsp-correlation-delta': keys(frames.correlationDelta(stubStore(), [], {})),
    'efsp-marsa-delta': keys(frames.marsaDelta(stubStore(), [])),
    'efsp-runway-status-delta': keys(frames.runwayStatusDelta(stubStore(), [])),
    'efsp-carrier-delta': keys(frames.carrierDelta(carrierStoreWithEntry().store)),
  };
}

// Every kind a client may send in an efsp-mutation: what the Board dispatches by (its op table, board/ops/: CreateStrip
// to SplitFormation, CarrierHandoff and FinalCall included, Undo with its own gate, docs/adr/0100 §5), joined with the
// granted OP_KINDS, the coordination step kinds (ControlRelease, docs/adr/0101) and the formation ops (docs/adr/0099 §4).
function efspOpKinds() {
  const { OP_KINDS, COORDINATION_STEP_OP_KINDS, FORMATION_OP_KINDS } = require(path.join(EFSP, 'authority', 'op-kinds.js'));
  const table = require(path.join(EFSP, 'board', 'ops')).map(m => m.kind);
  return uniq([...table, ...OP_KINDS, ...COORDINATION_STEP_OP_KINDS, ...FORMATION_OP_KINDS, 'Undo']);
}

/** The op kinds a store dispatches by literal (`case 'X':`, `op.kind === 'X'`); throws if the scan finds none. */
function scannedOpKinds(file) {
  const text = read(file);
  const found = uniq([...grab(text, /case '([A-Z][A-Za-z]+)':/g), ...grab(text, /op\.kind [!=]== '([A-Z][A-Za-z]+)'/g)]);
  if (!found.length) throw new Error(`wire-surface: no op kinds found in ${path.relative(SRC, file)}; update tools/wire-surface.js`);
  return found;
}

// The `op.kind` each store family accepts, keyed by the family's message type, each read from what the store dispatches by:
// a list the store exports, the authority table that gates it (runway status), or the store's dispatch literals.
function storeOpKinds() {
  const { AIRSPACE_OP_KINDS } = require(path.join(EFSP, 'airspace-store.js'));
  const { STATE_OP } = require(path.join(EFSP, 'carrier-store.js'));
  const { STACK_OP_KINDS } = require(path.join(EFSP, 'carrier'));
  const { RUNWAY_STATUS_OP_OWNERS } = require(path.join(EFSP, 'authority'));
  return {
    'efsp-airspace-mutation': uniq(AIRSPACE_OP_KINDS),
    'efsp-ato-mutation': scannedOpKinds(path.join(EFSP, 'wire', 'families', 'ato.js')),
    'efsp-carrier-mutation': uniq([STATE_OP, ...STACK_OP_KINDS]),
    'efsp-correlation-mutation': scannedOpKinds(path.join(EFSP, 'correlation-store.js')),
    'efsp-marsa-mutation': scannedOpKinds(path.join(EFSP, 'marsa-store.js')),
    'efsp-runway-status-mutation': keys(RUNWAY_STATUS_OP_OWNERS),
  };
}

// The carrier half (docs/adr/0064, 0074, 0113-0115): the named values a client sends or reads, and the keys of what it renders.
function carrierSurface() {
  const carrier = require(path.join(EFSP, 'carrier'));
  const { store, hullId } = carrierStoreWithEntry();
  const view = store.view(hullId);
  const derived = Object.values(view.derived)[0][0];
  return {
    handoffs: keys(carrier.CARRIER_HANDOFFS),
    triggerTypes: uniq(carrier.TRIGGER_TYPES),
    cases: uniq(carrier.CASES),
    stateFields: uniq(carrier.FIELD_NAMES),
    entryStatuses: uniq(carrier.ENTRY_STATUSES),
    clearanceFields: uniq(require(path.join(EFSP, 'carrier', 'marshal-stack.js')).CLEARANCE_FIELDS),
    stackKeys: uniq(carrier.STACK_KEYS),
    entryKeys: uniq(carrier.ENTRY_KEYS),
    flightFields: uniq(carrier.CARRIER_FLIGHT_FIELDS),
    viewKeys: keys(view),
    stateKeys: keys(view.state),
    derivedEntryKeys: keys(derived),
  };
}

// Each synced store's declaration (stores.js, docs/adr/0106): its snapshot/heartbeat key, seq and epoch keys and delta type.
function storeSync() {
  const { STORE_SYNC } = require(path.join(EFSP, 'stores.js'));
  return STORE_SYNC.map(({ key, seqKey, epochKey, deltaType }) => ({ key, seqKey, epochKey, deltaType }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

// The PAR sample's entry, approach, plot and trail keys and the INOP reasons (docs/adr/0112), from the lists par.js builds them by.
function parSurface() {
  const par = require(path.join(SRC, 'surveillance', 'par.js'));
  return { sample: [...par.SAMPLE_KEYS], approach: [...par.APPROACH_KEYS], plot: [...par.PLOT_KEYS], trail: [...par.TRAIL_KEYS], inopReasons: [...par.INOP_REASONS] };
}

function computeSurface() {
  const { clientToServer, serverToClient } = messageTypes();
  const parFinal = require(path.join(EFSP, 'par-final.js'));
  const { SFA_USE } = require(path.join(EFSP, 'sfa.js'));
  return {
    clientToServer, serverToClient,
    efspOpKinds: efspOpKinds(),
    storeOpKinds: storeOpKinds(),
    carrier: carrierSurface(),
    // docs/adr/0117: the PAR final's conversions and calls, and the SFA pool's frequency uses (a Bay descriptor's sfaPool).
    parFinal: { conversions: keys(parFinal.CONVERSIONS), finalCalls: keys(parFinal.FINAL_CALLS), sfaUses: keys(SFA_USE) },
    par: parSurface(),
    storeSync: storeSync(),
    frameKeys: frameKeys(),
  };
}

module.exports = { computeSurface };
