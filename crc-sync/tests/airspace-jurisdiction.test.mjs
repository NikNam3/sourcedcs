// JURISDICTION areas (docs/adr/0125, decisions H142-H146): the schema, the shipped Syria areas, `jurisdictionAt` at its
// edges (boundary, floor, ceiling, the control zone's cut, the carrier's precedence, a moving hull, Class G) and the
// registry's refusals (no overlap between static areas, the edit rights, no state ops).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const schema = require('../src/efsp/airspace-schema.js');
const j = require('../src/efsp/airspace/jurisdiction.js');
const { AirspaceStore } = require('../src/efsp/airspace-store.js');
const authority = require('../src/efsp/authority');

const SHIPPED = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'config', 'efsp-airspaces.json');
const SYRIA = schema.loadStandingList({ paths: { read: SHIPPED } }).Syria;
const byId = (id) => SYRIA.find(d => d.airspaceId === id);
const CZ = byId('LTAG-CZ'); const RAPCON = byId('LTAG-RAPCON'); const CCA = byId('CVN-72-CCA');

const FACILITIES = {
  INCIRLIK: ['OPS', 'CD', 'GC', 'LC', 'AP', 'PAR'],
  CENTER: ['CTR'],
  TACTICAL: ['TAC_C2', 'AIC', 'GCI', 'JTAC'],
  CARRIER: ['CV_MARSHAL', 'CV_PRIFLY', 'CV_APP1', 'CV_APP2'],
};
const lookup = {
  hasFacility: (id) => id in FACILITIES,
  positionsOf: (id) => FACILITIES[id] || [],
  facilityOfPosition: (p) => Object.keys(FACILITIES).find(f => FACILITIES[f].includes(p)) || null,
  hasHull: (id) => id === 'CVN-72',
};
const rowOf = (id) => authority.airspaceAuthority.rowFor(id, { familyRows: authority.AIRSPACE_ROWS, classOf: () => null });

function registry({ defs = SYRIA, ship = { lat: 36.3, lon: 34.6, found: true } } = {}) {
  const state = { ship };
  const store = new AirspaceStore({
    currentTheater: () => 'Syria', facilityLookup: lookup, authority: { rowOf },
    hullPosition: (hullId) => (hullId === 'CVN-72' ? state.ship : null),
  });
  const r = store.apply({ op: { kind: 'ImportAirspaces', theater: 'Syria', source: 'STANDING', definitions: defs } },
    { service: 'SEED', via: 'SEED', controllerId: 'system', positionId: null });
  if (!r.ok) throw new Error(r.detail);
  return { store, state };
}
const panel = (positionId) => ({ positionId, controllerId: 'c1', via: 'PANEL' });
const edit = (store, id, patch, positionId) => store.apply({ airspaceId: id, baseDefRev: store.getAirspace(id).defRev, op: { kind: 'EditAirspace', patch } }, panel(positionId));

// A point `nm` from (lat0, lon0) on a bearing (degrees true), in the module's own local projection.
function offset([lat0, lon0], nm, bearingDeg) {
  const t = (bearingDeg * Math.PI) / 180;
  return { lat: lat0 + (nm * Math.cos(t)) / 60, lon: lon0 + (nm * Math.sin(t)) / (60 * Math.cos((lat0 * Math.PI) / 180)) };
}
const CZ_C = [37.003333, 35.425]; const RAPCON_C = [36.998889, 35.433056];
const FIELD = { lat: 37.0019, lon: 35.4258 };

// ── the shipped areas ───────────────────────────────────────────────────────────────────────────

test('the shipped Syria areas load: the control zone, RAPCON excluding it, and the carrier circle on CVN-72', () => {
  assert.deepEqual(SYRIA.map(d => d.airspaceId).sort(), ['CVN-72-CCA', 'LTAG-CZ', 'LTAG-RAPCON']);
  assert.equal(CZ.name, 'LTAG CTR (control zone)', 'never a bare "CTR" (H145)');
  assert.deepEqual(CZ.ownerPositionIds, ['LC', 'GC']);
  assert.equal(CZ.altUpperFt, 3000);
  assert.match(CZ.sourceText, /Circle radius 5 NM centered on 370012N-0352530E/);
  assert.deepEqual(RAPCON.excludes, ['LTAG-CZ']);
  assert.deepEqual([RAPCON.altLowerFt, RAPCON.altUpperFt], [null, 28000]);
  assert.deepEqual(CCA.geometry.centre, { hullId: 'CVN-72' });
  assert.deepEqual([CCA.altLowerFt, CCA.altUpperFt], [null, null]);
  assert.equal(j.checkTheater(SYRIA), null);
});

test('the control zone chord: both end points are on the 5 nm circle and the field is on the kept side', () => {
  const [lat0, lon0] = CZ_C; const k = Math.cos((lat0 * Math.PI) / 180);
  for (const p of [CZ.geometry.cut.from, CZ.geometry.cut.to]) {
    const d = Math.hypot((p[1] - lon0) * k * 60, (p[0] - lat0) * 60);
    assert.ok(Math.abs(d - 5) < 0.05, `end point ${p} is ${d.toFixed(3)} nm from the centre`);
  }
  assert.ok(j.insideShape(CZ.geometry, [FIELD.lat, FIELD.lon]));
  assert.ok(j.insideShape(CZ.geometry, CZ_C), 'the centre is kept (the chord is 2.0 nm north west of it)');
  const nw = offset(CZ_C, 3, 315);
  assert.equal(j.insideShape(CZ.geometry, [nw.lat, nw.lon]), false, '3 nm north west is cut off');
});

// ── jurisdictionAt ──────────────────────────────────────────────────────────────────────────────

test('the field below 3,000 ft is the tower\'s (LC, GC); above it RAPCON\'s; above FL280 CENTER\'s', () => {
  const { store } = registry();
  const at = (altFt) => store.jurisdictionAt({ ...FIELD, altFt });
  assert.equal(at(500).airspaceId, 'LTAG-CZ');
  assert.deepEqual(at(500).positionIds, ['LC', 'GC']);
  assert.equal(at(500).facilityId, 'INCIRLIK');
  assert.equal(at(3000).airspaceId, 'LTAG-CZ', 'the ceiling counts as inside');
  assert.equal(at(3001).airspaceId, 'LTAG-RAPCON', 'RAPCON starts above the tower\'s ceiling (H144)');
  assert.equal(at(28000).airspaceId, 'LTAG-RAPCON', 'FL280 is inside');
  const above = at(28001);
  assert.equal(above.fallback, true);
  assert.equal(above.airspaceId, null);
  assert.equal(above.facilityId, 'CENTER');
  assert.deepEqual(above.positionIds, ['CTR']);
  assert.equal(above.airspaceClass, 'E');
});

test('the boundary counts as inside: exactly 5 nm and exactly 50 nm', () => {
  const { store } = registry();
  const e5 = offset(CZ_C, 5, 135);
  assert.equal(store.jurisdictionAt({ ...e5, altFt: 1000 }).airspaceId, 'LTAG-CZ');
  const e51 = offset(CZ_C, 5.05, 135);
  assert.equal(store.jurisdictionAt({ ...e51, altFt: 1000 }).airspaceId, 'LTAG-RAPCON');
  const r50 = offset(RAPCON_C, 50, 90);
  assert.equal(store.jurisdictionAt({ ...r50, altFt: 10000 }).airspaceId, 'LTAG-RAPCON');
  const r501 = offset(RAPCON_C, 50.05, 90);
  assert.equal(store.jurisdictionAt({ ...r501, altFt: 10000 }).fallback, true);
});

test('the north-west part the control zone leaves out is RAPCON\'s down to the surface (H145)', () => {
  const { store } = registry();
  const nw = offset(CZ_C, 3, 315);
  assert.equal(store.jurisdictionAt({ ...nw, altFt: 0 }).airspaceId, 'LTAG-RAPCON');
  assert.equal(store.jurisdictionAt({ ...nw, altFt: 2500 }).airspaceId, 'LTAG-RAPCON');
});

test('the carrier circle wins over every other area and follows the moving hull', () => {
  const { store, state } = registry();
  state.ship = { lat: FIELD.lat, lon: FIELD.lon, found: true }; // the ship parked on the field, for the precedence only
  assert.equal(store.jurisdictionAt({ ...FIELD, altFt: 500 }).airspaceId, 'CVN-72-CCA');
  assert.equal(store.jurisdictionAt({ ...FIELD, altFt: 60000 }).airspaceId, 'CVN-72-CCA', 'SFC-UNL');
  state.ship = { lat: 35.5, lon: 34.0, found: true };
  assert.equal(store.jurisdictionAt({ ...FIELD, altFt: 500 }).airspaceId, 'LTAG-CZ', 'the ship sailed away');
  const near = offset([35.5, 34.0], 49.9, 270);
  assert.equal(store.jurisdictionAt({ ...near, altFt: 5000 }).airspaceId, 'CVN-72-CCA');
  state.ship = { lat: 35.5, lon: 34.4, found: true };
  assert.equal(store.jurisdictionAt({ ...near, altFt: 5000 }).fallback, true, 'the circle moved with the ship');
});

test('a hull that is not found has no circle', () => {
  const { store, state } = registry();
  state.ship = { lat: 35.5, lon: 34.0, found: false };
  assert.equal(store.jurisdictionAt({ lat: 35.5, lon: 34.0, altFt: 1000 }).fallback, true);
  state.ship = null;
  assert.equal(store.jurisdictionAt({ lat: 35.5, lon: 34.0, altFt: 1000 }).fallback, true);
});

test('Class G belongs to nobody, and a point that cannot be judged is nobody\'s (never a guess)', () => {
  const g = { airspaceId: 'G-1', name: 'Uncontrolled', kind: 'JURISDICTION', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR',
    ownerPositionIds: [], airspaceClass: 'G', altLowerFt: null, altUpperFt: 1000, geometry: { source: 'POLYGON', points: [[34, 37], [34, 38], [35, 38], [35, 37]] } };
  const { store } = registry({ defs: [...SYRIA, g] });
  assert.equal(store.jurisdictionAt({ lat: 34.5, lon: 37.5, altFt: 500 }), null);
  assert.equal(store.jurisdictionAt({ lat: 34.5, lon: 37.5, altFt: 1500 }).fallback, true);
  assert.equal(store.jurisdictionAt({ ...FIELD, altFt: undefined }), null);
  assert.equal(store.jurisdictionAt({ ...FIELD, altFt: NaN }), null);
  assert.equal(store.jurisdictionAt({}), null);
  assert.equal(store.isInsideJurisdictionOf('CTR', { lat: 34.5, lon: 37.5, altFt: 500 }), false);
});

test('isInsideJurisdictionOf: the receiving Position\'s area, CTR the fallback, a carrier circle for its Positions', () => {
  const { store, state } = registry();
  const field = { ...FIELD, altFt: 1000 };
  assert.equal(store.isInsideJurisdictionOf('LC', field), true);
  assert.equal(store.isInsideJurisdictionOf('GC', field), true);
  assert.equal(store.isInsideJurisdictionOf('AP', field), false);
  assert.equal(store.isInsideJurisdictionOf('AP', { ...FIELD, altFt: 8000 }), true);
  assert.equal(store.isInsideJurisdictionOf('PAR', { ...FIELD, altFt: 8000 }), true);
  assert.equal(store.isInsideJurisdictionOf('CTR', { ...FIELD, altFt: 8000 }), false);
  assert.equal(store.isInsideJurisdictionOf('CTR', { ...FIELD, altFt: 30000 }), true);
  assert.equal(store.isInsideJurisdictionOf('OPS', field), false, 'a Position that owns no area');
  assert.equal(store.isInsideJurisdictionOf(null, field), false);
  state.ship = { lat: 36.6, lon: 35.0, found: true };
  const nearShip = { lat: 36.62, lon: 35.0, altFt: 8000 };
  assert.equal(store.isInsideJurisdictionOf('CV_APP1', nearShip), true);
  assert.equal(store.isInsideJurisdictionOf('AP', nearShip), false, 'inside RAPCON\'s circle too, but the carrier wins');
});

test('with no mission loaded every point is CENTER\'s', () => {
  const store = new AirspaceStore({ currentTheater: () => null, facilityLookup: lookup, authority: { rowOf } });
  assert.equal(store.jurisdictionAt({ ...FIELD, altFt: 500 }).facilityId, 'CENTER');
});

// ── the schema ──────────────────────────────────────────────────────────────────────────────────

const base = () => JSON.parse(JSON.stringify(SYRIA.find(d => d.airspaceId === 'LTAG-CZ')));
const v = (patch) => schema.validateAirspaceDefinition({ ...base(), ...patch });

test('schema: a JURISDICTION area is refused without its class, owners or geometry, and with AREA-only fields', () => {
  assert.equal(v({}).ok, true);
  assert.match(v({ airspaceClass: 'X' }).detail, /airspaceClass must be one of/);
  assert.match(v({ ownerPositionIds: [] }).detail, /needs at least one owner Position/);
  assert.match(v({ ownerPositionIds: ['LC', 'LC'] }).detail, /different Position ids/);
  assert.match(v({ airspaceClass: 'G' }).detail, /Class G airspace belongs to nobody/);
  assert.equal(v({ airspaceClass: 'G', ownerPositionIds: [] }).ok, true);
  assert.match(v({ type: 'MOA' }).detail, /has no type/);
  assert.match(v({ workingFrequencyMhz: 121.5 }).detail, /has no workingFrequencyMhz/);
  assert.match(v({ usingFacilityId: 'TACTICAL' }).detail, /has no usingFacilityId/);
  assert.match(v({ geometry: null }).detail, /needs a geometry/);
  assert.match(v({ geometry: { source: 'DCS_DRAWING', points: [] } }).detail, /POLYGON or CIRCLE/);
  assert.match(v({ excludes: ['LTAG-CZ'] }).detail, /cannot exclude itself/);
  assert.match(v({ sourceText: 'x'.repeat(601) }).detail, /sourceText/);
});

test('schema: a CIRCLE has a fixed or hull centre, a bounded radius, and a cut only when fixed', () => {
  const g = (geometry) => v({ geometry }).detail;
  assert.match(g({ source: 'CIRCLE', centre: { lat: 37, lon: 35 }, radiusNm: 0 }), /radiusNm/);
  assert.match(g({ source: 'CIRCLE', centre: { lat: 37, lon: 35 }, radiusNm: 251 }), /radiusNm/);
  assert.match(g({ source: 'CIRCLE', centre: { lat: 97, lon: 35 }, radiusNm: 5 }), /decimal degrees/);
  assert.match(g({ source: 'CIRCLE', centre: { lat: 37, lon: 35, hullId: 'X' }, radiusNm: 5 }), /centre \{ lat, lon \} or \{ hullId \}/);
  assert.match(g({ source: 'CIRCLE', centre: { hullId: 'CVN-72' }, radiusNm: 5, cut: { from: [37, 35], to: [37.1, 35.1] } }), /on a carrier hull has no cut/);
  assert.match(g({ source: 'CIRCLE', centre: { lat: 37, lon: 35 }, radiusNm: 5, cut: { from: [37, 35], to: [37, 35] } }), /two different points/);
  assert.match(g({ source: 'CIRCLE', centre: { lat: 37, lon: 35 }, radiusNm: 5, colour: 1 }), /has no colour/);
  assert.match(v({ excludes: ['LTAG-RAPCON'], geometry: { source: 'CIRCLE', centre: { hullId: 'CVN-72' }, radiusNm: 5 } }).detail, /excludes nothing/);
  const ok = v({ geometry: { source: 'CIRCLE', centre: { lat: 37, lon: 35 }, radiusNm: 5 } });
  assert.deepEqual(ok.definition.geometry, { source: 'CIRCLE', centre: { lat: 37, lon: 35 }, radiusNm: 5, cut: null });
  assert.deepEqual(ok.definition.excludes, []);
});

test('schema: an AREA carrying a jurisdiction field is refused, and its normalised shape is unchanged', () => {
  const area = { airspaceId: 'MOA-1', name: 'M', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR' };
  assert.match(schema.validateAirspaceDefinition({ ...area, airspaceClass: 'D' }).detail, /airspaceClass belongs to a JURISDICTION area/);
  const out = schema.validateAirspaceDefinition(area).definition;
  for (const f of schema.JURISDICTION_ONLY_FIELDS) assert.equal(f in out, false, f);
});

test('loadStandingList refuses two overlapping static areas and an exclude naming nothing, naming both', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-'));
  const write = (defs) => { const p = path.join(dir, 'a.json'); fs.writeFileSync(p, JSON.stringify({ Syria: defs })); return { read: p }; };
  const raw = JSON.parse(fs.readFileSync(SHIPPED, 'utf8')).Syria;
  const noExclude = raw.map(d => (d.airspaceId === 'LTAG-RAPCON' ? { ...d, excludes: [] } : d));
  assert.throws(() => schema.loadStandingList({ paths: write(noExclude) }), /LTAG-CZ and LTAG-RAPCON share airspace/);
  const dangling = raw.map(d => (d.airspaceId === 'LTAG-RAPCON' ? { ...d, excludes: ['NOPE'] } : d));
  assert.throws(() => schema.loadStandingList({ paths: write(dangling) }), /excludes NOPE, which is not an airspace of this theater/);
  const onCarrier = raw.map(d => (d.airspaceId === 'LTAG-RAPCON' ? { ...d, excludes: ['CVN-72-CCA'] } : d));
  assert.throws(() => schema.loadStandingList({ paths: write(onCarrier) }), /a carrier area/);
});

// ── the overlap check (H144) ────────────────────────────────────────────────────────────────────

test('overlap: 3D, touching is not overlap, a sliver is, the carrier never counts', () => {
  const box = (points, extra = {}) => ({ ...base(), airspaceId: 'BOX', name: 'Box', cut: undefined, excludes: [], geometry: { source: 'POLYGON', points }, ...extra });
  assert.deepEqual(j.findStaticOverlap([...SYRIA, box([[36.8, 35.8], [36.8, 36.0], [37.1, 36.0], [37.1, 35.8]])]), ['BOX', 'LTAG-RAPCON']);
  assert.equal(j.findStaticOverlap([...SYRIA, box([[35, 34], [35, 37], [39, 37], [39, 34]], { altLowerFt: 28000, altUpperFt: 40000 })]), null, 'sharing FL280 is touching');
  assert.ok(j.findStaticOverlap([...SYRIA, box([[35, 34], [35, 37], [39, 37], [39, 34]], { altLowerFt: 27999, altUpperFt: 40000 })]), 'one foot of shared band is overlap');
  assert.ok(j.findStaticOverlap([...SYRIA, box([[37.0, 36.465], [37.0, 37], [37.001, 37], [37.001, 36.465]])]), 'a thin sliver over the rim');
  assert.equal(j.findStaticOverlap([...SYRIA, box([[36, 37.6], [36, 38], [37, 38], [37, 37.6]])]), null, 'clear of the circle');
  const ccaTwo = { ...CCA, airspaceId: 'CCA-2', name: 'CCA two' };
  assert.equal(j.findStaticOverlap([...SYRIA, ccaTwo]), null, 'carrier circles overlap anything, each other included');
  // The tower's volume raised above RAPCON's floor stays cut out: RAPCON excludes the volume, whatever it is.
  const higher = SYRIA.map(d => (d.airspaceId === 'LTAG-CZ' ? { ...d, altUpperFt: 9000 } : d));
  assert.equal(j.findStaticOverlap(higher), null);
});

// ── the registry ────────────────────────────────────────────────────────────────────────────────

test('AP edits RAPCON\'s ceiling; LC may not; LC edits the control zone', () => {
  const { store } = registry();
  const ok = edit(store, 'LTAG-RAPCON', { altUpperFt: 24000 }, 'AP');
  assert.equal(ok.ok, true, ok.detail);
  assert.equal(store.getAirspace('LTAG-RAPCON').definition.altUpperFt, 24000);
  const no = edit(store, 'LTAG-RAPCON', { altUpperFt: 20000 }, 'LC');
  assert.equal(no.reason, 'PERMISSION_DENIED');
  assert.match(no.detail, /only AP may/);
  assert.equal(edit(store, 'LTAG-CZ', { altUpperFt: 3500 }, 'LC').ok, true);
  assert.equal(edit(store, 'LTAG-CZ', { altUpperFt: 3600 }, 'GC').reason, 'PERMISSION_DENIED', 'an owner is not an editor');
  assert.equal(edit(store, 'LTAG-CZ', { altUpperFt: 3600 }, 'CTR').reason, 'PERMISSION_DENIED');
});

test('an edit that makes two static areas share volume is refused, naming both', () => {
  const { store } = registry();
  const r = edit(store, 'LTAG-RAPCON', { excludes: [] }, 'AP');
  assert.equal(r.reason, 'VALIDATION_ERROR');
  assert.match(r.detail, /LTAG-CZ and LTAG-RAPCON share airspace/);
  assert.deepEqual(store.getAirspace('LTAG-RAPCON').definition.excludes, ['LTAG-CZ'], 'nothing changed');
});

test('a third static area cannot be created inside RAPCON, by the web or an import', () => {
  const { store } = registry();
  const box = { ...base(), airspaceId: 'BOX', name: 'Box', excludes: [], geometry: { source: 'POLYGON', points: [[36.8, 35.8], [36.8, 36.0], [37.1, 36.0], [37.1, 35.8]] } };
  const r = store.apply({ airspaceId: 'BOX', theater: 'Syria', op: { kind: 'CreateAirspace', definition: box } }, { service: 'SQUADRON_ADMIN', via: 'WEB', controllerId: 'w', positionId: null });
  assert.match(r.detail, /BOX and LTAG-RAPCON share airspace/);
  const imp = store.apply({ op: { kind: 'ImportAirspaces', theater: 'Syria', source: 'STANDING', definitions: [box] } }, { service: 'SEED', via: 'SEED', controllerId: 'system', positionId: null });
  assert.match(imp.detail, /import refused, nothing created: BOX and LTAG-RAPCON share airspace/);
  assert.equal(store.getAirspace('BOX'), null);
});

test('a panel Position may not create or delete a jurisdiction area; the web may not delete one another excludes', () => {
  const { store } = registry();
  const box = { ...base(), airspaceId: 'BOX', name: 'Box', geometry: { source: 'POLYGON', points: [[30, 30], [30, 31], [31, 31], [31, 30]] } };
  assert.equal(store.apply({ airspaceId: 'BOX', op: { kind: 'CreateAirspace', definition: box } }, panel('LC')).reason, 'PERMISSION_DENIED');
  const del = (actor) => store.apply({ airspaceId: 'LTAG-CZ', theater: 'Syria', baseDefRev: 1, op: { kind: 'DeleteAirspace' } }, actor);
  assert.equal(del(panel('LC')).reason, 'PERMISSION_DENIED');
  const web = del({ service: 'SQUADRON_ADMIN', via: 'WEB', controllerId: 'w', positionId: null });
  assert.match(web.detail, /LTAG-RAPCON excludes it/);
});

test('the carrier circle: CV_PRIFLY and CV_MARSHAL edit it, the anchor stays, CV_APP1 and AP may not', () => {
  const { store } = registry();
  const geo = (radiusNm, centre = { hullId: 'CVN-72' }) => ({ geometry: { source: 'CIRCLE', centre, radiusNm } });
  assert.equal(edit(store, 'CVN-72-CCA', geo(40), 'CV_MARSHAL').ok, true);
  assert.equal(edit(store, 'CVN-72-CCA', geo(45), 'CV_PRIFLY').ok, true);
  assert.equal(edit(store, 'CVN-72-CCA', geo(30), 'CV_APP1').reason, 'PERMISSION_DENIED');
  assert.equal(edit(store, 'CVN-72-CCA', geo(30), 'AP').reason, 'PERMISSION_DENIED');
  const moved = edit(store, 'CVN-72-CCA', geo(30, { lat: 36, lon: 34 }), 'CV_PRIFLY');
  assert.match(moved.detail, /carrier anchor .* cannot be changed in the panel/);
  assert.match(edit(store, 'CVN-72-CCA', { ownerPositionIds: ['CV_PRIFLY'] }, 'CV_PRIFLY').detail, /set by the theater configuration/);
  assert.match(edit(store, 'LTAG-CZ', { controllingPositionId: 'GC' }, 'LC').detail, /set by the theater configuration/);
});

test('a jurisdiction area has no schedule or activation', () => {
  const { store } = registry();
  const r = store.apply({ airspaceId: 'LTAG-RAPCON', baseRev: 0, op: { kind: 'ScheduleAirspace', fromUtc: 0, toUtc: 1 } }, panel('AP'));
  assert.equal(r.reason, 'VALIDATION_ERROR');
  assert.match(r.detail, /never scheduled or activated/);
  assert.equal(store.containing({ ...FIELD, altFt: 500 }).length, 0, 'containing() answers AREAs and ROUTEs only');
});

test('a reference check: owners belong to the owning Facility, the hull is configured', () => {
  const { store } = registry({ defs: [] });
  const imp = (def) => store.apply({ op: { kind: 'ImportAirspaces', theater: 'Syria', source: 'STANDING', definitions: [def] } }, { service: 'SEED', via: 'SEED', controllerId: 'system', positionId: null });
  assert.match(imp({ ...CZ, ownerPositionIds: ['LC', 'CTR'] }).detail, /owner CTR is not a Position of INCIRLIK/);
  assert.match(imp({ ...CCA, geometry: { source: 'CIRCLE', centre: { hullId: 'CVN-99' }, radiusNm: 50 } }).detail, /hull CVN-99 is not a configured carrier hull/);
});

test('a restored snapshot whose static areas overlap stops start-up, naming them', () => {
  const { store } = registry();
  const snap = store.snapshot();
  const rap = snap.byTheater.Syria.find(r => r.airspaceId === 'LTAG-RAPCON');
  rap.definition.excludes = [];
  const fresh = new AirspaceStore({ currentTheater: () => 'Syria', facilityLookup: lookup, authority: { rowOf } });
  assert.throws(() => fresh.restore(snap), /LTAG-CZ and LTAG-RAPCON share airspace/);
});
