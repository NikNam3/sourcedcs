import { test } from 'node:test';
import assert from 'node:assert/strict';
import WsHub from '../src/ws-hub.js';
import TrackStore from '../src/tracks.js';
import CollaborativeStore from '../src/collab-store.js';

/* docs/adr/0059: the client is told what its sensors know, and nothing else.
 *
 * presentation.test.mjs pins the rules; this pins that the hub sends nothing
 * that did not come out of them, and that a change of identity reaches the
 * client without waiting for a sweep.
 */

const { createSurveillance } = await import('../src/surveillance/index.js');
const { WIRE_KEYS } = await import('../src/surveillance/presentation.js');

const OPEN = 1;
const fakeWs = () => { const sent = []; return { readyState: OPEN, send: (r) => sent.push(JSON.parse(r)), sent }; };
const APP = { id: 'app:X', sweepMs: 3000, caps: { height: false, ssr: true, mode4: false } };

function setup() {
  const trackStore = new TrackStore();
  trackStore.update({
    id: 7, callsign: 'Enfield11', name: 'Aerial-1-1', coalition: 3, type: 'F-16C_50', player: null,
    category: 1, lat: 37.1, lon: 35.2, alt: 3048, heading: 90,
  });
  const collabStore = new CollaborativeStore();
  const records = [];
  const surveillance = createSurveillance({
    collab: collabStore,
    correlationStore: { trackIndex: () => new Map(records.map(r => [r.trackId, r])) },
    fdrStore: { getFdr: (id) => (id === 'f1' ? { identity: { callsign: 'VIPER11', aircraftType: 'F16' } } : null) },
  });
  const lit = { 7: new Map([['app:X', 5000]]) };
  const picture = {
    coverageFor: () => ({ radars: [APP], radarIds: new Set(['app:X']), heldPositions: [], radarBearingPositions: ['APP'] }),
    illuminated: () => new Map(Object.entries(lit)),
    radars: () => [APP],
  };
  const hub = new WsHub({ trackStore, collabStore, picture, surveillance });
  const session = { controllerId: 'c1', lastSent: new Map(), labelRevs: new Map() };
  hub._setCoverage(session, picture.coverageFor());
  return { hub, session, records, collabStore };
}

test('every track sent carries only allow-listed keys, and none of DCS truth', () => {
  const { hub, session } = setup();
  const snapshot = hub._pictureSnapshot(session);
  assert.equal(snapshot.tracks.length, 1);
  for (const t of snapshot.tracks) {
    for (const key of Object.keys(t)) assert.ok(WIRE_KEYS.includes(key), `unexpected key ${key}`);
  }
  const text = JSON.stringify(snapshot);
  for (const leak of ['Enfield11', 'Aerial-1-1', 'F-16C_50', '"coalition"', '"player"', '"alt"', '"callsign":"Enfield']) {
    assert.equal(text.includes(leak), false, `${leak} leaked`);
  }
});

test('correlating the contact relabels it on the next tick, without a position update', () => {
  const { hub, session, records } = setup();
  const ws = fakeWs();
  hub._tick(ws, session);
  assert.equal(ws.sent[0].updated[0].label.callsign, null);

  records.push({ trackId: '7', fdrId: 'f1', state: 'CORRELATED' });
  hub._tick(ws, session);
  const delta = ws.sent[1];
  assert.deepEqual(delta.updated, []);
  assert.deepEqual(delta.relabeled.map(r => [r.id, r.label.callsign, r.label.source, r.type]), [['7', 'VIPER11', 'FDR', 'F16']]);

  hub._tick(ws, session);
  assert.equal(ws.sent.length, 2, 'and only once');
});

test('a tag relabels too, and the flight callsign still beats it', () => {
  const { hub, session, records, collabStore } = setup();
  const ws = fakeWs();
  hub._tick(ws, session);
  collabStore.rename('7', 'bandit', 'c1');
  hub._tick(ws, session);
  assert.equal(ws.sent[1].relabeled[0].label.callsign, 'BANDIT');
  records.push({ trackId: '7', fdrId: 'f1', state: 'CORRELATED' });
  hub._tick(ws, session);
  assert.equal(ws.sent[2].relabeled[0].label.callsign, 'VIPER11');
  assert.equal(ws.sent[2].relabeled[0].label.tag, 'BANDIT');
});

test('datalink: a participant is seen with no radar, and a lock never reveals a contact outside the picture', () => {
  const trackStore = new TrackStore();
  for (const [id, over] of [[1, {}], [9, { callsign: 'Bandit', coalition: 2, type: 'Su-27' }]]) {
    trackStore.update({ id, callsign: 'Enfield11', name: `U${id}`, coalition: 3, type: 'F-16C_50', category: 1, lat: 37, lon: 35, alt: 6000, ...over });
  }
  let lock = '9';
  const datalink = { reports: () => new Map([['1', { at: 4000, callsign: 'Enfield11', type: 'F-16C_50', lock }]]), clear() {} };
  const collabStore = new CollaborativeStore();
  const surveillance = createSurveillance({ collab: collabStore, datalink });
  const lit = {};
  const picture = {
    coverageFor: () => ({ radars: [APP], radarIds: new Set(['app:X']), heldPositions: [], radarBearingPositions: [], datalink: true }),
    illuminated: () => new Map(Object.entries(lit)),
    radars: () => [APP],
  };
  const hub = new WsHub({ trackStore, collabStore, picture, surveillance });
  const session = { controllerId: 'c1', lastSent: new Map(), labelRevs: new Map() };
  hub._setCoverage(session, picture.coverageFor());

  let snap = hub._pictureSnapshot(session);
  assert.deepEqual(snap.tracks.map(t => t.id), ['1'], 'the participant, and not the contact it has locked');
  assert.equal(snap.tracks[0].label.callsign, 'Enfield11');
  assert.equal(snap.tracks[0].label.source, 'DATALINK');
  assert.deepEqual(snap.tracks[0].dl, { lock: null }, 'the lock target is not in this picture');

  lit[9] = new Map([['app:X', 5000]]);
  snap = hub._pictureSnapshot(session);
  assert.deepEqual(snap.tracks.find(t => t.id === '1').dl, { lock: '9' }, 'once my own radar has it, the lock may point at it');
  assert.equal(JSON.stringify(snap).includes('Bandit'), false);
});

test('STCA reaches only an ATC Position, and only when both aircraft are in its picture', () => {
  const { hub, session } = setup();
  const sent = [];
  const ws = { readyState: 1, send: (raw) => sent.push(JSON.parse(raw)) };
  hub._sessions.set(ws, session);
  hub._tick(ws, session); // contact 7 now in this picture
  const conflict = (a, b) => ({ id: `${a}|${b}`, a, b, aCallsign: 'A', bCallsign: 'B', timeToCpaSec: 40, minNm: 1, vertFt: 0 });
  const alerts = { conformance: [{ fdrId: 'f1', alerts: [] }], stca: [conflict('7', '8')] };

  session.coverage = { ...session.coverage, stca: true };
  hub.broadcastEfspAlerts(alerts);
  let msg = sent.filter(m => m.type === 'efsp-alerts').pop();
  assert.deepEqual(msg.stca, [], 'the other aircraft is not in this picture');
  assert.equal(msg.conformance.length, 1, 'conformance is about the flight, and goes to everybody');

  session.lastSent.set('8', 1);
  hub.broadcastEfspAlerts(alerts);
  msg = sent.filter(m => m.type === 'efsp-alerts').pop();
  assert.equal(msg.stca.length, 1);

  session.coverage = { ...session.coverage, stca: false };
  hub.broadcastEfspAlerts(alerts);
  msg = sent.filter(m => m.type === 'efsp-alerts').pop();
  assert.deepEqual(msg.stca, [], 'a tactical Position gets no conflict alerts');
});

// ── IFF from interrogation, per session (docs/adr/0066) ────────────────────

const CRC = { id: 'crc:A', sweepMs: 10000, caps: { height: true, ssr: true, mode4: true } };
const APT = { id: 'apt:X', sweepMs: 2000, caps: { height: false, ssr: true, mode4: false } };

/** One hub, contacts lit by the radars given, a session per radar list. */
function iffSetup({ tracks, lit, srs = null, missionData = null }) {
  const trackStore = new TrackStore();
  for (const t of tracks) {
    trackStore.update({ callsign: 'X', name: `U${t.id}`, type: 'F-16C_50', player: null, category: 1, lat: 37.1, lon: 35.2, alt: 3048, heading: 90, coalition: 3, ...t });
  }
  const collabStore = new CollaborativeStore();
  const surveillance = createSurveillance({ collab: collabStore, srs });
  const all = [APP, CRC, APT];
  const coverageFor = (ids) => ({ radars: all.filter(r => ids.includes(r.id)), radarIds: new Set(ids), heldPositions: [], radarBearingPositions: [] });
  const picture = {
    coverageFor: () => coverageFor([]),
    illuminated: () => new Map(Object.entries(lit)),
    radars: () => all,
  };
  const hub = new WsHub({ trackStore, collabStore, picture, surveillance });
  hub._missionData = missionData;
  const sessionWith = (ids) => {
    const session = { controllerId: ids.join('+'), lastSent: new Map(), labelRevs: new Map() };
    hub._setCoverage(session, coverageFor(ids));
    return session;
  };
  return { hub, collabStore, sessionWith };
}

test('two sessions, two colours: one own aircraft is neutral on APP and friendly on a Mode 4 radar', () => {
  const { hub, sessionWith } = iffSetup({
    tracks: [{ id: 7 }],
    lit: { 7: new Map([['app:X', 5000], ['crc:A', 5000]]) },
  });
  const app = hub._pictureSnapshot(sessionWith(['app:X']));
  const gci = hub._pictureSnapshot(sessionWith(['crc:A']));
  assert.equal(app.tracks[0].iffState, 'neutral');
  assert.equal(gci.tracks[0].iffState, 'friendly');
  const both = hub._pictureSnapshot(sessionWith(['app:X', 'crc:A']));
  assert.equal(both.tracks[0].iffState, 'friendly', 'holding both, the Mode 4 radar answers (decision H5)');
});

test('an automatic IFF change waits for the next fresh return; it is never a relabel', () => {
  const entry = { squawk: 4521, squawkStatus: 1, mode4: false };
  const srs = { getTransponder: (name) => (name === 'Maverick' ? entry : null) };
  const lit = { 7: new Map([['crc:A', 5000]]) };
  const { hub, sessionWith } = iffSetup({ tracks: [{ id: 7, player: 'Maverick' }], lit, srs });
  const session = sessionWith(['crc:A']);
  const ws = fakeWs();
  hub._tick(ws, session);
  assert.equal(ws.sent[0].updated[0].iffState, 'neutral', 'Mode 4 off: answers Mode 3 only');

  entry.mode4 = true;
  hub._tick(ws, session);
  assert.equal(ws.sent.length, 1, 'no new return, so no interrogation, so nothing sent');

  lit[7] = new Map([['crc:A', 15000]]);
  hub._tick(ws, session);
  assert.equal(ws.sent[1].updated[0].iffState, 'friendly');
  assert.deepEqual(ws.sent[1].relabeled, []);
});

test('clearing a declaration relabels back to the automatic colour without a sweep', () => {
  const { hub, collabStore, sessionWith } = iffSetup({ tracks: [{ id: 7 }], lit: { 7: new Map([['crc:A', 5000]]) } });
  const session = sessionWith(['crc:A']);
  const ws = fakeWs();
  hub._tick(ws, session);
  collabStore.declare('7', 'hostile', 'c1');
  hub._tick(ws, session);
  assert.equal(ws.sent[1].relabeled[0].iffState, 'hostile');
  collabStore.clearDeclare('7');
  hub._tick(ws, session);
  assert.deepEqual(ws.sent[2].updated, []);
  assert.equal(ws.sent[2].relabeled[0].iffState, 'friendly');
  assert.equal(ws.sent[2].relabeled[0].iffOverride, null);
});

test('no aircraft is hidden on the ground any more: a parked hostile is a bogey, a parked own AI neutral (H6)', () => {
  const missionData = { airports: [{ lat: 36.0, lon: 35.0, elev: 0 }] };
  const parked = { lat: 36.001, lon: 35.001, alt: 10 };
  const { hub, sessionWith } = iffSetup({
    tracks: [{ id: 1, coalition: 2, ...parked }, { id: 2, coalition: 3, ...parked }],
    lit: { 1: new Map([['apt:X', 5000]]), 2: new Map([['apt:X', 5000]]) },
    missionData,
  });
  const snap = hub._pictureSnapshot(sessionWith(['apt:X']));
  const byId = new Map(snap.tracks.map(t => [t.id, t]));
  assert.equal(byId.get('1').iffState, 'bogey');
  assert.equal(byId.get('1').onGround, true);
  assert.equal(byId.get('2').iffState, 'neutral', 'its synthetic squawk answers the SSR; the tower has no Mode 4');
  for (const t of snap.tracks) assert.ok(['friendly', 'neutral', 'bogey'].includes(t.iffState), t.iffState);
});
