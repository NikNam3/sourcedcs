import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPaths, BOARD, MUTATION_LOG } from './helpers/with-paths.mjs';

// A radio-only /feed session (`&role=radio`, docs/adr/0161, decisions S-RO-1 RO1) is never the controller.
withPaths('radio-only-', { ...BOARD, ...MUTATION_LOG, CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'facility.json' }).apply();
const { createEfsp } = await import('../src/efsp/index.js');
const { default: WsHub } = await import('../src/ws-hub.js');
const { default: TrackStore } = await import('../src/tracks.js');
const { default: CollaborativeStore } = await import('../src/collab-store.js');

const GRACE = 15000;
const HELD_COVERAGE = { radars: [{ id: 'R1' }], radarIds: new Set(['R1']), signedOnPositions: [{ facilityId: 'INCIRLIK', positionId: 'LC', isPrimary: true }], radarBearingPositions: [], datalink: true };

function rig({ radioRelay = null } = {}) {
  let wall = 1_000_000;
  const pendingSignOffs = new Map();
  const efsp = createEfsp({ isAbsent: (id) => pendingSignOffs.has(id) });
  const picture = { coverageFor: () => HELD_COVERAGE, illuminated: () => new Map(), radars: () => [] };
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore(), efsp, picture, wallClock: { now: () => wall }, signOnGraceMs: GRACE, pendingSignOffs, radioRelay });
  hub._wss = { clients: new Set() };
  function connect(sub, url = '/feed') {
    const handlers = {};
    const sent = [];
    const ws = { readyState: 1, send: (s) => sent.push(JSON.parse(s)), on: (ev, fn) => { handlers[ev] = fn; } };
    hub._wss.clients.add(ws);
    hub._onConnect(ws, { crcUser: { sub, name: sub }, url });
    return {
      ws, sent, session: hub._sessions.get(ws), say: (msg) => handlers.message(JSON.stringify(msg)),
      drop: () => { ws.readyState = 3; hub._wss.clients.delete(ws); handlers.close(); },
    };
  }
  return { efsp, hub, pendingSignOffs, ps: efsp.positionStoreFor('INCIRLIK'), connect, advance: (ms) => { wall += ms; hub.sweepPendingSignOffs(); } };
}
const RADIO = '/feed?ticket=t&protocol=6&role=radio';
const signOn = (r, c, ids) => r.efsp.handleMessage(c.session, { type: 'efsp-set-positions', facilityId: 'INCIRLIK', signedOn: ids });
const types = (c) => c.sent.map(m => m.type);

test('rule 1: a radio session inside the grace does not cancel it; the Positions go at expiry', () => {
  const r = rig();
  const crc = r.connect('alice');
  signOn(r, crc, ['LC']);
  crc.drop();
  assert.ok(r.pendingSignOffs.has('alice'));
  r.connect('alice', RADIO);
  assert.ok(r.pendingSignOffs.has('alice'), 'still pending');
  r.advance(GRACE + 1);
  assert.equal(r.ps.primaryOf('LC'), null);
});

test('rule 2: an open radio session does not count when the controller\'s CRC closes', () => {
  const r = rig();
  const crc = r.connect('alice');
  signOn(r, crc, ['LC']);
  r.connect('alice', RADIO);
  crc.drop();
  assert.ok(r.pendingSignOffs.has('alice'), 'the grace starts although a socket of the same user is open');
  r.advance(GRACE + 1);
  assert.equal(r.ps.primaryOf('LC'), null);
});

test('rule 2: a radio session closing starts no grace and signs nobody off', () => {
  const r = rig();
  const crc = r.connect('alice');
  signOn(r, crc, ['LC']);
  r.connect('alice', RADIO).drop();
  assert.equal(r.pendingSignOffs.has('alice'), false);
  r.advance(GRACE * 3);
  assert.equal(r.ps.primaryOf('LC'), 'alice');
});

test('a controller reconnecting CRC inside the grace still cancels it, with a radio session open or not', () => {
  for (const withRadio of [false, true]) {
    const r = rig();
    const crc = r.connect('alice');
    signOn(r, crc, ['LC']);
    if (withRadio) r.connect('alice', RADIO);
    crc.drop();
    r.advance(GRACE - 1);
    r.connect('alice');
    assert.equal(r.pendingSignOffs.has('alice'), false);
    r.advance(GRACE * 3);
    assert.equal(r.ps.primaryOf('LC'), 'alice', `withRadio=${withRadio}`);
  }
});

test('rule 3: empty coverage, whatever the same user holds, and it stays empty on a refresh', () => {
  const r = rig();
  const radio = r.connect('alice', RADIO);
  assert.deepEqual(radio.session.coverage.signedOnPositions, []);
  assert.deepEqual(radio.session.coverage.radars, []);
  assert.equal(radio.session.coverage.datalink, false);
  r.hub.refreshAllCoverage();
  assert.deepEqual(radio.session.coverage.radars, []);
  assert.equal(types(radio).includes('coverage'), false);
});

test('rule 4: on connect only status and the frequency rows, no picture and no snapshot', () => {
  const r = rig();
  const radio = r.connect('alice', RADIO);
  assert.equal(radio.sent[0].type, 'status');
  assert.deepEqual([...new Set(types(radio))], ['status', 'efsp-frequency-delta']);
  assert.deepEqual(radio.sent.slice(1).map(m => m.facilityId).sort(), r.efsp.frequencyFrames().map(f => f.facilityId).sort());
  assert.ok(radio.sent.slice(1).some(m => m.frequencies.length > 0), 'the rows are there');
});

test('rule 4: no tick, no alerts; a broadcast reaches it only if it is status', () => {
  const r = rig();
  const radio = r.connect('alice', RADIO);
  const crc = r.connect('bob');
  radio.sent.length = 0; crc.sent.length = 0;
  r.hub._tickAll();
  r.hub.broadcastEfspAlerts({ conformance: [], conflictAlert: [], obligations: [], surveillance: [], tofiRegime: [] });
  r.hub.setWeather({ pressurePa: 101325, tempK: 288 });
  r.hub.broadcastGameTime();
  r.hub.sendParSamples([{ facilityId: 'INCIRLIK', positionId: 'LC' }]);
  assert.deepEqual(radio.sent, []);
  assert.ok(types(crc).includes('efsp-heartbeat') && types(crc).includes('weather'), 'a controller still gets them');
  r.hub.setGrpcStatus('connected');
  assert.deepEqual(types(radio), ['status']);
});

test('rule 4: deliverEfsp carries nothing to it but the frequency rows', () => {
  const r = rig();
  const radio = r.connect('alice', RADIO);
  const crc = r.connect('bob');
  radio.sent.length = 0; crc.sent.length = 0;
  r.hub.deliverEfsp({ version: 1, type: 'efsp-board-delta', facilityId: 'INCIRLIK', strips: { updated: [], gone: [] }, flightDataList: { updated: [] } });
  r.hub.deliverEfsp({ version: 1, type: 'efsp-airspace-delta', airspaces: { updated: [] } });
  assert.deepEqual(radio.sent, []);
  assert.equal(crc.sent.length, 2);
  r.hub.deliverEfsp(r.efsp.frequencyFrames()[0]);
  assert.deepEqual(types(radio), ['efsp-frequency-delta']);
});

test('a radio session cannot sign on or act: only its link groups are heard', () => {
  const seen = [];
  const radioRelay = {
    handles: (t) => t === 'radio-link-groups',
    handle: (session, msg) => { seen.push(msg); return [{ session, frame: { type: 'radio-link-groups-ack', ok: true } }]; },
    close: () => [],
  };
  const r = rig({ radioRelay });
  const radio = r.connect('alice', RADIO);
  radio.sent.length = 0;
  radio.say({ type: 'efsp-set-positions', facilityId: 'INCIRLIK', signedOn: ['LC'] });
  assert.equal(r.ps.primaryOf('LC'), null);
  assert.deepEqual(radio.sent, []);
  radio.say({ type: 'radio-link-groups', groups: [] });
  assert.equal(seen.length, 1);
  assert.deepEqual(types(radio), ['radio-link-groups-ack']);
});

test('a radio session\'s link groups go when it closes', () => {
  const closed = [];
  const radioRelay = { handles: () => false, handle: () => [], close: (s) => { closed.push(s); return []; } };
  const r = rig({ radioRelay });
  const radio = r.connect('alice', RADIO);
  const { session } = radio;
  radio.drop();
  assert.deepEqual(closed, [session]);
  assert.equal(r.hub.sessionCount(), 0);
});

test('a /feed without the role is a controller', () => {
  const r = rig();
  const crc = r.connect('alice', '/feed?ticket=t&protocol=6&role=other');
  assert.equal(crc.session.radioOnly, undefined);
  assert.ok(types(crc).includes('efsp-snapshot'));
});
