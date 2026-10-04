# SERVER-TIDY

Done:
1. `crc-sync/tests/helpers/with-paths.mjs` (`withPaths(prefix, {ENV: file}, {stateDir, shippedConfig, extraEnv})`, presets `FACILITIES`, `BOARD`, `MUTATION_LOG`, `AIRSPACES`, `APP_PATHS`): `.env` is a copy for `createApp/createEfsp/createFacilityConfig({env})`; `.apply()` sets process.env for modules that still read it and restores + removes the dir at exit. 26 test files converted, no assertion changed. Only keys a test named are set (a preset-wide default would change fallbacks).
2. Real waits: collab-store grace uses `t.mock.timers`; airspace-service waits on a same-theater sentinel delta instead of 150 ms; grpc held-open test uses `backoffBaseMs: 50` + 500 ms (was 5 s), mutation-checked (still fails if the stream is ended).
3. `crc-desktop/scripts/sync-lxsrs.sh` now passes `--upgrade` (checked in a temp git copy: a drifted vendored `__init__.py` is refreshed; dist-info RECORD/WHEEL/direct_url.json also change on every run). The real `python-pkg/` was NOT re-synced (check-lxsrs-sync stays the arbiter).
4. ARCH-S 2b, partial: the SFA logic left the rules bag (`sfa.js` `frequencyForRack`/`rackForFrequency`/`isSfaBay`, test `efsp-sfa-model.test.mjs`). NOT done: passing `facilityView`/modules instead of closures: it changes the Board's rule contract (every `rules.x(...)` call site, `required-rules.js`, hand-built bags in tests), and CONSOL-S edits facility config/authority/fixtures in parallel.

Defaults taken: none needing a decision.
