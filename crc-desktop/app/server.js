'use strict';
require('dotenv').config();
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PUBLIC_DIR       = path.join(__dirname, 'public');
const DATA_DIR         = path.join(__dirname, 'data');
const SRS_RADIO_API    = parseInt(process.env.SRS_RADIO_API_PORT) || 5003;

// crc-sync is the sole gRPC/SRS client now (see crc-sync/server.js) — this
// local server no longer runs GrpcClient/SrsClient/TrackStore/WsServer at
// all. The renderer connects straight to crc-sync's /feed WebSocket for
// telemetry + the collaborative overlay (app/public/js/sync.js); the few
// on-demand, per-action RPCs (ATIS transmit, SRS client list, airport
// weather, WS connect tickets) are still proxied through here so the
// renderer never needs crc-sync's bearer token directly — only the
// cross-origin OAuth code exchange in auth-callback.html talks to crc-sync
// straight from the browser.
// Mutable at runtime (not just at startup) — the renderer's connection
// widget (app/public/js/sync.js) can override these via POST /api/sync-config
// so a squadron member can point at a different crc-sync/Casdoor without
// hand-editing config.json. config.json's values are just the defaults.
const syncConfig = {
  crcSyncUrl:      process.env.CRC_SYNC_URL || 'wss://asacs.sourcedcs.page',
  casdoorClientId: process.env.CASDOOR_CLIENT_ID || '',
  casdoorEndpoint: process.env.CASDOOR_ENDPOINT || '',
};
function syncHttpUrl() {
  return syncConfig.crcSyncUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.css':  'text/css',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

// Reverse-proxies one request to crc-sync, forwarding the client's
// Authorization header and (for POST) body, and relaying the response back
// verbatim. Used for every crc-sync HTTP endpoint the renderer needs.
function proxyToSync(req, res, syncPath) {
  const target = new URL(syncPath, syncHttpUrl());
  const mod    = target.protocol === 'https:' ? https : http;
  const headers = { 'Content-Type': 'application/json' };
  if (req.headers.authorization) headers.Authorization = req.headers.authorization;

  const preq = mod.request(target, { method: req.method, headers }, (pres) => {
    res.writeHead(pres.statusCode, { 'Content-Type': pres.headers['content-type'] || 'application/json' });
    pres.pipe(res);
  });
  preq.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'crc-sync unreachable' }));
  });
  if (req.method === 'POST') req.pipe(preq);
  else preq.end();
}

const httpServer = http.createServer((req, res) => {
  // ── Dynamic client config ─────────────────────────────────────────────────
  if (req.url === '/js/config.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(
      'var CRC_SYNC_URL      = ' + JSON.stringify(syncConfig.crcSyncUrl)      + ';\n' +
      'var CASDOOR_CLIENT_ID = ' + JSON.stringify(syncConfig.casdoorClientId) + ';\n' +
      'var CASDOOR_ENDPOINT  = ' + JSON.stringify(syncConfig.casdoorEndpoint) + ';\n'
    );
  }

  // ── Connection widget (app/public/js/sync.js) pushes overrides here so
  // this local server's proxies stay consistent with whatever the renderer
  // is actually using — local-only endpoint, no auth needed (matches the
  // trust model of the rest of this process, which only ever listens on
  // localhost).
  if (req.url === '/api/sync-config' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      let cfg;
      try { cfg = JSON.parse(body); } catch (_) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'invalid JSON' }));
      }
      if (typeof cfg.crcSyncUrl === 'string' && /^wss?:\/\/.+/.test(cfg.crcSyncUrl)) {
        syncConfig.crcSyncUrl = cfg.crcSyncUrl.replace(/\/+$/, '');
      }
      if (typeof cfg.casdoorClientId === 'string') syncConfig.casdoorClientId = cfg.casdoorClientId;
      if (typeof cfg.casdoorEndpoint === 'string') syncConfig.casdoorEndpoint = cfg.casdoorEndpoint.replace(/\/+$/, '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(syncConfig));
    });
    return;
  }

  // ── crc-sync proxies (ticket mint + the on-demand RPCs) ──────────────────
  if (req.url === '/api/ws-ticket' && req.method === 'POST')      return proxyToSync(req, res, '/api/ws-ticket');
  if (req.url === '/api/atis-transmit' && req.method === 'POST')  return proxyToSync(req, res, '/api/atis-transmit');
  if (req.url === '/api/srs-clients')                              return proxyToSync(req, res, '/api/srs-clients');
  if (req.url.startsWith('/api/apt-weather'))                      return proxyToSync(req, res, req.url);
  // EFSP CreateStrip pre-fill (crc-sync/src/efsp/flight-plan-lookup.js) —
  // same reverse-proxy shape, so the renderer never needs crc-sync's
  // bearer token directly for this either.
  if (req.url.startsWith('/api/flight-plan-lookup/'))              return proxyToSync(req, res, req.url);
  if (req.url === '/api/flight-plan-list')                         return proxyToSync(req, res, req.url);

  // ── SRS radio API proxy → lxsrs_v2 HTTP API (local pilot audio, unrelated to crc-sync) ─
  if (req.url.startsWith('/srs-api/')) {
    const upstreamPath = req.url.slice('/srs-api'.length);
    const opts = {
      hostname: '127.0.0.1',
      port: SRS_RADIO_API,
      path: upstreamPath,
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        ...(req.headers['content-length'] ? { 'Content-Length': req.headers['content-length'] } : {}),
      },
    };
    const upstream = http.request(opts, (upRes) => {
      res.writeHead(upRes.statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      upRes.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(503);
      res.end(JSON.stringify({ error: 'SRS radio API unavailable' }));
    });
    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }
    if (req.method === 'POST') req.pipe(upstream);
    else upstream.end();
    return;
  }

  // ── Flight plan lookup (proxy to sourcedcs-web) ──────────────────────────
  if (req.url.startsWith('/api/fpl/')) {
    const callsign = decodeURIComponent(req.url.slice('/api/fpl/'.length).split('?')[0]).toUpperCase().trim();
    const webUrl   = (process.env.SOURCEDCS_WEB_URL || '').replace(/\/$/, '');
    if (!webUrl || !callsign) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'not found' }));
    }
    const target = new URL('/api/fpl1801/by-callsign/' + encodeURIComponent(callsign), webUrl);
    const mod    = target.protocol === 'https:' ? require('https') : http;
    const preq   = mod.get(target.href, pres => {
      const chunks = [];
      pres.on('data', c => chunks.push(c));
      pres.on('end', () => {
        res.writeHead(pres.statusCode, { 'Content-Type': 'application/json' });
        res.end(Buffer.concat(chunks));
      });
    });
    preq.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstream error' }));
    });
    return;
  }

  // Serve static data files (aircraft-types.json, airports.json, icao.json …)
  if (req.url.startsWith('/data/')) {
    const dataPath = path.normalize(path.join(DATA_DIR, req.url.slice(6).split('?')[0]));
    if (!dataPath.startsWith(DATA_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
    return fs.readFile(dataPath, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    });
  }

  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));

  // Prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ct = MIME[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct });
    res.end(data);
  });
});

const port = parseInt(process.env.WS_PORT) || 3100;
httpServer.listen(port, () => {
  console.log(`[crc] http://localhost:${port}`);
});
