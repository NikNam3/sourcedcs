'use strict';
const EventEmitter = require('events');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const log = require('./log').logger('grpc');
const srsLog = require('./log').logger('srs');

const PROTO_ROOT = process.env.DCS_GRPC_PROTO_PATH ||
  path.join(__dirname, '../protos');
const DEFAULT_DCS_HOST = 'server.sourcedcs.page:50051';
// The root `.env` name wins, so compose passes it straight through; the bare name is what a local run and the e2e harness set.
const dcsHostOf = (env) => env.CRCSYNC_DCS_GRPC_HOST || env.DCS_GRPC_HOST || DEFAULT_DCS_HOST;
// StreamUnits options, whole seconds. DCS-gRPC's stream_units() builds a
// tokio interval from poll_rate, which panics on 0: the task dies after the
// initial full sync and the stream ends with status OK, so a 0 here turns the
// unit stream into a full re-sync every ~1.5 s (docs/parallel/research/
// grpc-reconnect-loop.md). 1 is the floor. max_backoff caps how long DCS-gRPC
// waits between polls of a unit that isn't changing.
function streamOptions(env) {
  const pollRate   = Math.max(1, parseInt(env.DCS_GRPC_POLL_RATE, 10) || 1);
  const maxBackoff = Math.max(pollRate, parseInt(env.DCS_GRPC_MAX_BACKOFF, 10) || 5);
  return { poll_rate: pollRate, max_backoff: maxBackoff };
}

// GroupCategory numeric values to include (AIRPLANE=1, HELICOPTER=2, GROUND=3, SHIP=4)
const ALLOWED_CATS = new Set([1, 2, 3, 4]);

// DCS altimeter constants (reverse-engineered; T_REF_ALT is empirical): one home, altimetry.js.
const { ISA_T0, ISA_P0, ISA_L, ISA_G, ISA_R, ISA_EXP, ISA_INV, H_TROP, T_REF_ALT } = require('./altimetry');

const WEATHER_POLL_MS   = 60000; // poll atmosphere every 60 s
// A healthy unit stream sends a unit only when it changes, and the track
// reaper (tracks.js) drops anything not updated for 12 s. So while the stream
// is up, every unit's last payload is re-emitted this often: a parked jet or a
// SAM site stays on scope, and a lost stream still ages everything out.
const UNIT_KEEPALIVE_MS = 5000;
// Reconnect backoff for the unit and event streams: 1 s doubling to 30 s,
// each delay jittered to 50-100 %. A stream that stayed up STREAM_STABLE_MS
// was healthy and resets it; one that ends sooner (a server that completes
// the RPC right away, as DCS-gRPC did on poll_rate 0) keeps backing off.
const BACKOFF_BASE_MS   = 1000;
const BACKOFF_CAP_MS    = 30000;
const STREAM_STABLE_MS  = 5000;
const END_LOG_WINDOW_MS = 60000; // at most one 'unit stream ended' line per window
const GAMETIME_POLL_MS  =  5000; // poll scenario current time every 5 s
// How long a channel may take to become READY before the attempt is abandoned
// and a fresh one started. grpc-js opens its TCP connection with no connect
// timeout, so a host that drops SYNs would otherwise cost the kernel's SYN
// retry window (~127 s on Linux) before anything is retried, however soon DCS
// is back. Abandoned attempts are retried after a jittered backoff capped at
// CONNECT_BACKOFF_CAP_MS (a blackholed host costs nothing to retry, so the cap
// is lower than the streams'). Lines about it: first one, then one a minute.
const CONNECT_TIMEOUT_MS     = 10000;
const CONNECT_BACKOFF_CAP_MS =  5000;
const ABANDON_LOG_WINDOW_MS  = 60000;

const PROTO_OPTS = { keepCase: true, includeDirs: [PROTO_ROOT] };

// Keep the HTTP/2 connection alive between reconnects
const CHANNEL_OPTS = {
  // Private subchannel pool: closing the channel drops its connection attempt
  // for real instead of leaving it in grpc-js's global pool for the next client.
  'grpc.use_local_subchannel_pool': 1,
  'grpc.keepalive_time_ms': 10000,
  'grpc.keepalive_timeout_ms': 5000,
  'grpc.keepalive_permit_without_calls': 1,
  'grpc.http2.max_pings_without_data': 0,
};

function loadSvc(protoFile) {
  const pkg = protoLoader.loadSync(path.join(PROTO_ROOT, protoFile), PROTO_OPTS);
  return grpc.loadPackageDefinition(pkg);
}

class GrpcClient extends EventEmitter {
  /**
   * @param {object} [opts]  timing overrides, for tests
   * @param {number} [opts.keepaliveMs]    how often cached units are re-emitted
   * @param {number} [opts.backoffBaseMs]  first reconnect delay
   * @param {number} [opts.backoffCapMs]   longest reconnect delay
   * @param {number} [opts.stableMs]       stream lifetime that resets the backoff
   * @param {number} [opts.connectTimeoutMs]    longest wait for the channel to become READY
   * @param {number} [opts.connectBackoffCapMs] longest pause between abandoned attempts
   * @param {object} [opts.env]            the environment (default process.env): `CRCSYNC_DCS_GRPC_HOST` ?? `DCS_GRPC_HOST`, `DCS_GRPC_POLL_RATE`, `DCS_GRPC_MAX_BACKOFF`
   * @param {() => number} [opts.random]   the jitter's source, in [0, 1); Math.random unless a test scripts it
   */
  constructor(opts = {}) {
    super();
    this._env          = opts.env || process.env;
    this._keepaliveMs  = opts.keepaliveMs   || UNIT_KEEPALIVE_MS;
    this._backoffBase  = opts.backoffBaseMs || BACKOFF_BASE_MS;
    this._backoffCap   = opts.backoffCapMs  || BACKOFF_CAP_MS;
    this._stableMs     = opts.stableMs      || STREAM_STABLE_MS;
    this._random       = opts.random        || Math.random;
    this._connectTimeout    = opts.connectTimeoutMs    || CONNECT_TIMEOUT_MS;
    this._connectBackoffCap = opts.connectBackoffCapMs || CONNECT_BACKOFF_CAP_MS;
    this._channel           = null; // the one channel all eight clients share
    this._connectTimer      = null; // abandon timer while the channel is not READY
    this._rebuildTimer      = null; // pause between an abandoned attempt and the next
    this._connectRetries    = 0;
    this._abandonsSinceLog  = 0;
    this._abandonLoggedAt   = -Infinity;
    this._unitRetries  = 0;
    this._eventRetries = 0;
    this._unitEndsSinceLog = 0;
    this._unitEndLoggedAt  = -Infinity;
    this._lastUnits    = new Map(); // unit id → last 'unit' payload emitted
    this._keepaliveTimer = null;
    this._closed       = false;
    this._state        = 'disconnected';
    this._missionSvc   = null;
    this._coalSvc      = null;
    this._worldSvc     = null;
    this._customSvc    = null;
    this._atmSvc       = null;
    this._timerSvc     = null;
    this._srsSvc       = null;
    this._unitStream   = null; // current live unit stream reference
    this._eventStream  = null; // current live event stream reference
    this._unitTimer      = null;
    this._eventTimer     = null;
    this._weatherTimer   = null;
    this._gameTimeTimer  = null;
    this._gameTimeEpoch  = 0; // bumped on a mission_start and on (re)connect: an answer to an older request is dropped (ADR 0129)
    this._unitSvc        = null;
    this._evalErrorLoggedAt = 0;
    this._statusTimer        = null; // debounce for 'reconnecting' broadcasts
    this._icao               = null;
    this._missionFetchActive = false; // prevents duplicate retry loops
    this._missionRetryTimer  = null;
    this._protos = null; // the loaded service packages, set by connect()
    this._missionWaitingReady = null; // attempt number of a fetch parked until the channel is READY
    // ISA defaults — overwritten by live weather polls
    this._weather    = { pressurePa: ISA_P0, tempK: ISA_T0 };
    // Reference position for weather queries: the first airport's lat/lon, set when mission data
    // arrives (DATA-3: there is no literal fallback point). Until then the poll does not run and the ISA stands.
    this._weatherRef = null;
  }

  connect() {
    try {
      const missionPkg = loadSvc('dcs/mission/v0/mission.proto');
      const coalPkg    = loadSvc('dcs/coalition/v0/coalition.proto');
      const worldPkg   = loadSvc('dcs/world/v0/world.proto');
      const customPkg  = loadSvc('dcs/custom/v0/custom.proto');
      const atmPkg     = loadSvc('dcs/atmosphere/v0/atmosphere.proto');
      const timerPkg   = loadSvc('dcs/timer/v0/timer.proto');
      const srsPkg     = loadSvc('dcs/srs/v0/srs.proto');
      const unitPkg    = loadSvc('dcs/unit/v0/unit.proto');
      this._protos = { missionPkg, coalPkg, worldPkg, customPkg, atmPkg, timerPkg, srsPkg, unitPkg };
      this._icao       = require('../data/icao.json');
    } catch (e) {
      log.error('proto load failed', { error: e.message });
      this._setState('disconnected');
      return;
    }

    this._buildClients();
    this._startUnitStream();
    this._startEventStream();
    this._startUnitKeepalive();
    this._startWeatherPoll();
    this._startGameTimePoll();

    this._fetchMissionWithRetry();
  }

  // One channel for all eight service clients, with a private subchannel
  // pool, watched until it is READY. Called at start and again for every
  // abandoned attempt.
  _buildClients() {
    const dcsHost = dcsHostOf(this._env);
    const { missionPkg, coalPkg, worldPkg, customPkg, atmPkg, timerPkg, srsPkg, unitPkg } = this._protos;
    const creds   = grpc.credentials.createInsecure();
    const channel = new grpc.Channel(dcsHost, creds, CHANNEL_OPTS);
    const opts    = { channelOverride: channel };
    this._channel    = channel;
    this._missionSvc = new missionPkg.dcs.mission.v0.MissionService(dcsHost, creds, opts);
    this._coalSvc    = new coalPkg.dcs.coalition.v0.CoalitionService(dcsHost, creds, opts);
    this._worldSvc   = new worldPkg.dcs.world.v0.WorldService(dcsHost, creds, opts);
    this._customSvc  = new customPkg.dcs.custom.v0.CustomService(dcsHost, creds, opts);
    this._atmSvc     = new atmPkg.dcs.atmosphere.v0.AtmosphereService(dcsHost, creds, opts);
    this._timerSvc   = new timerPkg.dcs.timer.v0.TimerService(dcsHost, creds, opts);
    this._srsSvc     = new srsPkg.dcs.srs.v0.SrsService(dcsHost, creds, opts);
    this._unitSvc    = new unitPkg.dcs.unit.v0.UnitService(dcsHost, creds, opts);
    this._watchChannel(channel, channel.getConnectivityState(true));
  }

  _channelReady() {
    return !!this._channel && this._channel.getConnectivityState(false) === grpc.connectivityState.READY;
  }

  // Follows the channel's connectivity. READY clears the abandon timer; the
  // first state that is not READY (the start, or a lost connection) arms it.
  // The timer is not re-armed by CONNECTING <-> TRANSIENT_FAILURE flips, so
  // the bound is the time since the channel was last READY.
  _watchChannel(channel, state) {
    if (this._closed || channel !== this._channel) return; // stale
    if (state === grpc.connectivityState.SHUTDOWN) return;
    if (state === grpc.connectivityState.READY) {
      clearTimeout(this._connectTimer);
      this._connectTimer = null;
      this._connectRetries = 0;
      if (this._missionWaitingReady != null) {
        clearTimeout(this._missionRetryTimer);
        this._fetchMissionWithRetry(this._missionWaitingReady);
      }
    } else if (!this._connectTimer) {
      this._connectTimer = setTimeout(() => {
        this._connectTimer = null;
        if (channel === this._channel && channel.getConnectivityState(false) !== grpc.connectivityState.READY) {
          this._abandonAttempt(channel);
        }
      }, this._connectTimeout);
    }
    try {
      channel.watchConnectivityState(state, Infinity, (err) => {
        if (err) return;
        if (this._closed || channel !== this._channel) return;
        this._watchChannel(channel, channel.getConnectivityState(false));
      });
    } catch (_) { /* channel shut down */ }
  }

  // The channel did not become READY in time: drop it (its connection attempt
  // with it), drop the streams on it, and after a backoff build a fresh set of
  // clients and restart the streams on them.
  _abandonAttempt(channel) {
    const delay = this._backoffDelay(this._connectRetries++, this._connectBackoffCap);
    this._logAbandon(delay);
    this._closeClients();
    this._setState('reconnecting');
    this._rebuildTimer = setTimeout(() => {
      this._rebuildTimer = null;
      if (this._closed) return;
      this._buildClients();
      this._startUnitStream();
      this._startEventStream();
    }, delay);
  }

  _logAbandon(delay) {
    this._abandonsSinceLog++;
    const now = Date.now();
    if (now - this._abandonLoggedAt < ABANDON_LOG_WINDOW_MS) return;
    const n = this._abandonsSinceLog;
    log.warn(n > 1 ? 'DCS-gRPC still not answering, connection attempts abandoned in the last 60s' : 'DCS-gRPC did not answer, connection attempt abandoned',
      { host: dcsHostOf(this._env), attempts: n, timeoutMs: this._connectTimeout, retryInMs: delay });
    this._abandonLoggedAt  = now;
    this._abandonsSinceLog = 0;
  }

  // Cancels both streams (their late events are stale from here on), drops
  // the stream retry timers and closes the shared channel. The service
  // fields go null so nothing starts a call on a closed channel.
  _closeClients() {
    clearTimeout(this._connectTimer);
    clearTimeout(this._unitTimer);
    clearTimeout(this._eventTimer);
    this._connectTimer = this._unitTimer = this._eventTimer = null;
    this._lastUnits.clear();
    const streams = [this._unitStream, this._eventStream];
    this._unitStream = this._eventStream = null;
    for (const st of streams) { if (st) { try { st.cancel(); } catch (_) {} } }
    const channel = this._channel;
    this._channel = null;
    this._missionSvc = this._coalSvc = this._worldSvc = this._customSvc =
      this._atmSvc = this._timerSvc = this._srsSvc = this._unitSvc = null;
    if (channel) { try { channel.close(); } catch (_) {} }
  }

  // Start a mission-data retry loop if one isn't already running.
  // Safe to call multiple times (e.g. on each new WS client connect).
  triggerMissionFetch() {
    if (this._missionFetchActive) return;
    this._fetchMissionWithRetry();
  }

  // Retry fetchMissionData every 5 s until airports are non-empty.
  // Always logs errors — airports are vital for CRC operation.
  _fetchMissionWithRetry(attempt = 0) {
    if (this._closed) return;
    this._missionFetchActive = true;
    if (this._protos && !this._channelReady()) { // _protos: connect() ran
      // No point asking while the channel is down (the call would only queue, then fail when the attempt is
      // abandoned, one warning per call); _watchChannel runs this again the moment the channel is READY.
      this._missionWaitingReady = attempt;
      clearTimeout(this._missionRetryTimer);
      this._missionRetryTimer = setTimeout(() => this._fetchMissionWithRetry(attempt), 5000);
      return;
    }
    this._missionWaitingReady = null;
    this.fetchMissionData()
      .then(data => {
        if (this._closed) return;
        if (data.airports.length === 0) {
          log.warn('mission fetch returned no airports, retrying in 5s', { attempt: attempt + 1 });
          this._missionRetryTimer = setTimeout(() => this._fetchMissionWithRetry(attempt + 1), 5000);
          return;
        }
        this._missionFetchActive = false;
        if (data.airports[0]) {
          const first = !this._weatherRef;
          this._weatherRef = { lat: data.airports[0].lat, lon: data.airports[0].lon };
          if (first) this._fetchWeather(); // do not wait out a poll period for the first answer
        }
        log.info('mission data ready', { airports: data.airports.length, navpoints: data.waypoints.length, drawings: data.drawings.length });
        this.emit('mission-load', data);
      })
      .catch(err => {
        if (this._closed) return;
        log.error('mission fetch error, retrying in 5s', { attempt: attempt + 1, error: err.message });
        this._missionRetryTimer = setTimeout(() => this._fetchMissionWithRetry(attempt + 1), 5000);
      });
  }

  // Stops every stream, poll and retry timer and closes the channels. The
  // server never calls this (it runs for the process lifetime); the tests do.
  close() {
    this._closed = true;
    for (const t of [this._unitTimer, this._eventTimer, this._missionRetryTimer, this._statusTimer, this._connectTimer, this._rebuildTimer]) clearTimeout(t);
    for (const t of [this._weatherTimer, this._gameTimeTimer, this._keepaliveTimer]) clearInterval(t);
    this._missionRetryTimer = this._statusTimer = this._rebuildTimer = null;
    this._weatherTimer = this._gameTimeTimer = this._keepaliveTimer = null;
    this._closeClients();
    this._state = 'disconnected';
  }

  // ── Unit stream ───────────────────────────────────────────────────────────

  _startUnitStream() {
    // Cancel previous stream — its events will be ignored via the closure guard below
    if (this._unitStream) { try { this._unitStream.cancel(); } catch (_) {} }

    const stream = this._missionSvc.StreamUnits(streamOptions(this._env));
    this._unitStream = stream;
    const startedAt = Date.now();

    stream.on('data', (res) => {
      if (stream !== this._unitStream) return; // stale — ignore

      if (this._state !== 'connected') this._setState('connected');

      if (res.unit) {
        const u      = res.unit;
        const catNum = this._catNum(u.group && u.group.category);
        if (!ALLOWED_CATS.has(catNum)) return;

        const payload = {
          id:        u.id,
          callsign:  u.callsign || u.name,
          name:      u.name || null,
          coalition: this._coalNum(u.coalition),
          type:      u.type || '',
          lat:       u.position    ? u.position.lat             : 0,
          lon:       u.position    ? u.position.lon             : 0,
          alt:       u.position    ? Math.round(u.position.alt) : 0,
          heading:   u.orientation ? u.orientation.heading      : 0,
          // Where the aircraft is actually going, and how fast it climbs —
          // what conformance and conflict alerting need (docs/adr/0058).
          // DCS world axes: x north, y UP, z east; speeds in m/s. Course is
          // grid-referenced on DCS's flat world, like `heading` above.
          course:        u.velocity ? u.velocity.heading : null,
          groundSpeed:   u.velocity ? u.velocity.speed   : null,
          verticalSpeed: u.velocity && u.velocity.velocity ? u.velocity.velocity.y : null,
          player:    u.player_name || null,
          category:  catNum, // 1=airplane 2=helicopter 4=ship
        };
        this._lastUnits.set(payload.id, payload);
        this.emit('unit', payload);
      }

      if (res.gone) {
        this._lastUnits.delete(res.gone.id);
        this.emit('gone', res.gone.id);
      }
    });

    stream.on('error', (err) => {
      if (stream !== this._unitStream) return; // stale — ignore
      log.error('unit stream error', { error: err.message });
      this._lastUnits.clear(); // let the reaper age them out until the next full sync
      this._setState('reconnecting');
      this._scheduleUnit(startedAt);
    });

    stream.on('end', () => {
      if (stream !== this._unitStream) return; // stale — ignore
      this._lastUnits.clear(); // let the reaper age them out until the next full sync
      this._setState('reconnecting');
      const delay = this._scheduleUnit(startedAt);
      this._logUnitEnd(delay);
    });
  }

  // Re-emit every live unit's last payload while the stream is up
  // (UNIT_KEEPALIVE_MS). TrackStore.update is idempotent for an unchanged
  // payload apart from refreshing its last-seen time, which is the point.
  _startUnitKeepalive() {
    clearInterval(this._keepaliveTimer);
    this._keepaliveTimer = setInterval(() => {
      if (this._state !== 'connected') return;
      for (const payload of this._lastUnits.values()) this.emit('unit', payload);
    }, this._keepaliveMs);
  }

  // ── Weather poll ──────────────────────────────────────────────────────────

  _startWeatherPoll() {
    this._fetchWeather();
    this._weatherTimer = setInterval(() => this._fetchWeather(), WEATHER_POLL_MS);
  }

  _fetchWeather() {
    if (!this._atmSvc || !this._weatherRef) return;
    const { lat, lon } = this._weatherRef;
    this._atmSvc.GetTemperatureAndPressure(
      { position: { lat, lon, alt: 0 } },
      (err, res) => {
        if (err || !res) {
          log.warn('weather fetch failed', { error: err && err.message });
          return;
        }
        this._weather = { pressurePa: res.pressure, tempK: res.temperature };
        log.info('weather updated', { pressurePa: Number(res.pressure.toFixed(0)), temperatureK: Number(res.temperature.toFixed(1)) });
        this.emit('weather', this._weather);
      }
    );
  }

  // ── Game time poll ────────────────────────────────────────────────────────
  // `datetime` is an ISO 8601 string of the mission's in-game LOCAL time (the
  // mission date plus timer.getAbsTime()), whatever its suffix says.
  // mission-clock.js turns it into Zulu with the theater's fixed offset.

  _startGameTimePoll() {
    this._fetchGameTime();
    this._gameTimeTimer = setInterval(() => this._fetchGameTime(), GAMETIME_POLL_MS);
  }

  // An answer to a request asked before the last mission_start or reconnect is dropped: it can carry the old
  // mission's time after the clock has forgotten it (ADR 0129). During a pause the requests queue and all answer
  // on the unpause, with the same epoch, which is right.
  _fetchGameTime() {
    if (!this._missionSvc) return;
    const epoch = this._gameTimeEpoch;
    this._missionSvc.GetScenarioCurrentTime({}, (err, res) => {
      if (err || !res || !res.datetime) return;
      if (epoch !== this._gameTimeEpoch) return;
      this.emit('game-time', res.datetime);
    });
  }

  // ── Mission scripting ─────────────────────────────────────────────────────

  /**
   * Runs Lua in the mission scripting environment and returns what it
   * returned through net.lua2json, parsed. Rejects on a transport or parse
   * error, logging at most once a minute so a poll against a server without
   * the custom service cannot flood the log.
   */
  evalLua(lua) {
    return new Promise((resolve, reject) => {
      if (!this._customSvc) return reject(new Error('not connected'));
      this._customSvc.Eval({ lua }, (err, res) => {
        let parsed;
        let failure = err;
        if (!failure) {
          try { parsed = JSON.parse(JSON.parse(res.json)); } catch (e) { failure = e; }
        }
        if (!failure) return resolve(parsed);
        const now = Date.now();
        if (now - this._evalErrorLoggedAt > 60000) {
          this._evalErrorLoggedAt = now;
          log.warn('Eval failed', { error: failure.message });
        }
        reject(failure);
      });
    });
  }

  /** The latest sea-level pressure (Pa) and temperature (K) DCS reported. */
  getWeather() { return { ...this._weather }; }

  // Convert true MSL altitude (metres) to QNH-indicated altitude (metres).
  _toPressureAltM(trueAltM) {
    const { pressurePa, tempK } = this._weather;
    let P;
    if (trueAltM <= H_TROP) {
      P = pressurePa * Math.pow(1 - ISA_L * trueAltM / tempK, ISA_EXP);
    } else {
      const T_trop = tempK - ISA_L * H_TROP;
      const P_trop = pressurePa * Math.pow(1 - ISA_L * H_TROP / tempK, ISA_EXP);
      P = P_trop * Math.exp(-ISA_G * (trueAltM - H_TROP) / (ISA_R * T_trop));
    }
    return (T_REF_ALT / ISA_L) * (1 - Math.pow(P / pressurePa, ISA_INV));
  }

  // A stream that lived long enough was healthy: start the backoff over.
  // Returns the delay until the next attempt, or null if one is already due.
  _scheduleUnit(startedAt) {
    if (this._closed || this._unitTimer) return null;
    if (Date.now() - startedAt >= this._stableMs) this._unitRetries = 0;
    const delay = this._backoffDelay(this._unitRetries++);
    this._unitTimer = setTimeout(() => {
      this._unitTimer = null;
      this._startUnitStream();
    }, delay);
    return delay;
  }

  // min(cap, base * 2^n), jittered to 50-100 % so many clients don't retry
  // in step, but never below the base: a hard floor on the reconnect rate
  // (one attempt per base, 1 s by default) however the jitter falls.
  _backoffDelay(retries, cap = this._backoffCap) {
    const nominal = Math.min(cap, this._backoffBase * 2 ** Math.min(retries, 30));
    return Math.max(this._backoffBase, Math.round(nominal * (0.5 + this._random() / 2)));
  }

  // A clean end is abnormal for this stream (DCS-gRPC holds it open for the
  // mission's lifetime), and a server that ends it straight away would log a
  // line per retry. Log the first, then at most one summary a minute.
  _logUnitEnd(delay) {
    this._unitEndsSinceLog++;
    const now = Date.now();
    if (now - this._unitEndLoggedAt < END_LOG_WINDOW_MS) return;
    const n = this._unitEndsSinceLog;
    log.info(n > 1 ? 'unit stream ended repeatedly in the last 60s, reconnecting' : 'unit stream ended, reconnecting', delay == null ? { ends: n, retry: 'already scheduled' } : { ends: n, retryInMs: delay });
    this._unitEndLoggedAt  = now;
    this._unitEndsSinceLog = 0;
  }

  // ── Event stream ──────────────────────────────────────────────────────────

  _startEventStream() {
    if (this._eventStream) { try { this._eventStream.cancel(); } catch (_) {} }

    const stream = this._missionSvc.StreamEvents({});
    this._eventStream = stream;
    const startedAt = Date.now();

    stream.on('data', (event) => {
      if (stream !== this._eventStream) return; // stale — ignore
      if (event.mission_start) {
        log.info('mission_start event');
        // Before the fetch: a mission_start is a new mission even when the
        // mission-load that follows looks the same (mission-session.js, ADR 0086).
        // A time answer still in flight belongs to the mission before (ADR 0129).
        this._gameTimeEpoch++;
        this.emit('mission-start');
        this._fetchMissionWithRetry();
        this._fetchGameTime(); // the clock forgot its sample: do not wait out a poll for the new mission's time
      }
    });

    stream.on('error', (err) => {
      if (stream !== this._eventStream) return; // stale — ignore
      log.warn('event stream error', { error: err.message });
      this._scheduleEvent(startedAt);
    });

    stream.on('end', () => {
      if (stream !== this._eventStream) return; // stale — ignore
      this._scheduleEvent(startedAt);
    });
  }

  _scheduleEvent(startedAt) {
    if (this._closed || this._eventTimer) return null;
    if (Date.now() - startedAt >= this._stableMs) this._eventRetries = 0;
    const delay = this._backoffDelay(this._eventRetries++);
    this._eventTimer = setTimeout(() => {
      this._eventTimer = null;
      this._startEventStream();
    }, delay);
    return delay;
  }

  // ── Mission data ──────────────────────────────────────────────────────────

  async fetchMissionData() {
    const [blue, red, airbases, waypoints, drawings, theatre] = await Promise.allSettled([
      this._getBullseye(3), // COALITION_BLUE
      this._getBullseye(2), // COALITION_RED
      this._getAirbases(),
      this._getNavpoints(),
      this._getDrawings(),
      this._getTheatre(),
    ]);

    return {
      bullseye: {
        blue: blue.status === 'fulfilled' ? blue.value : null,
        red:  red.status  === 'fulfilled' ? red.value  : null,
      },
      airports:  airbases.status  === 'fulfilled' ? airbases.value  : [],
      waypoints: waypoints.status === 'fulfilled' ? waypoints.value : [],
      drawings:  drawings.status  === 'fulfilled' ? drawings.value  : [],
      // Theatre (map) name, e.g. "Syria" — matches the identifiers in
      // tools/miztoyaml/projection.py's _TM table. Used client-side purely
      // for the grid-convergence correction on heading readouts (see
      // crc-desktop/app/public/js/geo.js), not for anything gameplay-critical.
      theatre:   theatre.status    === 'fulfilled' ? theatre.value    : null,
    };
  }

  _getTheatre() {
    return new Promise((resolve, reject) => {
      this._worldSvc.GetTheatre({}, (err, res) => {
        if (err || !res || !res.theatre) return reject(err || new Error('no theatre'));
        resolve(res.theatre);
      });
    });
  }

  _getBullseye(coalitionNum) {
    return new Promise((resolve, reject) => {
      this._coalSvc.GetBullseye({ coalition: coalitionNum }, (err, res) => {
        if (err || !res || !res.position) return reject(err || new Error('no position'));
        resolve({ lat: res.position.lat, lon: res.position.lon });
      });
    });
  }

  _getAirbases() {
    return new Promise((resolve, reject) => {
      this._worldSvc.GetAirbases({ coalition: 0 }, (err, res) => {
        if (err) return reject(err);
        const airports = (res.airbases || [])
          .filter(a => this._airbaseCatNum(a.category) === 1) // AIRDROME only
          .map(a => {
            const name = a.display_name || a.name;
            return {
              name,
              icao:      this._icao[name] || this._icao[a.name] || null,
              coalition: this._coalNum(a.coalition),
              lat:       a.position ? a.position.lat  : 0,
              lon:       a.position ? a.position.lon  : 0,
              elev:      a.position ? Math.round(a.position.alt) : 0,
            };
          });
        resolve(airports);
      });
    });
  }

  // Fetch nav points for both coalitions via DCS-gRPC Eval (CustomService).
  // The mission Lua table uses DCS flat-earth coords; coord.LOtoLL converts them.
  // Note: nav_point.y is the east axis (DCS z), not altitude.
  _getNavpoints() {
    const query = (coalition, coalitionNum) => new Promise((resolve) => {
      const lua = `
local pts = {}
local ok, navpnts = pcall(function() return env.mission.coalition.${coalition}.nav_points or {} end)
if ok and navpnts then
  for _,p in ipairs(navpnts) do
    local lat,lon = coord.LOtoLL({x=p.x, y=0, z=p.y})
    local name = p.callsignStr or p.name or ""
    table.insert(pts, {name=name, lat=lat, lon=lon, coalition=${coalitionNum}})
  end
end
return net.lua2json(pts)
      `.trim();

      this._customSvc.Eval({ lua }, (err, res) => {
        if (err || !res) {
          log.warn('navpoints fetch failed', { coalition, error: err && err.message });
          return resolve([]);
        }
        log.debug('navpoints raw', { coalition, raw: res.json && res.json.slice(0, 200) });
        try {
          const parsed = JSON.parse(JSON.parse(res.json));
          resolve(Array.isArray(parsed) ? parsed : []);
        } catch (e) {
          log.warn('navpoints parse failed', { coalition, error: e.message, raw: res.json && res.json.slice(0, 200) });
          resolve([]);
        }
      });
    });

    return Promise.all([query('blue', 3), query('red', 2)])
      .then(([blueWps, redWps]) => [...blueWps, ...redWps]);
  }

  // Fetch DCS mission-editor drawings via CustomService.Eval.
  // Each drawing is returned with pre-converted lat/lon points (coord.LOtoLL).
  // Circles are returned as {lat, lon, radius}; polyline/polygon types as {points:[{lat,lon}]}.
  // Each carries its `name` and its layer's `layerName` (docs/adr/0098 §4: an airspace's DCS_DRAWING geometry names its
  // drawing), which also makes missionFingerprint() see drawing names.
  _getDrawings() {
    return new Promise((resolve) => {
      const lua = `
local result = {}
local ok, layers = pcall(function() return env.mission.drawings.layers end)
if ok and layers then
  for _, layer in pairs(layers) do
    local objs = type(layer) == "table" and layer.objects or nil
    if objs then
      for _, obj in pairs(objs) do
        if type(obj) == "table" then
          local ptype = obj.primitiveType or ""
          local pmode = obj.polygonMode or ""
          local ox = obj.mapX or 0
          local oy = obj.mapY or 0
          local d = {
            primitiveType = ptype,
            polygonMode   = pmode,
            coalition     = obj.coalition,
            color         = obj.colorString,
            lineColor     = obj.lineColorString,
            fillColor     = obj.fillColorString,
            closed        = obj.closed,
            text          = obj.text,
            name          = obj.name,
            layerName     = layer.name,
          }
          -- Origin lat/lon for circle center or anchor
          if ox ~= 0 or oy ~= 0 then
            local lat, lon = coord.LOtoLL({x=ox, y=0, z=oy})
            d.lat = lat
            d.lon = lon
          end
          if pmode == "circle" then
            d.radius = obj.radius
          elseif pmode == "rect" or pmode == "oval" or pmode == "triangle" then
            local hw = (obj.width  or 0) / 2
            local hh = (obj.height or obj.width or 0) / 2
            local a  = -(obj.angle or 0) * math.pi / 180
            local ca, sa = math.cos(a), math.sin(a)
            local pts = {}
            if pmode == "oval" then
              for i = 0, 63 do
                local t  = i * 2 * math.pi / 64
                local lx = hw * math.cos(t)
                local ly = hh * math.sin(t)
                local rx = lx * ca - ly * sa
                local ry = lx * sa + ly * ca
                local lat, lon = coord.LOtoLL({x=ox+ry, y=0, z=oy+rx})
                table.insert(pts, {lat=lat, lon=lon})
              end
            else
              local corners
              if pmode == "rect" then
                corners = {{hw,hh},{-hw,hh},{-hw,-hh},{hw,-hh}}
              else
                corners = {{0,hh},{-hw,-hh},{hw,-hh}}
              end
              for _, c in ipairs(corners) do
                local rx = c[1]*ca - c[2]*sa
                local ry = c[1]*sa + c[2]*ca
                local lat, lon = coord.LOtoLL({x=ox+ry, y=0, z=oy+rx})
                table.insert(pts, {lat=lat, lon=lon})
              end
            end
            if #pts > 0 then d.points = pts d.closed = true end
          elseif obj.points and #obj.points > 0 then
            -- Free polygon or Line: points are relative offsets from mapX/mapY
            local pts = {}
            for _, pt in ipairs(obj.points) do
              local lat, lon = coord.LOtoLL({x=ox + pt.x, y=0, z=oy + pt.y})
              table.insert(pts, {lat=lat, lon=lon})
            end
            d.points = pts
          end
          table.insert(result, d)
        end
      end
    end
  end
end
return net.lua2json(result)
      `.trim();

      this._customSvc.Eval({ lua }, (err, res) => {
        if (err || !res) {
          log.warn('drawings fetch failed', { error: err && err.message });
          return resolve([]);
        }
        try {
          const parsed = JSON.parse(JSON.parse(res.json));
          resolve(Array.isArray(parsed) ? parsed : []);
        } catch (e) {
          log.warn('drawings parse failed', { error: e.message, raw: res.json && res.json.slice(0, 200) });
          resolve([]);
        }
      });
    });
  }

  // ── Enum helpers ──────────────────────────────────────────────────────────

  _catNum(cat) {
    if (typeof cat === 'number') return cat;
    const map = {
      GROUP_CATEGORY_UNSPECIFIED: 0, GROUP_CATEGORY_AIRPLANE: 1,
      GROUP_CATEGORY_HELICOPTER:  2, GROUP_CATEGORY_GROUND:   3,
      GROUP_CATEGORY_SHIP:        4, GROUP_CATEGORY_TRAIN:    5,
    };
    return map[cat] ?? 0;
  }

  _coalNum(coal) {
    if (typeof coal === 'number') return coal;
    const map = {
      COALITION_ALL: 0, COALITION_NEUTRAL: 1, COALITION_RED: 2, COALITION_BLUE: 3,
    };
    return map[coal] ?? 0;
  }

  _airbaseCatNum(cat) {
    if (typeof cat === 'number') return cat;
    const map = {
      AIRBASE_CATEGORY_UNSPECIFIED: 0, AIRBASE_CATEGORY_AIRDROME: 1,
      AIRBASE_CATEGORY_HELIPAD:     2, AIRBASE_CATEGORY_SHIP:     3,
    };
    return map[cat] ?? 0;
  }

  /** 'connected', 'reconnecting' or 'disconnected', undebounced (the 'status' event debounces a brief reconnect). */
  get linkState() { return this._state; }

  _setState(state) {
    if (this._state === state) return;
    this._state = state;
    if (state === 'connected') this._gameTimeEpoch++; // whatever was asked before the reconnect is the old link's
    // Every change, at once: the mission clock holds through a pause only while the link is up (ADR 0129).
    this.emit('link', state);
    if (state === 'connected') this._fetchGameTime(); // the clock forgot its sample on 'link'

    if (state === 'reconnecting') {
      // Brief reconnects (stream ended + restarted within 4 s) are invisible to
      // WS clients. Only emit if the reconnect is still in progress after 4 s.
      clearTimeout(this._statusTimer);
      this._statusTimer = setTimeout(() => {
        if (this._state === 'reconnecting') {
          log.info('reconnecting (prolonged)');
          this.emit('status', 'reconnecting');
        }
      }, 4000);
    } else {
      clearTimeout(this._statusTimer);
      log.info('connection state', { state });
      this.emit('status', state);
    }
  }

  // Transmit ATIS text via SRS TTS.
  // opts: { text, frequencyHz, coalition, lat, lon, alt, clientName }
  // Returns { call, promise } rather than just a promise — the caller (the
  // /api/atis-transmit handler) needs the ClientUnaryCall handle to be able
  // to cancel an in-flight transmit when a client sends a stop signal.
  transmitAtis(opts) {
    if (!this._srsSvc) return { call: null, promise: Promise.reject(new Error('not connected')) };
    const coalMap = { 2: 2, 3: 3 }; // red=2, blue=3
    const req = {
      ssml:            opts.ssml || opts.text,
      plaintext:       opts.ssml || opts.text,
      frequency:       opts.frequency || opts.frequencyHz,
      srs_client_name: opts.clientName || 'ATIS',
      async:           false,
      coalition:       coalMap[opts.coalition] || 0,
    };
    const pos = opts.position || opts;
    if (pos.lat != null && pos.lon != null) {
      req.position = { lat: pos.lat, lon: pos.lon, alt: pos.alt || 0 };
    }
    srsLog.info('Transmit req', { req });
    let call;
    const promise = new Promise((resolve, reject) => {
      call = this._srsSvc.Transmit(req, (err, res) => {
        if (err) { srsLog.error('Transmit error', { error: err.message }); return reject(err); }
        srsLog.info('Transmit ok', { res });
        resolve(res);
      });
    });
    return { call, promise };
  }

  getStatus() { return this._state; }

  getSrsClients() {
    if (!this._srsSvc) return Promise.reject(new Error('not connected'));
    return new Promise((resolve, reject) => {
      this._srsSvc.GetClients({}, (err, res) => {
        if (err) return reject(err);
        const clients = (res.clients || []).map(c => ({
          name: c.unit && (c.unit.player_name || c.unit.callsign || c.unit.name),
          frequencies: (c.frequencies || []).map(f => Number(f)),
        }));
        resolve(clients);
      });
    });
  }

  // Fetch wind + temp/pressure at a specific lat/lon/alt (metres MSL).
  // Returns a promise resolving to { windFrom, windKt, tempC, pressureHpa }.
  getAptWeather(lat, lon, alt) {
    if (!this._atmSvc) return Promise.reject(new Error('not connected'));
    // Wind at field elevation; temp/pressure at alt=0 (sea level) for QNH.
    const windPos = { position: { lat, lon, alt: alt || 0 } };
    const slPos   = { position: { lat, lon, alt: 0 } };
    return new Promise((resolve, reject) => {
      let wind = null, tp = null, done = 0;
      const tryResolve = () => {
        if (++done < 2) return;
        if (!wind || !tp) return reject(new Error('weather fetch failed'));
        const MPS_TO_KT = 1.94384;
        resolve({
          windFrom:    Math.round((wind.heading * 180 / Math.PI + 270) % 360),
          windKt:      Math.round(wind.strength * MPS_TO_KT),
          tempC:       Math.round(tp.temperature - 273.15),
          pressureHpa: Math.round(tp.pressure / 100),
        });
      };
      this._atmSvc.GetWind(windPos, (err, res) => {
        if (!err && res) wind = res;
        tryResolve();
      });
      this._atmSvc.GetTemperatureAndPressure(slPos, (err, res) => {
        if (!err && res) tp = res;
        tryResolve();
      });
    });
  }
}

GrpcClient.dcsHostOf = dcsHostOf;
GrpcClient.streamOptions = streamOptions;
module.exports = GrpcClient;
