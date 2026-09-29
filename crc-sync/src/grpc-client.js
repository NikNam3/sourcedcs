'use strict';
const EventEmitter = require('events');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const PROTO_ROOT = process.env.DCS_GRPC_PROTO_PATH ||
  path.join(__dirname, '../protos');
const DCS_HOST  = process.env.DCS_GRPC_HOST || 'server.sourcedcs.page:50051';
// StreamUnits options, whole seconds. DCS-gRPC's stream_units() builds a
// tokio interval from poll_rate, which panics on 0: the task dies after the
// initial full sync and the stream ends with status OK, so a 0 here turns the
// unit stream into a full re-sync every ~1.5 s (docs/parallel/research/
// grpc-reconnect-loop.md). 1 is the floor. max_backoff caps how long DCS-gRPC
// waits between polls of a unit that isn't changing.
const POLL_RATE   = Math.max(1, parseInt(process.env.DCS_GRPC_POLL_RATE, 10) || 1);
const MAX_BACKOFF = Math.max(POLL_RATE, parseInt(process.env.DCS_GRPC_MAX_BACKOFF, 10) || 5);

// GroupCategory numeric values to include (AIRPLANE=1, HELICOPTER=2, GROUND=3, SHIP=4)
const ALLOWED_CATS = new Set([1, 2, 3, 4]);

// DCS altimeter constants (reverse-engineered; T_REF_ALT is empirical)
const ISA_T0     = 288.15;
const ISA_P0     = 101325;
const ISA_L      = 0.0065;
const ISA_G      = 9.80665;
const ISA_R      = 287.05287;
const ISA_EXP    = ISA_G / (ISA_R * ISA_L);
const ISA_INV    = (ISA_R * ISA_L) / ISA_G;
const H_TROP     = 11000.0;
const T_REF_ALT  = 288.97;

const WEATHER_POLL_MS   = 60000; // poll atmosphere every 60 s
// A healthy unit stream sends a unit only when it changes, and the track
// reaper (tracks.js) drops anything not updated for 12 s. So while the stream
// is up, every unit's last payload is re-emitted this often: a parked jet or a
// SAM site stays on scope, and a lost stream still ages everything out.
const UNIT_KEEPALIVE_MS = 5000;
const GAMETIME_POLL_MS  =  5000; // poll scenario current time every 5 s

const PROTO_OPTS = { keepCase: true, includeDirs: [PROTO_ROOT] };

// Keep the HTTP/2 connection alive between reconnects
const CHANNEL_OPTS = {
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
   * @param {number} [opts.keepaliveMs]  how often cached units are re-emitted
   */
  constructor(opts = {}) {
    super();
    this._keepaliveMs  = opts.keepaliveMs || UNIT_KEEPALIVE_MS;
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
    this._unitSvc        = null;
    this._evalErrorLoggedAt = 0;
    this._statusTimer        = null; // debounce for 'reconnecting' broadcasts
    this._icao               = null;
    this._missionFetchActive = false; // prevents duplicate retry loops
    this._missionRetryTimer  = null;
    // ISA defaults — overwritten by live weather polls
    this._weather    = { pressurePa: ISA_P0, tempK: ISA_T0 };
    // Reference position for weather queries (sea level, theater center)
    // Updated to first airport lat/lon when mission data arrives.
    this._weatherRef = { lat: 41.0, lon: 41.0 };
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
      const creds      = grpc.credentials.createInsecure();

      this._missionSvc = new missionPkg.dcs.mission.v0.MissionService(DCS_HOST, creds, CHANNEL_OPTS);
      this._coalSvc    = new coalPkg.dcs.coalition.v0.CoalitionService(DCS_HOST, creds, CHANNEL_OPTS);
      this._worldSvc   = new worldPkg.dcs.world.v0.WorldService(DCS_HOST, creds, CHANNEL_OPTS);
      this._customSvc  = new customPkg.dcs.custom.v0.CustomService(DCS_HOST, creds, CHANNEL_OPTS);
      this._atmSvc     = new atmPkg.dcs.atmosphere.v0.AtmosphereService(DCS_HOST, creds, CHANNEL_OPTS);
      this._timerSvc   = new timerPkg.dcs.timer.v0.TimerService(DCS_HOST, creds, CHANNEL_OPTS);
      this._srsSvc     = new srsPkg.dcs.srs.v0.SrsService(DCS_HOST, creds, CHANNEL_OPTS);
      this._unitSvc    = new unitPkg.dcs.unit.v0.UnitService(DCS_HOST, creds, CHANNEL_OPTS);
      this._icao       = require('../data/icao.json');
    } catch (e) {
      console.error('[grpc] proto load failed:', e.message);
      this._setState('disconnected');
      return;
    }

    this._startUnitStream();
    this._startEventStream();
    this._startUnitKeepalive();
    this._startWeatherPoll();
    this._startGameTimePoll();

    this._fetchMissionWithRetry();
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
    this.fetchMissionData()
      .then(data => {
        if (this._closed) return;
        if (data.airports.length === 0) {
          console.warn(`[grpc] mission fetch returned no airports (attempt ${attempt + 1}), retrying in 5s`);
          this._missionRetryTimer = setTimeout(() => this._fetchMissionWithRetry(attempt + 1), 5000);
          return;
        }
        this._missionFetchActive = false;
        if (data.airports[0]) {
          this._weatherRef = { lat: data.airports[0].lat, lon: data.airports[0].lon };
        }
        console.log(`[grpc] mission data ready — ${data.airports.length} airports, ${data.waypoints.length} navpoints, ${data.drawings.length} drawings`);
        this.emit('mission-load', data);
      })
      .catch(err => {
        if (this._closed) return;
        console.error(`[grpc] mission fetch error (attempt ${attempt + 1}): ${err.message}, retrying in 5s`);
        this._missionRetryTimer = setTimeout(() => this._fetchMissionWithRetry(attempt + 1), 5000);
      });
  }

  // Stops every stream, poll and retry timer and closes the channels. The
  // server never calls this (it runs for the process lifetime); the tests do.
  close() {
    this._closed = true;
    for (const t of [this._unitTimer, this._eventTimer, this._missionRetryTimer, this._statusTimer]) clearTimeout(t);
    for (const t of [this._weatherTimer, this._gameTimeTimer, this._keepaliveTimer]) clearInterval(t);
    this._unitTimer = this._eventTimer = this._missionRetryTimer = this._statusTimer = null;
    this._weatherTimer = this._gameTimeTimer = this._keepaliveTimer = null;
    this._lastUnits.clear();
    const streams = [this._unitStream, this._eventStream];
    this._unitStream = this._eventStream = null; // their late events are now stale
    for (const st of streams) { if (st) { try { st.cancel(); } catch (_) {} } }
    for (const svc of [this._missionSvc, this._coalSvc, this._worldSvc, this._customSvc,
                       this._atmSvc, this._timerSvc, this._srsSvc, this._unitSvc]) {
      if (svc) { try { svc.close(); } catch (_) {} }
    }
    this._state = 'disconnected';
  }

  // ── Unit stream ───────────────────────────────────────────────────────────

  _startUnitStream() {
    // Cancel previous stream — its events will be ignored via the closure guard below
    if (this._unitStream) { try { this._unitStream.cancel(); } catch (_) {} }

    const stream = this._missionSvc.StreamUnits({ poll_rate: POLL_RATE, max_backoff: MAX_BACKOFF });
    this._unitStream = stream;

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
      console.error('[grpc] unit stream error:', err.message);
      this._lastUnits.clear(); // let the reaper age them out until the next full sync
      this._setState('reconnecting');
      this._scheduleUnit();
    });

    stream.on('end', () => {
      if (stream !== this._unitStream) return; // stale — ignore
      console.log('[grpc] unit stream ended, reconnecting');
      this._lastUnits.clear(); // let the reaper age them out until the next full sync
      this._setState('reconnecting');
      this._scheduleUnit();
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
    if (!this._atmSvc) return;
    const { lat, lon } = this._weatherRef;
    this._atmSvc.GetTemperatureAndPressure(
      { position: { lat, lon, alt: 0 } },
      (err, res) => {
        if (err || !res) {
          console.warn('[grpc] weather fetch failed:', err && err.message);
          return;
        }
        this._weather = { pressurePa: res.pressure, tempK: res.temperature };
        console.log(`[grpc] weather updated — ${res.pressure.toFixed(0)} Pa / ${res.temperature.toFixed(1)} K`);
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

  _fetchGameTime() {
    if (!this._missionSvc) return;
    this._missionSvc.GetScenarioCurrentTime({}, (err, res) => {
      if (err || !res || !res.datetime) return;
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
          console.warn('[grpc] Eval failed:', failure.message);
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

  _scheduleUnit() {
    if (this._closed || this._unitTimer) return;
    this._unitTimer = setTimeout(() => {
      this._unitTimer = null;
      this._startUnitStream();
    }, 1000);
  }

  // ── Event stream ──────────────────────────────────────────────────────────

  _startEventStream() {
    if (this._eventStream) { try { this._eventStream.cancel(); } catch (_) {} }

    const stream = this._missionSvc.StreamEvents({});
    this._eventStream = stream;

    stream.on('data', (event) => {
      if (stream !== this._eventStream) return; // stale — ignore
      if (event.mission_start) {
        console.log('[grpc] mission_start event');
        this._fetchMissionWithRetry();
      }
    });

    stream.on('error', (err) => {
      if (stream !== this._eventStream) return; // stale — ignore
      console.warn('[grpc] event stream error:', err.message);
      this._scheduleEvent();
    });

    stream.on('end', () => {
      if (stream !== this._eventStream) return; // stale — ignore
      this._scheduleEvent();
    });
  }

  _scheduleEvent() {
    if (this._closed || this._eventTimer) return;
    this._eventTimer = setTimeout(() => {
      this._eventTimer = null;
      this._startEventStream();
    }, 3000);
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
          console.warn(`[grpc] navpoints fetch failed (${coalition}):`, err && err.message);
          return resolve([]);
        }
        console.log(`[grpc] navpoints raw (${coalition}):`, res.json && res.json.slice(0, 200));
        try {
          const parsed = JSON.parse(JSON.parse(res.json));
          resolve(Array.isArray(parsed) ? parsed : []);
        } catch (e) {
          console.warn(`[grpc] navpoints parse failed (${coalition}):`, e.message, 'raw:', res.json && res.json.slice(0, 200));
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
          console.warn('[grpc] drawings fetch failed:', err && err.message);
          return resolve([]);
        }
        try {
          const parsed = JSON.parse(JSON.parse(res.json));
          resolve(Array.isArray(parsed) ? parsed : []);
        } catch (e) {
          console.warn('[grpc] drawings parse failed:', e.message, 'raw:', res.json && res.json.slice(0, 200));
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

  _setState(state) {
    if (this._state === state) return;
    this._state = state;

    if (state === 'reconnecting') {
      // Brief reconnects (stream ended + restarted within 4 s) are invisible to
      // WS clients. Only emit if the reconnect is still in progress after 4 s.
      clearTimeout(this._statusTimer);
      this._statusTimer = setTimeout(() => {
        if (this._state === 'reconnecting') {
          console.log('[grpc] reconnecting (prolonged)');
          this.emit('status', 'reconnecting');
        }
      }, 4000);
    } else {
      clearTimeout(this._statusTimer);
      console.log(`[grpc] ${state}`);
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
    console.log('[srs] Transmit req:', JSON.stringify(req));
    let call;
    const promise = new Promise((resolve, reject) => {
      call = this._srsSvc.Transmit(req, (err, res) => {
        if (err) { console.error('[srs] Transmit error:', err.message); return reject(err); }
        console.log('[srs] Transmit ok:', JSON.stringify(res));
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

module.exports = GrpcClient;
