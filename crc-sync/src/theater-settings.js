'use strict';

// Theater reference settings for the airport panel: transition altitude,
// the manual true->grid heading fudge factor, and the game-time Zulu
// offset. These used to live in crc-desktop's per-client localStorage
// (app.js's settings.transitionAltFt/hdgCorrection/gameTimeOffset), which
// meant every controller could be looking at a different transition
// altitude for the same theater. Now squadron-wide and server-authoritative,
// same pattern as config/squawk-map.json in resolve.js — editable live from
// any connected client (ws-hub.js's 'theaterSettingsSet' message) and
// persisted so it survives a crc-sync restart.

const fs   = require('fs');
const path = require('path');

// Overridable so tests can exercise the mutate/persist path against a temp
// file instead of the real squadron-wide config (same pattern as
// resolve.js's CRCSYNC_SQUAWK_MAP_PATH).
const THEATER_SETTINGS_PATH = process.env.CRCSYNC_THEATER_SETTINGS_PATH
  || path.join(__dirname, '../config/theater-settings.json');

const DEFAULTS = {
  transitionAltFt: 18000, // ft — below this use QNH, at/above use standard (FL)
  hdgCorrection:   0,     // manual true->grid heading fudge factor, degrees
  gameTimeOffset:  0,     // hours — theater UTC offset subtracted to display Zulu
};

let settings = { ...DEFAULTS };
try {
  const cfg = JSON.parse(fs.readFileSync(THEATER_SETTINGS_PATH, 'utf8'));
  settings = { ...DEFAULTS, ...cfg };
} catch (e) {
  console.warn('[theater-settings] failed to load config/theater-settings.json, using defaults:', e.message);
}

function _persist() {
  try {
    fs.writeFileSync(THEATER_SETTINGS_PATH, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.warn('[theater-settings] failed to persist config/theater-settings.json:', e.message);
  }
}

function getTheaterSettings() {
  return { ...settings };
}

// Applies whichever known, finite fields are present in patch; unknown or
// non-finite fields are silently ignored rather than rejecting the whole
// patch, so an old client sending only one changed field never clobbers the
// rest. Returns true if anything actually changed (caller uses this to
// decide whether a broadcast/persist is warranted).
function setTheaterSettings(patch) {
  if (!patch || typeof patch !== 'object') return false;
  let changed = false;
  for (const key of Object.keys(DEFAULTS)) {
    if (!Number.isFinite(patch[key])) continue;
    const v = Math.round(patch[key]);
    if (v !== settings[key]) { settings[key] = v; changed = true; }
  }
  if (changed) _persist();
  return changed;
}

module.exports = { getTheaterSettings, setTheaterSettings };
