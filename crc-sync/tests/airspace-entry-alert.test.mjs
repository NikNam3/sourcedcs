import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// docs/adr/0119: the airspace-entry alert, by airspace type (H136 VQ4 b), on entry only, to the controlling Position and
// the Position working the flight. The geometry is the store's (activeAreasContaining, tested with the store); here the
// store is a stub that says which ACTIVE areas a point is in.

const require = createRequire(import.meta.url);
const { AirspaceEntryAlertMonitor, alertsIn } = require('../src/efsp/airspace-entry-alert.js');
const { MS_PER_KT } = require('../src/units.js');

const AREAS = {
  'R-1': { airspaceId: 'R-1', name: 'Restricted 1', type: 'RESTRICTED', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'INCIRLIK' },
  'MOA-1': { airspaceId: 'MOA-1', name: 'MOA 1', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'INCIRLIK' },
  'RNG-1': { airspaceId: 'RNG-1', name: 'Range 1', type: 'RANGE', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP', usingPositionId: 'SOUTH_RANGE' },
};
const CLEARED = { clearance: { altitude: { entries: [{ status: 'ACTIVE', parsed: 15000 }] }, heading: { entries: [] } } };
const VFR = { clearance: { altitude: { entries: [] }, heading: { entries: [] } } };

function world({ tracks, inside, flights = {}, members = {}, flightData = {}, strips = {}, transponders = [], usedBy = {} }) {
  const state = { tracks, inside, flights, members, flightData, strips };
  const monitor = new AirspaceEntryAlertMonitor({
    trackStore: { getAll: () => state.tracks },
    airspaceStore: {
      activeAreasContaining: (p) => (state.inside[p.id] || []).map(id => AREAS[id]),
      isActiveFor: (airspaceId, facilityId) => (usedBy[airspaceId] || []).includes(facilityId),
    },
    locate: (t) => ({ id: t.id, lat: t.lat, lon: t.lon, altFt: 10000 }),
    trackedFlights: () => new Map(Object.entries(state.flights)),
    formationMembers: () => new Map(Object.entries(state.members)),
    flightDataOf: (id) => state.flightData[id] || null,
    liveStrips: () => new Map(Object.entries(state.strips)),
    reportsAltitude: (t) => transponders.includes(t.id),
    callsignFor: (t) => `C${t.id}`,
    clock: { now: () => 1000 },
    wallClock: { now: () => 100000 },
    config: { minGroundSpeedKt: 50, minTrackAgeSec: 10 },
  });
  return { monitor, state };
}
const track = (id, extra = {}) => ({ id, category: 1, lat: 37, lon: 35, alt: 3000, groundSpeed: 250 * MS_PER_KT, firstSeenAt: 1, ...extra });
const at = (facilityId, positionId) => [{ facilityId, positionId }];

test('the rule by type: restricted-like alerts any unapproved tracked aircraft; a MOA spares a tracked VFR one; an untracked one alerts everywhere', () => {
  for (const type of ['RESTRICTED', 'PROHIBITED', 'RANGE', 'DANGER']) {
    assert.equal(alertsIn({ type }, { tracked: true, vfr: true }), true, `${type}: VFR needs permission too (14 CFR 73.13)`);
    assert.equal(alertsIn({ type }, { tracked: true, approved: true }), false);
  }
  for (const type of ['MOA', 'WARNING']) {
    assert.equal(alertsIn({ type }, { tracked: true, vfr: true }), false, `${type}: VFR is not denied access (7400.2R 25-1-6 a)`);
    assert.equal(alertsIn({ type }, { tracked: true, vfr: false }), true, `${type}: IFR without approval (ours)`);
    assert.equal(alertsIn({ type }, { tracked: true, approved: true }), false);
  }
  assert.equal(alertsIn({ type: 'MOA' }, { tracked: false }), true);
});

test('a tracked IFR flight entering a restricted area unapproved: one alert, to CTR (controlling) and AP (working), retracted on leaving', () => {
  const { monitor, state } = world({
    tracks: [track(1)], inside: { 1: ['R-1'] }, flights: { 1: 'fd1' }, flightData: { fd1: CLEARED },
    strips: { fd1: [{ facilityId: 'INCIRLIK', positionId: 'AP', airspaceId: null }] },
  });
  assert.equal(monitor.tick(), true);
  const [a] = monitor.getAll();
  assert.deepEqual({ id: a.id, trackId: a.trackId, flightDataId: a.flightDataId, airspaceType: a.airspaceType, callsign: a.callsign, since: a.since },
    { id: 'F:fd1:R-1', trackId: '1', flightDataId: 'fd1', airspaceType: 'RESTRICTED', callsign: 'C1', since: 1000 });
  assert.equal(monitor.deliverableTo(a, at('CENTER', 'CTR')), true);
  assert.equal(monitor.deliverableTo(a, at('INCIRLIK', 'AP')), true);
  assert.equal(monitor.deliverableTo(a, at('INCIRLIK', 'LC')), false);
  assert.equal(monitor.tick(), false, 'unchanged');
  state.inside = {};
  assert.equal(monitor.tick(), true);
  assert.deepEqual(monitor.getAll(), []);
});

test('approval silences it: the Strip working the airspace, the flight data, or an MRU TOFI for a Facility using it', () => {
  const base = { tracks: [track(1)], inside: { 1: ['R-1'] }, flights: { 1: 'fd1' } };
  let w = world({ ...base, flightData: { fd1: CLEARED }, strips: { fd1: [{ facilityId: 'INCIRLIK', positionId: 'AP', airspaceId: 'R-1' }] } });
  w.monitor.tick(); assert.deepEqual(w.monitor.getAll(), []);
  w = world({ ...base, flightData: { fd1: { ...CLEARED, comms: { airspaceId: 'R-1' } } }, strips: {} });
  w.monitor.tick(); assert.deepEqual(w.monitor.getAll(), []);
  w = world({ ...base, flightData: { fd1: { ...CLEARED, tofi: { pendingFacilityId: 'TACTICAL' } } }, usedBy: { 'R-1': ['TACTICAL'] } });
  w.monitor.tick(); assert.deepEqual(w.monitor.getAll(), []);
  w = world({ ...base, flightData: { fd1: { ...CLEARED, tofi: { separationRegime: 'MARSA', regimeEffective: { facilityId: 'TACTICAL' } } } }, usedBy: { 'R-1': ['TACTICAL'] } });
  w.monitor.tick(); assert.deepEqual(w.monitor.getAll(), []);
  w = world({ ...base, flightData: { fd1: { ...CLEARED, tofi: { pendingFacilityId: 'TACTICAL' } } }, usedBy: {} });
  w.monitor.tick(); assert.equal(w.monitor.getAll().length, 1, 'an MRU that does not use this airspace approves nothing');
});

test('approval then retracts a standing alert', () => {
  const { monitor, state } = world({
    tracks: [track(1)], inside: { 1: ['MOA-1'] }, flights: { 1: 'fd1' }, flightData: { fd1: CLEARED },
    strips: { fd1: [{ facilityId: 'INCIRLIK', positionId: 'AP', airspaceId: null }] },
  });
  monitor.tick();
  assert.equal(monitor.getAll().length, 1, 'IFR in a MOA without approval');
  state.strips = { fd1: [{ facilityId: 'INCIRLIK', positionId: 'AP', airspaceId: 'MOA-1' }] };
  assert.equal(monitor.tick(), true);
  assert.deepEqual(monitor.getAll(), []);
});

test('a tracked VFR flight (no assigned altitude or heading) in an active MOA: nothing; in a range: an alert', () => {
  const { monitor, state } = world({ tracks: [track(1)], inside: { 1: ['MOA-1'] }, flights: { 1: 'fd1' }, flightData: { fd1: VFR } });
  monitor.tick();
  assert.deepEqual(monitor.getAll(), []);
  state.inside = { 1: ['RNG-1'] };
  monitor.tick();
  assert.deepEqual(monitor.getAll().map(a => a.id), ['F:fd1:RNG-1']);
  assert.equal(monitor.deliverableTo(monitor.getAll()[0], at('INCIRLIK', 'AP')), true, 'the range\'s controlling Position');
});

test('an untracked contact reporting altitude alerts in any active area, to the controlling Position only; a primary-only one does not', () => {
  const { monitor } = world({ tracks: [track(7), track(8)], inside: { 7: ['MOA-1'], 8: ['MOA-1'] }, transponders: [7] });
  monitor.tick();
  const all = monitor.getAll();
  assert.deepEqual(all.map(a => [a.id, a.flightDataId]), [['T:7:MOA-1', null]]);
  assert.equal(monitor.deliverableTo(all[0], at('CENTER', 'CTR')), true);
  assert.equal(monitor.deliverableTo(all[0], at('INCIRLIK', 'AP')), false);
});

test('a formation: the uncorrelated wingman is the flight, one alert named by the lead; approved, neither alerts', () => {
  const { monitor, state } = world({
    tracks: [track(2), track(1)], inside: { 1: ['R-1'], 2: ['R-1'] }, flights: { 1: 'fd1' }, members: { 2: 'fd1' },
    flightData: { fd1: CLEARED }, strips: { fd1: [{ facilityId: 'INCIRLIK', positionId: 'AP', airspaceId: null }] }, transponders: [2],
  });
  monitor.tick();
  assert.deepEqual(monitor.getAll().map(a => [a.id, a.trackId]), [['F:fd1:R-1', '1']]);
  state.strips = { fd1: [{ facilityId: 'INCIRLIK', positionId: 'AP', airspaceId: 'R-1' }] };
  monitor.tick();
  assert.deepEqual(monitor.getAll(), []);
});

test('on the ground, slow, or just appeared: no alert', () => {
  const { monitor } = world({
    tracks: [track(1, { groundSpeed: 10 * MS_PER_KT }), track(2, { category: 3 }), track(3, { firstSeenAt: 99000 })],
    inside: { 1: ['R-1'], 2: ['R-1'], 3: ['R-1'] }, flights: { 1: 'a', 2: 'b', 3: 'c' }, flightData: { a: CLEARED, b: CLEARED, c: CLEARED },
  });
  monitor.tick();
  assert.deepEqual(monitor.getAll(), []);
});

test('the alert keeps its first `since` while it stands', () => {
  let now = 1000;
  const { monitor } = world({ tracks: [track(1)], inside: { 1: ['R-1'] }, flights: { 1: 'fd1' }, flightData: { fd1: CLEARED } });
  monitor._d.clock = { now: () => now };
  monitor.tick();
  now = 5000;
  monitor.tick();
  assert.equal(monitor.getAll()[0].since, 1000);
});

test('the hub sends an airspace-entry alert only to the sessions it is for, and never the filter', async () => {
  const { default: WsHub } = await import('../src/ws-hub.js');
  const alert = { id: 'F:fd1:R-1', kind: 'AIRSPACE_ENTRY', trackId: '1', flightDataId: 'fd1' };
  const self = {
    _efspAlerts: { airspaceEntry: [alert], airspaceEntryFor: (a, positions) => positions.some(p => p.positionId === 'CTR') },
    _efspFilter: (s, m) => m,
  };
  const session = (positionId) => ({ lastSent: new Map(), coverage: { signedOnPositions: [{ facilityId: 'CENTER', positionId }] } });
  const ctr = WsHub.prototype._efspAlertsMsg.call(self, session('CTR'));
  assert.deepEqual(ctr.airspaceEntry, [alert]);
  assert.equal(ctr.airspaceEntryFor, undefined);
  assert.deepEqual(WsHub.prototype._efspAlertsMsg.call(self, session('LC')).airspaceEntry, []);
});
