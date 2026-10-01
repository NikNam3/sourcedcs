'use strict';

// LOG_LEVEL (concern O-5): error | warn | info | debug, default info.
//
// A thin wrapper over the console the code already logs to, so no call site
// changes: install() replaces console.error/warn/info/log/debug with versions
// that stay silent below the level. console.log counts as info. An unknown
// value falls back to info (and says so once, on the way). Pure of any
// dependency; the same pattern is for INFRA2's atobrief and sourcedcs-web.

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const DEFAULT_LEVEL = 'info';

// Which level each console method logs at.
const METHOD_LEVEL = { error: 'error', warn: 'warn', info: 'info', log: 'info', debug: 'debug' };

/** @returns {{ level: string, valid: boolean }} */
function parseLevel(raw) {
  if (raw == null || String(raw).trim() === '') return { level: DEFAULT_LEVEL, valid: true };
  const v = String(raw).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVELS, v) ? { level: v, valid: true } : { level: DEFAULT_LEVEL, valid: false };
}

/**
 * Wrap `target`'s logging methods for `level`. Returns a restore() function.
 * Methods the target lacks are skipped.
 */
function install(target = console, raw = process.env.LOG_LEVEL) {
  const { level, valid } = parseLevel(raw);
  const originals = {};
  for (const [method, at] of Object.entries(METHOD_LEVEL)) {
    if (typeof target[method] !== 'function') continue;
    originals[method] = target[method];
    if (LEVELS[at] > LEVELS[level]) target[method] = () => {};
  }
  if (!valid && originals.warn) originals.warn.call(target, `LOG_LEVEL=${JSON.stringify(String(raw))} is not error|warn|info|debug; using ${DEFAULT_LEVEL}`);
  return function restore() {
    for (const [m, fn] of Object.entries(originals)) target[m] = fn;
  };
}

module.exports = { LEVELS, DEFAULT_LEVEL, parseLevel, install };
