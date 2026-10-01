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
// The defaults are the shipped config/efsp-instrumentation.json (read by
// tuning-file.js, strictly: a missing or invalid shipped file is a startup
// error naming it; no literal copy lives in code, H88 / DATA-2).
// Invalid values warn and fall back to the default PER FIELD: a typo in one
// retention must neither stop the server nor silently mean "keep forever".

const fs = require('fs');
const { readPath } = require('../state-paths');
const { readShipped } = require('../tuning-file');
const log = require('../log').logger('efsp:instrumentation-config');

const CONFIG_NAME = 'efsp-instrumentation.json';

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

// Strict mode (validating the shipped file itself): no fallback, so a gap is an error.
function _missing(what, fallback, source) {
  if (fallback === undefined) throw new Error(`[efsp-instrumentation] ${source}: ${what} is missing`);
  return fallback;
}

function _retention(section, raw, fallback, source) {
  if (raw === undefined) return _missing(`${section}.retentionDays`, fallback, source);
  if (Number.isInteger(raw) && raw >= 1) return raw;
  if (fallback === undefined) throw new Error(`[efsp-instrumentation] ${source}: ${section}.retentionDays must be an integer >= 1, got ${JSON.stringify(raw)}`);
  log.warn('retentionDays must be an integer >= 1 — using the fallback', { source, section, got: raw, fallback });
  return fallback;
}

function _homeAirports(raw, fallback, source) {
  if (raw === undefined) return _missing('trafficCount.homeAirports', fallback, source);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    if (fallback === undefined) throw new Error(`[efsp-instrumentation] ${source}: trafficCount.homeAirports must be an object of facilityId -> [ICAO]`);
    log.warn('trafficCount.homeAirports must be an object of facilityId -> [ICAO], using the default', { source });
    return fallback;
  }
  const out = {};
  for (const [facilityId, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) {
      log.warn('trafficCount.homeAirports entry is not a list — that Facility gets no home airport', { source, facilityId });
      continue;
    }
    const codes = list.filter(c => typeof c === 'string').map(c => c.trim().toUpperCase()).filter(Boolean);
    if (codes.length !== list.length) {
      log.warn('trafficCount.homeAirports entry has values that are not airport codes — ignored', { source, facilityId });
    }
    out[facilityId] = [...new Set(codes)];
  }
  return out;
}

/**
 * Validates a parsed config object field by field against the defaults.
 * Pure apart from log.warn; exported so tests need no file.
 */
function normalizeInstrumentationConfig(raw, source = 'config', d = DEFAULT_INSTRUMENTATION_CONFIG) {
  d = d || { mutationLog: {}, metrics: {}, trafficCount: {} }; // strict: validating the shipped file
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

/** The shipped defaults, validated strictly. Throws (naming the file) when it is missing or has a gap. */
const DEFAULT_INSTRUMENTATION_CONFIG = normalizeInstrumentationConfig(readShipped(CONFIG_NAME), `config/${CONFIG_NAME}`, null);

/** Reads and validates one file. A missing or unparseable file is the shipped defaults, with a warning. */
function loadInstrumentationConfig(filePath = resolveInstrumentationConfigPath()) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    log.warn('could not read file — using the shipped defaults', { file: filePath, error: e.message });
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
