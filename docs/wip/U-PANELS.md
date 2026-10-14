# U-PANELS (H138 U10, U12, U13): lane note

Branch `lane/U-PANELS`, cut from `efsp-wp5-correlation` at `543c1c1f`. Client only; no wire change, no ADR.

## What changed

- **U10, the airfield PAR final is ordinary Strips.** `bay-views.js`: an airfield `view: 'final'` Bay (Incirlik's
  `par-final`) no longer mounts a component (`bayHasComponentView`), and its `replacesRacks` is not honoured; the
  descriptor's `view: 'final'` there only tells crc-sync which Strips get a PAR sample. The FINAL Strip shows HDG and ALT
  as its own `9A-VECTOR` and `7A` Blocks (click to type, the ordinary `SetBlock`); the NLA is **Landed**; the next
  once-only call (**Begin descent**, then **Cleared to land**) rides beside the NLA (`parCallButtons`, only for the Position
  holding the Strip); the ⋯ menu has a **Final** group: Begin descent, Cleared to land (greyed "recorded" once recorded),
  **Missed approach**, **Show in PAR panel** (`strip-menu.js`). The **carrier FINAL line is unchanged** (side number,
  Ball / Waveoff, no range; H125/H126); its builders were renamed `carrierFinalRowModel`, `carrierFinalTerminals`,
  `carrierFinalTerminalOp`. `par-panel.js`: comments only (the Bay/list part), nothing in the scopes.
- **U12, every panel scrolls.** `dock.js` `mountExistingPanel()` gives every docked panel `.dock-panel`, and
  `layout.css` makes it `width/height: 100%; overflow: auto` (the AIRPORT panel's container rule, made the rule). The
  Strip panel's Bay keeps a `min-height: 120px` (`efsp-panel.css`), below which the panel itself scrolls, so the
  toolbar, tabs and dot-command row are never cut off.
- **U13, scrollbars.** One app-wide rule in `base.css`: `scrollbar-width: thin`, `scrollbar-color` thumb `--efsp-line-2`
  on track `--efsp-strip`, thumb `--efsp-muted` while the pointer is over the scroller; `::-webkit-scrollbar*` the same
  for an engine without the standard properties; the light theme uses its `--ui-*` ramp. `efsp-panel.css`'s partial
  attempt now only sets `color-scheme: dark` (select lists).

## Panels that do not scroll as a whole (U12)

- **Map** (radar map): not a `mountExistingPanel` panel; a picture filling its tab.
- **Carrier map** (`#carrier-map-panel { overflow: hidden }`): a picture that fills the panel.
- **Settings** (`#settings-panel { overflow: hidden }`): the tab body scrolls under the fixed tabs.
- **PAR** keeps its own `overflow: auto` from PAR-2 (it scrolls as a whole when smaller than its scopes' minimum); not
  changed here, since U-PAR owns the scope drawing next.

## Usage guide wording (for the docs lane)

§ PAR bullet (usage guide ~l.1639, already stale, it still says "Landing assured"): replace the FINAL Bay sentence with:

> The **FINAL Bay** holds the ordinary FINAL Strip like any other Bay. Type the assigned heading and altitude in its
> **HDG** and **ALT** fields. Beside **Landed** (the next-step button, which sends the Strip to `GC` as an arrival at
> taxi-in) is your next call, **Begin descent** and then **Cleared to land**; each is recorded once and then stays in the
> Strip's ⋯ menu, greyed, as the record. The ⋯ menu's **Final** group also has **Missed approach** (back to `AP` on its
> frequency Rack) and **Show in PAR panel**, which draws the flight in the PAR panel and opens it.

§ Panels (wherever the dock is described): "Every panel scrolls when you make it smaller than its contents, except the
two maps and the PAR panel's scopes; Settings scrolls under its tabs."

Briefing ~l.104 / 1410: `bay-views.js` is "the carrier FINAL Bay line"; the airfield FINAL Bay is ordinary Strips (H138 U10).

## Defaults taken

1. Begin descent / Cleared to land: the next unrecorded call is a button beside the NLA (one at a time, in order), and
   all calls are also in the ⋯ menu; Missed approach is in the ⋯ menu only (it is the rare branch; the NLA stays
   Landed). Landed is not repeated in the menu.
2. "Show in PAR panel" replaces the old click-on-callsign; it is in the ⋯ menu for every FINAL Strip on an airfield final.
3. `.dock-panel` is added by `dock.js` to every mounted panel rather than a rule per panel CSS file: one rule, and a
   panel opts out on its own id rule.

## Tests

- e2e (`E2E_LANE=7`): new `e2e/u-panels.spec.js` (3: Carrier/Marshal reach their bottom control at a small size; every
  panel at a small size; scrollbar computed style). Verified red without the `.dock-panel` class (airspace,
  runwayStatus, carrier, marshal overflowed their tab). `l18-incirlik` 02/02b and `par-panel`'s `openFromBay` rewritten to
  the ordinary Strip UI. Run green: u-panels (×2), l18-incirlik 6, par-panel 7, side-swap 2, l17-carrier, carrier-map,
  marshal-board, settings-tabs (21), lt-ui, u-strip, l1-touch-targets, airspace-panel, runway-status (33).
- The Radio panel is hidden until SRS connects (`srs-radio.js`); the spec forces it visible to check it.

## Findings for other lanes

- **U-PAR**: `par-panel.js`'s scopes untouched; `showParFlight` is now called from `strip-menu.js` (Final group).
- **DOCS**: the guide's PAR paragraph still says "Landing assured" (older than LT-PAR-MISSED); wording above.
- The carrier FINAL line still has no RMKS (S-ARCH-61, open for the human); unchanged here.
