import { test } from 'node:test';
import assert from 'node:assert/strict';

const { lookupFlightPlan, toFdrFiledSeed, listFiledFlightPlans } = await import('../src/efsp/flight-plan-lookup.js');

// Every test injects fetchImpl directly rather than mocking the global
// `fetch` — matches the module's own injectable-for-tests design, and
// means these tests can run in parallel with anything else that might
// otherwise stub global fetch.

function fakeFetch(status, body) {
  return async () => ({
    status, ok: status >= 200 && status < 300,
    json: async () => body,
  });
}

function makePlan(overrides = {}) {
  return {
    id: 'plan-1', route: 'DCT', levelValue: '250',
    depAerodrome: 'LTAG', destAerodrome: 'LTAC', otherInfo: 'DOF/260101',
    fplMessage: '(FPL-VIPER1-IG...)', worldTour: false,
    ...overrides,
  };
}

// ── lookupFlightPlan — the "never throws, never crashes crc-sync" contract ──

test('a successful lookup returns {found:true, plan}', async () => {
  const plan = makePlan();
  const result = await lookupFlightPlan('VIPER1', { fetchImpl: fakeFetch(200, plan) });
  assert.deepEqual(result, { found: true, plan });
});

test('a 404 (no active plan for this callsign) is a normal not-found, not an error', async () => {
  const result = await lookupFlightPlan('GHOST1', { fetchImpl: fakeFetch(404, {}) });
  assert.equal(result.found, false);
  assert.match(result.reason, /no active flight plan/);
});

test('a non-2xx, non-404 response is a graceful not-found with the status surfaced', async () => {
  const result = await lookupFlightPlan('VIPER1', { fetchImpl: fakeFetch(503, {}) });
  assert.equal(result.found, false);
  assert.match(result.reason, /503/);
});

test('a network error (fetch rejects) never throws out of lookupFlightPlan — resolves {found:false} instead', async () => {
  const throwingFetch = async () => { throw new Error('ECONNREFUSED'); };
  await assert.doesNotReject(async () => {
    const result = await lookupFlightPlan('VIPER1', { fetchImpl: throwingFetch });
    assert.equal(result.found, false);
    assert.match(result.reason, /unreachable/);
  });
});

test('a malformed (non-JSON-parseable) body never throws — resolves {found:false} instead', async () => {
  const badJsonFetch = async () => ({
    status: 200, ok: true,
    json: async () => { throw new SyntaxError('Unexpected token in JSON'); },
  });
  const result = await lookupFlightPlan('VIPER1', { fetchImpl: badJsonFetch });
  assert.equal(result.found, false);
  assert.match(result.reason, /unreachable/);
});

test('a 200 response whose body is not an object (null, a bare string, an array) is treated as malformed, not found', async () => {
  for (const body of [null, 'just a string', [1, 2, 3]]) {
    const result = await lookupFlightPlan('VIPER1', { fetchImpl: fakeFetch(200, body) });
    assert.equal(result.found, false, JSON.stringify(body));
  }
});

test('a timeout (fetchImpl hangs past timeoutMs) resolves {found:false}, never hangs the caller forever', async () => {
  const hangingFetch = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const result = await lookupFlightPlan('VIPER1', { fetchImpl: hangingFetch, timeoutMs: 20 });
  assert.equal(result.found, false);
});

test('an empty or non-string callsign is rejected up front, without ever calling fetch', async () => {
  let called = false;
  const spyFetch = async () => { called = true; return { status: 200, ok: true, json: async () => ({}) }; };
  for (const bad of ['', null, undefined, 42]) {
    const result = await lookupFlightPlan(bad, { fetchImpl: spyFetch });
    assert.equal(result.found, false);
  }
  assert.equal(called, false);
});

test('the callsign is URL-encoded into the request path', async () => {
  let requestedUrl = null;
  const spyFetch = async (url) => { requestedUrl = url; return { status: 200, ok: true, json: async () => makePlan() }; };
  await lookupFlightPlan('VIPER 1/2', { fetchImpl: spyFetch, baseUrl: 'http://example.test' });
  assert.equal(requestedUrl, 'http://example.test/api/fpl1801/by-callsign/VIPER%201%2F2');
});

// ── toFdrFiledSeed — the DD1801 -> FDR.filed field mapping ─────────────────

test('toFdrFiledSeed maps exactly the fields EFSP models, dropping everything DD1801-specific with no equivalent', () => {
  const seed = toFdrFiledSeed(makePlan());
  assert.deepEqual(seed, {
    route: 'DCT', requestedAltitude: '250',
    departureAirport: 'LTAG', destinationAirport: 'LTAC',
    remarks: 'DOF/260101',
  });
  assert.equal('fplMessage' in seed, false);
  assert.equal('worldTour' in seed, false);
});

test('toFdrFiledSeed never throws on a missing field — falls back to empty string, same as a blank CreateStrip', () => {
  const seed = toFdrFiledSeed({});
  assert.deepEqual(seed, { route: '', requestedAltitude: '', departureAirport: '', destinationAirport: '', remarks: '' });
});

test('toFdrFiledSeed on null/non-object input returns an empty object, not a throw', () => {
  assert.deepEqual(toFdrFiledSeed(null), {});
  assert.deepEqual(toFdrFiledSeed(undefined), {});
  assert.deepEqual(toFdrFiledSeed('not an object'), {});
});

// ── listFiledFlightPlans — the ops-filed queue, service-token gated ─────

function makeRawPlan(overrides = {}) {
  return {
    id: 1, aircraftId: 'VIPER1', submittedBy: { sub: 'user-sub-1', name: 'Alice' },
    submittedAt: '2026-01-01T00:00:00.000Z',
    route: 'DCT', levelValue: '250', depAerodrome: 'LTAG', destAerodrome: 'LTAC', otherInfo: 'DOF/260101',
    ...overrides,
  };
}

test('listFiledFlightPlans maps each raw plan into a lightweight {id, callsign, submittedByName, submittedAt, seed} card', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => [makeRawPlan()] });
  const result = await listFiledFlightPlans({ fetchImpl, serviceToken: 'test-token' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.plans, [{
    id: 1, callsign: 'VIPER1', submittedByName: 'Alice', submittedAt: '2026-01-01T00:00:00.000Z',
    seed: { route: 'DCT', requestedAltitude: '250', departureAirport: 'LTAG', destinationAirport: 'LTAC', remarks: 'DOF/260101' },
  }]);
});

test('listFiledFlightPlans sends the service token as a Bearer header', async () => {
  let seenHeaders = null;
  const fetchImpl = async (url, opts) => { seenHeaders = opts.headers; return { ok: true, json: async () => [] }; };
  await listFiledFlightPlans({ fetchImpl, serviceToken: 'my-secret-token' });
  assert.deepEqual(seenHeaders, { Authorization: 'Bearer my-secret-token' });
});

test('listFiledFlightPlans hits the /service/all path, not by-callsign', async () => {
  let requestedUrl = null;
  const fetchImpl = async (url) => { requestedUrl = url; return { ok: true, json: async () => [] }; };
  await listFiledFlightPlans({ fetchImpl, baseUrl: 'http://example.test', serviceToken: 'x' });
  assert.equal(requestedUrl, 'http://example.test/api/fpl1801/service/all');
});

test('an unconfigured service token short-circuits to {ok:false} without ever calling fetch', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, json: async () => [] }; };
  const result = await listFiledFlightPlans({ fetchImpl, serviceToken: '' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /not configured/);
  assert.equal(called, false);
});

test('a non-2xx response (e.g. 401 from an expired/wrong token) resolves {ok:false}, never a throw', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid token' }) });
  const result = await listFiledFlightPlans({ fetchImpl, serviceToken: 'wrong' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /401/);
});

test('a non-array response body is treated as malformed, not a throw', async () => {
  for (const body of [{ notAnArray: true }, null, 'string']) {
    const fetchImpl = async () => ({ ok: true, json: async () => body });
    const result = await listFiledFlightPlans({ fetchImpl, serviceToken: 'x' });
    assert.equal(result.ok, false, JSON.stringify(body));
  }
});

test('a network error never throws — resolves {ok:false} instead', async () => {
  const throwingFetch = async () => { throw new Error('ECONNREFUSED'); };
  await assert.doesNotReject(async () => {
    const result = await listFiledFlightPlans({ fetchImpl: throwingFetch, serviceToken: 'x' });
    assert.equal(result.ok, false);
    assert.match(result.reason, /unreachable/);
  });
});

test('a plan with no aircraftId is dropped from the results rather than surfaced as an unusable card', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => [makeRawPlan({ aircraftId: '' }), makeRawPlan({ id: 2, aircraftId: 'EAGLE1' })] });
  const result = await listFiledFlightPlans({ fetchImpl, serviceToken: 'x' });
  assert.equal(result.ok, true);
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].callsign, 'EAGLE1');
});

test('a plan with no submittedBy at all still maps cleanly (submittedByName null, not a throw)', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => [makeRawPlan({ submittedBy: null })] });
  const result = await listFiledFlightPlans({ fetchImpl, serviceToken: 'x' });
  assert.equal(result.ok, true);
  assert.equal(result.plans[0].submittedByName, null);
});
