'use strict';

// crc-sync client — Casdoor login (via a popup, main.js's
// setWindowOpenHandler allow-lists the Casdoor authorize URL), the
// connection settings widget, plus the outbound side of the /feed
// WebSocket connection app.js's connect() opens.
//
// iff.js/geo.js call sendToSync(msg) for declare/rename mutations; app.js's
// connect() calls getSyncFeedUrl() to get a ready-to-open wss:// URL (or
// null, meaning: not logged in yet, login gate is now showing, keep
// retrying on the existing reconnect timer).

const SYNC_TOKEN_KEY = 'crc-desktop-sync-token';

function getSyncToken() {
  try { return localStorage.getItem(SYNC_TOKEN_KEY); } catch (_) { return null; }
}

// Header object for any fetch() to this app's own local server that proxies
// through to a crc-sync route guarded by requireAuth (e.g. /api/apt-weather,
// /api/atis-transmit, /api/srs-clients) -- app/server.js's proxyToSync()
// only forwards an Authorization header if the browser's own request to it
// already had one; callers that skip this get "Authentication required"
// back from crc-sync even though the user is fully logged in.
function _syncAuthHeaders() {
  const token = getSyncToken();
  return token ? { Authorization: 'Bearer ' + token } : {};
}

function clearSyncToken() {
  try { localStorage.removeItem(SYNC_TOKEN_KEY); } catch (_) {}
}

// ── Connection settings (URL / Casdoor endpoint / client ID) ──────────────
// config.json (read at Electron startup, exposed via /js/config.js as
// CRC_SYNC_URL/CASDOOR_ENDPOINT/CASDOOR_CLIENT_ID) provides the defaults.
// A squadron member can override any of them from the widget below without
// touching config.json — stored in localStorage, reapplied on every launch.

const CONN_OVERRIDE_KEYS = {
  crcSyncUrl:      'crc-desktop-conn-crc-sync-url',
  casdoorEndpoint: 'crc-desktop-conn-casdoor-endpoint',
  casdoorClientId: 'crc-desktop-conn-casdoor-client-id',
};

function getConnOverrides() {
  const out = {};
  for (const [field, key] of Object.entries(CONN_OVERRIDE_KEYS)) {
    try {
      const v = localStorage.getItem(key);
      if (v) out[field] = v;
    } catch (_) {}
  }
  return out;
}

function getEffectiveConn() {
  const overrides = getConnOverrides();
  return {
    crcSyncUrl:      overrides.crcSyncUrl      || (typeof CRC_SYNC_URL      !== 'undefined' ? CRC_SYNC_URL      : 'wss://asacs.sourcedcs.page'),
    casdoorEndpoint: overrides.casdoorEndpoint || (typeof CASDOOR_ENDPOINT  !== 'undefined' ? CASDOOR_ENDPOINT  : ''),
    casdoorClientId: overrides.casdoorClientId || (typeof CASDOOR_CLIENT_ID !== 'undefined' ? CASDOOR_CLIENT_ID : ''),
  };
}

// Applies any stored overrides to the in-page globals (so the rest of this
// file just reads CRC_SYNC_URL/CASDOOR_* as usual) and pushes them to the
// local server so its crc-sync proxies (ws-ticket, atis-transmit, ...) stay
// consistent with what the renderer is actually using. Runs once at load.
async function applyConnOverrides() {
  const eff = getEffectiveConn();
  CRC_SYNC_URL      = eff.crcSyncUrl;
  CASDOOR_ENDPOINT   = eff.casdoorEndpoint;
  CASDOOR_CLIENT_ID  = eff.casdoorClientId;
  try {
    await fetch('/api/sync-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eff),
    });
  } catch (_) { /* local server not up yet or unreachable — proxies will just use their own defaults */ }
}

function openSyncLogin() {
  if (!CASDOOR_ENDPOINT) {
    console.error('[sync] CASDOOR_ENDPOINT not configured — open Connection Settings and fill it in');
    showConnWidget();
    return;
  }
  const ru = encodeURIComponent(window.location.origin + '/auth-callback.html');
  const stArr = new Uint8Array(16);
  try { window.crypto.getRandomValues(stArr); } catch (_) {}
  const st = Array.from(stArr).map(b => b.toString(16).padStart(2, '0')).join('');
  try { sessionStorage.setItem('crc-desktop-oauth-state', st); } catch (_) {}
  const url = `${CASDOOR_ENDPOINT}/login/oauth/authorize?client_id=${CASDOOR_CLIENT_ID}` +
    `&redirect_uri=${ru}&response_type=code&scope=openid+profile&state=${st}&prompt=none`;
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
}

function hideLoginGate() {
  const el = document.getElementById('crc-login-gate');
  if (el) el.remove();
}

// ── Connection settings widget ──────────────────────────────────────────
// Always reachable via Settings → Tools → Connection Settings (ui.js's
// initToolsTab), plus from the login gate above when there's nothing to
// connect to yet.

function _connFieldRow(label, id, value) {
  return `<label style="display:flex;flex-direction:column;gap:4px;font-size:10px;letter-spacing:1px;">
    ${label}
    <input id="${id}" value="${(value || '').replace(/"/g, '&quot;')}" style="background:#0d130d;color:#c8d8c8;
      border:1px solid #2a3a2a;padding:7px 8px;font-family:inherit;font-size:12px;letter-spacing:0.5px;border-radius:2px;">
  </label>`;
}

function showConnWidget() {
  if (document.getElementById('crc-conn-widget')) return;
  const eff = getEffectiveConn();

  const el = document.createElement('div');
  el.id = 'crc-conn-widget';
  el.style.cssText = 'position:fixed;inset:0;background:rgba(5,8,5,0.75);display:flex;' +
    'align-items:center;justify-content:center;z-index:100000;font-family:"Courier New",monospace;';
  el.innerHTML = `
    <div style="background:#0d130d;border:1px solid #2a3a2a;padding:22px;width:340px;
      display:flex;flex-direction:column;gap:14px;color:#c8d8c8;">
      <div style="font-size:13px;letter-spacing:3px;color:#39ff7a;">CONNECTION SETTINGS</div>
      ${_connFieldRow('CRC-SYNC URL (wss://…)', 'conn-url', eff.crcSyncUrl)}
      ${_connFieldRow('CASDOOR ENDPOINT (https://…)', 'conn-casdoor-endpoint', eff.casdoorEndpoint)}
      ${_connFieldRow('CASDOOR CLIENT ID', 'conn-casdoor-client', eff.casdoorClientId)}
      <div id="conn-err" style="font-size:10px;color:#ff5555;display:none;"></div>
      <div style="display:flex;gap:8px;justify-content:space-between;margin-top:4px;">
        <button id="conn-reset" style="padding:8px 14px;background:transparent;color:#5a7a5a;
          border:1px solid #2a3a2a;cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:1px;">RESET DEFAULTS</button>
        <div style="display:flex;gap:8px;">
          <button id="conn-cancel" style="padding:8px 14px;background:transparent;color:#8aab8a;
            border:1px solid #2a3a2a;cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:1px;">CANCEL</button>
          <button id="conn-save" style="padding:8px 14px;background:#132313;color:#39ff7a;
            border:1px solid #2a3a2a;cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:1px;">SAVE &amp; RECONNECT</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);

  const $err = document.getElementById('conn-err');
  const showErr = (msg) => { $err.textContent = msg; $err.style.display = ''; };

  document.getElementById('conn-cancel').addEventListener('click', () => el.remove());
  el.addEventListener('click', (e) => { if (e.target === el) el.remove(); });

  document.getElementById('conn-reset').addEventListener('click', () => {
    for (const key of Object.values(CONN_OVERRIDE_KEYS)) {
      try { localStorage.removeItem(key); } catch (_) {}
    }
    window.location.reload();
  });

  document.getElementById('conn-save').addEventListener('click', () => {
    const url = document.getElementById('conn-url').value.trim();
    const casdoorEndpoint = document.getElementById('conn-casdoor-endpoint').value.trim();
    const casdoorClient   = document.getElementById('conn-casdoor-client').value.trim();

    if (!/^wss?:\/\/.+/.test(url)) { showErr('CRC-SYNC URL must start with ws:// or wss://'); return; }
    if (casdoorEndpoint && !/^https?:\/\/.+/.test(casdoorEndpoint)) { showErr('Casdoor endpoint must start with http:// or https://'); return; }

    try {
      localStorage.setItem(CONN_OVERRIDE_KEYS.crcSyncUrl, url);
      localStorage.setItem(CONN_OVERRIDE_KEYS.casdoorEndpoint, casdoorEndpoint);
      localStorage.setItem(CONN_OVERRIDE_KEYS.casdoorClientId, casdoorClient);
    } catch (_) {}

    // A full reload keeps this simple and robust — every other piece of
    // code (WS connection, login popup, proxies) just re-reads the new
    // values from scratch instead of needing live hot-swap logic.
    window.location.reload();
  });
}

// The connection-settings trigger used to be a small floating "SYNC ⚙" tab
// here, hand-positioned above the SRS radio bar's fixed bottom edge (with a
// ResizeObserver to track its height). Both panels are normal dockview
// panels now — the trigger lives in Settings → Tools instead (wired in
// ui.js's initToolsTab, calling showConnWidget directly).

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

async function getSyncFeedUrl() {
  await applyConnOverrides();
  const ticket = await fetchSyncTicket();
  if (!ticket) {
    showLoginGate();
    return null;
  }
  hideLoginGate();
  const wsBase = CRC_SYNC_URL.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
  return `${wsBase}/feed?ticket=${encodeURIComponent(ticket)}`;
}

// ── Outbound mutation channel ───────────────────────────────────────────
// The actual WebSocket instance is owned by app.js's connect()/reconnect
// logic; it registers itself here so iff.js/geo.js can send through it
// without app.js exposing its module-scoped `_ws`.

let _syncSocket = null;
function _setSyncSocket(ws) { _syncSocket = ws; }
function sendToSync(msg) {
  if (_syncSocket && _syncSocket.readyState === WebSocket.OPEN) {
    _syncSocket.send(JSON.stringify(msg));
  }
}
// sendToSync() above silently drops the message if the socket isn't OPEN —
// fine for its existing callers (IFF declarations etc. get retried
// implicitly by the next state sync), but EFSP callers need to be able to
// tell "silently dropped" apart from "sent, waiting on a reply" to avoid
// looking identically broken either way. See efsp-ws.js.
function isSyncOpen() { return !!(_syncSocket && _syncSocket.readyState === WebSocket.OPEN); }
