// U-GLYPHS 1b: the basemap leaves MapTiler for OpenFreeMap when MapTiler can't be used, stays there until a new key
// arrives, and never flaps. Stubbed source; the real map is e2e/basemap-fallback.spec.js's.
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASEMAP_SOURCE, FALLBACK_TILEJSON, MAPTILER_TILES, FALLBACK_ATTRIBUTION, MAPTILER_ATTRIBUTION,
  shouldFallBack, pointBasemap, createBasemapFallback,
} from '../app/public/js/basemap-fallback.js';

const TILE = 'https://api.maptiler.com/tiles/v3/7/76/50.pbf';

test('the errors that leave MapTiler: no key, refused, over quota, outage, network', () => {
  for (const status of [401, 403, 429, 500, 503, undefined, 0]) {
    assert.equal(shouldFallBack({ onFallback: false, sourceId: BASEMAP_SOURCE, status, url: TILE, key: null }), true, String(status));
  }
  assert.equal(shouldFallBack({ onFallback: false, sourceId: BASEMAP_SOURCE, url: undefined, key: null }), true, 'a network error has no url');
});

test('the errors that do not', () => {
  const base = { onFallback: false, sourceId: BASEMAP_SOURCE, status: 403, url: TILE, key: null };
  assert.equal(shouldFallBack({ ...base, status: 404 }), false, 'a missing tile');
  assert.equal(shouldFallBack({ ...base, status: 400 }), false);
  assert.equal(shouldFallBack({ ...base, onFallback: true }), false, 'already on the fallback: no flapping');
  assert.equal(shouldFallBack({ ...base, sourceId: 'units' }), false, 'another source');
  assert.equal(shouldFallBack({ ...base, sourceId: undefined }), false, 'a sprite or style error has no source');
  assert.equal(shouldFallBack({ ...base, url: 'https://tiles.openfreemap.org/planet/x/7/76/50.pbf' }), false);
  assert.equal(shouldFallBack({ ...base, key: 'k1' }), false, 'a keyless request from before the key arrived is stale');
  assert.equal(shouldFallBack({ ...base, key: 'k1', url: TILE + '?key=k1' }), true, 'the current key refused');
});

function fakeMap() {
  const src = {
    _options: { type: 'vector', tiles: MAPTILER_TILES.slice() }, loads: 0,
    setSourceProperty(fn) { fn(); this.loads += 1; },
  };
  return { src, getSource: (id) => (id === BASEMAP_SOURCE ? src : undefined) };
}

test('pointBasemap swaps the source in place, tiles for the TileJSON and back, with its attribution', () => {
  const map = fakeMap();
  assert.equal(pointBasemap(map, 'fallback'), true);
  assert.equal(map.src._options.tiles, undefined, "the options' tiles would win over the TileJSON's");
  assert.equal(map.src._options.url, FALLBACK_TILEJSON);
  assert.equal(map.src.attribution, FALLBACK_ATTRIBUTION);
  assert.equal(pointBasemap(map, 'maptiler'), true);
  assert.deepEqual(map.src._options.tiles, MAPTILER_TILES);
  assert.equal(map.src._options.url, undefined);
  assert.equal(map.src.attribution, MAPTILER_ATTRIBUTION);
  assert.equal(map.src.loads, 2);
  assert.equal(pointBasemap({ getSource: () => undefined }, 'fallback'), false, 'no style yet');
  assert.equal(pointBasemap(null, 'fallback'), false);
});

test('a session falls back once, stays there, and returns only when a new key arrives', () => {
  const map = fakeMap();
  let key = null;
  const seen = [];
  const fb = createBasemapFallback({ getMap: () => map, getKey: () => key, onChange: (s) => seen.push(s) });
  assert.equal(fb.state, 'maptiler');
  assert.equal(fb.onMapError({ sourceId: 'units', error: { status: 403 } }), false);
  assert.equal(fb.onMapError({ sourceId: BASEMAP_SOURCE, error: { status: 403, url: TILE } }), true);
  assert.equal(fb.state, 'fallback');
  assert.equal(map.src._options.url, FALLBACK_TILEJSON);
  // More MapTiler 403s still in flight: no second switch.
  assert.equal(fb.onMapError({ sourceId: BASEMAP_SOURCE, error: { status: 403, url: TILE } }), false);
  assert.equal(map.src.loads, 1);
  // A hole in the fallback planet is not a dead fallback.
  fb.onMapError({ sourceId: BASEMAP_SOURCE, error: { status: 404 } });
  assert.equal(fb.state, 'fallback');

  key = 'k1';
  assert.equal(fb.onKey(), true);
  assert.equal(fb.state, 'maptiler');
  assert.deepEqual(map.src._options.tiles, MAPTILER_TILES);
  // A keyless 403 from before the key: ignored. The new key refused: back to the fallback.
  assert.equal(fb.onMapError({ sourceId: BASEMAP_SOURCE, error: { status: 403, url: TILE } }), false);
  assert.equal(fb.onMapError({ sourceId: BASEMAP_SOURCE, error: { status: 403, url: TILE + '?key=k1' } }), true);
  // The fallback fails too: nothing to switch to, the notice says so.
  assert.equal(fb.onMapError({ sourceId: BASEMAP_SOURCE, error: { status: 503 } }), false);
  assert.equal(fb.state, 'none');
  assert.equal(fb.onKey(), true, 'a new key tries MapTiler again from none');
  assert.deepEqual(seen, ['fallback', 'maptiler', 'fallback', 'none', 'maptiler']);
  const loads = map.src.loads;
  assert.equal(fb.onKey(), false, 'already on MapTiler: no state change');
  assert.equal(map.src.loads, loads + 1, 'but the source reloads, dropping tiles that errored without the key');
});
