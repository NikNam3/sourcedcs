'use strict';

// crc-sync's logger (ADR 0097). `const log = require('./log').logger('efsp:board')`, then
// `log.info('persisted', { facilityId, ms })`. Levels error < warn < info < debug (LOG_LEVEL,
// default info; same semantics as atobrief and sourcedcs-web). One line per event on stdout
// (error and warn on stderr): `<ISO time> <LEVEL> <name> <message> key=value ...`. An Error in the
// context prints its stack under the line. Values under keys that look like a secret are redacted.
//
// Loggers are cheap and may be created at require time. They read the configuration at call time, so
// until createApp calls configure() they log at info to the process streams. Tests use capture()
// instead of patching console. Wall time in the line: logs are housekeeping (R3-16), not facts.

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const DEFAULT_LEVEL = 'info';
const REDACT_KEY = /token|ticket|authorization|secret/i;
const REDACTED = '[redacted]';

/** @returns {{ level: string, valid: boolean }} */
function parseLevel(raw) {
  if (raw == null || String(raw).trim() === '') return { level: DEFAULT_LEVEL, valid: true };
  const v = String(raw).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVELS, v) ? { level: v, valid: true } : { level: DEFAULT_LEVEL, valid: false };
}

function defaultSink(rec) {
  (LEVELS[rec.level] <= LEVELS.warn ? process.stderr : process.stdout).write(rec.line + '\n');
}

const config = { level: DEFAULT_LEVEL, sink: defaultSink };
const captures = []; // innermost last
let warnedInvalid = false;

function warnInvalidOnce(raw) {
  if (warnedInvalid) return;
  warnedInvalid = true;
  emit('warn', 'log', `LOG_LEVEL=${JSON.stringify(String(raw))} is not error|warn|info|debug; using ${DEFAULT_LEVEL}`, undefined);
}

/**
 * Set the level and sink. Called once by createApp. `level` is a raw LOG_LEVEL value (an invalid one
 * warns once per process and falls back to info). Returns the resolved level.
 */
function configure({ level, sink } = {}) {
  const p = parseLevel(level);
  config.level = p.level;
  config.sink = sink || defaultSink;
  if (!p.valid) warnInvalidOnce(level);
  return p.level;
}

function resetForTests() {
  config.level = DEFAULT_LEVEL;
  config.sink = defaultSink;
  captures.length = 0;
  warnedInvalid = false;
}

function redact(key, value, depth = 0) {
  if (REDACT_KEY.test(key)) return REDACTED;
  if (value && typeof value === 'object' && !(value instanceof Error) && depth < 3) {
    if (Array.isArray(value)) return value.map((v) => redact('', v, depth + 1));
    const o = {};
    for (const [k, v] of Object.entries(value)) o[k] = redact(k, v, depth + 1);
    return o;
  }
  return value;
}

function fmtValue(v) {
  if (v instanceof Error) return JSON.stringify(`${v.name}: ${v.message}`);
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return /^[^\s"=]+$/.test(v) ? v : JSON.stringify(v);
  if (typeof v === 'object' && v !== null) { try { return JSON.stringify(v); } catch (_) { return '[unserializable]'; } }
  return String(v);
}

function emit(level, name, message, ctx) {
  const cap = captures.length ? captures[captures.length - 1] : null;
  if (!cap && LEVELS[level] > LEVELS[config.level]) return;
  const safe = {};
  const errors = [];
  if (ctx && typeof ctx === 'object') {
    for (const [k, v] of Object.entries(ctx)) {
      safe[k] = redact(k, v);
      if (v instanceof Error && v.stack && !REDACT_KEY.test(k)) errors.push(v.stack);
    }
  }
  let line = `${new Date().toISOString()} ${level.toUpperCase()} ${name} ${message}`;
  for (const [k, v] of Object.entries(safe)) line += ` ${k}=${fmtValue(v)}`;
  for (const s of errors) line += '\n' + s.split('\n').map((l) => '    ' + l.trim()).join('\n');
  const rec = { level, name, message: String(message), ctx: safe, line };
  if (cap) cap.records.push(rec);
  else config.sink(rec);
}

/** A named logger. `child(ctx)` binds context to every line (call context wins on a clash). */
function logger(name, bound) {
  const at = (level) => (message, ctx) => emit(level, name, message, bound ? { ...bound, ...ctx } : ctx);
  return {
    error: at('error'), warn: at('warn'), info: at('info'), debug: at('debug'),
    child: (ctx) => logger(name, { ...bound, ...ctx }),
  };
}

/**
 * Test sink: from now until stop(), every event of every level lands in `records`
 * ({ level, name, message, ctx, line }) instead of the stream. Captures nest.
 */
function capture() {
  const cap = {
    records: [],
    get lines() { return cap.records.map((r) => r.line); },
    clear() { cap.records.length = 0; },
    stop() { const i = captures.indexOf(cap); if (i >= 0) captures.splice(i, 1); },
  };
  captures.push(cap);
  return cap;
}

module.exports = { LEVELS, parseLevel, logger, configure, capture, resetForTests };
