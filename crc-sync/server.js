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
const { haversineM }  = require('./src/geo');
const { createSurveillance } = require('./src/surveillance');
const { DatalinkFeed } = require('./src/surveillance/datalink');
const auth            = require('./src/auth');
const { createEfsp }  = require('./src/efsp');
const efspFacilityConfig = require('./src/efsp/facility-config');
const { buildRadars, loadSensorSpecs } = require('./src/radars');
const { TerrainStore } = require('./src/terrain');
const { CoverageEngine } = require('./src/coverage');
const { StationCoverage, assignableRadars, reportUnresolvedSelectors } = require('./src/efsp/station-coverage');
const { ForwardingObligationMonitor } = require('./src/efsp/forwarding-obligations');
const { CorrelationReconciler, CORRELATION_TICK_MS } = require('./src/efsp/correlation-reconciler');
const { ConformanceMonitor } = require('./src/efsp/conformance');
const { StcaMonitor } = require('./src/stca');
const { loadAlertingConfig } = require('./src/alerting-config');
const { indicatedAltFt } = require('./src/altimetry');
const { MissionClock } = require('./src/mission-clock');
const { loadTheaters } = require('./src/theaters');
const { TheaterContext } = require('./src/theater-context');
const { lookupFlightPlan, toFdrFiledSeed, listFiledFlightPlans } = require('./src/efsp/flight-plan-lookup');
const efspStereoRoutes = require('./src/efsp/stereo-routes');

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
// EFSP (src/efsp/) is durably persisted (docs/adr/0002-durable-board-
// persistence.md) — deliberately NOT cleared below on mission reload,
// unlike trackStore/collabStore. Strips represent real controller work
// product and must survive a DCS mission reload, not just a crc-sync
// restart. DO NOT add efsp.boardStore/fdrStore clear() calls to the
// mission-reload handler below.
// The mission clock (docs/adr/0079): in-game Zulu, fed by the gRPC game-time
// poll below. Every EFSP time a controller reads — gates, deadlines, Strip
// clocks, Mutation timestamps — comes from here, never from Date.now().
const theaters     = loadTheaters();
const missionClock = new MissionClock({ offsetHoursFor: (theatre) => theaters[theatre]?.utcOffsetHours ?? null });
// The map the mission is on (docs/adr/0085): transition altitude, and what
// "magnetic" means at a position on the mission date. The one place a typed
// magnetic value becomes true, and the source of the `theater` message.
const theaterContext = new TheaterContext({ theaters, clock: missionClock });
const efsp        = createEfsp({ clock: missionClock });

// ── The radar picture (docs/adr/0042) ────────────────────────────────────
// Radars, their sweep phase, terrain masking and who may look through what
// all live here now rather than in each renderer. The chain is:
//
//   sensor-specs.json + missionData + tracks  ->  buildRadars()
//   StationCoverage    which Positions grant which of those radars
//   CoverageEngine     what each of those radars is illuminating, one phase
//                      for everybody, terrain included
//   WsHub              each session gets only what its Positions can see
//
// The radar list is rebuilt per tick rather than cached: it depends on live
// tracks (an AWACS taking off is a new radar) and the cost is a walk over the
// airfield list plus the tracks, which the sweep does anyway.
const sensorSpecs  = loadSensorSpecs();
const terrainStore = new TerrainStore();
const coverageEngine = new CoverageEngine({ terrain: terrainStore });

function currentRadars() {
  return buildRadars({
    missionData: wsHub.getMissionData(),
    tracks: trackStore.getAll(),
    radarSpecs: sensorSpecs,
  });
}

const stationCoverage = new StationCoverage({
  facilityConfig: efspFacilityConfig,
  positionStoreFor: efsp.positionStoreFor,
  radars: currentRadars,
});

const picture = {
  coverageFor: (controllerId) => {
    const result = stationCoverage.forController(controllerId);
    // Stamp each radar with the server's own sweep phase. The client draws the
    // debug beam overlay from it, and that overlay used to be decorative —
    // each renderer guessed its own phase, so the beam it drew was nowhere
    // near where the beam that actually revealed a contact was. Now they are
    // the same number.
    const now = Date.now();
    result.radars = result.radars.map(r => ({ ...r, sweepStart: coverageEngine.sweepStartFor(r.id, now) }));
    return result;
  },
  illuminated: () => coverageEngine.illuminatedNow,
  radars: currentRadars,
};

// What a controller is told about a contact (docs/adr/0059): what its
// transponder sends (SRS for players, a synthetic code for own/neutral AI),
// who it is (its flight, a tag, or its track number), and the datalink.
// The datalink feed: own participants report themselves, and what their
// radar is locked on (docs/adr/0059). Ticked with the hub; locks polled from
// the mission on their own, slower, rhythm.
const datalink = new DatalinkFeed({
  evalLua: (lua) => grpcClient.evalLua(lua), trackStore, config: sensorSpecs.datalink,
});
setInterval(() => datalink.pollLocks(), sensorSpecs.datalink.lockPollMs);

const surveillance = createSurveillance({
  datalink,
  collab: collabStore,
  srs: srsClient,
  sensorSpecs,
  correlationStore: efsp.correlationStore,
  fdrStore: efsp.fdrStore,
  env: () => ({ weather: grpcClient.getWeather(), transitionAltFt: theaterContext.transitionAltFt() }),
});
const { transponders, identity } = surveillance;

const wsHub       = new WsHub({ trackStore, collabStore, efsp, picture, surveillance, clock: missionClock, theater: theaterContext });

wsHub.attach(server);

// One sweep for the whole server, over only the radars somebody is actually
// looking through — an unattended airfield's radar costs nothing. Illumination
// instants are computed rather than sampled (docs/adr/0043), so this interval
// is a delivery choice: it bounds how late a contact can appear, not whether
// it appears at all. 250ms against real scan periods of 2-3s is well inside
// the noise.
const COVERAGE_TICK_MS = 250;

// The radar list itself changes under everyone — an AWACS takes off or lands,
// a ship spawns — and until this existed nothing told a client about it. A GCI
// controller whose AWACS had just got airborne started receiving contacts
// through it while their coverage panel still listed nothing and the
// "NO RADAR COVERAGE" banner stayed up, because coverage was only re-sent on
// efsp-set-positions and on mission load. Compared by id set so the refresh
// fires once per takeoff, not once per tick.
let lastRadarIds = '';

setInterval(() => {
  const radars = currentRadars();
  const ids = radars.map(r => r.id).sort().join(',');
  if (ids !== lastRadarIds) {
    lastRadarIds = ids;
    wsHub.refreshAllCoverage();
  }
  coverageEngine.tick(stationCoverage.activeRadars(), trackStore.getAll(), wsHub.getMissionData());
}, COVERAGE_TICK_MS);

grpcClient.on('unit', (unitData) => {
  trackStore.update(unitData);
});
grpcClient.on('gone', (id) => { trackStore.remove(id); transponders.release(id); });

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

// ── F3 mission session (docs/adr/0086, decisions.md S-R2-2) ───────────────
// Which mission we are in: H22's wind-derived runway, H32's metrics session and
// H36's archiver all read it. Registered BEFORE the mission-load handler below,
// so that handler already sees the session this load belongs to.
const { MissionSession } = require('./src/mission-session');
const missionSession = new MissionSession({ clock: missionClock });
let lastMissionData = null;
grpcClient.on('mission-start', () => missionSession.noteMissionStart());
grpcClient.on('mission-load', (missionData) => {
  lastMissionData = missionData;
  missionSession.noteMissionLoad(missionData);
});
// A clock step back opens a session with no mission-load behind it: the wind
// is re-read then too (a load-driven session is handled in the handler below).
missionSession.onNewSession((session) => {
  if (session.reason === 'CLOCK_STEP_BACK' && lastMissionData) deriveActiveRunwaysFromWind(lastMissionData);
});
// ── end F3 mission session ────────────────────────────────────────────────

grpcClient.on('mission-load', (missionData) => {
  trackStore.clear();
  surveillance.clear();
  collabStore.clear();
  // Every radar id, sweep phase and line-of-sight answer belonged to the
  // theater that just went away.
  coverageEngine.reset();
  // And so did every track id. This is defect D1 in its most brutal form —
  // nothing about any airframe changed and every contact was re-minted — so
  // every Strip's correlation is dropped with a warning naming why, and the
  // next tick re-binds each one on its beacon code. §6.6 rule 3 permits
  // exactly two outcomes on an identity change; this does both, in order,
  // rather than leaving a stale binding pointing at a contact that is gone.
  // (Declared below with the other monitors; this closure runs long after.)
  correlationReconciler.resetPicture('MISSION_RELOAD');
  // Do NOT add efsp.boardStore.clear()/efsp.fdrStore.clear() here — EFSP
  // Strips are durably persisted and MUST survive a mission reload, unlike
  // tracks/the IFF overlay (see the `const efsp = createEfsp()` comment
  // above and docs/adr/0002-durable-board-persistence.md).
  // A mission is running even when GetTheatre failed, so that is an unknown
  // theater (offset 0, flagged), not "no theater yet" (the wall clock).
  missionClock.setTheatre(missionData.theatre || 'UNKNOWN');
  wsHub.setMissionData(missionData);
  wsHub.broadcastGameTime();
  theaterContext.setMission(missionData);
  wsHub.broadcastTheater();
  console.log(`[crc-sync] mission init — ${missionData.airports.length} airports, theater ${missionData.theatre || 'unknown'}`);

  // Which selectors found nothing in THIS theater — the only point at which
  // that question has an answer, since a selector naming an airfield the map
  // lacks is legitimate config.
  const radars = currentRadars();
  reportUnresolvedSelectors(efspFacilityConfig, radars);

  // Fetch the DEM covering this theater's airfield radars up front. Without it
  // the first minutes of a session fail open on every sight line and terrain
  // masks nothing — correct behaviour, but not the behaviour anyone wants.
  //
  // Scoped to radars some Position is actually ASSIGNED, not every airfield in
  // the theater: a 225-airfield map produces 450 airfield radars and would
  // pre-fetch about nine hundred tiles for scopes nobody will ever look
  // through. Not scoped to OCCUPIED Positions, though — a controller taking
  // Approach mid-session must not then wait for a DEM. Airborne radars are
  // excluded because they move, so there is no fixed circle to fetch, and
  // they warm as they fly.
  terrainStore.prewarmForRadars(
    assignableRadars(efspFacilityConfig, radars)
      .filter(r => r.type === 'airport' || r.type === 'approach'),
  );

  airportWeather = new Map();
  refreshAirportWeather(missionData);
  clearInterval(weatherRefreshTimer);
  weatherRefreshTimer = setInterval(() => refreshAirportWeather(missionData), 60000);

  // ── L1 field state: active runway from wind (H22) ─────────────────────────
  deriveActiveRunwaysFromWind(missionData);
  // ── end L1 field state ────────────────────────────────────────────────────
});

// Each Facility with runways takes the end most into its airfield's wind as the
// active runway, once per mission SESSION (docs/adr/0061, 0086): the store
// skips a Facility whose runway was already derived in the current session, so
// a gRPC reconnect or a crc-sync restart keeps the end TWR has since chosen,
// and the same .miz restarted for a new sortie reads the wind again. DCS wind
// is TRUE and is compared with each end's true heading from the inventory,
// never with the magnetic end number.
function deriveActiveRunwaysFromWind(missionData) {
  const missionSessionSeq = missionSession.currentSeq();
  for (const facilityId of efspFacilityConfig.getFacilityIds()) {
    const icao = (efspFacilityConfig.getFacilityConfig(facilityId).fieldState || {}).airportIcao;
    if (!icao || !efsp.fieldStateStore.hasFieldState(facilityId)) continue;
    const airport = (missionData.airports || []).find(a => a.icao === icao);
    if (!airport) { console.warn(`[field-state] ${facilityId}: no ${icao} in this mission — active runway left as it is`); continue; }
    grpcClient.getAptWeather(airport.lat, airport.lon, airport.elev || 0)
      .then((w) => {
        const r = efsp.fieldStateStore.setActiveRunwayFromWind(facilityId, { windFromTrue: w.windFrom, windKt: w.windKt, missionSession: missionSessionSeq });
        // Persisted even when the end is unchanged: the store has recorded
        // that this session's wind is applied (docs/adr/0086).
        if (r.ok && !r.skipped) efsp.persist();
        if (r.ok && r.changed) {
          // ws-hub.js has no field-state broadcaster and is not L1's to edit
          // (serialised L7 -> L10); its generic _broadcast carries the same
          // delta a field-state op sends. A public broadcastEfspFieldStateDelta
          // is a follow-up for whoever next holds ws-hub.js.
          wsHub._broadcast({
            version: 1, type: 'efsp-field-state-delta', fieldStateSeq: efsp.fieldStateStore.currentSeq,
            fieldStates: { updated: [efsp.fieldStateStore.getFieldState(facilityId)] },
          });
          efsp.nlaStatusMonitor.tick();
          console.log(`[field-state] ${facilityId}: active runway ${r.activeRunway} from the mission wind (${w.windFrom}° true, ${w.windKt} kt)`);
        }
      })
      .catch((e) => console.warn(`[field-state] ${facilityId}: wind fetch failed, active runway left as it is:`, e.message));
  }
}

grpcClient.on('status', (state) => wsHub.setGrpcStatus(state));
grpcClient.on('weather', (data) => wsHub.setWeather(data));
grpcClient.on('game-time', (dt) => {
  if (!missionClock.sample(dt)) return;
  wsHub.broadcastGameTime();
  // Variation depends on the mission date: a new day, or the first mission
  // sample after the wall clock, moves it.
  if (theaterContext.noteClock()) wsHub.broadcastTheater();
});
// F3: after the sample, so the step-back check reads this poll's time (ADR 0086).
grpcClient.on('game-time', () => missionSession.observeClock());
// With DCS gone there are no samples to broadcast on, and the clock has fallen
// back to the wall clock — clients still need to hear that, and when.
let lastClockSource = missionClock.source;
setInterval(() => {
  const source = missionClock.source;
  if (source === 'WALL' || source !== lastClockSource) wsHub.broadcastGameTime();
  if (theaterContext.noteClock()) wsHub.broadcastTheater();
  lastClockSource = source;
}, 5000);

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
    const d = haversineM(lat, lon, ap.lat, ap.lon);
    if (d < bestDist) { bestDist = d; best = ap; }
  }
  return best;
}

// EFSP CreateStrip pre-fill — looks up a pilot-submitted DD1801 flight plan
// from sourcedcs-web by callsign (crc-sync/src/efsp/flight-plan-lookup.js).
// lookupFlightPlan() never throws/rejects by construction (see that
// module's own header comment) — this handler is still wrapped so a bug
// there can never become an unhandled rejection that crashes the process,
// same discipline board-store.js's applyMutation() catch-all uses.
app.get('/api/flight-plan-lookup/:callsign', auth.requireAuth, async (req, res) => {
  try {
    const result = await lookupFlightPlan(req.params.callsign);
    if (!result.found) return res.status(404).json({ found: false, reason: result.reason });
    res.json({ found: true, seed: toFdrFiledSeed(result.plan) });
  } catch (err) {
    console.error('[flight-plan-lookup] unexpected error, responding 503 instead of crashing:', err);
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
    console.error('[flight-plan-lookup] unexpected error listing plans, responding 503 instead of crashing:', err);
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
    res.json({ ok: true, routes: efspStereoRoutes.getActiveStereoRoutes() });
  } catch (err) {
    console.error('[efsp-stereo-routes] unexpected error, responding 503 instead of crashing:', err);
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
  res.json({ airport: airport.name, ...w });
});

// ── WP8 instrumentation (docs/adr/0065) — the §11.5 metric set, the §11.4
// traffic count and Mutation-log retention, in one self-contained block. It
// wraps efsp.handleMessage/onDisconnect (ws-hub.js looks them up per message,
// and no socket connects before server.listen below). correlationReconciler
// and obligationMonitor are consts declared further down: the getters are
// closures, only ever called from the 60 s tick or a request, both of which
// run after this file has finished loading.
const { createEfspInstrumentation } = require('./src/efsp/metrics');
const efspInstrumentation = createEfspInstrumentation({
  efsp,
  facilityConfig: efspFacilityConfig,
  clock: missionClock,
  correlationStats: () => correlationReconciler.getStats(),
  obligationStats: () => obligationMonitor.getComplianceStats(),
  // A metrics session is one mission to the next (H32): F3's mission session.
  missionSession,
});
app.get('/api/efsp/metrics', auth.requireAuth, (req, res) => {
  const { status, body } = efspInstrumentation.metricsHttp(req.query || {});
  res.status(status).json(body);
});
app.get('/api/efsp/traffic-count', auth.requireAuth, (req, res) => {
  const { status, body } = efspInstrumentation.trafficCountHttp(req.query || {});
  res.status(status).json(body);
});
setInterval(() => efspInstrumentation.tick(), 60000);

// ── Stale reaper — mirrors crc-desktop's original 12s track eviction, now
// also evicts orphaned CollaborativeStore entries in the same tick. Also
// re-broadcasts AtisStore's active list so a client that crashed without
// ever POSTing {stop:true} still clears from everyone else's "in use"
// display once its presence entry lapses (see AtisStore.getActive()). ─────
setInterval(() => {
  const n = trackStore.expireStale();
  const activeIds = new Set(trackStore.getAll().map(t => String(t.id)));
  const evicted = collabStore.evictStale(activeIds);
  surveillance.forget(activeIds);
  if (n > 0 || evicted > 0) console.log(`[crc-sync] expired ${n} stale track(s), evicted ${evicted} overlay entr(y/ies)`);
  wsHub.setAtisActive(atisStore.getActive());
}, 5000);

// ── WP4A forwarding obligations (guide §4.6.1, docs/adr/0021, 0067) — the
// set due right now, sent as state in efsp-alerts (broadcastEfspAlerts below).
// Re-evaluated on a 15s sweep for the clock (comfortably fine-grained for
// minute-scale obligations) and right after any EFSP Mutation, so a
// controller's fix clears its badge at once. ────────────────────────────
const obligationMonitor = new ForwardingObligationMonitor({
  clock: missionClock,
  boardStoreFor: efsp.boardStoreFor,
  fdrStore: efsp.fdrStore,
  facilityConfig: efspFacilityConfig,
  airspaceStore: efsp.airspaceStore,
});

// The NLA inhibit status every Strip carries on the wire (F-408) has a
// clock-driven half that no message covers — a release time passing, an EDCT
// or call-for-release window opening or closing, a void deadline reached. This
// sweep re-states only the Strips whose status actually moved; on a quiet
// Board it sends nothing. See nla-status-monitor.js for why it shares the
// obligation sweep's tick rather than taking one of its own — in short,
// VOID_TIME_EXPIRED is raised as an alert there and rendered as an inhibit
// reason here, and two cadences would let the two disagree.
efsp.nlaStatusMonitor.setOnDelta((payload) => wsHub.broadcastEfspBoardDelta(payload));
setInterval(() => {
  if (obligationMonitor.tick()) broadcastEfspAlerts();
  efsp.nlaStatusMonitor.tick();
}, 15000);
wsHub.setOnEfspChange(() => { if (obligationMonitor.tick()) broadcastEfspAlerts(); });

// ── WP5 Strip<->track correlation (guide §6.6, docs/adr/0045/0046) ───────
// Its own cadence again, and a much faster one: this is what keeps each
// Strip's bound contact fresh, and §6.6 rule 4's benchmark is one second. The
// store lives inside createEfsp() (it needs the MutationLog and the atomic
// snapshot); the reconciler lives out here, because only this file has the
// TrackStore — the same split airspaceStore and obligationMonitor already
// have.
const correlationReconciler = new CorrelationReconciler({
  clock: missionClock,
  trackStore,
  // The code the aircraft is actually sending (docs/adr/0059).
  beaconOf: (t) => { const x = transponders.transponderOf(t); return x ? x.code : null; },
  fdrStore: efsp.fdrStore,
  correlationStore: efsp.correlationStore,
  boardStoreFor: efsp.boardStoreFor,
  facilityConfig: efspFacilityConfig,
  onDelta: (payload) => wsHub.broadcastEfspCorrelationDelta(payload),
});
setInterval(() => correlationReconciler.tick(), CORRELATION_TICK_MS);

// ── Conformance and short-term conflict alerting (docs/adr/0058) ─────────
// Server-side, because only this process sees every track: a client only
// receives the ones inside its own coverage. Once a second, the same rhythm as
// correlation (whose records conformance reads). Only what is WRONG is ever
// sent; the whole alert state goes out when it changes.
const alertingConfig = loadAlertingConfig();
const conformanceMonitor = new ConformanceMonitor({
  clock: missionClock,
  trackStore,
  fdrStore: efsp.fdrStore,
  correlationStore: efsp.correlationStore,
  weather: () => grpcClient.getWeather(),
  transitionAltFt: () => theaterContext.transitionAltFt(),
  indicatedAltFt,
  // DCS's course is grid; the typed HDG is magnetic (docs/adr/0085).
  gridToMagnetic: (deg, lat, lon) => theaterContext.gridToMagnetic(deg, lat, lon),
  config: alertingConfig.conformance,
});
const stcaMonitor = new StcaMonitor({
  trackStore,
  config: alertingConfig.stca,
  fdrForTrack: (trackId) => efsp.correlationStore.fdrForTrack(trackId),
  activeMarsaFor: (fdrId) => efsp.marsaStore.activeFor(fdrId),
  // Alert text names each aircraft the way identity does (docs/adr/0059).
  callsignFor: (track) => identity.labelFor(track.id),
});
// The one place efsp-alerts is composed (docs/adr/0067). broadcastEfspAlerts
// replaces the whole alert state, so every producer — the 1s conformance/STCA
// tick, the 15s obligation sweep, the post-Mutation hook — must send all three
// slices, or it would erase the others'. A function declaration: the 15s
// interval above calls it, long after these consts exist.
function broadcastEfspAlerts() {
  wsHub.broadcastEfspAlerts({
    conformance: conformanceMonitor.getAll(),
    stca: stcaMonitor.getAll(),
    obligations: obligationMonitor.getAll(),
  });
}
// Conformance runs on the mission clock — its grace period is measured from
// the clearance's own timestamp, which is mission time, and the `since` it
// reports is shown to controllers. STCA stays on the wall clock: it only
// compares track ages, which tracks.js stamps in wall time, and shows no time
// of day at all.
setInterval(() => {
  const conformanceChanged = conformanceMonitor.tick();
  const stcaChanged = stcaMonitor.tick(Date.now());
  if (conformanceChanged || stcaChanged) {
    broadcastEfspAlerts();
  }
}, 1000);

// ── Static hosting ───────────────────────────────────────────────────────
app.use(express.static(PUBLIC_DIR));

server.listen(PORT, () => {
  console.log(`[crc-sync] http://localhost:${PORT}`);
});

grpcClient.connect();
srsClient.connect();
