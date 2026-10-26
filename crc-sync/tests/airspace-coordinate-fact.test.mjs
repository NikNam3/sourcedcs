import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// docs/adr/0136 (H156 MTB-Q3): the Strip's grey "coordinate" fact. A flight whose filed route crosses an ACTIVE MOA,
// warning or restricted area (route-geometry.js), IFR, with no transit of it and no approved entry, is marked on its
// Strips, for the Strip's holder only. No 5-minute prediction. The geometry is the real route-geometry.js.

const require = createRequire(import.meta.url);
const { AirspaceEntryAlertMonitor } = require('../src/efsp/airspace-entry-alert.js');

const SQUARE = { source: 'POLYGON', points: [[36.0, 35.0], [36.0, 36.0], [37.0, 36.0], [37.0, 35.0]] };
const area = (airspaceId, type, state = 'ACTIVE', transits = []) => ({ airspaceId, state, transits,
  definition: { airspaceId, kind: 'AREA', name: airspaceId, type, geometry: SQUARE, altLowerFt: 10000, altUpperFt: 24000, controllingFacilityId: 'CENTER', controllingPositionId: 'CTR' } });
const MISSION = { waypoints: [{ name: 'WEST1', lat: 36.5, lon: 34.0 }, { name: 'EAST1', lat: 36.5, lon: 37.0 }, { name: 'NORTH', lat: 38.0, lon: 35.5 }], airports: [] };
const IFR = (route = 'WEST1 EAST1', over = {}) => ({ filed: { route, requestedAltitude: 'FL190' }, clearance: { altitude: { entries: [{ status: 'ACTIVE', value: '190', parsed: 19000 }] }, heading: { entries: [] } }, ...over });
const VFR = { filed: { route: 'WEST1 EAST1', requestedAltitude: 'FL190' }, clearance: { altitude: { entries: [] }, heading: { entries: [] } } };
const strip = (stripId, positionId, airspaceId = null, facilityId = 'INCIRLIK') => ({ facilityId, stripId, positionId, airspaceId });
const at = (facilityId, positionId) => [{ facilityId, positionId }];

function world({ records, fds, strips, approvedTransit = () => null }) {
  const state = { records, fds, strips };
  const monitor = new AirspaceEntryAlertMonitor({
    trackStore: { getAll: () => [] },
    airspaceStore: {
      activeAreasContaining: () => [], isActiveFor: () => false, containing: () => [],
      getAll: () => state.records, transitDecidersFor: () => ['CTR'], approvedTransit,
    },
    locate: () => null,
    trackedFlights: () => new Map(),
    formationMembers: () => new Map(),
    flightDataOf: (id) => state.fds[id] || null,
    liveStrips: () => new Map(Object.entries(state.strips)),
    reportsAltitude: () => true,
    clock: { now: () => 1000 },
    wallClock: { now: () => 100000 },
    config: { minGroundSpeedKt: 50, minTrackAgeSec: 10 },
    missionData: () => MISSION,
  });
  return { monitor, state };
}

test('filed through an ACTIVE MOA, IFR, nothing coordinated: each live Strip is marked, for its holder only', () => {
  const { monitor } = world({ records: [area('MOA-1', 'MOA')], fds: { fd1: IFR() }, strips: { fd1: [strip('s1', 'AP'), strip('s2', 'CTR', null, 'CENTER')] } });
  assert.equal(monitor.tick(), true);
  assert.deepEqual(monitor.getCoordinate(), [
    { facilityId: 'CENTER', stripId: 's2', airspaceId: 'MOA-1' },
    { facilityId: 'INCIRLIK', stripId: 's1', airspaceId: 'MOA-1' },
  ]);
  assert.deepEqual(monitor.coordinateFor(at('INCIRLIK', 'AP')), [{ facilityId: 'INCIRLIK', stripId: 's1', airspaceId: 'MOA-1' }]);
  assert.deepEqual(monitor.coordinateFor(at('OTHER', 'AP')), [], 'same Position id, another Facility');
  assert.deepEqual(monitor.coordinateFor([]), []);
  assert.equal(monitor.tick(), false, 'unchanged');
});

test('every transit type counts; PROHIBITED, a ROUTE and a cold area do not', () => {
  for (const type of ['MOA', 'WARNING', 'RESTRICTED']) {
    const { monitor } = world({ records: [area('A', type)], fds: { fd1: IFR() }, strips: { fd1: [strip('s1', 'AP')] } });
    monitor.tick();
    assert.equal(monitor.getCoordinate().length, 1, type);
  }
  for (const rec of [area('P', 'PROHIBITED'), area('S', 'MOA', 'SCHEDULED'), area('R', 'MOA', 'RELEASED'), area('T', 'MOA', 'RETURNED')]) {
    const { monitor } = world({ records: [rec], fds: { fd1: IFR() }, strips: { fd1: [strip('s1', 'AP')] } });
    monitor.tick();
    assert.deepEqual(monitor.getCoordinate(), [], `${rec.definition.type} ${rec.state}`);
  }
});

test('not marked: VFR, the route misses it, too few resolved points, a transit in any state, an approved entry', () => {
  const none = (opts, why) => { const { monitor } = world(opts); monitor.tick(); assert.deepEqual(monitor.getCoordinate(), [], why); };
  const base = { records: [area('MOA-1', 'MOA')], strips: { fd1: [strip('s1', 'AP')] } };
  none({ ...base, fds: { fd1: VFR } }, 'VFR (H151 MT-Q5 b)');
  none({ ...base, fds: { fd1: IFR('NORTH WEST1') } }, 'the leg stays outside');
  none({ ...base, fds: { fd1: IFR('WEST1 MANAZ') } }, 'one resolved point: not filed through');
  for (const state of ['REQUESTED', 'APPROVED', 'DECLINED']) {
    none({ ...base, records: [area('MOA-1', 'MOA', 'ACTIVE', [{ flightDataId: 'fd1', state }])], fds: { fd1: IFR() } }, `transit ${state}`);
  }
  none({ ...base, fds: { fd1: IFR() }, strips: { fd1: [strip('s1', 'AP', 'MOA-1')] } }, 'a Strip approved into it');
  none({ ...base, fds: { fd1: IFR('WEST1 EAST1', { comms: { airspaceId: 'MOA-1' } }) } }, 'its working airspace');
});

test('it goes when a transit is requested or the airspace goes cold, and comes back when the transit ends', () => {
  const { monitor, state } = world({ records: [area('MOA-1', 'MOA')], fds: { fd1: IFR() }, strips: { fd1: [strip('s1', 'AP')] } });
  monitor.tick();
  assert.equal(monitor.getCoordinate().length, 1);
  state.records = [area('MOA-1', 'MOA', 'ACTIVE', [{ flightDataId: 'fd1', state: 'REQUESTED' }])];
  assert.equal(monitor.tick(), true);
  assert.deepEqual(monitor.getCoordinate(), []);
  state.records = [area('MOA-1', 'MOA')]; // acknowledged decline or cancelled request: nothing coordinated again
  assert.equal(monitor.tick(), true);
  assert.equal(monitor.getCoordinate().length, 1);
  state.records = [area('MOA-1', 'MOA', 'RELEASED')];
  assert.equal(monitor.tick(), true);
  assert.deepEqual(monitor.getCoordinate(), []);
});

test('a change of the Strip holder counts as a change (the hub resends)', () => {
  const { monitor, state } = world({ records: [area('MOA-1', 'MOA')], fds: { fd1: IFR() }, strips: { fd1: [strip('s1', 'AP')] } });
  monitor.tick();
  state.strips = { fd1: [strip('s1', 'GC')] };
  assert.equal(monitor.tick(), true);
  assert.deepEqual(monitor.coordinateFor(at('INCIRLIK', 'GC')), [{ facilityId: 'INCIRLIK', stripId: 's1', airspaceId: 'MOA-1' }]);
  assert.deepEqual(monitor.coordinateFor(at('INCIRLIK', 'AP')), []);
});
