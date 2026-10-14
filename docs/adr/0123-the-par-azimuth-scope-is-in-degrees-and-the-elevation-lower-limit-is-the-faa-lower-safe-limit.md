# 0123: The PAR azimuth scope is in degrees, and the elevation lower limit is the FAA lower safe limit

**Status.** Built (lane U-PAR, 2026-10-14). Rulings: decisions.md **H141** (U-RQ4 b: azimuth in degrees only; U-RQ5 a:
elevation lower limit 0.5° below the glidepath, the upper stays the setting). Amends the display half of ADR 0112 and the
elevation tolerance of **H116** (one symmetrical ±1°); neither is edited. H115/H116 otherwise stand: autoscale, zoom, dark
cockpit, no tolerance below DA, track style E. Research: `docs/parallel/research/release-and-par.md` R6. Live-test finding
U11 (`docs/parallel/live-test-2026-10-13.md` §C). Lane notes: `docs/wip/U-PAR.md`. Mockup `docs/mockups/par-panel.html`
revision 5.

## Context

The PAR panel (PAR-2, H115/H116) drew its azimuth scope in feet left and right of the centreline, with the ±1° tolerance as two
lines converging on touchdown, and read out `120 ft L`. The human asked for a B-scope in degrees.

The research for that question (R6) found a safety gap in the elevation tolerance. Order 8200.1D (flight inspection of a PAR)
names the "B" cursor, **the lower safe limit, normally 0.5° below** the commissioned glidepath, also called the elevation safety
cursor; the flight crew verifies obstacle clearance "from glidepath intercept to runway threshold" against it. Our tolerance
was ±1° (H116), so an aircraft between 0.5° and 1° below the glidepath, below the surface whose obstacle clearance was
verified, was drawn grey: "fine".

## What the sources say (the part we use)

- **Order 8200.1D ch 14 ¶13:** a PAR measures range, azimuth and elevation; "one plot shows aircraft ground-track position and
  relative deviation from the planned approach course (azimuth)". **¶19:** azimuth alignment tolerances in degrees and feet
  ("greater of 30 ft or 0.34°"), lateral coverage ±10° from the course. No order read says which unit the azimuth scope is
  drawn in; a plot of range against angle in rectangular axes is a B-display (general radar usage).
- **Order 8200.1D checklist legend and ¶17 k:** "'B' Cursor — The lower safe limit, normally 0.5° below the A Cursor"; "the
  lower safe limit angle, also known as the 'B-Cursor' or 'Elevation Safety Cursor' … typically aligned 0.5° below the primary
  glidepath … the flight crew will verify obstacle clearance from glidepath intercept to runway threshold".
- **JO 7110.65 ¶5-10-14 a:** a missed approach when "safety limits are exceeded"; the conditions "do not apply after the
  aircraft passes decision height". The orders never give the upper limit's value (it is the facility's).

## Decisions

1. **The azimuth scope is in degrees only.** Its vertical axis is the sample's `azDeg` (the angle off the course seen from
   touchdown, ADR 0112; negative left), the course is the 0° line, the ±tolerance lines are straight and horizontal, the axis
   labels read `0°`, `0.5°L`, `1°R`, the window `±2°`, and the readout `0.4° L` (one decimal, rounded by magnitude; `0.0°` on
   the course). No feet anywhere on the azimuth scope or its readout (U-RQ4 b; the research's "feet in brackets" was not
   taken). The server already sent `azDeg`: **no server or wire change**.
2. **The azimuth window** is `azMaxDeg` (default ±2°) in place of the feet `yMax`. Autoscale sets it to twice the azimuth
   tolerance, or wider so the track sits at the golden-ratio point of the half-window, never past ±15° (our PAR's coverage,
   crc-sync `config/par.json` `coverage.azimuthHalfDeg`, the AN/FPN-68A; 8200.1D gives ±10° for the older sets); Shift+wheel
   zooms it between ±0.25° and ±15°. A plot or trail point past the window's edge is drawn **at the
   edge** (close in, a few feet are many degrees), never lost.
3. **The elevation tolerance is two limits:** red when the aircraft is more than `tolElHighDeg` above (default **1°**, H116's
   value) or more than `tolElLowDeg` below (default **0.5°**, the FAA lower safe limit) the glidepath in use, above DA only.
   On a line is inside. The elevation scope draws its lower dashed line at −0.5° and its upper at +1°, both from DA outward.
   Azimuth stays ±1°.
4. **Settings:** the PAR tab has "Elevation tolerance above" (`parTolElHigh`, 1°) and "Elevation tolerance below"
   (`parTolElLow`, 0.5°) in place of "Elevation tolerance ±" (`parTolEl`); per controller, client `localStorage`, as before. A
   saved single `parTolEl` becomes the upper value once (`settings.js` `migratePar`); the lower one takes its default, so a
   controller who had widened ±1° does not silently keep a 1° lower limit.
5. Nothing else changes: elevation stays in feet (height above TDZE; DA is in feet on the plate), below DA nothing is coloured
   and the dashed lines start at DA, no calls or cadence.

## Consequences

- An aircraft 0.5–1° below the glidepath above DA is now red, with "OUTSIDE TOLERANCE" in the readout (unit test
  `par-panel.test.mjs` "safety (ADR 0123)", Playwright `par-panel.spec.js` 01).
- A controller may still set the lower limit wider than 0.5°; the setting is theirs (H116). The panel does not warn about it.
- The readout rounds to 0.1°: a plot just past a limit (1.04°) reads `1.0°` while red. The tolerance settings step in 0.1°, so
  this is only at the line.
- The trail filter's identity key (`createTrailFilter`) still uses `azDevFt`; it is a key, not a display.
