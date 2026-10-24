# Briefing: U-FT-FIXES (client + server): two intermittent specs after today's merges, and the lanes' leftovers

Written 2026-10-24 by the supervisor. One agent, Opus 5.5. `docs/parallel/lane-rules.md` binds (worktree
`/home/nklx/dev/personal/sourcedcs-U-FT-FIXES`, branch `lane/U-FT-FIXES`, `E2E_LANE=7`). No ADR unless a fix is a design
change (ask). Read S-ARCH-92–98 in `decisions.md`. Nothing else runs beside you.

## 1. Intermittent specs (first, they block the release)
Sharded Playwright on the tip (`1803bd71`) 293/295. Neither failed on the tip of S-ARCH-90 (290/290); six lanes merged
since (U-SURFACE, U-LTAG-COURSE, U-LABEL-MENU, U-PERF, U-PAR-FT, U-FT-SMALL). Repeated alone on lane 1, one worker:
- `e2e/l5-arrivals.spec.js:100` "a Strip arriving in the Bay on screen flashes once, and is not listed on the arrivals
  line": **failed 2 of 3** (`toHaveClass`). Suspects: U-FT-SMALL's "a Strip created in a state-implying Bay starts in that
  state" (`4be2bc93`/`bb3ddf06`), U-LABEL-MENU's click wiring, U-PAR-FT's sample changes.
- `e2e/u-scope-small.spec.js:85` (H162 surface follows GC/LC held): **failed 1 of 3** (`toBe`). Suspects: the range-ring
  switch (`0b793660`) or the PAR/APRT map changes re-applying the style; a race between sign-on and the snapshot's
  `airportSurfacePositions`.
Find the cause (bisect the merges with `--repeat-each 5` if needed). If the product is wrong, fix the product; if the
spec waits wrongly, fix the wait (no sleeps; wait on the real condition). Prove each with `--repeat-each 10` passing.

## 2. Leftovers the lanes found (one commit each)
1. `crc-sync/src/tracks.js` stores `heading || 0`: a unit with no heading shows HDG 360. Keep "no heading" as null and
   show nothing (check the PAR `headings.current`, track panel, data block).
2. `crc-desktop/.../bay/dispatch.js` `_resolveActingPositionId` falls back to "the first acting Position" when the
   controller does not own the Strip (rule 9): resolve the acting Position from the Strip's owner and the Positions held;
   no match = do not send (the cell stays read-only), never guess.
3. `crc-sync/src/app/tickers.js` passes a bare `Date.now()` to `conflictAlertMonitor.tick` (rule 5): use the injected wall
   clock.
4. `CreateStrip` accepts any client `initialState` unchecked: refuse a state the strip type does not have, or that the
   target Bay contradicts (new refusal code into `REFUSAL_CODES` if needed).
5. `crc-desktop/e2e/par-panel.spec.js` fixture `APPROACH_05.courseTrueDeg: 56` → 52.7 (and any other 56/236 left in tests).

## Gates
Both unit suites; `npm run walk`, `npm run freeze` (goldens: `freeze:update`, own commit); `soak:selfcheck` if you touch
the hub; `wire:record` if a refusal code joins. Specs: the two above `--repeat-each 10`, plus `par-panel`, `l22-stars-scope`,
`smoke` on `E2E_LANE=7`. `nice -n 19` always. Output `docs/wip/U-FT-FIXES.md`; report per rule 8.
