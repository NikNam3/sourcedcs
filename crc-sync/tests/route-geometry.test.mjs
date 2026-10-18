import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// docs/adr/0128 §5 (H151 MT-Q6 c, H152): "filed through" from the filed route's geometry only: DCS nav points, airport
// ICAOs and our ROUTE fixes; fewer than two resolved points is not filed through (no name fallback).

const require = createRequire(import.meta.url);
const rg = require('../src/efsp/airspace/route-geometry.js');

const MOA = { airspaceId: 'MOA-1', kind: 'AREA', type: 'MOA', altLowerFt: 10000, altUpperFt: 24000,
  geometry: { source: 'POLYGON', points: [[36.0, 35.0], [36.0, 36.0], [37.0, 36.0], [37.0, 35.0]] } };
const MISSION = {
  waypoints: [{ name: 'west1', lat: 36.5, lon: 34.0 }, { name: 'EAST1', lat: 36.5, lon: 37.0 }, { name: 'NORTH', lat: 38.0, lon: 35.5 }],
  airports: [{ icao: 'LTAG', lat: 37.0, lon: 35.4 }, { icao: 'LCRA', lat: 34.6, lon: 32.9 }, { icao: null, lat: 0, lon: 0 }],
};
const ROUTE = { definition: { kind: 'ROUTE', segments: [{ fix: { name: 'KEMER', lat: 35.5, lon: 35.5 } }, { fix: { name: 'ERGEP', lat: 38.0, lon: 36.5 } }] } };
const index = rg.buildPointIndex(MISSION, [ROUTE, { definition: MOA }]);
const fd = (filed, alt) => ({ filed, clearance: { altitude: { entries: alt == null ? [] : [{ status: 'ACTIVE', ...alt }] } } });

test('a token: DCT and empty are skipped, a /suffix is dropped, case is ignored', () => {
  assert.equal(rg.tokenName('DCT'), null);
  assert.equal(rg.tokenName(''), null);
  assert.equal(rg.tokenName('ERGEP/D1+00'), 'ERGEP');
  assert.equal(rg.tokenName('kemer'), 'KEMER');
});

test('lookup order: nav point, airport ICAO, ROUTE fix; the filed ends try the ICAO first', () => {
  assert.deepEqual(rg.resolvePoint('WEST1', index), { name: 'WEST1', lat: 36.5, lon: 34.0 });
  assert.deepEqual(rg.resolvePoint('ltag', index), { name: 'LTAG', lat: 37.0, lon: 35.4 });
  assert.deepEqual(rg.resolvePoint('KEMER', index), { name: 'KEMER', lat: 35.5, lon: 35.5 });
  assert.equal(rg.resolvePoint('MANAZ', index), null, 'no fix table (H152)');
  const pts = rg.routePoints(fd({ departureAirport: 'LCRA', route: 'DCT WEST1 DCT MANAZ EAST1/N0450F200', destinationAirport: 'LTAG' }), index);
  assert.deepEqual(pts.map(p => p.name), ['LCRA', 'WEST1', 'EAST1', 'LTAG']);
});

test('a nav-point leg across the MOA is filed through; one beside it is not', () => {
  assert.equal(rg.filedThrough(fd({ route: 'WEST1 DCT EAST1' }), MOA, index), true);
  assert.equal(rg.filedThrough(fd({ route: 'NORTH WEST1' }), MOA, index), false, 'the leg stays north-west of it');
});

test('an airport ICAO end and a ROUTE fix make legs too', () => {
  assert.equal(rg.filedThrough(fd({ departureAirport: 'LTAG', route: 'DCT KEMER' }), MOA, index), true, 'LTAG is on the edge, KEMER south of it');
  assert.equal(rg.filedThrough(fd({ route: 'KEMER/D1+00 ERGEP' }), MOA, index), true, 'ROUTE fixes, with a /suffix');
});

test('unresolved: fewer than two points is never filed through, whatever the route names', () => {
  assert.equal(rg.filedThrough(fd({ route: 'MOA-1 DCT MANAZ' }), MOA, index), false);
  assert.equal(rg.filedThrough(fd({ route: 'WEST1' }), MOA, index), false);
  assert.equal(rg.filedThrough(fd({}), MOA, index), false);
});

test('altitude: the filed one, else the assigned one; outside the limits is not filed through; unknown is', () => {
  const across = { route: 'WEST1 EAST1' };
  assert.equal(rg.filedThrough(fd({ ...across, requestedAltitude: 'FL300' }), MOA, index), false, 'above FL240');
  assert.equal(rg.filedThrough(fd({ ...across, requestedAltitude: '080' }), MOA, index), false, 'below 10,000');
  assert.equal(rg.filedThrough(fd({ ...across, requestedAltitude: 'FL200' }), MOA, index), true);
  assert.equal(rg.filedThrough(fd(across, { parsed: 30000 }), MOA, index), false, 'the assigned altitude when nothing is filed');
  assert.equal(rg.filedThrough(fd(across, { parsed: null, block: { lowFt: 22000, highFt: 26000 } }), MOA, index), true, 'a block reaching in');
  assert.equal(rg.filedThrough(fd(across), MOA, index), true, 'unknown altitude');
  assert.equal(rg.filedThrough(fd({ ...across, requestedAltitude: 'VFR' }), MOA, index), true, 'unreadable filed altitude: unknown');
});

test('no polygon or not an AREA: not filed through', () => {
  assert.equal(rg.filedThrough(fd({ route: 'WEST1 EAST1' }), { ...MOA, geometry: null }, index), false);
  assert.equal(rg.filedThrough(fd({ route: 'WEST1 EAST1' }), { ...MOA, kind: 'ROUTE' }, index), false);
});

test('no mission data: only ROUTE fixes resolve', () => {
  const bare = rg.buildPointIndex(null, [ROUTE]);
  assert.equal(rg.filedThrough(fd({ route: 'WEST1 EAST1' }), MOA, bare), false);
  assert.equal(rg.filedThrough(fd({ route: 'KEMER ERGEP' }), MOA, bare), true);
});
