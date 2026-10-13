# Briefing: U-PAR (client only): PAR azimuth in degrees and the FAA lower safe limit (U11) — ADR 0123

Written 2026-10-13 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-PAR`, branch `lane/U-PAR`, `E2E_LANE=7`). **Commit at every green step, at least
every ~15 minutes.** ADR number **0123** (yours; amends ADR 0112's display half and H116's tolerance, never edit them).
U10 (the PAR Bay as ordinary Strips) is U-PANELS', merged before you.

## Why

U11 (`docs/parallel/live-test-2026-10-13.md` §C): the azimuth scope is in feet; the human wants a B-scope in degrees.
Research: `docs/parallel/research/release-and-par.md` R6 and "Build sketch: U-PAR's U11" (l.~688). Rulings **H141**:
**U-RQ4 b degrees only** (no feet anywhere on the azimuth scope or its readout — differs from the research's sketch,
which kept feet in brackets); **U-RQ5 a** elevation **lower limit −0.5°** (Order 8200.1D "B" lower safe limit cursor),
upper limit stays the setting (+1°). H115/H116 otherwise stand: autoscale, zoom, dark cockpit, no tolerance below DA,
track style E.

**Safety:** today an aircraft 0.5–1° below the glidepath shows as fine. That is the point of this lane: test it.

## What to build

1. `par-model.js`: azimuth in degrees (`azMaxDeg`, default ±2°, replacing the feet `yMax`); autoscale in degrees;
   readout `0.4° L` (no feet). Elevation tolerance split into `tolElLowDeg` (0.5) and `tolElHighDeg` (1.0) replacing
   `tolElDeg`; azimuth tolerance ±1° unchanged.
2. `par-panel.js` `_drawScope('az')`: Y axis in degrees, course at 0, straight horizontal ±tolerance lines, labels in °,
   still clamped/uncoloured below DA. Elevation scope: the lower tolerance line at −0.5°, upper at the setting.
3. PAR Settings tab: the elevation tolerance becomes two fields (above / below, below defaulting to 0.5°); per-controller
   settings as today. Old saved settings with the single key: take it as the upper value (client localStorage, not
   `state/`).
4. Mockup `docs/mockups/par-panel.html` → revision 5 matching the build (degrees, split limits), so the human can see it.
5. No server change (ADR 0112's sample already carries `azDeg`). If you find otherwise, stop and record it.

## Tests

`tests/par-panel.test.mjs` (and par-model tests): an aircraft 0.7° low is red; 0.4° low is not; below DA nothing is
coloured; azimuth axis labels in degrees; readout has no "ft". `e2e/par-panel.spec.js` updated. Both unit suites;
`E2E_LANE=7`, your specs only.

## Output

Commits on `lane/U-PAR`; ADR 0123; `docs/wip/U-PAR.md` (usage-guide wording, defaults taken, findings); final message
per lane-rules rule 8.
