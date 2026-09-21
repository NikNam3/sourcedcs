'use strict';

/* Client-side half of §9.10's stereo route table (docs/adr/0050) — the same
   "never throws, degrades to an empty list" contract
   efsp-flight-plan-lookup-client.test.js pins for its own module, verified
   the same way: an injectable fetchImpl, no real network and no DOM. */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  listStereoRoutesClient, normalizeStereoNameClient, STEREO_ROUTES_CLIENT_TIMEOUT_MS,
} = require('../app/public/js/panels/efsp/efsp-stereo-routes.js');

function fakeFetch(status, body) {
  return async () => ({ ok: status >= 200 && status < 300, json: async () => body });
}

const ROUTES = [
  { name: 'PACK 1', description: 'north MOA', route: 'LTAG DCT ALPHA', requestedAltitude: '250' },
  { name: 'PACK 2', route: 'LTAG DCT BRAVO' },
];

test('a successful fetch returns the route list', async () => {
  const result = await listStereoRoutesClient({ fetchImpl: fakeFetch(200, { ok: true, routes: ROUTES }), authHeaders: () => ({}) });
  assert.deepEqual(result, ROUTES);
});

test('an empty table is a normal answer, not a failure — it is what ships', async () => {
  const result = await listStereoRoutesClient({ fetchImpl: fakeFetch(200, { ok: true, routes: [] }), authHeaders: () => ({}) });
  assert.deepEqual(result, []);
});

test('a non-2xx status resolves to an empty list, never a throw', async () => {
  assert.deepEqual(await listStereoRoutesClient({ fetchImpl: fakeFetch(503, {}), authHeaders: () => ({}) }), []);
  assert.deepEqual(await listStereoRoutesClient({ fetchImpl: fakeFetch(401, {}), authHeaders: () => ({}) }), []);
});

test('a malformed body resolves to an empty list', async () => {
  for (const body of [null, {}, { ok: true }, { ok: false, routes: ROUTES }, { ok: true, routes: 'PACK 1' }]) {
    assert.deepEqual(await listStereoRoutesClient({ fetchImpl: fakeFetch(200, body), authHeaders: () => ({}) }), [],
      JSON.stringify(body));
  }
});

test('a record with no name or no route is dropped rather than offered as an unusable option', async () => {
  const mixed = [{ name: 'PACK 1', route: 'A' }, { name: '', route: 'B' }, { name: 'PACK 3' }, null];
  const result = await listStereoRoutesClient({ fetchImpl: fakeFetch(200, { ok: true, routes: mixed }), authHeaders: () => ({}) });
  assert.deepEqual(result, [{ name: 'PACK 1', route: 'A' }]);
});

test('a network error never throws — an empty list instead, so filing by hand still works', async () => {
  const throwingFetch = async () => { throw new Error('network error'); };
  await assert.doesNotReject(async () => {
    assert.deepEqual(await listStereoRoutesClient({ fetchImpl: throwingFetch, authHeaders: () => ({}) }), []);
  });
});

test('a body that is not JSON at all never throws', async () => {
  const badJson = async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token'); } });
  await assert.doesNotReject(async () => {
    assert.deepEqual(await listStereoRoutesClient({ fetchImpl: badJson, authHeaders: () => ({}) }), []);
  });
});

test('the request is bounded — a fetch that never settles resolves empty on the timeout', async () => {
  // Honours the abort signal, the way a real fetch does; without that this
  // would hang the suite rather than fail it.
  const hangingFetch = (_url, opts) => new Promise((_resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  assert.deepEqual(await listStereoRoutesClient({ fetchImpl: hangingFetch, timeoutMs: 10, authHeaders: () => ({}) }), []);
});

test('the auth headers the caller supplies are what go on the request', async () => {
  let seen = null;
  const capturingFetch = async (_url, opts) => { seen = opts.headers; return { ok: true, json: async () => ({ ok: true, routes: [] }) }; };
  await listStereoRoutesClient({ fetchImpl: capturingFetch, authHeaders: () => ({ Authorization: 'Bearer t' }) });
  assert.deepEqual(seen, { Authorization: 'Bearer t' });
});

test('it calls the same-origin proxy path, never crc-sync directly', async () => {
  let seen = null;
  const capturingFetch = async (url) => { seen = url; return { ok: true, json: async () => ({ ok: true, routes: [] }) }; };
  await listStereoRoutesClient({ fetchImpl: capturingFetch, authHeaders: () => ({}) });
  assert.equal(seen, '/api/stereo-routes');
});

test('the default timeout is bounded and matches the flight-plan client\'s', () => {
  assert.equal(STEREO_ROUTES_CLIENT_TIMEOUT_MS, 4000);
});

test('normalizeStereoNameClient agrees with crc-sync\'s normaliser it deliberately duplicates', () => {
  // The duplication is intentional (separately deployed packages, ADR 0001's
  // reasoning) — which is exactly why it needs a test saying the two agree.
  const server = require('../../crc-sync/src/efsp/stereo-routes.js');
  for (const spelling of ['PACK 1', 'PACK1', 'pack-1', '  Pack   1 ', '', 'X']) {
    assert.equal(normalizeStereoNameClient(spelling), server.normalizeStereoName(spelling), JSON.stringify(spelling));
  }
  assert.equal(normalizeStereoNameClient(null), server.normalizeStereoName(null));
});
