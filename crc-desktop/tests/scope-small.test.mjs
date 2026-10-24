// U-SCOPE-SMALL (live test 2026-10-20): Settings → Declutter's "DCS drawings" and "Airport surface" switches, the airspace
// editor picker's drawing highlight, and the airport surface layers of the scope style.
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { freshGraph, CLIENT_JS } from './helpers/fresh-graph.mjs';

const poly = (name, pts, extra = {}) => ({ primitiveType: 'Polygon', polygonMode: 'free', closed: true, name, layerName: 'Common', points: pts.map(([lat, lon]) => ({ lat, lon })), ...extra });
const DRAWINGS = [
  poly('BOX', [[36, 35], [36, 36], [37, 36], [37, 35]]),
  { primitiveType: 'TextBox', text: 'hello', lat: 36, lon: 35, name: 'LABEL', layerName: 'Author' },
  { primitiveType: 'Polyline', polygonMode: '', closed: false, name: 'LINE', layerName: 'Blue', points: [{ lat: 36, lon: 35 }, { lat: 37, lon: 36 }] },
  { primitiveType: 'Polygon', polygonMode: 'circle', lat: 36.5, lon: 35.5, radius: 10000, name: 'RING', layerName: 'Red' },
];

async function drawingsWith(drawingsEnabled) {
  const g = freshGraph();
  const { settings } = await g.import('settings.js');
  const picture = await g.import('picture.js');
  const { buildDrawings } = await g.import('geojson.js');
  if (drawingsEnabled !== undefined) settings.drawingsEnabled = drawingsEnabled;
  picture.setMissionData({ drawings: DRAWINGS });
  return buildDrawings();
}

test('the drawings and airport surface switches are on by default, in the Declutter tab with the text marks', async () => {
  const { settings } = await freshGraph().import('settings.js');
  assert.equal(settings.drawingsEnabled, true);
  assert.equal(settings.airportSurface, true);
  assert.equal(settings.textMarksEnabled, false);
  const html = fs.readFileSync(path.join(CLIENT_JS, '../index.html'), 'utf8');
  const declutter = html.slice(html.indexOf('id="stab-radar"'), html.indexOf('id="stab-srs"'));
  for (const id of ['set-drawings', 'set-text-marks', 'set-airport-surface']) assert.match(declutter, new RegExp(`id="${id}"`));
  assert.equal(html.match(/id="set-text-marks"/g).length, 1);
});

test('drawings on: every shape is drawn with its index (T28 hides by it); a text box is not a shape', async () => {
  const fc = await drawingsWith(undefined);
  assert.deepEqual(fc.features.map(f => [f.properties.idx, f.geometry.type]), [[0, 'Polygon'], [2, 'LineString'], [3, 'Polygon']]);
});

test('drawings off: no shape is drawn', async () => {
  assert.deepEqual((await drawingsWith(false)).features, []);
});

test('the highlight is the drawing\'s outline as one closed line; a text box or a bad index gives none', async () => {
  const { buildDrawingHighlight, highlightBounds } = await freshGraph().import('drawing-highlight.js');
  const box = buildDrawingHighlight(DRAWINGS, 0);
  assert.equal(box.features.length, 1);
  assert.equal(box.features[0].geometry.type, 'LineString');
  assert.deepEqual(box.features[0].geometry.coordinates, [[35, 36], [36, 36], [36, 37], [35, 37], [35, 36]]);
  assert.deepEqual(highlightBounds(box), [[35, 36], [36, 37]]);
  assert.deepEqual(buildDrawingHighlight(DRAWINGS, 2).features[0].geometry.coordinates, [[35, 36], [36, 37]]);
  const ring = buildDrawingHighlight(DRAWINGS, 3).features[0].geometry.coordinates;
  assert.equal(ring.length, 65);
  for (const i of [1, 9, undefined, -1]) assert.deepEqual(buildDrawingHighlight(DRAWINGS, i).features, []);
  assert.equal(highlightBounds(buildDrawingHighlight(DRAWINGS, 1)), null);
});

test('the highlight does not follow the drawings switch', async () => {
  const g = freshGraph();
  const { settings } = await g.import('settings.js');
  settings.drawingsEnabled = false;
  const { buildDrawingHighlight } = await g.import('drawing-highlight.js');
  assert.equal(buildDrawingHighlight(DRAWINGS, 0).features.length, 1);
});

test('airport surface: shown when on and a surface Position is held, on any background (H162); off or not held hides it', async () => {
  const { airportSurfaceVisibility } = await freshGraph().import('airport-surface.js');
  assert.equal(airportSurfaceVisibility({ enabled: true, held: true }), 'visible');
  assert.equal(airportSurfaceVisibility({ enabled: undefined, held: true }), 'visible');
  assert.equal(airportSurfaceVisibility({ enabled: false, held: true }), 'none');
  assert.equal(airportSurfaceVisibility({ enabled: true, held: false }), 'none');
});

test('the scope style has every surface layer on the aeroway source-layer; the runway lines are not one of them', async () => {
  const { AIRPORT_SURFACE_LAYERS } = await freshGraph().import('airport-surface.js');
  const style = JSON.parse(fs.readFileSync(path.join(CLIENT_JS, '../crc-desktop-scope-style.json'), 'utf8'));
  const byId = new Map(style.layers.map(l => [l.id, l]));
  assert.equal(byId.size, style.layers.length, 'layer ids are unique');
  for (const id of AIRPORT_SURFACE_LAYERS) {
    assert.ok(byId.has(id), id);
    assert.equal(byId.get(id)['source-layer'], 'aeroway', id);
    assert.notEqual((byId.get(id).layout || {}).visibility, 'none', `${id} starts visible: the switch is on by default`);
  }
  assert.ok(!AIRPORT_SURFACE_LAYERS.includes('Aeroway'));
  assert.deepEqual(byId.get('Aeroway').filter, ['all', ['==', '$type', 'LineString'], ['==', 'class', 'runway']]);
  // Pavement, then the taxiway and runway lines, then their names, all below the place names.
  const order = ['Airport zone', 'Airport pavement', 'Taxiway', 'Aeroway', 'Runway designators', 'Taxiway labels', 'Country labels'];
  const at = order.map(id => style.layers.findIndex(l => l.id === id));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
});
