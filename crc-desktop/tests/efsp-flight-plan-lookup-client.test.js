'use strict';

/* Client-side counterpart to crc-sync's efsp-flight-plan-lookup.test.mjs —
   same "never throws, resolves {found:false} on any failure" contract,
   verified the same way: an injectable fetchImpl, no real network or DOM. */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  lookupFlightPlanClient, FLIGHT_PLAN_LOOKUP_CLIENT_TIMEOUT_MS,
  listFiledFlightPlansClient, FLIGHT_PLAN_LIST_CLIENT_TIMEOUT_MS,
} = require('../app/public/js/panels/efsp/efsp-flight-plan-lookup.js');

function fakeFetch(status, body) {
  return async () => ({ ok: status >= 200 && status < 300, json: async () => body });
}

test('a successful lookup returns {found:true, seed}', async () => {
  const seed = { route: 'DCT', requestedAltitude: '250', departureAirport: 'LTAG', destinationAirport: 'LTAC', remarks: '' };
  const result = await lookupFlightPlanClient('VIPER1', { fetchImpl: fakeFetch(200, { found: true, seed }), authHeaders: () => ({}) });
  assert.deepEqual(result, { found: true, seed });
});

test('a 404 (no plan on file) resolves {found:false}', async () => {
  const result = await lookupFlightPlanClient('GHOST1', { fetchImpl: fakeFetch(404, { found: false }), authHeaders: () => ({}) });
  assert.deepEqual(result, { found: false });
});

test('a non-2xx status resolves {found:false}, never a throw', async () => {
  const result = await lookupFlightPlanClient('VIPER1', { fetchImpl: fakeFetch(503, {}), authHeaders: () => ({}) });
  assert.deepEqual(result, { found: false });
});

test('a 200 response with found:false (proxied straight through from crc-sync) resolves {found:false}', async () => {
  const result = await lookupFlightPlanClient('VIPER1', { fetchImpl: fakeFetch(200, { found: false, reason: 'no active flight plan for this callsign' }), authHeaders: () => ({}) });
  assert.deepEqual(result, { found: false });
});

test('a network error (fetch rejects) never throws — resolves {found:false} instead', async () => {
  const throwingFetch = async () => { throw new Error('network error'); };
  await assert.doesNotReject(async () => {
    const result = await lookupFlightPlanClient('VIPER1', { fetchImpl: throwingFetch, authHeaders: () => ({}) });
    assert.deepEqual(result, { found: false });
  });
});

test('a malformed body (missing/wrong-shaped seed) resolves {found:false}', async () => {
  for (const body of [{ found: true }, { found: true, seed: 'not an object' }, { found: true, seed: null }, {}]) {
    const result = await lookupFlightPlanClient('VIPER1', { fetchImpl: fakeFetch(200, body), authHeaders: () => ({}) });
    assert.deepEqual(result, { found: false }, JSON.stringify(body));
  }
});

test('a timeout resolves {found:false}, never hangs the caller', async () => {
  const hangingFetch = (url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const result = await lookupFlightPlanClient('VIPER1', { fetchImpl: hangingFetch, timeoutMs: 20, authHeaders: () => ({}) });
  assert.deepEqual(result, { found: false });
});

test('an empty or non-string callsign is rejected up front, without ever calling fetch', async () => {
  let called = false;
  const spyFetch = async () => { called = true; return { ok: true, json: async () => ({ found: true, seed: {} }) }; };
  for (const bad of ['', null, undefined, 42]) {
    const result = await lookupFlightPlanClient(bad, { fetchImpl: spyFetch, authHeaders: () => ({}) });
    assert.deepEqual(result, { found: false });
  }
  assert.equal(called, false);
});

test('the auth headers callback is applied to the request', async () => {
  let seenHeaders = null;
  const spyFetch = async (url, opts) => { seenHeaders = opts.headers; return { ok: true, json: async () => ({ found: true, seed: {} }) }; };
  await lookupFlightPlanClient('VIPER1', { fetchImpl: spyFetch, authHeaders: () => ({ Authorization: 'Bearer test-token' }) });
  assert.deepEqual(seenHeaders, { Authorization: 'Bearer test-token' });
});

test('the callsign is URL-encoded into the request path', async () => {
  let requestedUrl = null;
  const spyFetch = async (url) => { requestedUrl = url; return { ok: true, json: async () => ({ found: true, seed: {} }) }; };
  await lookupFlightPlanClient('VIPER 1/2', { fetchImpl: spyFetch, authHeaders: () => ({}) });
  assert.equal(requestedUrl, '/api/flight-plan-lookup/VIPER%201%2F2');
});

test('FLIGHT_PLAN_LOOKUP_CLIENT_TIMEOUT_MS is a sane positive number', () => {
  assert.ok(FLIGHT_PLAN_LOOKUP_CLIENT_TIMEOUT_MS > 0);
});

// ── listFiledFlightPlansClient — the ops-filed queue ─────────────────────

test('a successful fetch returns the plans array', async () => {
  const plans = [{ id: 1, callsign: 'VIPER1', submittedByName: 'Alice', submittedAt: 't', seed: { route: 'DCT' } }];
  const result = await listFiledFlightPlansClient({ fetchImpl: fakeFetch(200, { ok: true, plans }), authHeaders: () => ({}) });
  assert.deepEqual(result, plans);
});

test('a non-2xx response resolves an empty array, never a throw', async () => {
  const result = await listFiledFlightPlansClient({ fetchImpl: fakeFetch(503, {}), authHeaders: () => ({}) });
  assert.deepEqual(result, []);
});

test('a malformed body (ok:false, missing plans, or a non-array plans) resolves an empty array', async () => {
  for (const body of [{ ok: false }, { ok: true }, { ok: true, plans: 'not an array' }, {}]) {
    const result = await listFiledFlightPlansClient({ fetchImpl: fakeFetch(200, body), authHeaders: () => ({}) });
    assert.deepEqual(result, [], JSON.stringify(body));
  }
});

test('a network error never throws — resolves an empty array instead', async () => {
  const throwingFetch = async () => { throw new Error('network error'); };
  await assert.doesNotReject(async () => {
    const result = await listFiledFlightPlansClient({ fetchImpl: throwingFetch, authHeaders: () => ({}) });
    assert.deepEqual(result, []);
  });
});

test('a timeout resolves an empty array, never hangs the caller', async () => {
  const hangingFetch = (url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const result = await listFiledFlightPlansClient({ fetchImpl: hangingFetch, timeoutMs: 20, authHeaders: () => ({}) });
  assert.deepEqual(result, []);
});

test('the auth headers callback is applied and the request hits /api/flight-plan-list', async () => {
  let seenUrl = null, seenHeaders = null;
  const spyFetch = async (url, opts) => { seenUrl = url; seenHeaders = opts.headers; return { ok: true, json: async () => ({ ok: true, plans: [] }) }; };
  await listFiledFlightPlansClient({ fetchImpl: spyFetch, authHeaders: () => ({ Authorization: 'Bearer t' }) });
  assert.equal(seenUrl, '/api/flight-plan-list');
  assert.deepEqual(seenHeaders, { Authorization: 'Bearer t' });
});

test('FLIGHT_PLAN_LIST_CLIENT_TIMEOUT_MS is a sane positive number', () => {
  assert.ok(FLIGHT_PLAN_LIST_CLIENT_TIMEOUT_MS > 0);
});
