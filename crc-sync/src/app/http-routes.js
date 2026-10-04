'use strict';

// The HTTP surface of crc-sync, mounted by createApp (app.js). Two groups:
//   mountAuthRoutes  the Casdoor code exchange (cross-origin from crc-desktop's renderer), the WebSocket connect ticket,
//                    GET /js/config.js and GET /api/client-config
//   mountApiRoutes   the on-demand RPC proxy endpoints crc-desktop's local server calls (ATIS, SRS clients, flight plans, stereo
//                    routes, magnetic conversion, airport weather, EFSP metrics and traffic count)
// Each takes what it reads as a plain dependency; nothing here builds a store.

const rateLimit = require('express-rate-limit');

const auth = require('../auth');
const { haversineM } = require('../geo');
const { lookupFlightPlan, toFlightDataFiledSeed, listFiledFlightPlans } = require('../efsp/flight-plan-lookup');
const authLog = require('../log').logger('auth');
const fplLog = require('../log').logger('efsp:flight-plan-lookup');
const stereoLog = require('../log').logger('efsp:stereo-routes');

// ── CORS, scoped — only /api/auth/token is ever called cross-origin, from
// crc-desktop's Electron renderer at http://localhost:<wsPort>. Everything
// else on this API is called server-to-server (crc-desktop's local server
// proxies it) or called by the service-token holders (sourcedcs-web). ────────
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

// ── Auth: code exchange (browser-facing, cross-origin from crc-desktop) ────
const MAX_AUTH_CODE_LEN    = 512;
const MAX_REDIRECT_URI_LEN = 512;

function nearestAirport(lat, lon, missionData) {
  if (!missionData || !missionData.airports) return null;
  let best = null, bestDist = Infinity;
  for (const ap of missionData.airports) {
    if (ap.lat == null || ap.lon == null) continue;
    const d = haversineM(lat, lon, ap.lat, ap.lon);
    if (d < bestDist) { bestDist = d; best = ap; }
  }
  return best;
}

/**
 * @param {import('express').Express} app
 * @param {{env: object}} deps `CRCSYNC_MAPTILER_CLIENT_KEY` and `CRCSYNC_MAPTILER_KEY` are read here
 */
function mountAuthRoutes(app, { env }) {
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many auth requests — please wait before trying again.' },
  });

  // ── Dynamic client config ───────────────────────────────────────────────────
  app.get('/js/config.js', (_req, res) => {
    res.set('Content-Type', 'application/javascript; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.send(
      'var CASDOOR_CLIENT_ID = ' + JSON.stringify(auth.CASDOOR_CLIENT_ID) + ';\n' +
      'var CASDOOR_ENDPOINT  = ' + JSON.stringify(auth.CASDOOR_ENDPOINT)  + ';\n'
    );
  });

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
        authLog.warn('Casdoor token exchange error', { error: tokenData.error, description: tokenData.error_description });
        return res.status(400).json({ error: tokenData.error_description || tokenData.error });
      }
      if (!tokenData.access_token) {
        return res.status(400).json({ error: 'No access token returned by Casdoor' });
      }
      res.json({ access_token: tokenData.access_token });
    } catch (err) {
      authLog.error('token exchange failed', { error: err.message });
      res.status(502).json({ error: 'Casdoor exchange failed' });
    }
  });

  // ── Auth: WS connect ticket (server-to-server, proxied by crc-desktop) ─────
  // Single-use / 30s TTL — see src/auth.js for why this exists instead of the
  // bearer JWT riding directly in the /feed WebSocket URL.
  app.post('/api/ws-ticket', auth.requireAuth, (req, res) => {
    res.json({ ticket: auth.mintTicket(req.user), expiresInMs: 30000 });
  });

  // ── Client config: the MapTiler key crc-desktop draws its basemap with ────
  // The client holds no key (MAPKEY, H82 R3-39): it asks here after login, so
  // rotating the key is an env change on this server, not a client release.
  // CRCSYNC_MAPTILER_CLIENT_KEY (a browser-restricted key) wins; the terrain
  // key CRCSYNC_MAPTILER_KEY is the fallback, so one key works today.
  const maptilerClientKey = (env.CRCSYNC_MAPTILER_CLIENT_KEY || '').trim() || (env.CRCSYNC_MAPTILER_KEY || '').trim() || null;
  app.get('/api/client-config', auth.requireAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ maptilerKey: maptilerClientKey });
  });
}

/**
 * @param {import('express').Express} app
 * @param {object} deps
 * @param {object} deps.atisStore
 * @param {object} deps.grpcClient
 * @param {object} deps.wsHub `setAtisActive`, `getMissionData`
 * @param {object} deps.stereoRoutes
 * @param {object} deps.theaterContext
 * @param {{get:(airportName:string)=>object|undefined}} deps.airportWeather
 * @param {object} deps.efspInstrumentation `metricsHttp`, `trafficCountHttp`
 */
function mountApiRoutes(app, { atisStore, grpcClient, wsHub, stereoRoutes, theaterContext, airportWeather, efspInstrumentation }) {
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

  // EFSP CreateStrip pre-fill — looks up a pilot-submitted DD1801 flight plan
  // from sourcedcs-web by callsign (crc-sync/src/efsp/flight-plan-lookup.js).
  // lookupFlightPlan() never throws/rejects by construction (see that
  // module's own header comment) — this handler is still wrapped so a bug
  // there can never become an unhandled rejection that crashes the process,
  // same discipline the stores' apply catch-alls use (board-store.js's applyMutation() among them).
  app.get('/api/flight-plan-lookup/:callsign', auth.requireAuth, async (req, res) => {
    try {
      const result = await lookupFlightPlan(req.params.callsign);
      if (!result.found) return res.status(404).json({ found: false, reason: result.reason });
      res.json({ found: true, seed: toFlightDataFiledSeed(result.plan) });
    } catch (err) {
      fplLog.error('unexpected error, responding 503 instead of crashing', { err });
      res.status(503).json({ found: false, reason: 'lookup failed unexpectedly' });
    }
  });

  // EFSP ops-filed queue — every currently-filed DD1801 plan
  // (crc-sync/src/efsp/flight-plan-lookup.js's listFiledFlightPlans(), which
  // itself talks to sourcedcs-web's service-token-gated /api/fpl1801/
  // service/all). Same never-throws-out-of-the-handler discipline as
  // /api/flight-plan-lookup above.
  app.get('/api/flight-plan-list', auth.requireAuth, async (req, res) => {
    try {
      const result = await listFiledFlightPlans();
      if (!result.ok) return res.status(503).json({ ok: false, reason: result.reason });
      res.json({ ok: true, plans: result.plans });
    } catch (err) {
      fplLog.error('unexpected error listing plans, responding 503 instead of crashing', { err });
      res.status(503).json({ ok: false, reason: 'list failed unexpectedly' });
    }
  });

  // §9.10's canned-route table (docs/adr/0050), for EFSP's file-by-short-name
  // picker. Active routes only: a retired route must not be offered, and the
  // client has no business rendering one it would then be refused for filing.
  // Read-only — there is no editor this slice, and an editor cannot just POST
  // here, because guide §8.4 requires configuration changes to be versioned
  // and attributed. Same never-throws-out-of-the-handler discipline as the two
  // flight-plan routes above, though nothing here does I/O: the table is
  // already in memory.
  app.get('/api/stereo-routes', auth.requireAuth, (_req, res) => {
    try {
      res.json({ ok: true, routes: stereoRoutes.getActiveStereoRoutes() });
    } catch (err) {
      stereoLog.error('unexpected error, responding 503 instead of crashing', { err });
      res.status(503).json({ ok: false, reason: 'stereo route lookup failed unexpectedly' });
    }
  });

  // A typed magnetic heading, course or radial → true, at a position, on the
  // mission date (docs/adr/0085). The client never converts a typed magnetic
  // value itself (decisions S-R2-12); it asks here, so what is typed and what
  // is shown go through the same model.
  app.get('/api/magnetic/to-true', auth.requireAuth, (req, res) => {
    const magDeg = Number(req.query.magDeg), lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (![magDeg, lat, lon].every(Number.isFinite)) return res.status(400).json({ error: 'magDeg, lat and lon must be numbers' });
    const variationDeg = theaterContext.variationAt(lat, lon);
    const trueDeg = theaterContext.magneticToTrue(magDeg, lat, lon);
    if (trueDeg == null) return res.status(503).json({ error: 'magnetic variation unknown here' });
    res.json({ trueDeg, variationDeg });
  });

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
    // The wind leaves here in both frames, named (decisions.md H76): tower and
    // ATIS readouts use windFromMagnetic, METAR-style text windFromTrue. The raw
    // `windFrom` is not sent, so no client can show it without saying which.
    const { windFrom, ...rest } = w;
    res.json({ airport: airport.name, ...rest, ...theaterContext.windFrom(windFrom, airport.lat, airport.lon) });
  });

  app.get('/api/efsp/metrics', auth.requireAuth, (req, res) => {
    const { status, body } = efspInstrumentation.metricsHttp(req.query || {});
    res.status(status).json(body);
  });
  app.get('/api/efsp/traffic-count', auth.requireAuth, (req, res) => {
    const { status, body } = efspInstrumentation.trafficCountHttp(req.query || {});
    res.status(status).json(body);
  });
}

module.exports = { mountAuthRoutes, mountApiRoutes };
