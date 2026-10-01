# APP report (lane APP, branch `lane/APP-create-app`, base `b0f273f`) -- INCOMPLETE: the permitted merge was denied

```
fade783 refactor(APP): the soak host builds the service through createApp
0338f48 test(APP): app-boot test, ticker names and periods, start/stop leave no handle
5127e5b refactor(APP): createApp(deps) in src/app.js, server.js thin
dcc5c9e wip(APP): step 0, base counts and code as found
```
- STATUS: the supervisor-permitted `git merge efsp-wp5-correlation` was DENIED by the harness's auto-mode classifier ([Modify Shared
  Resources]). Not retried or worked around. Everything not needing the merge is done and green; the merge-dependent items below are open.
- Suites (pre-merge tree): crc-sync 2092 -> 2095 (+3 app-boot). Full run showed 4 failures, all timing tests under load: `ato tokenize
  pathological inputs`, two `grpc-client` backoff tests, `test-reset` "real server without the env var"; the last two failed the same way
  at base, the grpc one failed again alone (same as base), test-reset passed alone. crc-desktop 866 (865 pass, 1 todo), untouched.
- Golden: identical, freeze 47/47, no `freeze:update`. `soak:smoke` PASS (memory not judged), `soak:selfcheck` PASS (all 5 detectors fire).
  `freeze:selfcheck` not run (no mutation retargeted: M5/M13/M17 sit in efsp-ws/ws-hub, untouched by me). No Playwright.
- Line counts: server.js 745 -> 21; src/app.js 811 (new); host-core.js 518 -> 443 (-75, and no monitor/instrumentation/archiver wiring left).
- Structure fixtures: none changed. Files outside "Owns": `tests/efsp-alerts-compose.test.mjs`, `tests/theater-context.test.mjs`,
  `tests/efsp-ui-b-hooks.test.mjs` (three static tests that read `server.js` as text now read `src/app.js`; same assertions).
- Tickers (name, ms): datalink-locks (sensorSpecs lockPollMs), coverage 250, clock-source 5000, airport-weather 60000 (was created inside the
  mission-load handler; now fixed-phase, ticks `lastMissionData`), efsp-metrics 60000, efsp-archiver 60000 (returns Strips archived),
  stale-reaper 5000, obligations-nla 15000, correlation CORRELATION_TICK_MS (returns the reconciler result), carrier 1000, conformance-stca 1000.
- Defaults taken: S-APP0 (1)-(3) per supervisor. `trackSeams = {beacon, callsign, gridToMagnetic}` is a real createApp dep and cost no golden
  change, so no instance-method wrapping was needed for those. `src/test-reset.js` is required lazily, only when CRCSYNC_TEST_RESET=1: its
  load-time `crypto.randomUUID()` shifted the soak's seeded id stream (every boardEpoch in the goldens). Same refusals, same mount.
  The soak's `obligationAlerts` sample field is now a constant 0 (the monitor ignores `onAlert` since ADR 0067).
- BOARD-1 note: the soak host's `bs._rebalanceRack` wrap by name is unchanged and still works on the current tree.
- OPEN (need the merge): (a) pass `paths` from createApp to `createEfsp`; (b) retire `BOARD_SNAPSHOT_PATH` export with host-core and
  `freeze-recorder.mjs` in one commit; (c) drop the `typeof wsHub.stop` guard in `src/app.js` and the stop shim in `tests/app-boot.test.mjs`;
  (d) check host-core against `broadcasts[]` (it never read the old named keys: grep finds none) and keep DATA-1's writeFixtures behaviour
  (I did not touch `host-client.js`); (e) re-run the gate and the final suites on the merged tree.
- Findings: the soak hub runs without the hint monitor and airborne observer, so production wiring there is unexercised; enabling it changes
  `efsp-alerts` frames (`surveillance: []`) and the departure gate: a candidate for a later approved `behaviour(...)` commit, not this lane.
  Also: the real hub now describes soak tracks through the real identity/transponder models (non-efsp frames only; goldens unaffected).

# APP working file

## Step 0: base check (base `b0f273f`, installed with `npm ci` in all three packages)

| Suite | Count at base |
|---|---|
| crc-sync `npm test` | 2092 tests, 2090 pass; 2 timing failures under load (`grpc-client` retry-delay test, `test-reset` "real server without the env var"); the second passed alone (6/6), the first is a jitter-timing test |
| crc-desktop `npm test` | 866 tests, 865 pass, 1 todo |
| freeze (`node --test tests/freeze/freeze-*.test.mjs`) | 47 / 47 |

`server.js` is 745 lines. `tools/soak/host-core.js` 518 lines.

## Code as found (by symbol)

server.js, in file order:
- 7 mid-file requires: `mission-session` (`MissionSession`), `efsp/metrics` (`createEfspInstrumentation`), `efsp/archiver` (`archiveDeltas`),
  `efsp/carrier-tick` (`CarrierTick`), `efsp/efsp-ws` (`carrierDelta`), `surveillance/iff` (`USER_COALITION`), `collab-wiring`
  (`wireCollabSession`, inline), and `test-reset` (`mountTestReset`, inline) — 7 hoistable plus the inline one.
- 11 `setInterval`s: datalink lock poll (`sensorSpecs.datalink.lockPollMs`), coverage (250 ms, `COVERAGE_TICK_MS`), clock-source (5000),
  airport-weather (60000, created and cleared inside the mission-load handler), instrumentation (60000), archiver sweep (60000),
  stale reaper (5000), obligations + NLA (15000), correlation (`CORRELATION_TICK_MS`), carrier (1000), conformance/STCA/hints (1000).
- `grpcClient.on`: `unit`, `gone`, `mission-start`, `mission-load` x2 (session first, then the big one), `status`, `weather`, `game-time` x2,
  plus `collab-wiring`'s own (`wireCollabSession`, which must come after the handlers it orders against); `srsClient.on('status')`.
- Routes: `GET /js/config.js`, `OPTIONS`/`POST /api/auth/token`, `POST /api/ws-ticket`, `POST /api/atis-transmit`, `GET /api/srs-clients`,
  `/api/flight-plan-lookup/:callsign`, `/api/flight-plan-list`, `/api/stereo-routes`, `/api/magnetic/to-true`, `/api/apt-weather`,
  `/api/efsp/metrics`, `/api/efsp/traffic-count`, then test-reset mount, then `express.static(PUBLIC_DIR)`.
- Forward references: the mission-load closure -> `correlationReconciler`; `efspInstrumentation` getters -> `correlationReconciler`,
  `obligationMonitor`; `broadcastEfspAlerts` (function declaration) -> monitors; `currentRadars` -> `wsHub`; `deriveActiveRunwaysFromWind`.
- Static tests that read `server.js` as text: `efsp-alerts-compose`, `theater-context` (apt-weather route), `efsp-ui-b-hooks`; they retarget to `src/app.js`.

host-core.js re-implements: the hub without `attach`, TrackStore/CollabStore, the metrics tap, the obligations / correlation / conformance /
STCA monitors, `broadcastAlerts`, `setOnEfspChange`, `nlaStatusMonitor.setOnDelta`, the archiver sweep, the reaper's body. It keeps (soak-only):
fake sockets, per-command capture, `uncarried` accounting, squawk map, structure counts, fault injection.
`freeze-world.mjs` imports `createHost` (`{handle, shutdown}`) from host-core and `setupHostEnv` from host-env; `host.js` the same.

## Findings that shape the design

- The soak hub has no surveillance hint monitor: the goldens' `efsp-alerts` frames carry `{conformance, stca, obligations}` only and no
  Board has an airborne observer. Wiring everything would add `surveillance: []` and change the departure gate, so `createApp` takes
  `surveillanceHints: null` to leave that monitor out (default taken, below).
- The soak's `MissionSession` is in-memory (`path: null`); `createApp` takes a `missionSession` override for the same reason.
