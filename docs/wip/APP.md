# APP report (lane APP, branch `lane/APP-create-app`, base `b0f273f`, STORES+WIRE merged by the supervisor as bf3eb48)

```
7f5beae refactor(APP): createApp passes paths to createEfsp; BOARD_SNAPSHOT_PATH export retired; wsHub.stop guard dropped
bf3eb48 Merge efsp-wp5-correlation into lane/APP-create-app (STORES, WIRE)
fbd405f docs(APP): report, merge-dependent items open
a185f9b docs(parallel): S-DATA1-0
90b56a8 docs(parallel): S-M-WIRE, S-DESK4, S-W3early
e2cd0fa Merge lane/DESK4-amend: post-refactor drafts follow H100
ee70c9d docs(DESK4): apply H100 to the post-refactor drafts
3bc1c73 Merge lane/WIRE-families: one wire skeleton, family registry, broadcasts[] in SLOT_ORDER, WsHub.stop()
5583886 refactor(WIRE): crc-desktop wire scanners read the registry; report, how-to-add note, skeleton tests
a42cfb3 refactor(WIRE): one skeleton, a family registry, broadcasts[] in SLOT_ORDER; WsHub.stop()
f9e806a docs(parallel): S-BOARD1-1
0d0298a docs(parallel): S-M-STORES
fade783 refactor(APP): the soak host builds the service through createApp
35f56e3 Merge lane/STORES-registry: persisted-store registry, call-time snapshot paths
ebb4fc7 docs(parallel): S-ESM1d
a85209c docs(STORES): report
c1527b3 docs(STORES): report
0338f48 test(APP): app-boot test, ticker names and periods, start/stop leave no handle
241dbc7 docs(parallel): S-BOARD1-0
28ca472 refactor(STORES): retarget M9 to the registry order
5127e5b refactor(APP): createApp(deps) in src/app.js, server.js thin
d095992 docs(parallel): H100 desk answers
aeeee59 refactor(STORES): persisted-store registry (stores.js) and call-time snapshot paths
b09df64 docs(parallel): S-WIRE0
166332f docs(WIRE): step 0, code as found
8b12d5a docs(parallel): S-APP0
dcc5c9e wip(APP): step 0, base counts and code as found
0d29552 wip(STORES): code as found
439c7e9 docs(parallel): W1 questioner file, S-W1q, S-M-R0
```
- Suites on the merged tree: crc-sync 2101 tests, 2098 pass; the 2 failures (`ato tokenize pathological inputs`, `test-reset` "real server
  without the env var") are load-timing and both pass alone (15/15, 6/6). Before: 2092 at base (+3 app-boot, +6 from STORES/WIRE).
  crc-desktop 866 (865 pass, 1 todo), unchanged. Freeze goldens identical, 47/47, no `freeze:update`. `soak:selfcheck` PASS (5/5 fire),
  `soak:smoke` PASS (run pre-merge, memory not judged). No mutation retargeted, so no `freeze:selfcheck`. No Playwright.
- Line counts: server.js 745 -> 21; src/app.js new (~810); host-core.js 518 -> ~445.
- Merge-dependent items done: `paths` passed from createApp to createEfsp (`deps.paths`, default `statePaths(...)` per `env`);
  `BOARD_SNAPSHOT_PATH` export retired together with host-core (computes its own `statePaths`), freeze-recorder (no longer keys on it) and
  `tests/efsp-index.test.mjs`; `wsHub.stop` guard and test shim dropped. host-core never read the old named broadcast keys (it wraps
  `hub._broadcast`), so `broadcasts[]` needed nothing. `host-client.js` untouched: DATA-1's writeFixtures change is not affected by my host.
- Tickers (name, ms): datalink-locks (lockPollMs), coverage 250, clock-source 5000, airport-weather 60000 (fixed phase, ticks the last mission
  data; was made inside the mission-load handler), efsp-metrics 60000, efsp-archiver 60000, stale-reaper 5000, obligations-nla 15000,
  correlation, carrier 1000, conformance-stca 1000.
- Files outside "Owns": `tests/efsp-alerts-compose`, `tests/theater-context`, `tests/efsp-ui-b-hooks` (static tests read src/app.js now),
  `tests/efsp-index.test.mjs`, `src/efsp/index.js` (export removal, as STORES asked). No structure fixtures changed.
- Defaults taken: S-APP0 (1)-(3); `trackSeams` is a real dep (no wrapping needed); `src/test-reset.js` is required lazily only when
  CRCSYNC_TEST_RESET=1 (its load-time randomUUID shifted the soak's seeded ids); soak `obligationAlerts` is constant 0 (onAlert ignored since
  ADR 0067). BOARD-1: the `bs._rebalanceRack` wrap by name in host-core is unchanged.
- Findings: the soak hub runs without the hint monitor and airborne observer, so that production wiring is unexercised there; enabling it
  adds `surveillance: []` to efsp-alerts and changes the departure gate: a later approved `behaviour(...)` commit, not this lane.
- Nothing for the supervisor to decide.

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
