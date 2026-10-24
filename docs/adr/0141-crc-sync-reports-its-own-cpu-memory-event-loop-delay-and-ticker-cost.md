# 0141: crc-sync reports its own CPU, memory, event-loop delay and ticker cost

**Status.** Accepted (lane U-PERF, 2026-10-24). Ruling: decisions.md **H164 FT-Q6** ("no overview how much CPU power and
memory the crc-sync server currently uses, need metrics on that"). Builds on ADR 0065/0072 (the METRICS panel and its
`efsp-metrics` answer), 0096 (wall clock for durations and housekeeping), 0056/0058 (colour only when something is wrong).

## Context

Nobody could say what crc-sync costs on the server. The only numbers were the soak's (heap and Mutation latency, in
virtual time) and whatever `docker stats` shows, which says nothing about which part of the service is busy.

## Decision

1. **One sampler, `src/server-resources.js`**, built by `createApp`. Every `sampleMs` (5 s) it records the process CPU
   (`process.cpuUsage` delta over the interval, one core = 100 %), memory (`process.memoryUsage`: RSS, heap used/total,
   external) and event-loop delay (`perf_hooks.monitorEventLoopDelay`, p50/p99/max of that interval, with the
   histogram's 10 ms sampling period taken off: Node records the interval, not the lateness). The window is a ring of
   the last `windowMs / sampleMs` samples (60 s). Memory only, nothing persisted. Times come from a monotonic clock
   (`performance.now`) and `sampledAt` from the injected wall clock: none of this is an EFSP time.
2. **Every named ticker is timed.** `createApp` wraps each `buildTickers` entry (`tickers.js` is unchanged), and the hub
   times its 500 ms feed tick as `hub-feed` (a `timeTick` dependency). Per ticker: runs, mean, worst run and share of
   the window (`busyPct`). The soak, which drives the same tickers by name, gets the timing for free.
3. **Read in two places, behind auth**: the `efsp-metrics` answer's **`serverResources`** block (the METRICS panel's
   poll, so no new message type), and **`GET /api/server/resources`** (`requireAuth`), the same snapshot, for an
   operator with curl. The snapshot: `windowMs`, `samples`, `cpu {pct, maxPct}`, `memory {rssMb, heapUsedMb,
   heapTotalMb, externalMb}`, `eventLoop {p50Ms, p99Ms, maxMs}`, `tickers [{name, periodMs, runs, meanMs, maxMs,
   busyPct}]` (busiest first), `sessions`, `tracks`, `thresholds`, `warn {cpu, eventLoop, memory, tickers: [names]}`.
   Before the first sample a value is `null`, never 0.
4. **The server judges, the panel shows.** Thresholds are a tuning file, `config/server-resources.json` (`warn.cpuPct`
   80, `eventLoopP99Ms` 100, `rssMb` 1024, `tickMaxMs` 100; a `state/` copy layers key by key, an unknown key stops
   start-up, read once). The METRICS panel's **Server** section prints the numbers grey and turns a row amber
   (`--efsp-attn`) only where `warn` names it; the client compares nothing itself. The ticker list is folded.
5. The event-loop p99 of the window is the **worst sample's p99**, so a bad few seconds is not averaged away; p50 is the
   median of the samples.

## Consequences

- The wire scan does not see ack payloads, so `wire:record -- --bump` was run: the protocol stays 2 (already ahead of
  the last release). An older crc-sync sends no block and the panel says "not reported by this crc-sync".
- The freeze goldens drop `serverResources` (`VOLATILE_KEYS`): it is wall-clock data.
- The soak report carries the last host life's `serverResources` (info, never a gate); its host never samples, so its
  window is the whole life and `busyPct` is a share of real time.
- The measurement pass and the hotspots it found are in `docs/wip/U-PERF.md`.
