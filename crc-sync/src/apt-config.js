'use strict';

// Per-airport ATIS operating config: saved frequency, runway, info letter,
// and manually-entered wx (visibility + up to 3 cloud layers). Used to live
// entirely in crc-desktop's per-client localStorage (settings.aprtAtisFreq /
// settings.aprtManualWx) — or, for runway/info letter, nowhere persisted at
// all, just live DOM state lost whenever the panel's element got torn down.
// That meant one controller's ATIS setup for an airport was invisible to
// everyone else, and a second controller listening on the same frequency
// could easily be reading a stale runway. Now squadron-wide and
// server-authoritative, same pattern as config/squawk-map.json — editable
// live from any connected client (ws-hub.js's 'aptConfigSet' message) and
// persisted so it survives a crc-sync restart.

const fs   = require('fs');
const path = require('path');

// Overridable so tests can exercise the mutate/persist path against a temp
// file instead of the real squadron-wide config (same pattern as
// resolve.js's CRCSYNC_SQUAWK_MAP_PATH).
const APT_CONFIG_PATH = process.env.CRCSYNC_APT_CONFIG_PATH
  || path.join(__dirname, '../config/apt-config.json');

const KEY_MAX_LEN   = 40; // airport ICAO/name — generous, these are always short
const FREQ_MAX_LEN  = 16;
const RWY_MAX_LEN   = 4;
const INFO_MAX_LEN  = 1;
const VIS_MAX_LEN   = 8;
const COVER_MAX_LEN = 4;
const BASE_MAX_LEN  = 8;
const MAX_CLOUD_LAYERS = 3;
const MAX_AIRPORTS     = 500; // no DCS theater has anywhere near this many airports

let byAirport = {};
try {
  byAirport = JSON.parse(fs.readFileSync(APT_CONFIG_PATH, 'utf8'));
} catch (e) {
  console.warn('[apt-config] failed to load config/apt-config.json, starting empty:', e.message);
}

function _persist() {
  try {
    fs.writeFileSync(APT_CONFIG_PATH, JSON.stringify(byAirport, null, 2));
  } catch (e) {
    console.warn('[apt-config] failed to persist config/apt-config.json:', e.message);
  }
}

function _clean(v, maxLen) {
  return typeof v === 'string' ? v.slice(0, maxLen) : '';
}

function _cleanClouds(clouds) {
  if (!Array.isArray(clouds)) return null;
  return clouds.slice(0, MAX_CLOUD_LAYERS).map(c => ({
    cover: _clean(c && c.cover, COVER_MAX_LEN),
    base:  _clean(c && c.base,  BASE_MAX_LEN),
  }));
}

// Deep copy (not just { ...byAirport }) — each entry has a nested manualWx
// object, and setAptConfig always replaces entries wholesale rather than
// mutating in place, so a shallow copy's nested objects would still alias
// the live store and let a caller corrupt it by mutating what looks like a
// returned snapshot.
function getAptConfig() {
  return JSON.parse(JSON.stringify(byAirport));
}

// Merges whichever fields are present in `patch` onto the existing entry
// for `key` (creating one if this is the first edit) — a partial patch, not
// a full replace, so e.g. a freq-only edit never clobbers that airport's
// already-saved manual wx. manualWx itself is patched the same way (vis and
// clouds independently), for the same reason.
// Returns true if `key` was valid and something was actually applied
// (caller broadcasts only then, same as theater-settings.js).
function setAptConfig(key, patch) {
  const cleanKey = _clean(key, KEY_MAX_LEN);
  if (!cleanKey || !patch || typeof patch !== 'object') return false;
  if (!byAirport[cleanKey] && Object.keys(byAirport).length >= MAX_AIRPORTS) return false;

  const existing = byAirport[cleanKey] || { freq: '', rwy: '', info: '', manualWx: { vis: '', clouds: [] } };
  const next = { ...existing, manualWx: { ...existing.manualWx } };
  let changed = false;

  if (typeof patch.freq === 'string') { next.freq = _clean(patch.freq, FREQ_MAX_LEN); changed = true; }
  if (typeof patch.rwy  === 'string') { next.rwy  = _clean(patch.rwy,  RWY_MAX_LEN);  changed = true; }
  if (typeof patch.info === 'string') { next.info = _clean(patch.info, INFO_MAX_LEN); changed = true; }
  if (patch.manualWx && typeof patch.manualWx === 'object') {
    if (typeof patch.manualWx.vis === 'string') { next.manualWx.vis = _clean(patch.manualWx.vis, VIS_MAX_LEN); changed = true; }
    const clouds = _cleanClouds(patch.manualWx.clouds);
    if (clouds) { next.manualWx.clouds = clouds; changed = true; }
  }
  if (!changed) return false;

  byAirport[cleanKey] = next;
  _persist();
  return true;
}

module.exports = { getAptConfig, setAptConfig };
