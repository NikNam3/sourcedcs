# U-PANELS-GHOST: PANELS toggles over the map with no panel behind them

Human report 2026-10-27: "sometimes on first launch the panels panel is closed but the siders are visible and clickable
without the panel behind it on the right side".

## Cause

`initDock()` restores the saved dock layout (`crc-desktop-dock-layout-v2`) with dockview's `fromJSON()`. When the saved
layout names a panel component that no longer exists, `createComponent()` throws (`[dock] unknown panel component`).
The panel that did this in practice is the old Squawk C/S panel, `calls`, removed in `49e6bb20`: any controller whose
saved layout still had it open hit this on their first launch after that update. It would happen again for any panel
renamed or removed later.

dockview builds a group's panels first and opens them in the group afterwards. So when `calls` throws, the panels
before it in the same group (PANELS, for example) have already been created and not yet opened. Creation ran
`mountExistingPanel()`, which removed `dock-unmounted` from `#radars-panel`. dockview then reverts, but it only removes
panels that were opened in a group, so PANELS is never disposed. dock.js falls back to the default layout (Track Info,
map, Radio, without PANELS) and saves it, so the bad layout is gone after that one launch. That is why it happened only
"sometimes on first launch".

`#radars-panel` therefore stayed where `index.html` put it: a static block in `<body>`, un-hidden, beneath the
`position: fixed` `#dock-root`. Its static background paints under the dock. Its positioned children (`.toggle` is
`position: relative`) come after `#dock-root` in the DOM, so they paint over it. The result was a column of toggles at
the window's right edge (the rows' right end), over the map and Radio, that a click reaches. The human saw exactly that.

The other candidates were tried and ruled out. A remembered float for `radars` that is off the window, and one with
old or zero-size fields (`crc-desktop-panel-float`), never left a toggle outside an open PANELS panel, either at boot
or after opening and closing PANELS from its topbar button. Neither did a failed restore whose bad panel sits in a
later group (dockview disposes the PANELS group it had already built).

## Reproduction

`crc-desktop/e2e/u-panels-ghost.spec.js` (E2E lane 1). It seeds localStorage before boot and asserts that every PANELS
toggle a click can reach lies inside the open PANELS panel's group. It also asserts that no legacy panel element (an
`index.html` `*-panel` div) paints outside `#dock-root`. Cases:

- a removed panel in the PANELS group: **failed before the fix**, with a column of toggles at x≈1310–1350 and PANELS closed
- a removed panel in a later group
- a PANELS float off the window
- a PANELS float with odd fields
- every legacy panel: `calls` beside Strips, Airport and PANELS, plus Settings in the map group. **Failed before the
  fix**, with `radars-panel`, `efsp-panel` and `aprt-panel` painting outside the dock

## Fix (`crc-desktop/app/public/js/dock.js`)

- `mountExistingPanel()` removes `dock-unmounted` each time dockview creates the panel, not only the first time. Its
  `dispose()` puts the class back.
- `hideStrayLegacyPanels()` puts `dock-unmounted` back on any cached legacy panel element that is still in the
  document but outside `#dock-root`. It runs after `loadDockLayout()` and on every `onDidLayoutChange`. This covers
  every legacy panel, not just PANELS.
- The `layout.css` comment on `.dock-unmounted` is updated to match.

Not changed: a saved layout that fails to restore is still replaced by the default layout, as before. The controller
loses the layout they had saved that one time. That was the existing behaviour, so this lane left it alone.

## Release note

Fixed: after an update, the app could start with the PANELS switches floating over the right edge of the map with no
panel behind them. A saved panel layout the new version cannot restore now leaves nothing on screen.

## Defaults taken

- D1: the fix hides any legacy panel element outside `#dock-root`, whatever the cause. It does not special-case the
  removed `calls` id or prune unknown panels from the saved layout before `fromJSON`. Pruning would keep the rest of
  the controller's layout, but it is a behaviour change nobody asked for (see the open point below).

## Open point for the supervisor

Should a saved layout that names an unknown panel be pruned and restored, instead of falling back to the default
layout? That would keep the controller's arrangement across a release that removes a panel. It is small (filter
`panels`/`views` against the known components before `fromJSON`), but it is not part of this bug.
