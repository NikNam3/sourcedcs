'use strict';

// The composition root (docs/adr/0095 §4). server.js reads the environment, makes the two real network clients, calls
// createApp(), start() and listen. createApp() wires every store, monitor and the hub, and returns the named `tickers`
// that start() runs on timers. The soak host (tools/soak/host-core.js) and the tests call the same function with fakes and
// drive the tickers by name, so nobody re-implements the monitor wiring.
//
// createApp only fixes the ORDER things are built in; each stage is a named builder:
//   app/http-routes.js    the HTTP routes             app/radar-picture.js  radars, coverage, surveillance
//   app/monitors.js       the monitors + efsp-alerts  app/tickers.js        every timer, by name
//   app/feed-handlers.js  the gRPC/SRS event wiring   app/archive.js        archiving finished flights
//   app/airport-weather.js, app/active-runway.js      weather and the wind-derived runways
// The two real cycles (hub <-> producers, Boards <-> hint monitor) are closed by app/late-binding.js, nowhere else.

const express     = require('express');
const http        = require('http');

const GrpcClient      = require('./grpc-client');
const SrsClient       = require('./srs-client');
const TrackStore      = require('./tracks');
const CollaborativeStore = require('./collab-store');
const AtisStore       = require('./atis-store');
const WsHub           = require('./ws-hub');
const { createEfsp }  = require('./efsp');
const { statePaths } = require('./state-paths');
const { createFacilityConfig } = require('./efsp/facility-config');
const { createStereoRoutes } = require('./efsp/stereo-routes');
const { createAptConfig } = require('./apt-config');
const { loadSessionConfig } = require('./session-config');
const { indicatedAltFt } = require('./altimetry');
const { MissionClock, WALL_CLOCK } = require('./mission-clock');
const { MissionSession } = require('./mission-session');
const { loadTheaters } = require('./theaters');
const { TheaterContext } = require('./theater-context');
const { createAirspaceService } = require('./airspace-service');
const { listUpcomingAirspaceBookings } = require('./efsp/booking-lookup');
const { AirspaceCalendar } = require('./efsp/airspace-calendar');
const { serverBoardDelta } = require('./efsp/wire/frames');
const { ownCoalitionFrom } = require('./surveillance/iff');
const { lateBinding } = require('./app/late-binding');
const log = require('./log').logger('app');
const { mountAuthRoutes, mountApiRoutes } = require('./app/http-routes');
const { buildRadarPicture } = require('./app/radar-picture');
const { buildMonitors } = require('./app/monitors');
const { buildTickers } = require('./app/tickers');
const { createServerResources } = require('./server-resources');
const { createFeedHandlers } = require('./app/feed-handlers');
const { createArchiveSweep } = require('./app/archive');
const { createAirportWeather } = require('./app/airport-weather');
const { createActiveRunwayFromWind } = require('./app/active-runway');

/**
 * The NLA double-tap guard's length in ms. Only the e2e harness (CRCSYNC_TEST_RESET=1) may change it, with
 * CRCSYNC_NLA_GUARD_MS: a spec that presses the NLA twice in a row must not depend on how fast the server
 * receives the two frames. Anywhere else the shipped 400 ms stands. undefined = the Board's default.
 */
function nlaGuardFromEnv(env) {
  if (env.CRCSYNC_TEST_RESET !== '1' || env.CRCSYNC_NLA_GUARD_MS === undefined || env.CRCSYNC_NLA_GUARD_MS === '') return undefined;
  const ms = Number(env.CRCSYNC_NLA_GUARD_MS);
  if (!Number.isFinite(ms) || ms < 0) throw new Error(`CRCSYNC_NLA_GUARD_MS must be a number of ms >= 0, got ${env.CRCSYNC_NLA_GUARD_MS}`);
  return ms;
}

/**
 * @param {object} [deps]
 * @param {object} [deps.env] the environment; `LOG_LEVEL`, `CRCSYNC_TEST_RESET`, `NODE_ENV` and `CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH`, `CRCSYNC_MAPTILER_CLIENT_KEY` and `CRCSYNC_MAPTILER_KEY` are read here
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
 * @returns {{ http, server, wsHub, efsp, monitors, tickers, serverResources, start: Function, stop: Function }}
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
  app.use(express.json({ limit: '50kb' }));
  mountAuthRoutes(app, { env });

  // The two cycles (late-binding.js): the hub is built from the EFSP facade and the monitors, whose own frames leave through it;
  // the Boards ask the hint monitor, which reads the Boards.
  const hubLink = lateBinding('wsHub');
  const hintsLink = lateBinding('surveillanceHints');
  // Controllers whose connection closed but whose sign-on grace has not run out: the hub keeps them, the PositionStores read them.
  const pendingSignOffs = new Map();

  // ── Core components ──────────────────────────────────────────────────────
  const trackStore  = new TrackStore();
  const collabStore = new CollaborativeStore({ env, persist: true, identityOf: (id) => trackStore.get(id) });
  const atisStore   = new AtisStore();
  const grpcClient  = deps.grpcClient || new GrpcClient({ env });
  const srsClient   = deps.srsClient || new SrsClient({ env });
  // EFSP (src/efsp/) is durably persisted (docs/adr/0002-durable-board-persistence.md) — deliberately NOT cleared on mission
  // reload, unlike trackStore/collabStore. Strips represent real controller work product and must survive a DCS mission reload,
  // not just a crc-sync restart. DO NOT add efsp.boardStore/flightDataStore clear() calls to the mission-reload handler
  // (app/feed-handlers.js).
  // The mission clock (docs/adr/0079): in-game Zulu, fed by the gRPC game-time poll. Every EFSP time a controller reads —
  // gates, deadlines, Strip clocks, Mutation timestamps — comes from here, never from Date.now().
  const theaters     = loadTheaters(undefined, env);
  const missionClock = deps.clock || new MissionClock({ offsetHoursFor: (theatre) => theaters[theatre]?.utcOffsetHours ?? null });
  // The map the mission is on (docs/adr/0085): transition altitude, and what "magnetic" means at a position on the mission date.
  // The one place a typed magnetic value becomes true, and the source of the `theater` message.
  const theaterContext = new TheaterContext({ theaters, clock: missionClock });
  const boardPaths   = deps.paths || statePaths('efsp-board.json', env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH);
  // F3 mission session (docs/adr/0086, decisions.md S-R2-2): which mission we are in. Built before the EFSP because the airspace
  // registry is scoped to the loaded mission's theater (docs/adr/0098 §2); H22's wind-derived runway, H32's metrics session and
  // H36's archiver read it too. Registered BEFORE the mission-load handler (app/feed-handlers.js), so that handler already sees
  // the session this load belongs to.
  const missionSession = deps.missionSession || new MissionSession({ clock: missionClock, env });
  // Configuration that used to be read when a module was required is read here, once, from `env` (ADR 0095 §4).
  const efspFacilityConfig = createFacilityConfig({ env });
  const stereoRoutes = createStereoRoutes({ env });
  const aptConfig = createAptConfig({ env });
  const ownCoalition = ownCoalitionFrom(env);
  // Where a correlated track is, for the TOFI regime (docs/adr/0102): the registry's limits are indicated feet, so the track
  // altitude is converted here (I4). A track with no position is not located.
  const locateTrack = (trackId) => {
    const track = trackStore.get(trackId);
    if (!track || !Number.isFinite(track.lat) || !Number.isFinite(track.lon)) return null;
    return { lat: track.lat, lon: track.lon, altFt: indicatedAltFt(track.alt, grpcClient.getWeather(), theaterContext.transitionAltFt()) };
  };
  const efsp = createEfsp({
    env, facilityConfig: efspFacilityConfig, stereoRoutes, clock: missionClock, wallClock: WALL_CLOCK, nlaGuardMs: nlaGuardFromEnv(env),
    transitionAltFt: () => theaterContext.transitionAltFt(), currentTheater: () => missionSession.current().theatre || null, locateTrack,
    paths: boardPaths,
    archiveRetentionMs: deps.archiveRetentionMs, // the soak host only (ADR 0107)
    isAbsent: (controllerId) => pendingSignOffs.has(controllerId),
    // F-408's clock-driven half: the changed-Strips-only delta of the NLA-status sweep (docs/ui-findings/lane4.md F-408).
    onNlaDelta: (payload) => hubLink.get().deliverEfsp(serverBoardDelta(payload, efsp.boardStoreFor)),
    // docs/wip/UI-B.md: the chip's SetState to DEPARTED may pass the runway gate only when the server itself agrees the chip is on
    // (its own AIRBORNE_ADVANCE hint): the client's observedAirborne flag is a claim, this is the evidence. The soak has no hints.
    airborneEvidence: (strip) => { const hints = hintsLink.get(); return !!hints && hints.getAll().some(h => h.stripId === strip.stripId && h.kind === 'AIRBORNE_ADVANCE'); },
  });

  // ── The radar picture (docs/adr/0042) and what a controller is told about a contact (docs/adr/0059) ───────────────
  const radarPicture = buildRadarPicture({ env, hubLink, trackStore, efsp, facilityConfig: efspFacilityConfig, ownCoalition, collabStore, srsClient, grpcClient, theaterContext });
  const { picture, surveillance } = radarPicture;

  // ── What the process itself costs (docs/adr/0141): CPU, memory, event-loop delay, each ticker's run time ─────────────
  const serverResources = createServerResources({
    counts: () => ({ sessions: hubLink.get().sessionCount(), tracks: trackStore.getAll().length }),
  });
  // Per-airport weather (GET /api/apt-weather, and the PAR's field wind, docs/adr/0139).
  const airportWeather = createAirportWeather({ grpcClient });

  // ── The monitors, and the one place efsp-alerts is composed ────────────────────────────────────────
  const monitors = buildMonitors({
    env, efsp, facilityConfig: efspFacilityConfig, missionClock, missionSession, trackStore, surveillance, theaterContext, grpcClient, ownCoalition,
    hubLink, trackSeams, surveillanceHints: deps.surveillanceHints, terrainStore: radarPicture.terrainStore, airportWeather,
    serverResources: () => serverResources.snapshot(),
  });
  hintsLink.bind(monitors.surveillanceHints);

  // ── Archiving finished flights (H36, docs/adr/0082) ───────────────────────
  const archive = createArchiveSweep({ efsp, deliver: (frames) => hubLink.get().deliverEfsp(frames) });
  missionSession.onNewSession((session) => archive(efsp.archiver.onMissionSessionChange(session)));
  // H108 (docs/adr/0108): a real mission roll-over clears the Board and the per-mission stores. mission-session.js decides when
  // (onMissionReset: never for a reconnect or a restart onto the same mission), the reset's own deltas go out through the normal
  // path, and the roll-over sweep then files what the reset dropped, with its flight data.
  missionSession.onMissionReset((session) => {
    const { frames, summary } = efsp.resetForMission(session);
    if (frames.length) hubLink.get().deliverEfsp(frames);
    log.info('mission reset: Board and per-mission state cleared', { missionSession: session.seq, sessionReason: session.reason, ...summary });
    archive(efsp.archiver.onMissionSessionChange(session));
  });

  // ── The hub ────────────────────────────────────────────────────────────────
  const sessionConfig = loadSessionConfig();
  const wsHub = new WsHub({
    trackStore, collabStore, efsp, picture, surveillance, clock: missionClock, theater: theaterContext, downloadUrl: env.CRCSYNC_DOWNLOAD_URL || null,
    wallClock: WALL_CLOCK, signOnGraceMs: sessionConfig.signOnGraceMs, aptConfig, pendingSignOffs,
    // After any EFSP delivery: obligations re-evaluated at once rather than on the next 15 s sweep (docs/adr/0067).
    onEfspChange: monitors.recheckObligations,
    timeTick: serverResources.time,
  });
  hubLink.bind(wsHub);

  // ── Weather, and the runway the wind picks ────────────────────────────────────
  const missionState = { lastMissionData: null }; // the last mission loaded (app/feed-handlers.js writes it)
  const deriveActiveRunwaysFromWind = createActiveRunwayFromWind({ missionSession, facilityConfig: efspFacilityConfig, efsp, grpcClient, deliver: (frames) => wsHub.deliverEfsp(frames) });
  // A clock step back opens a session with no mission-load behind it: the wind is re-read then too (a load-driven session is
  // handled by the mission-load handler).
  missionSession.onNewSession((session) => {
    if (session.reason === 'CLOCK_STEP_BACK' && missionState.lastMissionData) deriveActiveRunwaysFromWind(missionState.lastMissionData);
  });

  // ── HTTP: the on-demand RPC proxy endpoints (per-action, not shared streams) ─────────────────────────
  mountApiRoutes(app, { atisStore, grpcClient, wsHub, stereoRoutes, theaterContext, airportWeather, efspInstrumentation: monitors.efspInstrumentation, terrainStore: radarPicture.terrainStore, serverResources });

  // Test-only (Playwright harness); mounts nothing unless CRCSYNC_TEST_RESET=1, see src/test-reset.js.
  // Required only here: test-reset.js mints its boot id (crypto.randomUUID) when loaded, and the soak's
  // seeded id stream must not be consumed before createEfsp.
  if (env.CRCSYNC_TEST_RESET === '1') require('./test-reset').mountTestReset(app, { env, hooks: { setWireProtocol: (n) => wsHub.setWireProtocolForTest(n), setNlaGuardMs: (ms) => efsp.setNlaGuardMs(ms) } });

  // ── The airspace registry's server-to-server API, for sourcedcs-web (docs/adr/0098 §9). No token: every route 503. ──
  app.use('/api/airspace-registry', createAirspaceService({
    efsp, getToken: () => env.AIRSPACE_SERVICE_TOKEN, broadcast: (frames) => wsHub.deliverEfsp(frames),
  }));

  // ── The booking calendar, information only: the web's upcoming airspace bookings, pulled on a ticker and sent to
  // every session (docs/adr/0098 §9). `deps.bookingLookup` is the test/soak seam for the pull. ──
  const airspaceCalendar = new AirspaceCalendar({
    list: deps.bookingLookup || (() => listUpcomingAirspaceBookings({
      baseUrl: env.CRCSYNC_SOURCEDCS_WEB_URL, serviceToken: env.AIRSPACE_SERVICE_TOKEN || '',
    })),
    currentTheater: () => efsp.airspaceStore.currentTheater(),
    bookingUrl: env.CRCSYNC_SOURCEDCS_WEB_PUBLIC_URL ? `${String(env.CRCSYNC_SOURCEDCS_WEB_PUBLIC_URL).replace(/\/+$/, '')}/bookings.html` : null,
    onChange: (msg) => wsHub.broadcastAirspaceCalendar(msg),
  });

  // ── Tickers (app/tickers.js) and the feed's event handlers (app/feed-handlers.js) ─────────────────────
  // Every ticker is timed (server-resources.js), the soak's included: it drives these same ticks by name.
  const tickers = buildTickers({
    wsHub, efsp, trackStore, collabStore, atisStore, surveillance, theaterContext, missionClock, wallClock: WALL_CLOCK, picture: radarPicture, monitors,
    airportWeather, airspaceCalendar, archive, missionState,
  }).map(serverResources.timed);
  const feed = createFeedHandlers({
    grpcClient, srsClient, trackStore, surveillance, missionSession, missionClock, theaterContext, wsHub,
    correlationReconciler: monitors.correlationReconciler, coverageEngine: radarPicture.coverageEngine, terrainStore: radarPicture.terrainStore,
    facilityConfig: efspFacilityConfig, currentRadars: radarPicture.currentRadars, airportWeather, deriveActiveRunwaysFromWind, collabStore, missionState,
  });

  const timers = [];
  let started = false;

  function start() {
    if (started) return;
    started = true;
    wsHub.attach(server);
    feed.attach();
    for (const t of tickers) timers.push(setInterval(() => t.tick(), t.periodMs));
    serverResources.start();
    airspaceCalendar.refresh().catch(() => {}); // the first pull does not wait a minute
  }

  function stop() {
    if (!started) return;
    started = false;
    for (const h of timers.splice(0)) clearInterval(h);
    serverResources.stop();
    feed.detach();
    wsHub.stop();
  }

  return {
    http: app, server, wsHub, efsp, tickers, serverResources, start, stop,
    monitors: {
      obligation: monitors.obligationMonitor,
      correlation: monitors.correlationReconciler,
      conformance: monitors.conformanceMonitor,
      tofiRegime: monitors.tofiRegimeMonitor,
      conflictAlert: monitors.conflictAlertMonitor,
      surveillanceHints: monitors.surveillanceHints,
      carrier: monitors.carrierTick,
      par: monitors.parMonitor,
      instrumentation: monitors.efspInstrumentation,
    },
    // The stores and models the soak host reads and drives directly.
    trackStore, collabStore, atisStore, airspaceCalendar, surveillance, theaterContext, missionClock, missionSession, grpcClient, srsClient,
    broadcastEfspAlerts: monitors.broadcastEfspAlerts,
  };
}

module.exports = { createApp, nlaGuardFromEnv };
