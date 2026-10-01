# LOG-1 report (branch lane/LOG-1-logger, base 457397d, ADR 0097)

```
905ecb4 feat(LOG-1): src/log.js (levels, context, redaction, capture), createApp configures it, log-level.js absorbed, ADR 0097
91fc2b9 wip(LOG-1): step 0, code as found
```
(plus the docs commit with this report)
- Suites: crc-sync 2101 (APP's merged count) -> 2130 tests, 2127 pass, 1 todo; the 2 fails are the grpc-client-stream backoff timing tests, which also fail alone at base 457397d under this machine's load (known load-timing, not LOG-1). crc-desktop 866 (865 pass, 1 todo), unchanged. log.test.mjs 10 tests replace log-level.test.mjs.
- Golden: identical, 47/47, no freeze:update. No selfcheck/soak (no gated file touched), no Playwright.
- Built: src/log.js (logger(name) with error/warn/info/debug/child, configure, capture() test sink, redaction of keys containing token|ticket|authorization|secret, Error stacks, one-line ISO format, error/warn on stderr); createApp calls configure({level: env.LOG_LEVEL}); server.js uses it; src/log-level.js and its test removed, absorbed as log.installConsole().
- Structure fixtures: none changed. Files outside Owns: none (tests/log.test.mjs, docs/adr/0097 are owned).
- Defaults taken (P2): (1) installConsole kept (server.js calls it) so unconverted console.* calls stay gated by LOG_LEVEL until LOG-2; LOG-2 deletes it with the last console call. (2) app.js's 11 console calls left for LOG-2 (briefing scopes app.js to logger setup). (3) No new env var, no JSON mode. (4) Redaction is substring/case-insensitive and nested to depth 3. (5) Invalid LOG_LEVEL warns once per process across configure and installConsole.
- Findings for LOG-2: 134 console calls in 36 src files, 12 test files patch console (use log.capture()); createApp re-calls configure on every build, so tests that build several apps reset level/sink to env's; a capture() in effect overrides the sink. The output of server.js's listen line changed from "[crc-sync] http://localhost:PORT" to the structured line; nothing greps it.
- Supervisor decisions: none. Questioner points: none received.
# LOG-1

## Code as found (base 457397d)
- `crc-sync/src/log-level.js`: `LEVELS`, `parseLevel`, `install(target, raw)` wraps console.error/warn/info/log/debug; unknown value warns once and uses info. Only user: `server.js` line 3 and `tests/log-level.test.mjs`.
- `server.js` (21 lines): one console call, `console.log('[crc-sync] http://localhost:PORT')`.
- `src/app.js`: `createApp(deps)` at ~112; 11 console calls (auth 158/166, weather 290, field-state 321/335/338, archiver 399, flight-plan 542/558/575, tracks 664, mission 733). `stop()` ~789.
- atobrief `logger.js` (INFRA2): plain wrapper, no line format, same LEVELS and parseLevel (unknown -> info, silently).
- Console in src: 134 calls in 36 files. Tests patching console: 12 files (counted only; LOG-2 converts).
- No golden or test captures console output (freeze `consoleCounters` are error counters, not output).
- Clock policy scans only src/efsp, so wall time in src/log.js is fine (R3-16).

## Defaults taken
- Unconverted modules still call console until LOG-2, so `log.js` keeps the absorbed console wrapper as `installConsole()`; server.js calls it (as it called log-level before). Removed by LOG-2 when no console calls remain.
- app.js's 11 console calls are NOT converted (briefing scopes app.js to logger setup only; LOG-2 owns them).
