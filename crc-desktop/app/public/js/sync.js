'use strict';
import { WIRE_PROTOCOL } from './wire-protocol.js';
import { applyConnOverrides, showConnWidget } from './sync-connection.js';

// crc-sync client — Casdoor login (via a popup, main.js's
// setWindowOpenHandler allow-lists the Casdoor authorize URL), plus the
// outbound side of the /feed WebSocket connection app.js's connect() opens
// (radio/radio-only-feed.js opens it on the radio-only page, docs/adr/0161).
// The connection settings are sync-connection.js's.
//
// iff.js/geo.js call sendToSync(msg) for declare/rename mutations; app.js's
// connect() calls getSyncFeedUrl() to get a ready-to-open wss:// URL (or
// null, meaning: not logged in yet, login gate is now showing, keep
// retrying on the existing reconnect timer).

const SYNC_TOKEN_KEY = 'crc-desktop-sync-token';

export function getSyncToken() {
  try { return localStorage.getItem(SYNC_TOKEN_KEY); } catch (_) { return null; }
}

// Header object for any fetch() to this app's own local server that proxies
// through to a crc-sync route guarded by requireAuth (e.g. /api/apt-weather,
// /api/atis-transmit, /api/srs-clients) -- app/server.js's proxyToSync()
// only forwards an Authorization header if the browser's own request to it
// already had one; callers that skip this get "Authentication required"
// back from crc-sync even though the user is fully logged in.
export function _syncAuthHeaders() {
  const token = getSyncToken();
  return token ? { Authorization: 'Bearer ' + token } : {};
}

/** Is there a login to try? The radio-only page says which of "not logged in" and "no connection" it is. */
export function hasSyncToken() { return !!getSyncToken(); }

function clearSyncToken() {
  try { localStorage.removeItem(SYNC_TOKEN_KEY); } catch (_) {}
}

// No prompt=none: with it Casdoor never shows its login page, so a user without a live Casdoor session in this app
// (every fresh install) is sent straight back with error=login_required and can never sign in. Without it, a user
// who is still signed in passes through as before, and anyone else gets the login page (tests/casdoor-login.test.mjs).
export function casdoorAuthorizeUrl({ endpoint, clientId, redirectUri, state }) {
  return `${endpoint}/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid+profile&state=${encodeURIComponent(state)}`;
}

export function openSyncLogin() {
  if (!CASDOOR_ENDPOINT) {
    console.error('[sync] CASDOOR_ENDPOINT not configured — open Connection Settings and fill it in');
    showConnWidget();
    return;
  }
  const stArr = new Uint8Array(16);
  try { window.crypto.getRandomValues(stArr); } catch (_) {}
  const st = Array.from(stArr).map(b => b.toString(16).padStart(2, '0')).join('');
  // localStorage, not sessionStorage: sessionStorage reaches the popup only as a copy made at window.open, and a
  // Windows install lost it ("Session state missing"). Every localhost:<port> window shares localStorage, and
  // auth-callback.html removes the value on first read, so it stays single-use.
  try { localStorage.setItem('crc-desktop-oauth-state', st); } catch (_) {}
  const url = casdoorAuthorizeUrl({
    endpoint: CASDOOR_ENDPOINT, clientId: CASDOOR_CLIENT_ID,
    redirectUri: window.location.origin + '/auth-callback.html', state: st,
  });
  window.open(url, 'crc-login', 'width=480,height=640');
}

// ── Login gate ───────────────────────────────────────────────────────────
// crc-sync is a required dependency (no offline/solo mode) — until a token
// is present, show a blocking overlay instead of a picture that will just
// never populate.

function showLoginGate() {
  if (document.getElementById('crc-login-gate')) return;
  const el = document.createElement('div');
  el.id = 'crc-login-gate';
  el.style.cssText = 'position:fixed;inset:0;background:#0a0e0a;color:#8aab8a;' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;' +
    'z-index:99999;font-family:"Courier New",monospace;letter-spacing:1px;';
  el.innerHTML =
    '<div style="font-size:14px;letter-spacing:3px;color:#39ff7a;">CRC SYNC</div>' +
    '<div style="font-size:11px;letter-spacing:1.5px;">LOGIN REQUIRED TO CONNECT</div>' +
    '<button id="crc-login-btn" style="padding:10px 26px;background:#132313;color:#39ff7a;' +
    'border:1px solid #2a3a2a;cursor:pointer;font-family:inherit;letter-spacing:2px;font-size:12px;">LOG IN</button>' +
    '<button id="crc-login-conn-btn" style="padding:6px 16px;background:transparent;color:#5a7a5a;' +
    'border:1px solid #2a3a2a;cursor:pointer;font-family:inherit;letter-spacing:1.5px;font-size:10px;">CONNECTION SETTINGS</button>';
  document.body.appendChild(el);
  document.getElementById('crc-login-btn').addEventListener('click', openSyncLogin);
  document.getElementById('crc-login-conn-btn').addEventListener('click', showConnWidget);
  // docs/adr/0161 §1: the radio without the map. Electron only: it writes the launch mode and relaunches (main.js).
  if (window.crcLaunch) {
    const radioOnly = document.createElement('button');
    radioOnly.id = 'crc-login-radio-only-btn';
    radioOnly.textContent = 'RADIO ONLY';
    radioOnly.style.cssText = 'padding:6px 16px;background:transparent;color:#5a7a5a;' +
      'border:1px solid #2a3a2a;cursor:pointer;font-family:inherit;letter-spacing:1.5px;font-size:10px;';
    radioOnly.addEventListener('click', () => window.crcLaunch.switchTo('radio'));
    el.appendChild(radioOnly);
  }
}

function hideLoginGate() {
  const el = document.getElementById('crc-login-gate');
  if (el) el.remove();
}

// The connection-settings trigger used to be a small floating "SYNC ⚙" tab
// here, hand-positioned above the SRS radio bar's fixed bottom edge (with a
// ResizeObserver to track its height). Both panels are normal dockview
// panels now — the trigger lives in Settings → Tools instead (wired in
// panels/tools-panel.js's initToolsTab, calling showConnWidget directly).

// Apply overrides immediately (not just lazily inside getSyncFeedUrl) so
// the CASDOOR_ENDPOINT/CASDOOR_CLIENT_ID an early LOG IN click uses, and
// what /js/config.js reports to auth-callback.html's cross-origin fetch,
// are already correct before the user does anything.
applyConnOverrides();

// ── Ticket + feed URL ───────────────────────────────────────────────────
// The ticket request goes through this app's own local server (same
// origin), which forwards it to crc-sync server-to-server — the renderer
// itself only ever talks to crc-sync directly for the WebSocket, and
// cross-origin for the one-time OAuth code exchange in auth-callback.html.

async function fetchSyncTicket() {
  const token = getSyncToken();
  if (!token) return null;
  try {
    const res = await fetch('/api/ws-ticket', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.ticket || null;
  } catch (_) {
    return null;
  }
}

// The app version, for the server's log only (crc-sync docs/adr/0103). Outside Electron (no preload) it is 'dev'.
async function appVersion() {
  try {
    if (window.crcUpdate && window.crcUpdate.getAppVersion) return String(await window.crcUpdate.getAppVersion());
  } catch (_) { /* fall through */ }
  return 'dev';
}

/** The full app's: no ticket shows the login gate. */
export async function getSyncFeedUrl() {
  const url = await getSyncFeedUrlNoGate();
  if (url) hideLoginGate(); else showLoginGate();
  return url;
}

/** A ready-to-open /feed URL, or null with no ticket (not logged in, or crc-sync out of reach). Draws nothing: the radio-only page runs without a login. */
export async function getSyncFeedUrlNoGate() {
  await applyConnOverrides();
  const ticket = await fetchSyncTicket();
  if (!ticket) return null;
  const wsBase = CRCSYNC_URL.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
  return `${wsBase}/feed?ticket=${encodeURIComponent(ticket)}&protocol=${WIRE_PROTOCOL}&client=${encodeURIComponent(await appVersion())}`;
}

// ── Outbound mutation channel ───────────────────────────────────────────
// The actual WebSocket instance is owned by app.js's connect()/reconnect
// logic; it registers itself here so iff.js/geo.js can send through it
// without app.js exposing its module-scoped `_ws`.

let _syncSocket = null;
let _syncSocketGen = 0; // bumped per socket, so a reconnect faster than any poll is still seen (radio/relay-feed.js)
export function _setSyncSocket(ws) { _syncSocket = ws; _syncSocketGen++; }
/** Which /feed socket this is: a new number for every socket app.js opens. */
export function syncSocketGeneration() { return _syncSocketGen; }
export function sendToSync(msg) {
  if (_syncSocket && _syncSocket.readyState === WebSocket.OPEN) {
    _syncSocket.send(JSON.stringify(msg));
  }
}
// sendToSync() above silently drops the message if the socket isn't OPEN —
// fine for its existing callers (IFF declarations etc. get retried
// implicitly by the next state sync), but EFSP callers need to be able to
// tell "silently dropped" apart from "sent, waiting on a reply" to avoid
// looking identically broken either way. See efsp-ws.js.
export function isSyncOpen() { return !!(_syncSocket && _syncSocket.readyState === WebSocket.OPEN); }

// ESM-1: replaces sendToSync for every importer (live binding). The classic page let a caller assign the global
// `sendToSync`; the e2e specs use this setter (e2e/helpers/modules.js), and unit tests may too.
export function setSendToSync(fn) { sendToSync = fn; }
// ESM-1 (S-ESM1b): the unit tests replaced the global isSyncOpen; this is that seam.
export function setIsSyncOpen(fn) { isSyncOpen = fn; }
