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
// crc-sync docs/adr/0125: a JURISDICTION area.
const jur = (extra = {}) => ({
  airspaceId: 'LTAG-CZ', name: 'LTAG CTR (control zone)', kind: 'JURISDICTION',
  controllingFacilityId: 'INCIRLIK', controllingPositionId: 'LC', ownerPositionIds: ['LC', 'GC'], airspaceClass: 'D',
  altLowerFt: null, altUpperFt: 3000, sourceText: 'AIP',
  geometry: { source: 'CIRCLE', centre: { lat: 37.003333, lon: 35.425 }, radiusNm: 5, cut: { from: [36.985, 35.323611], to: [37.075556, 35.476944] } },
  ...extra,
});
const hullCircle = { source: 'CIRCLE', centre: { hullId: 'CVN-72' }, radiusNm: 50 };
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
  'a JURISDICTION circle with a cut': [jur()],
  'a JURISDICTION polygon': [jur({ geometry: { source: 'POLYGON', points: square } })],
  'a JURISDICTION on a hull': [jur({ geometry: hullCircle })],
  'a JURISDICTION on a hull with a cut': [jur({ geometry: { ...hullCircle, cut: { from: [36, 35], to: [37, 36] } } })],
  'a JURISDICTION on a hull excluding something': [jur({ geometry: hullCircle, excludes: ['LTAG-RAPCON'] })],
  'a JURISDICTION with a type': [jur({ type: 'MOA' })],
  'a JURISDICTION with a frequency': [jur({ workingFrequencyMhz: 121.5 })],
  'a JURISDICTION with a using Facility': [jur({ usingFacilityId: 'TACTICAL' })],
  'a JURISDICTION with no class and no VFR service': [jur({ airspaceClass: undefined })],
  // crc-sync docs/adr/0143 (H166): the class is optional; an unclassified area names its VFR service.
  'an unclassified JURISDICTION with a VFR service': [jur({ airspaceClass: undefined, vfrService: 'IFR_SEPARATED' })],
  'an unclassified JURISDICTION with a null class': [jur({ airspaceClass: null, vfrService: 'ADVISORY' })],
  'a JURISDICTION with an unknown class': [jur({ airspaceClass: 'MTMA' })],
  'a JURISDICTION with an unknown VFR service': [jur({ vfrService: 'SEPARATED' })],
  'a Class D JURISDICTION naming its VFR service': [jur({ vfrService: 'ALL_SEPARATED' })],
  'a Class A JURISDICTION with a VFR service': [jur({ airspaceClass: 'A', vfrService: 'ADVISORY' })],
  'a Class G JURISDICTION with a VFR service': [jur({ airspaceClass: 'G', ownerPositionIds: [], vfrService: 'ADVISORY' })],
  'an unclassified JURISDICTION with no owners': [jur({ airspaceClass: undefined, vfrService: 'ADVISORY', ownerPositionIds: [] })],
  'an AREA with a VFR service': [area({ vfrService: 'ADVISORY' })],
  'a JURISDICTION of class G with owners': [jur({ airspaceClass: 'G' })],
  'a JURISDICTION of class G with no owners': [jur({ airspaceClass: 'G', ownerPositionIds: [] })],
  'a JURISDICTION with no owners': [jur({ ownerPositionIds: [] })],
  'a JURISDICTION with a repeated owner': [jur({ ownerPositionIds: ['LC', 'LC'] })],
  'a JURISDICTION excluding itself': [jur({ excludes: ['LTAG-CZ'] })],
  'a JURISDICTION excluding a bad id': [jur({ excludes: ['x'] })],
  'a JURISDICTION with no geometry': [jur({ geometry: null })],
  'a JURISDICTION with a drawing': [jur({ geometry: drawing })],
  'a JURISDICTION with segments': [jur({ segments: [] })],
  'a JURISDICTION with a long source text': [jur({ sourceText: 'x'.repeat(601) })],
  'a JURISDICTION with an inverted band': [jur({ altLowerFt: 5000, altUpperFt: 3000 })],
  'a circle of radius 0': [jur({ geometry: { source: 'CIRCLE', centre: { lat: 37, lon: 35 }, radiusNm: 0 } })],
  'a circle of radius 251': [jur({ geometry: { source: 'CIRCLE', centre: { lat: 37, lon: 35 }, radiusNm: 251 } })],
  'a circle with a bad centre': [jur({ geometry: { source: 'CIRCLE', centre: { lat: 37 }, radiusNm: 5 } })],
  'a circle with an unknown key': [jur({ geometry: { source: 'CIRCLE', centre: { lat: 37, lon: 35 }, radiusNm: 5, colour: 1 } })],
  'a circle with a one-point cut': [jur({ geometry: { source: 'CIRCLE', centre: { lat: 37, lon: 35 }, radiusNm: 5, cut: { from: [37, 35], to: [37, 35] } } })],
  'a circle with a malformed cut': [jur({ geometry: { source: 'CIRCLE', centre: { lat: 37, lon: 35 }, radiusNm: 5, cut: { from: [37, 35] } } })],
  'an AREA with an airspace class': [area({ airspaceClass: 'D' })],
  'an AREA with a circle': [area({ geometry: hullCircle })],
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
  assert.deepEqual(client.AIRSPACE_CLASSES, server.AIRSPACE_CLASSES);
  assert.deepEqual(client.VFR_SERVICES, server.VFR_SERVICES);
  assert.deepEqual(client.CLASS_VFR_SERVICE, server.CLASS_VFR_SERVICE);
  assert.deepEqual(client.JURISDICTION_ONLY_FIELDS, server.JURISDICTION_ONLY_FIELDS);
  assert.deepEqual(client.SOURCES, server.SOURCES);
  assert.deepEqual(client.DEFINITION_FIELDS, server.DEFINITION_FIELDS);
  assert.deepEqual(client.IMMUTABLE_FIELDS, server.IMMUTABLE_FIELDS);
  assert.deepEqual(client.DERIVED_ROUTE_FIELDS, server.DERIVED_ROUTE_FIELDS);
  assert.deepEqual(client.LIVE_EDITABLE_FIELDS, server.LIVE_EDITABLE_FIELDS);
  assert.deepEqual(client.OPTIONAL_FIELDS, server.OPTIONAL_FIELDS);
  assert.deepEqual(client.ACTIVATION_BY_KIND, server.ACTIVATION_BY_KIND);
  for (const k of ['MIN_ALTITUDE_FT', 'MAX_ALTITUDE_FT', 'MIN_FREQUENCY_MHZ', 'MAX_FREQUENCY_MHZ', 'MAX_NAME_LENGTH', 'MAX_ROUTE_SEGMENTS', 'MAX_WIDTH_NM', 'MAX_OWNER_POSITIONS', 'MAX_EXCLUDES', 'MAX_SOURCE_TEXT_LENGTH', 'MAX_RADIUS_NM']) {
    assert.equal(client[k], server[k], k);
  }
  assert.equal(client.MAX_POLYGON_VERTICES, containment.MAX_POLYGON_VERTICES);
});

test('vfrServiceOf agrees (crc-sync docs/adr/0143)', () => {
  const defs = [null, {}, ...['A', 'B', 'C', 'D', 'E', 'F', 'G', null].map(c => ({ airspaceClass: c })),
    { airspaceClass: null, vfrService: 'IFR_SEPARATED' }, { airspaceClass: 'D', vfrService: 'ALL_SEPARATED' }];
  for (const d of defs) assert.equal(client.vfrServiceOf(d), server.vfrServiceOf(d), JSON.stringify(d));
  assert.equal(server.vfrServiceOf({ airspaceClass: 'C' }), 'IFR_SEPARATED');
  assert.equal(server.vfrServiceOf({ airspaceClass: 'D' }), 'ADVISORY');
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
    hasHull: (id) => id === 'CVN-72',
    positionsOf: (id) => ({ INCIRLIK: ['OPS', 'AP'], CENTER: ['CTR'], TACTICAL: ['TAC_C2'], RANGES: ['RNG1'] }[id] || []),
    facilityOfPosition: (p) => ({ OPS: 'INCIRLIK', AP: 'INCIRLIK', CTR: 'CENTER', TAC_C2: 'TACTICAL', RNG1: 'RANGES' }[p] || null),
  };
  const defs = [
    area(), area({ controllingFacilityId: 'NOWHERE' }), area({ controllingPositionId: 'CTR' }),
    area({ usingFacilityId: 'TACTICAL' }), area({ usingFacilityId: 'INCIRLIK' }), area({ usingFacilityId: 'RANGES' }),
    area({ usingFacilityId: 'MARS' }), area({ usingPositionId: 'RNG1' }), area({ usingPositionId: 'AP' }), area({ usingPositionId: 'NEW1' }),
    jur({ controllingPositionId: 'AP', ownerPositionIds: ['AP'] }), jur({ controllingPositionId: 'AP', ownerPositionIds: ['AP', 'CTR'] }),
    jur({ controllingPositionId: 'AP', ownerPositionIds: ['AP'], geometry: hullCircle }),
    jur({ controllingPositionId: 'AP', ownerPositionIds: ['AP'], geometry: { ...hullCircle, centre: { hullId: 'CVN-99' } } }),
  ];
  for (const d of defs) assert.deepEqual(client.checkAirspaceReferences(d, lookup), checkReferences(d, lookup), JSON.stringify(d));
});
