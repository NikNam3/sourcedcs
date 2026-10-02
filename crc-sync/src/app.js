'use strict';

// The composition root (docs/adr/0095 §4). server.js reads the environment,
// makes the two real network clients, calls createApp(), start() and listen.
// createApp() wires every store, monitor and the hub, and returns the named
// `tickers` that start() runs on timers. The soak host (tools/soak/host-core.js)
// and the tests call the same function with fakes and drive the tickers by name,
// so nobody re-implements the monitor wiring.

const express     = require('express');
const http        = require('http');
const path        = require('path');
const rateLimit   = require('express-rate-limit');

const GrpcClient      = require('./grpc-client');
const SrsClient       = require('./srs-client');
const TrackStore      = require('./tracks');
const CollaborativeStore = require('./collab-store');
const AtisStore       = require('./atis-store');
const WsHub           = require('./ws-hub');
const { haversineM }  = require('./geo');
const { createSurveillance } = require('./surveillance');
const { DatalinkFeed } = require('./surveillance/datalink');
const auth            = require('./auth');
const { createEfsp }  = require('./efsp');
const { statePaths } = require('./state-paths');
const efspFacilityConfig = require('./efsp/facility-config');
const { buildRadars, loadSensorSpecs } = require('./radars');
const { TerrainStore } = require('./terrain');
const { CoverageEngine } = require('./coverage');
const { PositionCoverage, assignableRadars, reportUnresolvedSelectors } = require('./efsp/position-coverage');
const { ForwardingObligationMonitor } = require('./efsp/forwarding-obligations');
const { CorrelationReconciler, CORRELATION_TICK_MS } = require('./efsp/correlation-reconciler');
const { SurveillanceHintMonitor } = require('./efsp/surveillance-hints');
const { getHintsConfig } = require('./efsp/surveillance-hints-config');
const { ConformanceMonitor } = require('./efsp/conformance');
const { ConflictAlertMonitor } = require('./conflict-alert');
const { loadAlertingConfig } = require('./alerting-config');
const { indicatedAltFt } = require('./altimetry');
const { MissionClock, WALL_CLOCK } = require('./mission-clock');
const { MissionSession } = require('./mission-session');
const { loadTheaters } = require('./theaters');
const { TheaterContext } = require('./theater-context');
const { lookupFlightPlan, toFlightDataFiledSeed, listFiledFlightPlans } = require('./efsp/flight-plan-lookup');
const efspStereoRoutes = require('./efsp/stereo-routes');
const { createEfspInstrumentation } = require('./efsp/metrics');
const { archiveDeltas } = require('./efsp/archiver');
const { CarrierTick } = require('./efsp/carrier-tick');
const { carrierDelta } = require('./efsp/efsp-ws');
const { USER_COALITION } = require('./surveillance/iff');
const { wireCollabSession } = require('./collab-wiring');
const log = require('./log').logger('app');
const authLog = require('./log').logger('auth');
const weatherLog = require('./log').logger('weather');
const fieldLog = require('./log').logger('runway-status');
const archiverLog = require('./log').logger('efsp:archiver');
const fplLog = require('./log').logger('efsp:flight-plan-lookup');
const stereoLog = require('./log').logger('efsp:stereo-routes');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

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

// One sweep for the whole server, over only the radars somebody is actually
// looking through — an unattended airfield's radar costs nothing. Illumination
// instants are computed rather than sampled (docs/adr/0043), so this interval
// is a delivery choice: it bounds how late a contact can appear, not whether
// it appears at all. 250ms against real scan periods of 2-3s is well inside
// the noise.
const COVERAGE_TICK_MS = 250;

/**
 * @param {object} [deps]
 * @param {object} [deps.env] the environment; `LOG_LEVEL`, `CRCSYNC_TEST_RESET`, `NODE_ENV` and `CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH` are read here
 * @param {{read:string, write:string}} [deps.paths] the Board snapshot's paths (default: state/ per `env`)
 * @param {object} [deps.grpcClient] the DCS-gRPC client (default: a new, unconnected GrpcClient). server.js connects it
 * @param {object} [deps.srsClient] the SRS client (default: a new, unconnected SrsClient)
 * @param {{now:()=>number, source:string}} [deps.clock] the mission clock; default a MissionClock fed by the gRPC game-time poll
 *
 * Test/soak seams (the soak host has no sensors and no DCS, so it names what the production wiring would add):
 * @param {object|null} [deps.missionSession] default a MissionSession on its state file; the soak passes an in-memory one
 * @param {object|null} [deps.surveillanceHints] undefined builds the SurveillanceHintMonitor (and wires every Board's airborne
 *   observer to it); null leaves both out, so efsp-alerts carries no `surveillance` slice and the departure gate has no observer
 * @param {{beacon?:Function, callsign?:Function, gridToMagnetic?:Function}} [deps.trackSeams] how a synthetic track is
 *   read: `beacon(track)` the code it squawks (default the transponder model), `callsign(track)` its label in an alert
 *   (default the identity model), `gridToMagnetic(deg, lat, lon)` (default the theater's)
 *
 * @returns {{ http, server, wsHub, efsp, monitors, tickers, start: Function, stop: Function }}
 *   `http` is the express app, `server` the http.Server (never listening: server.js calls listen); `tickers` is
 *   [{ name, periodMs, tick }], installed by start() and cleared by stop().
 */
function createApp(deps = {}) {
  const env = deps.env || process.env;
  require('./log').configure({ level: env.LOG_LEVEL }); // once per app (ADR 0097)
  const trackSeams = deps.trackSeams || {};

  const app    = express();
  /* Behind nginx (one hop): key req.ip / rate limiters on the real client from
     X-Forwarded-For, not on the nginx container's address. */
  app.set('trust proxy', 1);
  const server = http.createServer(app);

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

  // ── Core components ──────────────────────────────────────────────────────
  const trackStore  = new TrackStore();
  const collabStore = new CollaborativeStore({ persist: true, identityOf: (id) => trackStore.get(id) });
  const atisStore   = new AtisStore();
  const grpcClient  = deps.grpcClient || new GrpcClient();
  const srsClient   = deps.srsClient || new SrsClient();
  // EFSP (src/efsp/) is durably persisted (docs/adr/0002-durable-board-
  // persistence.md) — deliberately NOT cleared below on mission reload,
  // unlike trackStore/collabStore. Strips represent real controller work
  // product and must survive a DCS mission reload, not just a crc-sync
  // restart. DO NOT add efsp.boardStore/flightDataStore clear() calls to the
  // mission-reload handler below.
  // The mission clock (docs/adr/0079): in-game Zulu, fed by the gRPC game-time
  // poll below. Every EFSP time a controller reads — gates, deadlines, Strip
  // clocks, Mutation timestamps — comes from here, never from Date.now().
  const theaters     = loadTheaters();
  const missionClock = deps.clock || new MissionClock({ offsetHoursFor: (theatre) => theaters[theatre]?.utcOffsetHours ?? null });
  // The map the mission is on (docs/adr/0085): transition altitude, and what
  // "magnetic" means at a position on the mission date. The one place a typed
  // magnetic value becomes true, and the source of the `theater` message.
  const theaterContext = new TheaterContext({ theaters, clock: missionClock });
  const boardPaths   = deps.paths || statePaths('efsp-board.json', env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH);
  const efsp        = createEfsp({ clock: missionClock, transitionAltFt: () => theaterContext.transitionAltFt(), paths: boardPaths });

  // ── The radar picture (docs/adr/0042) ────────────────────────────────────
  // Radars, their sweep phase, terrain masking and who may look through what
  // all live here now rather than in each renderer. The chain is:
  //
  //   sensor-specs.json + missionData + tracks  ->  buildRadars()
  //   PositionCoverage    which Positions grant which of those radars
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

  const positionCoverage = new PositionCoverage({
    facilityConfig: efspFacilityConfig,
    positionStoreFor: efsp.positionStoreFor,
    radars: currentRadars,
  });

  const picture = {
    coverageFor: (controllerId) => {
      const result = positionCoverage.forController(controllerId);
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

  const surveillance = createSurveillance({
    datalink,
    collab: collabStore,
    srs: srsClient,
    sensorSpecs,
    correlationStore: efsp.correlationStore,
    flightDataStore: efsp.flightDataStore,
    env: () => ({ weather: grpcClient.getWeather(), transitionAltFt: theaterContext.transitionAltFt() }),
  });
  const { transponders, identity } = surveillance;

  const wsHub       = new WsHub({ trackStore, collabStore, efsp, picture, surveillance, clock: missionClock, theater: theaterContext });

  // The radar list itself changes under everyone — an AWACS takes off or lands,
  // a ship spawns — and until this existed nothing told a client about it. A GCI
  // controller whose AWACS had just got airborne started receiving contacts
  // through it while their coverage panel still listed nothing and the
  // "NO RADAR COVERAGE" banner stayed up, because coverage was only re-sent on
  // efsp-set-positions and on mission load. Compared by id set so the refresh
  // fires once per takeoff, not once per tick.
  let lastRadarIds = '';

  let airportWeather = new Map(); // airport name -> { windFrom (true, as DCS gives it), windKt, tempC, pressureHpa, updatedAt }

  async function refreshAirportWeather(missionData) {
    if (!missionData || !missionData.airports) return;
    for (const ap of missionData.airports) {
      try {
        const w = await grpcClient.getAptWeather(ap.lat, ap.lon, ap.elev || 0);
        airportWeather.set(ap.name, { ...w, updatedAt: Date.now() });
      } catch (e) {
        weatherLog.warn('apt-weather fetch failed', { airport: ap.name, error: e.message });
      }
    }
  }

  // ── F3 mission session (docs/adr/0086, decisions.md S-R2-2) ───────────────
  // Which mission we are in: H22's wind-derived runway, H32's metrics session and
  // H36's archiver all read it. Registered BEFORE the mission-load handler below,
  // so that handler already sees the session this load belongs to.
  const missionSession = deps.missionSession || new MissionSession({ clock: missionClock });
  let lastMissionData = null;
  // A clock step back opens a session with no mission-load behind it: the wind
  // is re-read then too (a load-driven session is handled in the handler below).
  missionSession.onNewSession((session) => {
    if (session.reason === 'CLOCK_STEP_BACK' && lastMissionData) deriveActiveRunwaysFromWind(lastMissionData);
  });
  // ── end F3 mission session ────────────────────────────────────────────────

  // Each Facility with runways takes the end most into its airfield's wind as the
  // active runway, once per mission SESSION (docs/adr/0061, 0086): the store
  // skips a Facility whose runway was already derived in the current session, so
  // a gRPC reconnect or a crc-sync restart keeps the end LC has since chosen,
  // and the same .miz restarted for a new sortie reads the wind again. DCS wind
  // is TRUE and is compared with each end's true heading from the inventory,
  // never with the magnetic end number.
  function deriveActiveRunwaysFromWind(missionData) {
    const missionSessionSeq = missionSession.currentSeq();
    for (const facilityId of efspFacilityConfig.getFacilityIds()) {
      const icao = (efspFacilityConfig.getFacilityConfig(facilityId).runwayStatus || {}).airportIcao;
      if (!icao || !efsp.runwayStatusStore.hasRunwayStatus(facilityId)) continue;
      const airport = (missionData.airports || []).find(a => a.icao === icao);
      if (!airport) { fieldLog.warn('no such airport in this mission — active runway left as it is', { facilityId, icao }); continue; }
      grpcClient.getAptWeather(airport.lat, airport.lon, airport.elev || 0)
        .then((w) => {
          const r = efsp.runwayStatusStore.setActiveRunwayFromWind(facilityId, { windFromTrue: w.windFrom, windKt: w.windKt, missionSession: missionSessionSeq });
          // Persisted even when the end is unchanged: the store has recorded
          // that this session's wind is applied (docs/adr/0086).
          if (r.ok && !r.skipped) efsp.persist();
          if (r.ok && r.changed) {
            // The same delta a runway-status op sends (decisions.md S-L1d).
            wsHub.broadcastEfspRunwayStatusDelta({
              runwayStatusSeq: efsp.runwayStatusStore.currentSeq,
              runwayStatuses: [efsp.runwayStatusStore.getRunwayStatus(facilityId)],
            });
            efsp.nlaStatusMonitor.tick();
            fieldLog.info('active runway from the mission wind', { facilityId, activeRunway: r.activeRunway, windFromDegTrue: w.windFrom, windKt: w.windKt });
          }
        })
        .catch((e) => fieldLog.warn('wind fetch failed, active runway left as it is', { facilityId, error: e.message }));
    }
  }

  // ── WP4A forwarding obligations (guide §4.6.1, docs/adr/0021, 0067) — the
  // set due right now, sent as state in efsp-alerts (broadcastEfspAlerts below).
  // Re-evaluated on a 15s sweep for the clock (comfortably fine-grained for
  // minute-scale obligations) and right after any EFSP Mutation, so a
  // controller's fix clears its badge at once. ────────────────────────────
  const obligationMonitor = new ForwardingObligationMonitor({
    clock: missionClock,
    boardStoreFor: efsp.boardStoreFor,
    flightDataStore: efsp.flightDataStore,
    facilityConfig: efspFacilityConfig,
    airspaceStore: efsp.airspaceStore,
  });

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
    beaconOf: trackSeams.beacon || ((t) => { const x = transponders.transponderOf(t); return x ? x.code : null; }),
    flightDataStore: efsp.flightDataStore,
    correlationStore: efsp.correlationStore,
    boardStoreFor: efsp.boardStoreFor,
    facilityConfig: efspFacilityConfig,
    onDelta: (payload) => wsHub.broadcastEfspCorrelationDelta(payload),
  });

  // ── WP8 instrumentation (docs/adr/0065) — the §11.5 metric set, the §11.4
  // traffic count and Mutation-log retention, in one self-contained block. It
  // wraps efsp.handleMessage/onDisconnect (ws-hub.js looks them up per message,
  // and no socket connects before server.listen).
  const efspInstrumentation = createEfspInstrumentation({
    efsp,
    facilityConfig: efspFacilityConfig,
    clock: missionClock,
    correlationStats: () => correlationReconciler.getStats(),
    obligationStats: () => obligationMonitor.getComplianceStats(),
    // A metrics session is one mission to the next (H32): F3's mission session.
    missionSession,
  });

  // ── Archiving finished flights (H36, docs/adr/0082) ───────────────────────
  // A DROPPED Strip leaves memory and the Board snapshot 2 h after its drop, or
  // at the next mission session (F3), once the traffic count above has it; its
  // Flight data goes with its last Strip. The Mutation log keeps the history.
  efsp.archiver.setIsCounted((stripId) => efspInstrumentation.trafficCount.hasCountFor(stripId));
  function _archive(r) {
    const payloads = archiveDeltas(r, efsp.boardStoreFor);
    if (!payloads.length) return undefined;
    efsp.persist();
    for (const p of payloads) wsHub.broadcastEfspBoardDelta(p);
    const n = payloads.reduce((sum, p) => sum + p.gone.length, 0);
    archiverLog.info('archived Strips and flight data', { strips: n, flightDataList: r.flightDataIds.length });
    return n;
  }
  missionSession.onNewSession((session) => _archive(efsp.archiver.onMissionSessionChange(session)));
  // ── end archiving ─────────────────────────────────────────────────────────

  // The NLA inhibit status every Strip carries on the wire (F-408) has a
  // clock-driven half that no message covers — a release time passing, an EDCT
  // or call-for-release window opening or closing, a void deadline reached. This
  // sweep re-states only the Strips whose status actually moved; on a quiet
  // Board it sends nothing. See nla-status-monitor.js for why it shares the
  // obligation sweep's tick rather than taking one of its own — in short,
  // VOID_TIME_EXPIRED is raised as an alert there and rendered as an inhibit
  // reason here, and two cadences would let the two disagree.
  efsp.nlaStatusMonitor.setOnDelta((payload) => wsHub.broadcastEfspBoardDelta(payload));
  wsHub.setOnEfspChange(() => { if (obligationMonitor.tick()) broadcastEfspAlerts(); });

  // ── The carrier's ship banner (docs/adr/0074, ADR 0064 B6) — matched to the
  // live ship track once a second, republished only when it changed enough to
  // matter. Own coalition, grid convergence and magnetic variation are injected:
  // the model owns none of them (decisions H15, H42).
  const carrierTick = new CarrierTick({
    carrierStore: efsp.carrierStore,
    tracks: () => trackStore.getAll(),
    ownCoalition: () => USER_COALITION,
    clock: missionClock,
    convergenceAt: (lat, lon) => theaterContext.convergenceAt(lat, lon),
    variationAt: (lat, lon) => theaterContext.variationAt(lat, lon),
    weatherPa: () => { const w = grpcClient.getWeather(); return w && Number.isFinite(w.pressurePa) ? w.pressurePa : null; },
    onChange: () => wsHub.broadcastEfspCarrierDelta(carrierDelta(efsp.carrierStore)),
  });

  // ── Conformance and short-term conflict alerting (docs/adr/0058) ─────────
  // Server-side, because only this process sees every track: a client only
  // receives the ones inside its own coverage. Once a second, the same rhythm as
  // correlation (whose records conformance reads). Only what is WRONG is ever
  // sent; the whole alert state goes out when it changes.
  const alertingConfig = loadAlertingConfig();
  const conformanceMonitor = new ConformanceMonitor({
    clock: missionClock,
    wallClock: WALL_CLOCK,
    trackStore,
    flightDataStore: efsp.flightDataStore,
    correlationStore: efsp.correlationStore,
    weather: () => grpcClient.getWeather(),
    transitionAltFt: () => theaterContext.transitionAltFt(),
    indicatedAltFt,
    // DCS's course is grid; the typed HDG is magnetic (docs/adr/0085).
    gridToMagnetic: trackSeams.gridToMagnetic || ((deg, lat, lon) => theaterContext.gridToMagnetic(deg, lat, lon)),
    config: alertingConfig.conformance,
  });
  // docs/adr/0076 — "detected airborne" and staleness. It reads the Boards and
  // the correlation records and writes nothing: surveillance informs, the
  // controller advances (§10.3).
  const surveillanceHints = deps.surveillanceHints === null ? null : (deps.surveillanceHints || new SurveillanceHintMonitor({
    clock: missionClock,
    wallClock: WALL_CLOCK,
    trackStore,
    correlationStore: efsp.correlationStore,
    boardStoreFor: efsp.boardStoreFor,
    facilityConfig: efspFacilityConfig,
    getMissionData: () => wsHub.getMissionData(),
    config: getHintsConfig(),
    onStaleness: (e) => efspInstrumentation.metrics.recordStaleness(e),
  }));
  if (surveillanceHints) {
    efspInstrumentation.metrics.declareSource('staleness');
    // docs/wip/UI-B.md: the chip's SetState to DEPARTED may pass the runway gate only when the
    // server itself agrees the chip is on (its own AIRBORNE_ADVANCE hint): the client's
    // observedAirborne flag is a claim, this is the evidence.
    for (const facilityId of efspFacilityConfig.getFacilityIds()) {
      const board = efsp.boardStoreFor(facilityId);
      if (board) board.setAirborneObserver((s) => surveillanceHints.getAll().some(h => h.stripId === s.stripId && h.kind === 'AIRBORNE_ADVANCE'));
    }
  }
  const conflictAlertMonitor = new ConflictAlertMonitor({
    trackStore,
    config: alertingConfig.conflictAlert,
    flightDataForTrack: (trackId) => efsp.correlationStore.flightDataForTrack(trackId),
    activeMarsaFor: (flightDataId) => efsp.marsaStore.activeFor(flightDataId),
    // Alert text names each aircraft the way identity does (docs/adr/0059).
    callsignFor: trackSeams.callsign || ((track) => identity.labelFor(track.id)),
  });
  // The one place efsp-alerts is composed (docs/adr/0067). broadcastEfspAlerts
  // replaces the whole alert state, so every producer — the 1s conformance/CA
  // tick, the 15s obligation sweep, the post-Mutation hook — must send all three
  // slices, or it would erase the others'. A function declaration: the 15s
  // interval above calls it, long after these consts exist.
  function broadcastEfspAlerts() {
    wsHub.broadcastEfspAlerts({
      conformance: conformanceMonitor.getAll(),
      conflictAlert: conflictAlertMonitor.getAll(),
      obligations: obligationMonitor.getAll(),
      surveillance: surveillanceHints ? surveillanceHints.getAll() : undefined, // docs/adr/0076: the suggestion chip and staleness
    });
  }

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
      res.json({ ok: true, routes: efspStereoRoutes.getActiveStereoRoutes() });
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

  // Test-only (Playwright harness); mounts nothing unless CRCSYNC_TEST_RESET=1, see src/test-reset.js.
  // Required only here: test-reset.js mints its boot id (crypto.randomUUID) when loaded, and the soak's
  // seeded id stream must not be consumed before createEfsp.
  if (env.CRCSYNC_TEST_RESET === '1') require('./test-reset').mountTestReset(app, { env });

  // ── Static hosting ───────────────────────────────────────────────────────
  app.use(express.static(PUBLIC_DIR));

  // ── Tickers: every timer the service runs, by name. start() installs them,
  // stop() clears them; the soak drives them by name instead of by clock. ──────
  let lastClockSource = missionClock.source;
  const tickers = [
    { name: 'datalink-locks', periodMs: sensorSpecs.datalink.lockPollMs, tick: () => datalink.pollLocks() },
    { name: 'coverage', periodMs: COVERAGE_TICK_MS, tick: () => {
      const radars = currentRadars();
      const ids = radars.map(r => r.id).sort().join(',');
      if (ids !== lastRadarIds) {
        lastRadarIds = ids;
        wsHub.refreshAllCoverage();
      }
      coverageEngine.tick(positionCoverage.activeRadars(), trackStore.getAll(), wsHub.getMissionData());
    } },
    // With DCS gone there are no samples to broadcast on, and the clock has fallen
    // back to the wall clock — clients still need to hear that, and when.
    { name: 'clock-source', periodMs: 5000, tick: () => {
      const source = missionClock.source;
      if (source === 'WALL' || source !== lastClockSource) wsHub.broadcastGameTime();
      if (theaterContext.noteClock()) wsHub.broadcastTheater();
      lastClockSource = source;
    } },
    { name: 'airport-weather', periodMs: 60000, tick: () => refreshAirportWeather(lastMissionData) },
    { name: 'efsp-metrics', periodMs: 60000, tick: () => efspInstrumentation.tick() },
    { name: 'efsp-archiver', periodMs: 60 * 1000, tick: () => _archive(efsp.archiver.sweep()) },
    // ── Stale reaper — mirrors crc-desktop's original 12s track eviction, now
    // also evicts orphaned CollaborativeStore entries in the same tick. Also
    // re-broadcasts AtisStore's active list so a client that crashed without
    // ever POSTing {stop:true} still clears from everyone else's "in use"
    // display once its presence entry lapses (see AtisStore.getActive()). ─────
    { name: 'stale-reaper', periodMs: 5000, tick: () => {
      const n = trackStore.expireStale();
      const activeIds = new Set(trackStore.getAll().map(t => String(t.id)));
      const evicted = collabStore.evictStale(activeIds);
      surveillance.forget(activeIds);
      if (n > 0 || evicted > 0) log.info('expired stale tracks and evicted overlay entries', { tracks: n, overlayEntries: evicted });
      wsHub.setAtisActive(atisStore.getActive());
    } },
    { name: 'obligations-nla', periodMs: 15000, tick: () => {
      if (obligationMonitor.tick()) broadcastEfspAlerts();
      efsp.nlaStatusMonitor.tick();
    } },
    { name: 'correlation', periodMs: CORRELATION_TICK_MS, tick: () => correlationReconciler.tick() },
    { name: 'carrier', periodMs: 1000, tick: () => carrierTick.tick() },
    // Conformance and the hints stamp mission time (the `since` they report is shown to
    // controllers); their pure durations (the heading grace, the airborne hold, staleness)
    // run on the injected wall clock (docs/adr/0096). CA stays on the wall clock: it only
    // compares track ages, which tracks.js stamps in wall time, and shows no time
    // of day at all.
    { name: 'conformance-conflict-alert', periodMs: 1000, tick: () => {
      const conformanceChanged = conformanceMonitor.tick();
      const hintsChanged = surveillanceHints ? surveillanceHints.tick() : false;
      const conflictAlertChanged = conflictAlertMonitor.tick(Date.now());
      if (conformanceChanged || conflictAlertChanged || hintsChanged) {
        broadcastEfspAlerts();
      }
    } },
  ];

  // ── grpcClient/srsClient handlers, attached by start() in this order ──────
  const attached = []; // [emitter, event, fn], so stop() can detach exactly these
  function on(emitter, event, fn) { emitter.on(event, fn); attached.push([emitter, event, fn]); }
  const grpcTap = { on: (event, fn) => on(grpcClient, event, fn) };
  const timers = [];
  let started = false;

  function attachHandlers() {
    on(grpcClient, 'unit', (unitData) => {
      trackStore.update(unitData);
    });
    on(grpcClient, 'gone', (id) => { trackStore.remove(id); transponders.release(id); });

    on(grpcClient, 'mission-start', () => missionSession.noteMissionStart());
    on(grpcClient, 'mission-load', (missionData) => {
      lastMissionData = missionData;
      missionSession.noteMissionLoad(missionData);
    });

    on(grpcClient, 'mission-load', (missionData) => {
      trackStore.clear();
      surveillance.clear();
      // collabStore is NOT cleared here: a mission-load that does not roll the mission
      // session keeps the same unit ids (docs/adr/0094); a roll cleared it above.
      // Every radar id, sweep phase and line-of-sight answer belonged to the
      // theater that just went away.
      coverageEngine.reset();
      // And so did every track id. This is defect D1 in its most brutal form —
      // nothing about any airframe changed and every contact was re-minted — so
      // every Strip's correlation is dropped with a warning naming why, and the
      // next tick re-binds each one on its beacon code. §6.6 rule 3 permits
      // exactly two outcomes on an identity change; this does both, in order,
      // rather than leaving a stale binding pointing at a contact that is gone.
      correlationReconciler.resetPicture('MISSION_RELOAD');
      // Do NOT add efsp.boardStore.clear()/efsp.flightDataStore.clear() here — EFSP
      // Strips are durably persisted and MUST survive a mission reload, unlike
      // tracks/the IFF overlay (see the `createEfsp()` comment above and
      // docs/adr/0002-durable-board-persistence.md).
      // A mission is running even when GetTheatre failed, so that is an unknown
      // theater (offset 0, flagged), not "no theater yet" (the wall clock).
      missionClock.setTheatre(missionData.theatre || 'UNKNOWN');
      wsHub.setMissionData(missionData);
      wsHub.broadcastGameTime();
      theaterContext.setMission(missionData);
      wsHub.broadcastTheater();
      log.info('mission init', { airports: missionData.airports.length, theater: missionData.theatre || 'unknown' });

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
      // through. Not scoped to STAFFED Positions, though — a controller taking
      // Approach mid-session must not then wait for a DEM. Airborne radars are
      // excluded because they move, so there is no fixed circle to fetch, and
      // they warm as they fly.
      terrainStore.prewarmForRadars(
        assignableRadars(efspFacilityConfig, radars)
          .filter(r => r.type === 'airport' || r.type === 'approach'),
      );

      airportWeather = new Map();
      refreshAirportWeather(missionData);

      // ── L1 runway status: active runway from wind (H22) ─────────────────────────
      deriveActiveRunwaysFromWind(missionData);
      // ── end L1 runway status ────────────────────────────────────────────────────
    });

    on(grpcClient, 'status', (state) => wsHub.setGrpcStatus(state));
    on(grpcClient, 'weather', (data) => wsHub.setWeather(data));
    on(grpcClient, 'game-time', (dt) => {
      if (!missionClock.sample(dt)) return;
      wsHub.broadcastGameTime();
      // Variation depends on the mission date: a new day, or the first mission
      // sample after the wall clock, moves it.
      if (theaterContext.noteClock()) wsHub.broadcastTheater();
    });
    // F3: after the sample, so the step-back check reads this poll's time (ADR 0086).
    on(grpcClient, 'game-time', () => missionSession.observeClock());
    wireCollabSession({ grpcClient: grpcTap, missionSession, collabStore }); // after the handlers it orders against (docs/adr/0094)

    on(srsClient, 'status', (state) => wsHub.setSrsStatus(state));
  }

  function start() {
    if (started) return;
    started = true;
    wsHub.attach(server);
    attachHandlers();
    for (const t of tickers) timers.push(setInterval(() => t.tick(), t.periodMs));
  }

  function stop() {
    if (!started) return;
    started = false;
    for (const h of timers.splice(0)) clearInterval(h);
    for (const [emitter, event, fn] of attached.splice(0)) emitter.removeListener(event, fn);
    wsHub.stop();
  }

  return {
    http: app, server, wsHub, efsp, tickers, start, stop,
    monitors: {
      obligation: obligationMonitor,
      correlation: correlationReconciler,
      conformance: conformanceMonitor,
      conflictAlert: conflictAlertMonitor,
      surveillanceHints,
      carrier: carrierTick,
      instrumentation: efspInstrumentation,
    },
    // The stores and models the soak host reads and drives directly.
    trackStore, collabStore, atisStore, surveillance, theaterContext, missionClock, missionSession, grpcClient, srsClient,
    broadcastEfspAlerts,
  };
}

module.exports = { createApp };
