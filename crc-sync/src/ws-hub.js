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
  constructor(trackStore, collabStore, efsp) {
    this._trackStore  = trackStore;
    this._collabStore = collabStore;
    this._efsp        = efsp; // EFSP subsystem facade, src/efsp/index.js — optional so existing callers/tests that only care about tracks/collab keep working
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
  }

  setWeather(data)    { this._weather = data; this._broadcast(this._weatherMsg()); }
  setGameTime(dt)     { this._gameTime = dt; this._broadcast(this._gameTimeMsg()); }
  setGrpcStatus(s)    { this._grpcStatus = s; this._broadcastStatus(); }
  setSrsStatus(s)     { this._srsStatus = s; this._broadcastStatus(); }
  broadcastRadarLocks(locks) { this._broadcast({ version: VERSION, type: 'radar-locks', locks }); }

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

  _resolveAll() {
    const assign = (id) => this._collabStore.getOrAssignTrackNumber(id);
    return this._trackStore.getAll().map(t =>
      resolveTrack(t, this._collabStore.get(t.id), this._missionData, assign));
  }

  _resolveIds(ids) {
    const assign = (id) => this._collabStore.getOrAssignTrackNumber(id);
    const out = [];
    for (const id of ids) {
      const track = this._trackStore.get(id);
      if (track) out.push(resolveTrack(track, this._collabStore.get(id), this._missionData, assign));
    }
    return out;
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
    };
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
    ws.send(JSON.stringify({
      version: VERSION,
      type:    'snapshot',
      time:    Date.now() / 1000,
      tracks:  this._resolveAll(),
    }));
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

    const trackDelta  = this._trackStore.getDeltaSince(session.lastTrackSeq);
    const collabDelta = this._collabStore.getDeltaSince(session.lastCollabSeq);
    session.lastTrackSeq  = trackDelta.seq;
    session.lastCollabSeq = collabDelta.seq;

    const goneIds = trackDelta.gone.map(String);
    const changedIds = new Set([
      ...trackDelta.updated.map(t => String(t.id)),
      ...collabDelta.updatedIds,
    ]);
    for (const id of goneIds) changedIds.delete(id);

    if (changedIds.size === 0 && goneIds.length === 0) return;

    ws.send(JSON.stringify({
      version: VERSION,
      type:    'delta',
      time:    Date.now() / 1000,
      updated: this._resolveIds(changedIds),
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
