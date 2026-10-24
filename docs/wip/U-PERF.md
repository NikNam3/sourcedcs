# U-PERF: how much CPU and memory crc-sync uses (H164 FT-Q6, ADR 0141)

## What was built

- `crc-sync/src/server-resources.js`: the sampler (CPU from `process.cpuUsage` deltas, RSS/heap, event-loop delay
  p50/p99/max, every named ticker's runs/mean/worst/busy share, sessions, tracks). 5 s samples, 60 s rolling window,
  memory only. Thresholds in `config/server-resources.json`.
- Read at `GET /api/server/resources` (auth) and in the `efsp-metrics` answer as `serverResources`.
- METRICS panel: a **Server (crc-sync) · last 60 s** section at the bottom: CPU, Memory, Event-loop delay, Carrying
  (sessions, tracks), Tickers (busiest one, or the ones over `tickMaxMs`), and a folded "Every ticker" table. Grey;
  amber only where the server's `warn` says so.
- The soak report (`report.json` `serverResources`, one summary row "busiest tickers (last life)").

## Measurement pass (2026-10-24, this laptop, `nice -n 19`)

### 20-aircraft picture, real timers

A throwaway in-process bench (not committed): `createApp` started for real, the shipped Syria terrain, a mission
with LTAG and LTAF, one E-3A and nineteen aircraft on circles round Incirlik updated once a second (the DCS-gRPC
rate), 4 or 12 sessions signed on at INCIRLIK (AP, LC, GC, OPS). 60 s window.

| | 4 sessions | 12 sessions |
|---|---|---|
| CPU (one core = 100 %) | 2.2 % (worst 5 s 4.1 %) | 2.7 % (worst 5.7 %) |
| RSS / heap used | 106 MB / 19 MB | 109 MB / 20 MB |
| Event-loop delay p50 / p99 / max | 0.1 / 2.7 / 7.8 ms | 0.1 / 2.2 / 7.7 ms |
| Feed bytes per session | 3.4 KB/s | 3.4 KB/s |

Busiest tickers (mean per run, share of wall time): `par` 1.5-1.8 ms every 500 ms (0.3-0.4 %), `coverage` 0.6 ms every
250 ms (0.2-0.3 %), `hub-feed` 0.7 ms (4 sessions) / 1.1 ms (12) every 500 ms, `conformance-conflict-alert` 0.5 ms
every second. Everything else is under 0.2 ms a run. **At 20 aircraft crc-sync is idle**: a few percent of one core,
about 110 MB resident. Nothing is near a threshold.

### Soak smoke (20 virtual minutes of EFSP traffic, `npm run soak:smoke`)

PASS. Mutation server time p50 about 8 ms, p99 18-20 ms (persist p99 5-7 ms). Ticker cost in the last host life:
`conformance-conflict-alert` 0.9 ms mean (5.2 ms worst), `correlation` 0.7 ms (7.3 ms worst), `obligations-nla` 0.8
ms, `hub-feed` 0.4 ms. A `--cpu-prof` of the same run (host process, about 9.9 s busy) gives the hotspots below.

### Hotspots, in order (none fixed: none is cheap and none matters at today's load)

1. **`_persist` (`src/efsp/index.js`) after every Mutation: about half the host's busy time in the soak.** It builds
   the whole snapshot of every store, `JSON.stringify`s it (self time 3.2 s of 9.9 s) and writes it with
   `writeFileSync` + rename (0.7 s + 0.3 s). The cost grows with the Board (soak snapshot 30 KB → 171 KB in 20
   minutes). The write-before-ack is deliberate (ADR 0081, F5); the dirty-body check already skips no-op writes. A real
   fix is an append-only journal or per-store dirty snapshots, an ADR of its own. At a few Mutations a second it is
   still only 1-2 % CPU, but every Mutation blocks the loop for its 5-20 ms.
2. **`deepClone` (`JSON.parse(JSON.stringify())`) on read paths: about 12 % together.** `facilityConfig.getFacilityConfig`
   clones the whole facility file on every call (0.57 s self), and hot callers only read one flag:
   `forwarding-obligations.js` `tick` (`dataOnly`, on every Mutation through `recheckObligations` and every 15 s),
   `par-monitor.js` `_finalBays` and `_approachGeometry` (every 500 ms), `facility-rules.js`. `correlation-store.js`
   `getCorrelation`/`snapshot` clone each record (0.40 s); `strip-util.js` and `airspace-store.js` clone too (0.1 s
   each). Cheap fix, left for the owner of those files: a frozen cached copy (or a field accessor) for read-only
   callers, or `structuredClone`. Not done here: `par-monitor.js` is U-PAR-FT's this wave, and changing what
   `getFacilityConfig` returns needs every caller checked for mutation.
3. **`recheckObligations` after every EFSP delivery** (0.55 s inclusive): the whole obligation sweep runs once per
   Mutation, on top of the 15 s timer. Fine today; with a large Board a per-Strip recheck would do.
4. `predictConflict` (`conflict-alert.js`, 0.11 s self in the soak): pairwise CA, O(n²) in tracks. Negligible at 20.
5. `par` ticker in production (1.5 ms a run): `finalApproaches()` rebuilds the approach (runway resolve, WMM variation,
   facility clone) for every final Bay twice a second even when nobody holds PAR. A cache keyed on the runway view
   and the set values would take it to near zero. U-PAR-FT's file.

### Client frame time

Not measured: no Electron devtools trace was taken (the lane is lean and a trace needs a hand-driven session). The
renderer's cost is the next thing to look at if the controller sees lag; the server is not the cause at this load.

## Defaults taken (P2)

- **Where it shows**: the METRICS panel's existing poll (on show, then every 30 s) carries the block, rather than a new
  message type or a pushed frame. The Server section sits under the traffic count.
- **Window and thresholds**: 5 s samples, 60 s window; amber past CPU 80 %, event-loop p99 100 ms, RSS 1024 MB, one
  ticker run 100 ms. All in `config/server-resources.json`.
- **Event-loop p99** of the window is the worst 5 s sample's p99, not a merged histogram.
- **`E2E_LANE=10`**: `playwright.config.js` refused lanes over 9, so its guard now allows 0-19 (lane n: crc-sync 3010+n,
  app 3110+n, fake DCS 3210+n, no overlap below 100). `e2e/tools/run-sharded.js` still says 0-9; the supervisor's tool,
  left alone.
- **Wire**: `serverResources` is an ack payload the scan cannot see; `npm run wire:record -- --bump` ran and the protocol
  stays 2 (already ahead of the last release).

## What the briefing/guide should say

- `docs/efsp-usage-guide.md` METRICS section: "Server (crc-sync): what the server process costs over the last minute.
  Grey is normal; an amber row is past the threshold in `config/server-resources.json`."
- `infra/RUNBOOK.md`: `curl -H "Authorization: Bearer <token>" https://<CRCSYNC_DOMAIN>/api/server/resources` for the
  same numbers outside the client.
- CLAUDE.md's crc-sync paragraph could name `src/server-resources.js` and the tuning file.

## Findings for other lanes

- Hotspot 2 and 5 above are in `par-monitor.js` (U-PAR-FT) and `facility-config.js` / `forwarding-obligations.js`.
- `tickers.js`'s `conformance-conflict-alert` still calls a bare `Date.now()` for `conflictAlertMonitor.tick(...)` (rule
  5 asks for an injected wall clock); not touched (the briefing allows only timing in that file).
