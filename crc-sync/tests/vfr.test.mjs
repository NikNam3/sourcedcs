import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPaths } from './helpers/with-paths.mjs';

withPaths('vfr-test-', {}, { stateDir: true }).apply();

// S-ARCH-76: clearing an assigned altitude (an empty value, recorded as an amendment, ADR 0058) is no clearance.
const { FlightDataStore } = await import('../src/efsp/flight-data-store.js');
const { hasNoClearance } = await import('../src/efsp/vfr.js');

const FILED = { aircraftType: 'F16', wakeCategory: 'M', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: 'FL250' };

test('a cleared altitude or heading leaves the flight with no clearance (VFR the FAA way)', () => {
  const store = new FlightDataStore();
  const id = store.createFlightData({ callsign: 'VPR1', ...FILED }, { by: 'test' }).flightData.flightDataId;
  const fd = () => store.getFlightData(id);
  assert.equal(hasNoClearance(fd()), true);
  assert.equal(store.setClearance(id, 'altitude', { value: 'FL180' }, { by: 'cd' }).ok, true);
  assert.equal(hasNoClearance(fd()), false);
  assert.equal(store.setClearance(id, 'altitude', { value: '' }, { by: 'cd' }).ok, true);
  assert.equal(hasNoClearance(fd()), true, 'an ACTIVE entry with an empty value is no clearance');
  assert.equal(store.setClearance(id, 'heading', { value: '090' }, { by: 'cd' }).ok, true);
  assert.equal(hasNoClearance(fd()), false);
  assert.equal(store.setClearance(id, 'heading', { value: '  ' }, { by: 'cd' }).ok, true);
  assert.equal(hasNoClearance(fd()), true);
  // The clearing is still recorded (append-only history): the cell keeps the superseded value.
  assert.deepEqual(fd().clearance.altitude.entries.map(e => [e.value, e.status]), [['FL180', 'SUPERSEDED'], ['', 'ACTIVE']]);
});
