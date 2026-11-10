'use strict';
import { escapeHtml } from './html-escape.js';

// crc-sync's connection settings (URL, Casdoor endpoint, client ID): the stored overrides and their widget. A leaf beside
// sync.js, which applies them and owns the login and the /feed socket.

// ── Connection settings (URL / Casdoor endpoint / client ID) ──────────────
// config.json (read at Electron startup, exposed via /js/config.js as
// CRCSYNC_URL/CASDOOR_ENDPOINT/CASDOOR_CLIENT_ID) provides the defaults.
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
    crcSyncUrl:      overrides.crcSyncUrl      || (typeof CRCSYNC_URL      !== 'undefined' ? CRCSYNC_URL      : 'wss://asacs.sourcedcs.page'),
    casdoorEndpoint: overrides.casdoorEndpoint || (typeof CASDOOR_ENDPOINT  !== 'undefined' ? CASDOOR_ENDPOINT  : ''),
    casdoorClientId: overrides.casdoorClientId || (typeof CASDOOR_CLIENT_ID !== 'undefined' ? CASDOOR_CLIENT_ID : ''),
  };
}

// Applies any stored overrides to the in-page globals (so the rest of this
// file just reads CRCSYNC_URL/CASDOOR_* as usual) and pushes them to the
// local server so its crc-sync proxies (ws-ticket, atis-transmit, ...) stay
// consistent with what the renderer is actually using. Runs once at load.
export async function applyConnOverrides() {
  const eff = getEffectiveConn();
  CRCSYNC_URL      = eff.crcSyncUrl;
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

// ── Connection settings widget ──────────────────────────────────────────
// Always reachable via Settings → Tools → Connection Settings (panels/tools-panel.js's
// initToolsTab), plus from the login gate above when there's nothing to
// connect to yet.

function _connFieldRow(label, id, value) {
  return `<label style="display:flex;flex-direction:column;gap:4px;font-size:10px;letter-spacing:1px;">
    ${escapeHtml(label)}
    <input id="${escapeHtml(id)}" value="${escapeHtml(value)}" style="background:#0d130d;color:#c8d8c8;
      border:1px solid #2a3a2a;padding:7px 8px;font-family:inherit;font-size:12px;letter-spacing:0.5px;border-radius:2px;">
  </label>`;
}

export function showConnWidget() {
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
