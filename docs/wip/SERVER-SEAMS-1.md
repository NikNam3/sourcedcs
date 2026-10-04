# SERVER-SEAMS-1 (phase 3, crc-sync)

Branch `lane/SERVER-SEAMS-1-server-seams-1`. Server-only; no wire shape changed (`wire:record` not needed, the protocol test passes).
Tests: `npm test` 2433 -> 2439 (+1 `no-require-time-config`, +3 `efsp-regime-locator-wiring`, +1 state-paths env arg, +1 backoff
window, tokenizer/backoff tests rewritten in place); freeze 52/52; walk 23/23; `soak:selfcheck` PASS.

## What changed

1. **Clock injection.** `index.js` `_persist` takes the `wallClock` `createEfsp` already has; `CorrelationReconciler` takes `wallClock`
   (app.js passes `WALL_CLOCK`); the `wallNow` defaults in archiver, metrics, traffic-count, mutation-log are `WALL_CLOCK.now`
   (`src/mission-clock.js`, outside `src/efsp`). The clock allow-list in `tests/clock-policy.test.mjs` is **empty**: the next bare
   `Date.now()` under `src/efsp` fails the test. Not under that scan, still bare: `collab-store.js` (`at: Date.now()` twice),
   `auth.js`, `atis-store.js`, `tracks.js`, `ws-hub.js` (`time:`, `_missionId`), `srs-client.js`, `grpc-client.js`, `app.js` (weather
   `updatedAt`, `conflictAlertMonitor.tick(Date.now())`), `conflict-alert.js`/`coverage.js`/`datalink.js` default `now`.
2. **Config read when built, not when required.**
   - `facility-config.js` is `createFacilityConfig({ env })` (eager, strict, no module state). `createApp` builds one and passes it to
     `createEfsp({ facilityConfig })`, to PositionCoverage, the instrumentation, the monitors. `createEfsp` builds one from its `env` if
     none is passed. The facade returns `facilityConfig` and `stereoRoutes`.
   - `stereo-routes.js` -> `createStereoRoutes({ env })` (FlightDataStore takes it); `apt-config.js` -> `createAptConfig({ env })` (WsHub
     takes `aptConfig`); `iff.js` -> `ownCoalitionFrom(env)` + `DEFAULT_OWN_COALITION` (Transponders, DatalinkFeed, PositionCoverage,
     createSurveillance take `ownCoalition`); `terrain.js`, `radars.js` (`loadSensorSpecs(path, env)`), `theaters.js`
     (`loadTheaters(path, env)`), `mission-session.js`, `collab-store.js`, `mutation-log.js`, `metrics.js`, `traffic-count.js` take `env`.
   - `state-paths.js` exports `dirs(env)`; `readPath/writePath/statePaths` take an optional trailing `env`. `CONFIG_DIR`/`STATE_DIR` are gone.
   - **The authority layer was the hidden consumer** of the singleton (D12's strip-back ran at require time). `permission.js`'s
     class-dependent predicates are `createPermission({ classOf })` -> `{ PERMISSIONS, canMutate, canMutateAction, canCorrelate,
     canDeclareMarsa }`; `authority.permissionsFor(classOf)`, `authority.airspaceRowFor(id, classOf)`, `classes.js` predicates take `classOf`.
     The wire families reach it through `ctx.permission`. Module-level `permission.canMutate` etc. no longer exist.
   - Lazy on first use (still a process cache, but no require-time read): `instrumentation-config` (`getInstrumentationConfig`,
     `defaultInstrumentationConfig`), `surveillance-hints-config` (`getHintsConfig`, `defaultHintsConfig`), `theaters`
     (`defaultTransitionAltFt()`), `synthetic-block` (`syntheticBlock()`; Transponders now reads its block from its own config),
     `carrier/hull-config`, `carrier/flight-record` (`approachTypes()`, `commCard()`).
   - `createApp({ env })` now means it: the injected env is the whole environment. A test or tool that passed `env: {}` and relied on
     process.env paths must pass `{ ...process.env }` (done for app-boot, airspace-service, client-config, the soak host).
   - New guard `tests/no-require-time-config.test.mjs`: requires the config modules with missing dirs, expects success and no files.
3. **Late-bound hooks.** `setMutationLog` is gone: the Board and the six audited stores take `mutationLog` in their constructor
   (stores.js builds them with it; the registry's `audited` flag is deleted). The mission session is built before `createEfsp`, so
   `theaterSource` is a closure over it. `setRegimeLocator` is gone: `createEfsp({ locateTrack })` builds the locator inside
   (`efsp.regimeLocator`; the TOFI monitor uses it). A `createEfsp` with no `locateTrack` logs an **error once** at the first regime
   question (test: `efsp-regime-locator-wiring`). The control-invariant mode is read from `createEfsp`'s env.
4. **Test carry-overs.** The two scenario walks use a stepped wall clock (goldens `scenarios.json`, `scenario-runway-status.json`
   re-recorded alone: only wall-derived stamps and their hashes moved); `ato tokenize` asserts linear scaling (4x input < 10x time,
   best of 3) instead of a 1 s budget; the grpc backoff tests assert on the delays the client computed (`trackBackoff`), a pure
   window test uses a scripted `random` (new `GrpcClient` option); shared `tests/helpers/{ws,wait,permission}.mjs`, `freshEfsp`,
   `freshStrip`. The `guard-board-surface` golden lost `setMutationLog` (own commit).

## Defaults taken

- A `createEfsp()` / `new WsHub()` / `new FlightDataStore()` with no config dependency builds its own from `process.env` at
  construction (50+ tests do this), so the tests did not all have to change. The composition root passes everything explicitly.
- `locateTrack` omitted = log an error once, answer unlocated (not a throw), because 40+ fixtures have no track store.
- The terrain cache default now follows `CRCSYNC_STATE_DIR` (`<state>/terrain-cache`); same path as before when unset.
- Lazy-on-first-use for the tuning readers above rather than a factory each (a factory per tuning file is the same change 8 more times).

## Not done / for SERVER-SEAMS-2

- `createApp` and `createEfsp` are still the two god functions; the remaining late setters need the split to disappear:
  `efsp.archiver.setIsCounted`, `nlaStatusMonitor.setOnDelta`, `wsHub.setOnEfspChange`, `efsp.setAbsentCheck` (hub -> positionStore),
  `flightDataStore.setWriteObserver`, `board.setAirborneObserver`. They are cycles (hub <-> efsp), not just ordering.
- `app.js` `_missionId` / `Date.now()` sites above; `audited` is gone from the registry, so `stores.js`'s header comment lists fewer fields.
- Hand-set env blocks (`CRCSYNC_EFSP_*_PATH` + `process.env[k] = ...`) are still copy-pasted in ~50 test files; they now work either
  way. A `helpers/env.mjs` `withPaths(dir)` would replace them; a mechanical rewrite, not done. `fakeWs`, `fresh()` and `sleep/until`
  are deduped; the 45/53 `efsp-scenario.mjs` stragglers (`efsp-scenarios.test.mjs` and `efsp-scenario-marsa` keep local `crew`/`mustAct`) are not.
- `collab-store.test.mjs:70` (80 ms) and `airspace-service.test.mjs:200` (150 ms) real waits (ARCH-S 5c) untouched.
- The `held-open unit stream` test still sleeps 5 s for real.
- `COMM_CARD`/`hulls()`/`approachTypes()` are lazy but memoised per process; `loadCommCard(override = process.env...)` still reads
  process.env, not the injected env.

## Findings for other lanes

- SEAMS: `booking-lookup.js:17,19`, `airspace-schema.js:244` (`loadStandingList` default path), `board-store.js` none left,
  `grpc-client.js:18,19` and `srs-client.js:8` still read `process.env` at require time (their env names are SEAMS').
  `grpc-client.js` got one new option (`random`) from this lane.
- DESK-ACKS: untouched (`efsp-ws.js` only gained `ctx.permission` use in the wire families).
- `tools/soak/host-core.js` now passes `env: process.env` to `createApp` (was `{}`); it read `facilityConfig` from the module, now `efsp.facilityConfig`.
