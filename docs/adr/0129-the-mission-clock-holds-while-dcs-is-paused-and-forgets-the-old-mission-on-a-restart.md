# 0129 — the mission clock holds while DCS is paused, and forgets the old mission on a restart

Amends [0079](0079-in-game-zulu-is-the-efsp-clock.md)'s fallback rule (0079 is not edited, P4). Builds on
[0086](0086-mission-session.md) (the mission session), [0096](0096-durations-on-the-wall-clock-facts-on-the-mission-clock.md)
(wall-clock durations) and [0108](0108-a-new-mission-clears-the-board.md) (the mission reset).

## Context

A live test on the shared DCS server (decisions.md S-ARCH-72, 2026-10-17) found two defects.

1. **Pause.** While DCS is paused, DCS-gRPC stops answering. The channel stays READY and nothing comes back: no unit,
   no mission time, no weather. Requests queue and are all answered when the game is unpaused. crc-sync stays
   `connected` and re-sends its cached units, so tracks freeze and none expire, and the mission session does not
   roll. Under 0079, though, `MissionClock` had no sample for more than 30 s and fell back to **WALL**. During a 9 min
   pause it read about 10:05Z when the mission was at about 04:35Z. Every EFSP fact runs on this clock, so during the
   pause void times, release times, EATs and NLA/forwarding obligations all read as long past. Mutation-log `at`
   values and Strip times were stamped hours off, and anything that fired stayed fired after the unpause.
2. **Restart.** A `.miz` restart works (the `mission_start` event is delivered, the session rolls once, the reset is
   confirmed once). But the new session's `startedAt` was the old mission's time. The roll happens at mission-load,
   before the first new sample, and the pre-restart sample was still less than 30 s old. The metrics store opened its
   mission boundary from the same stale sample.

## Decision

### Hold, not wall, while the link is up

The clock learns the DCS-gRPC link state by injection. `grpc-client.js` emits `link` on every state change, without
the 4 s debounce that `status` has, and exposes `linkState`. `app/feed-handlers.js` passes both to
`MissionClock#setLink`, so nothing is read at require time (0095 §4).

| Link | Age of the last sample | `source` | `now()` |
|---|---|---|---|
| up | ≤ 12 s (`holdAfterMs`) | `MISSION` / `MISSION_NO_OFFSET` | sample + age (real rate, as before) |
| up | > 12 s | **`MISSION_HELD`** | sample + 12 s, not advancing |
| down | ≤ 30 s (`staleMs`) | `MISSION` / `MISSION_NO_OFFSET` | sample + age |
| down | > 30 s | `WALL` | wall clock |
| any | no sample, or theater not known | `WALL` | wall clock |

- **12 s** (`[OURS]`): two missed 5 s polls plus slack. With the link up, that much silence means the game is paused.
- The held value is the sample **plus 12 s**, not the sample itself. It is where the clock had already got to when it
  stopped, so starting the hold never steps the clock back, and no record stamped just before the hold is later than
  one stamped during it. On the unpause the next sample steps the clock back by at most those 12 s. That is inside the
  session's 5 min step-back rule (0086) and the reset's 60 s confirmation margin (0108).
- `MISSION_HELD` is used for a theater without an offset too. The `?` flag is not shown while paused. It comes back
  with the first sample after the unpause.
- WALL remains the fallback only when DCS has really gone (link down for more than 30 s) or there is no sample.

### A restart or a reconnect forgets the sample

- **`mission_start`**: the feed handlers call `missionClock.forget()` before the mission session hears the event, so
  the roll at the following mission-load runs on WALL and the session opens with `startedAt: null`.
- **Reconnect**: when the link comes up again, the clock forgets its sample. Whatever DCS did while the link was down,
  the old sample no longer tells the time there.
- **Answers in flight**: `grpc-client.js` numbers its game-time requests by epoch. The epoch is bumped on
  `mission_start` and on every transition to `connected`, and an answer to an older request is dropped. The client
  then asks for the time at once rather than waiting out the 5 s poll, so the WALL window is one round trip.
- **`startedAt` is filled in**: `MissionSession#observeClock` takes the first mission reading of a session opened on
  WALL as its `startedAt` (once, persisted). This also covers the first session after a crc-sync start.
- **Metrics boundary** (`efsp/metrics.js`): a metrics session opened on WALL keeps a number, because the 0065
  contract says number. It is flagged internally (`startedOnWall`), and the first mission reading replaces it.

### Durations stay on the wall clock

0096 is unchanged. Pure durations (the conformance heading grace, the L19 airborne hold and staleness, sign-on graces,
persistence timers on the wall clock, housekeeping) keep running through a pause. Facts and gates on the mission
clock stop moving with it: a void time does not come closer while the game is paused. The 0096 persistence durations
that were left on the mission clock (heading 10 s, wrong-way, bust) therefore pause with the game. Tracks are frozen
during a pause too, so nothing changes for them.

### Wire and client

`game-time { zuluMs, source }` keeps its keys. `source` gains the value `MISSION_HELD`. The wire scan
(`tools/wire-surface.js`) does not cover values, so `WIRE_PROTOCOL` does not move. An older client shows the held time
running on, unflagged, and a resync step on the unpause. The hub's `clock-source` ticker already sends a frame within
5 s of any change of source. The client's `missionNow()` does not advance a `MISSION_HELD` anchor. The topbar shows
the held time with ` PAUSED` in the clock's existing grey (dark cockpit), and its tooltip reads "DCS mission is paused
— mission time is held". Every Mutation-log record carries `atSource: 'MISSION_HELD'` for stamps taken while paused.

## Consequences

- Through a pause every EFSP time stays at the paused mission time, and nothing fires because of the pause.
- A restart's new session and metrics session start at the new mission's first sample.
- For about one round trip after a reconnect or a `mission_start` the clock reads WALL, and records stamped in that
  window carry `atSource: 'WALL'`. That is better than the old mission's time, which looks plausible and is wrong.
- **Not handled:** a link that is up but never answers `GetScenarioCurrentTime` while units still move. The clock would
  hold indefinitely. Nothing has been seen that does this. If it is ever seen, the fix is to hold only while the unit
  stream is quiet as well.
