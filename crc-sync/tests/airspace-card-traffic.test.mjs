import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// docs/adr/0124 §1 (H140 LT-AQ1 b): the airspace card lists the flights inside the airspace or filed through it, each
// with whether it is approved and alerting and which live Strips it has, for a session that may approve entry (the using
// agency or the controlling Position) and nobody else.

const require = createRequire(import.meta.url);
const { AirspaceEntryAlertMonitor, routeNames } = require('../src/efsp/airspace-entry-alert.js');
const { MS_PER_KT } = require('../src/units.js');

const DEFS = {
  'MOA-1': { airspaceId: 'MOA-1', name: 'Bravo MOA', type: 'MOA', kind: 'AREA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'INCIRLIK' },
  'R-1': { airspaceId: 'R-1', name: 'Restricted 1', type: 'RESTRICTED', kind: 'AREA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'INCIRLIK' },
  'VR-1': { airspaceId: 'VR-1', name: 'VR 1', type: 'MTR', kind: 'ROUTE', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR' },
};
const area = (id) => ({ ...DEFS[id] });
const CLEARED = { identity: { callsign: 'VIPER11' }, clearance: { altitude: { entries: [{ status: 'ACTIVE', parsed: 15000 }] }, heading: { entries: [] } } };
const VFR = { identity: { callsign: 'CESSNA1' }, clearance: { altitude: { entries: [] }, heading: { entries: [] } } };

function world({ tracks = [], inside = {}, flights = {}, flightData = {}, strips = {}, using = { OPS: ['MOA-1', 'R-1'] } }) {
  const state = { tracks, inside, flights, flightData, strips };
  const monitor = new AirspaceEntryAlertMonitor({
    trackStore: { getAll: () => state.tracks },
    airspaceStore: {
      activeAreasContaining: (p) => (state.inside[p.id] || []).map(area),
      isActiveFor: () => false,
      getAll: () => Object.values(DEFS).map(d => ({ airspaceId: d.airspaceId, state: 'ACTIVE', definition: d })),
      isUsingAgency: (airspaceId, positionId) => (using[positionId] || []).includes(airspaceId),
    },
    locate: (t) => ({ id: t.id, lat: 37, lon: 35, altFt: 10000 }),
    trackedFlights: () => new Map(Object.entries(state.flights)),
    flightDataOf: (id) => state.flightData[id] || null,
    liveStrips: () => new Map(Object.entries(state.strips)),
    reportsAltitude: () => true,
    callsignFor: (t) => `C${t.id}`,
    clock: { now: () => 1000 },
    wallClock: { now: () => 100000 },
    config: { minGroundSpeedKt: 50, minTrackAgeSec: 10 },
  });
  return { monitor, state };
}
const track = (id) => ({ id, category: 1, lat: 37, lon: 35, groundSpeed: 250 * MS_PER_KT, firstSeenAt: 1 });
const AP_STRIP = { facilityId: 'INCIRLIK', stripId: 's-ap', positionId: 'AP', airspaceId: null };
const OPS = [{ facilityId: 'INCIRLIK', positionId: 'OPS' }];
const CTR = [{ facilityId: 'CENTER', positionId: 'CTR' }];
const LC = [{ facilityId: 'INCIRLIK', positionId: 'LC' }];

test('a tracked IFR flight inside a MOA unapproved: listed inside, alerting, with the Strip OPS approves on', () => {
  const { monitor } = world({ tracks: [track(1)], inside: { 1: ['MOA-1'] }, flights: { 1: 'fd1' }, flightData: { fd1: CLEARED }, strips: { fd1: [AP_STRIP] } });
  assert.equal(monitor.tick(), true);
  const [card] = monitor.trafficFor(OPS);
  assert.equal(card.airspaceId, 'MOA-1');
  assert.deepEqual(card.flights, [{
    flightDataId: 'fd1', callsign: 'VIPER11', inside: true, filed: false, approved: false, alerting: true,
    strips: [{ facilityId: 'INCIRLIK', stripId: 's-ap', positionId: 'AP' }],
  }]);
});

test('approved: still listed (grey on the card), no longer alerting', () => {
  const { monitor } = world({
    tracks: [track(1)], inside: { 1: ['MOA-1'] }, flights: { 1: 'fd1' }, flightData: { fd1: CLEARED },
    strips: { fd1: [{ ...AP_STRIP, airspaceId: 'MOA-1' }] },
  });
  monitor.tick();
  const [row] = monitor.trafficFor(OPS)[0].flights;
  assert.equal(row.approved, true);
  assert.equal(row.alerting, false);
  assert.equal(row.inside, true);
  assert.equal(row.filed, true, 'a Strip approved in it names the airspace');
});

test('a VFR flight inside a MOA is listed but does not alert (the alert rule decides amber, not the list)', () => {
  const { monitor } = world({ tracks: [track(1)], inside: { 1: ['MOA-1'] }, flights: { 1: 'fd1' }, flightData: { fd1: VFR }, strips: { fd1: [AP_STRIP] } });
  monitor.tick();
  const [row] = monitor.trafficFor(OPS)[0].flights;
  assert.deepEqual([row.inside, row.approved, row.alerting], [true, false, false]);
});

test('filed through: the filed route names the airspace by id or name; a route airspace never lists', () => {
  const { monitor } = world({
    flightData: { fd2: { ...CLEARED, identity: { callsign: 'HAWG21' }, filed: { route: 'LTAG DCT BRAVO MOA DCT LTAG' } } },
    strips: { fd2: [{ facilityId: 'CENTER', stripId: 's-ctr', positionId: 'CTR', airspaceId: null }] },
  });
  monitor.tick();
  const cards = monitor.trafficFor(CTR);
  assert.deepEqual(cards.map(c => c.airspaceId), ['MOA-1']);
  assert.deepEqual(cards[0].flights.map(f => [f.callsign, f.inside, f.filed, f.approved, f.alerting]), [['HAWG21', false, true, false, false]]);
});

test('filed through: the flight data working the airspace counts too', () => {
  const { monitor } = world({
    flightData: { fd3: { ...CLEARED, comms: { airspaceId: 'R-1' } } },
    strips: { fd3: [AP_STRIP] },
  });
  monitor.tick();
  const [card] = monitor.trafficFor(OPS);
  assert.equal(card.airspaceId, 'R-1');
  assert.deepEqual([card.flights[0].filed, card.flights[0].approved], [true, true]);
});

test('shown only to who may approve entry: the using agency and the controlling Position, never another Position', () => {
  const { monitor } = world({ tracks: [track(1)], inside: { 1: ['MOA-1'] }, flights: { 1: 'fd1' }, flightData: { fd1: CLEARED }, strips: { fd1: [AP_STRIP] } });
  monitor.tick();
  assert.equal(monitor.trafficFor(OPS).length, 1);
  assert.equal(monitor.trafficFor(CTR).length, 1);
  assert.deepEqual(monitor.trafficFor(LC), [], 'LC neither uses nor controls it (dark cockpit)');
  assert.deepEqual(monitor.trafficFor([{ facilityId: 'INCIRLIK', positionId: 'AP' }]), [], 'AP works the Strip (the alert reaches it) but sees no list');
  assert.deepEqual(monitor.trafficFor([]), []);
});

test('an untracked contact is not listed: it has no Strip to approve on (ADR 0119 stands)', () => {
  const { monitor } = world({ tracks: [track(9)], inside: { 9: ['MOA-1'] } });
  monitor.tick();
  assert.equal(monitor.getAll().length, 1, 'it still alerts');
  assert.deepEqual(monitor.getTraffic(), []);
});

test('a change in the list alone is a change (the hub resends)', () => {
  const { monitor, state } = world({ flightData: { fd2: { ...CLEARED, filed: { route: 'DCT' } } }, strips: { fd2: [AP_STRIP] } });
  assert.equal(monitor.tick(), false);
  state.flightData.fd2 = { ...CLEARED, filed: { route: 'DCT R-1 DCT' } };
  assert.equal(monitor.tick(), true);
  assert.equal(monitor.tick(), false);
});

test('routeNames: whole words, any case, never a substring', () => {
  assert.equal(routeNames('LTAG DCT bravo moa DCT', { airspaceId: 'MOA-1', name: 'Bravo MOA' }), true);
  assert.equal(routeNames('LTAG DCT BRAVOX', { airspaceId: 'BRAVO' }), false);
  assert.equal(routeNames('R-7203/LTAG', { airspaceId: 'R-7203' }), true);
  assert.equal(routeNames('', { airspaceId: 'R-1' }), false);
  assert.equal(routeNames('A B', { airspaceId: 'A' }), false, 'a one-letter id never matches');
});
