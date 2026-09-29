'use strict';

const { WebSocketServer, WebSocket } = require('ws');
const { presentTrack, labelPart } = require('./surveillance/presentation');
const { createSurveillance } = require('./surveillance');
const { getTheaterSettings, setTheaterSettings } = require('./theater-settings');
const { getAptConfig, setAptConfig } = require('./apt-config');
const { consumeTicket } = require('./auth');
const { WALL_CLOCK } = require('./mission-clock');

const VERSION  = 1;
const TICK_MS  = 500; // delta broadcast rate, one timer for every session

const MAX_NAME_LEN = 40;

const NO_PICTURE = {
  coverageFor: () => ({ radars: [], radarIds: new Set(), heldPositions: [], radarBearingPositions: [], datalink: false }),
  illuminated: () => new Map(),
  radars: () => [],
};

class WsHub {
  /**
   * @param {object} deps
   * @param {object} deps.trackStore
   * @param {object} deps.collabStore
   * @param {object} [deps.efsp]         EFSP facade, src/efsp/index.js
   * @param {object} [deps.picture]      the radar picture (docs/adr/0042):
   *   { coverageFor(controllerId), illuminated(), radars() }. Without one,
   *   nobody sees anything — there is no "send everything" mode any more.
   * @param {object} [deps.surveillance] src/surveillance/index.js — who each
   *   contact is and what its transponder sends (docs/adr/0059).
   * @param {object} [deps.clock]        the mission clock (docs/adr/0079) —
   *   what the topbar's Zulu clock shows, and the client's only source of it.
   */
  constructor({ trackStore, collabStore, efsp = null, picture = null, surveillance = null, clock = WALL_CLOCK }) {
    this._trackStore  = trackStore;
    this._collabStore = collabStore;
    this._efsp        = efsp;
    this._picture     = picture || NO_PICTURE;
    this._surv        = surveillance || createSurveillance({ collab: collabStore });
    this._wss         = null;
    this._timer       = null;
    this._sessions    = new Map(); // ws -> session
    this._missionData = null;
    this._missionId   = null;
    this._weather     = null;
    this._clock       = clock;
    this._grpcStatus  = 'disconnected';
    this._srsStatus   = 'disconnected';
    this._atisActive  = []; // [{ frequency, ownerId }] — see setAtisActive()
    // trackId -> { fp, rev }: bumped when anything about who the contact is
    // changes (its flight, tag or IFF declaration), so every session relabels
    // it on the next tick without waiting for a sweep. See _refreshLabels().
    this._labels = new Map();
    // trackId -> describe() output, rebuilt each tick.
    this._described = new Map();
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
    this._timer = setInterval(() => this._tickAll(), TICK_MS);
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
  /** Re-anchors every client's Zulu clock — after each mission-clock sample, and on a slow timer so a WALL-sourced clock still reaches them. */
  broadcastGameTime() { this._broadcast(this._gameTimeMsg()); }

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

  // WP4A (docs/adr/0021) — §4.6.1's timed forwarding-obligation alerts.
  // Unconditional to every connected client — no per-client filtering by
  // held Position/Facility (matches every other EFSP broadcast type).
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
  /**
   * docs/adr/0058 — the WHOLE current alert state, conformance and short-term
   * conflict, each time it changes. Full state rather than a delta: it is
   * small (only flights with something wrong are in it), it clears itself by
   * simply no longer listing a flight, and a connecting client needs exactly
   * this message anyway.
   *
   * Scoped per session (docs/adr/0059). Conformance is about a flight and
   * goes to everybody, like the correlation it rides on. A short-term
   * conflict goes only to a controller at an ATC Position, and only when both
   * aircraft are in their own picture: it names positions, and it is ATC's
   * job, not the tactical side's.
   */
  broadcastEfspAlerts(alerts) {
    this._efspAlerts = alerts;
    for (const [ws, session] of this._sessions) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(this._efspAlertsMsg(session)));
    }
  }

  _efspAlertsMsg(session) {
    const a = this._efspAlerts || {};
    const seen = (session && session.lastSent) || new Map();
    const stca = session && session.coverage && session.coverage.stca
      ? (a.stca || []).filter(c => seen.has(String(c.a)) && seen.has(String(c.b)))
      : [];
    return { version: VERSION, type: 'efsp-alerts', conformance: a.conformance || [], stca };
  }

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
  // Already Zulu: the theater offset is applied here, server-side, from the
  // shipped table — the client only advances it between messages.
  _gameTimeMsg(){
    return { version: VERSION, type: 'game-time', zuluMs: this._clock.now(), source: this._clock.source };
  }
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

  // ── the picture, per session ───────────────────────────────────────────────

  /**
   * Re-describes every contact once per tick (docs/adr/0059): who it is, its
   * IFF declaration, what its transponder would answer. When who it is
   * changes — correlated to a flight, a flight's callsign edited, tagged,
   * declared — its label revision moves, and every session that can see it
   * is sent the new label on this tick without waiting for a sweep. One pass
   * here instead of a hook on each of the five places that can change it.
   *
   * The AUTOMATIC IFF colour is not in the fingerprint: it depends on each
   * session's own interrogators (docs/adr/0066), so it is worked out per
   * session in presentTrack() and reaches the client with the next fresh
   * return — which is when a real interrogation happens.
   */
  _refreshLabels() {
    this._surv.identity.indexTick();
    const described = new Map();
    for (const track of this._trackStore.getAll()) {
      const id = String(track.id);
      const d = this._surv.describe(track);
      described.set(id, d);
      const w = d.who;
      const fp = [d.iffOverride, w.fdrId, w.correlation, w.fdrCallsign, w.fdrType, w.tag].join('|');
      const prev = this._labels.get(id);
      if (!prev) this._labels.set(id, { fp, rev: 1 });
      else if (prev.fp !== fp) this._labels.set(id, { fp, rev: prev.rev + 1 });
    }
    for (const id of [...this._labels.keys()]) if (!described.has(id)) this._labels.delete(id);
    this._described = described;
  }

  /**
   * Every contact this session's sensors have: `Map<trackId, {at, radars, dl}>`.
   *
   * Only this session's own radars count, for both whether it sees the track
   * and when — another controller's radar sweeping it must neither show it
   * here nor refresh it. `radars` carries each of this session's radars that
   * saw it, with its capabilities and its own last return, which is what
   * decides whether the controller gets a code and an altitude. A datalink
   * participant is visible to a datalink session with no radar at all.
   */
  _visibleTo(session) {
    const byId = session.radarById || new Map();
    const visible = new Map();
    for (const [trackId, byRadar] of this._picture.illuminated()) {
      let hit = null;
      for (const [radarId, at] of byRadar) {
        const radar = byId.get(radarId);
        if (!radar) continue;
        if (!hit) hit = { at, radars: [], dl: null };
        hit.radars.push({ id: radarId, caps: radar.caps, sweepMs: radar.sweepMs, at });
        if (at > hit.at) hit.at = at;
      }
      if (hit) visible.set(trackId, hit);
    }
    const datalink = this._surv.datalink;
    if (datalink && session.coverage && session.coverage.datalink) {
      for (const [trackId, report] of datalink.reports()) {
        const hit = visible.get(trackId);
        if (hit) {
          hit.dl = report;
          if (report.at > hit.at) hit.at = report.at;
        } else {
          visible.set(trackId, { at: report.at, radars: [], dl: report });
        }
      }
    }
    return visible;
  }

  /** One wire track, or null when this controller must not be told about it. */
  _present(trackId, hit, visible) {
    const track = this._trackStore.get(trackId);
    if (!track) return null;
    const d = this._described.get(String(trackId)) || this._surv.describe(track);
    let dl = hit.dl;
    // A lock line only ever points at a contact this controller already has:
    // the datalink must not leak a position their own picture does not.
    if (dl && dl.lock && !visible.has(String(dl.lock))) dl = { ...dl, lock: null };
    return presentTrack(track, {
      at: hit.at, radars: hit.radars, dl,
      who: d.who, mode4: d.mode4, iffOverride: d.iffOverride, transponder: d.transponder,
      env: this._surv.env(), missionData: this._missionData,
    });
  }

  /** A full track snapshot, scoped to what this session can see. */
  _pictureSnapshot(session) {
    const visible = this._visibleTo(session);
    const tracks = [];
    session.lastSent = new Map();
    session.labelRevs = new Map();
    for (const [id, hit] of visible) {
      const wire = this._present(id, hit, visible);
      if (!wire) continue;
      tracks.push(wire);
      session.lastSent.set(id, hit.at);
      session.labelRevs.set(id, (this._labels.get(id) || {}).rev);
    }
    return { version: VERSION, type: 'snapshot', time: Date.now() / 1000, tracks };
  }

  _coverageMsg(session) {
    return {
      version: VERSION, type: 'coverage',
      radars: session.coverage.radars,
      heldPositions: session.coverage.heldPositions,
      radarBearingPositions: session.coverage.radarBearingPositions,
      datalink: !!session.coverage.datalink,
      stca: !!session.coverage.stca,
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
    const next = this._picture.coverageFor(session.controllerId);
    const key = (c) => [...c.radars.map(r => r.id)].sort().join(',') + (c.datalink ? '+DL' : '');
    const before = key(session.coverage);
    const after = key(next);
    this._setCoverage(session, next);
    // Held Positions can change without the radar set changing (taking GND
    // adds no scope), and the client renders the held list too — so the
    // message goes out either way, and only the expensive re-send is gated.
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(this._coverageMsg(session)));
    if (before === after) return false;

    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(this._pictureSnapshot(session)));
    return true;
  }

  _setCoverage(session, coverage) {
    session.coverage = coverage;
    session.radarIds = coverage.radarIds;
    session.radarById = new Map(coverage.radars.map(r => [r.id, r]));
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
      // trackId -> the illuminatedAt / label revision we last sent, so a tick
      // knows what is new, what was relabelled, and what has dropped out.
      lastSent: new Map(),
      labelRevs: new Map(),
    };
    // The picture this session is entitled to (docs/adr/0042). Empty until
    // they hold a radar-bearing Position, which is the whole point: a
    // controller who has declared nothing sees nothing, and the client says
    // so rather than showing a blank map.
    this._setCoverage(session, this._picture.coverageFor(session.controllerId));
    this._sessions.set(ws, session);

    // Same send order as the original _onConnect: status, init (if a
    // mission is loaded), weather, game-time, then a full track snapshot.
    // The EFSP snapshot is appended at the end of this same connect-time
    // send order, not a separate/independent path.
    ws.send(JSON.stringify(this._statusMsg()));
    if (this._missionData) ws.send(JSON.stringify(this._initMsg()));
    if (this._weather)     ws.send(JSON.stringify(this._weatherMsg()));
    ws.send(JSON.stringify(this._gameTimeMsg()));
    ws.send(JSON.stringify(this._theaterSettingsMsg()));
    ws.send(JSON.stringify(this._aptConfigMsg()));
    ws.send(JSON.stringify(this._atisMsg()));
    // Before the track snapshot, so a client knows what it is about to be
    // given a picture through — and, when that list is empty, why the picture
    // is empty too.
    ws.send(JSON.stringify(this._coverageMsg(session)));
    this._refreshLabels();
    ws.send(JSON.stringify(this._pictureSnapshot(session)));
    if (this._efsp) ws.send(JSON.stringify(this._efsp.snapshotFor()));
    // The current conformance and conflict alerts (docs/adr/0058), so a client
    // that connects mid-conflict sees it without waiting for the next change.
    if (this._efspAlerts) ws.send(JSON.stringify(this._efspAlertsMsg(session)));

    ws.on('message', (raw) => this._onMessage(ws, session, raw));
    ws.on('error', () => {});
    ws.on('close', () => {
      this._sessions.delete(ws);
      if (this._efsp) this._efsp.onDisconnect(session);
    });
  }

  /** One hub tick: describe every contact once, then serve each session. */
  _tickAll() {
    if (this._surv.datalink) this._surv.datalink.tick();
    this._refreshLabels();
    for (const [ws, session] of this._sessions) this._tick(ws, session, true);
  }

  /**
   * One session's tick. `labelsFresh` is false when called on its own (tests),
   * so the contacts are re-described first.
   */
  _tick(ws, session, labelsFresh = false) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (!labelsFresh) this._refreshLabels();

    // EFSP heartbeat (guide §5.6 rule 5) — sent EVERY tick, unconditionally,
    // unlike the track delta below which early-returns on a quiet picture. A
    // client needs a genuine periodic signal to detect staleness; "no message
    // arrived" on an idle Board would otherwise be indistinguishable from a
    // dead connection.
    if (this._efsp) {
      ws.send(JSON.stringify({ version: VERSION, type: 'efsp-heartbeat', boardSeq: this._efsp.boardStore.currentSeq }));
    }

    const lastSent = session.lastSent || (session.lastSent = new Map());
    const labelRevs = session.labelRevs || (session.labelRevs = new Map());

    // Not "what changed in the store" but "what have my sensors returned
    // since I last looked": a contact whose telemetry updated ten times
    // between sweeps is sent once, when it is illuminated.
    const visible = this._visibleTo(session);
    const updated = [];
    const relabeled = [];
    const gone = [];

    for (const [trackId, hit] of visible) {
      const rev = (this._labels.get(trackId) || {}).rev;
      const fresh = lastSent.get(trackId) !== hit.at;
      // Who the contact is — its flight, its tag, its IFF declaration — is shared state,
      // not a radar return: it shows at once rather than waiting for the next
      // sweep. Only for contacts already in the picture, so it can never leak
      // a track this controller cannot see.
      const relabel = !fresh && lastSent.has(trackId) && labelRevs.get(trackId) !== rev;
      if (!fresh && !relabel) continue;
      const wire = this._present(trackId, hit, visible);
      if (!wire) {
        if (lastSent.has(trackId)) gone.push(trackId);
        lastSent.delete(trackId);
        labelRevs.delete(trackId);
        continue;
      }
      if (fresh) { updated.push(wire); lastSent.set(trackId, hit.at); }
      else relabeled.push(labelPart(wire));
      labelRevs.set(trackId, rev);
    }
    for (const trackId of [...lastSent.keys()]) {
      if (visible.has(trackId)) continue;
      gone.push(trackId);
      lastSent.delete(trackId);
      labelRevs.delete(trackId);
    }

    if (updated.length === 0 && relabeled.length === 0 && gone.length === 0) return;
    ws.send(JSON.stringify({
      version: VERSION, type: 'delta', time: Date.now() / 1000, updated, relabeled, gone,
    }));
  }

  // ── Client → server mutations ────────────────────────────────────────────
  // No "assignTrackNumber" message: every contact has a track number from
  // the moment it is described (surveillance/track-numbers.js).

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

    // Theater settings (transition alt / hdg correction)
    // are squadron-wide config — any client
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
      // A tag: the name a controller gives a contact nothing else identifies.
      // A correlated flight's callsign beats it (docs/adr/0059).
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
    if (!this._wss) return;
    const payload = JSON.stringify(msg);
    for (const client of this._wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }
}

module.exports = WsHub;
