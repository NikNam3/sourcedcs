# 0086 — one mission session: which DCS mission we are in, decided in one place

## Context

Three decisions depend on knowing when a new mission starts:

- **H22.** The active runway is derived from the mission wind once per mission. After that, TWR changes it.
- **H32.** A metrics session runs from one mission to the next.
- **H36.** Finished flights are archived at a mission change (lane L24).

DCS-gRPC gives no mission id. `grpc-client.js` emits `mission-load` on **every** gRPC (re)connect,
and again after a DCS `mission_start` event. Wave 1 gave two lanes their own answers:

- **L1** (`field-state.js`) used `missionKeyOf`, an FNV hash of the theater and the waypoint and
  drawing names. With it, the same `.miz` restarted for tomorrow's sortie counted as the same
  mission, so the wind was never read again.
- **L5** (`metrics.js`) used a pending-load heuristic: theater plus mission-clock continuity.

Neither answer covered all three decisions. L1's rule had a second defect. The guard compared
against `activeRunwaySource.missionKey`, and a TWR runway change replaces `activeRunwaySource`. So
the next reconnect or restart re-derived the runway from the wind and undid TWR's choice, which is
the thing H22 exists to prevent.

The supervisor chose one shared module (`decisions.md` S-R2-2, from R2-2 (a)).

## Decision

### `crc-sync/src/mission-session.js` owns "which mission are we in"

A `MissionSession` holds `{ seq, fingerprint, theatre, reason, startedAt, startedWallAt, lastAt }`.
It is persisted to `state/mission-session.json` through `state-paths.js` (`0048`), with
`CRCSYNC_MISSION_SESSION_PATH` as the override. `seq` is a positive integer that starts at 1. It is
the `missionSession` number that the metrics buckets and the traffic-count records carry.

A new session (`seq + 1`) starts in three cases:

| Reason | When |
|---|---|
| `MISSION_START` | DCS sent `mission_start`. `grpc-client.js` now emits `mission-start` before it fetches. The session rolls at the `mission-load` that follows, so it gets that load's fingerprint and theater. This is the only way to tell a restarted `.miz` from the one still running. |
| `MISSION_CHANGED` | A `mission-load` arrives whose fingerprint differs from the persisted one. This is a different mission, loaded while crc-sync was down or disconnected. |
| `CLOCK_STEP_BACK` | The mission clock steps back more than 5 min below the highest reading seen in this session. This is the same `.miz` reloaded without crc-sync seeing the `mission_start`. A pause steps back by at most one 5 s poll. |

In every other case the session stays the same. That covers a plain reconnect, and a crc-sync restart
onto the same running mission, where the fingerprint matches and the clock carried on.

- **The fingerprint** is L1's `missionKeyOf`, moved here as `missionFingerprint` and removed from
  `field-state.js`.
- **The first boot** is session 1 with no fingerprint. The first load names that session instead of
  opening a new one.
- **The clock** is read after each `game-time` sample (`observeClock()`). It is never read on the
  `WALL` fallback. It is also not read between a `mission_start` and its load, because the clock may
  still carry the previous theater's offset.
- **A load-driven roll resets the high-water mark**, for the same offset reason.
- **One event, one session.** On a reconnect, the first clock poll can step back just before the
  load of a *different* mission arrives. If that load comes within 2 min (wall), it names the session
  the clock step opened, so the event does not open two sessions.
- **`lastAt` is written at most once a minute.** A stale value only makes the step-back test more
  lenient.

`onNewSession(fn)` calls `fn(session, previous)` after every roll. It does not fire for the first
session, or when a load only names the session it is already in. A listener that throws is logged
and does not affect the other listeners. This is the hook for the H36 archiver (L24).

### Consumers

- **Field state (H22).** `setActiveRunwayFromWind` takes `missionSession` (the seq) and stamps the
  record's new `windDerivedSession`. This stamp is kept apart from `activeRunwaySource`, which a TWR
  change still replaces. A call for a session whose wind was already applied is `skipped` and touches
  nothing. A call made while a runway change is open marks the wind as applied without moving the
  runway, because TWR is choosing. `server.js` persists whenever the call was not skipped, even when
  the end did not change, so the stamp survives a restart.
- **The clock-step case.** A clock-step roll has no `mission-load` behind it, so `server.js` also runs
  the wind derivation from `onNewSession` for `CLOCK_STEP_BACK`, using the last mission data.
- **Metrics (H32).** `EfspMetrics` takes `missionSession`. `_mission()` opens its own record
  (theater, `startedAt`, `lastAt`, used for the body and retention) the first time it sees a new
  session number, and keeps the theater in step. The pending-load heuristic, `noteMissionLoad` and
  its constants are gone.
- **Traffic count.** `TrafficCount`'s `missionSessionOf` is `missionSession.currentSeq()`.
- **Stores built without a server** (unit tests) get an in-memory `MissionSession` (`path: null`).

### `server.js`

The `server.js` changes are three delimited hunks:

1. The session block, registered **before** the main `mission-load` handler, so that handler already
   sees the session its load belongs to.
2. The observation, registered **after** the `game-time` handler that samples the clock.
3. The instrumentation argument.

L1's wind block became a named function, `deriveActiveRunwaysFromWind`, so both paths can call it.

## Consequences

- H22, H32 and H36 share one definition, and a restarted `.miz` is a new mission for all three.
- A TWR runway change now survives a reconnect or restart within the same session. Before this, it
  did not.
- **No migration (alpha).**
  - The first boot after this change starts session 1, even when `efsp-metrics.json` or the traffic
    count already hold sessions numbered from L5's own counter. Numbers can repeat until those files
    are cleared.
  - A field state persisted before this change has no `windDerivedSession`, so its wind is applied
    once more at the first load.
- **Unverified:** whether DCS-gRPC ever sends `mission_start` to a stream that connects to a mission
  that is already running. If it does, every crc-sync restart would open a new session. That is
  worth checking once against a live server.
