import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const c = require('../src/efsp/airspace/containment.js');
const { indicatedAltFt } = require('../src/altimetry.js');
import { makeRegistry, SQUARE, MOA, THEATER } from './helpers/airspace-registry.mjs';

// A 1 deg x 1 deg box at 36-37N, 35-36E.
const BOX = { kind: 'AREA', geometry: SQUARE, altLowerFt: 5000, altUpperFt: 20000 };

test('polygon: inside, outside, a vertex and an edge count as inside', () => {
  assert.equal(c.evaluate(BOX, { lat: 36.5, lon: 35.5, altFt: 10000 }), 'inside');
  assert.equal(c.evaluate(BOX, { lat: 38.0, lon: 35.5, altFt: 10000 }), 'outside');
  assert.equal(c.evaluate(BOX, { lat: 36.0, lon: 35.0, altFt: 10000 }), 'inside', 'a vertex');
  assert.equal(c.evaluate(BOX, { lat: 36.0, lon: 35.5, altFt: 10000 }), 'inside', 'an edge');
  assert.equal(c.evaluate(BOX, { lat: 35.99, lon: 35.5, altFt: 10000 }), 'outside', 'just beyond the edge');
});

test('band edges are inclusive; a null bound is open; no altitude is outside a band', () => {
  assert.equal(c.evaluate(BOX, { lat: 36.5, lon: 35.5, altFt: 5000 }), 'inside');
  assert.equal(c.evaluate(BOX, { lat: 36.5, lon: 35.5, altFt: 20000 }), 'inside');
  assert.equal(c.evaluate(BOX, { lat: 36.5, lon: 35.5, altFt: 4999 }), 'outside');
  assert.equal(c.evaluate(BOX, { lat: 36.5, lon: 35.5, altFt: 20001 }), 'outside');
  assert.equal(c.evaluate({ ...BOX, altLowerFt: null, altUpperFt: null }, { lat: 36.5, lon: 35.5, altFt: 60000 }), 'inside');
  assert.equal(c.evaluate({ ...BOX, altLowerFt: null }, { lat: 36.5, lon: 35.5, altFt: 0 }), 'inside', 'null lower is the surface');
  assert.equal(c.evaluate(BOX, { lat: 36.5, lon: 35.5, altFt: undefined }), 'outside');
});

test('an AREA with no outline is unknown, never a guess', () => {
  assert.equal(c.evaluate({ kind: 'AREA', geometry: null }, { lat: 36.5, lon: 35.5, altFt: 100 }), 'unknown');
  assert.equal(c.evaluate({ kind: 'AREA', geometry: { source: 'POLYGON', points: [[0, 0], [1, 1]] } }, { lat: 0, lon: 0, altFt: 100 }), 'unknown');
});

// A route east along 36N from 35E to 36E, then north to 37N.
const ROUTE = {
  kind: 'ROUTE', defaultWidthNm: 10,
  segments: [
    { fix: { name: 'A', lat: 36, lon: 35 }, altLowerFt: 500, altUpperFt: 1500, widthNm: null },
    { fix: { name: 'B', lat: 36, lon: 36 }, altLowerFt: 1000, altUpperFt: 4000, widthNm: 4 },
    { fix: { name: 'C', lat: 37, lon: 36 }, altLowerFt: null, altUpperFt: null, widthNm: null },
  ],
};

test('route: within half the default width of a leg, in that leg\'s own band', () => {
  assert.equal(c.evaluate(ROUTE, { lat: 36, lon: 35.5, altFt: 1000 }), 'inside', 'on the centreline');
  assert.equal(c.evaluate(ROUTE, { lat: 36 + 4 / 60, lon: 35.5, altFt: 1000 }), 'inside', '4 NM off: inside the 5 NM half-width');
  assert.equal(c.evaluate(ROUTE, { lat: 36 + 6 / 60, lon: 35.5, altFt: 1000 }), 'outside', '6 NM off: beyond it');
  assert.equal(c.evaluate(ROUTE, { lat: 36, lon: 35.5, altFt: 1501 }), 'outside', 'above leg 1\'s band');
  assert.equal(c.evaluate(ROUTE, { lat: 36, lon: 35.5, altFt: 499 }), 'outside', 'below leg 1\'s band');
});

test('route: a leg\'s own width wins over the default, and each leg has its own band', () => {
  // leg 2 (B to C) is 4 NM wide: 3 NM off is outside its 2 NM half-width, 1.5 NM off is inside.
  const lonAt = (nm) => 36 + nm / (60 * Math.cos((36.5 * Math.PI) / 180));
  assert.equal(c.evaluate(ROUTE, { lat: 36.5, lon: lonAt(1.5), altFt: 3000 }), 'inside');
  assert.equal(c.evaluate(ROUTE, { lat: 36.5, lon: lonAt(3), altFt: 3000 }), 'outside');
  assert.equal(c.evaluate(ROUTE, { lat: 36.5, lon: 36, altFt: 800 }), 'outside', 'leg 2 starts at 1000 ft');
  assert.equal(c.evaluate(ROUTE, { lat: 36.5, lon: 36, altFt: 4000 }), 'inside');
});

test('route: the exit fix is a point, not a leg', () => {
  assert.equal(c.evaluate(ROUTE, { lat: 37.5, lon: 36, altFt: 3000 }), 'outside', 'beyond the exit fix');
  assert.equal(c.evaluate({ kind: 'ROUTE', segments: [] }, { lat: 0, lon: 0, altFt: 0 }), 'unknown');
});

test('polygon self-intersection is detected, a simple concave ring is not', () => {
  assert.equal(c.polygonSelfIntersects([[0, 0], [1, 1], [1, 0], [0, 1]]), true, 'a bow tie');
  assert.equal(c.polygonSelfIntersects([[0, 0], [0, 2], [1, 1], [2, 2], [2, 0]]), false, 'a concave "M"');
});

// ── the store's queries (ADR 0098 §7) ────────────────────────────────────

// Schedule (CTR, the controlling Position), request (TAC_C2, the using Facility's `airspaceUse`), approve (CTR).
const act = (store, id, ops) => {
  for (const op of ops) {
    const who = op.kind === 'RequestActivation' ? 'TAC_C2' : 'CTR';
    const rec = store.getAirspace(id);
    const r = store.apply({ airspaceId: id, baseRev: rec.rev, op }, { positionId: who, controllerId: 'c', via: 'PANEL' });
    assert.equal(r.ok, true, JSON.stringify(r));
  }
};
const WINDOW = { fromUtc: 1, toUtc: 2 };
const AREA = (extra) => ({ ...MOA, airspaceId: 'MRU-AREA', name: 'MRU area', usingFacilityId: 'TACTICAL', altLowerFt: 10000, altUpperFt: 30000, geometry: SQUARE, ...extra });

test('activeContaining: only ACTIVE airspaces, only for the asking using Facility, inside or unknown', () => {
  const { store } = makeRegistry({ defs: [AREA(), AREA({ airspaceId: 'NO-SHAPE', name: 'No shape', geometry: null }), AREA({ airspaceId: 'OTHER-F', name: 'Other', usingFacilityId: 'CARRIER' })] });
  const at = { lat: 36.5, lon: 35.5, altFt: 20000 };
  assert.deepEqual(store.activeContaining(at, { usingFacilityId: 'TACTICAL' }), { inside: [], unknown: [] }, 'RETURNED is not active');
  for (const id of ['MRU-AREA', 'NO-SHAPE']) act(store, id, [{ kind: 'ScheduleAirspace', ...WINDOW }, { kind: 'RequestActivation' }, { kind: 'ApproveActivation' }]);
  const r = store.activeContaining(at, { usingFacilityId: 'TACTICAL' });
  assert.deepEqual(r.inside.map(x => x.airspaceId), ['MRU-AREA']);
  assert.deepEqual(r.unknown.map(x => x.airspaceId), ['NO-SHAPE']);
  assert.deepEqual(r.inside[0], { airspaceId: 'MRU-AREA', kind: 'AREA', name: 'MRU area' });
  assert.deepEqual(store.activeContaining({ ...at, altFt: 9999 }, { usingFacilityId: 'TACTICAL' }).inside, []);
  assert.deepEqual(store.activeContaining(at, { usingFacilityId: 'CARRIER' }), { inside: [], unknown: [] }, 'another using Facility');
});

test('activeAreasContaining (docs/adr/0119): every ACTIVE area the point is in, whoever uses it, with its type and controlling Position', () => {
  const { store } = makeRegistry({ defs: [AREA(), AREA({ airspaceId: 'NO-SHAPE', name: 'No shape', geometry: null }), AREA({ airspaceId: 'COLD', name: 'Cold' })] });
  const at = { lat: 36.5, lon: 35.5, altFt: 20000 };
  assert.deepEqual(store.activeAreasContaining(at), [], 'RETURNED is not active');
  for (const id of ['MRU-AREA', 'NO-SHAPE']) act(store, id, [{ kind: 'ScheduleAirspace', ...WINDOW }, { kind: 'RequestActivation' }, { kind: 'ApproveActivation' }]);
  const inside = store.activeAreasContaining(at);
  assert.deepEqual(inside.map(x => x.airspaceId), ['MRU-AREA'], 'unknown geometry is never a guess, COLD is not active');
  const row = inside.find(x => x.airspaceId === 'MRU-AREA');
  assert.equal(row.type, 'MOA');
  assert.equal(row.controllingPositionId, MOA.controllingPositionId);
  assert.equal(row.usingFacilityId, 'TACTICAL');
  assert.deepEqual(store.activeAreasContaining({ ...at, altFt: 9999 }), []);
});

test('isActiveFor: usingFacilityId, or a usingPositionId belonging to the Facility', () => {
  const { store } = makeRegistry({ defs: [AREA(), { ...MOA, airspaceId: 'RANGE-X', name: 'Range X', type: 'RANGE', usingPositionId: 'RANGE_1_CONTROL' }] });
  assert.equal(store.isActiveFor('MRU-AREA', 'TACTICAL'), false, 'RETURNED');
  act(store, 'MRU-AREA', [{ kind: 'ScheduleAirspace', ...WINDOW }, { kind: 'RequestActivation' }, { kind: 'ApproveActivation' }]);
  assert.equal(store.isActiveFor('MRU-AREA', 'TACTICAL'), true);
  assert.equal(store.isActiveFor('MRU-AREA', 'CARRIER'), false);
  assert.equal(store.isActiveFor('NOPE', 'TACTICAL'), false);
  // a usingPositionId is a Position of RANGES
  store.apply({ airspaceId: 'RANGE-X', op: { kind: 'ScheduleAirspace', ...WINDOW } }, { positionId: 'CTR', controllerId: 'c', via: 'PANEL' });
  const rec = store.getAirspace('RANGE-X');
  store.apply({ airspaceId: 'RANGE-X', baseRev: rec.rev, op: { kind: 'RequestActivation' } }, { positionId: 'RANGE_1_CONTROL', controllerId: 'r', via: 'PANEL' });
  const rec2 = store.getAirspace('RANGE-X');
  store.apply({ airspaceId: 'RANGE-X', baseRev: rec2.rev, op: { kind: 'ApproveActivation' } }, { positionId: 'CTR', controllerId: 'c', via: 'PANEL' });
  assert.equal(store.isActiveFor('RANGE-X', 'RANGES'), true);
  assert.equal(store.isActiveFor('RANGE-X', 'TACTICAL'), false);
});

test('containing: any state, current theater only', () => {
  const { store, state } = makeRegistry({ defs: [AREA()] });
  const at = { lat: 36.5, lon: 35.5, altFt: 20000 };
  assert.deepEqual(store.containing(at), [{ airspaceId: 'MRU-AREA', kind: 'AREA', name: 'MRU area', state: 'RETURNED' }]);
  state.theater = 'Other';
  assert.deepEqual(store.containing(at), []);
  state.theater = null;
  assert.deepEqual(store.containing(at), []);
  assert.deepEqual(store.activeContaining(at, { usingFacilityId: 'TACTICAL' }), { inside: [], unknown: [] });
  assert.equal(THEATER, 'Test');
});

test('the altitude basis is INDICATED feet: the same airframe is in or out of a block as the transition altitude moves its reference', () => {
  // Low sea-level pressure (990 hPa) so QNH and standard differ by several hundred feet.
  const weather = { pressurePa: 99000, tempK: 288.15 };
  const trueAltM = 5400; // ~17,700 ft true
  const underQnh = indicatedAltFt(trueAltM, weather, 18000);      // below transition: reads QNH
  const underStd = indicatedAltFt(trueAltM, weather, 10000);      // at or above transition: reads standard
  assert.notEqual(Math.round(underQnh), Math.round(underStd));
  // A block FL180-FL230 is stored as 18000-23000 (§6).
  const block = { kind: 'AREA', geometry: SQUARE, altLowerFt: 18000, altUpperFt: 23000 };
  const there = (altFt) => c.evaluate(block, { lat: 36.5, lon: 35.5, altFt });
  assert.equal(there(underQnh), underQnh >= 18000 ? 'inside' : 'outside');
  assert.equal(there(underStd), underStd >= 18000 ? 'inside' : 'outside');
  assert.notEqual(there(underQnh), there(underStd), 'the two bases put one aircraft on different sides of the floor');
});
