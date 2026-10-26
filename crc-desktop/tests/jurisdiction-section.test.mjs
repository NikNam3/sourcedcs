/* The airspaces panel's JURISDICTION section model (crc-sync docs/adr/0125): which records it lists, how the shape reads,
   and the EditAirspace patch a form makes (changed fields only; the carrier anchor never changes here). */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { jurisdictionAreas, geometryText, limitsLine, draftOf, patchFrom, vfrServiceLine } from '../app/public/js/panels/efsp/jurisdiction-section.js';

const cz = { airspaceId: 'LTAG-CZ', name: 'LTAG CTR (control zone)', kind: 'JURISDICTION', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'LC', ownerPositionIds: ['LC', 'GC'], airspaceClass: 'D', altLowerFt: null, altUpperFt: 3000,
  geometry: { source: 'CIRCLE', centre: { lat: 37.003333, lon: 35.425 }, radiusNm: 5, cut: { from: [36.985, 35.323611], to: [37.075556, 35.476944] } } };
const rapcon = { ...cz, airspaceId: 'LTAG-RAPCON', name: 'Incirlik RAPCON (Adana MTMA)', controllingPositionId: 'AP', ownerPositionIds: ['AP', 'PAR'], airspaceClass: null, vfrService: 'IFR_SEPARATED', altUpperFt: 28000,
  geometry: { source: 'CIRCLE', centre: { lat: 36.998889, lon: 35.433056 }, radiusNm: 50, cut: null }, excludes: ['LTAG-CZ'] };
const cca = { ...cz, airspaceId: 'CVN-72-CCA', name: 'CVN-72 CCA (carrier control area)', controllingFacilityId: 'CARRIER', controllingPositionId: 'CV_PRIFLY', ownerPositionIds: ['CV_PRIFLY'], airspaceClass: 'E', altUpperFt: null,
  geometry: { source: 'CIRCLE', centre: { hullId: 'CVN-72' }, radiusNm: 50, cut: null } };
const rec = (definition) => ({ airspaceId: definition.airspaceId, state: 'RETURNED', definition });

test('lists only jurisdiction areas, by Facility (shipped order) then name', () => {
  const moa = rec({ airspaceId: 'MOA-1', name: 'A MOA', kind: 'AREA', type: 'MOA', controllingFacilityId: 'CENTER' });
  // INCIRLIK before CARRIER; inside INCIRLIK "Incirlik RAPCON ..." before "LTAG CTR ...".
  assert.deepEqual(jurisdictionAreas([rec(cca), moa, rec(rapcon), rec(cz)]).map(a => a.airspaceId), ['LTAG-RAPCON', 'LTAG-CZ', 'CVN-72-CCA']);
});

test('the shape and limits read plainly; the carrier anchor says it follows the ship', () => {
  assert.match(geometryText(cz.geometry), /^Circle 5 nm on 37\.0033N 35\.4250E, the part left of .* cut off$/);
  assert.equal(geometryText(cca.geometry), 'Circle 50 nm on the hull CVN-72 (follows the ship)');
  assert.equal(limitsLine(cz, 10000), 'SFC–3000');
  assert.equal(limitsLine(rapcon, 10000), 'SFC–FL280');
  assert.equal(limitsLine(cca, 10000), 'SFC–UNL');
});

test('an untouched form makes no patch; AP lowering the RAPCON ceiling to FL240 makes one field', () => {
  const d = draftOf(rapcon, 10000);
  assert.deepEqual(patchFrom(rapcon, d), { patch: {}, errors: {} });
  assert.deepEqual(patchFrom(rapcon, { ...d, altUpperFt: 'FL240' }), { patch: { altUpperFt: 24000 }, errors: {} });
  assert.deepEqual(patchFrom(rapcon, { ...d, altLowerFt: '' }).patch, {});
});

test('mistyped values are errors and send nothing', () => {
  const d = draftOf(rapcon, 10000);
  assert.ok(patchFrom(rapcon, { ...d, altUpperFt: 'high' }).errors.altUpperFt);
  assert.ok(patchFrom(rapcon, { ...d, altLowerFt: '30000' }).errors.altUpperFt);
  assert.ok(patchFrom(rapcon, { ...d, radiusNm: '0' }).errors.radiusNm);
  assert.ok(patchFrom(rapcon, { ...d, centre: '37' }).errors.centre);
  assert.ok(patchFrom(rapcon, { ...d, airspaceClass: 'G' }).errors.airspaceClass, 'an owned area cannot be Class G');
  assert.ok(patchFrom(cz, { ...draftOf(cz), cutTo: '' }).errors.cutTo, 'a cut needs both points');
  assert.deepEqual(patchFrom(rapcon, { ...d, radiusNm: '0' }).patch, {});
});

test('the circle: radius and centre change the geometry; clearing the cut removes it; the hull stays the hull', () => {
  const d = draftOf(rapcon);
  assert.deepEqual(patchFrom(rapcon, { ...d, radiusNm: '45' }).patch, { geometry: { source: 'CIRCLE', centre: { lat: 36.998889, lon: 35.433056 }, radiusNm: 45, cut: null } });
  const dz = draftOf(cz);
  assert.equal(dz.cutFrom, '36.985, 35.323611');
  assert.deepEqual(patchFrom(cz, { ...dz, cutFrom: '', cutTo: '' }).patch.geometry.cut, null);
  const dc = draftOf(cca);
  assert.equal('centre' in dc, false, 'no centre field on a carrier circle');
  assert.deepEqual(patchFrom(cca, { ...dc, radiusNm: '40', airspaceClass: 'D' }).patch,
    { airspaceClass: 'D', geometry: { source: 'CIRCLE', centre: { hullId: 'CVN-72' }, radiusNm: 40, cut: null } });
});

test('a polygon area edits its points as "lat, lon" lines', () => {
  const poly = { ...cz, geometry: { source: 'POLYGON', points: [[36, 35], [36, 36], [37, 36]] } };
  const d = draftOf(poly);
  assert.equal(d.points, '36, 35\n36, 36\n37, 36');
  assert.deepEqual(patchFrom(poly, { ...d, points: `${d.points}\n37, 35` }).patch, { geometry: { source: 'POLYGON', points: [[36, 35], [36, 36], [37, 36], [37, 35]] } });
  assert.ok(patchFrom(poly, { ...d, points: '36, 35' }).errors.points);
});

// crc-sync docs/adr/0143 (H166): the class is optional and an unclassified area names its VFR service.
test('the VFR service line: the area\'s own, or the class\'s with the class named; none in Class A or G', () => {
  assert.equal(vfrServiceLine(rapcon), 'IFR separated from VFR; VFR to VFR traffic advisories');
  assert.equal(vfrServiceLine(cz), 'VFR: traffic advisories, no separation (Class D)');
  assert.equal(vfrServiceLine({ ...cz, airspaceClass: 'C' }), 'IFR separated from VFR; VFR to VFR traffic advisories (Class C)');
  assert.equal(vfrServiceLine({ ...cz, airspaceClass: 'G' }), null);
});

test('the form: unclassified needs a VFR service; taking the class away sends both fields; A and G take none', () => {
  const d = draftOf(rapcon);
  assert.deepEqual([d.airspaceClass, d.vfrService], ['', 'IFR_SEPARATED']);
  assert.deepEqual(patchFrom(rapcon, d), { patch: {}, errors: {} });
  assert.ok(patchFrom(rapcon, { ...d, vfrService: '' }).errors.vfrService, 'unclassified with no service');
  assert.deepEqual(patchFrom(rapcon, { ...d, vfrService: 'ADVISORY' }).patch, { vfrService: 'ADVISORY' });
  assert.deepEqual(patchFrom(rapcon, { ...d, airspaceClass: 'C', vfrService: '' }).patch, { airspaceClass: 'C', vfrService: null });
  const old = { ...rapcon, airspaceClass: 'C', vfrService: null }; // a Board restored from before ADR 0143
  assert.deepEqual(patchFrom(old, { ...draftOf(old), airspaceClass: '', vfrService: 'IFR_SEPARATED' }).patch, { airspaceClass: null, vfrService: 'IFR_SEPARATED' });
  assert.ok(patchFrom(cz, { ...draftOf(cz), airspaceClass: 'A', vfrService: 'ADVISORY' }).errors.vfrService);
  assert.deepEqual(patchFrom(cz, draftOf(cz)).patch, {}, 'Class D with no own service: nothing to send');
});
