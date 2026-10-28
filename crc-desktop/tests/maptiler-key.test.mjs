import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMaptilerKey, maptilerKey, onMaptilerKey, transformMaptilerRequest, _resetMaptilerKeyForTest } from '../app/public/js/maptiler-key.js';

const reply = (body, ok = true) => async () => ({ ok, status: ok ? 200 : 401, json: async () => body });
const quiet = () => { const w = console.warn; console.warn = () => {}; return () => { console.warn = w; }; };

test('no key: MapTiler URLs pass through unchanged, and so does everything else', () => {
  _resetMaptilerKeyForTest();
  assert.equal(maptilerKey(), null);
  assert.deepEqual(transformMaptilerRequest('https://api.maptiler.com/fonts/A/0-255.pbf'), { url: 'https://api.maptiler.com/fonts/A/0-255.pbf' });
});

test('with a key: MapTiler URLs get it (replacing any), other hosts do not', async () => {
  _resetMaptilerKeyForTest();
  assert.equal(await loadMaptilerKey('tok', reply({ maptilerKey: 'k 1' })), 'k 1');
  assert.equal(maptilerKey(), 'k 1');
  assert.equal(transformMaptilerRequest('https://api.maptiler.com/tiles/v3/1/2/3.pbf').url, 'https://api.maptiler.com/tiles/v3/1/2/3.pbf?key=k%201');
  assert.equal(transformMaptilerRequest('https://api.maptiler.com/x?a=1&key=old&b=2').url, 'https://api.maptiler.com/x?a=1&b=2&key=k%201');
  assert.equal(transformMaptilerRequest('https://api.maptiler.com/x?key=old').url, 'https://api.maptiler.com/x?key=k%201');
  assert.equal(transformMaptilerRequest('https://example.com/a.pbf').url, 'https://example.com/a.pbf');
  assert.equal(transformMaptilerRequest('https://api.maptiler.com.evil.test/a').url, 'https://api.maptiler.com.evil.test/a');
});

test('loadMaptilerKey sends the bearer token, never throws, and notifies only on a new key', async () => {
  _resetMaptilerKeyForTest();
  const restore = quiet();
  try {
    const seen = [];
    onMaptilerKey((k) => seen.push(k));
    let headers;
    await loadMaptilerKey('tok', async (url, init) => { assert.equal(url, '/api/client-config'); headers = init.headers; return reply({ maptilerKey: 'a' })(); });
    assert.equal(headers.Authorization, 'Bearer tok');
    await loadMaptilerKey('tok', reply({ maptilerKey: 'a' }));
    assert.deepEqual(seen, ['a']);
    await loadMaptilerKey('tok', reply({ maptilerKey: 'b' }));
    assert.deepEqual(seen, ['a', 'b']);
    assert.equal(await loadMaptilerKey('tok', reply({}, false)), null);
    assert.equal(await loadMaptilerKey('tok', async () => { throw new Error('down'); }), null);
    assert.equal(await loadMaptilerKey('tok', reply({ maptilerKey: null })), null);
    assert.equal(maptilerKey(), null);
  } finally { restore(); }
});
