'use strict';

// WP8's policy knobs (docs/adr/0065): how long the Mutation log, the metric
// hour buckets and the traffic-count records are kept, and which airfields are
// "home" to each Facility for the §11.4 local/transient split.
//
// Every value here is a SOURCE policy choice, not doctrine. Guide §11.3 is
// explicit that the audit retention must be configurable rather than encode
// any one number; 30 days is ours.
//
// A TUNING FILE (decisions.md P5): read ONCE, at module load, and never
// written by code. A change applies on restart only. There is deliberately no
// endpoint that sets any of it.
//
// Invalid values warn and fall back to the default PER FIELD: a typo in one
// retention must neither stop the server nor silently mean "keep forever".

const fs = require('fs');
const { readPath } = require('../state-paths');

const CONFIG_NAME = 'efsp-instrumentation.json';

const DEFAULT_INSTRUMENTATION_CONFIG = deepFreeze({
  mutationLog: { retentionDays: 30 },
  metrics: { retentionDays: 30 },
  trafficCount: {
    retentionDays: 400,
    homeAirports: { INCIRLIK: ['LTAG'] },
  },
});

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/** state/ override wins, else the shipped default in config/ — resolved per call (see state-paths.js). */
function resolveInstrumentationConfigPath() {
  return readPath(CONFIG_NAME, process.env.CRCSYNC_EFSP_INSTRUMENTATION_CONFIG_PATH);
}

function _retention(section, raw, fallback, source) {
  if (raw === undefined) return fallback;
  if (Number.isInteger(raw) && raw >= 1) return raw;
  console.warn(`[efsp-instrumentation] ${source}: ${section}.retentionDays must be an integer >= 1, got ${JSON.stringify(raw)} — using ${fallback}`);
  return fallback;
}

function _homeAirports(raw, fallback, source) {
  if (raw === undefined) return fallback;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    console.warn(`[efsp-instrumentation] ${source}: trafficCount.homeAirports must be an object of facilityId -> [ICAO], using the default`);
    return fallback;
  }
  const out = {};
  for (const [facilityId, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) {
      console.warn(`[efsp-instrumentation] ${source}: trafficCount.homeAirports.${facilityId} is not a list — that Facility gets no home airport`);
      continue;
    }
    const codes = list.filter(c => typeof c === 'string').map(c => c.trim().toUpperCase()).filter(Boolean);
    if (codes.length !== list.length) {
      console.warn(`[efsp-instrumentation] ${source}: trafficCount.homeAirports.${facilityId} has entries that are not airport codes — ignored`);
    }
    out[facilityId] = [...new Set(codes)];
  }
  return out;
}

/**
 * Validates a parsed config object field by field against the defaults.
 * Pure apart from console.warn; exported so tests need no file.
 */
function normalizeInstrumentationConfig(raw, source = 'config') {
  const d = DEFAULT_INSTRUMENTATION_CONFIG;
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const section = (name) => (obj[name] && typeof obj[name] === 'object' ? obj[name] : {});
  return deepFreeze({
    mutationLog: { retentionDays: _retention('mutationLog', section('mutationLog').retentionDays, d.mutationLog.retentionDays, source) },
    metrics: { retentionDays: _retention('metrics', section('metrics').retentionDays, d.metrics.retentionDays, source) },
    trafficCount: {
      retentionDays: _retention('trafficCount', section('trafficCount').retentionDays, d.trafficCount.retentionDays, source),
      homeAirports: _homeAirports(section('trafficCount').homeAirports, d.trafficCount.homeAirports, source),
    },
  });
}

/** Reads and validates one file. A missing or unparseable file is the defaults, with a warning. */
function loadInstrumentationConfig(filePath = resolveInstrumentationConfigPath()) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.warn(`[efsp-instrumentation] could not read ${filePath} (${e.message}) — using the built-in defaults`);
    return DEFAULT_INSTRUMENTATION_CONFIG;
  }
  return normalizeInstrumentationConfig(raw, filePath);
}

// Once, at load (P5).
const INSTRUMENTATION_CONFIG = loadInstrumentationConfig();

function getInstrumentationConfig() { return INSTRUMENTATION_CONFIG; }

module.exports = {
  DEFAULT_INSTRUMENTATION_CONFIG,
  getInstrumentationConfig,
  loadInstrumentationConfig,
  normalizeInstrumentationConfig,
  resolveInstrumentationConfigPath,
};
