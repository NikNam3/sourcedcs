'use strict';
// Leveled wrapper over console. LOG_LEVEL=error|warn|info|debug (default info);
// an unknown value falls back to info. Same variable and semantics in all three
// services (levels are cumulative: debug prints everything, error only errors).
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function parseLevel(raw) {
  const v = String(raw == null ? '' : raw).trim().toLowerCase();
  return v in LEVELS ? v : 'info';
}

function createLogger(raw, sink) {
  sink = sink || console;
  const level = parseLevel(raw);
  const max = LEVELS[level];
  const out = (name, fn) => (LEVELS[name] <= max ? (...a) => fn.apply(sink, a) : () => {});
  return {
    level,
    error: out('error', (...a) => sink.error(...a)),
    warn: out('warn', (...a) => sink.warn(...a)),
    info: out('info', (...a) => sink.log(...a)),
    debug: out('debug', (...a) => sink.log(...a)),
  };
}

const logger = createLogger(process.env.LOG_LEVEL);
logger.createLogger = createLogger;
logger.parseLevel = parseLevel;
module.exports = logger;
