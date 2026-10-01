'use strict';

// The thresholds behind "detected airborne" and staleness (docs/adr/0076).
//
// A TUNING FILE (decisions.md P5): read ONCE, at module load, never written by
// code. A change applies on restart. Invalid values warn and fall back to the
// default PER FIELD. None of these is doctrine: guide §10.4 says only "a
// configured threshold".

const fs = require('fs');
const { readPath } = require('../state-paths');

const CONFIG_NAME = 'efsp-surveillance-hints.json';

const DEFAULT_HINTS_CONFIG = Object.freeze({
  airborne: Object.freeze({ minGroundSpeedKt: 60, minAglFt: 200, holdSec: 5 }),
  staleness: Object.freeze({ afterSec: 120 }),
});

function _num(section, key, raw, fallback, source, { min }) {
  if (raw === undefined) return fallback;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= min) return raw;
  console.warn(`[efsp-surveillance-hints] ${source}: ${section}.${key} must be a number >= ${min}, got ${JSON.stringify(raw)} — using ${fallback}`);
  return fallback;
}

function normalizeHintsConfig(raw, source = 'config') {
  const d = DEFAULT_HINTS_CONFIG;
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const sec = (n) => (obj[n] && typeof obj[n] === 'object' ? obj[n] : {});
  return Object.freeze({
    airborne: Object.freeze({
      minGroundSpeedKt: _num('airborne', 'minGroundSpeedKt', sec('airborne').minGroundSpeedKt, d.airborne.minGroundSpeedKt, source, { min: 1 }),
      minAglFt: _num('airborne', 'minAglFt', sec('airborne').minAglFt, d.airborne.minAglFt, source, { min: 0 }),
      holdSec: _num('airborne', 'holdSec', sec('airborne').holdSec, d.airborne.holdSec, source, { min: 0 }),
    }),
    staleness: Object.freeze({
      afterSec: _num('staleness', 'afterSec', sec('staleness').afterSec, d.staleness.afterSec, source, { min: 1 }),
    }),
  });
}

function loadHintsConfig(filePath = readPath(CONFIG_NAME, process.env.CRCSYNC_EFSP_SURVEILLANCE_HINTS_PATH)) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.warn(`[efsp-surveillance-hints] could not read ${filePath} (${e.message}) — using the built-in defaults`);
    return DEFAULT_HINTS_CONFIG;
  }
  return normalizeHintsConfig(raw, filePath);
}

// Once, at load (P5).
const HINTS_CONFIG = loadHintsConfig();

function getHintsConfig() { return HINTS_CONFIG; }

module.exports = { DEFAULT_HINTS_CONFIG, getHintsConfig, loadHintsConfig, normalizeHintsConfig };
