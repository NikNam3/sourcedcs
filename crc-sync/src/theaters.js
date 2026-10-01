'use strict';

// Fixed per-theater facts: each theater's local-time offset from Zulu
// (docs/adr/0079), its transition altitude (decisions.md H62), the central
// meridian of its DCS projection and an optional magnetic-variation override
// (docs/adr/0085). Shipped in config/theaters.json; a copy in
// state/theaters.json overrides it theater by theater, field by field, so a
// wrong value can be corrected on the server without a release.
//
// Read ONCE, at startup, and never written by code (docs/parallel P5, the same
// rule alerting-config.js keeps). The offset used to be `gameTimeOffset`, a
// synced setting any controller could edit from the Airport panel and that
// only the topbar clock ever applied.

const fs = require('fs');
const path = require('path');
const { CONFIG_DIR, STATE_DIR } = require('./state-paths');

function _read(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (parsed && typeof parsed.theaters === 'object' && parsed.theaters) || {};
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[theaters] failed to read ${file}:`, e.message);
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

/**
 * @param {string} [override] one file to read instead of config/ + state/ (tests)
 * @returns {Record<string, {utcOffsetHours:number, transitionAltFt?:number, tmCentralMeridianDeg?:number,
 *   magneticVariation?:{fixedDeg?:number, offsetDeg?:number}}>} only entries with a finite offset;
 *   an invalid optional field is dropped with a warning, the rest of the entry kept
 */
function loadTheaters(override) {
  const layers = override
    ? [_read(override)]
    : [_read(path.join(CONFIG_DIR, 'theaters.json')), _read(path.join(STATE_DIR, 'theaters.json'))];
  if (!layers[0]) console.warn('[theaters] no theater table — every theater runs its mission clock on offset 0');
  const merged = {};
  for (const layer of layers) {
    for (const [name, entry] of Object.entries(layer || {})) {
      if (entry && typeof entry === 'object') merged[name] = { ...merged[name], ...entry };
    }
  }
  const out = {};
  for (const [name, entry] of Object.entries(merged)) {
    if (!Number.isFinite(entry.utcOffsetHours)) {
      console.warn(`[theaters] ${name} has no numeric utcOffsetHours — ignored`);
      continue;
    }
    const clean = { ...entry };
    if ('transitionAltFt' in clean && !(Number.isFinite(clean.transitionAltFt) && clean.transitionAltFt > 0)) {
      console.warn(`[theaters] ${name}: transitionAltFt is not a positive number — ignored`);
      delete clean.transitionAltFt;
    }
    if ('tmCentralMeridianDeg' in clean && !Number.isFinite(clean.tmCentralMeridianDeg)) {
      console.warn(`[theaters] ${name}: tmCentralMeridianDeg is not a number — ignored`);
      delete clean.tmCentralMeridianDeg;
    }
    if ('magneticVariation' in clean && !_validVariationOverride(clean.magneticVariation)) {
      console.warn(`[theaters] ${name}: magneticVariation must be exactly one of {fixedDeg} or {offsetDeg} — ignored, the model applies`);
      delete clean.magneticVariation;
    }
    out[name] = clean;
  }
  return out;
}

// What a theater the table does not list gets (and what a test fixture that
// injects no theater gets): the 18,000 ft every theater used before H62.
const DEFAULT_TRANSITION_ALT_FT = 18000;

module.exports = { loadTheaters, DEFAULT_TRANSITION_ALT_FT };
