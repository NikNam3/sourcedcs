'use strict';

// The radio-only page's /feed connection (docs/adr/0161 §2): what app.js's connect() is to the full client, with no
// picture. It carries the link groups (relay-feed.js) and the frequency table, routes frames through the EFSP message
// registry, and handles `update-required` the same way.
//
// Without a ticket it keeps retrying and only reports it: the radio runs as an SRS client either way, never behind a
// login gate. A session signed on at no Position reads everything (crc-sync read-scope.js, H58), so the snapshot's
// `frequencies` reach this page. Its frames are registered in start(), not at load: the full client's own handlers for
// the same types live in panels/, and a type may be registered once.

import { _setSyncSocket, getSyncFeedUrlNoGate, hasSyncToken } from '../sync.js';
import { UPDATE_REQUIRED_CLOSE, hideUpdateRequired, isUpdateRequiredShown, showUpdateRequired } from '../update-required.js';
import { dispatchEfspMessage, registerEfspMessage } from '../panels/efsp/efsp-message-registry.js';
import { markEfspChanged } from '../panels/efsp/efsp-change-bus.js';
import { applyFrequencyDelta, replaceFrequencyRows } from '../panels/efsp/frequency-state.js';

export const RETRY_MS = 2000;

/** What the link to crc-sync is: `open`, `no-login`, `no-feed` (a login, but no connection) or `update-required`. */
export const LINK = Object.freeze({ OPEN: 'open', NO_LOGIN: 'no-login', NO_FEED: 'no-feed', UPDATE_REQUIRED: 'update-required' });

function registerFrames() {
  registerEfspMessage('efsp-snapshot', (msg) => { replaceFrequencyRows(msg.frequencies); markEfspChanged('snapshot'); });
  registerEfspMessage('efsp-frequency-delta', (msg) => { applyFrequencyDelta(msg); markEfspChanged('positions'); });
}

/**
 * Starts the connection, once.
 * @param {object} o  onLink(link); getUrl, hasToken, setSocket and setTimer are for tests
 */
export function startRadioOnlyFeed({
  onLink = () => {}, getUrl = getSyncFeedUrlNoGate, hasToken = hasSyncToken, setSocket = _setSyncSocket, setTimer = setTimeout,
} = {}) {
  let current = null;
  let updateRequired = false; // crc-sync refused this client's protocol (docs/adr/0103): no reconnect until the overlay's Retry
  const noLink = () => onLink(hasToken() ? LINK.NO_FEED : LINK.NO_LOGIN);
  const retryAfterUpdate = () => { updateRequired = false; connect(); };
  const refused = (frame) => {
    updateRequired = true;
    onLink(LINK.UPDATE_REQUIRED);
    showUpdateRequired(frame, { onRetry: retryAfterUpdate });
  };

  async function connect() {
    if (updateRequired) return;
    const url = await getUrl();
    if (!url) { noLink(); setTimer(connect, RETRY_MS); return; }

    const ws = new WebSocket(url);
    current = ws;
    setSocket(ws);
    ws.onopen = () => { hideUpdateRequired(); onLink(LINK.OPEN); };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (_) { return; }
      if (msg.type === 'update-required') { refused(msg); return; }
      dispatchEfspMessage(msg);
    };
    ws.onclose = (event) => {
      if (current === ws) { current = null; setSocket(null); }
      // Normally the frame arrived first; if only the close did, still show the overlay (server protocol unknown).
      if (event && event.code === UPDATE_REQUIRED_CLOSE && !isUpdateRequiredShown()) refused({});
      if (updateRequired) return;
      noLink();
      setTimer(connect, RETRY_MS);
    };
    ws.onerror = () => ws.close();
  }

  registerFrames();
  connect();
}
