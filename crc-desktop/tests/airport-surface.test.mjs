// U-SURFACE (H162, H156 SC-Q1, H160): the airport surface shows only while the controller holds (Primary or Observer) a
// Position its own Facility lists in `airportSurfacePositions`, on the map background and on the black ATC scope alike;
// on the black scope it draws in the video map's dim grey. Facilities are generated (N of them), never the shipped ids.
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshGraph } from './helpers/fresh-graph.mjs';
import { permissive } from './helpers/client-env.mjs';

const N = 12;
/** N generated Facilities: every even one lists two of its four Positions, every odd one lists none (or omits the key). */
function generated() {
  const byFacility = {};
  const positions = {};
  for (let i = 0; i < N; i++) {
    const f = `FAC${i}`;
    positions[f] = [0, 1, 2, 3].map(k => `F${i}P${k}`);
    if (i % 2 === 0) byFacility[f] = [positions[f][1], positions[f][2]];
    else if (i % 4 === 1) byFacility[f] = [];
  }
  return { byFacility, positions };
}

test('held: a listed Position of its own Facility, for every generated Facility; an unlisted one never', async () => {
  const { airportSurfaceHeld } = await freshGraph().import('airport-surface.js');
  const { byFacility, positions } = generated();
  for (const [f, list] of Object.entries(positions)) {
    for (const p of list) {
      const signedOn = (fac) => (fac === f ? [p] : []);
      const listed = (byFacility[f] || []).includes(p);
      assert.equal(airportSurfaceHeld(byFacility, signedOn), listed, `${f}/${p}`);
    }
  }
  assert.equal(airportSurfaceHeld(byFacility, () => []), false, 'nothing held');
  assert.equal(airportSurfaceHeld({}, () => ['F0P1']), false, 'no Facility lists any');
});

test('held: a Position id held at a Facility that does not list it does not count (own Facility only)', async () => {
  const { airportSurfaceHeld } = await freshGraph().import('airport-surface.js');
  const { byFacility } = generated();
  // FAC0 lists F0P1; the same id claimed at FAC2 is not FAC0's.
  assert.equal(airportSurfaceHeld(byFacility, (f) => (f === 'FAC2' ? ['F0P1'] : [])), false);
});

test('held: together with Positions of Facilities that list none (an airport Position with a radar one)', async () => {
  const { airportSurfaceHeld } = await freshGraph().import('airport-surface.js');
  const { byFacility } = generated();
  const holding = { FAC1: ['F1P0'], FAC3: ['F3P2'], FAC4: ['F4P2'] };
  assert.equal(airportSurfaceHeld(byFacility, (f) => holding[f] || []), true);
  delete holding.FAC4;
  assert.equal(airportSurfaceHeld(byFacility, (f) => holding[f] || []), false);
});

test('visibility: switch on and held; black scope or not; switch off or not held hides it', async () => {
  const { airportSurfaceVisibility } = await freshGraph().import('airport-surface.js');
  for (const black of [false, true]) {
    assert.equal(airportSurfaceVisibility({ enabled: true, held: true, black }), 'visible', `black ${black}`);
    assert.equal(airportSurfaceVisibility({ enabled: undefined, held: true, black }), 'visible', 'default on');
    assert.equal(airportSurfaceVisibility({ enabled: false, held: true, black }), 'none');
    assert.equal(airportSurfaceVisibility({ enabled: true, held: false, black }), 'none');
    assert.equal(airportSurfaceVisibility({ enabled: true, black }), 'none', 'held must be said');
  }
});

test('the snapshot table: set, read per Facility, replaced whole, cleared', async () => {
  const g = freshGraph();
  const surface = await g.import('airport-surface.js');
  const { byFacility } = generated();
  surface.setAirportSurfacePositions(byFacility);
  assert.deepEqual(surface.getAirportSurfacePositions(), byFacility);
  byFacility.FAC0.push('MUTATED');
  assert.ok(!surface.getAirportSurfacePositions().FAC0.includes('MUTATED'), 'a copy');
  surface.setAirportSurfacePositions({ X: ['Y'] });
  assert.deepEqual(surface.getAirportSurfacePositions(), { X: ['Y'] });
  surface.setAirportSurfacePositions(undefined);
  assert.deepEqual(surface.getAirportSurfacePositions(), {});
});

test('the snapshot fills the table, and a reset clears it', async () => {
  const g = freshGraph();
  const surface = await g.import('airport-surface.js');
  const state = await g.import('panels/efsp/efsp-state.js');
  const { byFacility } = generated();
  state.applyEfspSnapshot({ type: 'efsp-snapshot', facilities: Object.keys(byFacility), airportSurfacePositions: byFacility });
  assert.deepEqual(surface.getAirportSurfacePositions(), byFacility);
  state.applyEfspSnapshot({ type: 'efsp-snapshot', facilities: [] });
  assert.deepEqual(surface.getAirportSurfacePositions(), {});
});

test('paint: on black every surface layer is dim grey or darker, never brighter than the runways; off black the theme\'s', async () => {
  const { airportSurfacePaint, AIRPORT_SURFACE_LAYERS } = await freshGraph().import('airport-surface.js');
  const { ATC_DIM_GRAY } = await freshGraph().import('atc-scope.js');
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255); };
  const black = airportSurfacePaint({ black: true, gray: ATC_DIM_GRAY });
  assert.deepEqual([...new Set(black.map(([id]) => id))].sort(), [...AIRPORT_SURFACE_LAYERS].sort(), 'every surface layer painted');
  for (const [id, prop, value] of black) {
    assert.equal(typeof value, 'string', `${id} ${prop}`);
    const grey = /^#([0-9A-F]{2})\1\1$/i.test(value);
    assert.ok(grey, `${id} ${prop} ${value} is a grey`);
    assert.ok(lum(value) <= lum(ATC_DIM_GRAY), `${id} ${prop} ${value} not brighter than the runways`);
  }
  const fill = black.find(([id, prop]) => id === 'Airport pavement' && prop === 'fill-color')[2];
  const outline = black.find(([id, prop]) => id === 'Airport pavement' && prop === 'fill-outline-color')[2];
  assert.ok(lum(fill) < lum(outline), 'pavement a dark fill with a lighter outline');
  for (const light of [false, true]) {
    const theme = airportSurfacePaint({ black: false, light });
    assert.deepEqual(theme.map(([id, prop]) => `${id}|${prop}`), black.map(([id, prop]) => `${id}|${prop}`), 'restores every property black set');
    assert.notDeepEqual(theme, black);
  }
  assert.notDeepEqual(airportSurfacePaint({ black: false, light: true }), airportSurfacePaint({ black: false, light: false }));
});

/** A stub MapLibre map that records layout and paint, with every layer present. */
function stubMap() {
  const layout = new Map(); const paint = new Map();
  return {
    layout, paint,
    getLayer: () => ({}),
    setLayoutProperty: (id, k, v) => layout.set(`${id}|${k}`, v),
    setPaintProperty: (id, k, v) => paint.set(`${id}|${k}`, v),
    getLayoutProperty: (id, k) => layout.get(`${id}|${k}`),
    updateImage() {}, getSource: () => ({ setData() {} }),
  };
}

test('the map follows the snapshot table and sign-on/off live, and greys the surface on black, restoring the theme after', async () => {
  const g = freshGraph();
  const handle = await g.import('map-handle.js');
  const m = stubMap();
  handle._setMap(m); handle._setMapReady(true);
  const style = await g.import('map-style.js');
  const state = await g.import('panels/efsp/efsp-state.js');
  const ws = await g.import('panels/efsp/efsp-ws.js');
  const bus = await g.import('panels/efsp/efsp-change-bus.js');
  const { AIRPORT_SURFACE_LAYERS, airportSurfacePaint } = await g.import('airport-surface.js');
  const { ATC_DIM_GRAY } = await g.import('atc-scope.js');
  const vis = () => AIRPORT_SURFACE_LAYERS.map(id => m.layout.get(`${id}|visibility`));
  const all = (v) => AIRPORT_SURFACE_LAYERS.map(() => v);
  const { byFacility } = generated();
  const signOn = (f, list) => { ws.noteEfspPositionsAck({ facilityId: f, signedOn: list }); bus.markEfspChanged('positions'); };

  state.applyEfspSnapshot({ type: 'efsp-snapshot', facilities: Object.keys(byFacility), airportSurfacePositions: byFacility });
  bus.markEfspChanged('snapshot');
  assert.deepEqual(vis(), all('none'), 'nothing held');
  signOn('FAC3', ['F3P0']);
  assert.deepEqual(vis(), all('none'), 'only a Facility that lists none');
  signOn('FAC6', ['F6P2']);
  assert.deepEqual(vis(), all('visible'), 'a listed Position held');
  // the black scope keeps it, in grey
  style.applyAirportSurface(true);
  assert.deepEqual(vis(), all('visible'));
  for (const [id, prop, value] of airportSurfacePaint({ black: true, gray: ATC_DIM_GRAY })) assert.deepEqual(m.paint.get(`${id}|${prop}`), value, `${id} ${prop}`);
  // the background back: the theme's paint (applyMapTheme redraws icons on a canvas)
  const createElement = document.createElement;
  document.createElement = (t) => { const el = createElement(t); if (t === 'canvas') el.getContext = () => permissive(); return el; };
  try { style.applyAtcBackground(false); } finally { document.createElement = createElement; }
  for (const [id, prop, value] of airportSurfacePaint({ light: false })) assert.deepEqual(m.paint.get(`${id}|${prop}`), value, `${id} ${prop} restored`);
  assert.deepEqual(vis(), all('visible'));
  // the switch off hides it though held
  const { settings } = await g.import('settings.js');
  settings.airportSurface = false; style.applyAirportSurface();
  assert.deepEqual(vis(), all('none'));
  settings.airportSurface = true; style.applyAirportSurface();
  // signing off hides it
  signOn('FAC6', []);
  assert.deepEqual(vis(), all('none'), 'signed off');
  handle._setMapReady(false); handle._setMap(undefined);
});
