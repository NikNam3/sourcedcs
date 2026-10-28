# Briefing: U-SURFACE (server + client): the airport surface follows the ground/tower Positions held, also on black

Written 2026-10-22 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-SURFACE`, branch `lane/U-SURFACE`, `E2E_LANE=7`). Commit at every green step. No
ADR (H162 is the record). Nothing else runs beside you. **H160 binds you: design for N airfields, no literal Position
id in code, no fixed count, no "first" Facility.**

## Why

H162 (read it, and H155, H156 SC-Q1, S-ARCH-79 in `/home/nklx/dev/personal/sourcedcs/docs/parallel/decisions.md`): the
human could not see Incirlik's taxiways in the final test because the black ATC scope (Settings → ATC Map Background
off, `atc-scope.js` `atcBlackScope()`) hides the airport surface (`airport-surface.js` `airportSurfaceVisibility`,
`map-style.js` `applyAirportSurface`/`applyAtcBackground`). Ruling: the surface shows **only while a ground or tower
Position is held**, and **also on the black ATC scope**.

## Design

1. **Facility file:** an optional `airportSurfacePositions: [<positionId>, …]` per facility file (Incirlik: `GC`, `LC`;
   none elsewhere), validated in `facility-schema.js` like `positionLetters` (unknown Position refused, start-up names the
   file). The `state/` override rule is unchanged. Ids appear only in the facility files and tests.
2. **Wire:** the snapshot carries it per Facility exactly as it carries `positionLetters` (`efsp-ws.js` ~707,
   `facilityConfig`), client `efsp-state.js` stores it in a leaf the map can read without a cycle
   (`tests/module-graph.test.mjs`, bound 0). `npm run wire:record` (use `-- --bump` only if the script says the snapshot
   key needs it; protocol is already 2, ahead of the release).
3. **Rule (client):** the surface is visible iff the Airport surface switch is on **and** the controller is signed on
   (Primary or Observer: "held" is display, not action) at a Position listed in its own Facility's
   `airportSurfacePositions`. Black scope no longer hides it. It must update live on sign-on/off and on the black-scope
   change (the `positions` and `atcBackground` change-bus topics; `positions` now also fires on Primary/Observer changes,
   commit `ae8bff61`).
4. **Black scope look:** on the black ATC scope the surface layers draw in the video map's dim grey (the gray
   `applyAtcBackground` uses for `Aeroway`); pavement as a dark grey fill with grey outline, taxiway lines grey, labels
   grey; restore the theme's paint when the background comes back. Dark cockpit: nothing brighter than the runways.
5. Update the Settings tooltip/label text only if it states the old rule; the guide wording goes in your wip note.

## Tests, gates

Unit: schema validation, the visibility rule (N generated facilities with and without surface Positions, held/not held,
black on/off, switch off), paint on black and restore. e2e: extend `u-scope-small.spec.js` (or the airport-surface
spec): GC held on black → surface visible; only AP/CTR held → hidden; sign off GC → hidden. Gates: both unit suites,
`npm run walk`, `npm run freeze` (goldens if the snapshot changes: `freeze:update`, separate commit), `wire:record`,
module-graph fixture; specs `u-scope-small`, `l22-stars-scope`, `smoke` on `E2E_LANE=7`. Every command under `nice -n 19`.
Output: `docs/wip/U-SURFACE.md`; final message per rule 8.
