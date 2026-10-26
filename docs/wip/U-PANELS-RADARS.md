# U-PANELS-RADARS (wip note)

Lane: `lane/U-PANELS-RADARS`, client only, no ADR, wire unchanged. H171 FT-Q11.

## What was built

1. **PANELS panel order and the radar list** (`crc-desktop/app/public/index.html`, `js/panels/radar-panel.js`,
   `css/radar-panel.css`). The panel now reads ACTING AS (sign-on + warnings), then PANELS, then the radar list.
   The list is collapsed by default behind one grey line, `RADARS · 214 ▸` (`▾` when open); click it to open or
   close. The choice is kept per viewer in `localStorage` key `crc-desktop-radar-list-expanded` (`'1'`/`'0'`),
   read and written in try/catch: without storage the list starts collapsed and still opens. Rows are drawn either
   way and only hidden, so opening is instant and the LOS hover is unchanged.
   - Signal kept in the collapsed line: radars on the ground (the list's only "this radar gives you nothing" marker
     today, the `GND` row suffix) are counted, `RADARS · 3 · 2 GND ▸`. The coverage record carries no other
     health/degraded field.
   - No radars: `RADARS · 0` (no caret, not clickable) and the existing empty-state answer stays visible ("No radar
     coverage — select a Position under ACTING AS above." / "GC, CD work no scope.").
2. **Revert of `0b793660`** (Settings → Map Overlays "Airport range ring", default off; its test
   `tests/airport-range-ring.test.mjs` removed). Clean `git revert`, nothing built since depended on it: the
   selected airport's radar-sized range ring always draws again.

## Usage guide line (for whoever owns `docs/efsp-usage-guide.md`)

> PANELS panel: ACTING AS is at the top. The radars your Positions see are at the bottom behind one grey line,
> `RADARS · n ▸` (plus `· k GND` when some are on the ground and sweeping nothing); click it to show or hide the
> list. The client remembers whether you left it open.

## Defaults taken

- D1. **ACTING AS moved to the top** (then PANELS, then RADARS), so an expanded radar list can never push the
  sign-on controls down ("must never be pushed below it"). The alternative (keep the old order, radar list first)
  would push ACTING AS down whenever the list is open.
- D2. **The GND count is grey**, not amber: an AWACS on the ramp before take-off is a normal phase, not a fault
  (dark cockpit). If the human wants it to stand out, it is one CSS class on the count.
- D3. The empty-state message is shown even while collapsed (one line, and it is the answer to "why no picture").

## Walks not done

- No Playwright spec asserts the collapse itself (unit tests cover the state, the summary text, the storage failure
  and the markup order); `u-panels`, `u-scope-small`, `smoke`, `frequency-panel`, `runway-status` pass on E2E_LANE=8.

## Findings for other lanes

- None new. (`docs/wip/U-FT-SMALL.md` still describes the range-ring switch as built; it is reverted here.)
