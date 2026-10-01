# LOG-2 report (branch lane/LOG-2-call-sites, base 0bfe9d3)

COMMITS_PLACEHOLDER

- Suites: crc-sync 2130 -> 2144 tests (LOG-1 2130; count differs from tests added by merged lanes), 2141 pass, 1 todo; the 2 fails (grpc-client-stream backoff, ato tokenize timing) pass alone (103/103). crc-desktop 866 (865 pass, 1 todo), unchanged.
- Golden: identical, 47/47 after every commit, no freeze:update. Selfcheck: soak:selfcheck PASS (clean, drop-ack, drop-broadcast, leak, skip-shadow-client). No Playwright.
- Built: every console.* call in crc-sync/src (131 sites, 36 files) is now `log.<level>(message, context)` on a module logger (`efsp:archiver`, `grpc`, `srs`, `ws-hub`, `efsp:metrics`, ...); ids moved from the string into the context. 12 tests that patched console now use `capture()`. `installConsole()` and its two tests deleted (one replaced by a configure() invalid-level test); server.js no longer calls it.
- Levels: kept as the old method meant (log->info, warn->warn, error->error). **Demotions (S-LOG2-0): exactly one**: grpc-client.js "navpoints raw" dump, info (console.log) -> debug. No promotions. Startup/connect/reconnect/stream-state/mission/persist lines all stay info or warn.
- Remaining console calls: `src/efsp/surveillance-hints.js:140` (console.error, TIME-B owns the file). It is error level, so LOG_LEVEL never hid it; installConsole is gone regardless. Supervisor: convert it when TIME-B merges (`log.error('staleness log failed', { err: e })`, logger `efsp:surveillance-hints`). conformance.js has no console calls.
- board-store.js: one call, own commit (the last `refactor` one); redo after BOARD-3 if it conflicts (one line + one require).
- Soak (tools/soak, in Owns): host-env.js now installs a log sink (level debug) feeding the same consoleStats/internalErrors counters, keyed `level [logger] message`; host-core.js calls `env.configureLog()` after createApp (createApp re-configures and would reset the sink); host-client.js keeps src/log.js in the require cache across an in-process restart. Console capture kept for the one leftover call.
- Edits outside literal "call line": grpc-client.js dropped the `when` local that only fed the old string (delay is now context `retryInMs`); instrumentation-config.js comment "Pure apart from console.warn" -> "log.warn"; tests/log.test.mjs lost the installConsole tests.
- Structure fixtures: none changed. Files outside Owns: none beyond tests/log.test.mjs (LOG-1's test of the deleted function).
- Defaults (P2): wording kept minus ids; logger name = module (app.js uses auth/weather/field-state/efsp:archiver/... per call site); `req`/`res` Transmit objects passed as context.
- Findings: grpc-client-stream backoff and "ato tokenize pathological inputs" fail under load, pass alone (known timing). Redaction would hide any ctx key containing token/ticket/secret/authorization; none of the converted contexts uses one.

## Call-site table
Per-file mapping is the diff itself (git show per commit); levels unchanged except the one demotion above.
