# Briefing: U-PANELS (client only): panels and look, round 2 (U10, U12, U13)

Written 2026-10-13 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-PANELS`, branch `lane/U-PANELS`, `E2E_LANE=7`). **Commit at every green step, at
least every ~15 minutes.** No research needed. File-disjoint from U-STRIP (do not touch `strip-template.js`,
`strip-dom.js`, `control-release-rules.js`, stereo routes). U11 (PAR azimuth in degrees / B-scope) is **not** here: it
waits for U-RESEARCH and goes to U-PAR.

## Why

The human's round-2 findings (`docs/parallel/live-test-2026-10-13.md` §C, rulings in `decisions.md` **H138**). Dark
cockpit and "panels are ordinary dockable panels; app-wide font only" (H115–H119).

## Items

| Id | Do | Where to start |
|---|---|---|
| U10 | **The airfield PAR's flight-strip Bay uses the ordinary Bay/Strip UI** like every other Position, instead of its own one-line-per-flight list (PAR-2, S-ARCH-45). Its terminal ops (`FinalCall` Begin descent / Cleared to land / Landed / Missed approach, ADR 0117 and S-ARCH-55) stay reachable the ordinary way (Strip buttons / ⋯ menu / NLA), and the HDG `9A-VECTOR` / ALT `7A` cells stay editable on the airfield PAR final. **The carrier FINAL line stays as it is** (H125/H126: side number, Ball/Waveoff, range in the DIST Block); if sharing code forces a change there, stop and record it in the wip note instead. | `bay-views.js`, `par-panel.js`, `par-model.js`, `strip-menu.js`, `strip-fields.js` |
| U12 | **Every panel scrolls instead of cutting off its UI** when sized smaller. AIRPORT (`aprt-panel.css` l.13, `overflow-y: auto` on the container) does it right; apply the same container rule to every panel, Carrier, Marshal and carrier management first. Check each panel at a small size (Playwright resize) for content that cannot be reached. Panels that must not scroll as a whole (a map, the PAR scopes) say so in the wip note. | `crc-desktop/app/public/css/*-panel.css`, `carrier-panel.js`, `marshal-panel.js`, `carrier-management-panel.js` |
| U13 | **Scrollbars match the app's look** everywhere (thin, dark track, grey thumb, brighter on hover), not the white browser default. One app-wide rule (`::-webkit-scrollbar*` for Electron/Chromium, plus `scrollbar-color`/`scrollbar-width`), using the existing CSS tokens. `efsp-panel.css` l.1688 already has a partial attempt: generalise it, don't duplicate it. | app-wide CSS (`app/public/css/`) |

## Tests

- Both unit suites (`crc-sync npm test`, `crc-desktop npm test`); re-record `tests/fixtures/module-graph-exports.json`
  with `GOLDEN_RECORD=1` only if exports change.
- e2e: specs that touch the PAR Bay (`par`, `l17-carrier`, SFA/PAR specs: search `e2e/` for `FinalCall`, `par-`,
  `final`) must be updated to the ordinary Strip UI; specs reach modules through `crc.<module>`. Add: a small-panel
  scroll spec (Carrier/Marshal reach their bottom control after resize), a scrollbar computed-style check. Run only the
  affected specs with `E2E_LANE=7`.
- No wire change expected; if one happens, `cd crc-sync && npm run wire:record`.

## Output

Commits on `lane/U-PANELS`; `docs/wip/U-PANELS.md` (usage-guide wording, defaults taken, panels left unscrolled and
why, findings); final message per lane-rules rule 8.
