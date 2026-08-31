'use strict';
require('dotenv').config();

const express     = require('express');
const http        = require('http');
const path        = require('path');
const rateLimit   = require('express-rate-limit');

const GrpcClient      = require('./src/grpc-client');
const SrsClient       = require('./src/srs-client');
const TrackStore      = require('./src/tracks');
const CollaborativeStore = require('./src/collab-store');
const AtisStore       = require('./src/atis-store');
const WsHub           = require('./src/ws-hub');
const resolvePkg      = require('./src/resolve');
const auth            = require('./src/auth');

const PORT       = parseInt(process.env.PORT, 10) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const app    = express();
const server = http.createServer(app);

// ── CORS, scoped — only /api/auth/token is ever called cross-origin, from
// crc-desktop's Electron renderer at http://localhost:<wsPort>. Everything
// else on this API is called server-to-server (crc-desktop's local server
// proxies it) or same-origin (this service's own public/ frontend). ────────
const LOCALHOST_ORIGIN_RE = /^http:\/\/localhost:\d+$/;
function corsForLocalhost(req, res, next) {
  const origin = req.headers.origin;
  if (origin && LOCALHOST_ORIGIN_RE.test(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth requests — please wait before trying again.' },
});

app.use(express.json({ limit: '50kb' }));

// ── Dynamic client config ───────────────────────────────────────────────────
app.get('/js/config.js', (_req, res) => {
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send(
    'var CASDOOR_CLIENT_ID = ' + JSON.stringify(auth.CASDOOR_CLIENT_ID) + ';\n' +
    'var CASDOOR_ENDPOINT  = ' + JSON.stringify(auth.CASDOOR_ENDPOINT)  + ';\n'
  );
});

// ── Auth: code exchange (browser-facing, cross-origin from crc-desktop) ────
const MAX_AUTH_CODE_LEN    = 512;
const MAX_REDIRECT_URI_LEN = 512;
// Browsers send an OPTIONS preflight before the actual POST (since the real
// request carries a Content-Type header) — app.post() alone never sees that
// preflight, so it needs its own route or the preflight gets no CORS headers
// and the browser blocks the real request before it's ever sent.
app.options('/api/auth/token', corsForLocalhost);
app.post('/api/auth/token', corsForLocalhost, authLimiter, async (req, res) => {
  const { code, redirectUri } = req.body || {};
  if (!code || typeof code !== 'string' || code.length > MAX_AUTH_CODE_LEN) {
    return res.status(400).json({ error: 'Missing or invalid code' });
  }
  if (!redirectUri || typeof redirectUri !== 'string' || redirectUri.length > MAX_REDIRECT_URI_LEN) {
    return res.status(400).json({ error: 'Missing or invalid redirectUri' });
  }
  try {
    const tokenData = await auth.casdoorTokenExchange(code, redirectUri);
    if (tokenData.error) {
      console.warn('[auth] Casdoor token exchange error:', tokenData.error, tokenData.error_description);
      return res.status(400).json({ error: tokenData.error_description || tokenData.error });
    }
    if (!tokenData.access_token) {
      return res.status(400).json({ error: 'No access token returned by Casdoor' });
    }
    res.json({ access_token: tokenData.access_token });
  } catch (err) {
    console.error('[auth] token exchange failed:', err.message);
    res.status(502).json({ error: 'Casdoor exchange failed' });
  }
});

// ── Auth: WS connect ticket (server-to-server, proxied by crc-desktop) ─────
// Single-use / 30s TTL — see src/auth.js for why this exists instead of the
// bearer JWT riding directly in the /feed WebSocket URL.
app.post('/api/ws-ticket', auth.requireAuth, (req, res) => {
  res.json({ ticket: auth.mintTicket(req.user), expiresInMs: 30000 });
});

// ── Core components ──────────────────────────────────────────────────────
const trackStore  = new TrackStore();
const collabStore = new CollaborativeStore();
const atisStore   = new AtisStore();
const grpcClient  = new GrpcClient();
const srsClient   = new SrsClient();
const wsHub       = new WsHub(trackStore, collabStore);

wsHub.attach(server);

grpcClient.on('unit', (unitData) => {
  trackStore.update(unitData, srsClient.getTransponder(unitData.player));
});
grpcClient.on('gone', (id) => trackStore.remove(id));

let airportWeather = new Map(); // airport name -> { windFrom, windKt, tempC, pressureHpa, updatedAt }
let weatherRefreshTimer = null;

async function refreshAirportWeather(missionData) {
  if (!missionData || !missionData.airports) return;
  for (const ap of missionData.airports) {
    try {
      const w = await grpcClient.getAptWeather(ap.lat, ap.lon, ap.elev || 0);
      airportWeather.set(ap.name, { ...w, updatedAt: Date.now() });
    } catch (e) {
      console.warn(`[weather] apt-weather fetch failed for ${ap.name}:`, e.message);
    }
  }
}

grpcClient.on('mission-load', (missionData) => {
  trackStore.clear();
  collabStore.clear();
  wsHub.setMissionData(missionData);
  console.log(`[crc-sync] mission init — ${missionData.airports.length} airports`);

  airportWeather = new Map();
  refreshAirportWeather(missionData);
  clearInterval(weatherRefreshTimer);
  weatherRefreshTimer = setInterval(() => refreshAirportWeather(missionData), 60000);
});

grpcClient.on('status', (state) => wsHub.setGrpcStatus(state));
grpcClient.on('weather', (data) => wsHub.setWeather(data));
grpcClient.on('game-time', (dt) => wsHub.setGameTime(dt));
grpcClient.on('radar-locks', (locks) => wsHub.broadcastRadarLocks(locks));

srsClient.on('status', (state) => wsHub.setSrsStatus(state));

// ── On-demand RPC proxy endpoints (per-action, not shared streams) ─────────
// ownerId is a client-generated id (one per crc-desktop app session), used to
// tell "my own next 5s loop tick" apart from "a different controller's
// client" — see src/atis-store.js for why this needs to live here at all.
app.post('/api/atis-transmit', auth.requireAuth, (req, res) => {
  const body = req.body || {};
  const freq = body.frequency || body.frequencyHz;
  const { ownerId, stop } = body;
  if (!ownerId || freq == null) {
    return res.status(400).json({ error: 'ownerId and frequency are required' });
  }

  if (stop) {
    atisStore.stop(freq, ownerId);
    wsHub.setAtisActive(atisStore.getActive());
    return res.json({ ok: true });
  }

  if (!atisStore.canStart(freq, ownerId)) {
    return res.status(409).json({ error: 'Another client is already transmitting on this frequency' });
  }

  const { call, promise } = grpcClient.transmitAtis(body);
  atisStore.start(freq, ownerId, call);
  wsHub.setAtisActive(atisStore.getActive());
  promise
    .then(r => { atisStore.finish(freq, call); res.json({ ok: true, duration_ms: r && r.duration_ms }); })
    .catch(err => { atisStore.finish(freq, call); res.status(503).json({ error: err.message }); });
});

app.get('/api/srs-clients', auth.requireAuth, (_req, res) => {
  grpcClient.getSrsClients()
    .then(data => res.json(data))
    .catch(err => res.status(503).json({ error: err.message }));
});

function nearestAirport(lat, lon, missionData) {
  if (!missionData || !missionData.airports) return null;
  let best = null, bestDist = Infinity;
  for (const ap of missionData.airports) {
    if (ap.lat == null || ap.lon == null) continue;
    const d = resolvePkg.haversineM(lat, lon, ap.lat, ap.lon);
    if (d < bestDist) { bestDist = d; best = ap; }
  }
  return best;
}

app.get('/api/apt-weather', auth.requireAuth, (req, res) => {
  const missionData = wsHub.getMissionData();
  const { lat, lon, name } = req.query;
  let airport = null;
  if (name) {
    airport = (missionData?.airports || []).find(a => a.name === name);
  } else if (lat != null && lon != null) {
    airport = nearestAirport(parseFloat(lat), parseFloat(lon), missionData);
  }
  if (!airport) return res.status(404).json({ error: 'airport not found' });
  const w = airportWeather.get(airport.name);
  if (!w) return res.status(503).json({ error: 'weather not yet available for this airport' });
  res.json({ airport: airport.name, ...w });
});

// ── Stale reaper — mirrors crc-desktop's original 12s track eviction, now
// also evicts orphaned CollaborativeStore entries in the same tick. Also
// re-broadcasts AtisStore's active list so a client that crashed without
// ever POSTing {stop:true} still clears from everyone else's "in use"
// display once its presence entry lapses (see AtisStore.getActive()). ─────
setInterval(() => {
  const n = trackStore.expireStale();
  const activeIds = new Set(trackStore.getAll().map(t => String(t.id)));
  const evicted = collabStore.evictStale(activeIds);
  if (n > 0 || evicted > 0) console.log(`[crc-sync] expired ${n} stale track(s), evicted ${evicted} overlay entr(y/ies)`);
  wsHub.setAtisActive(atisStore.getActive());
}, 5000);

// ── Static hosting ───────────────────────────────────────────────────────
app.use(express.static(PUBLIC_DIR));

server.listen(PORT, () => {
  console.log(`[crc-sync] http://localhost:${PORT}`);
});

grpcClient.connect();
srsClient.connect();
