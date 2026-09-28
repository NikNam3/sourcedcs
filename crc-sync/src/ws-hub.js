'use strict';

const { WebSocketServer, WebSocket } = require('ws');
const { resolveTrack, getSquawkConfig, setSquawkMapping, deleteSquawkMapping } = require('./resolve');
const { getTheaterSettings, setTheaterSettings } = require('./theater-settings');
const { getAptConfig, setAptConfig } = require('./apt-config');
const { consumeTicket } = require('./auth');

const VERSION  = 1;
const TICK_MS  = 500; // per-client delta broadcast rate, matches crc-desktop's original ws-server.js

const MAX_NAME_LEN = 40;

class WsHub {
  /**
   * @param {object} trackStore
   * @param {object} collabStore
   * @param {object} [efsp] — EFSP subsystem facade, src/efsp/index.js. Optional so existing callers/tests that only care about tracks/collab keep working.
   * @param {object} [picture] — the radar picture (docs/adr/0042): what each
   *   controller's Positions let them see. Also optional, and for a sharper
   *   reason than back-compat: without it this hub sends every track to every
   *   client, which is exactly what it did before the picture became
   *   server-authoritative. Tests that care about tracks alone keep that
   *   behaviour, and the real server always passes one.
   *   Shape: { coverageFor(controllerId), illuminated(), radars() }.
   */
  constructor(trackStore, collabStore, efsp, picture) {
    this._trackStore  = trackStore;
    this._collabStore = collabStore;
    this._efsp        = efsp;
    this._picture     = picture || null;
    this._wss         = null;
    this._sessions    = new Map(); // ws -> session
    this._missionData = null;
    this._missionId   = null;
    this._weather     = null;
    this._gameTime    = null;
    this._grpcStatus  = 'disconnected';
    this._srsStatus   = 'disconnected';
    this._atisActive  = []; // [{ frequency, ownerId }] — see setAtisActive()
  }

  attach(httpServer) {
    this._wss = new WebSocketServer({
      server: httpServer,
      path: '/feed',
      verifyClient: (info, cb) => {
        const url    = new URL(info.req.url, 'http://x');
        const ticket = url.searchParams.get('ticket');
        const user   = ticket ? consumeTicket(ticket) : null;
        if (!user) return cb(false, 401, 'invalid or expired ticket');
        info.req.crcUser = user;
        cb(true);
      },
    });
    this._wss.on('connection', (ws, req) => this._onConnect(ws, req));
    console.log('[ws-hub] /feed attached');
  }

  getMissionData() { return this._missionData; }

  setMissionData(data) {
    this._missionData = data;
    this._missionId    = Date.now().toString(36) + Math.random().toString(36).slice(2);
    this._broadcast(this._initMsg());
    // A new theater means a new set of airfields, so every airfield-selector
    // resolves to something different. Nobody's coverage survives a mission
    // change untouched.
    this.refreshAllCoverage();
  }

  setWeather(data)    { this._weather = data; this._broadcast(this._weatherMsg()); }
  setGameTime(dt)     { this._gameTime = dt; this._broadcast(this._gameTimeMsg()); }

  /**
   * The radar list changed under everyone — a mission loaded, or an AWACS took
   * off or landed. Every session's coverage is re-resolved and re-sent, since
   * a selector that matched nothing a moment ago may match now.
   *
   * Cheap enough to call freely: resolving one session's coverage is a walk
   * over the radar list, and the message only goes out when it actually
   * changed (see _refreshCoverage).
   */
  refreshAllCoverage() {
    for (const [ws, session] of this._sessions) this._refreshCoverage(ws, session);
  }
  setGrpcStatus(s)    { this._grpcStatus = s; this._broadcastStatus(); }
  setSrsStatus(s)     { this._srsStatus = s; this._broadcastStatus(); }
  broadcastRadarLocks(locks) { this._broadcast({ version: VERSION, type: 'radar-locks', locks }); }

  // WP4A (docs/adr/0021) — §4.6.1's timed forwarding-obligation alerts.
  // Unconditional to every connected client, same as broadcastRadarLocks
  // above — no per-client filtering by held Position/Facility exists
  // anywhere in this hub yet (matches every other EFSP broadcast type).
  // `alert` is one entry from forwarding-obligations.js's
  // ForwardingObligationMonitor onAlert callback: {facilityId, stripId,
  // obligationType, dueAt, severity}.
  broadcastEfspObligationAlert(alert) { this._broadcast({ version: VERSION, type: 'efsp-obligation-alert', ...alert }); }

  /**
   * One changed-Strips-only board delta per NLA-status sweep, from
   * nla-status-monitor.js's onDelta (docs/ui-findings/lane4.md F-408).
   *
   * The ORDINARY efsp-board-delta is request-driven — efsp-ws.js returns it
   * from handleMessage and _onMessage below sends it. This is the one that is
   * not: a Strip's NLA inhibit status can change with no message at all behind
   * it, because a release time or an EDCT window passing is the clock's doing,
   * not a controller's. Same justification broadcastEfspCorrelationDelta gives
   * for being server-originated immediate state: the thing that changed is
   * state, and nothing else was ever going to tell anyone about it.
   *
   * `strips.gone` is deliberately absent rather than empty-by-accident: this
   * sweep never removes a Strip, it only re-states ones that are still there.
   */
  broadcastEfspBoardDelta(payload) {
    this._broadcast({
      version: VERSION, type: 'efsp-board-delta',
      boardSeq: payload.boardSeq,
      facilityId: payload.facilityId,
      strips: { updated: payload.strips || [], gone: [] },
      fdrs: { updated: [] },
      positions: { updated: [] },
    });
  }

  /**
   * WP5 (docs/adr/0045) — one changed-records-only correlation delta per
   * reconcile tick, from correlation-reconciler.js's onDelta.
   *
   * Immediate rather than riding the 500ms per-client tick, for two reasons:
   * that tick is per-session and would need correlation-seq bookkeeping the
   * store does not have, and stacking 500ms on top of the 1s reconcile would
   * take the new-contact case to 1.5s and blow §6.6 rule 4's benchmark. One
   * changed-only delta a second is less traffic than the heartbeat already
   * sends unconditionally.
   *
   * Worth naming plainly: this is server-originated immediate STATE with no
   * ack and no Mutation behind it, which is new here — obligation alerts above
   * are the only precedent and they are alerts, not state. It is justified
   * because the record IS state, and it is the only EFSP state that changes
   * without a Mutation, because surveillance is not a controller.
   */
  broadcastEfspCorrelationDelta(payload) {
    this._broadcast({
      version: VERSION, type: 'efsp-correlation-delta',
      correlations: { updated: payload.correlations || [] },
      stats: payload.stats,
    });
  }

  // Live "who's transmitting ATIS on which frequency" list, from
  // AtisStore.getActive() — called by server.js after every
  // /api/atis-transmit mutation and on a periodic tick, so every connected
  // client sees it (not just the next one to collide with it via a 409).
  setAtisActive(list) { this._atisActive = list; this._broadcast(this._atisMsg()); }

  // Message shapes below are deliberately identical to crc-desktop's
  // original app/src/ws-server.js protocol (type names, field names, and
  // the connect-time send order in _onConnect below) — so the renderer's
  // existing connect()/message-switch in app.js needs no changes beyond
  // the WebSocket URL and auth. Only the transport (ticket-based /feed on a
  // remote host instead of a same-origin local socket) is new.

  _statusMsg()  { return { version: VERSION, type: 'status', grpc: this._grpcStatus, srs: this._srsStatus }; }
  _weatherMsg() { return { version: VERSION, type: 'weather', pressurePa: this._weather.pressurePa, tempK: this._weather.tempK }; }
  _gameTimeMsg(){ return { version: VERSION, type: 'game-time', datetime: this._gameTime }; }
  _squawkMapMsg() { return { version: VERSION, type: 'squawk-map', ...getSquawkConfig() }; }
  _atisMsg()      { return { version: VERSION, type: 'atis', active: this._atisActive }; }
  _theaterSettingsMsg() { return { version: VERSION, type: 'theater-settings', ...getTheaterSettings() }; }
  _aptConfigMsg() { return { version: VERSION, type: 'apt-config', airports: getAptConfig() }; }
  _initMsg() {
    return {
      version:   VERSION,
      type:      'init',
      missionId: this._missionId,
      bullseye:  this._missionData.bullseye,
      airports:  this._missionData.airports,
      waypoints: this._missionData.waypoints,
      drawings:  this._missionData.drawings,
      theatre:   this._missionData.theatre,
    };
  }

  _broadcastStatus() { this._broadcast(this._statusMsg()); }

  _resolveIds(ids, illuminated) {
    const assign = (id) => this._collabStore.getOrAssignTrackNumber(id);
    const out = [];
    for (const id of ids) {
      const track = this._trackStore.get(id);
      if (!track) continue;
      const resolved = resolveTrack(track, this._collabStore.get(id), this._missionData, assign);
      // When the beam last passed over this contact. The client fades from
      // this instead of timing its own sweep, which is what makes two
      // controllers at one board see the same picture decay the same way
      // (docs/adr/0042). Absent when this hub has no picture at all.
      if (illuminated) {
        const hit = illuminated.get(String(id));
        if (hit) { resolved.illuminatedAt = hit.at; resolved.seenBy = hit.radarIds; }
      }
      out.push(resolved);
    }
    return out;
  }

  // ── the radar picture, per session ────────────────────────────────────────

  /**
   * Every track this session's radars have illuminated, as
   * `Map<trackId, {at, radarIds}>`.
   *
   * With no picture configured this is every track in the store with no
   * illumination stamp — the pre-docs/adr/0042 behaviour, kept for callers
   * that only care about tracks.
   */
  _visibleTo(session) {
    if (!this._picture) {
      const all = new Map();
      for (const t of this._trackStore.getAll()) all.set(String(t.id), null);
      return all;
    }
    const visible = new Map();
    for (const [trackId, hit] of this._picture.illuminated()) {
      for (const radarId of hit.radarIds) {
        if (session.radarIds.has(radarId)) { visible.set(trackId, hit); break; }
      }
    }
    return visible;
  }

  _coverageMsg(session) {
    return {
      version: VERSION, type: 'coverage',
      radars: session.coverage.radars,
      heldPositions: session.coverage.heldPositions,
      radarBearingPositions: session.coverage.radarBearingPositions,
    };
  }

  /**
   * Re-resolves one session's coverage and, if it changed, tells the client and
   * re-sends the picture from scratch.
   *
   * The full re-send matters: taking a Position releases radars, and every
   * track only those radars could see has to be withdrawn. Working that out
   * as a delta would mean diffing two coverage sets against the live picture,
   * and a snapshot says the same thing without the chance of getting it wrong.
   */
  _refreshCoverage(ws, session) {
    if (!this._picture) return false;
    const next = this._picture.coverageFor(session.controllerId);
    const before = [...session.radarIds].sort().join(',');
    const after = next.radars.map(r => r.id).sort().join(',');
    session.coverage = next;
    session.radarIds = next.radarIds;
    // Held Positions can change without the radar set changing (taking GND
    // adds no scope), and the client renders the held list too — so the
    // message goes out either way, and only the expensive re-send is gated.
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(this._coverageMsg(session)));
    if (before === after) return false;

    session.lastSent = new Map();
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(this._pictureSnapshot(session)));
    return true;
  }

  /** A full track snapshot, scoped to what this session can see. */
  _pictureSnapshot(session) {
    const visible = this._visibleTo(session);
    const illuminated = this._picture ? visible : null;
    const tracks = this._resolveIds([...visible.keys()], illuminated);
    session.lastSent = new Map([...visible].map(([id, hit]) => [id, hit ? hit.at : 0]));
    return { version: VERSION, type: 'snapshot', time: Date.now() / 1000, tracks };
  }

  // ── Per-client lifecycle ─────────────────────────────────────────────────

  _onConnect(ws, req) {
    const user = req.crcUser;
    const session = {
      user,
      who: user.name || user.preferred_username || user.sub || 'unknown',
      // EFSP's controllerId (guide §4.8.1's actingPositionId/actorId audit
      // requirement) reuses this exact fallback chain rather than a second
      // identity scheme — see src/efsp/index.js's controllerIdFor().
      controllerId: user.name || user.preferred_username || user.sub || 'unknown',
      lastTrackSeq:  this._trackStore.currentSeq,
      lastCollabSeq: this._collabStore.currentSeq,
      timer: null,
      // The radar picture this session is entitled to (docs/adr/0042). Empty
      // until they hold a radar-bearing Position, which is the whole point:
      // a controller who has declared nothing sees nothing, and the client
      // says so rather than showing a blank map.
      coverage: { radars: [], radarIds: new Set(), heldPositions: [], radarBearingPositions: [] },
      radarIds: new Set(),
      // trackId -> the illuminatedAt we last sent, so a tick knows what is new
      // and what has dropped out of coverage entirely.
      lastSent: new Map(),
    };
    if (this._picture) {
      session.coverage = this._picture.coverageFor(session.controllerId);
      session.radarIds = session.coverage.radarIds;
    }
    this._sessions.set(ws, session);

    // Same send order as the original _onConnect: status, init (if a
    // mission is loaded), weather, game-time, then a full track snapshot.
    // The EFSP snapshot is appended at the end of this same connect-time
    // send order, not a separate/independent path.
    ws.send(JSON.stringify(this._statusMsg()));
    if (this._missionData) ws.send(JSON.stringify(this._initMsg()));
    if (this._weather)     ws.send(JSON.stringify(this._weatherMsg()));
    if (this._gameTime)    ws.send(JSON.stringify(this._gameTimeMsg()));
    ws.send(JSON.stringify(this._squawkMapMsg()));
    ws.send(JSON.stringify(this._theaterSettingsMsg()));
    ws.send(JSON.stringify(this._aptConfigMsg()));
    ws.send(JSON.stringify(this._atisMsg()));
    // Before the track snapshot, so a client knows what it is about to be
    // given a picture through — and, when that list is empty, why the picture
    // is empty too.
    if (this._picture) ws.send(JSON.stringify(this._coverageMsg(session)));
    ws.send(JSON.stringify(this._pictureSnapshot(session)));
    if (this._efsp) ws.send(JSON.stringify(this._efsp.snapshotFor()));

    session.timer = setInterval(() => this._tick(ws, session), TICK_MS);

    ws.on('message', (raw) => this._onMessage(ws, session, raw));
    ws.on('error', () => {});
    ws.on('close', () => {
      clearInterval(session.timer);
      this._sessions.delete(ws);
      if (this._efsp) this._efsp.onDisconnect(session);
    });
  }

  _tick(ws, session) {
    if (ws.readyState !== WebSocket.OPEN) return;

    // EFSP heartbeat (guide §5.6 rule 5) — sent EVERY tick, unconditionally,
    // unlike the track/collab delta below which early-returns on a quiet
    // Board. A client needs a genuine periodic signal to detect staleness;
    // "no message arrived" on an idle Board would otherwise be indistinguishable
    // from a dead connection. Reuses this existing 500ms per-client timer
    // rather than adding a second one.
    if (this._efsp) {
      ws.send(JSON.stringify({ version: VERSION, type: 'efsp-heartbeat', boardSeq: this._efsp.boardStore.currentSeq }));
    }

    const collabDelta = this._collabStore.getDeltaSince(session.lastCollabSeq);
    session.lastCollabSeq = collabDelta.seq;

    // Without a picture, the old rule applies unchanged: whatever TrackStore
    // says changed, scoped to nothing.
    if (!this._picture) {
      const trackDelta = this._trackStore.getDeltaSince(session.lastTrackSeq);
      session.lastTrackSeq = trackDelta.seq;
      const goneIds = trackDelta.gone.map(String);
      const changedIds = new Set([...trackDelta.updated.map(t => String(t.id)), ...collabDelta.updatedIds]);
      for (const id of goneIds) changedIds.delete(id);
      if (changedIds.size === 0 && goneIds.length === 0) return;
      ws.send(JSON.stringify({
        version: VERSION, type: 'delta', time: Date.now() / 1000,
        updated: this._resolveIds(changedIds, null), gone: goneIds,
      }));
      return;
    }

    // With one, the question is not "what changed in the store" but "what has
    // my beam passed over since I last looked". A contact whose telemetry
    // updated ten times between sweeps is sent once, when it is illuminated —
    // which is the behaviour the renderer's own sweep loop used to produce
    // locally, now produced once for everybody.
    const visible = this._visibleTo(session);
    const updatedIds = new Set();

    for (const [trackId, hit] of visible) {
      if (session.lastSent.get(trackId) !== hit.at) updatedIds.add(trackId);
    }
    // A declaration, rename or track number is shared state, not a radar
    // return: it should reflect at once rather than waiting for the next
    // sweep. Only for contacts already in the picture, though — an overlay
    // edit must never leak a track this controller cannot see.
    for (const id of collabDelta.updatedIds) {
      if (visible.has(String(id))) updatedIds.add(String(id));
    }

    const goneIds = [];
    for (const trackId of session.lastSent.keys()) {
      if (!visible.has(trackId)) goneIds.push(trackId);
    }

    if (updatedIds.size === 0 && goneIds.length === 0) return;

    for (const trackId of goneIds) session.lastSent.delete(trackId);
    for (const trackId of updatedIds) session.lastSent.set(trackId, visible.get(trackId).at);

    ws.send(JSON.stringify({
      version: VERSION,
      type:    'delta',
      time:    Date.now() / 1000,
      updated: this._resolveIds(updatedIds, visible),
      gone:    goneIds,
    }));
  }

  // ── Client → server mutations ────────────────────────────────────────────
  // No "assignTrackNumber" message: track numbers are auto-assigned the
  // moment a track is first resolved (see resolve.js/collab-store.js),
  // matching the original client-side behavior in geo.js — never a manual
  // client action.

  _onMessage(ws, session, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg) return;

    // EFSP messages (efsp-mutation/efsp-resync/efsp-set-positions) — ack
    // goes to the sender only, broadcast (when present) goes to everyone
    // immediately, not on the 500ms track-delta tick (see efsp-ws.js's
    // module comment / docs/adr/0004-immediate-board-broadcast.md).
    if (this._efsp) {
      const result = this._efsp.handleMessage(session, msg);
      if (result) {
        if (result.ack) ws.send(JSON.stringify(result.ack));
        if (result.broadcast) this._broadcast(result.broadcast);
        // WP4A gap-closure (docs/adr/0022) — a coordination primitive can
        // touch a Strip in the PEER Facility's own Board (a brand-new
        // replica on PROPOSE, an existing one's coordination state on
        // ACCEPT/REJECT/STAND_BY); that needs its own board-delta, scoped
        // to the peer facilityId, same immediate-broadcast treatment as
        // the primary one above — see efsp-ws.js's own comment.
        if (result.peerBroadcast) this._broadcast(result.peerBroadcast);
        // WP6 (docs/adr/0051) — a Strip Mutation can void or retire a MARSA
        // relation as a side effect (§9.2 rule 2's interlock, or a flight
        // ending). A relation is not a Strip and rides no Board's sequence, so
        // it needs its own delta beside the board one, on the same round trip:
        // §9.2 rule 2 requires the void to "alert every participant Strip", and
        // waiting for the next MARSA op to carry it would be docs/adr/0022's
        // bug again — a correct server-side change no client ever hears about.
        if (result.marsaBroadcast) this._broadcast(result.marsaBroadcast);
        // Declaring a different held set is what changes a controller's
        // coverage (docs/adr/0042) — taking APP hands you the RAPCON's
        // scopes, giving it up takes them away again. Done here rather than
        // inside efsp-ws.js because coverage is a property of the connection,
        // not of the Board, and efsp-ws.js has no session concept beyond the
        // controllerId it is handed.
        if (msg.type === 'efsp-set-positions') this._refreshCoverage(ws, session);
        return;
      }
    }

    // Squawk-map edits are global config, not track-scoped — handle them
    // before the trackId-gated switch below and broadcast to everyone
    // immediately (they don't ride the per-session 500ms track-delta tick,
    // since they're not part of TrackStore/CollaborativeStore's delta log).
    if (msg.type === 'squawkMapSet') {
      if (setSquawkMapping(msg.kind, msg.code, msg.name)) this._broadcast(this._squawkMapMsg());
      return;
    }
    if (msg.type === 'squawkMapDelete') {
      if (deleteSquawkMapping(msg.kind, msg.code)) this._broadcast(this._squawkMapMsg());
      return;
    }

    // Theater settings (transition alt / hdg correction / game-time offset)
    // are squadron-wide config too, same as squawk-map above — any client
    // can push a patch and every client (including the sender) gets the
    // authoritative merged result back.
    if (msg.type === 'theaterSettingsSet') {
      if (setTheaterSettings(msg)) this._broadcast(this._theaterSettingsMsg());
      return;
    }

    // Per-airport ATIS config (freq / runway / info letter / manual wx) —
    // same squadron-wide-config deal, keyed by airport (msg.key) instead of
    // a single flat object.
    if (msg.type === 'aptConfigSet') {
      if (setAptConfig(msg.key, msg)) this._broadcast(this._aptConfigMsg());
      return;
    }

    if (typeof msg.trackId === 'undefined') return;
    const id = String(msg.trackId);

    switch (msg.type) {
      case 'declare':
        this._collabStore.declare(id, msg.state, session.who);
        break;
      case 'clearDeclare':
        this._collabStore.clearDeclare(id);
        break;
      case 'rename':
        if (typeof msg.name === 'string') {
          this._collabStore.rename(id, msg.name.slice(0, MAX_NAME_LEN), session.who);
        }
        break;
      case 'clearRename':
        this._collabStore.clearRename(id);
        break;
      default:
        return;
    }
    // Mutation lands on the next 500ms tick for every connected client
    // (including the sender) — no need to special-case an immediate echo.
  }

  _broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const client of this._wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }
}

module.exports = WsHub;
