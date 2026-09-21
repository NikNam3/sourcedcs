import { test } from 'node:test';
import assert from 'node:assert/strict';
import WsHub from '../src/ws-hub.js';
import TrackStore from '../src/tracks.js';
import CollaborativeStore from '../src/collab-store.js';

/* Each session is delivered only what its Positions can see (docs/adr/0042).
 *
 * The rule this pins hardest: a track no radar of yours has illuminated is
 * not sent at all. There is no longer a way to see the whole theater by
 * ticking a box, which is what makes a Strip's correlated track mean the same
 * thing to two controllers at one board.
 */

const OPEN = 1;

function fakeWs() {
  const sent = [];
  return { readyState: OPEN, send: (raw) => sent.push(JSON.parse(raw)), sent };
}

const RADARS = [
  { id: 'apt:Incirlik', type: 'airport', label: 'LTAG', lat: 37, lon: 35, rangeM: 74080 },
  { id: 'app:Incirlik', type: 'approach', label: 'LTAG APP', lat: 37, lon: 35, rangeM: 148160 },
  { id: 'crc:99', type: 'awacs', label: 'MAGIC', lat: 38, lon: 36, rangeM: 400000 },
];

/**
 * A stand-in picture: `grants` maps a controllerId to the radar ids they are
 * looking through, `lit` maps a trackId to the radars illuminating it.
 */
function fakePicture(grants, lit) {
  return {
    coverageFor: (controllerId) => {
      const ids = grants[controllerId] || [];
      return {
        radars: RADARS.filter(r => ids.includes(r.id)),
        radarIds: new Set(ids),
        heldPositions: (grants[`${controllerId}:held`]) || [],
        radarBearingPositions: ids.length ? ['APP'] : [],
      };
    },
    illuminated: () => new Map(Object.entries(lit)),
    radars: () => RADARS,
  };
}

function track(id, extra = {}) {
  return {
    id, callsign: `T${id}`, coalition: 3, type: 'F-16C_50',
    lat: 37.1, lon: 35.1, alt: 6000, heading: 90, player: null, category: 1, ...extra,
  };
}

function storeWith(...tracks) {
  const store = new TrackStore();
  for (const t of tracks) store.update(t, null);
  return store;
}

function session(controllerId, hub) {
  const coverage = hub._picture
    ? hub._picture.coverageFor(controllerId)
    : { radars: [], radarIds: new Set(), heldPositions: [], radarBearingPositions: [] };
  return {
    controllerId, who: controllerId,
    lastTrackSeq: 0, lastCollabSeq: 0,
    coverage, radarIds: coverage.radarIds, lastSent: new Map(),
  };
}

// ── delivery is scoped ─────────────────────────────────────────────────────

test('a track illuminated by a radar the controller holds is delivered, with when the beam passed', () => {
  const picture = fakePicture({ c1: ['app:Incirlik'] }, { 1: { at: 5000, radarIds: ['app:Incirlik'] } });
  const hub = new WsHub(storeWith(track(1)), new CollaborativeStore(), null, picture);
  const ws = fakeWs();
  hub._tick(ws, session('c1', hub));

  const delta = ws.sent.find(m => m.type === 'delta');
  assert.ok(delta, 'nothing was delivered');
  assert.deepEqual(delta.updated.map(t => t.id), [1]);
  assert.equal(delta.updated[0].illuminatedAt, 5000);
  assert.deepEqual(delta.updated[0].seenBy, ['app:Incirlik']);
});

test('a track only somebody else’s radar has illuminated is not delivered at all', () => {
  const picture = fakePicture({ c1: ['apt:Incirlik'] }, { 1: { at: 5000, radarIds: ['crc:99'] } });
  const hub = new WsHub(storeWith(track(1)), new CollaborativeStore(), null, picture);
  const ws = fakeWs();
  hub._tick(ws, session('c1', hub));
  assert.equal(ws.sent.length, 0, 'a quiet tick should send nothing at all');
});

test('a controller holding no radar-bearing Position is delivered nothing, however many tracks exist', () => {
  const picture = fakePicture({ c1: [] }, {
    1: { at: 5000, radarIds: ['app:Incirlik'] },
    2: { at: 5000, radarIds: ['crc:99'] },
  });
  const hub = new WsHub(storeWith(track(1), track(2)), new CollaborativeStore(), null, picture);
  const ws = fakeWs();
  hub._tick(ws, session('c1', hub));
  assert.equal(ws.sent.length, 0);
});

test('two radars, one of them the controller’s, is enough to deliver the track', () => {
  const picture = fakePicture({ c1: ['apt:Incirlik'] }, {
    1: { at: 5000, radarIds: ['crc:99', 'apt:Incirlik'] },
  });
  const hub = new WsHub(storeWith(track(1)), new CollaborativeStore(), null, picture);
  const ws = fakeWs();
  hub._tick(ws, session('c1', hub));
  assert.deepEqual(ws.sent.find(m => m.type === 'delta').updated.map(t => t.id), [1]);
});

// ── a contact is sent once per illumination, not once per telemetry frame ──

test('telemetry churn between sweeps sends nothing; the next illumination sends once', () => {
  const lit = { 1: { at: 5000, radarIds: ['app:Incirlik'] } };
  const picture = fakePicture({ c1: ['app:Incirlik'] }, lit);
  const store = storeWith(track(1));
  const hub = new WsHub(store, new CollaborativeStore(), null, picture);
  const ws = fakeWs();
  const s = session('c1', hub);

  hub._tick(ws, s);
  assert.equal(ws.sent.length, 1, 'first illumination delivered');

  // DCS keeps pushing position updates; the beam has not come round again.
  for (let i = 0; i < 5; i++) store.update(track(1, { lat: 37.1 + i * 0.01 }), null);
  hub._tick(ws, s);
  assert.equal(ws.sent.length, 1, 'no beam, no return');

  lit[1] = { at: 8000, radarIds: ['app:Incirlik'] };
  hub._tick(ws, s);
  assert.equal(ws.sent.length, 2);
  assert.equal(ws.sent[1].updated[0].illuminatedAt, 8000);
});

test('a track that drops out of the picture is withdrawn as gone', () => {
  const lit = { 1: { at: 5000, radarIds: ['app:Incirlik'] } };
  const picture = fakePicture({ c1: ['app:Incirlik'] }, lit);
  const hub = new WsHub(storeWith(track(1)), new CollaborativeStore(), null, picture);
  const ws = fakeWs();
  const s = session('c1', hub);

  hub._tick(ws, s);
  delete lit[1];
  hub._tick(ws, s);

  const last = ws.sent[ws.sent.length - 1];
  assert.deepEqual(last.gone, ['1']);
  assert.deepEqual(last.updated, []);
});

// ── the overlay is shared state, not a radar return ───────────────────────

test('an IFF declaration on a visible track reflects at once, without waiting for the next sweep', () => {
  const collab = new CollaborativeStore();
  const picture = fakePicture({ c1: ['app:Incirlik'] }, { 1: { at: 5000, radarIds: ['app:Incirlik'] } });
  const hub = new WsHub(storeWith(track(1)), collab, null, picture);
  const ws = fakeWs();
  const s = session('c1', hub);

  hub._tick(ws, s);
  ws.sent.length = 0;

  collab.declare('1', 'hostile', 'someone');
  hub._tick(ws, s);

  const delta = ws.sent.find(m => m.type === 'delta');
  assert.ok(delta, 'a declaration should not wait for the beam');
  assert.equal(delta.updated[0].iffState, 'hostile');
});

test('an overlay edit never leaks a track the controller cannot see', () => {
  const collab = new CollaborativeStore();
  const picture = fakePicture({ c1: ['app:Incirlik'] }, { 2: { at: 5000, radarIds: ['crc:99'] } });
  const hub = new WsHub(storeWith(track(2)), collab, null, picture);
  const ws = fakeWs();

  collab.declare('2', 'hostile', 'someone');
  hub._tick(ws, session('c1', hub));
  assert.equal(ws.sent.length, 0);
});

// ── coverage changing ──────────────────────────────────────────────────────

test('taking a radar Position re-sends the picture; giving it up empties it', () => {
  const grants = { c1: [] };
  const picture = fakePicture(grants, { 1: { at: 5000, radarIds: ['app:Incirlik'] } });
  const hub = new WsHub(storeWith(track(1)), new CollaborativeStore(), null, picture);
  const ws = fakeWs();
  const s = session('c1', hub);

  hub._tick(ws, s);
  assert.equal(ws.sent.length, 0, 'no coverage, no picture');

  grants.c1 = ['app:Incirlik'];
  assert.equal(hub._refreshCoverage(ws, s), true, 'the radar set changed');
  const snapshot = ws.sent.find(m => m.type === 'snapshot');
  assert.ok(snapshot, 'a coverage change re-sends the picture rather than diffing it');
  assert.deepEqual(snapshot.tracks.map(t => t.id), [1]);
  assert.ok(ws.sent.find(m => m.type === 'coverage'), 'and says what is now being looked through');

  ws.sent.length = 0;
  grants.c1 = [];
  hub._refreshCoverage(ws, s);
  assert.deepEqual(ws.sent.find(m => m.type === 'snapshot').tracks, [], 'handing the Position back empties it');
});

test('a coverage message goes out even when the radar set is unchanged, because the held list is in it', () => {
  // Taking Ground adds no scope, but the client still renders what you hold.
  const grants = { c1: ['app:Incirlik'], 'c1:held': [] };
  const picture = fakePicture(grants, {});
  const hub = new WsHub(new TrackStore(), new CollaborativeStore(), null, picture);
  const ws = fakeWs();
  const s = session('c1', hub);

  grants['c1:held'] = [{ facilityId: 'INCIRLIK', positionId: 'GND', isPrimary: true }];
  assert.equal(hub._refreshCoverage(ws, s), false, 'the radar set did not change');
  const coverage = ws.sent.find(m => m.type === 'coverage');
  assert.ok(coverage);
  assert.deepEqual(coverage.heldPositions.map(p => p.positionId), ['GND']);
  assert.equal(ws.sent.some(m => m.type === 'snapshot'), false, 'and no expensive re-send');
});

test('the coverage message carries the radars and which Positions grant them', () => {
  const picture = fakePicture({ c1: ['app:Incirlik'] }, {});
  const hub = new WsHub(new TrackStore(), new CollaborativeStore(), null, picture);
  const ws = fakeWs();
  const s = session('c1', hub);
  ws.send(JSON.stringify(hub._coverageMsg(s)));
  const msg = ws.sent[0];
  assert.deepEqual(msg.radars.map(r => r.id), ['app:Incirlik']);
  assert.deepEqual(msg.radarBearingPositions, ['APP']);
});

// ── without a picture, nothing changes ────────────────────────────────────

test('a hub built without a picture still sends every track, unscoped and unstamped', () => {
  const hub = new WsHub(storeWith(track(1), track(2)), new CollaborativeStore(), null);
  const ws = fakeWs();
  hub._tick(ws, session('c1', hub));
  const delta = ws.sent.find(m => m.type === 'delta');
  assert.deepEqual(delta.updated.map(t => t.id).sort(), [1, 2]);
  assert.equal(delta.updated[0].illuminatedAt, undefined);
});

test('refreshAllCoverage on a hub with no picture is a no-op rather than a crash', () => {
  const hub = new WsHub(new TrackStore(), new CollaborativeStore(), null);
  hub.refreshAllCoverage();
});
