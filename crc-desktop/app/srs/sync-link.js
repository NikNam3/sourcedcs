'use strict';
// The SRS TCP sync connection (ADR 0158 §1, §6): connect, SYNC, RADIO_UPDATE when the radios change, PING on a
// keepalive, reconnect with backoff. A port of lxsrs_v2 client.py's connect/_send/_tcp_loop.
//
// What is sent, and when (client.py, the SRS source's TCPClientHandler.cs, and S-RADIO-1 RQ4):
//  - on connect, SYNC with the whole client: GUID, name, coalition, the radios, position (always 0/0/0: a ground
//    controller has none), then a RADIO_UPDATE. The GUID is the caller's, one per app run, so a reconnect is the same
//    client to the server;
//  - RADIO_UPDATE when the radios or the selected slot change (only when the message differs from the last one sent);
//  - PING every PING_INTERVAL_MS. lxsrs_v2 never sent one and the SRS server ignores it; it is kept because the
//    briefing asks for it and it costs one line a quarter of a minute.
// Liveness: nothing heard for DEAD_AFTER_MS (a TCP line, or a UDP echo the caller reports with `heard()`) is a dead
// link; the socket is dropped and the reconnect runs. Backoff 1, 2, 5, 10, 30 s, then 30 s.
// VERSION_MISMATCH: the server disconnects us (ServerSync.cs). It is reported in the state and not retried, since a
// retry with the same version can only be refused again.

const net = require('net');
const { MsgType, SRS_VERSION, clientDict, encodeSyncMessage, decodeSyncMessage } = require('./sync-message');

const PING_INTERVAL_MS = 15_000;
const DEAD_AFTER_MS = 45_000;
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

/**
 * @param {object} o
 * @param {string} o.host @param {number} o.port @param {string} o.guid @param {string} o.name @param {number} [o.coalition]
 * @param {() => object} o.getRadioInfo the current RadioInfo (sync-message radioInfoDict)
 * @param {(s:{connected:boolean, versionMismatch:boolean, error:string|null}) => void} [o.onState]
 * @param {(m:object) => void} [o.onMessage] every decoded message, for whoever wants the client list
 * @param {{createConnection:Function}} [o.net]
 * @param {{setTimeout:Function, clearTimeout:Function, setInterval:Function, clearInterval:Function}} [o.timers]
 * @param {() => number} [o.now] wall clock, ms
 * @param {(msg:string) => void} [o.log]
 */
function createSyncLink(o) {
  const netMod = o.net || net;
  const t = o.timers || { setTimeout, clearTimeout, setInterval, clearInterval };
  const log = o.log || (() => {});
  const now = o.now || Date.now;
  const state = { connected: false, versionMismatch: false, error: null };
  let socket = null, stopped = true, attempt = 0, retry = null, ping = null, lastRadioLine = null, pending = '', lastHeard = 0;

  const emit = () => { if (o.onState) o.onState({ ...state }); };
  const line = (type) => encodeSyncMessage(type, clientDict({
    guid: o.guid, name: o.name, coalition: o.coalition || 0, radioInfo: o.getRadioInfo(),
  }), SRS_VERSION);
  const send = (buf) => { if (socket && state.connected) socket.write(buf); };

  function connect() {
    retry = null;
    pending = '';
    const s = netMod.createConnection({ host: o.host, port: o.port });
    socket = s;
    if (s.setNoDelay) s.setNoDelay(true);
    s.on('connect', () => {
      if (socket !== s) return;
      state.connected = true; state.error = null; attempt = 0; lastHeard = now();
      s.write(line(MsgType.SYNC));
      const radios = line(MsgType.RADIO_UPDATE);
      lastRadioLine = radios.toString();
      s.write(radios);
      ping = t.setInterval(keepalive, PING_INTERVAL_MS);
      log(`srs sync connected to ${o.host}:${o.port}`);
      emit();
    });
    s.on('data', (chunk) => { if (socket === s) onData(chunk); });
    s.on('error', (err) => { if (socket === s) { state.error = `SRS ${o.host}:${o.port}: ${err.code || err.message}`; } });
    s.on('close', () => { if (socket === s) onClose(); });
  }

  function keepalive() {
    if (!socket) return;
    if (now() - lastHeard > DEAD_AFTER_MS) {
      state.error = `SRS ${o.host}:${o.port}: nothing heard for ${DEAD_AFTER_MS / 1000} s`;
      log(state.error);
      socket.destroy();
      return;
    }
    send(line(MsgType.PING));
  }

  function onData(chunk) {
    lastHeard = now();
    pending += chunk.toString('utf8');
    let nl;
    while ((nl = pending.indexOf('\n')) >= 0) {
      const text = pending.slice(0, nl).trim();
      pending = pending.slice(nl + 1);
      if (!text) continue;
      let msg;
      try { msg = decodeSyncMessage(text); } catch { log('srs sync: unreadable line dropped'); continue; }
      if (msg.MsgType === MsgType.VERSION_MISMATCH) {
        state.versionMismatch = true;
        state.error = `SRS server refused protocol version ${SRS_VERSION} (server ${msg.Version || 'unknown'})`;
        log(state.error);
        emit();
      }
      if (o.onMessage) o.onMessage(msg);
    }
  }

  function onClose() {
    const was = state.connected;
    state.connected = false;
    socket = null;
    if (ping) { t.clearInterval(ping); ping = null; }
    if (was) log('srs sync disconnected');
    emit();
    if (stopped || state.versionMismatch) return;
    retry = t.setTimeout(connect, BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
    attempt++;
  }

  return {
    start() { if (!stopped) return; stopped = false; state.versionMismatch = false; connect(); },
    stop() {
      stopped = true;
      if (retry) { t.clearTimeout(retry); retry = null; }
      if (ping) { t.clearInterval(ping); ping = null; }
      if (socket) { const s = socket; socket = null; state.connected = false; s.destroy(); emit(); }
    },
    /** Call when the radios or the selection changed. Sends RADIO_UPDATE if the message is different. */
    radiosChanged() {
      if (!state.connected) return;
      const next = line(MsgType.RADIO_UPDATE);
      if (next.toString() === lastRadioLine) return;
      lastRadioLine = next.toString();
      send(next);
    },
    /** Something arrived from the server on another channel (the UDP echo): the link is alive. */
    heard() { lastHeard = now(); },
    state: () => ({ ...state }),
  };
}

module.exports = { createSyncLink, PING_INTERVAL_MS, DEAD_AFTER_MS, BACKOFF_MS };
