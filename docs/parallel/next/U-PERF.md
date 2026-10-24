# Briefing: U-PERF (server + client): see how much CPU and memory crc-sync uses (H164 FT-Q6)

Written 2026-10-24 by the supervisor. One agent, Opus 5.5. `docs/parallel/lane-rules.md` binds (worktree
`/home/nklx/dev/personal/sourcedcs-U-PERF`, branch `lane/U-PERF`, `E2E_LANE=10`). **ADR 0141** (yours). Lean.

## What
The human: "I just have no overview how much CPU power and memory the crc-sync server currently uses. Need metrics on
that." Build:
1. **Server resource metrics** in crc-sync: process CPU % (from `process.cpuUsage` deltas), RSS / heap used / heap
   total, event-loop delay (p50/p99, `perf_hooks.monitorEventLoopDelay`), the cost of the named tickers per run
   (`src/app/tickers.js`: time per tick, worst in the window), connected sessions, tracks. Sampled on the wall clock
   (rule 5), a short rolling window, nothing persisted. Exposed where the existing metrics are (find the METRICS
   endpoint/feed, `metrics-panel.js` on the client) and shown in the METRICS panel as a small "Server" section: numbers,
   grey, amber only past a threshold from a tuning file (e.g. event-loop p99 > 100 ms, CPU > 80 %). Behind auth like
   the rest.
2. **One measurement pass**: run the soak host (`tools/soak/`, `npm run soak:smoke`) and a 20-aircraft picture, read the
   new numbers, and write the top hotspots (server tickers, client frame time if easy to see in Electron devtools
   traces) in `docs/wip/U-PERF.md`. Fix only obvious cheap ones; list the rest.

## Beside you
U-FT-SMALL, U-PAR-FT, U-LABEL-MENU. Touch `tickers.js` only to add timing around ticks.

## Gates
Unit tests (sampler, thresholds, the wire/HTTP shape); both unit suites; `soak:selfcheck` if you touch the hub;
`wire:record` if the feed changes; metrics spec + smoke on `E2E_LANE=10`. `nice -n 19`. Output `docs/wip/U-PERF.md`,
ADR 0141; report per rule 8.
