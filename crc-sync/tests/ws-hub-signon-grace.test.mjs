import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { withPaths, BOARD, MUTATION_LOG } from './helpers/with-paths.mjs';

// A closed session keeps its sign-ons for a grace (config/sign-on-grace.json signOnGraceMs). docs/wip/DESK-SIGNON.md.
const paths = withPaths('signon-grace-', { ...BOARD, ...MUTATION_LOG, CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'facility.json' }).apply();
const tmpDir = paths.dir;
const { createEfsp } = await import('../src/efsp/index.js');
const { default: WsHub } = await import('../src/ws-hub.js');
const { default: TrackStore } = await import('../src/tracks.js');
const { default: CollaborativeStore } = await import('../src/collab-store.js');
const { loadSessionConfig } = await import('../src/session-config.js');

const GRACE = 15000;
function rig() {
  let wall = 1_000_000;
  const pendingSignOffs = new Map(); // shared with the PositionStores through createEfsp's isAbsent
  const efsp = createEfsp({ isAbsent: (id) => pendingSignOffs.has(id) });
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore(), efsp, wallClock: { now: () => wall }, signOnGraceMs: GRACE, pendingSignOffs });
  const ps = efsp.positionStoreFor('INCIRLIK');
  function connect(sub) {
    const handlers = {};
    const ws = { readyState: 1, send() {}, on: (ev, fn) => { handlers[ev] = fn; }, close() { handlers.close(); } };
    hub._onConnect(ws, { crcUser: { sub, name: sub } });
    return { ws, session: hub._sessions.get(ws), drop: () => { ws.readyState = 3; handlers.close(); } };
  }
  return { efsp, hub, ps, connect, advance: (ms) => { wall += ms; hub.sweepPendingSignOffs(); } };
}
const signOn = (r, c, ids) => r.efsp.handleMessage(c.session, { type: 'efsp-set-positions', facilityId: 'INCIRLIK', signedOn: ids });

test('the shipped grace is short (15 s)', () => assert.equal(loadSessionConfig().signOnGraceMs, 15000));

test('a blip under the grace signs nobody off, and the same user back is still Primary', () => {
  const r = rig();
  const a = r.connect('alice');
  signOn(r, a, ['LC', 'GC']);
  a.drop();
  r.advance(GRACE - 1);
  assert.equal(r.ps.primaryOf('LC'), 'alice');
  const a2 = r.connect('alice');
  r.advance(GRACE * 3);
  assert.equal(r.ps.primaryOf('LC'), 'alice');
  assert.equal(r.ps.primaryOf('GC'), 'alice');
  assert.ok(a2.session);
});

test('at expiry the sign-off happens as it always did: the Position empties, an Observer is promoted', () => {
  const r = rig();
  const a = r.connect('alice'); const b = r.connect('bob');
  signOn(r, a, ['LC', 'GC']); signOn(r, b, ['GC']);
  assert.deepEqual(r.ps.observersOf('GC').map(o => o.controllerId), ['bob']);
  a.drop();
  r.advance(GRACE - 1);
  assert.equal(r.ps.primaryOf('LC'), 'alice');
  r.advance(2);
  assert.equal(r.ps.primaryOf('LC'), null);
  assert.equal(r.ps.primaryOf('GC'), 'bob');
});

test('another controller signing on during the grace takes a free-looking Position as Primary', () => {
  const r = rig();
  const a = r.connect('alice'); const b = r.connect('bob');
  signOn(r, a, ['LC', 'GC']);
  a.drop();
  signOn(r, b, ['LC']);
  assert.equal(r.ps.primaryOf('LC'), 'bob');
  assert.equal(r.ps.primaryOf('GC'), 'alice', 'the other held Position is still held');
  const a2 = r.connect('alice');
  signOn(r, a2, ['LC', 'GC']); // re-declare: LC is bob's now, so alice is its Observer
  assert.equal(r.ps.primaryOf('LC'), 'bob');
  assert.deepEqual(r.ps.observersOf('LC').map(o => o.controllerId), ['alice']);
  assert.equal(r.ps.primaryOf('GC'), 'alice');
});

test('a second socket of the same user keeps the sign-ons when the first closes', () => {
  const r = rig();
  const a = r.connect('alice');
  signOn(r, a, ['LC']);
  const a2 = r.connect('alice');
  a.drop();
  r.advance(GRACE * 3);
  assert.equal(r.ps.primaryOf('LC'), 'alice');
  a2.drop();
  r.advance(GRACE + 1);
  assert.equal(r.ps.primaryOf('LC'), null);
});

test('a different user never inherits held sign-ons', () => {
  const r = rig();
  const a = r.connect('alice');
  signOn(r, a, ['LC']);
  a.drop();
  r.connect('mallory');
  r.advance(GRACE + 1);
  assert.equal(r.ps.primaryOf('LC'), null);
  assert.deepEqual(r.ps.signedOnBy('mallory'), []);
});
