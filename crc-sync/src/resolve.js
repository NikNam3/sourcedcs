'use strict';

// Track resolution — ported from crc-desktop's app/public/js/iff.js
// (computeAutoIff) and app/public/js/geo.js (resolveCallsign/checkOnGround),
// run once server-side per broadcast tick instead of once per client.
//
// Two things that were per-client state in the original code had to become
// server-side config here, since a shared multiplayer picture can't have a
// per-viewer-relative answer for "which side is friendly" or "what does this
// squawk block mean":
//   - userCoalition (which side is "own") — was a per-client toggle, is now
//     CRCSYNC_COALITION (defaults to BLUE=3, matching crc-desktop's default).
//   - settings.squawkMap / settings.squawkSeq — were part of each client's
//     local settings panel, are now config/squawk-map.json (squadron-wide).

const fs   = require('fs');
const path = require('path');

const GROUND_RADIUS_M = 5000;
const GROUND_AGL_M    = 50;

// Keep this list byte-identical to crc-desktop/app/public/js/iff.js's own
// IFF_STATES — the client validates declare/rename mutations against its
// copy (setIffOverride's IFF_STATES.includes(state) guard) before ever
// sending them here, so a state added to only one side either gets silently
// rejected client-side or accepted here but never offered as a UI option.
const IFF_STATES = ['friendly', 'neutral', 'bogey', 'bandit', 'hostile'];

const USER_COALITION = parseInt(process.env.CRCSYNC_COALITION, 10) === 2 ? 2 : 3; // 3=BLUE (default), 2=RED

// Overridable so tests can exercise the mutate/persist path against a temp
// file instead of the real squadron-wide config (same env-var-override
// pattern as CRCSYNC_COALITION above).
const SQUAWK_MAP_PATH = process.env.CRCSYNC_SQUAWK_MAP_PATH || path.join(__dirname, '../config/squawk-map.json');
const SQUAWK_NAME_MAX_LEN = 20;

let squawkMap = {};
let squawkSeq = {};
try {
  const cfg = JSON.parse(fs.readFileSync(SQUAWK_MAP_PATH, 'utf8'));
  squawkMap = cfg.squawkMap || {};
  squawkSeq = cfg.squawkSeq || {};
} catch (e) {
  console.warn('[resolve] failed to load config/squawk-map.json, using empty maps:', e.message);
}

function _persistSquawkConfig() {
  try {
    fs.writeFileSync(SQUAWK_MAP_PATH, JSON.stringify({ squawkMap, squawkSeq }, null, 2));
  } catch (e) {
    console.warn('[resolve] failed to persist config/squawk-map.json:', e.message);
  }
}

// ── Squawk → callsign mapping: squadron-wide, server-authoritative ──────────
// Editable live from any connected client's SQWK C/S panel (ws-hub.js's
// 'squawkMapSet'/'squawkMapDelete' messages) — this used to be a per-client
// localStorage setting (crc-desktop's ui.js), which meant an edit only ever
// changed what the editing client itself saw and never what resolveCallsign
// actually returns to anyone. Persisted back to config/squawk-map.json so it
// survives a restart, same as the file's original hand-edited role.

function getSquawkConfig() {
  return { squawkMap: { ...squawkMap }, squawkSeq: { ...squawkSeq } };
}

// Returns true on success, false if the input was invalid (caller just drops it).
function setSquawkMapping(kind, code, name) {
  if (kind !== 'exact' && kind !== 'seq') return false;
  const codeNum = Number(code);
  if (!Number.isInteger(codeNum) || codeNum < 0 || codeNum > 7777) return false;
  const clean = String(name || '').trim().toUpperCase().slice(0, SQUAWK_NAME_MAX_LEN);
  if (!clean) return false;

  const map = kind === 'exact' ? squawkMap : squawkSeq;
  map[String(codeNum)] = clean;
  _persistSquawkConfig();
  return true;
}

function deleteSquawkMapping(kind, code) {
  const map = kind === 'exact' ? squawkMap : kind === 'seq' ? squawkSeq : null;
  if (!map) return false;
  const key = String(Number(code));
  if (!(key in map)) return false;
  delete map[key];
  _persistSquawkConfig();
  return true;
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R  = 6371000;
  const phi1 = lat1 * Math.PI / 180, phi2 = lat2 * Math.PI / 180;
  const dPhi = (lat2 - lat1) * Math.PI / 180;
  const dLambda = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isTransponderActive(track) {
  if (track.squawk == null) return false;
  const sq = Number(track.squawk);
  return Number.isFinite(sq) && sq >= 0 && sq <= 7777;
}

function checkOnGround(track, missionData) {
  if (!missionData || !missionData.airports) return false;
  if (track.category !== 1 && track.category !== 2) return false;
  for (const ap of missionData.airports) {
    if (!ap.lat || !ap.lon) continue;
    const distM = haversineM(track.lat, track.lon, ap.lat, ap.lon);
    if (distM < GROUND_RADIUS_M) {
      const agl = track.alt - (ap.elev || 0);
      if (agl < GROUND_AGL_M) return true;
    }
  }
  return false;
}

function computeAutoIff(track, missionData) {
  const own   = USER_COALITION;
  const enemy = own === 3 ? 2 : 3;

  if (track.coalition === own) {
    if (!track.player)              return 'friendly'; // AI = always friendly
    if (isTransponderActive(track)) return 'friendly'; // player + transponder
    return checkOnGround(track, missionData) ? 'friendly' : 'bogey';
  }

  if (track.coalition === enemy) {
    return checkOnGround(track, missionData) ? 'invisible' : 'bogey';
  }

  return 'neutral'; // coalition 1 (neutral) or unknown
}

// Resolves the effective IFF state: manual declaration first, then auto.
function resolveIff(track, collabEntry, missionData) {
  if (collabEntry && collabEntry.iff) return collabEntry.iff.state;
  return computeAutoIff(track, missionData);
}

// Resolves the display callsign for a track.
// Priority: squawkMap (exact) -> squawkSeq (range) -> user rename -> TN##### (enemy) -> raw callsign
// `assignTrackNumber` is collabStore.getOrAssignTrackNumber, called in-process
// so an enemy track's number is generated (once, server-side) the moment it's
// first resolved for anyone — matching the original client's on-demand
// auto-assignment, just now guaranteed identical for every viewer.
function resolveCallsign(track, collabEntry, assignTrackNumber) {
  if (track.squawk != null) {
    const sq = Number(track.squawk);

    const mapped = squawkMap[String(sq)];
    if (mapped) return mapped;

    for (const [baseCode, baseName] of Object.entries(squawkSeq)) {
      const base   = parseInt(baseCode, 10);
      const offset = sq - base;
      if (offset >= 0 && offset <= 98) return baseName + (offset + 1);
    }
  }

  if (collabEntry && collabEntry.rename) return collabEntry.rename.value;

  if (track.coalition != null && track.coalition !== 1 && track.coalition !== USER_COALITION) {
    return assignTrackNumber(track.id);
  }

  return track.callsign;
}

// Given a raw track (from TrackStore) and its CollaborativeStore overlay
// entry (or null), returns the fully-resolved fields a client just renders.
// Alongside the merged/resolved fields (iffState, callsign) this also sends
// the raw declaration (iffOverride, rename) separately — a client needs to
// know "is there an active manual override" (e.g. to highlight the matching
// button in a controls panel) independent of the resolved display value.
function resolveTrack(track, collabEntry, missionData, assignTrackNumber) {
  return {
    ...track,
    iffState:    resolveIff(track, collabEntry, missionData),
    iffOverride: (collabEntry && collabEntry.iff)         ? collabEntry.iff.state         : null,
    callsign:    resolveCallsign(track, collabEntry, assignTrackNumber),
    rename:      (collabEntry && collabEntry.rename)      ? collabEntry.rename.value      : null,
    trackNumber: (collabEntry && collabEntry.trackNumber) ? collabEntry.trackNumber.value : null,
  };
}

module.exports = {
  resolveTrack, resolveIff, resolveCallsign, computeAutoIff, checkOnGround, haversineM, IFF_STATES, USER_COALITION,
  getSquawkConfig, setSquawkMapping, deleteSquawkMapping,
};
