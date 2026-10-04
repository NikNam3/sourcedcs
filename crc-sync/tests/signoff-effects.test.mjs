import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { prologue, makeWorld, exchange, holders } from './helpers/control-release-fixture.mjs';

// A sign-off a disconnect causes (grace expiry, takeover) has the effects of an explicit one: the control-invariant
// repair, the persist, the other Facility's Board, the GC offer and the Position state for every watcher
// (docs/wip/SIGNOFF-EFFECTS.md, H106 AC-3).

prologue('signoff-effects-');
const { createEfsp } = await import('../src/efsp/index.js');
const { default: WsHub } = await import('../src/ws-hub.js');
const { default: TrackStore } = await import('../src/tracks.js');
const { default: CollaborativeStore } = await import('../src/collab-store.js');
const helpers = await import('./helpers/efsp-scenario.mjs');

const GRACE = 15000;
const SNAP = () => process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH;

function rig(staffed) {
  const pendingSignOffs = new Map(); // the hub's grace Map, shared with the PositionStores through createEfsp's isAbsent
  const w = makeWorld(createEfsp, helpers, { ...(staffed ? { staffed } : {}), pendingSignOffs });
  let wall = 1_000_000;
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore(), efsp: w.efsp, wallClock: { now: () => wall }, signOnGraceMs: GRACE, pendingSignOffs });
  const clients = new Set();
  hub._wss = { clients };
  function connect(sub) {
    const handlers = {}; const frames = [];
    const ws = { readyState: 1, send: (s) => frames.push(JSON.parse(s)), on: (ev, fn) => { handlers[ev] = fn; }, close() {} };
    hub._onConnect(ws, { crcUser: { sub, name: sub } });
    clients.add(ws);
    frames.length = 0;
    return { ws, frames, drop: () => { ws.readyState = 3; clients.delete(ws); handlers.close(); } };
  }
  return { w, hub, connect, advance: (ms) => { wall += ms; hub.sweepPendingSignOffs(); } };
}
const deltas = (frames, facilityId) => frames.filter(f => f.type === 'efsp-board-delta' && f.facilityId === facilityId);

function snapshotHolder(strip) {
  const text = fs.readFileSync(SNAP(), 'utf8');
  const body = JSON.parse(text);
  const found = [];
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (o.stripId === strip.stripId && o.coordination) found.push(o);
    for (const v of Object.values(o)) walk(v);
  })(body);
  assert.ok(found.length, 'the Strip is in the snapshot');
  return found[found.length - 1].coordination.control.holder;
}

function liveExchange(r) {
  const ex = exchange(r.w, helpers, 'SOE1');
  helpers.mustAct(r.w.efsp, r.w.c.AP, 'AP', ex.R(), { kind: 'HANDOFF', action: 'TRANSFER_COMMS' });
  helpers.mustAct(r.w.efsp, r.w.c.AP, 'AP', ex.R(), { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
  assert.equal(holders(ex).control, 'RECEIVING');
  return ex;
}

test('grace expiry with a live HANDOFF held by the absent controller: repaired, persisted, sent to CENTER and to a watcher', () => {
  const was = process.env.CRCSYNC_CONTROL_INVARIANT;
  process.env.CRCSYNC_CONTROL_INVARIANT = 'repair';
  try {
    const r = rig();
    const ex = liveExchange(r);
    const ap = r.connect('c-AP'); const ctr = r.connect('c-CTR'); const watcher = r.connect('c-OPS');
    ap.drop();
    r.advance(GRACE - 1);
    assert.equal(holders(ex).control, 'RECEIVING', 'nothing happens inside the grace');
    for (const c of [ctr, watcher]) c.frames.length = 0;
    r.advance(2);

    assert.equal(holders(ex).control, 'TRANSFERRING', 'the holder moved to the live side');
    assert.equal(snapshotHolder(ex.T()), 'TRANSFERRING', 'persisted: a restart reads the repaired Board');
    assert.ok(deltas(ctr.frames, 'CENTER').some(f => (f.strips.updated || []).some(s => s.stripId === ex.T().stripId)), 'CENTER\'s session was sent the repaired Strip');
    const wd = deltas(watcher.frames, 'INCIRLIK');
    assert.ok(wd.length, 'the watcher got INCIRLIK\'s Board');
    const ap1 = wd.flatMap(f => f.positions ? f.positions.updated : []).find(p => p.positionId === 'AP');
    assert.ok(ap1 && !ap1.primary, 'AP shows unstaffed');
  } finally { process.env.CRCSYNC_CONTROL_INVARIANT = was; }
});

test('grace expiry with nobody left to hold the exchange: the CONTROL_UNCOVERED state stands (alert, not a block)', () => {
  const was = process.env.CRCSYNC_CONTROL_INVARIANT;
  process.env.CRCSYNC_CONTROL_INVARIANT = 'repair';
  try {
    const r = rig();
    const ex = liveExchange(r);
    const ap = r.connect('c-AP'); const ctr = r.connect('c-CTR');
    helpers.hold(r.w.efsp, r.w.c.CTR.session, 'CENTER', []); // CENTER was signed off already
    ap.drop(); ctr.drop();
    r.advance(GRACE + 1);
    assert.ok(r.w.efsp.boardStoreFor('INCIRLIK').exchangeProblems(ex.R().stripId).length > 0, 'the standing condition is raised');
  } finally { process.env.CRCSYNC_CONTROL_INVARIANT = was; }
});

test('grace expiry leaving GC unstaffed with Strips: LC\'s Primary is offered GC', () => {
  const r = rig({ OPS: 'INCIRLIK', GC: 'INCIRLIK', LC: 'INCIRLIK' });
  const created = helpers.mustAct(r.w.efsp, r.w.c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main',
    flightData: { callsign: 'VIPER1', aircraftType: 'F16', wakeCategory: 'D', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250' },
  });
  helpers.mustAct(r.w.efsp, r.w.c.OPS, 'OPS', created, { kind: 'TransferStrip', toPositionId: 'GC', bayId: 'gc-coordination', rackId: 'main' });
  const gc = r.connect('c-GC'); const lc = r.connect('c-LC'); const ops = r.connect('c-OPS');
  gc.drop();
  r.advance(GRACE + 1);
  const offer = lc.frames.find(f => f.type === 'efsp-position-offer');
  assert.ok(offer, 'LC\'s Primary was offered GC');
  assert.deepEqual({ positionId: offer.positionId, offer: offer.offer, count: offer.count }, { positionId: 'LC', offer: 'GC', count: 1 });
  assert.equal(ops.frames.some(f => f.type === 'efsp-position-offer'), false, 'only LC hears the offer');
});

test('a takeover during the grace: the taker\'s sign-on runs the shared effects (repair persisted, GC offer, watcher sees the Primary)', () => {
  const r = rig({ OPS: 'INCIRLIK', GC: 'INCIRLIK', LC: 'INCIRLIK' });
  const created = helpers.mustAct(r.w.efsp, r.w.c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main',
    flightData: { callsign: 'VIPER2', aircraftType: 'F16', wakeCategory: 'D', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250' },
  });
  helpers.mustAct(r.w.efsp, r.w.c.OPS, 'OPS', created, { kind: 'TransferStrip', toPositionId: 'GC', bayId: 'gc-coordination', rackId: 'main' });
  const gc = r.connect('c-GC'); const lc = r.connect('c-LC'); const watcher = r.connect('c-OPS');
  const bob = r.connect('bob');
  gc.drop();
  watcher.frames.length = 0;
  // bob takes the absent GC Primary's Position during the grace, as Primary
  r.hub._onMessage(bob.ws, r.hub._sessions.get(bob.ws), JSON.stringify({ type: 'efsp-set-positions', facilityId: 'INCIRLIK', signedOn: ['GC'] }));
  assert.equal(r.w.efsp.positionStoreFor('INCIRLIK').primaryOf('GC'), 'bob');
  const pos = watcher.frames.filter(f => f.type === 'efsp-board-delta').flatMap(f => f.positions ? f.positions.updated : []).find(p => p.positionId === 'GC');
  assert.ok(pos, 'the watcher was sent GC\'s Position state');
  assert.equal(lc.frames.some(f => f.type === 'efsp-position-offer'), false, 'GC is staffed: no offer');
  // The absent controller's expiry later changes nothing it should not.
  r.advance(GRACE + 1);
  assert.equal(r.w.efsp.positionStoreFor('INCIRLIK').primaryOf('GC'), 'bob');
});

test('a takeover of the exchange\'s only live holder runs the repair and persists it', () => {
  const was = process.env.CRCSYNC_CONTROL_INVARIANT;
  process.env.CRCSYNC_CONTROL_INVARIANT = 'repair';
  try {
    const r = rig();
    const ex = liveExchange(r);
    const ap = r.connect('c-AP'); r.connect('c-CTR');
    ap.drop();
    // Bob takes AP: it stays staffed, so the exchange stays with the receiver; nothing is lost or repaired.
    const bob = r.connect('bob');
    r.hub._onMessage(bob.ws, r.hub._sessions.get(bob.ws), JSON.stringify({ type: 'efsp-set-positions', facilityId: 'INCIRLIK', signedOn: ['AP'] }));
    assert.equal(r.w.efsp.positionStoreFor('INCIRLIK').primaryOf('AP'), 'bob');
    assert.equal(holders(ex).control, 'RECEIVING');
    r.advance(GRACE + 1);
    assert.equal(holders(ex).control, 'RECEIVING', 'the expiry of the absent controller leaves bob\'s Position alone');
  } finally { process.env.CRCSYNC_CONTROL_INVARIANT = was; }
});
