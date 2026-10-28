import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// docs/adr/0134 (H155 item 4): the Strip's "inside" fact. The airspace-entry monitor's tick says, per live Strip with an
// approved airspace, whether its flight is airborne inside that airspace, whatever the airspace's state; the client turns
// the badge amber only while inside and not ACTIVE. The geometry here is the real `containment.evaluate` (lateral and
// vertical), wrapped as the store's `containing` does it.

const require = createRequire(import.meta.url);
const { AirspaceEntryAlertMonitor } = require('../src/efsp/airspace-entry-alert.js');
const containment = require('../src/efsp/airspace/containment.js');
const { MS_PER_KT } = require('../src/units.js');

const SQUARE = { points: [[37, 35], [37, 36], [38, 36], [38, 35]] };
const RECORDS = {
  'MOA-1': { airspaceId: 'MOA-1', state: 'SCHEDULED', definition: { kind: 'AREA', name: 'MOA 1', type: 'MOA', geometry: SQUARE, altLowerFt: 5000, altUpperFt: 18000, controllingFacilityId: 'CENTER', controllingPositionId: 'CTR' } },
  'R-1': { airspaceId: 'R-1', state: 'ACTIVE', definition: { kind: 'AREA', name: 'R 1', type: 'RESTRICTED', geometry: SQUARE, altLowerFt: 0, altUpperFt: 30000, controllingFacilityId: 'CENTER', controllingPositionId: 'CTR' } },
};
const CLEARED = { clearance: { altitude: { entries: [{ status: 'ACTIVE', parsed: 15000 }] }, heading: { entries: [] } } };

function world({ tracks, flights = {}, members = {}, strips = {} }) {
  const state = { tracks, flights, members, strips };
  const monitor = new AirspaceEntryAlertMonitor({
    trackStore: { getAll: () => state.tracks },
    airspaceStore: {
      activeAreasContaining: () => [],
      isActiveFor: () => false,
      containing: (point) => Object.values(RECORDS)
        .filter(r => containment.evaluate(r.definition, point) === 'inside')
        .map(r => ({ airspaceId: r.airspaceId, kind: r.definition.kind, name: r.definition.name, state: r.state })),
    },
    locate: (t) => ({ lat: t.lat, lon: t.lon, altFt: t.altFt }),
    trackedFlights: () => new Map(Object.entries(state.flights)),
    formationMembers: () => new Map(Object.entries(state.members)),
    flightDataOf: () => CLEARED,
    liveStrips: () => new Map(Object.entries(state.strips)),
    reportsAltitude: () => true,
    clock: { now: () => 1000 },
    wallClock: { now: () => 100000 },
    config: { minGroundSpeedKt: 50, minTrackAgeSec: 10 },
  });
  return { monitor, state };
}
const track = (id, extra = {}) => ({ id, category: 1, lat: 37.5, lon: 35.5, altFt: 10000, groundSpeed: 300 * MS_PER_KT, firstSeenAt: 1, ...extra });
const strip = (stripId, positionId, airspaceId, facilityId = 'INCIRLIK') => ({ facilityId, stripId, positionId, airspaceId });
const at = (facilityId, positionId) => [{ facilityId, positionId }];

test('airborne inside the approved airspace, whatever its state: inside; the holder is told, no one else', () => {
  const { monitor } = world({ tracks: [track(1)], flights: { 1: 'fd1' }, strips: { fd1: [strip('s1', 'AP', 'MOA-1')] } });
  assert.equal(monitor.tick(), true);
  assert.deepEqual(monitor.getInside(), [{ facilityId: 'INCIRLIK', stripId: 's1', airspaceId: 'MOA-1' }]);
  assert.deepEqual(monitor.insideFor(at('INCIRLIK', 'AP')), [{ facilityId: 'INCIRLIK', stripId: 's1', airspaceId: 'MOA-1' }]);
  assert.deepEqual(monitor.insideFor(at('CENTER', 'CTR')), [], 'the controlling Position holds no Strip here');
  assert.deepEqual(monitor.insideFor(at('OTHER', 'AP')), [], 'same Position id, another Facility');
  assert.deepEqual(monitor.insideFor([]), []);
  assert.equal(monitor.tick(), false, 'unchanged');
});

test('outside laterally, below or above the vertical limits: not inside', () => {
  for (const extra of [{ lat: 39 }, { altFt: 4000 }, { altFt: 19000 }]) {
    const { monitor } = world({ tracks: [track(1, extra)], flights: { 1: 'fd1' }, strips: { fd1: [strip('s1', 'AP', 'MOA-1')] } });
    monitor.tick();
    assert.deepEqual(monitor.getInside(), [], JSON.stringify(extra));
  }
});

test('on the ground under the block, too slow, just appeared, not airborne, or no altitude: not inside (unknown is never inside)', () => {
  for (const extra of [{ groundSpeed: 0 }, { groundSpeed: 20 * MS_PER_KT }, { firstSeenAt: 99000 }, { category: 3 }, { altFt: null }]) {
    const { monitor } = world({ tracks: [track(1, extra)], flights: { 1: 'fd1' }, strips: { fd1: [strip('s1', 'AP', 'MOA-1')] } });
    monitor.tick();
    assert.deepEqual(monitor.getInside(), [], JSON.stringify(extra));
  }
});

test('no correlated track, no approved airspace, or another airspace approved: not inside', () => {
  let w = world({ tracks: [track(1)], flights: {}, strips: { fd1: [strip('s1', 'AP', 'MOA-1')] } });
  w.monitor.tick(); assert.deepEqual(w.monitor.getInside(), [], 'uncorrelated');
  w = world({ tracks: [track(1)], flights: { 1: 'fd1' }, strips: { fd1: [strip('s1', 'AP', null)] } });
  w.monitor.tick(); assert.deepEqual(w.monitor.getInside(), [], 'no entry approval');
  w = world({ tracks: [track(1, { lat: 39 })], flights: { 1: 'fd1' }, strips: { fd1: [strip('s1', 'AP', 'R-1')] } });
  w.monitor.tick(); assert.deepEqual(w.monitor.getInside(), []);
});

test('the walk: approved early on the ground, takes off and enters, leaves, approval cleared, handed to a second Strip', () => {
  const { monitor, state } = world({ tracks: [track(1, { groundSpeed: 0, altFt: 1200 })], flights: { 1: 'fd1' }, strips: { fd1: [strip('s1', 'GC', 'MOA-1')] } });
  monitor.tick();
  assert.deepEqual(monitor.getInside(), [], 'parked, approved early');
  state.tracks = [track(1)]; // airborne at 10,000 ft inside
  assert.equal(monitor.tick(), true);
  assert.deepEqual(monitor.insideFor(at('INCIRLIK', 'GC')).map(x => x.stripId), ['s1']);
  // A second Strip of the same flight (another Facility) approved into the same airspace gets the same fact, to its holder.
  state.strips = { fd1: [strip('s1', 'GC', 'MOA-1'), strip('s2', 'CTR', 'MOA-1', 'CENTER')] };
  assert.equal(monitor.tick(), true);
  assert.deepEqual(monitor.insideFor(at('CENTER', 'CTR')), [{ facilityId: 'CENTER', stripId: 's2', airspaceId: 'MOA-1' }]);
  assert.deepEqual(monitor.insideFor(at('INCIRLIK', 'GC')).map(x => x.stripId), ['s1']);
  // The Strip changes hands: the new holder is told, the old one no longer.
  state.strips = { fd1: [strip('s1', 'AP', 'MOA-1'), strip('s2', 'CTR', 'MOA-1', 'CENTER')] };
  assert.equal(monitor.tick(), true, 'a new holder is a change');
  assert.deepEqual(monitor.insideFor(at('INCIRLIK', 'GC')), []);
  assert.deepEqual(monitor.insideFor(at('INCIRLIK', 'AP')).map(x => x.stripId), ['s1']);
  // Entry approval cleared on s1 while inside: s1 has no fact (its badge is gone), s2 keeps its own.
  state.strips = { fd1: [strip('s1', 'AP', null), strip('s2', 'CTR', 'MOA-1', 'CENTER')] };
  monitor.tick();
  assert.deepEqual(monitor.getInside().map(x => x.stripId), ['s2']);
  state.tracks = [track(1, { lat: 39 })]; // leaves
  assert.equal(monitor.tick(), true);
  assert.deepEqual(monitor.getInside(), []);
});

test('a formation wingman inside counts for the flight', () => {
  const { monitor } = world({ tracks: [track(1, { lat: 39 }), track(2)], flights: { 1: 'fd1' }, members: { 2: 'fd1' }, strips: { fd1: [strip('s1', 'AP', 'MOA-1')] } });
  monitor.tick();
  assert.deepEqual(monitor.getInside().map(x => x.stripId), ['s1']);
});

test('the hub sends each session its own Strips\' facts as `airspaceInside`, never the filter', async () => {
  const { default: WsHub } = await import('../src/ws-hub.js');
  const fact = { facilityId: 'INCIRLIK', stripId: 's1', airspaceId: 'MOA-1' };
  const self = {
    _efspAlerts: { airspaceInsideFor: (positions) => (positions.some(p => p.positionId === 'AP') ? [fact] : []) },
    _efspFilter: (s, m) => m,
  };
  const session = (positionId) => ({ lastSent: new Map(), coverage: { signedOnPositions: [{ facilityId: 'INCIRLIK', positionId }] } });
  const ap = WsHub.prototype._efspAlertsMsg.call(self, session('AP'));
  assert.deepEqual(ap.airspaceInside, [fact]);
  assert.equal(ap.airspaceInsideFor, undefined);
  assert.deepEqual(WsHub.prototype._efspAlertsMsg.call(self, session('LC')).airspaceInside, []);
  assert.deepEqual(WsHub.prototype._efspAlertsMsg.call({ _efspAlerts: {}, _efspFilter: (s, m) => m }, session('AP')).airspaceInside, []);
});

test('an OWNED read scope keeps only the facts of visible Strips', () => {
  const readScope = require('../src/efsp/read-scope.js');
  const msg = { type: 'efsp-alerts', airspaceInside: [{ facilityId: 'INCIRLIK', stripId: 's1', airspaceId: 'MOA-1' }, { facilityId: 'INCIRLIK', stripId: 's2', airspaceId: 'MOA-1' }] };
  const out = readScope.filterAlerts(msg, { kind: readScope.OWNED }, new Set(), (f, s) => s === 's1');
  assert.deepEqual(out.airspaceInside.map(x => x.stripId), ['s1']);
});
