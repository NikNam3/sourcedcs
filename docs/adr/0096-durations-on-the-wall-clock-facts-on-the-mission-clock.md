# 0096 — pure durations and housekeeping run on an injected wall clock; facts and gates stay on the mission clock

Refines [0079](0079-in-game-zulu-is-the-efsp-clock.md) (which is not edited). Supersedes its conformance row and adds two rows.

## Context

0079 moved every EFSP time onto the mission clock, in-game Zulu. Its rule already left real-time durations on the wall
clock, but it put conformance's heading grace on the mission clock, because the grace was measured from the
clearance's own `at`. That made a pure duration depend on a clock that can jump: a DCS pause, a mission reload or a
resync step moves mission time by minutes or hours, and a 30 s grace or a 5 s hold then ends at once or never. The
same applies to L19's "detected airborne" hold (5 s) and its staleness threshold (120 s), which 0079 did not list.

## Decision

Mission clock for **facts and gates**: anything a controller reads as a time, anything stored on a record, anything
compared with a stored record time, every Mutation-log `at`. Wall clock for **pure durations and housekeeping**: how
long something has held, how long a finger took, how often a log line may be written. Wall time is **injected**
(`WALL_CLOCK` from `mission-clock.js`, or a `wallClock` dependency), never a bare `Date.now()`;
`tests/clock-policy.test.mjs` stays the allow-list of every bare site.

Table changes against 0079:

| Site | Clock | Why |
|---|---|---|
| Conformance heading grace (replaces 0079's "Conformance" row) | wall | runs from the wall time the monitor first saw the clearance, so a mission-clock jump cannot cut it short or stretch it |
| Conformance alert `since`, heading, wrong-way and level-bust persistence | mission | `since` is shown to controllers; persistence is unchanged in this ADR |
| L19 airborne hold (5 s) and staleness duration (120 s) | wall | pure durations of how long the contact has contradicted the Strip |
| L19 `since`, the episode's `since`, the staleness log `at` | mission | stamped and shown, so they are facts |

## Why every stamp stays mission time

A stamp is read against other times: the topbar, Strip timestamps, gate times, the Mutation log. If `since` were wall
time, a controller would see a contradiction "since" an instant the scenario clock never showed. So the monitors keep
two numbers per episode: the mission `since` (stamped, shown) and a wall start (measured, never shown). The logged
`durationMs` is wall time because it is a duration.

## Consequences

- A paused or reloaded mission no longer ends or freezes a grace, a hold or a staleness count. After a server restart
  the grace for a standing clearance starts again from the first tick.
- A heading clearance's grace starts when the monitor first sees it, not when it was issued, so a clearance seen late
  gets its full grace.
- `tick(now, wallNow)` on both monitors: tests drive both from one virtual instant unless they test the divergence.
- Controller-visible effect: alert and hint timing only, on the occasions where the two clocks disagree.
- Not changed: the persistence durations (heading 10 s, wrong-way, bust). They are also durations; moving them is a
  separate decision.
