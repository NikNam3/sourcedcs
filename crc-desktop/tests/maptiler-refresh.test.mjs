// Live test T3: glyphs (and tiles) that failed before the MapTiler key arrived are asked for again once it does.
// maplibre 3.6.2 never re-requests an errored tile on its own (SourceCache.reload skips it), so map-setup.js drops
// the errored tiles of each source when the key lands. Stubbed source caches; the real map is the e2e spec's.
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { retryErroredTiles } from '../app/public/js/map-setup.js';

function cache(states) {
  const c = {
    tiles: Object.fromEntries(states.map((s, i) => [String(i), { state: s }])),
    cleared: 0, updated: [],
    getIds() { return Object.keys(this.tiles); },
    getTileByID(id) { return this.tiles[id]; },
    clearTiles() { this.cleared += 1; this.tiles = {}; },
    update(transform, terrain) { this.updated.push([transform, terrain]); },
  };
  return c;
}

test('a source with an errored tile is cleared and asked for again; a healthy one is left alone', () => {
  const labels = cache(['loaded', 'errored']);
  const basemap = cache(['errored']);
  const units = cache(['loaded', 'loaded']);
  const transform = { zoom: 7 };
  assert.equal(retryErroredTiles({ labels, basemap, units }, transform, null), 2);
  assert.equal(labels.cleared, 1);
  assert.deepEqual(labels.updated, [[transform, null]]);
  assert.equal(basemap.cleared, 1);
  assert.equal(units.cleared, 0, 'no flicker for a source that loaded');
  assert.deepEqual(units.updated, []);
});

test('nothing errored, no style yet: nothing to do', () => {
  assert.equal(retryErroredTiles({ a: cache(['loaded']) }, {}, null), 0);
  assert.equal(retryErroredTiles(undefined, {}, null), 0);
  assert.equal(retryErroredTiles({ odd: {} }, {}, null), 0);
});
