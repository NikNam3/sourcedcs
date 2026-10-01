# 0097 — A logging system for crc-sync: named loggers with levels and structured context, one line per event, redaction by key, a test sink

## Context

crc-sync logged through 135 bare `console.*` calls in 36 files, each with its own hand-typed `[prefix]`. The only
control was merge4's `src/log-level.js`, which replaced the console methods by `LOG_LEVEL`. There was no context
(facility, session), no timestamp, no way to find the source of a line except its prefix, and tests that wanted to
assert a log patched `console` (12 files). The human asked for a proper logging system (R3-33, S-desk3).

## Decision

- `src/log.js`: `logger(name)` returns `{ error, warn, info, debug, child(ctx) }`. Call shape
  `log.info('persisted', { facilityId, ms })`. `child({ sessionId })` binds context; the call's own context wins on a
  clash. Loggers may be created at require time.
- Levels `error < warn < info < debug` from `LOG_LEVEL`, default `info`, an unknown value warns once and uses `info`:
  the semantics of `log-level.js`, atobrief and sourcedcs-web. `createApp` calls `configure({ level: env.LOG_LEVEL })`
  once. Before that, loggers run at `info` on the process streams, so code that never builds an app still warns.
- Format: one event per line, `<ISO time> <LEVEL> <name> <message> key=value ...`, `error` and `warn` on stderr, the
  rest on stdout. Strings with spaces are JSON-quoted. An `Error` in the context prints as `key="Name: message"` with
  its stack indented under the line. Time is wall time: logs are housekeeping (R3-16), not facts.
- Redaction (hygiene, not auth hardening): any context key containing `token`, `ticket`, `authorization` or `secret`
  (case-insensitive, nested up to three levels) is replaced by `[redacted]`, and its Error stack, if any, is not printed.
- Test sink: `log.capture()` records `{ level, name, message, ctx, line }` for every level, silences the stream, nests,
  and ends with `stop()`. Tests stop patching `console`.
- `src/log-level.js` is absorbed. Its console wrapper survives as `log.installConsole()`, which `server.js` calls,
  because the modules LOG-2 has not converted still call `console.*` and must stay gated by `LOG_LEVEL`. LOG-2 deletes
  `installConsole` with the last console call.

## Not done, on purpose

No remote shipping, no file output, no rotation (Docker handles stdout), no JSON output mode, no sampling or rate
limiting, no new environment variable, no per-module level. Each can be added behind `configure()` without touching
call sites.

## Consequences

Call sites move from `console.warn('[auth] ...', e.message)` to `log.warn('token exchange failed', { err })` (LOG-2).
`app.js` and the EFSP modules keep their console calls until then.
