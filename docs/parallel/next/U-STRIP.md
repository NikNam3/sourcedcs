# Briefing: U-STRIP (client + one config file): the Strip face, round 2 (U1–U4)

Written 2026-10-13 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-STRIP`, branch `lane/U-STRIP`, `E2E_LANE=7`). **Commit at every green step, at
least every ~15 minutes.** No research needed. File-disjoint from U-PANELS.

## Why

The human's round-2 findings (`docs/parallel/live-test-2026-10-13.md` §A, rulings in `decisions.md` **H138**). Dark
cockpit (H115–H119, memory `feedback_dark_cockpit_ui`): grey unless something is a problem; show only what the
controller needs.

## Items

| Id | Do | Where to start |
|---|---|---|
| U1 | A long route (or any long text) **never overlaps the next field**: clip with ellipsis inside its cell, full text in the tooltip (or wrap if the cell is tall enough, your call, same on every type). Check **every Strip type** (DEPARTURE, ARRIVAL, OVERFLIGHT, FINAL airfield + carrier, carrier types, TOFI, flight-following OVERFLIGHT). | `strip-template.js`, `strip-dom.js`, strip CSS |
| U2 | **RMKS shows on every Strip type when present**, in the bottom row. Absent remarks take no space. **Long remarks (human, H139):** the row never grows the Strip or overlaps a field; it cuts off sensibly (one line, at a word boundary where possible, ellipsis, the full text in the tooltip). Clicking the RMKS field (or an "Edit remarks" ⋯ item) opens a **small text-box window** (a popover anchored to the Strip, multi-line `textarea`, the whole text visible and scrollable, Save / Cancel, Esc cancels, Ctrl+Enter saves) that shows **and edits** the whole remark through the ordinary `SetBlock` path (same rights and refusals as today's remarks edit; read-only view where the Position may not edit). Same on every Strip type. | `strip-template.js`, `crc-sync/src/efsp/block-map.js` (if a type has no remarks Block, say so and add it to the client face only if the server already carries remarks for it; a server change here is fine, record it) |
| U3 | `COMMS:` and `CTRL:` chips are **grey with no background** when they show no problem. Colour only for a problem (which states are a problem is U-RELEASE's job after U-RESEARCH: keep today's problem tones, change only the normal "on" tone). | `control-release-rules.js` l.79–81 (`tone: 'on'`), chip CSS |
| U4 | **Stereo routes set no remarks**, and the picker shows **only the name** (no description). Remove `remarks` from the stereo-route schema and from `crc-sync/config/efsp-stereo-routes.json` (the human's file: quote every removed `remarks` text verbatim in `docs/wip/U-STRIP.md` so nothing is lost); `description` stays in the file but is not shown or filed. `state/` is strict: if the loader rejects unknown keys, an old `state/efsp-stereo-routes.json` with `remarks` must refuse start-up naming the key (the usual rule, H127) and the wip note says so for the human. | `efsp-stereo-routes.js` (client), `panel/create-strip.js`, crc-sync's stereo-route loader (`createStereoRoutes`) |

## Tests

- Both unit suites (`crc-sync npm test`, `crc-desktop npm test`); re-record `tests/fixtures/module-graph-exports.json`
  with `GOLDEN_RECORD=1` only if exports change. Freeze only if a server file it covers moved.
- e2e: update or add specs for U1 (a long route stays inside its cell on each type), U2 (a 300-character remark is cut off on one line; the text-box window shows all of it, an edit saves and is refused for a Position without the right), U3 (computed colour grey,
  transparent background), U4 (picker lists names only; filed Strip has no remarks). Run only your specs with
  `E2E_LANE=7`.
- Wire: if the stereo-route payload or a Block changes shape, `cd crc-sync && npm run wire:record` (protocol stays 2).

## Output

Commits on `lane/U-STRIP`; `docs/wip/U-STRIP.md` (what the usage guide should say, defaults taken, the removed remarks
text, findings for other lanes); final message per lane-rules rule 8.
