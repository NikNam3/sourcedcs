'use strict';

// ── IFF state constants ────────────────────────────────────────────────────
// Keep this list byte-identical to crc-sync/src/resolve.js's own IFF_STATES
// — this copy gates setIffOverride() below before a declare mutation is even
// sent to crc-sync, so adding a state on only one side either gets rejected
// here before it reaches the server, or accepted server-side but never
// reachable from this UI.

const IFF_STATES = ['friendly', 'neutral', 'bogey', 'bandit', 'hostile'];

// Fallback colors — real values come from settings.col* at runtime.
const IFF_COLOR_DEFAULTS = {
  friendly: '#4488cc',
  bogey:    '#ccaa00',
  neutral:  '#888888',
  bandit:   '#cc6600',
  hostile:  '#cc2222',
};

// ── User coalition ────────────────────────────────────────────────────────
// 3 = BLUE (default), 2 = RED. Local-only display preference (radar-lock
// filtering, own-side UI theme) — no longer drives the shared IFF picture,
// which crc-sync now resolves from a single fixed squadron-wide coalition
// (CRCSYNC_COALITION on the server). Kept exactly as before.

let userCoalition = 3;

function loadUserCoalition() {
  try {
    const v = parseInt(localStorage.getItem('crc-desktop-user-coalition'), 10);
    if (v === 2 || v === 3) userCoalition = v;
  } catch (_) {}
}

function saveUserCoalition() {
  localStorage.setItem('crc-desktop-user-coalition', String(userCoalition));
}

function toggleUserCoalition() {
  userCoalition = userCoalition === 3 ? 2 : 3;
  saveUserCoalition();
}

function getUserCoalition() { return userCoalition; }

// ── IFF declarations ───────────────────────────────────────────────────────
// Moved server-side (crc-sync's src/collab-store.js + resolve.js) so every
// connected controller sees the same declarations. These functions keep
// their original names/signatures — every call site in ui.js/geojson.js/
// app.js is unchanged — but now send a mutation to crc-sync (via sendToSync,
// defined in sync.js) instead of writing to a local Map/localStorage.

function setIffOverride(id, state) {
  if (!IFF_STATES.includes(state)) return;
  sendToSync({ type: 'declare', trackId: String(id), state });
}

function clearIffOverride(id) {
  sendToSync({ type: 'clearDeclare', trackId: String(id) });
}

// No-op: state now arrives from crc-sync on every (re)connect via the
// 'snapshot'/'delta' messages, there's nothing to load from localStorage.
function loadIffOverrides() {}

// No-op: crc-sync clears the shared overlay for everyone on mission-load
// (src/collab-store.js clear()) — a client no longer clears its own copy.
function clearAllIffOverrides() {}

// ── Effective IFF state ─────────────────────────────────────────────────────
// crc-sync resolves this server-side (auto classification + declaration
// override merged) and attaches it directly to each track as `iffState` —
// see crc-sync/src/resolve.js, ported from what this function used to
// compute locally.

function getIff(track) {
  return (track && track.iffState) || 'neutral';
}

// CSS colour for an IFF state — reads live from settings so colour picker
// changes take effect immediately without a page reload.
function iffColor(state) {
  // settings is defined in app.js; safe to read here because iffColor is
  // only ever called at runtime (never at parse time).
  const col = {
    friendly: (typeof settings !== 'undefined' && settings.colFriendly) || IFF_COLOR_DEFAULTS.friendly,
    bogey:    (typeof settings !== 'undefined' && settings.colBogey)    || IFF_COLOR_DEFAULTS.bogey,
    neutral:  (typeof settings !== 'undefined' && settings.colNeutral)  || IFF_COLOR_DEFAULTS.neutral,
    bandit:   (typeof settings !== 'undefined' && settings.colBandit)   || IFF_COLOR_DEFAULTS.bandit,
    hostile:  (typeof settings !== 'undefined' && settings.colHostile)  || IFF_COLOR_DEFAULTS.hostile,
  };
  return col[state] || '#888888';
}
