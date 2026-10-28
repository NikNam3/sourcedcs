# Briefing: U-DRAG-CLICK (client): a click or double-click on a Strip must never move it

Written 2026-10-25 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-DRAG-CLICK`, branch `lane/U-DRAG-CLICK`, `E2E_LANE=7`). No ADR. Read H167 in
`decisions.md`. U-VFR-MTMA runs beside you (CD/VFR, airspace files): stay out of its files.

## The finding (human 2026-10-25)

"Double-clicking a Strip sometimes causes a Strip move."

## Supervisor's diagnosis (verify it, do not take it on trust)

`crc-desktop/app/public/js/panels/efsp/bay/drag.js`: a drag starts after 5 px of travel (`DRAG_THRESHOLD_PX`,
`strip-drag.js`). At that moment the dragged Strip goes `position: fixed`, the Rack closes up, and `_cacheRackRects`
measures the *other* Strips in the closed-up layout. The drop index is then `computeInsertionIndex(rects, pointerY)`:
the **cursor's** Y against the neighbours' midpoints. Grab a Strip in its lower half, move 6 px: the next Strip now
sits where the grabbed one was, the cursor is below its midpoint, and the drop lands **after** it, so the Strip moves
down one place. A double-click (two press/release cycles, hand jitter) gives it two chances; the flip on the second
click makes it look like the double-click did it. Grabbing in the upper half moves nothing, hence "sometimes".

## What to build

1. Make the drop position follow the **dragged Strip** (where its ghost is), not the cursor: a release with the ghost
   still over its own original slot is no move at all, whatever half was grabbed and whatever the neighbours'
   heights (a flipped Strip is shorter). Keep the pure function testable (`strip-drag.js`), one measurement per drag
   (§7.2 rule 5), the scroll compensation (F-404) and cross-Rack drags (F-406) as they are.
2. Consider also: no reorder is sent when the result equals the current order (today a same-place drop with neighbours
   still sends a MoveStrip). Do it if it is clean.
3. Check the drag to a Bay/Position tab path cannot fire from a click either (it needs a drop target under the
   cursor; confirm).

## Gates

Unit tests in `crc-desktop/tests/` for the pure function: lower-half grab + 6 px = no move; upper half; mixed
heights; real drags one and two places up/down still land right. A Playwright check of a jittered double-click
(`l4-drag` or a new spec), on `E2E_LANE=7`, plus `l4-drag` and the boot smoke. Both unit suites once before the
report (`nice -n 19`). Output `docs/wip/U-DRAG-CLICK.md`. Final message per rule 8.
