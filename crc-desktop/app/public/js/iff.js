'use strict';

// ── IFF state constants ────────────────────────────────────────────────────
// Keep this list byte-identical to crc-sync/src/surveillance/iff.js's IFF_STATES
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
// 3 = BLUE (default), 2 = RED. A local display preference (which side's
// bullseye the airport panel uses) — it drives nothing about the picture,
// which crc-sync resolves from one squadron-wide coalition
// (CRCSYNC_COALITION on the server).

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
// Shared by every controller: a declaration is a mutation to crc-sync
// (its collab-store.js), sent via sync.js's sendToSync.

function setIffOverride(id, state) {
  if (!IFF_STATES.includes(state)) return;
  sendToSync({ type: 'declare', trackId: String(id), state });
}

function clearIffOverride(id) {
  sendToSync({ type: 'clearDeclare', trackId: String(id) });
}

// ── Effective IFF state ─────────────────────────────────────────────────────
// crc-sync resolves this server-side (auto classification + declaration
// override merged) and attaches it to each contact as `iffState` — see
// crc-sync/src/surveillance/iff.js.

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
