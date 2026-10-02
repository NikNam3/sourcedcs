/* AIRSP-2P-B: the pure half of the geometry editor: polygon editing, circle to polygon, the DCS-drawing picker (a pick
   COPIES the points; over 200 points is simplified, refused only if it then crosses itself: AP2B-Q1 a), the outline's
   status (what the buttons say), the route table to segments, and the hand-copied mission fingerprint (parity). */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as g from '../app/public/js/panels/efsp/airspace-geometry-model.js';
import { validateAirspaceDefinition } from '../app/public/js/panels/efsp/airspace-validate.js';

const require = createRequire(import.meta.url);
const server = require('../../crc-sync/src/mission-session.js');

const square = [[36, 35], [36, 36], [37, 36], [37, 35]];
const drawing = (extra = {}) => ({ primitiveType: 'Polygon', polygonMode: 'free', closed: true, name: 'ADANA SOUTH MOA', layerName: 'Common', points: square.map(([lat, lon]) => ({ lat, lon })), ...extra });

test('circle to polygon: 64 points, each at the radius from the centre', () => {
  const ring = g.circleToPolygon(36.5, 35.5, 15 * 1852);
  assert.equal(ring.length, 64);
  for (const p of ring) assert.ok(Math.abs(g.distanceNm([36.5, 35.5], p) - 15) < 0.1, `${p}`);
  assert.equal(validateAirspaceDefinition({ airspaceId: 'MOA-C', name: 'C', kind: 'AREA', type: 'MOA', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP', geometry: { source: 'POLYGON', points: ring } }).ok, true);
});

test('polygon editing: move, insert after, delete (never below 3), midpoints', () => {
  const m = g.movePoint(square, 1, [36.1, 36.1]); assert.deepEqual(m[1], [36.1, 36.1]); assert.deepEqual(square[1], [36, 36]);
  const i = g.insertPoint(square, 0, [36, 35.5]); assert.equal(i.length, 5); assert.deepEqual(i[1], [36, 35.5]);
  assert.equal(g.canDeletePoint(square), true);
  assert.equal(g.deletePoint(square, 0).length, 3);
  assert.equal(g.canDeletePoint(g.deletePoint(square, 0)), false);
  assert.equal(g.deletePoint(g.deletePoint(square, 0), 0).length, 3);
  assert.equal(g.midpoints(square).length, 4);
});

test('a crossing polygon reports the reason and the crossing edges; a good one reports none', () => {
  const bow = [[36, 35], [37, 36], [37, 35], [36, 36]];
  assert.match(g.polygonProblem(bow), /Edges cross/);
  assert.ok(g.crossingEdges(bow).length >= 1);
  assert.equal(g.polygonProblem(square), null);
  assert.match(g.polygonProblem(square.slice(0, 2)), /at least 3/);
  assert.equal(g.crossingEdges(square).length, 0);
});

test('the picker lists drawings by layer; text and icons are not listed; an open line is listed with its reason', () => {
  const list = g.listDrawings([
    drawing(), drawing({ name: 'KILLBOX', polygonMode: 'rect' }), { primitiveType: 'TextBox', text: 'x' },
    { primitiveType: 'Polyline', polygonMode: '', closed: false, name: 'INGRESS', layerName: 'Blue', points: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] },
    drawing({ name: undefined, layerName: undefined }),
  ]);
  assert.deepEqual(list.map(x => x.layerName), ['Common', 'Blue', 'Mission']);
  assert.equal(list[0].items.length, 2);
  assert.equal(list[0].items[1].shape, 'rectangle');
  const line = list[1].items[0];
  assert.equal(line.eligible, false); assert.match(line.reason, /open line/);
  assert.equal(list[2].items[0].name, 'unnamed drawing #5');
});

test('a circle drawing becomes 64 points; an oval already has 64', () => {
  const o = g.outlineFromDrawing({ primitiveType: 'Polygon', polygonMode: 'circle', lat: 36.5, lon: 35.5, radius: 15 * 1852, name: 'CAP' });
  assert.equal(o.ok, true); assert.equal(o.points.length, 64); assert.match(o.shape, /circle 15 NM/);
});

test('picking COPIES the points and sets the drawingRef with the mission fingerprint', () => {
  const md = { theatre: 'Syria', waypoints: [{ name: 'A' }], drawings: [drawing()] };
  const pick = g.geometryFromDrawing(md.drawings, 0, md);
  assert.equal(pick.geometry.source, 'DCS_DRAWING');
  assert.deepEqual(pick.geometry.drawingRef, { layerName: 'Common', objectName: 'ADANA SOUTH MOA', missionFingerprint: g.missionFingerprint(md) });
  assert.deepEqual(pick.geometry.points, square);
  md.drawings[0].points[0].lat = 10; // the drawing moving later does not move the copy
  assert.deepEqual(pick.geometry.points[0], [36, 35]);
  assert.equal(validateAirspaceDefinition({ airspaceId: 'MOA-X', name: 'X', kind: 'AREA', type: 'MOA', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP', geometry: pick.geometry }).ok, true);
});

const freehand = (n, wobble = 0.00002) => Array.from({ length: n }, (_, i) => { const a = (i / n) * 2 * Math.PI; return { lat: 36.5 + 0.3 * Math.sin(a) + (i % 2 ? wobble : 0), lon: 35.5 + 0.4 * Math.cos(a) }; });

test('AP2B-Q1: over 200 points is simplified within 0.1 NM and not refused', () => {
  const d = drawing({ name: 'FREE', points: freehand(412) });
  const o = g.outlineFromDrawing(d);
  assert.equal(o.ok, true);
  assert.equal(o.simplifiedFrom, 412);
  assert.ok(o.points.length <= 200 && o.points.length >= 3, `${o.points.length}`);
  const row = g.listDrawings([d])[0].items[0];
  assert.equal(row.eligible, true); assert.equal(row.simplifiedFrom, 412);
  const pick = g.geometryFromDrawing([d], 0, { theatre: 'Syria', drawings: [d] });
  assert.equal(pick.simplifiedFrom, 412);
});

test('AP2B-Q1: refused only if the simplified ring crosses itself', () => {
  // a thin bow-tie with 300 points on each lobe: simplification keeps the crossing
  const lobe = (sign) => Array.from({ length: 150 }, (_, i) => ({ lat: 36 + sign * (i / 150) * 0.5, lon: 35 + (i / 150) * 0.5 }));
  const pts = [...lobe(1), { lat: 36.5, lon: 35.5 }, ...lobe(-1).reverse()];
  const crossing = [{ lat: 36, lon: 35 }, { lat: 37, lon: 36 }, { lat: 37, lon: 35 }, { lat: 36, lon: 36 }];
  const many = []; for (let i = 0; i < crossing.length; i++) { const a = crossing[i]; const b = crossing[(i + 1) % 4]; for (let k = 0; k < 80; k++) many.push({ lat: a.lat + (b.lat - a.lat) * k / 80, lon: a.lon + (b.lon - a.lon) * k / 80 }); }
  assert.ok(many.length > 200);
  const o = g.outlineFromDrawing(drawing({ points: many }));
  assert.equal(o.ok, false); assert.match(o.reason, /crosses itself/);
  void pts;
});

test('simplifyRing keeps every point within the tolerance of the original', () => {
  const ring = freehand(412).map(p => [p.lat, p.lon]);
  const s = g.simplifyRing(ring, 0.1);
  assert.ok(s.length < ring.length);
  // every original point lies within 0.1 NM (+ rounding) of the simplified ring
  const distToRing = (p) => Math.min(...s.map((a, i) => { const b = s[(i + 1) % s.length]; let best = Infinity; for (let t = 0; t <= 1; t += 0.02) best = Math.min(best, g.distanceNm(p, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])); return best; }));
  for (const p of ring) assert.ok(distToRing(p) < 0.15, `${distToRing(p)}`);
});

test('outline status: none, drawn, picked, moved drawing (Refresh), drawing absent, locked', () => {
  const md = { theatre: 'Syria', drawings: [drawing()] };
  const picked = g.geometryFromDrawing(md.drawings, 0, md).geometry;
  let s = g.outlineStatus({ geometry: null, savedGeometry: null, drawings: md.drawings });
  assert.equal(s.source, 'NONE'); assert.equal(s.canClear, false); assert.equal(s.drawLabel, 'Draw on map'); assert.match(s.refresh.why, /no drawing picked/);
  s = g.outlineStatus({ geometry: g.polygonGeometry(square), savedGeometry: null, drawings: [] });
  assert.equal(s.source, 'DRAWN'); assert.equal(s.changed, true); assert.equal(s.drawLabel, 'Edit on map'); assert.match(s.refresh.why, /drawn, not copied/);
  s = g.outlineStatus({ geometry: picked, savedGeometry: picked, drawings: md.drawings });
  assert.equal(s.source, 'DCS DRAWING'); assert.equal(s.changed, false); assert.equal(s.refresh.enabled, false); assert.match(s.refresh.why, /matches the drawing/);
  const moved = [drawing({ points: [...square.map(([lat, lon]) => ({ lat, lon })), { lat: 36.5, lon: 34.5 }] })];
  s = g.outlineStatus({ geometry: picked, savedGeometry: picked, drawings: moved });
  assert.equal(s.refresh.enabled, true); assert.equal(s.refresh.newCount, 5);
  assert.equal(g.refreshGeometry(picked, moved, md).points.length, 5);
  s = g.outlineStatus({ geometry: picked, savedGeometry: picked, drawings: [] });
  assert.equal(s.refresh.enabled, false); assert.match(s.refresh.why, /not in the loaded mission/); assert.equal(g.refreshGeometry(picked, [], md), null);
  s = g.outlineStatus({ geometry: picked, savedGeometry: picked, drawings: moved, readOnlyReason: 'airspace is ACTIVE: only name and frequencies can change' });
  assert.equal(s.canDraw, false); assert.equal(s.canPick, false); assert.equal(s.canClear, false); assert.equal(s.refresh.enabled, false);
  assert.match(s.refresh.why, /ACTIVE/);
  s = g.outlineStatus({ geometry: null, savedGeometry: picked, drawings: [] });
  assert.equal(s.changed, true); // cleared, not saved
});

const segs = () => [
  { fix: { name: 'A', lat: 37.35, lon: 35.35 }, altLowerFt: 500, altUpperFt: 3000, widthNm: null },
  { fix: { name: 'SARIN', lat: 37.2, lon: 35.65 }, altLowerFt: 1000, altUpperFt: 6000, widthNm: 10 },
  { fix: { name: 'TOPAK', lat: 36.98, lon: 36.15 }, altLowerFt: null, altUpperFt: null, widthNm: null },
];

test('route table to segments and back; the exit fix carries no legs; the envelope; widths default', () => {
  const rows = g.rowsFromSegments(segs());
  assert.equal(rows.length, 3);
  rows[2].altLowerFt = 999; rows[2].widthNm = 3; // junk on the exit row never reaches the wire
  const back = g.segmentsFromRows(rows);
  assert.deepEqual(back[2], { fix: { name: 'TOPAK', lat: 36.98, lon: 36.15 }, altLowerFt: null, altUpperFt: null, widthNm: null });
  assert.deepEqual(g.routeEnvelope(rows), { altLowerFt: 500, altUpperFt: 6000 });
  assert.equal(g.legWidthNm(rows[0], 4), 4); assert.equal(g.legWidthNm(rows[1], 4), 10);
  const def = { airspaceId: 'VR1207', name: 'VR1207', kind: 'ROUTE', type: 'VR', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', defaultWidthNm: 4, segments: back };
  assert.equal(validateAirspaceDefinition(def, { derived: 'recompute' }).ok, true);
  assert.match(g.routeSummary(rows, 4), /3 fixes, 2 legs, one leg different/);
});

test('route table: add, remove (never below 2), the cap', () => {
  let rows = g.rowsFromSegments(segs());
  rows = g.addFix(rows, { name: 'Z', lat: 1, lon: 2 });
  assert.equal(rows.length, 4); assert.equal(rows[3].name, 'Z');
  assert.equal(g.removeFix(rows, 0).length, 3);
  assert.equal(g.removeFix(g.removeFix(g.removeFix(rows, 0), 0), 0).length, 2);
  assert.equal(g.canAddFix(Array.from({ length: 100 }, () => ({}))), false);
});

test('the fingerprint is a hand copy of the server\'s (parity)', () => {
  const md = { theatre: 'Syria', waypoints: [{ name: 'A' }, { id: 'b' }], drawings: [{ name: 'D1' }, { name: '' }, {}] };
  assert.equal(g.missionFingerprint(md), server.missionFingerprint(md));
  assert.equal(g.missionFingerprint(null), server.missionFingerprint(null));
  assert.equal(g.missionFingerprint({}), server.missionFingerprint({}));
});

test('a sketch svg is made of numbers only', () => {
  assert.match(g.sketchSvg(square), /^<svg.*<polygon/);
  assert.match(g.sketchSvg(null), /no outline/);
});
