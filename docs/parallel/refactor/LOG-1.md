# LOG-1: a logging system for crc-sync (the module and its wiring)

> Read `README.md` in this folder first. Ruling: R3-33, "Good logging is very important for debugging. If there
> currently is no sophisticated logging system, it's time to add one"; S-desk3 (a logging lane with or after the
> refactor). Plan: `docs/wip/ARCH-plan.md` §2.5.

| | |
|---|---|
| Wave | W3, after APP merged; beside BOARD-2, AUTH, DATA-1, DATA-2, CMSG, ESM-2a, ESM-2b |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-LOG-1` on `lane/LOG-1-logger` |
| ADR | **0097**, a logging system for crc-sync |
| Size / model | 0.5 lane / Sonnet 5.5 |

## Goal

`src/log.js` gives every module a named logger with levels and structured context. `createApp` configures the level
and the sink once. merge4's `src/log-level.js` (which wraps `console` by `LOG_LEVEL`) is absorbed, with its semantics
kept. LOG-2 (W4) converts the 135 `console.*` call sites. You convert only `server.js` and `src/app.js`.

## Owns

New `crc-sync/src/log.js`, `src/log-level.js` (removed once absorbed), `src/app.js` (logger setup in `createApp`
only), `server.js` (its own console calls), new `tests/log.test.mjs`, `docs/adr/0097-*.md`, `docs/wip/LOG-1.md`.

## Frozen for you

Every other `src/` file (LOG-2 converts them in W4), `.env.example` and compose (shared: if you believe a new
variable is needed, ask "main"; the default is none).

## Design

- `logger(name)` → `{ error, warn, info, debug, child(ctx) }`. Call shape: `log.info('message', { key: value })`.
  An `Error` in the context prints its stack. `child({ facilityId })` binds context.
- Levels `error < warn < info < debug`. `LOG_LEVEL` is read once in `createApp` (default `info`), and an invalid value
  warns once, exactly as `log-level.js` does today. atobrief and sourcedcs-web (INFRA2's `logger.js`) have the same
  semantics: match their line format if you can (read `atobrief/logger.js`).
- Output: one line per event, `<ISO time> <LEVEL> <name> <message> key=value …` on stdout (`error`/`warn` on stderr).
  Wall time in the line: logs are housekeeping (R3-16).
- Never log a bearer token, ticket or secret. Add a redaction for keys named `token`, `ticket`, `authorization` and
  `secret`. (This is hygiene, not auth hardening.)
- A test sink: `log.capture()` returns a recorder for tests, so tests stop patching `console`.
- Module-level loggers are created at require time but write nothing until configured. Before `createApp` configures
  them they default to `info` on the console, so tests that never call `createApp` still see warnings.

## Steps

0. Step 0 per README: `log-level.js` semantics, INFRA2's format, every test that patches `console` (count only; LOG-2
   converts them).
1. `log.js` + `tests/log.test.mjs`; absorb `log-level.js`.
2. `createApp` configures it. `server.js` and `app.js` use it.
3. ADR 0097: levels, format, context, redaction, the test sink, and what is deliberately not done (no remote shipping,
   no rotation; Docker handles stdout).

## Acceptance

Both suites green; golden identical (logs are not frozen); the boot test passes; ADR 0097 committed.
