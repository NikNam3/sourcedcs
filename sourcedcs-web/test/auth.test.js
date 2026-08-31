'use strict';

/* Tests the pure functions in auth.js (server-side) — decodeJWT and the
   rawRequest HTTP helper that replaced 5 near-duplicate https.request
   wrappers. Extracted from server.js in the Phase 2 architecture pass (see
   the repo-root architecture plan). Does not test casdoorTokenExchange
   end-to-end (requires a real Casdoor server) or the requireAuth/
   requireAdmin middleware (thin Express glue already exercised manually via
   the boot+curl check documented in that plan). */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const auth = require('../auth.js');

/* ══════════════════════════════════════════════════════════
   decodeJWT
══════════════════════════════════════════════════════════ */

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

test('decodeJWT: decodes a well-formed token payload', () => {
  const payload = { sub: 'user-1', name: 'Test User', roles: ['admin'] };
  const token = 'header.' + b64url(payload) + '.signature';
  assert.deepEqual(auth.decodeJWT(token), payload);
});

test('decodeJWT: returns null for malformed tokens', () => {
  assert.equal(auth.decodeJWT('not-a-jwt'), null);
  assert.equal(auth.decodeJWT('only.two'), null);
  assert.equal(auth.decodeJWT('a.b.c.d'), null);
  assert.equal(auth.decodeJWT('a.not-base64!!.c'), null);
});

/* ══════════════════════════════════════════════════════════
   rawRequest — the shared low-level HTTP helper
══════════════════════════════════════════════════════════ */

test('rawRequest: resolves with statusCode/headers/raw body against a real local server', async () => {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      res.writeHead(201, { 'Content-Type': 'application/json', 'X-Echo': body });
      res.end(JSON.stringify({ received: body }));
    });
  });
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const payload = JSON.stringify({ hello: 'world' });
    const result = await auth.rawRequest(
      { protocol: 'http:', hostname: '127.0.0.1', port, path: '/', method: 'POST' },
      payload
    );
    assert.equal(result.statusCode, 201);
    assert.equal(result.headers['x-echo'], payload);
    assert.deepEqual(JSON.parse(result.raw), { received: payload });
  } finally {
    server.close();
  }
});

test('rawRequest: rejects on network error (nothing listening on the port)', async () => {
  await assert.rejects(
    auth.rawRequest({ protocol: 'http:', hostname: '127.0.0.1', port: 1, path: '/', method: 'GET' })
  );
});
