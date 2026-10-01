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
