import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// decisions H161 V2-Q2 a: the UNACTIVATED_AIRSPACE_ENTRY obligation follows the airspace badge's rule (docs/adr/0134,
// H155 item 4): raised only while the flight is airborne inside its approved airspace and that airspace is not ACTIVE.
// The inside fact is the airspace-entry monitor's (`isInside`, the same as `getInside()`), never a second containment
// test. The pilot walk: approved early on the ground, takes off, enters the cold block, the block goes active, goes cold
// again, the flight leaves, comes back, the approval is cleared.

const require = createRequire(import.meta.url);
const { AirspaceEntryAlertMonitor } = require('../src/efsp/airspace-entry-alert.js');
const { ForwardingObligationMonitor } = require('../src/efsp/forwarding-obligations.js');
const containment = require('../src/efsp/airspace/containment.js');
const { MS_PER_KT } = require('../src/units.js');

const SQUARE = { points: [[37, 35], [37, 36], [38, 36], [38, 35]] };
const MOA = { kind: 'AREA', name: 'MOA 1', type: 'MOA', geometry: SQUARE, altLowerFt: 5000, altUpperFt: 18000, controllingFacilityId: 'CENTER', controllingPositionId: 'CTR' };
const CLEARED = { filed: {}, clearance: { altitude: { entries: [{ status: 'ACTIVE', parsed: 15000 }] }, heading: { entries: [] } } };

function world() {
  let now = 1_000_000;
  const state = { airspace: 'SCHEDULED', track: { id: 1, category: 1, lat: 37.5, lon: 35.5, altFt: 1200, groundSpeed: 0, firstSeenAt: 1 } };
  // Two Facilities, each with one Strip of the flight approved into the MOA (a handoff across a boundary): N, not one.
  const strips = {
    INCIRLIK: [{ stripId: 's1', stripType: 'DEPARTURE', state: 'DEPARTED', flightDataId: 'fd1', ownerPositionId: 'AP', airspaceEntry: { airspaceId: 'MOA-1', approvedAt: now } }],
    CENTER: [{ stripId: 's2', stripType: 'OVERFLIGHT', state: 'ACTIVE', flightDataId: 'fd1', ownerPositionId: 'CTR', airspaceEntry: { airspaceId: 'MOA-1', approvedAt: now } }],
  };
  const facilities = Object.keys(strips);
  const entry = new AirspaceEntryAlertMonitor({
    trackStore: { getAll: () => [state.track] },
    airspaceStore: {
      activeAreasContaining: () => [],
      isActiveFor: () => false,
      containing: (point) => (containment.evaluate(MOA, point) === 'inside' ? [{ airspaceId: 'MOA-1', kind: 'AREA', name: MOA.name, state: state.airspace }] : []),
    },
    locate: (t) => ({ lat: t.lat, lon: t.lon, altFt: t.altFt }),
    trackedFlights: () => new Map([['1', 'fd1']]),
    flightDataOf: () => CLEARED,
    liveStrips: () => new Map([['fd1', facilities.flatMap(f => strips[f].map(s => ({ facilityId: f, stripId: s.stripId, positionId: s.ownerPositionId, airspaceId: (s.airspaceEntry && s.airspaceEntry.airspaceId) || null })))]]),
    reportsAltitude: () => true,
    clock: { now: () => now },
    wallClock: { now: () => 100000 },
    config: { minGroundSpeedKt: 50, minTrackAgeSec: 10 },
  });
  const obligations = new ForwardingObligationMonitor({
    clock: { now: () => now },
    boardStoreFor: (f) => ({ getAll: () => strips[f] }),
    flightDataStore: { getFlightData: () => CLEARED },
    facilityConfig: { getFacilityIds: () => facilities, getFacilityConfig: () => ({}) },
    airspaceStore: { isActive: () => state.airspace === 'ACTIVE' },
    // as app/monitors.js wires it
    insideApprovedAirspace: (facilityId, strip) => !!strip.airspaceEntry && entry.isInside(facilityId, strip.stripId, strip.airspaceEntry.airspaceId),
  });
  const tick = () => { now += 1000; entry.tick(); obligations.tick(now); };
  const raised = () => obligations.getAll().filter(o => o.obligationType === 'UNACTIVATED_AIRSPACE_ENTRY')
    .map(o => `${o.facilityId}:${o.stripId}`).sort();
  const dueAt = () => obligations.getAll().filter(o => o.obligationType === 'UNACTIVATED_AIRSPACE_ENTRY').map(o => o.dueAt);
  return { state, strips, tick, raised, dueAt, now: () => now };
}

test('the pilot walk: approved early on the ground none; inside a cold block raised; activated retracted; cold again raised; leaves retracted; cleared retracted', () => {
  const w = world();
  w.tick();
  assert.deepEqual(w.raised(), [], 'approved early, parked: none');
  w.state.track = { ...w.state.track, altFt: 3000, groundSpeed: 250 * MS_PER_KT };
  w.tick();
  assert.deepEqual(w.raised(), [], 'airborne below the block: none');
  w.state.track = { ...w.state.track, lat: 38.5, altFt: 10000 };
  w.tick();
  assert.deepEqual(w.raised(), [], 'en route at the block\'s level, not yet in it: none');

  w.state.track = { ...w.state.track, lat: 37.5 };
  w.tick();
  assert.deepEqual(w.raised(), ['CENTER:s2', 'INCIRLIK:s1'], 'inside a cold block: raised, on each Strip approved into it');
  w.tick();
  assert.equal(w.raised().length, 2, 'still inside, still cold: still raised');

  w.state.airspace = 'ACTIVE';
  w.tick();
  assert.deepEqual(w.raised(), [], 'the using agency activated it: retracted');
  w.state.airspace = 'RETURNED';
  w.tick();
  assert.equal(w.raised().length, 2, 'released with the flight still inside: raised again');

  w.state.track = { ...w.state.track, lat: 39 };
  w.tick();
  assert.deepEqual(w.raised(), [], 'leaves: retracted');
  w.state.track = { ...w.state.track, lat: 37.5 };
  w.tick();
  assert.equal(w.raised().length, 2, 'back in');

  w.strips.INCIRLIK[0] = { ...w.strips.INCIRLIK[0], airspaceEntry: null };
  w.tick();
  assert.deepEqual(w.raised(), ['CENTER:s2'], 'the approval cleared on one Strip: only the other keeps it');
});

test('dueAt is when the flight was first seen inside, not when it was approved; held while it stays inside', () => {
  const w = world();
  const approvedAt = w.strips.INCIRLIK[0].airspaceEntry.approvedAt;
  w.tick();
  w.state.track = { ...w.state.track, altFt: 10000, groundSpeed: 250 * MS_PER_KT };
  w.tick();
  const entered = w.now();
  w.tick();
  w.tick();
  assert.deepEqual(w.dueAt(), [entered, entered]);
  assert.ok(entered > approvedAt);
});
