# Briefing: U-CLOCK (server, small client touch): the mission clock holds during a DCS pause, ADR 0129

Written 2026-10-17 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-CLOCK`, branch `lane/U-CLOCK`, `E2E_LANE=8`). **Commit at every green step, at
least every ~15 minutes.** ADR number **0129** (yours; it amends ADR 0079's fallback rule without editing 0079, P4).

Running beside you: **U-PAR-VALUES**, **U-FREQ-EDITOR**, **U-SMALL2**. You own `crc-sync/src/mission-clock.js`,
`mission-session.js`, `grpc-client.js`, `app/feed-handlers.js` and the client's topbar clock. If you need `app.js`,
`stores.js` or `ws-hub.js`, keep the hunk small (others touch them too).

## What the live test showed (supervisor, 2026-10-17, against the shared DCS server)

1. **Pause.** While the DCS server is paused, DCS-gRPC goes silent: the channel stays READY, but no unit, mission-time
   or weather answer comes back (requests queue and all answer in a burst on unpause). crc-sync stays `connected`,
   re-emits its cached units (`_startUnitKeepalive`), so tracks freeze and none expire; the mission session does not
   roll (correct). **But** `MissionClock` has no sample for > `staleMs` (30 s) and falls back to **WALL**: during a 9 min
   pause it read ~10:05Z instead of ~04:35Z. Every EFSP fact runs on it (ADR 0079): void times, release times, EATs,
   NLA/forwarding obligations read as long past, Mutation-log `at` values and Strip times are hours off, and whatever
   fires stays fired after the unpause.
2. **Restart (works).** `.miz` restart: stream ends, reconnect, `mission_start` **is** delivered (closes S-F3), session
   seq 2 `MISSION_START`, the clock confirms at once (07:00 local vs the old 07:41), exactly one reset, 2 Strips dropped
   and archived. **One defect:** the new session's `startedAt` was 04:41:36Z (the old mission's time, from the
   pre-restart sample still < 30 s old), not the new mission's ~04:00Z; the roll happens at mission-load before the
   first new sample. `metrics.js` stamps its mission boundary the same way: check it.

## What to build

- **Hold, not wall, while DCS is connected but silent:** when the gRPC client is connected and samples stop, `now()`
  returns the last sample's time (a paused game clock does not move). WALL stays the fallback only when DCS is really
  gone (not connected / reconnecting past the stale bound) or no sample exists yet. Find how the clock learns
  "connected" (inject it, no require-time config, ADR 0095 §4). A `source` value for the held state (e.g. `MISSION_HELD`)
  so the topbar and Mutation log show it; topbar shows the held time with a grey "PAUSED" (dark cockpit; ours).
  Whether a `source` value is on the wire: check `tools/wire-surface.js`; `wire:record` if it moves.
- **A restart drops the old sample:** on `mission_start` and on a stream end/reconnect the clock forgets its sample
  (WALL until the first new one, a few seconds), and a session opened before the first fresh sample gets its
  `startedAt` from that first sample (fill it in, do not keep the stale one). Same for the metrics boundary.
- **Durations stay on the wall clock** (ADR 0096): graces and persistence keep running through a pause. Say so in the ADR.
- Never a bare `Date.now()`; tests inject clocks.

## Tests, gates

`tests/mission-clock.test.mjs`, `efsp-mission-clock.test.mjs`, `mission-session.test.mjs`, `clock-policy.test.mjs`,
grpc-client tests: a pause (connected, no samples for minutes: held), a disconnect (WALL after staleMs), a restart
(startedAt from the first new sample), the confirmed reset still exactly once. Before the report: both unit suites,
`npm run walk`, `npm run freeze`, `soak:selfcheck` (the soak drives a clock), `wire:record` if needed. e2e: only a topbar
spec if you add one, `E2E_LANE=8`.

## Output

Commits; ADR 0129; `docs/wip/U-CLOCK.md` (guide/briefing wording, defaults taken); final message per rule 8.
