import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import WsHub from '../src/ws-hub.js';
import TrackStore from '../src/tracks.js';
import CollaborativeStore from '../src/collab-store.js';
import { fakeWs } from './helpers/ws.mjs';

// docs/adr/0112: the PAR sample goes to the sessions signed on to the Position that owns the Strip on final, and nobody
// else; a session that loses it gets one empty frame. Then the whole path on a real EFSP: an arrival AP hands to
// PAR (docs/adr/0117) is sampled for PAR's controller, the PAR controller signs off mid-approach, AP takes PAR's hat.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'par-hub-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CARRIER: 'carrier.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '{}');

const { createEfsp } = await import('../src/efsp/index.js');
const { ParMonitor } = await import('../src/surveillance/par-monitor.js');
const { loadParTuning } = await import('../src/surveillance/par-tuning.js');
const par = (await import('../src/surveillance/par.js')).default;
const { freshEfsp, mustAct, hold } = await import('./helpers/efsp-scenario.mjs');

function hubWith(signedOn) {
  const efsp = { positionStoreFor: (fid) => ({ signedOnBy: (cid) => (signedOn[cid] || []).filter(x => x.startsWith(`${fid}:`)).map(x => x.split(':')[1]) }) };
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore(), efsp, clock: { now: () => 1234, source: 'TEST' } });
  const socket = (controllerId) => { const ws = fakeWs(); hub._sessions.set(ws, { controllerId, who: controllerId }); return ws; };
  return { hub, socket };
}
const sample = (stripId, facilityId, positionId) => ({ stripId, facilityId, positionId, approach: null, sensor: {}, plot: null, plotAgeMs: null, trail: [] });

test('only the sessions signed on to the owning Position get a sample, each only its own finals', () => {
  const signedOn = { par: ['INCIRLIK:PAR'], ap: ['INCIRLIK:AP'], lane1: ['CARRIER:CV_APP1'], both: ['CARRIER:CV_APP1', 'CARRIER:CV_APP2'] };
  const { hub, socket } = hubWith(signedOn);
  const ws = { par: socket('par'), ap: socket('ap'), lane1: socket('lane1'), both: socket('both') };
  hub.sendParSamples([sample('s1', 'INCIRLIK', 'PAR'), sample('c1', 'CARRIER', 'CV_APP1'), sample('c2', 'CARRIER', 'CV_APP2')]);
  const ids = (w) => w.of('par-sample').flatMap(m => m.samples.map(s => s.stripId));
  assert.deepEqual(ids(ws.par), ['s1']);
  assert.deepEqual(ids(ws.ap), [], 'AP is not PAR');
  assert.equal(ws.ap.sent.length, 0, 'nothing at all to a session with no final');
  assert.deepEqual(ids(ws.lane1), ['c1']);
  assert.deepEqual(ids(ws.both), ['c1', 'c2'], 'a controller combining both lanes sees both');
  const frame = ws.par.of('par-sample')[0];
  assert.deepEqual(Object.keys(frame), ['version', 'type', 'at', 'samples']);
  assert.equal(frame.at, 1234, 'stamped with the mission clock');
});

test('a session that had a sample and has none now is sent one empty frame, then nothing', () => {
  const signedOn = { par: ['INCIRLIK:PAR'] };
  const { hub, socket } = hubWith(signedOn);
  const ws = socket('par');
  hub.sendParSamples([sample('s1', 'INCIRLIK', 'PAR')]);
  signedOn.par = []; // signed off
  hub.sendParSamples([sample('s1', 'INCIRLIK', 'PAR')]);
  hub.sendParSamples([sample('s1', 'INCIRLIK', 'PAR')]);
  assert.deepEqual(ws.of('par-sample').map(m => m.samples.length), [1, 0]);
});

// ── the whole path on a real EFSP ───────────────────────────────────────────

test('walk: handed to PAR, sampled for PAR only; the PAR controller signs off mid-approach; AP takes the hat and gets it', () => {
  const STAFFED = { AP: 'INCIRLIK', PAR: 'INCIRLIK' };
  const { efsp, c } = freshEfsp(createEfsp, STAFFED);
  let s = mustAct(efsp, c.AP, 'AP', null, {
    kind: 'CreateStrip', bayId: 'ap-inbound', rackId: 'main', stripType: 'ARRIVAL',
    flightData: { callsign: 'VIPER21', aircraftType: 'F16', wakeCategory: 'M', originAirport: 'LTAG' },
  });
  s = mustAct(efsp, c.AP, 'AP', s, { kind: 'MoveStrip', bayId: 'ap-sfa', rackId: 'freq-2' });
  s = mustAct(efsp, c.AP, 'AP', s, { kind: 'TransferStrip', toPositionId: 'PAR', bayId: 'par-final', rackId: 'main' });
  assert.equal(s.bayId, 'par-final');
  assert.equal(s.state, 'ON_FINAL');

  const cfg = efsp.facilityConfig.getFacilityConfig('INCIRLIK');
  const thr = cfg.parApproaches['05'];
  const tracks = new TrackStore();
  const back = par.offsetPoint(thr.thresholdLat, thr.thresholdLon, 236, 4 * 1852);
  tracks.update({ id: 77, callsign: 'VIPER21', coalition: 2, type: 'F-16C_50', category: 0, lat: back.lat, lon: back.lon, alt: (160 + 50 + 4 * 6076.12 * Math.tan(3.06 * Math.PI / 180)) / 3.28084, heading: 0, groundSpeed: 72, verticalSpeed: -3.8 });
  const monitor = new ParMonitor({
    facilityConfig: efsp.facilityConfig,
    boardStoreFor: (fid) => efsp.boardStoreFor(fid),
    flightDataOf: (id) => efsp.flightDataStore.getFlightData(id),
    correlatedTrackId: (id) => (id === s.flightDataId ? '77' : null), // the reconciler's job; its own tests cover it
    runwayViewOf: (fid) => efsp.runwayStatusStore.statusView(fid),
    trackOf: (id) => tracks.get(id),
    tracks: () => tracks.getAll(),
    carrierStore: efsp.carrierStore,
    airportElevationFt: () => 160,
    tuning: loadParTuning(),
  });
  // No active runway yet: the approach is not known, the panel says so.
  let [e] = monitor.tick();
  assert.equal(e.approach, null);
  efsp.runwayStatusStore.setActiveRunwayFromWind('INCIRLIK', { windFromTrue: 60, windKt: 8 }); // the mission wind picks 05 (H22)
  [e] = monitor.tick();
  assert.equal(e.approach && e.approach.id, 'LTAG-05');
  assert.equal(e.plot.rangeNm, 4);
  assert.equal(e.positionId, 'PAR');

  const hub = new WsHub({ trackStore: tracks, collabStore: new CollaborativeStore(), efsp, clock: { now: () => 5, source: 'TEST' } });
  const parWs = fakeWs(), apWs = fakeWs();
  hub._sessions.set(parWs, c.PAR.session);
  hub._sessions.set(apWs, c.AP.session);
  hub.sendParSamples(monitor.tick());
  assert.equal(parWs.of('par-sample').length, 1);
  assert.equal(apWs.of('par-sample').length, 0);

  hold(efsp, c.PAR.session, 'INCIRLIK', []); // the PAR controller signs off mid-approach
  hub.sendParSamples(monitor.tick());
  assert.deepEqual(parWs.of('par-sample').map(m => m.samples.length), [1, 0], 'the panel is cleared');
  assert.equal(apWs.of('par-sample').length, 0, 'not AP\'s until it takes the hat');
  assert.equal(efsp.boardStoreFor('INCIRLIK').getStrip(s.stripId).ownerPositionId, 'PAR', 'the Strip stays PAR\'s (ADR 0110)');

  hold(efsp, c.AP.session, 'INCIRLIK', ['AP', 'PAR']); // AP takes PAR's hat
  hub.sendParSamples(monitor.tick());
  const got = apWs.of('par-sample');
  assert.equal(got.length, 1);
  assert.equal(got[0].samples[0].stripId, s.stripId);
  assert.equal(got[0].samples[0].plot.rangeNm, 4, 'the trend did not reset: same Strip, same sample');
});
