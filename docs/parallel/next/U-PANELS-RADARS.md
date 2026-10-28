# Briefing: U-PANELS-RADARS (client): the PANELS panel's radar list out of the way; revert the range-ring switch

Written 2026-10-25 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-PANELS-RADARS`, branch `lane/U-PANELS-RADARS`, `E2E_LANE=8`). No ADR. Read H171
(FT-Q11) and H164 in `decisions.md`. Dark cockpit. Two lanes run beside you (U-VFR-MTMA: airspace/CD files;
U-DRAG-CLICK: `panels/efsp/bay/*`, `strip-drag.js`): stay out of their files.

## Items (commit each separately, green)

1. **The radar list.** `crc-desktop/app/public/js/panels/radar-panel.js` (dock title PANELS) shows the ACTING AS
   sign-on and then every active radar, read-only. The human: "it is really annoying if you select CTR and then always
   have to scroll past a list of 200 radars". Make the radar list **collapsed by default** behind one grey header line
   with its count (e.g. `RADARS · 214 ▸`), click to expand; the sign-on controls must never be pushed below it.
   Remember the expanded/collapsed choice per viewer (localStorage, try/catch, works without it). Anything in the list
   a controller must notice (a radar of theirs down, degraded coverage) stays visible in the collapsed line, grey
   unless it is a problem: check what the list shows today and keep any such signal.
2. **Revert `0b793660`** (the Settings → Map Overlays "Airport range ring" switch, default off): FT-Q11 was not the
   range ring, so the ring goes back to how it was. `git revert` it cleanly (its test `tests/airport-range-ring.test.mjs`
   goes with it), unless something built since depends on it; then say so.

## Gates

Unit tests for the collapse state and the summary line; both unit suites once before the report (`nice -n 19`).
Specs that cover the PANELS panel (`u-panels`, `u-scope-small`, `smoke`) on `E2E_LANE=8`. Output
`docs/wip/U-PANELS-RADARS.md` (usage-guide line). Final message per rule 8.
