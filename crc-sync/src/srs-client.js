'use strict';
const EventEmitter = require('events');
const net = require('net');
const crypto = require('crypto');
const log = require('./log').logger('srs');

const SRS_HOST    = process.env.SRS_HOST || 'server.sourcedcs.page';
const SRS_PORT    = parseInt(process.env.SRS_PORT) || 5002;
const SRS_VERSION = '2.1.0.0';

const MSG_UPDATE            = 0;
const MSG_SYNC              = 2;
const MSG_RADIO_UPDATE      = 3;
const MSG_CLIENT_DISCONNECT = 5;

class SrsClient extends EventEmitter {
  constructor() {
    super();
    this._state        = 'disconnected';
    this._transponders = new Map(); // player name → {squawk, squawkStatus, mode4}
    this._identLatch   = new Map(); // player name → expiry timestamp (ms) for ident latch
    this._socket       = null;
    this._buf          = '';
    this._reconnTimer  = null;
    this._guid         = crypto.randomUUID();
  }

  connect() {
    this._doConnect();
  }

  // Returns {squawk, squawkStatus, mode4} or null
  getTransponder(playerName) {
    if (!playerName) return null;
    const entry = this._transponders.get(playerName);
    if (!entry) return null;

    // The ident latch is normally reconciled in _applyClient when a fresh SRS
    // message arrives, but this getter is polled once per gRPC tick — much
    // more often than SRS pushes radio-state updates, which only fire on an
    // actual change. If the pilot's ident pulse was the last state change
    // SRS ever sent (no follow-up "back to normal" message), nothing would
    // otherwise clear the latch and the ident flash would stick until the
    // pilot recycles the transponder to force a new message. Check the
    // expiry here too so it clears on its own once the 5s grace period
    // elapses, regardless of whether SRS sends anything more.
    if (entry.squawkStatus === 2) {
      const until = this._identLatch.get(playerName);
      if (!until || Date.now() >= until) {
        this._identLatch.delete(playerName);
        entry.squawkStatus = 1;
      }
    }

    return entry;
  }

  getStatus() { return this._state; }

  _doConnect() {
    if (this._socket) { this._socket.destroy(); this._socket = null; }
    this._buf = '';

    const sock = net.createConnection(SRS_PORT, SRS_HOST);
    this._socket = sock;

    sock.on('connect', () => {
      log.info('connected');
      this._setState('connected');
      // Identify ourselves so the server sends client list updates
      sock.write(JSON.stringify({
        MsgType: MSG_SYNC,
        Version: SRS_VERSION,
        Client: {
          ClientGuid: this._guid,
          Name: 'CRC',
          Seat: 0,
          Coalition: 0,
          RadioInfo: null,
          LatLngPosition: { lat: 0, lng: 0, alt: 0 },
        },
      }) + '\n');
    });

    sock.on('data', (chunk) => {
      this._buf += chunk.toString();
      const lines = this._buf.split('\n');
      this._buf = lines.pop(); // retain incomplete trailing line
      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        try { this._handleMsg(JSON.parse(s)); } catch (_) {}
      }
    });

    sock.on('error', (err) => {
      log.warn('error', { error: err.message });
    });

    sock.on('close', () => {
      log.info('disconnected');
      this._transponders.clear();
      this._identLatch.clear();
      this._setState('reconnecting');
      this._scheduleReconnect();
    });
  }

  _handleMsg(msg) {
    switch (msg.MsgType) {
      case MSG_SYNC:
        // Server sends full Clients array on initial sync and on changes
        if (Array.isArray(msg.Clients)) {
          for (const c of msg.Clients) this._applyClient(c);
        }
        if (msg.Client) this._applyClient(msg.Client);
        break;
      case MSG_RADIO_UPDATE:
      case MSG_UPDATE:
        if (msg.Client) this._applyClient(msg.Client);
        break;
      case MSG_CLIENT_DISCONNECT:
        if (msg.Client && msg.Client.Name) {
          this._transponders.delete(msg.Client.Name);
          this._identLatch.delete(msg.Client.Name);
        }
        break;
    }
  }

  _applyClient(client) {
    if (!client || !client.Name) return;
    // SRS uses RadioInfo.IFF (uppercase) in current versions; fall back to lowercase
    const ri  = client.RadioInfo;
    const iff = ri && (ri.IFF || ri.iff);
    if (!iff) {
      // Older SRS versions expose a top-level Transponder block (PascalCase)
      const t = client.Transponder;
      if (!t) return;
      this._transponders.set(client.Name, {
        squawk:       t.Mode3 != null ? t.Mode3 : undefined,
        squawkStatus: undefined,
        mode4:        t.Mode4 != null ? t.Mode4 : undefined,
      });
      return;
    }
    const entry = {};
    // mode3 is the 4-digit squawk code; status 0=off 1=normal 2=ident
    const mode3  = iff.mode3  ?? iff.Mode3;
    const status = iff.status ?? iff.Status;
    const mode4  = iff.mode4  ?? iff.Mode4;
    if (mode3  != null) entry.squawk = mode3;
    if (mode4  != null) entry.mode4  = mode4;

    const squawkStatus = status != null ? Number(status) : undefined;
    if (squawkStatus === 2) {
      // Ident received — latch for 5 s so gRPC ticks can't miss a brief ident pulse
      this._identLatch.set(client.Name, Date.now() + 5000);
      entry.squawkStatus = 2;
    } else if (squawkStatus != null) {
      // Non-ident status: honour the latch if it hasn't expired
      const until = this._identLatch.get(client.Name);
      if (until && Date.now() < until) {
        entry.squawkStatus = 2;
      } else {
        this._identLatch.delete(client.Name);
        entry.squawkStatus = squawkStatus;
      }
    }

    this._transponders.set(client.Name, entry);
  }

  _scheduleReconnect() {
    if (this._reconnTimer) return;
    this._reconnTimer = setTimeout(() => {
      this._reconnTimer = null;
      log.info('reconnecting');
      this._doConnect();
    }, 5000);
  }

  _setState(state) {
    if (this._state === state) return;
    this._state = state;
    this.emit('status', state);
  }
}

module.exports = SrsClient;
