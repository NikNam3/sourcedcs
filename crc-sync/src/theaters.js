'use strict';

// Fixed per-theater facts (docs/adr/0079): today each theater's local-time
// offset from Zulu, and later whatever else is a property of the map rather
// than a preference (magnetic variation, decisions.md H15 — hence one object
// per theater, not a bare number). Shipped in config/theaters.json; a copy in
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

/**
 * @param {string} [override] one file to read instead of config/ + state/ (tests)
 * @returns {Record<string, {utcOffsetHours:number}>} only entries with a finite offset
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
    if (Number.isFinite(entry.utcOffsetHours)) out[name] = entry;
    else console.warn(`[theaters] ${name} has no numeric utcOffsetHours — ignored`);
  }
  return out;
}

module.exports = { loadTheaters };
