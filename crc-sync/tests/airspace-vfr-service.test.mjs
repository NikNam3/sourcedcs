// docs/adr/0143 (H166): the airspace class of a JURISDICTION area is optional (Türkiye does not classify its airspace:
// the Incirlik RAPCON is the Adana MTMA) and each area has a VFR service, its own `vfrService` or its class's. The
// shipped Syria areas, the schema's rules, `jurisdictionAt`'s answer and the panel edit that takes a class away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const schema = require('../src/efsp/airspace-schema.js');
const { AirspaceStore } = require('../src/efsp/airspace-store.js');
const authority = require('../src/efsp/authority');

const SHIPPED = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'config', 'efsp-airspaces.json');
const SYRIA = schema.loadStandingList({ paths: { read: SHIPPED } }).Syria;
const byId = (id) => SYRIA.find(d => d.airspaceId === id);

const FACILITIES = { INCIRLIK: ['OPS', 'CD', 'GC', 'LC', 'AP', 'PAR'], CENTER: ['CTR'], CARRIER: ['CV_MARSHAL', 'CV_PRIFLY', 'CV_APP1', 'CV_APP2'] };
const lookup = {
  hasFacility: (id) => id in FACILITIES,
  positionsOf: (id) => FACILITIES[id] || [],
  facilityOfPosition: (p) => Object.keys(FACILITIES).find(f => FACILITIES[f].includes(p)) || null,
  hasHull: (id) => id === 'CVN-72',
};
const rowOf = (id) => authority.airspaceAuthority.rowFor(id, { familyRows: authority.AIRSPACE_ROWS, classOf: () => null });

function registry(defs = SYRIA) {
  const store = new AirspaceStore({
    currentTheater: () => 'Syria', facilityLookup: lookup, authority: { rowOf },
    hullPosition: () => ({ lat: 36.3, lon: 34.6, found: true }),
  });
  const r = store.apply({ op: { kind: 'ImportAirspaces', theater: 'Syria', source: 'STANDING', definitions: defs } },
    { service: 'SEED', via: 'SEED', controllerId: 'system', positionId: null });
  if (!r.ok) throw new Error(r.detail);
  return store;
}
const panel = (positionId) => ({ positionId, controllerId: 'c1', via: 'PANEL' });
const edit = (store, id, patch, positionId) => store.apply({ airspaceId: id, baseDefRev: store.getAirspace(id).defRev, op: { kind: 'EditAirspace', patch } }, panel(positionId));
const FIELD = { lat: 37.0019, lon: 35.4258 };

const jur = (extra = {}) => ({
  airspaceId: 'TEST-J', name: 'Test area', kind: 'JURISDICTION', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP',
  ownerPositionIds: ['AP'], airspaceClass: 'D', altLowerFt: null, altUpperFt: 5000,
  geometry: { source: 'CIRCLE', centre: { lat: 36, lon: 35 }, radiusNm: 5 }, ...extra,
});

test('the shipped areas: the control zone is Class D (H166 addendum), the RAPCON unclassified with IFR separated from VFR', () => {
  const cz = byId('LTAG-CZ'); const rapcon = byId('LTAG-RAPCON'); const cca = byId('CVN-72-CCA');
  assert.equal(cz.airspaceClass, 'D');
  assert.equal(cz.vfrService, null, 'the class gives the service');
  assert.equal(schema.vfrServiceOf(cz), 'ADVISORY', 'Class D: traffic advisories, no IFR/VFR separation in the air');
  assert.match(cz.sourceText, /Class D per the human \(H166/);
  assert.equal(rapcon.airspaceClass, null, 'an MTMA is not classified (H166)');
  assert.equal(rapcon.vfrService, 'IFR_SEPARATED', 'H166 option 2');
  assert.doesNotMatch(rapcon.sourceText, /class C/i);
  assert.equal(cca.airspaceClass, null, 'the carrier control area is unclassified (H173 VQ-B)');
  assert.equal(cca.vfrService, 'ADVISORY');
  assert.doesNotMatch(cca.sourceText, /class [A-G]\b/i);
});

test('the class gives the VFR service unless the area names one (FAA: B all separated, C IFR separated, D/E advisory)', () => {
  assert.equal(schema.vfrServiceOf({ airspaceClass: 'B' }), 'ALL_SEPARATED');
  assert.equal(schema.vfrServiceOf({ airspaceClass: 'C' }), 'IFR_SEPARATED');
  for (const c of ['D', 'E', 'F']) assert.equal(schema.vfrServiceOf({ airspaceClass: c }), 'ADVISORY', c);
  assert.equal(schema.vfrServiceOf({ airspaceClass: 'A' }), null, 'no VFR in Class A');
  assert.equal(schema.vfrServiceOf({ airspaceClass: 'G' }), null, 'Class G is nobody\'s');
  assert.equal(schema.vfrServiceOf({ airspaceClass: 'D', vfrService: 'IFR_SEPARATED' }), 'IFR_SEPARATED', 'the area\'s own wins');
  assert.equal(schema.vfrServiceOf({ airspaceClass: null, vfrService: 'ADVISORY' }), 'ADVISORY');
});

test('the schema: a class or a VFR service; never a VFR service in Class A or G; unknown values refused', () => {
  const v = (extra) => schema.validateAirspaceDefinition(jur(extra));
  assert.equal(v({ airspaceClass: undefined, vfrService: 'IFR_SEPARATED' }).ok, true);
  assert.equal(v({ airspaceClass: undefined, vfrService: 'IFR_SEPARATED' }).definition.airspaceClass, null);
  assert.match(v({ airspaceClass: undefined }).detail, /an unclassified area must name its vfrService/);
  assert.match(v({ airspaceClass: null, vfrService: null }).detail, /an unclassified area must name its vfrService/);
  assert.match(v({ vfrService: 'SEPARATED' }).detail, /vfrService must be one of ALL_SEPARATED, IFR_SEPARATED, ADVISORY/);
  assert.match(v({ airspaceClass: 'A', vfrService: 'ADVISORY' }).detail, /Class A airspace has no VFR service/);
  assert.match(v({ airspaceClass: 'G', ownerPositionIds: [], vfrService: 'ADVISORY' }).detail, /Class G airspace has no VFR service/);
  assert.match(v({ airspaceClass: undefined, vfrService: 'ADVISORY', ownerPositionIds: [] }).detail, /an unclassified area needs at least one owner Position/);
  assert.equal(v({}).definition.vfrService, null, 'normalised: present and null');
  const area = { airspaceId: 'MOA-1', name: 'MOA One', kind: 'AREA', type: 'MOA', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP' };
  assert.match(schema.validateAirspaceDefinition({ ...area, vfrService: 'ADVISORY' }).detail, /vfrService belongs to a JURISDICTION area/);
});

test('jurisdictionAt names the class (null when unclassified) and the VFR service', () => {
  const store = registry();
  const at = (altFt, p = FIELD) => store.jurisdictionAt({ ...p, altFt });
  assert.deepEqual([at(1000).airspaceId, at(1000).airspaceClass, at(1000).vfrService], ['LTAG-CZ', 'D', 'ADVISORY']);
  assert.deepEqual([at(5000).airspaceId, at(5000).airspaceClass, at(5000).vfrService], ['LTAG-RAPCON', null, 'IFR_SEPARATED']);
  const above = at(30000);
  assert.deepEqual([above.fallback, above.airspaceClass, above.vfrService], [true, null, 'ADVISORY'], 'CENTER\'s fallback: unclassified, VFR advisories (H173 VQ-B)');
});

test('a panel edit takes a class away only together with a VFR service, and sets the service alone', () => {
  const defs = [jur({ airspaceId: 'TEST-J', airspaceClass: 'C' })];
  const store = registry(defs);
  const bare = edit(store, 'TEST-J', { airspaceClass: null }, 'AP');
  assert.equal(bare.ok, false);
  assert.match(bare.detail, /an unclassified area must name its vfrService/);
  const both = edit(store, 'TEST-J', { airspaceClass: null, vfrService: 'IFR_SEPARATED' }, 'AP');
  assert.equal(both.ok, true, both.detail);
  assert.deepEqual([store.getAirspace('TEST-J').definition.airspaceClass, store.getAirspace('TEST-J').definition.vfrService], [null, 'IFR_SEPARATED']);
  const svc = edit(store, 'TEST-J', { vfrService: 'ADVISORY' }, 'AP');
  assert.equal(svc.ok, true, svc.detail);
  assert.deepEqual(svc.changes.map(c => c.field), ['vfrService']);
  const back = edit(store, 'TEST-J', { airspaceClass: 'D', vfrService: null }, 'AP');
  assert.equal(back.ok, true, back.detail);
  assert.equal(schema.vfrServiceOf(store.getAirspace('TEST-J').definition), 'ADVISORY');
});

test('a snapshot written before ADR 0143 (no vfrService key, the RAPCON still Class C) restores', () => {
  const old = { ...jur({ airspaceClass: 'C' }) };
  const checked = schema.validateAirspaceDefinition(old, { derived: 'recompute' });
  assert.equal(checked.ok, true);
  assert.equal(schema.vfrServiceOf(checked.definition), 'IFR_SEPARATED');
});
