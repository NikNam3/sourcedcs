/* AIRSP-2P-B: what the map draws for the registry: which records (the menu decides), the labels and limits (FL from the
   transition altitude), the solid ACTIVE and dashed non-active styles, the route corridor buffered by leg width. */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAirspaceFeatures, corridorRing, labelText, limitsText, OUTLINE_COLOUR, buildDraftFeatures } from '../app/public/js/airspace-layer.js';
import * as m from '../app/public/js/airspace-layer-menu.js';
import { distanceNm } from '../app/public/js/panels/efsp/airspace-geometry-model.js';

const sq = { source: 'POLYGON', points: [[36, 35], [36, 36], [37, 36], [37, 35]] };
const area = (id, state, lo = null, hi = 18000) => ({ airspaceId: id, state, definition: { airspaceId: id, name: `${id} NAME`, kind: 'AREA', type: 'MOA', controllingFacilityId: 'CENTER', altLowerFt: lo, altUpperFt: hi, geometry: sq } });
const route = (id, state) => ({ airspaceId: id, state, definition: { airspaceId: id, name: id, kind: 'ROUTE', type: 'VR', controllingFacilityId: 'CENTER', defaultWidthNm: 4, altLowerFt: 500, altUpperFt: 6000,
  segments: [{ fix: { name: 'A', lat: 37.35, lon: 35.35 }, altLowerFt: 500, altUpperFt: 3000, widthNm: null }, { fix: { name: 'B', lat: 37.2, lon: 35.65 }, altLowerFt: 1000, altUpperFt: 6000, widthNm: 10 }, { fix: { name: 'C', lat: 37.0, lon: 36.1 }, altLowerFt: null, altUpperFt: null, widthNm: null }] } });
const T = 'Syria';

test('limits: FL at and above the transition altitude, feet below; GND and UNL for none', () => {
  assert.equal(limitsText(null, 18000, 18000), 'GND–FL180');
  assert.equal(limitsText(500, 6000, 10000), '500–6000');
  assert.equal(limitsText(10000, 28000, 10000), 'FL100–FL280'); // Syria, transition 10,000
  assert.equal(limitsText(5000, null, 18000), '5000–UNL');
});

test('labels: ACTIVE shows name and limits; any other state also shows its state', () => {
  assert.deepEqual(labelText(area('A', 'ACTIVE', null, 18000), 18000), { line1: 'A NAME', line2: 'GND–FL180', text: 'A NAME\nGND–FL180' });
  assert.equal(labelText(area('A', 'RETURNED', 5000, 23000), 18000).line2, 'RETURNED · 5000–FL230');
});

test('the default menu draws ACTIVE airspaces only: solid, grey; labels with them', () => {
  const f = buildAirspaceFeatures([area('A', 'ACTIVE'), area('B', 'RETURNED'), route('R', 'ACTIVE')], m.defaultMenu(), T);
  assert.deepEqual(f.outlines.features.map(x => x.properties.id).sort(), ['A', 'R']);
  for (const x of f.outlines.features) { assert.equal(x.properties.dashed, false); assert.equal(x.properties.colour, OUTLINE_COLOUR.dark.active); }
  assert.deepEqual(f.labels.features.map(x => x.properties.id).sort(), ['A', 'R']);
  assert.equal(f.centrelines.features.length, 0);
});

test('a non-active airspace the menu includes is dashed, lighter, and has its state in the label; never orange-red', () => {
  const menu = m.setState(m.defaultMenu(), 'RETURNED', true);
  const f = buildAirspaceFeatures([area('A', 'ACTIVE'), area('B', 'RETURNED')], menu, T);
  const b = f.outlines.features.find(x => x.properties.id === 'B');
  assert.equal(b.properties.dashed, true); assert.equal(b.properties.colour, OUTLINE_COLOUR.dark.other);
  assert.match(f.labels.features.find(x => x.properties.id === 'B').properties.text, /RETURNED/);
  for (const c of [...Object.values(OUTLINE_COLOUR.dark), ...Object.values(OUTLINE_COLOUR.light)]) assert.match(c, /^#[0-9a-f]{6}$/i), assert.ok(!/^#(ff|e|f)/i.test(c));
  const light = buildAirspaceFeatures([area('A', 'ACTIVE')], m.defaultMenu(), T, { lightMode: true });
  assert.equal(light.outlines.features[0].properties.colour, OUTLINE_COLOUR.light.active);
});

test('individual settings and layers change what is drawn', () => {
  const list = [area('A', 'ACTIVE'), area('B', 'SCHEDULED'), route('R', 'ACTIVE')];
  let menu = m.setOverride(m.setOverride(m.defaultMenu(), T, 'B', 'on'), T, 'A', 'off');
  assert.deepEqual(buildAirspaceFeatures(list, menu, T).outlines.features.map(x => x.properties.id).sort(), ['B', 'R']);
  menu = m.setLayer(m.setLayer(menu, 'centrelines', true), 'corridors', false);
  const f = buildAirspaceFeatures(list, menu, T);
  assert.deepEqual(f.outlines.features.map(x => x.properties.id), ['B']);
  assert.equal(f.centrelines.features.length, 1);
  assert.equal(buildAirspaceFeatures(list, m.setLayer(m.defaultMenu(), 'labels', false), T).labels.features.length, 0);
});

test('an airspace without geometry draws nothing', () => {
  const a = area('A', 'ACTIVE'); a.definition.geometry = null;
  assert.equal(buildAirspaceFeatures([a], m.defaultMenu(), T).outlines.features.length, 0);
});

test('corridor: the straight leg is the leg width wide; a wide leg is wider; the ring closes round the route', () => {
  const rows = [{ lat: 37, lon: 35, widthNm: null }, { lat: 37, lon: 35.5, widthNm: 10 }, { lat: 37, lon: 36, widthNm: null }];
  const ring = corridorRing(rows, 4);
  assert.ok(ring.length > 8);
  // first leg (default 4 NM): points near the start of the leg sit 2 NM from the centreline; second leg 5 NM
  const nearLeg1 = ring.filter(p => p[1] > 35.05 && p[1] < 35.4);
  for (const p of nearLeg1) assert.ok(Math.abs(distanceNm(p, [37, p[1]]) - 2) < 0.15, `${p} ${distanceNm(p, [37, p[1]])}`);
  const nearLeg2 = ring.filter(p => p[1] > 35.6 && p[1] < 35.95);
  for (const p of nearLeg2) assert.ok(Math.abs(distanceNm(p, [37, p[1]]) - 5) < 0.15, `${p}`);
  assert.equal(corridorRing([{ lat: 1, lon: 1 }], 4), null);
});

test('corridor round a bend stays a simple ring around every fix', () => {
  const r = route('R', 'ACTIVE').definition.segments.map(s => ({ lat: s.fix.lat, lon: s.fix.lon, widthNm: s.widthNm }));
  const ring = corridorRing(r, 4);
  const lat = ring.map(p => p[0]); const lon = ring.map(p => p[1]);
  for (const f of r) { assert.ok(f.lat > Math.min(...lat) && f.lat < Math.max(...lat)); assert.ok(f.lon > Math.min(...lon) && f.lon < Math.max(...lon)); }
  for (const p of ring) assert.ok(r.some(f => distanceNm(p, [f.lat, f.lon]) < 12), 'no point strays from the route');
});

test('the draft layer: vertices, midpoints, crossing edges in the error role, the rubber band', () => {
  const pts = [[36, 35], [37, 36], [37, 35], [36, 36]];
  const d = buildDraftFeatures({ points: pts, closed: true, selected: 1, crossing: [[0, 2]] });
  const roles = d.features.map(f => f.properties.role);
  assert.equal(roles.filter(r => r === 'vertex').length, 4); assert.equal(roles.filter(r => r === 'mid').length, 4);
  assert.equal(roles.filter(r => r === 'cross').length, 2);
  assert.equal(d.features.find(f => f.properties.role === 'vertex' && f.properties.index === 1).properties.selected, true);
  assert.ok(buildDraftFeatures({ points: pts.slice(0, 2), closed: false, rubber: [36.5, 35.5] }).features.some(f => f.properties.role === 'rubber'));
});

test('corridor at a right-angle left turn: the inner side meets at one point (2 NM x sqrt 2), the outer side is round', () => {
  const lat = 37; const dLon = 10 / 60 / Math.cos(lat * Math.PI / 180);
  const rows = [{ lat, lon: 35, widthNm: null }, { lat, lon: 35 + dLon, widthNm: null }, { lat: lat + 10 / 60, lon: 35 + dLon, widthNm: null }];
  const ring = corridorRing(rows, 4);
  const B = [lat, 35 + dLon];
  const nearB = ring.filter(p => distanceNm(p, B) < 4);
  const dists = nearB.map(p => distanceNm(p, B));
  assert.ok(Math.max(...dists) < 2.9, `${Math.max(...dists)}`);
  assert.ok(dists.filter(d => Math.abs(d - 2) < 0.05).length >= 6, 'the outer corner is an arc 2 NM round the fix');
  assert.ok(dists.some(d => Math.abs(d - 2.83) < 0.05), 'the inner corner is the miter point');
});

// ── T28 (LT-AIRSPACE-FIX): an airspace copied from a DCS drawing stands in for it on the map ──

import { drawingsShownAsAirspace } from '../app/public/js/airspace-layer.js';

const SQ = [[36.2, 35.2], [36.2, 35.8], [36.7, 35.8], [36.7, 35.2]];
const DRAWINGS = [
  { primitiveType: 'TextBox', text: 'x', lat: 36, lon: 35 },
  { primitiveType: 'Polygon', polygonMode: 'free', closed: true, name: 'ADANA SOUTH MOA', layerName: 'Common', points: SQ.map(([lat, lon]) => ({ lat, lon })) },
  { primitiveType: 'Polygon', polygonMode: 'free', closed: true, name: 'OTHER', layerName: 'Common', points: SQ.map(([lat, lon]) => ({ lat: lat + 1, lon })) },
];
const fromDrawing = (id, state, points = SQ) => ({ airspaceId: id, state, definition: { airspaceId: id, name: id, kind: 'AREA', type: 'MOA',
  geometry: { source: 'DCS_DRAWING', drawingRef: { layerName: 'Common', objectName: 'ADANA SOUTH MOA', missionFingerprint: 'x' }, points } } });

test('T28: the drawing an airspace outline was copied from is hidden while that outline is drawn', () => {
  assert.deepEqual(drawingsShownAsAirspace([fromDrawing('A', 'ACTIVE')], m.defaultMenu(), T, DRAWINGS), [1]);
});

test('T28: the drawing comes back when the menu does not draw the airspace (default menu: ACTIVE only)', () => {
  assert.deepEqual(drawingsShownAsAirspace([fromDrawing('A', 'RETURNED')], m.defaultMenu(), T, DRAWINGS), []);
});

test('T28: a drawing that no longer matches the copy stays on the map; a drawn (POLYGON) airspace hides nothing', () => {
  const moved = SQ.map(([lat, lon]) => [lat, lon + 0.1]);
  assert.deepEqual(drawingsShownAsAirspace([fromDrawing('A', 'ACTIVE', moved)], m.defaultMenu(), T, DRAWINGS), []);
  const drawn = { ...fromDrawing('B', 'ACTIVE'), definition: { ...fromDrawing('B', 'ACTIVE').definition, geometry: { source: 'POLYGON', points: SQ } } };
  assert.deepEqual(drawingsShownAsAirspace([drawn], m.defaultMenu(), T, DRAWINGS), []);
  assert.deepEqual(drawingsShownAsAirspace([fromDrawing('A', 'ACTIVE')], m.defaultMenu(), T, []), []);
});

// crc-sync docs/adr/0125: jurisdiction areas, a thin grey outline, off by default, the carrier circle on the live hull.
import { hullPositionFromCarriers, jurisdictionLabelText } from '../app/public/js/airspace-layer.js';

const jur = (id, geometry, extra = {}) => ({ airspaceId: id, state: 'RETURNED', definition: { airspaceId: id, name: `${id} NAME`, kind: 'JURISDICTION', type: null, controllingFacilityId: 'INCIRLIK', airspaceClass: 'D', altLowerFt: null, altUpperFt: 3000, geometry, ...extra } });
const cz = jur('LTAG-CZ', { source: 'CIRCLE', centre: { lat: 37.003333, lon: 35.425 }, radiusNm: 5, cut: { from: [36.985, 35.323611], to: [37.075556, 35.476944] } });
const cca = jur('CVN-72-CCA', { source: 'CIRCLE', centre: { hullId: 'CVN-72' }, radiusNm: 50, cut: null }, { controllingFacilityId: 'CARRIER', airspaceClass: 'E', altUpperFt: null });

test('jurisdiction areas are off by default and drawn thin, solid and grey once their kind is on', () => {
  assert.equal(buildAirspaceFeatures([cz], m.defaultMenu(), T).outlines.features.length, 0);
  const on = m.setKind(m.defaultMenu(), 'JURISDICTION', true);
  const f = buildAirspaceFeatures([cz], on, T, { transitionAltFt: 10000 });
  assert.equal(f.outlines.features.length, 1);
  const p = f.outlines.features[0].properties;
  assert.equal(p.thin, true); assert.equal(p.dashed, false); assert.equal(p.colour, OUTLINE_COLOUR.dark.other);
  assert.equal(f.labels.features[0].properties.text, 'LTAG-CZ NAME\nClass D · GND–3000');
  // The cut removed the north-west part: fewer points than the full ring, all within 5 nm of the centre.
  const pts = f.outlines.features[0].geometry.coordinates;
  assert.ok(pts.length < 128);
  for (const [lon, lat] of pts) assert.ok(distanceNm([37.003333, 35.425], [lat, lon]) <= 5.01);
});

test('the carrier circle follows the hull and is not drawn while the ship is not found', () => {
  const on = m.setKind(m.defaultMenu(), 'JURISDICTION', true);
  assert.equal(buildAirspaceFeatures([cca], on, T).outlines.features.length, 0);
  const at = (lat, lon) => hullPositionFromCarriers((id) => (id === 'CVN-72' ? { hullId: id, shipState: { found: true, lat, lon } } : null));
  const a = buildAirspaceFeatures([cca], on, T, { hullPosition: at(36.0, 35.0) }).outlines.features[0].geometry.coordinates;
  const b = buildAirspaceFeatures([cca], on, T, { hullPosition: at(36.2, 35.0) }).outlines.features[0].geometry.coordinates;
  assert.ok(Math.abs((b[0][1] - a[0][1]) - 0.2) < 1e-9, 'the ring moved with the ship');
  const lost = hullPositionFromCarriers(() => ({ shipState: { found: false, lat: 36, lon: 35 } }));
  assert.equal(lost('CVN-72'), null);
  assert.equal(jurisdictionLabelText(cca.definition, 18000).line2, 'Class E · GND–UNL');
  // crc-sync docs/adr/0143 (H166): an unclassified area (the Adana MTMA) says no class at all.
  assert.equal(jurisdictionLabelText({ ...cca.definition, airspaceClass: null, vfrService: 'IFR_SEPARATED' }, 18000).line2, 'GND–UNL');
});
