/* The client's airspace validator is a hand copy of crc-sync's (ARCH-D7, docs/adr/0098 §3, §5): one table of cases is run
   through both and the answers (ok, detail, the normalised definition) must be equal. A rule changed on one side shows
   up here as the named case that now disagrees. */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as client from '../app/public/js/panels/efsp/airspace-validate.js';

const require = createRequire(import.meta.url);
const server = require('../../crc-sync/src/efsp/airspace-schema.js');
const { checkReferences } = require('../../crc-sync/src/efsp/airspace-store.js');
const containment = require('../../crc-sync/src/efsp/airspace/containment.js');

const area = (extra = {}) => ({
  airspaceId: 'MOA-1', name: 'MOA One', kind: 'AREA', type: 'MOA',
  controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP',
  workingFrequencyMhz: 139.25, altLowerFt: 5000, altUpperFt: 23000, ...extra,
});
const square = [[36.0, 35.0], [36.0, 36.0], [37.0, 36.0], [37.0, 35.0]];
const bowtie = [[36.0, 35.0], [37.0, 36.0], [37.0, 35.0], [36.0, 36.0]];
const route = (extra = {}) => ({
  airspaceId: 'IR-100', name: 'IR 100', kind: 'ROUTE', type: 'IR',
  controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', defaultWidthNm: 4,
  segments: [
    { fix: { name: 'A', lat: 36, lon: 35 }, altLowerFt: 500, altUpperFt: 3000, widthNm: null },
    { fix: { name: 'B', lat: 36.5, lon: 35.5 }, altLowerFt: 1000, altUpperFt: 5000, widthNm: 6 },
    { fix: { name: 'C', lat: 37, lon: 36 }, altLowerFt: null, altUpperFt: null, widthNm: null },
  ], ...extra,
});
const drawing = { source: 'DCS_DRAWING', drawingRef: { layerName: 'L', objectName: 'O', missionFingerprint: 'abc' }, points: square };

const CASES = {
  'a plain AREA': [area()],
  'an AREA with a polygon': [area({ geometry: { source: 'POLYGON', points: square } })],
  'an AREA with a DCS drawing': [area({ geometry: drawing })],
  'a bowtie polygon crosses itself': [area({ geometry: { source: 'POLYGON', points: bowtie } })],
  'a polygon repeating its first point': [area({ geometry: { source: 'POLYGON', points: [...square, square[0]] } })],
  'a polygon with two points': [area({ geometry: { source: 'POLYGON', points: square.slice(0, 2) } })],
  'a polygon with a bad latitude': [area({ geometry: { source: 'POLYGON', points: [[91, 0], ...square.slice(1)] } })],
  'a polygon with 201 points': [area({ geometry: { source: 'POLYGON', points: Array.from({ length: 201 }, (_, i) => [10 + Math.sin(i / 32), 10 + Math.cos(i / 32)]) } })],
  'a drawing with no ref': [area({ geometry: { source: 'DCS_DRAWING', points: square } })],
  'a geometry of an unknown source': [area({ geometry: { source: 'CIRCLE', points: square } })],
  'a geometry that is an array': [area({ geometry: [] })],
  'no name': [area({ name: '' })],
  'a name with a trailing space': [area({ name: 'MOA ' })],
  'a name of 41 characters': [area({ name: 'X'.repeat(41) })],
  'a bad id': [area({ airspaceId: 'a' })],
  'an unknown field': [area({ colour: 'red' })],
  'an unknown kind': [area({ kind: 'VOLUME' })],
  'a ROUTE type on an AREA': [area({ type: 'IR' })],
  'an AREA type on a ROUTE': [route({ type: 'MOA' })],
  'no controlling Facility': [area({ controllingFacilityId: undefined })],
  'no controlling Position': [area({ controllingPositionId: '' })],
  'both using agencies': [area({ usingPositionId: 'RNG1', usingFacilityId: 'TACTICAL' })],
  'a using Facility': [area({ usingFacilityId: 'TACTICAL' })],
  'a using Position': [area({ usingPositionId: 'RNG1' })],
  'a working frequency of 29 MHz': [area({ workingFrequencyMhz: 29 })],
  'a control frequency of 401 MHz': [area({ controlFrequencyMhz: 401 })],
  'a frequency with 3 decimals': [area({ workingFrequencyMhz: 251.525 })],
  'a frequency that is a string': [area({ workingFrequencyMhz: '139.25' })],
  'an upper limit below the lower': [area({ altLowerFt: 23000, altUpperFt: 5000 })],
  'an upper limit equal to the lower': [area({ altLowerFt: 5000, altUpperFt: 5000 })],
  'a fractional altitude': [area({ altLowerFt: 5000.5 })],
  'an altitude of 100001': [area({ altUpperFt: 100001 })],
  'no altitudes at all': [area({ altLowerFt: null, altUpperFt: null })],
  'a bad source': [area({ source: 'HAND' })],
  'an AREA with segments': [area({ segments: [] })],
  'a valid ROUTE': [route()],
  'a ROUTE carrying altitudes (refuse)': [route({ altLowerFt: 500 })],
  'a ROUTE carrying altitudes (recompute)': [route({ altLowerFt: 500 }), { derived: 'recompute' }],
  'a ROUTE with a geometry': [route({ geometry: { source: 'POLYGON', points: square } })],
  'a ROUTE with one segment': [route({ segments: route().segments.slice(0, 1) })],
  'a ROUTE with no default width': [route({ defaultWidthNm: undefined })],
  'a ROUTE with a width of 101': [route({ defaultWidthNm: 101 })],
  'a ROUTE leg with width 0': [route({ segments: route().segments.map((s, i) => (i === 0 ? { ...s, widthNm: 0 } : s)) })],
  'a ROUTE whose exit fix has altitudes': [route({ segments: route().segments.map((s, i) => (i === 2 ? { ...s, altUpperFt: 9000 } : s)) })],
  'a ROUTE leg with an inverted band': [route({ segments: route().segments.map((s, i) => (i === 0 ? { ...s, altLowerFt: 9000 } : s)) })],
  'a ROUTE fix with a bad longitude': [route({ segments: route().segments.map((s, i) => (i === 1 ? { ...s, fix: { name: 'B', lat: 1, lon: 181 } } : s)) })],
  'a ROUTE leg with an unknown key': [route({ segments: route().segments.map((s, i) => (i === 0 ? { ...s, note: 1 } : s)) })],
  'a ROUTE with a surface leg (open envelope)': [route({ segments: route().segments.map((s, i) => (i === 0 ? { ...s, altLowerFt: null } : s)) })],
  'not an object': [null],
  'an array': [[]],
};

for (const [name, args] of Object.entries(CASES)) {
  test(`validator parity: ${name}`, () => {
    assert.deepEqual(client.validateAirspaceDefinition(...args), server.validateAirspaceDefinition(...args));
  });
}

test('the constants the client copies are the server\'s', () => {
  assert.deepEqual(client.AREA_TYPES, [...server.AREA_TYPES]);
  assert.deepEqual(client.ROUTE_TYPES, [...server.ROUTE_TYPES]);
  assert.deepEqual(client.KINDS, server.KINDS);
  assert.deepEqual(client.SOURCES, server.SOURCES);
  assert.deepEqual(client.DEFINITION_FIELDS, server.DEFINITION_FIELDS);
  assert.deepEqual(client.IMMUTABLE_FIELDS, server.IMMUTABLE_FIELDS);
  assert.deepEqual(client.DERIVED_ROUTE_FIELDS, server.DERIVED_ROUTE_FIELDS);
  assert.deepEqual(client.LIVE_EDITABLE_FIELDS, server.LIVE_EDITABLE_FIELDS);
  assert.deepEqual(client.OPTIONAL_FIELDS, server.OPTIONAL_FIELDS);
  assert.deepEqual(client.ACTIVATION_BY_KIND, server.ACTIVATION_BY_KIND);
  for (const k of ['MIN_ALTITUDE_FT', 'MAX_ALTITUDE_FT', 'MIN_FREQUENCY_MHZ', 'MAX_FREQUENCY_MHZ', 'MAX_NAME_LENGTH', 'MAX_ROUTE_SEGMENTS', 'MAX_WIDTH_NM']) {
    assert.equal(client[k], server[k], k);
  }
  assert.equal(client.MAX_POLYGON_VERTICES, containment.MAX_POLYGON_VERTICES);
});

test('polygonSelfIntersects agrees on a spread of shapes', () => {
  const shapes = [square, bowtie, [[0, 0], [0, 2], [2, 2], [2, 0], [1, 1]], [[0, 0], [1, 1], [2, 2], [0, 2]], [[0, 0], [0, 1], [0, 2]]];
  for (const s of shapes) assert.equal(client.polygonSelfIntersects(s), containment.polygonSelfIntersects(s), JSON.stringify(s));
});

test('deriveRouteEnvelope agrees', () => {
  assert.deepEqual(client.deriveRouteEnvelope(route().segments), server.deriveRouteEnvelope(route().segments));
});

test('the reference check agrees', () => {
  const lookup = {
    hasFacility: (id) => ['INCIRLIK', 'CENTER', 'TACTICAL', 'RANGES'].includes(id),
    positionsOf: (id) => ({ INCIRLIK: ['OPS', 'AP'], CENTER: ['CTR'], TACTICAL: ['TAC_C2'], RANGES: ['RNG1'] }[id] || []),
    facilityOfPosition: (p) => ({ OPS: 'INCIRLIK', AP: 'INCIRLIK', CTR: 'CENTER', TAC_C2: 'TACTICAL', RNG1: 'RANGES' }[p] || null),
  };
  const defs = [
    area(), area({ controllingFacilityId: 'NOWHERE' }), area({ controllingPositionId: 'CTR' }),
    area({ usingFacilityId: 'TACTICAL' }), area({ usingFacilityId: 'INCIRLIK' }), area({ usingFacilityId: 'RANGES' }),
    area({ usingFacilityId: 'MARS' }), area({ usingPositionId: 'RNG1' }), area({ usingPositionId: 'AP' }), area({ usingPositionId: 'NEW1' }),
  ];
  for (const d of defs) assert.deepEqual(client.checkAirspaceReferences(d, lookup), checkReferences(d, lookup), JSON.stringify(d));
});
