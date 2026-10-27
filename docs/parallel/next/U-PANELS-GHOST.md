# Briefing: U-PANELS-GHOST: the PANELS toggles show over the map with no panel behind them

Written 2026-10-27 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-PANELS-GHOST`, branch `lane/U-PANELS-GHOST`; **`E2E_LANE=1`**). Everything runs
under `nice -n 19`. Running beside you: DOCS-V2B (docs only; do not touch shared docs, write `docs/wip/U-PANELS-GHOST.md`).

## The report (human, 2026-10-27, verbatim)

"there is one more bug that has been in this project for ages. sometimes on first launch the panels panel is closed but
the siders are visible and clickable without the panel behind it on the right side"

So: at app start (not every time), the PANELS panel (dock id `radars`, DOM `#radars-panel`) is not open, yet its toggle
switches (`.toggle` / `.toggle-slider`, rendered by `renderPanelControls()`) are visible and clickable on the right
side of the window, over the map, with no panel background. Old bug: it predates the recent lanes.

## Where to look (supervisor's read, unverified)

- `crc-desktop/app/public/js/dock.js`: `initDock()` (~l.47: `loadDockLayout()` then `renderPanelControls()`),
  `mountExistingPanel()` (~l.731: caches the element per DOM id, removes `dock-unmounted` the first time; the element is
  never hidden again), `loadDockLayout()` (~l.792: a throwing `fromJSON` falls back to `buildDefaultDockLayout()`),
  placement memory `_panelFloats` / `withRememberedPlacement()` (~l.452–540: a remembered **floating** box re-applied to
  `radars`), `toggleDockPanel()`, `scheduleEnsureRequiredPanels()`.
- dockview-core 5.1.0 (`crc-desktop/node_modules/dockview-core/dist/dockview-core.js`, `fromJSON` ~l.9473 and its
  revert path; floating groups and their overlay).
- `css/layout.css` (`.dock-unmounted`, `.dock-panel`), `css/radar-panel.css`, `css/settings-panel.css` (`.toggle-slider`
  is `position: absolute`).
- Candidates to prove or rule out: a `fromJSON` that fails partway leaves `#radars-panel` (already un-hidden)
  orphaned in the document or a disposed group; a remembered float for `radars` restored at an off-panel position;
  an empty/collapsed floating group overlay whose content still paints; a race between the layout restore and the
  first `coverage`/Position render.

## Work

1. **Reproduce first**, with a failing Playwright spec (your E2E lane only, rule 7). Seed `localStorage` (keys
   `crc-desktop-dock-layout-v2`, `crc-desktop-panel-float`, `crc-desktop-side-size`) with the states the candidates
   need. The assertion: whenever `#panel-controls .toggle` is visible, the PANELS panel is open
   (`dock.api.getPanel('radars')`) and the toggle lies inside its group's box. If you cannot reproduce it, say what you
   tried and stop before changing code.
2. Fix the cause, not the symptom. A panel element that dockview does not hold must not paint; consider re-adding
   `dock-unmounted` when a legacy panel is disposed (in `mountExistingPanel`'s `dispose`) if that is the cause. The fix
   must cover every legacy panel, not just `radars`.
3. Gates: the spec passes, the dock/panel specs pass (`command grep -l -i -e dock -e panels crc-desktop/e2e/*.spec.js`),
   both unit suites once (lane rule: a lane runs both).

## Output

Commits; `docs/wip/U-PANELS-GHOST.md` (the cause, how it was reproduced, the fix, a release-note line). Final message
per rule 8.
