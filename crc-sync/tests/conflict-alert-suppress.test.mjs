import { test } from 'node:test';
import assert from 'node:assert/strict';

// docs/adr/0145 (H173 VQ-A): a controller suppresses one conflict alert at the Position they act as. JO 7110.65BB
// para 5-14-6 c.1 / 5-13-1 c.1(a): one specific alert, between specific aircraft; c.4 / c.3: never for another Position.
const { ConflictAlertMonitor } = await import('../src/conflict-alert.js');
const { loadAlertingConfig } = await import('../src/alerting-config.js');
const { default: WsHub } = await import('../src/ws-hub.js');
const { default: TrackStore } = await import('../src/tracks.js');
const { default: CollaborativeStore } = await import('../src/collab-store.js');
const { fakeWs } = await import('./helpers/ws.mjs');

const cfg = loadAlertingConfig().conflictAlert;
const KT = 0.514444;
const NOW = 1_000_000;
const NM_LAT = 1 / 60;
const AP = { facilityId: 'F1', positionId: 'P_APP' };
const DEP = { facilityId: 'F1', positionId: 'P_DEP' };
const GND = { facilityId: 'F1', positionId: 'P_TAC' };

function track(id, over) {
  return { id, callsign: `T${id}`, category: 1, lat: 37, lon: 35, alt: 3000, course: 0, groundSpeed: 400 * KT, verticalSpeed: 0, firstSeenAt: NOW - 60000, ...over };
}

/** Three aircraft: 1 and 2 head-on, 3 head-on with 1 from the side, so 1|2 and 1|3 both alert. */
function monitor(tracks) {
  return new ConflictAlertMonitor({
    trackStore: { getAll: () => tracks }, config: cfg,
    isAtcPosition: (positionId) => positionId !== GND.positionId,
    clock: { now: () => 42 },
  });
}

test('a suppress holds for that pair at that Position only, never for a third aircraft or another Position', () => {
  const tracks = [track(1, { lat: 37, course: 0 }), track(2, { lat: 37 + 10 * NM_LAT, course: 180 }), track(3, { lat: 37 + 5 * NM_LAT, lon: 35 + 0.1, course: 270, alt: 3000 })];
  const m = monitor(tracks);
  m.tick(NOW);
  const ids = m.getAll().map(c => c.id).sort();
  assert.ok(ids.includes('1|2') && ids.includes('1|3'), `alerts: ${ids}`);

  const r = m.setSuppressed('1|2', AP, true, 'alice');
  assert.equal(r.ok, true);
  const byId = (id) => m.getAll().find(c => c.id === id);
  assert.deepEqual(m.presentFor(byId('1|2'), [AP]).suppressedAt, [AP.positionId]);
  assert.equal(m.presentFor(byId('1|2'), [DEP]).suppressedAt, undefined, 'another Position still sees it in full');
  assert.equal(m.presentFor(byId('1|3'), [AP]).suppressedAt, undefined, 'the third aircraft is not suppressed');
  assert.equal(m.getAll().length, ids.length, 'suppressed is not removed: it is still computed and delivered');
  assert.equal(m._suppressed.get('1|2').get(AP.positionId).at, 42, 'stamped with the mission clock');

  m.tick(NOW);
  assert.deepEqual(m.presentFor(byId('1|2'), [AP, DEP]).suppressedAt, [AP.positionId], 'it holds while the pair alerts');

  assert.equal(m.setSuppressed('1|2', AP, false).ok, true);
  assert.equal(m.presentFor(byId('1|2'), [AP]).suppressedAt, undefined, 'restored');
});

test('a suppression ends by itself when the pair stops alerting or a track drops', () => {
  const tracks = [track(1, { lat: 37, course: 0 }), track(2, { lat: 37 + 10 * NM_LAT, course: 180 })];
  const m = monitor(tracks);
  m.tick(NOW);
  m.setSuppressed('1|2', AP, true);
  tracks[1] = { ...tracks[1], alt: 9000 }; // separated
  m.tick(NOW);
  assert.equal(m._suppressed.size, 0, 'forgotten when the pair stops alerting');
  tracks[1] = { ...tracks[1], alt: 3000 };
  m.tick(NOW);
  assert.equal(m.presentFor(m.getAll()[0], [AP]).suppressedAt, undefined, 'the next alert is a new one, shown in full');

  m.setSuppressed('1|2', AP, true);
  tracks.pop();
  m.tick(NOW);
  assert.equal(m._suppressed.size, 0, 'forgotten when a track drops');
});

test('refused: an ended alert (NOT_FOUND), a Position that is not ATC (PERMISSION_DENIED)', () => {
  const tracks = [track(1, { lat: 37, course: 0 }), track(2, { lat: 37 + 10 * NM_LAT, course: 180 })];
  const m = monitor(tracks);
  m.tick(NOW);
  assert.equal(m.setSuppressed('1|9', AP, true).reason, 'NOT_FOUND');
  assert.equal(m.setSuppressed('1|2', GND, true).reason, 'PERMISSION_DENIED');
  assert.equal(m._suppressed.size, 0);
});

// ── the wire: efsp-conflict-suppress, its ack, and the efsp-alerts that follows ──

function hubWith(m, signedOn) {
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore(), conflictAlert: m });
  const ws = fakeWs();
  const session = { controllerId: 'alice', who: 'alice', lastSent: new Map([['1', 1], ['2', 1]]), labelRevs: new Map(),
    coverage: { conflictAlert: true, signedOnPositions: signedOn } };
  hub._sessions.set(ws, session);
  hub.broadcastEfspAlerts({
    conflictAlert: m.getAll(),
    conflictAlertFor: (c, positions) => m.deliverableTo(c, positions),
    conflictAlertAs: (c, positions) => m.presentFor(c, positions),
  });
  return { hub, ws, session };
}

test('a suppress over the wire: acked, and the alerts go out again with suppressedAt at once', () => {
  const tracks = [track(1, { lat: 37, course: 0 }), track(2, { lat: 37 + 10 * NM_LAT, course: 180 })];
  const m = monitor(tracks);
  m.tick(NOW);
  const { hub, ws, session } = hubWith(m, [{ ...AP, isPrimary: true }]);
  assert.equal(ws.of('efsp-alerts').pop().conflictAlert[0].suppressedAt, undefined);

  hub._onMessage(ws, session, JSON.stringify({ type: 'efsp-conflict-suppress', clientMutationId: 'c1', conflictId: '1|2', actingPositionId: AP.positionId, suppress: true }));
  const ack = ws.of('efsp-conflict-suppress-ack').pop();
  assert.deepEqual({ ok: ack.ok, conflictId: ack.conflictId, suppress: ack.suppress, clientMutationId: ack.clientMutationId }, { ok: true, conflictId: '1|2', suppress: true, clientMutationId: 'c1' });
  assert.deepEqual(ws.of('efsp-alerts').pop().conflictAlert[0].suppressedAt, [AP.positionId]);

  hub._onMessage(ws, session, JSON.stringify({ type: 'efsp-conflict-suppress', clientMutationId: 'c2', conflictId: '1|2', actingPositionId: AP.positionId, suppress: false }));
  assert.equal(ws.of('efsp-alerts').pop().conflictAlert[0].suppressedAt, undefined, 'restored');
});

test('over the wire, refused: not Primary at the acting Position, not in the picture, malformed', () => {
  const tracks = [track(1, { lat: 37, course: 0 }), track(2, { lat: 37 + 10 * NM_LAT, course: 180 })];
  const m = monitor(tracks);
  m.tick(NOW);
  const { hub, ws, session } = hubWith(m, [{ ...AP, isPrimary: false }, { ...DEP, isPrimary: true }]);
  const send = (over) => {
    hub._onMessage(ws, session, JSON.stringify({ type: 'efsp-conflict-suppress', clientMutationId: 'x', conflictId: '1|2', actingPositionId: AP.positionId, suppress: true, ...over }));
    return ws.of('efsp-conflict-suppress-ack').pop();
  };
  assert.equal(send({}).reason, 'NOT_HOLDING_POSITION', 'signed on but not Primary');
  assert.equal(send({ actingPositionId: 'P_OTHER' }).reason, 'NOT_HOLDING_POSITION');
  session.lastSent.delete('2');
  assert.equal(send({ actingPositionId: DEP.positionId }).reason, 'NOT_FOUND', 'the other aircraft is not in this picture');
  assert.equal(send({ suppress: 'yes' }).reason, 'VALIDATION_ERROR');
  assert.equal(m._suppressed.size, 0, 'nothing was suppressed');
});
