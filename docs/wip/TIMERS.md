# TIMERS report

Branch `lane/TIMERS-wall-clock` (decisions H102, NX-2 (a); ADR 0096's rule, which names no successor, so this file is the record).

- `crc-sync/src/efsp/conformance.js`: the heading (`headingPersistSec`), wrong-way (`wrongWayPersistSec`) and level-bust (`levelBustPersistSec`) persistence now compare `wallNow` against a wall stamp taken when the deviation starts (`mem.hdgDevWall`, `wrongWall`, `bustWall`), reset exactly where the mission `*Since` is. `since` on the alert and in `mem.*Since` stays mission time. No new `Date.now()`; wall comes from the existing injected `wallClock`/`wallNow`.
- Tests: three divergence tests in `tests/conformance.test.mjs` (mission clock paused / jumped an hour while wall time decides, per timer).
- Golden: `npm run freeze` 48/48 unchanged, nothing re-recorded (virtual wall follows mission in those traces).
- Usage guide §8E: one paragraph says these durations are real seconds.
- Controller-visible only when mission and wall clocks diverge (pause, reload, resync): alerts appear after the same real seconds, not mission seconds.
