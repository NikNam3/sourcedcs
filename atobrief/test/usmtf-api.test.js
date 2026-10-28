'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const yaml = require('js-yaml');
const { mountUsmtfRoutes, checkServiceToken } = require('../usmtf-api.js');
const U = require('../public/js/usmtf-ato.js');

const ROOM_YAML = fs.readFileSync(path.join(__dirname, 'fixtures', 'usmtf', 'ojw1v5-trimmed.yaml'), 'utf8');
const EXPECTED = U.buildUsmtf(yaml.load(ROOM_YAML)).text;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => 'aaa.' + b64(payload) + '.x';
const future = Math.floor(Date.now() / 1000) + 3600;

function start(serviceToken = 'svc') {
  const sessions = new Map([
    ['alpha', { packageYaml: ROOM_YAML, packageUpdatedAt: Date.UTC(2026, 6, 4, 12, 0, 0) }],
    ['empty', { packageYaml: null }],
    ['broken', { packageYaml: 'a: [unclosed' }],
    ['nodate', { packageYaml: 'ato: {missions: []}\n' }],
  ]);
  const app = express();
  mountUsmtfRoutes(app, { sessions, serviceToken });
  return new Promise((resolve) => {
    const srv = app.listen(0, () => resolve({ srv, base: 'http://127.0.0.1:' + srv.address().port }));
  });
}

let S;
test.before(async () => { S = await start(); });
test.after(() => S.srv.close());

const get = (p, token, headers = {}) => fetch(S.base + p, {
  headers: Object.assign(token != null ? { Authorization: 'Bearer ' + token } : {}, headers),
});

test('checkServiceToken never matches an unset token', () => {
  assert.equal(checkServiceToken('', ''), false);
  assert.equal(checkServiceToken('x', ''), false);
  assert.equal(checkServiceToken('svc', 'svc'), true);
  assert.equal(checkServiceToken('svd', 'svc'), false);
  assert.equal(checkServiceToken(undefined, 'svc'), false);
});

test('refusals: no auth, wrong token, role-less or expired JWT → 401', async () => {
  for (const tok of [null, 'nope', jwt({ roles: [], exp: future }), jwt({ roles: ['x'], exp: 1 }), jwt({ roles: ['x'] }), 'a.b.c']) {
    const r = await get('/api/rooms/alpha/ato.usmtf', tok);
    assert.equal(r.status, 401, String(tok));
    assert.deepEqual(await r.json(), { error: 'Authentication required' });
  }
});

test('an empty configured token does not accept an empty bearer', async () => {
  const s = await start('');
  try {
    const r = await fetch(s.base + '/api/rooms/alpha/ato.usmtf', { headers: { Authorization: 'Bearer ' } });
    assert.equal(r.status, 401);
  } finally { s.srv.close(); }
});

test('service token → 200 text/plain equal to buildUsmtf of the room YAML', async () => {
  const r = await get('/api/rooms/alpha/ato.usmtf', 'svc');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('last-modified'), 'Sat, 04 Jul 2026 12:00:00 GMT');
  assert.match(r.headers.get('content-disposition'), /^inline; filename="OPERATION_JASMINE_WAVE1_2026-07-04\.usmtf\.txt"$/);
  assert.ok(Number(r.headers.get('x-usmtf-warnings')) > 0);
  assert.equal(await r.text(), EXPECTED);
});

test('a role-bearing unexpired JWT → 200', async () => {
  const r = await get('/api/rooms/alpha/ato.usmtf', jwt({ name: 'dev', roles: ['x'], exp: future }));
  assert.equal(r.status, 200);
});

test('unknown room and room without package → 404; over-long id → 400', async () => {
  assert.equal((await get('/api/rooms/zulu/ato.usmtf', 'svc')).status, 404);
  const e = await get('/api/rooms/empty/ato.usmtf', 'svc');
  assert.equal(e.status, 404);
  assert.deepEqual(await e.json(), { error: 'Room has no package' });
  assert.equal((await get('/api/rooms/' + 'x'.repeat(129) + '/ato.usmtf', 'svc')).status, 400);
});

test('broken YAML → 422; NO_ATO_DATE → 422 with errors', async () => {
  const b = await get('/api/rooms/broken/ato.usmtf', 'svc');
  assert.equal(b.status, 422);
  assert.equal((await b.json()).error, 'YAML parse error');
  const n = await get('/api/rooms/nodate/ato.usmtf', 'svc');
  assert.equal(n.status, 422);
  assert.equal((await n.json()).errors[0].code, 'NO_ATO_DATE');
});

test('?report=1 returns JSON {text, warnings}', async () => {
  const r = await get('/api/rooms/alpha/ato.usmtf?report=1', 'svc');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.text, EXPECTED);
  assert.ok(j.warnings.some((w) => w.code === 'CLASSIFICATION_FORCED_UNCLAS'));
});

test('ETag + If-None-Match → 304', async () => {
  const r = await get('/api/rooms/alpha/ato.usmtf', 'svc');
  const etag = r.headers.get('etag');
  assert.match(etag, /^"[0-9a-f]{40}"$/);
  const r2 = await get('/api/rooms/alpha/ato.usmtf', 'svc', { 'If-None-Match': etag });
  assert.equal(r2.status, 304);
});

test('POST /api/usmtf converts text/yaml', async () => {
  const r = await fetch(S.base + '/api/usmtf', {
    method: 'POST', headers: { Authorization: 'Bearer svc', 'Content-Type': 'text/yaml' }, body: ROOM_YAML,
  });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), EXPECTED);
  const unauth = await fetch(S.base + '/api/usmtf', { method: 'POST', headers: { 'Content-Type': 'text/yaml' }, body: ROOM_YAML });
  assert.equal(unauth.status, 401);
  const empty = await fetch(S.base + '/api/usmtf', { method: 'POST', headers: { Authorization: 'Bearer svc', 'Content-Type': 'text/yaml' }, body: '' });
  assert.equal(empty.status, 400);
});

test('server.js mounts the routes and exports app without listening', async () => {
  const { app, server } = require('../server.js');
  assert.equal(server.listening, false);
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  try {
    const r = await fetch('http://127.0.0.1:' + srv.address().port + '/api/rooms/x/ato.usmtf');
    assert.equal(r.status, 401);
  } finally { srv.close(); }
});
