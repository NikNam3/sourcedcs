'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('../crcsync-client.js');

function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    const r = await handler(url, init, calls.length);
    return { status: r.status == null ? 200 : r.status, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  };
  f.calls = calls;
  return f;
}
const mk = (handler, extra) => {
  const f = fakeFetch(handler);
  return { f, c: createClient(Object.assign({ fetch: f, baseUrl: 'http://cs:3000/', token: 'tok' }, extra)) };
};

test('listTheaters sends the bearer token and returns the array', async () => {
  const { f, c } = mk(() => ({ body: [{ theater: 'Syria', count: 2 }] }));
  const r = await c.listTheaters();
  assert.deepEqual(r, { ok: true, theaters: [{ theater: 'Syria', count: 2 }] });
  assert.equal(f.calls[0].url, 'http://cs:3000/api/airspace-registry/theaters');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer tok');
});

test('listAirspaces caches for 30 s per theater and fresh bypasses', async () => {
  let t = 1000;
  const { f, c } = mk(() => ({ body: { theater: 'Syria', airspaces: [] } }), { now: () => t });
  await c.listAirspaces('Syria');
  await c.listAirspaces('Syria');
  assert.equal(f.calls.length, 1);
  await c.listAirspaces('Caucasus');
  assert.equal(f.calls.length, 2);
  await c.listAirspaces('Syria', { fresh: true });
  assert.equal(f.calls.length, 3);
  t += 31000;
  await c.listAirspaces('Syria');
  assert.equal(f.calls.length, 4);
  assert.match(f.calls[0].url, /\?theater=Syria$/);
});

test('a failed read is not cached', async () => {
  let n = 0;
  const { c } = mk(() => (++n === 1 ? { status: 500, body: { error: 'boom' } } : { body: { theater: 'S', airspaces: [] } }));
  assert.equal((await c.listAirspaces('S')).ok, false);
  assert.equal((await c.listAirspaces('S')).ok, true);
});

test('never throws: network failure, non-JSON body, timeout, token rejection', async () => {
  const net = createClient({ fetch: async () => { throw new Error('ECONNREFUSED'); }, token: 't' });
  const r1 = await net.listTheaters();
  assert.equal(r1.ok, false); assert.match(r1.reason, /unreachable.*ECONNREFUSED/);

  const html = mk(() => ({ body: '<html>502</html>' }));
  const r2 = await html.c.listAirspaces('S');
  assert.equal(r2.ok, false); assert.match(r2.reason, /non-JSON/);

  const slow = createClient({ token: 't', timeoutMs: 20, fetch: (url, init) => new Promise((_, rej) => {
    init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); });
  }) });
  const r3 = await slow.mutateAirspace('S', { airspaceId: 'X', op: {} }, { sub: 'u' });
  assert.equal(r3.ok, false); assert.match(r3.reason, /timed out/);

  const denied = mk(() => ({ status: 401, body: { error: 'no' } }));
  const r4 = await denied.c.listTheaters();
  assert.equal(r4.ok, false); assert.match(r4.reason, /service token/);
});

test('mutateAirspace posts the contract body and returns the ack as it came, refusals included', async () => {
  const ack = { reason: 'STALE_REV', conflicts: [{ field: 'name', base: 'A', theirs: 'B' }] };
  const { f, c } = mk(() => ({ status: 409, body: ack }));
  const r = await c.mutateAirspace('Syria', { clientMutationId: 'm1', airspaceId: 'MOA-1', baseDefRev: 3, op: { kind: 'EditAirspace' } }, { sub: 's', name: 'N' });
  assert.deepEqual(r, { ok: true, status: 409, ack });
  const sent = JSON.parse(f.calls[0].init.body);
  assert.deepEqual(sent, { theater: 'Syria', clientMutationId: 'm1', airspaceId: 'MOA-1', baseDefRev: 3, op: { kind: 'EditAirspace' }, actor: { sub: 's', name: 'N' } });
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(f.calls[0].url, 'http://cs:3000/api/airspace-registry/mutation');
});

test('a mutation drops that theater from the read cache', async () => {
  const { f, c } = mk((url) => (url.includes('mutation') ? { body: { airspace: {} } } : { body: { theater: 'S', airspaces: [] } }));
  await c.listAirspaces('S');
  await c.mutateAirspace('S', { airspaceId: 'X', op: {} }, { sub: 'u' });
  await c.listAirspaces('S');
  assert.equal(f.calls.filter(x => !x.url.includes('mutation')).length, 2);
});
