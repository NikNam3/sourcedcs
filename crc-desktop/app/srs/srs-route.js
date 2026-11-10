'use strict';
// The local /srs WebSocket (ADR 0158 §1, §6): the renderer's audio engine on one end, an SRS session on the other.
//
// Who may connect (S-RADIO-1 RQ10): only a socket from loopback whose Origin is this server's own page
// (http://localhost:<port> or http://127.0.0.1:<port>). The local server listens on every interface, so without this a
// LAN neighbour could key the controller's frequencies.
// One renderer, one SRS client: a new connection replaces the old one. The SRS GUID is made once per app run, so a
// reload is the same client to the SRS server (RQ4).
//
// Messages, renderer to server (text JSON):
//   {type:'hello', name}                       starts the SRS session; `name` is shown in the SRS client list
//   {type:'radios', radios:[{id, mhz, modulation, label}]}
//   {type:'ptt', down, radioIds}
//   {type:'intercom-unit', unitId}             join that client's intercom (null: the shared default)
//   {type:'link-groups', groups:[{id, channels:[{mhz, modulation, receiveOnly}]}]}   what the relay may link (ADR 0159)
//   {type:'relay-leases', channels:['251000:AM', ...]}                              the relay leases crc-sync granted us
// and binary srs-frame.js frames with one Opus frame each, sent while the key is down.
// Server to renderer: text {type:'state', ...} and binary srs-frame.js frames of received audio.

const { WebSocketServer } = require('ws');
const { makeSrsGuid } = require('./srs-guid');
const { encodeFrame, decodeFrame } = require('./srs-frame');
const { createSrsSession } = require('./srs-session');

const PATH = '/srs';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const DEFAULT_NAME = 'CRC';

/** @returns {boolean} */
function isAllowed(req, port) {
  if (!LOOPBACK.has(req.socket.remoteAddress)) return false;
  const origin = req.headers.origin;
  return origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`;
}

/**
 * @param {import('http').Server} server
 * @param {object} o
 * @param {number} o.port this server's port (the Origin check)
 * @param {boolean} o.enabled config.json `radioClient` is 'node' (S-RADIO-1 RQ11); off, the socket only says so
 * @param {string} o.srsHost @param {number} o.srsPort
 * @param {Function} [o.createSession] for tests
 * @param {(msg:string) => void} [o.log]
 */
function attachSrsRoute(server, o) {
  const log = o.log || ((m) => console.log(`[srs] ${m}`));
  const makeSession = o.createSession || createSrsSession;
  const guid = makeSrsGuid();
  const wss = new WebSocketServer({ noServer: true });
  let current = null;

  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname !== PATH) return;
    if (!isAllowed(req, o.port)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws));
  });

  function onConnection(ws) {
    if (current) current.close(4000, 'replaced');
    current = ws;
    let session = null;
    const sendState = (s) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'state', ...s })); };

    if (!o.enabled) {
      sendState({ connected: false, enabled: false, error: 'the built-in radio is off (config.json radioClient is not "node")' });
      return;
    }
    if (!o.srsHost || !o.srsPort) {
      sendState({ connected: false, enabled: true, error: 'no SRS server configured (config.json srsHost, srsPort)' });
      return;
    }

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (!session) return;
        let frame;
        try { frame = decodeFrame(data); } catch { return; }
        session.txFrame(frame.opus);
        return;
      }
      let msg;
      try { msg = JSON.parse(data.toString('utf8')); } catch { return; }
      if (msg.type === 'hello' && !session) {
        session = makeSession({
          host: o.srsHost, port: o.srsPort, guid,
          name: typeof msg.name === 'string' && msg.name.trim() ? msg.name.trim().slice(0, 64) : DEFAULT_NAME,
          onState: (s) => sendState({ enabled: true, ...s }),
          onRx: ({ header, opus }) => { if (ws.readyState === ws.OPEN) ws.send(encodeFrame(header, opus)); },
          log,
        });
        session.start();
      } else if (msg.type === 'radios' && session) {
        session.setRadios(Array.isArray(msg.radios) ? msg.radios : []);
      } else if (msg.type === 'intercom-unit' && session) {
        session.setIntercomUnit(msg.unitId ?? null);
      } else if (msg.type === 'link-groups' && session) {
        session.setLinkGroups(Array.isArray(msg.groups) ? msg.groups : []);
      } else if (msg.type === 'relay-leases' && session) {
        session.setRelayLeases(Array.isArray(msg.channels) ? msg.channels : []);
      } else if (msg.type === 'ptt' && session) {
        session.ptt(msg.down === true, Array.isArray(msg.radioIds) ? msg.radioIds : []);
      }
    });
    ws.on('close', () => {
      if (session) session.stop();
      session = null;
      if (current === ws) current = null;
    });
  }

  return { guid, close: () => { if (current) current.close(); wss.close(); } };
}

module.exports = { attachSrsRoute, isAllowed, PATH };
