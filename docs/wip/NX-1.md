# NX-1: soak with hints and a store-stale detector

Branch `lane/NX-1-soak-hints`. Tools only (`crc-sync/tools/soak/`, `tests/soak-store-stale.test.mjs`, CLAUDE.md's soak paragraph). No `src/` edit.

## What changed
1. `host-core.js` no longer passes `surveillanceHints: null`: `createApp` builds the `SurveillanceHintMonitor` and the Boards' `airborneEvidence` link, and the driver's existing `conformance-conflict-alert` tick runs `hints.tick()` as in production. The host throws at start if no monitor was built. Samples gain `hints.mem`, `hints.active`, `hints.airborneEver`.
   Measured on the smoke profile: `hints.mem` fills (the monitor tracks the expecting Strips) but `hints.active` and `hints.airborneEver` stay 0: the synthetic flights never leave a DEPARTURE Strip on the ground side while their correlated contact is already airborne, so no AIRBORNE_ADVANCE chip is ever raised and `airborneEvidence` is never answered true. The monitor's tick, memory and the staleness path run; the chip path does not. Not widened (would need a traffic script).
2. `shadow.js`: per-client store cursors (`adoptStoreSnapshot`, `noteStoreFrame`, `noteHeartbeat`, `applyStoreSlices`) written to mirror `crc-desktop/.../sync-cursor.js` and `efsp-state.js`. `driver.js` feeds them (heartbeats were skipped before), and `storeResyncs()` does what the client does after each tick: `efsp-resync { stores }`, then take the slice position. Store-stale = behind the heartbeat for `STORE_STALE_BEATS` (6) beats (60 virtual s; a working resync needs 2-3). `report.js`: `mutations.storeSync` block, verdict gate, summary row. Parity of the table with `stores.js` STORE_SYNC is a unit test.
   Paths: connect snapshot always adopts the positions (also for a `discard` client, which only skips the Board replica); disconnected clients are not judged (no heartbeat reaches them); a restart changes the epochs and the reconnect snapshot re-adopts; the Board resync answers are untouched.
3. Selfcheck: new case `drop-store-delta` (the driver drops the first store delta one controller would receive after minute 3, and that controller sends no store resync). Expect `storeSync.stale >= 1` and a verdict failure. `clean` now also requires `storeSync.stale == 0`. The other five cases are unchanged.

## Mission reset (H108)
The soak never rolls the mission: the host binds `MissionSession` directly, nothing calls `noteMissionStart`/`noteMissionLoad` after the first load, the clock never steps back, `clock-source` is not ticked, and the driver's `missionReload` command only clears tracks and resets the correlation picture. So `onMissionReset` never fires and no false hit is possible; a roll-over is NOT exercised. A future lane could add a host command that calls `noteMissionStart` with a new fingerprint (the reset's deltas would then arrive as ordinary `gone`/store deltas).

## Findings
- On a clean smoke run the shadow asks for 23-31 correlation slices per 20 min. This is faithful to the shipped client, not a harness artefact: `correlations` is `gapFromDeltas: false`, a reconciler delta that moves `correlationSeq` by more than one is never adopted, so the next heartbeats are ahead on two beats and the client resyncs (a slice, no snapshot). Cheap and self-healing, but every busy correlation tick costs a request. If that is unwanted, the client could adopt a jump when the delta's own seq is the server's (a client/server decision, not taken here).
- `hints.airborneEver` stays 0 in the soak (see 1).

## Defaults taken
- Bound 6 beats, resync trigger 2 beats (the client's rule).
- Injection is driver-side, like `skip-shadow-client`, and only mutes the victim client.
- No new `src/` hook; the soak reads `monitors.surveillanceHints` that `createApp` already returns.

## What the human must run
Workflow `.github/workflows/crc-sync-soak.yml` ("crc-sync EFSP soak (manual)"), inputs: `minutes` 240, `seed` 1, `profile` realistic, `realtime` false (virtual time, about 15 min wall; true is the literal 4 h), `selfcheck` true, `extra` empty. Pass means exit 0 and `SOAK PASS` with memory judged: the summary must NOT say `memory.slope NOT JUDGED` (a 240 min run with the soak's 2 h retention covers the warm-up), heap slope <= 1.0 MB/h and net growth <= 25%, and `store-stale / store resyncs` shows `0 / n`. A second seed (`seed` 2) is worth one more run.
