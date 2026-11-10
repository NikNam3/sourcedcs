'use strict';
// The SRS UDP voice socket (ADR 0158 §1, §6): send, receive, keepalive. A port of lxsrs_v2 client.py's _open_udp,
// _udp_keepalive_loop and VoiceProtocol.
//
// The keepalive is the client's 22 GUID bytes, sent on open and every KEEPALIVE_MS (client.py and the SRS source's
// UDPVoiceHandler.cs, both 15 s). The server answers each with the same 22 bytes (UDPVoiceRouter.cs), which is also
// how it learns our address and port: until the first echo the link is not `ready`, and nothing is sent. Any other
// datagram is a voice packet; one that does not decode is dropped and counted.

const dgram = require('dgram');
const { GUID_LENGTH } = require('./srs-guid');
const { decodeVoicePacket } = require('./voice-packet');

const KEEPALIVE_MS = 15_000;

/**
 * @param {object} o
 * @param {string} o.host @param {number} o.port @param {string} o.guid
 * @param {(packet:object) => void} o.onPacket a decoded voice packet (voice-packet.js decodeVoicePacket)
 * @param {(ready:boolean) => void} [o.onReady] ready changed
 * @param {() => void} [o.onEcho] every keepalive echo (liveness for sync-link `heard()`)
 * @param {{createSocket:Function}} [o.dgram]
 * @param {{setInterval:Function, clearInterval:Function}} [o.timers]
 * @param {(msg:string) => void} [o.log]
 */
function createVoiceLink(o) {
  const dg = o.dgram || dgram;
  const t = o.timers || { setInterval, clearInterval };
  const log = o.log || (() => {});
  const guidBytes = Buffer.from(o.guid, 'latin1');
  let socket = null, keepalive = null, ready = false, connected = false, dropped = 0;

  const setReady = (v) => { if (ready !== v) { ready = v; if (o.onReady) o.onReady(v); } };
  const ping = () => { if (socket && connected) socket.send(guidBytes); };

  function open() {
    if (socket) return;
    const s = dg.createSocket('udp4');
    socket = s;
    s.on('message', (data) => {
      if (socket !== s) return;
      if (data.length === GUID_LENGTH) { setReady(true); if (o.onEcho) o.onEcho(); return; }
      let packet;
      try { packet = decodeVoicePacket(data); } catch (err) { dropped++; log(`srs voice: dropped a packet (${err.message})`); return; }
      o.onPacket(packet);
    });
    s.on('error', (err) => { log(`srs voice: ${err.code || err.message}`); });
    s.connect(o.port, o.host, () => {
      if (socket !== s) return;
      connected = true;
      ping();
      keepalive = t.setInterval(ping, KEEPALIVE_MS);
    });
  }

  function close() {
    if (keepalive) { t.clearInterval(keepalive); keepalive = null; }
    connected = false;
    if (socket) { const s = socket; socket = null; try { s.close(); } catch { /* already closed */ } }
    setReady(false);
  }

  return {
    open,
    close,
    /** Re-open with a fresh socket (after the sync link reconnects): the server learns our address again. */
    reopen() { close(); open(); },
    /** @returns {boolean} false when not ready, nothing sent */
    send(buf) { if (!ready || !socket) return false; socket.send(buf); return true; },
    isReady: () => ready,
    droppedPackets: () => dropped,
  };
}

module.exports = { createVoiceLink, KEEPALIVE_MS };
