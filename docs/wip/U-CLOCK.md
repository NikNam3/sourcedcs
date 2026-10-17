# U-CLOCK: the mission clock holds during a DCS pause (ADR 0129)

## What changed

- `crc-sync/src/mission-clock.js`: the clock gets `setLink(state)`, `forget()` and a new source, `MISSION_HELD`. While
  the link is up and the last sample is more than 12 s old, the clock holds at sample + 12 s. WALL is used only when
  the link has been down for more than 30 s, or when there is no sample. Coming back up forgets the sample.
- `crc-sync/src/grpc-client.js`: emits `link` on every state change, undebounced, and adds a `linkState` getter.
  Game-time requests carry an epoch, bumped on `mission_start` and on connect, and stale answers are dropped. After
  either event it asks for the time straight away.
- `crc-sync/src/app/feed-handlers.js`: `mission-start` calls `missionClock.forget()` before the session hears it, and
  `link` goes to `missionClock.setLink`. A clock without these methods is skipped (the soak's virtual clock).
- `crc-sync/src/mission-session.js`: a session opened on WALL takes its `startedAt` from the first mission reading.
- `crc-sync/src/efsp/metrics.js`: a metrics session opened on WALL (flag `startedOnWall`) has its `startedAt` replaced
  by the first mission reading. The value stays a number, because the 0065 contract test requires one.
- Client: `mission-clock.js` does not advance a `MISSION_HELD` anchor. `topbar.js` shows `HH:MM:SSZ PAUSED` in the
  clock's existing grey, with the tooltip "DCS mission is paused — mission time is held".
- No change to `app.js`, `stores.js` or `ws-hub.js`. The wire is unchanged: `source` is a value, which the wire scan
  does not cover, so `wire:record` is not needed.

## What the guide / briefing should say

- **Usage guide, topbar clock:** "`PAUSED` (grey): the DCS mission is paused. Mission time is held, and no EFSP time
  (void, release, EAT, NLA) moves until the game is unpaused. `WALL` now means DCS is really gone (no link for 30 s),
  or appears for a second or two right after a reconnect or a mission restart."
- **efsp-briefing, clock section:** the table in ADR 0129 replaces 0079's "a paused mission runs on for up to one poll
  and then steps back". The Mutation log `atSource` can now be `MISSION_HELD`.
- **CLAUDE.md:** nothing needed.

## Defaults taken

- The hold threshold is **12 s** (`[OURS]`, two missed 5 s polls plus slack). The held value is sample + 12 s, not the
  sample itself, so starting the hold never steps the clock back. The unpause then steps back by at most 12 s.
- `MISSION_HELD` wins over `MISSION_NO_OFFSET` while paused. The `?` flag returns with the first sample.
- "Connected" means the grpc-client's undebounced `_state` (unit-stream-derived), not the 4 s-debounced `status`.
- A **brief** stream drop (link down for less than 30 s) keeps running on the old sample until the link comes back,
  then forgets it. During a restart the old sample therefore keeps being used for the second or two between the
  stream ending and the reconnect. Nothing rolls in that window, and nothing is stamped with the new session.
- The metrics `startedAt` stays a number (the wall time stands in) rather than becoming null, to keep the 0065 contract.
- No e2e spec was added for the topbar. The change is a text flag, covered by the client unit test of `missionNow`.

## Walks not done

- The live pause and restart were not re-run against the shared DCS server. Lane rule 2 forbids port 3000, and no DCS
  instance was available to this lane. The supervisor should repeat S-ARCH-72's two scenarios. For the pause, expect
  the topbar to read the held time with `PAUSED` within about 17 s of pausing. For the restart, expect
  `state/mission-session.json` `startedAt` to be the new mission's start, and expect one reset.

## Findings for other lanes

- None blocking. One unhandled case is recorded in the ADR: a link that is up and units that move, but no
  `GetScenarioCurrentTime` answers, would hold indefinitely.
