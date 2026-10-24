import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flightsHeldOnFinal, finalPositionsOf } from '../src/efsp/final-position.js';
import { createFacilityConfig } from '../src/efsp/facility-config.js';

// docs/adr/0139 (H164 FT-Q8): which flights the final Position holds, by the Facility's final Bays, never by an id (ADR 0132,
// H160). Conformance (conformance.test.mjs) then checks nothing of their clearance.

function boards(stripsByFacility) {
  return (facilityId) => ({ getAll: () => stripsByFacility[facilityId] || [] });
}

test('the shipped Facilities: the Positions that own a final Bay are the final Positions', () => {
  const fc = createFacilityConfig();
  const all = new Map(fc.getFacilityIds().map(f => [f, [...finalPositionsOf(fc, f)].sort()]));
  // Ids belong in tests: Incirlik's PAR and the carrier's two lane controllers (their files' `view: 'final'` Bays).
  assert.deepEqual(all.get('INCIRLIK'), ['PAR']);
  assert.deepEqual(all.get('CARRIER'), ['CV_APP1', 'CV_APP2']);
  for (const [f, list] of all) if (f !== 'INCIRLIK' && f !== 'CARRIER') assert.deepEqual(list, [], `${f} has no final`);
});

test('a FINAL Strip on final owned by a final Position is held on the final; the missed approach and other owners are not', () => {
  const fc = createFacilityConfig();
  const strips = {
    INCIRLIK: [
      { stripId: 'a', flightDataId: 'fa', stripType: 'FINAL', state: 'ON_FINAL', ownerPositionId: 'PAR' },
      { stripId: 'b', flightDataId: 'fb', stripType: 'FINAL', state: 'BOLTER_WAVEOFF', ownerPositionId: 'PAR' }, // par-missed
      { stripId: 'c', flightDataId: 'fc', stripType: 'ARRIVAL', state: 'INBOUND', ownerPositionId: 'AP' },     // not yet handed
      { stripId: 'd', flightDataId: 'fd', stripType: 'FINAL', state: 'DROPPED', ownerPositionId: 'PAR' },
    ],
    CARRIER: [
      { stripId: 'e', flightDataId: 'fe', stripType: 'FINAL', state: 'BALL', ownerPositionId: 'CV_APP2' },
      { stripId: 'f', flightDataId: 'ff', stripType: 'MARSHAL', state: 'COMMENCED', ownerPositionId: 'CV_APP1' },
    ],
  };
  const held = flightsHeldOnFinal({ facilityConfig: fc, boardStoreFor: boards(strips) });
  assert.deepEqual([...held.keys()].sort(), ['fa', 'fe']);
  assert.equal(held.get('fa').facilityId, 'INCIRLIK');
  assert.equal(held.get('fa').strip.stripId, 'a');
  assert.equal(held.get('fe').positionId, 'CV_APP2');
});

test('N airfields (H160): twelve generated Facilities, each with its own final Position, each final found', () => {
  const N = 12;
  const ids = Array.from({ length: N }, (_, i) => `FIELD${i}`);
  const fc = {
    getFacilityIds: () => ids,
    getAllBays: (f) => [
      { bayId: `${f}-app`, positionId: `${f}_APP`, facilityId: f },
      { bayId: `${f}-final`, view: 'final', positionId: `${f}_FIN`, facilityId: f },
    ],
  };
  const strips = Object.fromEntries(ids.map(f => [f, [
    { stripId: `${f}-s`, flightDataId: `${f}-fd`, stripType: 'FINAL', state: 'ON_FINAL', ownerPositionId: `${f}_FIN` },
    // owned by the field's approach Position (a FINAL somewhere it should not be): not held by the final Position
    { stripId: `${f}-x`, flightDataId: `${f}-fx`, stripType: 'FINAL', state: 'ON_FINAL', ownerPositionId: `${f}_APP` },
  ]]));
  const held = flightsHeldOnFinal({ facilityConfig: fc, boardStoreFor: boards(strips) });
  assert.deepEqual([...held.keys()].sort(), ids.map(f => `${f}-fd`).sort());
});

test('a Facility whose Board cannot be read is skipped, never an error', () => {
  const fc = { getFacilityIds: () => ['A'], getAllBays: () => [{ bayId: 'f', view: 'final', positionId: 'P' }] };
  const held = flightsHeldOnFinal({ facilityConfig: fc, boardStoreFor: () => { throw new Error('no board'); } });
  assert.equal(held.size, 0);
});
