'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const crcsync = require('../crcsync-client.js');
const airspacesRouter = require('../routes/airspaces.js');

function jwt(payload) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return 'h.' + b(payload) + '.s';
}
const MEMBER = jwt({ sub: 'u-member', name: 'Member', roles: ['member'] });
const ADMIN = jwt({ sub: 'u-admin', name: 'Admin Name', roles: ['admin'] });
const LEAD = jwt({ sub: 'u-lead', name: 'Lead', roles: [{ name: 'squadronlead' }] });

async function withServer(client, fn) {
  crcsync.setClient(client);
  const app = express();
  app.use(express.json());
  app.use('/api', airspacesRouter);
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = 'http://127.0.0.1:' + srv.address().port + '/api';
  const call = async (method, path, token, body) => {
    const res = await fetch(base + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  try { await fn(call); } finally { srv.close(); crcsync.setClient(null); }
}

test('reads need a login; any member may read the list', async () => {
  const client = { listTheaters: async () => ({ ok: true, theaters: [{ theater: 'Syria', count: 1 }] }), listAirspaces: async (t) => ({ ok: true, theater: t, airspaces: [{ definition: { airspaceId: 'A' } }] }) };
  await withServer(client, async (call) => {
    assert.equal((await call('GET', '/airspaces/theaters')).status, 401);
    const t = await call('GET', '/airspaces/theaters', MEMBER);
    assert.deepEqual(t.body.theaters, [{ theater: 'Syria', count: 1 }]);
    const l = await call('GET', '/airspaces?theater=Syria', MEMBER);
    assert.equal(l.body.airspaces[0].definition.airspaceId, 'A');
    assert.equal((await call('GET', '/airspaces', MEMBER)).status, 400);
  });
});

test('mutation: members get 403, admin and squadronlead pass', async () => {
  let calls = 0;
  const client = { mutateAirspace: async () => { calls++; return { ok: true, status: 200, ack: { airspace: {} } }; } };
  await withServer(client, async (call) => {
    const body = { theater: 'Syria', airspaceId: 'A', op: { kind: 'DeleteAirspace', baseDefRev: 1 } };
    assert.equal((await call('POST', '/airspaces/mutation', MEMBER, body)).status, 403);
    assert.equal(calls, 0);
    assert.equal((await call('POST', '/airspaces/mutation', ADMIN, body)).status, 200);
    assert.equal((await call('POST', '/airspaces/mutation', LEAD, body)).status, 200);
  });
});

test('mutation: actor is taken from the token, a body actor is ignored; the ack passes through', async () => {
  let seen;
  const ack = { reason: 'STALE_REV', conflicts: [{ field: 'name', base: 'A', theirs: 'B' }], detail: 'x' };
  const client = { mutateAirspace: async (theater, msg, actor) => { seen = { theater, msg, actor }; return { ok: true, status: 409, ack }; } };
  await withServer(client, async (call) => {
    const r = await call('POST', '/airspaces/mutation', ADMIN, { theater: 'Syria', clientMutationId: 'cm1', airspaceId: 'A', op: { kind: 'EditAirspace', baseDefRev: 1, patch: { name: 'Z' } }, actor: { sub: 'evil', name: 'Evil' } });
    assert.equal(r.status, 409);
    assert.deepEqual(r.body, ack);
    assert.deepEqual(seen.actor, { sub: 'u-admin', name: 'Admin Name' });
    assert.equal(seen.theater, 'Syria');
    assert.equal(seen.msg.clientMutationId, 'cm1');
    assert.equal(seen.msg.op.kind, 'EditAirspace');
  });
});

test('mutation: a missing clientMutationId is generated; bad input is 400', async () => {
  let id;
  const client = { mutateAirspace: async (_t, msg) => { id = msg.clientMutationId; return { ok: true, status: 200, ack: {} }; } };
  await withServer(client, async (call) => {
    assert.equal((await call('POST', '/airspaces/mutation', ADMIN, { theater: 'S', op: { kind: 'CreateAirspace', definition: {} } })).status, 200);
    assert.match(id, /^web-/);
    assert.equal((await call('POST', '/airspaces/mutation', ADMIN, { op: { kind: 'x' } })).status, 400);
    assert.equal((await call('POST', '/airspaces/mutation', ADMIN, { theater: 'S' })).status, 400);
  });
});

test('503 "crc-sync unreachable" when crc-sync is down, on reads and writes', async () => {
  const down = { ok: false, reason: 'crc-sync unreachable: ECONNREFUSED' };
  const client = { listTheaters: async () => down, listAirspaces: async () => down, mutateAirspace: async () => down };
  await withServer(client, async (call) => {
    for (const r of [await call('GET', '/airspaces/theaters', MEMBER), await call('GET', '/airspaces?theater=S', MEMBER),
      await call('POST', '/airspaces/mutation', ADMIN, { theater: 'S', op: { kind: 'DeleteAirspace' } })]) {
      assert.equal(r.status, 503);
      assert.equal(r.body.error, 'crc-sync unreachable');
    }
  });
});

test('an upstream 5xx ack is not relayed as such', async () => {
  const client = { mutateAirspace: async () => ({ ok: true, status: 500, ack: { error: 'x' } }) };
  await withServer(client, async (call) => {
    assert.equal((await call('POST', '/airspaces/mutation', ADMIN, { theater: 'S', op: { kind: 'DeleteAirspace' } })).status, 502);
  });
});
