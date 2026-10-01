'use strict';
// QAC D-11 / D-3: every crc-sync proxy route of app/server.js still reaches the same
// upstream path with the same headers and error handling, and the MapTiler key comes
// from one place. Spawns the real server against a fake crc-sync.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { resolveProxyPath } = require('../app/proxy-routes');
const { maptilerKey, DEFAULT_MAPTILER_KEY, renderStyle } = require('../app/maptiler');

const freePort = () => new Promise((res) => {
  const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
});
const request = (port, method, url, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ port, host: '127.0.0.1', method, path: url, headers }, (res) => {
    let data = ''; res.on('data', (d) => { data += d; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
  });
  r.on('error', reject);
  r.end(body);
});

// [method, url, expected upstream path or null (not proxied)]
const CASES = [
  ['POST', '/api/ws-ticket', '/api/ws-ticket'],
  ['GET', '/api/ws-ticket', null],
  ['POST', '/api/atis-transmit', '/api/atis-transmit'],
  ['GET', '/api/atis-transmit', null],
  ['GET', '/api/srs-clients', '/api/srs-clients'],
  ['GET', '/api/srs-clients?x=1', null],
  ['GET', '/api/apt-weather?icao=OJAI', '/api/apt-weather?icao=OJAI'],
  ['GET', '/api/magnetic/to-true?mag=90&lat=1&lon=2', '/api/magnetic/to-true?mag=90&lat=1&lon=2'],
  ['GET', '/api/flight-plan-lookup/ABC12', '/api/flight-plan-lookup/ABC12'],
  ['GET', '/api/flight-plan-list', '/api/flight-plan-list'],
  ['GET', '/api/flight-plan-list?a=1', null],
  ['GET', '/api/stereo-routes', '/api/stereo-routes'],
  ['GET', '/api/efsp/metrics', '/api/efsp/metrics'],
  ['GET', '/api/efsp/metrics?window=5', '/api/efsp/metrics?window=5'],
  ['GET', '/api/efsp/metricsX', null],
  ['GET', '/api/efsp/traffic-count', '/api/efsp/traffic-count'],
  ['GET', '/api/efsp/traffic-count?w=1', '/api/efsp/traffic-count?w=1'],
  ['GET', '/api/other', null],
];

test('resolveProxyPath: the route table matches the old if-chain', () => {
  for (const [method, url, expected] of CASES) assert.equal(resolveProxyPath(url, method), expected, `${method} ${url}`);
});

test('server.js proxies each route upstream with the same headers; 502 when crc-sync is down', async (t) => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, ct: req.headers['content-type'], body });
      res.writeHead(201, { 'Content-Type': 'text/x-up' });
      res.end('up:' + req.url);
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const upPort = upstream.address().port;
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, '../app/server.js')], {
    env: { ...process.env, WS_PORT: String(port), CRC_SYNC_URL: `ws://127.0.0.1:${upPort}`, CRC_MAPTILER_KEY: 'testkey123' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => { child.kill(); upstream.close(); });
  await new Promise((r) => child.stdout.on('data', (d) => { if (String(d).includes('[crc]')) r(); }));

  for (const [method, url, expected] of CASES.filter((c) => c[2] !== null)) {
    seen.length = 0;
    const res = await request(port, method, url, {
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'text/plain' }, body: method === 'POST' ? '{"a":1}' : undefined,
    });
    assert.equal(res.status, 201, `${method} ${url}`);
    assert.equal(res.headers['content-type'], 'text/x-up');
    assert.equal(res.body, 'up:' + expected);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, method);
    assert.equal(seen[0].url, expected);
    assert.equal(seen[0].auth, 'Bearer tok');
    assert.equal(seen[0].ct, 'application/json');   // forced, not the client's
    assert.equal(seen[0].body, method === 'POST' ? '{"a":1}' : '');
  }
  // No Authorization header in -> none out.
  seen.length = 0;
  await request(port, 'GET', '/api/srs-clients');
  assert.equal(seen[0].auth, undefined);

  // Unproxied URLs never reach crc-sync.
  seen.length = 0;
  for (const [method, url] of CASES.filter((c) => c[2] === null)) {
    const res = await request(port, method, url);
    assert.equal(res.status, 404, `${method} ${url}`);
  }
  assert.equal(seen.length, 0);

  // D-3: config.js carries the key and the style is filled in from it.
  const cfg = await request(port, 'GET', '/js/config.js');
  assert.match(cfg.body, /var MAPTILER_KEY\s+= "testkey123";/);
  const style = await request(port, 'GET', '/crc-desktop-scope-style.json');
  assert.equal(style.status, 200);
  assert.ok(!style.body.includes('__MAPTILER_KEY__'));
  assert.ok(style.body.includes('key=testkey123'));
  assert.ok(JSON.parse(style.body).glyphs.includes('key=testkey123'));

  // crc-sync unreachable: 502 with the same JSON body.
  await new Promise((r) => upstream.close(r));
  const down = await request(port, 'GET', '/api/stereo-routes');
  assert.equal(down.status, 502);
  assert.deepEqual(JSON.parse(down.body), { error: 'crc-sync unreachable' });
});

test('maptiler: one key, env override, shipped default, no copy left in the client', () => {
  assert.equal(maptilerKey({}), DEFAULT_MAPTILER_KEY);
  assert.equal(maptilerKey({ CRC_MAPTILER_KEY: ' abc ' }), 'abc');
  assert.equal(renderStyle('a=__MAPTILER_KEY__&b=__MAPTILER_KEY__', 'k'), 'a=k&b=k');
  const fs = require('node:fs');
  for (const f of ['public/js/elevation.js', 'public/crc-desktop-scope-style.json']) {
    assert.ok(!fs.readFileSync(path.join(__dirname, '../app', f), 'utf8').includes(DEFAULT_MAPTILER_KEY), f);
  }
});
