'use strict';

// Theater reference settings for the airport panel: transition altitude and
// the manual true->grid heading fudge factor. These used to live in
// crc-desktop's per-client localStorage
// (app.js's settings.transitionAltFt/hdgCorrection), which
// meant every controller could be looking at a different transition
// altitude for the same theater. Now squadron-wide and server-authoritative,
// same pattern as apt-config.json — editable live from
// any connected client (ws-hub.js's 'theaterSettingsSet' message) and
// persisted so it survives a crc-sync restart.
//
// The theater's UTC offset is NOT one of these any more: it is a fixed
// property of the map, read from config/theater-offsets.json and applied by
// the server's mission clock (docs/adr/0079), not something a controller sets.

const fs   = require('fs');
const { statePaths, ensureDirFor } = require('./state-paths');

// Read from data/ if a live copy exists, else the shipped default in config/;
// always write to data/ (see state-paths.js). Overridable so tests can exercise
// the mutate/persist path against a temp file instead of the real squadron-wide
// config.
const { read: THEATER_SETTINGS_READ_PATH, write: THEATER_SETTINGS_PATH } =
  statePaths('theater-settings.json', process.env.CRCSYNC_THEATER_SETTINGS_PATH);

const DEFAULTS = {
  transitionAltFt: 18000, // ft — below this use QNH, at/above use standard (FL)
  hdgCorrection:   0,     // manual true->grid heading fudge factor, degrees
};

let settings = { ...DEFAULTS };
try {
  const cfg = JSON.parse(fs.readFileSync(THEATER_SETTINGS_READ_PATH, 'utf8'));
  // Known keys only — a saved file can carry one this module no longer has
  // (gameTimeOffset did, before docs/adr/0079), and it must not ride along
  // onto the wire.
  for (const key of Object.keys(DEFAULTS)) if (Number.isFinite(cfg[key])) settings[key] = cfg[key];
} catch (e) {
  console.warn('[theater-settings] failed to load config/theater-settings.json, using defaults:', e.message);
}

function _persist() {
  try {
    ensureDirFor(THEATER_SETTINGS_PATH);
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
