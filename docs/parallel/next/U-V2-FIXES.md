# Briefing: U-V2-FIXES (server + client): two fixes from Desk round 14

Written 2026-10-22 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-V2-FIXES`, branch `lane/U-V2-FIXES`, `E2E_LANE=7`). One commit per item. No ADR
unless item 2 needs one (then **0139**; ADR 0134 is never edited). Nothing else runs beside you. Read H155, H156
(PV-Q1), H160, H161 in `/home/nklx/dev/personal/sourcedcs/docs/parallel/decisions.md`; H160 (design for N, no literal
ids or fixed counts) binds you.

1. **V2-Q1 a: PAR approach values settable on an empty final.** `crc-desktop/app/public/js/panels/efsp/par-panel.js`
   (`#par-empty`) hides the header, and with it the approach values, when no aircraft is on the final. The values
   must stay visible and settable with an empty final (whoever holds PAR's hat, as today); the empty-final note stays.
   Check the server accepts the set with no aircraft (ADR 0130 says it does). Update the PAR spec (`par-panel.spec.js`):
   one test sets a value on an empty final.
2. **V2-Q2 a: the `UNACTIVATED_AIRSPACE_ENTRY` obligation** (`crc-sync/src/efsp/forwarding-obligations.js`, orange-red)
   is raised from the moment an entry is approved into a non-active airspace. It must follow the badge rule (ADR 0134):
   only while the flight is airborne inside its approved airspace and that airspace is not ACTIVE. Reuse the entry
   monitor's existing inside fact (`airspace-entry-alert.js` `getInside()` / `airspaceInside`), no second containment
   test; retracted when the flight leaves, the airspace goes active, or the approval is cleared. Unit tests for the
   pilot walk (approved early on the ground: none; inside a cold block: raised; activated: retracted; leaves: retracted).

Gates: both unit suites, `npm run walk`, `npm run freeze` (goldens: `freeze:update`, small diff, separate commit),
`soak:selfcheck` if the hub or wire moved, `wire:record`, module-graph fixture if exports change; specs `par-panel`,
`airspace-badge`, `airspace-entry-alert` on `E2E_LANE=7`. Every command under `nice -n 19`. Output:
`docs/wip/U-V2-FIXES.md` (guide wording for both); final message per rule 8.
