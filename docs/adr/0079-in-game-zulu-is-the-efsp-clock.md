# 0079 — in-game Zulu is the EFSP clock: a server-owned mission clock, a fixed per-theater offset, and no client-side offset

## Context

Every EFSP time gate was measured against `Date.now()`, the wall clock of the crc-sync host. That
covers about seventy sites in `src/efsp/`: the NLA gates (release time, EDCT and call-for-release
windows, void deadline), the forwarding obligations, the Strip and FDR timestamps, coordination and
TOFI exchange times, MARSA and airspace records, Position occupancy, and the Mutation log's `at`.

We fly missions whose in-game time has nothing to do with real time. A mission set at 0240Z and flown
at 1900Z real time put every one of those numbers five hours off. None of them looked wrong on its
own. A release time the controller typed as mission time would never gate a departure, because the
wall clock was already past it. A void deadline derived from a wall-clock stamp expired hours before
or after it should have.

The in-game clock did exist, but only for display:

- `grpc-client.js` polls DCS-gRPC's `GetScenarioCurrentTime` every 5 s. Its `datetime` is an ISO 8601
  string built from the mission date plus `timer.getAbsTime()`. That makes it the theater's **local**
  time of day, whatever suffix the string carries.
- `server.js` passed the string through unchanged. The topbar parsed `HH:MM:SS` out of it, advanced
  it in real time, and subtracted `gameTimeOffset`. That offset was a synced theater setting that any
  controller could edit from the Airport panel. The topbar was the only code that applied it.

So the only correct Zulu time in the system was a label in the corner of the screen. Its correctness
depended on someone having typed the right number into a settings field. Nothing the server decided
used it.

The controller decided (`docs/parallel/decisions.md` H11): **in-game UTC is authoritative, always.**
The theater's offset is fixed per theater (Syria: local = Z+3), not a setting. Converting to Zulu is
the server's job, not the client's.

## Decision

### crc-sync owns a mission clock: `src/mission-clock.js`

`MissionClock.now()` is in-game Zulu, in epoch milliseconds.

- **Fed by the existing poll.** Each `game-time` sample is parsed by its calendar fields only (the
  suffix is not trusted) and stored with the wall time it arrived. Between polls, `now()` advances
  at real rate from that sample, and every poll resyncs. Pause and time acceleration are not
  modelled. A paused mission runs on for up to one poll and then steps back. An accelerated one steps
  forward. Both are corrected within 5 s.
- **Converted with the theater's offset:** `zulu = local − offset`. The theater comes from
  `GetTheatre`, which `fetchMissionData` already fetched and `server.js` never used. It now calls
  `missionClock.setTheatre()` on every mission load.
- **`source` says which answer `now()` is giving:**
  - `MISSION`: a fresh sample, converted with a known offset.
  - `MISSION_NO_OFFSET`: a fresh sample on a theater the table does not list. The clock uses offset
    0 and warns once. The result is mission time and correct to the minute, but it may be hours off
    Zulu. A new DCS map should still run its gates on mission time, not on a clock hours away from
    it. The flag lets a controller see that the offset is missing. If `GetTheatre` fails during a
    mission load, the theater counts as unknown, not as "not known yet".
  - `WALL`: no usable sample. That means no sample yet, a theater not known yet, or a last sample
    older than 30 s (DCS gone). Thirty seconds is six missed polls, which is long enough to ride out
    a gRPC reconnect without flipping every gate by hours. In this state `now()` is the wall clock,
    which is the only time available.

  Callers never branch on `source`. It exists only to make a fallback visible. The topbar clock shows
  it (`WALL`, or `?` for no offset), and every Mutation-log record carries it.

### The offset is a shipped per-theater table: `config/theaters.json`

The table has one object per theater, keyed by the name `GetTheatre` returns:
`{ "Syria": { "utcOffsetHours": 3 }, … }`. Using objects instead of bare numbers leaves room for
magnetic variation (H15) and any other per-map fact to sit beside the offset. The table lists every
DCS theater. Syria +3 is the controller's decision. Every other value is **`[SOURCE-DEFINED]`**:
DCS does not publish these offsets, so they follow the community table in MOOSE's
`UTILS.GMTToLocalTimeDifference()` (standard time, no daylight saving, which matches how DCS keeps
time). Normandy (0), The Channel (+2) and Sinai (+2) are the least certain values and should be
checked against the mission editor before anyone relies on them.

`src/theaters.js` reads the table **once at startup** and never writes it (P5, and the same two rules
`0058` "Notes" set for `alerting.json`). A copy in `state/theaters.json` overrides it theater by
theater and field by field, so a wrong offset can be corrected on the server without a release. The
correction takes effect on the next restart.

### `gameTimeOffset` is gone

It was removed from `theater-settings.js` and its shipped JSON, from the Airport panel's Theater
section (the input and its help text), from the client's `settings`, and from the topbar arithmetic.
There is no migration. `theater-settings.js` now loads only the keys it knows, so a saved
`state/theater-settings.json` that still contains `gameTimeOffset` does not rebroadcast it.

This changes one line of `0048`'s table: `theater-settings.json` now holds transition altitude and
heading correction only. `0048` itself is not edited (P4).

### The wire carries Zulu, and the client only advances it

The `game-time` message changed from `{ datetime }` to `{ zuluMs, source }`. It is sent on connect,
after every sample, on mission load, and every 5 s while the clock is `WALL` or has just changed
source. The WALL case matters because with DCS gone there are no samples to send on.
`topbar.js` anchors to the latest message and advances it in real time. It does no offset
arithmetic. Its `missionNow()` is the client's only answer to "what time is it" for anything shown
as a time of day. Two call sites use it today: the default booking window a controller schedules on
an airspace, and how long a coordination or TOFI exchange has been waiting. The second used to
subtract a server timestamp from the wall clock.

### EFSP takes the clock by injection

`createEfsp({ clock })` passes the clock to every store (`FdrStore`, `BoardStore`, `PositionStore`,
`AirspaceStore`, `CorrelationStore`, `MarsaStore`, `MutationLog`) and to `NlaStatusMonitor`.
`server.js` passes the same clock to `ForwardingObligationMonitor`, `CorrelationReconciler`,
`ConformanceMonitor` and `WsHub`. A store built without a clock, as unit-test fixtures do, gets
`WALL_CLOCK`. That is the same answer the mission clock gives before DCS reports.

`nla.js`'s `computeNla()` and `isVoidExpired()` no longer default `now` to `Date.now()`. They throw
if it is missing. A default is the one answer that always looks plausible and, in this setup, is
always wrong.

**The rule for each site.** A value comes from the mission clock if a controller reads it as a time of
day or a time gate, if it is stored on a record, or if it is compared with a stored record time. A
value stays on the wall clock if it is a real-time duration that no one reads as a time and that is
never compared with a record:

| Site | Clock | Why |
|---|---|---|
| Every Strip, FDR, coordination, TOFI, MARSA, airspace, correlation and Position timestamp | mission | shown to controllers, and compared with gate times |
| NLA gates, the NLA status sweep, forwarding obligations | mission | release, EDCT, CFR, void, ETA and proposed departure are all mission times |
| Mutation log `at` | mission | when the event happened in the scenario the controllers were working |
| Conformance (`0058`) | mission | the heading grace period runs from the clearance's own `at`, and the alert's `since` is shown to controllers |
| NLA double-tap (400 ms) and Undo (30 s) latch in `board-store.js` | wall | how long a finger took. A resync step must not open or close it |
| Correlation below-target warning throttle | wall | limits how often the log is written |
| STCA (`stca.js`) | wall | only compares track ages, which `tracks.js` stamps in wall time, and shows no time of day |
| Track feed `time`, `missionId`, ATIS TTLs, ws tickets, the hub tick, coverage sweep, airport weather `updatedAt` | wall | transport and freshness, outside EFSP |

Mutation-log records keep the wall time as well: `MutationLog.record()` adds `wallAt` (the real time
it was written, for reading the log against server logs) and `atSource` (the clock's `source` at that
moment).

## Consequences

- A release time, void deadline or vul window typed as mission time now gates on mission time. A
  controller no longer has to know how far apart the two clocks are.
- The topbar and the server agree by construction, because the topbar displays the server's
  number.
- A change of theater is picked up on mission load with no controller action.
- Timestamps can step backwards by up to one poll after a pause, and forwards after acceleration.
  Nothing in EFSP orders records by timestamp (every store has its own sequence number), so this
  only shows up as a Strip clock jumping by a few seconds.
- Records written before this change carry wall-clock timestamps. They are not migrated (alpha). A
  Board restored from before the change shows old times in the wrong frame until those Strips are
  worked again.
- Wave-1 lanes call the injected clock for anything a controller reads as a time, never `Date.now()`.
  On the client they call `missionNow()`.

## Open

- **Entering times.** There is no HHMM editor for time Blocks yet. When one is built, it has to
  resolve an HHMM entry to a full epoch value against `missionNow()`'s date, not the wall date.
  Otherwise the day is wrong even when the clock is right.
- **The non-Syria offsets** are `[SOURCE-DEFINED]` until someone checks each theater in the mission
  editor.
