// The renderer's end of the local /srs WebSocket (ADR 0158 §1, §6). Text messages are JSON, binary ones srs-frame.js
// frames. It reconnects by itself (the local server restarts with the app only, so the waits are short) and tells the
// caller on every open, so the caller can say hello and send the radios again.

import { encodeFrame, decodeFrame } from './srs-frame.js';

export const RECONNECT_MS = [500, 1000, 2000, 5000];

/**
 * @param {object} o
 * @param {string} o.url
 * @param {() => void} o.onOpen
 * @param {(msg:object) => void} o.onMessage
 * @param {(frame:{header:object, opus:Uint8Array}) => void} o.onFrame
 * @param {() => void} [o.onClose]
 * @param {typeof WebSocket} [o.WebSocket]
 * @param {(fn:Function, ms:number) => any} [o.setTimeout]
 */
export function createSrsSocket(o) {
  const WS = o.WebSocket || globalThis.WebSocket;
  const st = o.setTimeout || setTimeout;
  let ws = null, attempt = 0, closed = false;

  function connect() {
    const s = new WS(o.url);
    ws = s;
    s.binaryType = 'arraybuffer';
    s.onopen = () => { attempt = 0; o.onOpen(); };
    s.onmessage = (e) => {
      if (typeof e.data === 'string') { let m; try { m = JSON.parse(e.data); } catch { return; } o.onMessage(m); return; }
      let f; try { f = decodeFrame(e.data); } catch { return; }
      o.onFrame(f);
    };
    s.onclose = () => {
      if (ws !== s) return;
      ws = null;
      if (o.onClose) o.onClose();
      if (!closed) st(connect, RECONNECT_MS[Math.min(attempt++, RECONNECT_MS.length - 1)]);
    };
  }

  const isOpen = () => !!ws && ws.readyState === 1;
  return {
    open() { closed = false; if (!ws) connect(); },
    close() { closed = true; if (ws) { const s = ws; ws = null; s.close(); if (o.onClose) o.onClose(); } },
    /** Drops the connection and makes a new one (a new SRS session on the server, the same GUID). */
    reconnect() { if (ws) ws.close(); else if (!closed) connect(); },
    send(msg) { if (isOpen()) ws.send(JSON.stringify(msg)); },
    sendFrame(opus) { if (isOpen()) ws.send(encodeFrame({}, opus)); },
    isOpen,
  };
}
