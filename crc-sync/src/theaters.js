'use strict';

// Fixed per-theater facts: each theater's local-time offset from Zulu
// (docs/adr/0079), its transition altitude (decisions.md H62), the central
// meridian of its DCS projection, an optional magnetic-variation override
// (docs/adr/0085) and the map rectangle the terrain build samples (docs/adr/0133). Shipped in config/theaters.json; a copy in
// state/theaters.json overrides it theater by theater, field by field, so a
// wrong value can be corrected on the server without a release.
//
// Read ONCE, at startup, and never written by code (docs/parallel P5, the same
// rule alerting-config.js keeps). The offset used to be `gameTimeOffset`, a
// synced setting any controller could edit from the Airport panel and that
// only the topbar clock ever applied.

const fs = require('fs');
const path = require('path');
const { dirs } = require('./state-paths');
const { readShipped } = require('./tuning-file');
const log = require('./log').logger('theaters');

function _read(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (parsed && typeof parsed.theaters === 'object' && parsed.theaters) || {};
  } catch (e) {
    if (e.code !== 'ENOENT') log.warn('failed to read', { file, error: e.message });
    return null;
  }
}

// An override is one of { fixedDeg } or { offsetDeg }, never both: which one
// wins would otherwise be a silent rule nobody wrote down.
function _validVariationOverride(v) {
  if (!v || typeof v !== 'object') return false;
  const fixed = Number.isFinite(v.fixedDeg), offset = Number.isFinite(v.offsetDeg);
  return fixed !== offset;
}

/** The DCS map rectangle the terrain build samples (docs/adr/0133): exactly {xMin, xMax, zMin, zMax}, min below max. */
function validTerrainExtent(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
  const keys = Object.keys(e).sort().join();
  if (keys !== 'xMax,xMin,zMax,zMin') return false;
  return [e.xMin, e.xMax, e.zMin, e.zMax].every(Number.isFinite) && e.xMin < e.xMax && e.zMin < e.zMax;
}

/**
 * @param {string} [override] one file to read instead of config/ + state/ (tests)
 * @returns {Record<string, {utcOffsetHours:number, transitionAltFt?:number, tmCentralMeridianDeg?:number,
 *   magneticVariation?:{fixedDeg?:number, offsetDeg?:number}, terrainExtent?:{xMin:number, xMax:number, zMin:number, zMax:number}}>} only entries with a finite offset;
 *   an invalid optional field is dropped with a warning, the rest of the entry kept
 */
function loadTheaters(override, env = process.env) {
  const { configDir, stateDir } = dirs(env);
  const layers = override
    ? [_read(override)]
    : [_read(path.join(configDir, 'theaters.json')), _read(path.join(stateDir, 'theaters.json'))];
  if (!layers[0]) log.warn('no theater table — every theater runs its mission clock on offset 0');
  const merged = {};
  for (const layer of layers) {
    for (const [name, entry] of Object.entries(layer || {})) {
      if (entry && typeof entry === 'object') merged[name] = { ...merged[name], ...entry };
    }
  }
  const out = {};
  for (const [name, entry] of Object.entries(merged)) {
    if (!Number.isFinite(entry.utcOffsetHours)) {
      log.warn('no numeric utcOffsetHours — ignored', { theater: name });
      continue;
    }
    const clean = { ...entry };
    if ('transitionAltFt' in clean && !(Number.isFinite(clean.transitionAltFt) && clean.transitionAltFt > 0)) {
      log.warn('transitionAltFt is not a positive number — ignored', { theater: name });
      delete clean.transitionAltFt;
    }
    if ('tmCentralMeridianDeg' in clean && !Number.isFinite(clean.tmCentralMeridianDeg)) {
      log.warn('tmCentralMeridianDeg is not a number — ignored', { theater: name });
      delete clean.tmCentralMeridianDeg;
    }
    if ('terrainExtent' in clean && !validTerrainExtent(clean.terrainExtent)) {
      log.warn('terrainExtent must be {xMin, xMax, zMin, zMax}, finite, min below max — ignored, the terrain build refuses this theater', { theater: name });
      delete clean.terrainExtent;
    }
    if ('magneticVariation' in clean && !_validVariationOverride(clean.magneticVariation)) {
      log.warn('magneticVariation must be exactly one of {fixedDeg} or {offsetDeg} — ignored, the model applies', { theater: name });
      delete clean.magneticVariation;
    }
    out[name] = clean;
  }
  return out;
}

// What a theater the table does not list gets (and what a test fixture that
// injects no theater gets): config/theaters.json `defaultTransitionAltFt`, the
// 18,000 ft every theater used before H62. Read strictly at load (DATA-2, H88):
// a missing file or a non-positive value is a startup error naming the file.
function _readDefaultTransitionAltFt() {
  const v = readShipped('theaters.json').defaultTransitionAltFt;
  if (!(Number.isFinite(v) && v > 0)) throw new Error('[theaters] config/theaters.json: defaultTransitionAltFt must be a positive number');
  return v;
}
let DEFAULT_TRANSITION_ALT_FT = null;
/** The default transition altitude, read on first use (not when this file is required). */
function defaultTransitionAltFt() {
  if (DEFAULT_TRANSITION_ALT_FT === null) DEFAULT_TRANSITION_ALT_FT = _readDefaultTransitionAltFt();
  return DEFAULT_TRANSITION_ALT_FT;
}

module.exports = { loadTheaters, defaultTransitionAltFt, validTerrainExtent };
