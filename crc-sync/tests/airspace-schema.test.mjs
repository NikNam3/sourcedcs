import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const s = require('../src/efsp/airspace-schema.js');
import { MOA, RANGE, SQUARE } from './helpers/airspace-registry.mjs';

const ok = (d, ctx) => s.validateAirspaceDefinition(d, ctx);
const bad = (d, re, ctx) => { const r = ok(d, ctx); assert.equal(r.ok, false, JSON.stringify(d)); assert.equal(r.reason, 'VALIDATION_ERROR'); assert.match(r.detail, re); };

const ROUTE = {
  airspaceId: 'IR-100', name: 'IR 100', kind: 'ROUTE', type: 'IR', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', defaultWidthNm: 8,
  segments: [
    { fix: { name: 'A', lat: 36, lon: 35 }, altLowerFt: 500, altUpperFt: 1500 },
    { fix: { name: 'B', lat: 36, lon: 36 }, altLowerFt: 1000, altUpperFt: 4000, widthNm: 4 },
    { fix: { name: 'C', lat: 37, lon: 36 } },
  ],
};

test('a normal AREA validates and comes back normalised (every optional field present, kind defaulting to AREA)', () => {
  const r = ok(MOA);
  assert.equal(r.ok, true);
  assert.equal(r.definition.kind, 'AREA');
  assert.equal(r.definition.geometry, null);
  assert.equal(r.definition.usingFacilityId, null);
});

test('airspaceId, name, kind and type rules', () => {
  bad({ ...MOA, airspaceId: 'a' }, /airspaceId/);
  bad({ ...MOA, airspaceId: 'lower-case' }, /airspaceId/);
  bad({ ...MOA, airspaceId: 'X'.repeat(25) }, /airspaceId/);
  bad({ ...MOA, name: '' }, /name/);
  bad({ ...MOA, name: 'N'.repeat(41) }, /name/);
  bad({ ...MOA, name: ' padded' }, /name/);
  bad({ ...MOA, kind: 'VOLUME' }, /kind/);
  bad({ ...MOA, type: 'IR' }, /AREA type/);
  bad({ ...ROUTE, type: 'MOA' }, /ROUTE type/);
  bad({ ...MOA, colour: 'red' }, /no field colour/);
});

test('`type` is a label: RESTRICTED and MOA validate identically and nothing else in the definition changes (D14)', () => {
  const a = ok({ ...MOA, type: 'MOA' }).definition;
  const b = ok({ ...MOA, type: 'RESTRICTED' }).definition;
  assert.deepEqual({ ...a, type: null }, { ...b, type: null });
});

test('at most one using agency', () => {
  bad({ ...MOA, usingPositionId: 'RANGE_1_CONTROL', usingFacilityId: 'TACTICAL' }, /at most one using agency/);
  assert.equal(ok({ ...MOA, usingFacilityId: 'TACTICAL' }).ok, true);
  assert.equal(ok({ ...RANGE }).ok, true);
});

test('frequencies and altitudes keep their old bounds; an upper at or below the lower is refused', () => {
  bad({ ...MOA, workingFrequencyMhz: '134.25' }, /workingFrequencyMhz/);
  bad({ ...MOA, controlFrequencyMhz: 1e9 }, /controlFrequencyMhz/);
  bad({ ...MOA, altLowerFt: -1 }, /altLowerFt/);
  bad({ ...MOA, altUpperFt: 100001 }, /altUpperFt/);
  bad({ ...MOA, altLowerFt: 5000, altUpperFt: 5000 }, /above its altLowerFt/);
  assert.equal(ok({ ...MOA, altLowerFt: null, altUpperFt: 20000 }).ok, true);
});

test('AREA geometry: polygon rules (3..200 points, not closed, no self-intersection, ranges)', () => {
  assert.equal(ok({ ...MOA, geometry: SQUARE }).ok, true);
  bad({ ...MOA, geometry: { source: 'POLYGON', points: [[0, 0], [1, 1]] } }, /at least 3/);
  const many = Array.from({ length: 201 }, (_, i) => [30 + Math.sin(i / 32) * 0.1, 30 + Math.cos(i / 32) * 0.1]);
  bad({ ...MOA, geometry: { source: 'POLYGON', points: many } }, /more than 200/);
  bad({ ...MOA, geometry: { source: 'POLYGON', points: [...SQUARE.points, SQUARE.points[0]] } }, /repeat its first point/);
  bad({ ...MOA, geometry: { source: 'POLYGON', points: [[0, 0], [1, 1], [1, 0], [0, 1]] } }, /crosses itself/);
  bad({ ...MOA, geometry: { source: 'POLYGON', points: [[91, 0], [1, 1], [1, 0]] } }, /decimal degrees/);
  bad({ ...MOA, geometry: { source: 'KML', points: SQUARE.points } }, /POLYGON or DCS_DRAWING/);
  bad({ ...MOA, geometry: { ...SQUARE, extra: 1 } }, /no extra/);
});

test('a DCS_DRAWING geometry carries its provenance and its copied points', () => {
  const g = { source: 'DCS_DRAWING', drawingRef: { layerName: 'Airspace', objectName: 'MOA East', missionFingerprint: 'Syria:ab12' }, points: SQUARE.points };
  assert.equal(ok({ ...MOA, geometry: g }).ok, true);
  bad({ ...MOA, geometry: { ...g, drawingRef: { layerName: 'Airspace' } } }, /drawingRef/);
  bad({ ...MOA, geometry: { ...g, points: undefined } }, /at least 3/);
});

test('a null geometry is allowed (containment answers unknown)', () => {
  assert.equal(ok({ ...MOA, geometry: null }).ok, true);
});

test('ROUTE: segments, widths, the exit fix, the default width', () => {
  assert.equal(ok(ROUTE).ok, true);
  bad({ ...ROUTE, segments: [ROUTE.segments[0]] }, /at least 2 segments/);
  bad({ ...ROUTE, defaultWidthNm: undefined }, /defaultWidthNm/);
  bad({ ...ROUTE, defaultWidthNm: 0 }, /defaultWidthNm/);
  bad({ ...ROUTE, segments: [ROUTE.segments[0], ROUTE.segments[1], { fix: ROUTE.segments[2].fix, altLowerFt: 1000 }] }, /exit fix only/);
  bad({ ...ROUTE, segments: [ROUTE.segments[0], ROUTE.segments[1], { fix: ROUTE.segments[2].fix, widthNm: 4 }] }, /exit fix only/);
  bad({ ...ROUTE, segments: [{ ...ROUTE.segments[0], altLowerFt: 2000, altUpperFt: 1000 }, ...ROUTE.segments.slice(1)] }, /segment 1 altUpperFt/);
  bad({ ...ROUTE, segments: [{ ...ROUTE.segments[0], widthNm: -1 }, ...ROUTE.segments.slice(1)] }, /widthNm/);
  bad({ ...ROUTE, segments: [{ fix: { name: 'A', lat: 99, lon: 0 } }, ...ROUTE.segments.slice(1)] }, /fix/);
  bad({ ...ROUTE, geometry: SQUARE }, /segments, not a geometry/);
  bad({ ...MOA, segments: ROUTE.segments }, /geometry, not segments/);
});

test('ROUTE: the envelope is derived (min of the lows, max of the highs) and a client may not send it', () => {
  const r = ok(ROUTE).definition;
  assert.equal(r.altLowerFt, 500);
  assert.equal(r.altUpperFt, 4000);
  bad({ ...ROUTE, altLowerFt: 0 }, /derived/);
  assert.equal(ok({ ...ROUTE, altLowerFt: 0, altUpperFt: 1 }, { derived: 'recompute' }).definition.altUpperFt, 4000, 'a stored or merged definition is recomputed');
  // a null low (surface) or null high (unbounded) makes the envelope open
  const open = ok({ ...ROUTE, segments: [{ ...ROUTE.segments[0], altLowerFt: null }, { ...ROUTE.segments[1], altUpperFt: null }, ROUTE.segments[2]] }).definition;
  assert.equal(open.altLowerFt, null);
  assert.equal(open.altUpperFt, null);
});

test('the standing list is theater-keyed; the pre-0098 array and a bad entry are start-up errors naming the theater and the id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airspace-standing-'));
  const file = path.join(dir, 'a.json');
  const load = (v) => { fs.writeFileSync(file, typeof v === 'string' ? v : JSON.stringify(v)); return s.loadStandingList({ paths: { read: file } }); };
  assert.deepEqual(load({}), {});
  assert.equal(load({ Syria: [MOA] }).Syria[0].airspaceId, 'MOA-1');
  assert.throws(() => load([]), /object keyed by theater/);
  assert.throws(() => load('not json'), /cannot read/);
  assert.throws(() => load({ Syria: [{ ...MOA, type: 'NOPE' }] }), /theater Syria, airspace MOA-1: .*type/);
  assert.throws(() => load({ Syria: [MOA, MOA] }), /Syria lists MOA-1 twice/);
  assert.throws(() => load({ Syria: 'x' }), /Syria must hold an array/);
  assert.throws(() => s.loadStandingList({ paths: { read: path.join(dir, 'missing.json') } }), /cannot read/);
});
