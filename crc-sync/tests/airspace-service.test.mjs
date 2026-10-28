import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import crcLog from '../src/log.js';
import { until } from './helpers/wait.mjs';
import { withPaths, APP_PATHS } from './helpers/with-paths.mjs';

// /api/airspace-registry/* through createApp (docs/adr/0098 §9): auth, validation, the three routes, an idempotent
// replay, and a connected panel session receiving the delta and the calendar. Same temp-dir setup as app-boot.test.mjs.
const paths = withPaths('airspace-service-', APP_PATHS, { stateDir: true, shippedConfig: true, extraEnv: { CRCSYNC_TEST_RESET: undefined } }).apply();
const tmpDir = paths.dir;
fs.writeFileSync(paths.env.CRCSYNC_EFSP_AIRSPACES_PATH, '{}');

const { createApp } = await import('../src/app.js');
const auth = await import('../src/auth.js');
const { WIRE_PROTOCOL } = (await import('../src/wire-protocol.js')).default;

const TOKEN = 'service-secret';
const THEATER = 'Syria';
const MOA = { airspaceId: 'MOA-9', name: 'Nine', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 134.25 };
const ACTOR = { sub: 'u-1', name: 'Ann Admin' };
const MISSION = { theatre: THEATER, airports: [], waypoints: [], drawings: [], coalitions: {}, bullseye: {} };

async function boot({ token = TOKEN, bookings = { ok: true, bookings: [] }, mission = true } = {}) {
  const grpcClient = Object.assign(new EventEmitter(), { getWeather: () => ({}), evalLua: async () => null, getAptWeather: async () => ({}) });
  const app = createApp({ grpcClient, srsClient: new EventEmitter(), env: token ? { ...process.env, AIRSPACE_SERVICE_TOKEN: token, CRCSYNC_SOURCEDCS_WEB_PUBLIC_URL: 'https://web.test/' } : { ...process.env }, bookingLookup: async () => bookings });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  app.start();
  if (mission) grpcClient.emit('mission-load', MISSION);
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = (method, p, { headers = { Authorization: `Bearer ${TOKEN}` }, body } = {}) =>
    fetch(base + p, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
      .then(async r => ({ status: r.status, body: await r.json() }));
  return { app, grpcClient, base, call, close: () => { app.stop(); app.wsHub._wss && app.wsHub._wss.close(); app.server.close(); } };
}
const post = (c, body, opts) => c.call('POST', '/api/airspace-registry/mutation', { body, ...opts });
const create = (over = {}) => ({ theater: THEATER, clientMutationId: 'c-' + Math.random(), airspaceId: 'MOA-9', op: { kind: 'CreateAirspace', definition: MOA }, actor: ACTOR, ...over });
const quiet = (t) => { const cap = crcLog.capture(); t.after(() => cap.stop()); };

test('no token configured: every route is 503 and nothing opens', async (t) => {
  quiet(t);
  const c = await boot({ token: '' }); t.after(c.close);
  for (const [m, p] of [['GET', '/api/airspace-registry/theaters'], ['GET', '/api/airspace-registry?theater=Syria'], ['POST', '/api/airspace-registry/mutation']]) {
    assert.equal((await c.call(m, p, { headers: { Authorization: 'Bearer anything' }, body: m === 'POST' ? create() : undefined })).status, 503, p);
  }
});

test('a missing or wrong token is 401 on every route; the right one passes', async (t) => {
  quiet(t);
  const c = await boot(); t.after(c.close);
  for (const headers of [{}, { Authorization: 'Bearer nope' }, { Authorization: 'Basic ' + TOKEN }, { Authorization: 'Bearer ' }, { Authorization: `Bearer ${TOKEN}x` }]) {
    assert.equal((await c.call('GET', '/api/airspace-registry/theaters', { headers })).status, 401, JSON.stringify(headers));
  }
  assert.equal((await post(c, create(), { headers: { Authorization: 'Bearer nope' } })).status, 401);
  assert.equal((await c.call('GET', '/api/airspace-registry/theaters')).status, 200);
});

test('POST validation: theater, clientMutationId, op, actor and the revision fields', async (t) => {
  quiet(t);
  const c = await boot(); t.after(c.close);
  const bad = [
    { theater: undefined }, { theater: 'x'.repeat(65) }, { clientMutationId: undefined }, { clientMutationId: 'x'.repeat(81) },
    { op: undefined }, { op: 'EditAirspace' }, { op: {} }, { airspaceId: 5 }, { baseDefRev: '1' }, { baseRev: 1.5 },
    { actor: undefined }, { actor: { sub: 'u' } }, { actor: { sub: 'u', name: 3 } }, { actor: { sub: '', name: 'n' } }, { actor: { sub: 'x'.repeat(201), name: 'n' } },
  ];
  for (const over of bad) {
    const r = await post(c, create(over));
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.equal(typeof r.body.error, 'string');
  }
  assert.equal((await c.call('GET', '/api/airspace-registry')).status, 400, 'GET list needs a theater');
});

test('create, list, theaters, edit with a stale base (conflict passed through), and delete', async (t) => {
  quiet(t);
  const c = await boot(); t.after(c.close);
  assert.deepEqual((await c.call('GET', '/api/airspace-registry/theaters')).body, []);
  const made = await post(c, create());
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.ok, true);
  assert.equal(made.body.airspace.defRev, 1);
  assert.equal(made.body.theater, THEATER);

  assert.deepEqual((await c.call('GET', '/api/airspace-registry/theaters')).body, [{ theater: THEATER, count: 1 }]);
  const list = await c.call('GET', `/api/airspace-registry?theater=${THEATER}`);
  assert.equal(list.body.theater, THEATER);
  assert.equal(list.body.airspaces[0].definition.airspaceId, 'MOA-9');
  assert.equal(list.body.airspaces[0].state, 'RETURNED');
  assert.deepEqual((await c.call('GET', '/api/airspace-registry?theater=Nowhere')).body, { theater: 'Nowhere', airspaces: [] });

  const edit = (patch, baseDefRev) => post(c, { theater: THEATER, clientMutationId: 'e-' + Math.random(), airspaceId: 'MOA-9', baseDefRev, op: { kind: 'EditAirspace', patch }, actor: ACTOR });
  assert.equal((await edit({ workingFrequencyMhz: 140 }, 1)).body.airspace.defRev, 2);
  const stale = await edit({ workingFrequencyMhz: 141 }, 1);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.reason, 'STALE_REV');
  assert.deepEqual(stale.body.conflicts, [{ field: 'workingFrequencyMhz', base: 134.25, theirs: 140 }]);
  const noBase = await post(c, { theater: THEATER, clientMutationId: 'nb', airspaceId: 'MOA-9', op: { kind: 'EditAirspace', patch: { name: 'X' } }, actor: ACTOR });
  assert.equal(noBase.body.ok, false, 'an edit needs baseDefRev');

  const dup = await post(c, create());
  assert.equal(dup.status, 400, 'an existing id is a VALIDATION_ERROR');
  const del = await post(c, { theater: THEATER, clientMutationId: 'd1', airspaceId: 'MOA-9', baseDefRev: 2, op: { kind: 'DeleteAirspace' }, actor: ACTOR });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(del.body.removed, 'MOA-9');
  assert.equal(del.body.airspace, null);
  assert.equal((await post(c, { theater: THEATER, clientMutationId: 'd2', airspaceId: 'MOA-9', baseDefRev: 2, op: { kind: 'DeleteAirspace' }, actor: ACTOR })).status, 404);
});

test('an invalid definition is refused 400 with a detail; a refusal never says 401 or 403', async (t) => {
  quiet(t);
  const c = await boot(); t.after(c.close);
  const r = await post(c, create({ op: { kind: 'CreateAirspace', definition: { ...MOA, workingFrequencyMhz: 5 } } }));
  assert.equal(r.status, 400);
  assert.equal(r.body.reason, 'VALIDATION_ERROR');
  assert.ok(r.body.detail);
  const unknown = await post(c, create({ op: { kind: 'Bogus' } }));
  assert.ok(![401, 403].includes(unknown.status));
  assert.equal(unknown.body.ok, false);
});

test('an idempotent retry answers the same and writes once', async (t) => {
  quiet(t);
  const c = await boot(); t.after(c.close);
  const msg = create({ clientMutationId: 'same' });
  const a = await post(c, msg);
  const entries = c.app.efsp.mutationLog.readAll().length;
  const b = await post(c, msg);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(b.body.airspace.defRev, 1);
  assert.equal(c.app.efsp.mutationLog.readAll().length, entries, 'the replay wrote nothing');
});

test('the audit entry names the web actor, via WEB, with no acting Position', async (t) => {
  quiet(t);
  const c = await boot(); t.after(c.close);
  await post(c, create());
  const last = c.app.efsp.mutationLog.readAll().pop();
  assert.equal(last.via, 'WEB');
  assert.equal(last.actorId, ACTOR.sub);
  assert.equal(last.actingPositionId, null);
});

function connect(c) {
  const ticket = auth.mintTicket({ name: 'Controller One' });
  const ws = new WebSocket(`ws://127.0.0.1:${c.app.server.address().port}/feed?ticket=${ticket}&protocol=${WIRE_PROTOCOL}&client=test`);
  const frames = [];
  ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
  return { ws, frames, ready: new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); }) };
}

test('a web edit reaches a connected panel as an efsp-airspace-delta; the calendar arrives on connect and on change', async (t) => {
  quiet(t);
  const c = await boot({ bookings: { ok: true, bookings: [{ theater: THEATER, airspaceId: 'MOA-9', startUtc: '2099-01-01T10:00:00.000Z', endUtc: '2099-01-01T12:00:00.000Z', by: 'Bob', altitudeFt: 9000 }] } });
  t.after(c.close);
  await c.app.airspaceCalendar.refresh(); // what the ticker does
  const p = connect(c); t.after(() => p.ws.close());
  await p.ready;
  await until(() => p.frames.some(f => f.type === 'efsp-airspace-calendar') && p.frames.some(f => f.type === 'efsp-snapshot' || f.airspaces));
  const cal = p.frames.find(f => f.type === 'efsp-airspace-calendar');
  assert.equal(cal.theater, THEATER);
  assert.equal(cal.bookingUrl, 'https://web.test/bookings.html');
  assert.equal(cal.byAirspace['MOA-9'][0].by, 'Bob');

  const r = await post(c, create({ airspaceId: 'MOA-D', op: { kind: 'CreateAirspace', definition: { ...MOA, airspaceId: 'MOA-D', name: 'Delta' } } }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await until(() => p.frames.some(f => f.type === 'efsp-airspace-delta'));
  const delta = p.frames.find(f => f.type === 'efsp-airspace-delta');
  assert.equal(delta.airspaces.updated[0].definition.airspaceId, 'MOA-D');
  assert.equal(delta.airspaces.updated[0].theater, THEATER);

  const del = await post(c, { theater: THEATER, clientMutationId: 'rm', airspaceId: 'MOA-D', baseDefRev: 1, op: { kind: 'DeleteAirspace' }, actor: ACTOR });
  assert.equal(del.status, 200);
  await until(() => p.frames.some(f => f.type === 'efsp-airspace-delta' && f.airspaces.removed));

  // a change to ANOTHER theater is stored and acked but reaches nobody
  const before = p.frames.length;
  const other = await post(c, create({ theater: 'Caucasus', clientMutationId: 'oth' }));
  assert.equal(other.status, 200);
  // frames arrive in order, so a same-theater sentinel's delta marks the point by which the other theater's would have come
  const sentinel = await post(c, create({ airspaceId: 'MOA-S', op: { kind: 'CreateAirspace', definition: { ...MOA, airspaceId: 'MOA-S', name: 'Sentinel' } } }));
  assert.equal(sentinel.status, 200);
  await until(() => p.frames.slice(before).some(f => f.type === 'efsp-airspace-delta'));
  const deltas = p.frames.slice(before).filter(f => f.type === 'efsp-airspace-delta');
  assert.equal(deltas.length, 1, 'only the sentinel (this theater) was broadcast');
  assert.equal(deltas[0].airspaces.updated[0].definition.airspaceId, 'MOA-S');
});
