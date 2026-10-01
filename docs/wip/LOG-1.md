# LOG-1 (step 0, report follows at the end)

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
