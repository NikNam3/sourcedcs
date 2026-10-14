# U-PAR (H141 U-RQ4 b, U-RQ5 a; live-test U11): lane note

Branch `lane/U-PAR`, cut from `efsp-wp5-correlation` at `319db075`. Client only, **no server or wire change** (the
`par-sample` already carried `azDeg`, ADR 0112). ADR **0123**. Mockup `docs/mockups/par-panel.html` **revision 5**.

## What changed

- `par-model.js`: `DEFAULT_VIEW.azMaxDeg: 2` replaces the feet `yMax`; `LIMITS.azMinDeg 0.25 / azMaxDeg 15`;
  `autoscaleView` sets `azMaxDeg = min(15, max(2 × tolAz, |azDeg| / φ))`; `zoomView` Shift+wheel zooms it; `lateralFt` is
  gone. `PAR_DEFAULTS.tolElHighDeg 1` / `tolElLowDeg 0.5` replace `tolElDeg`; `severity` is red above +high or below −low.
  The azimuth readout is `0.4° L` (one decimal, rounded by magnitude so left and right read alike; `0.0°` on the course).
  New helpers `azAxisLabel` (`0°`, `0.5°L`, `1°R`) and `clampTo`.
- `par-panel.js` `_drawScope('az')`: the axis in degrees (labels carry `data-par-axis="az"`), the course at 0°, straight
  horizontal dashed ±tolerance lines from DA outward, the plot and trail clamped to the window's edge (the plot gets
  `data-clamped="1"` when it is past it), window text `±2°`. Elevation: the lower dashed line at −`parTolElLow`, the upper at
  +`parTolElHigh`.
- PAR Settings tab: **Elevation tolerance above** (`parTolElHigh`, 1°) and **Elevation tolerance below** (`parTolElLow`,
  0.5°) replace "Elevation tolerance ±" (`parTolEl`). `settings.js` `loadSettings` calls `migratePar`: a saved `parTolEl`
  becomes `parTolElHigh` (unless that is already set) and is deleted.

## Usage guide wording (for the docs lane)

§ PAR panel (guide ~l.1842): "Shift+wheel zooms the height (elevation) or the lateral offset (azimuth)" →
"Shift+wheel zooms the height (elevation) or the angle (azimuth)". Add after the scopes sentence:

> The azimuth scope is in degrees: the course is the 0° line, left of course is below it, and the dashed tolerance lines
> are straight. Its readout is the angle off the course, e.g. `AZ 0.4° L`. A plot beyond the edge of the window is drawn on
> the edge.

§ Colours (guide ~l.1846): "Red means outside your tolerance (±1° by default per axis, Settings → PAR) above DA" →

> Red means outside your tolerance above DA: by default more than **1° above** or **0.5° below** the glidepath (the FAA
> lower safe limit) or more than 1° either side of the course; each is a setting in Settings → PAR.

Sources table (guide ~l.1401): "The PAR defaults (3.06° glideslope, ±1° per axis, no tolerance below DA) are the
squadron's (H116)" → "The PAR defaults: 3.06° glideslope and ±1° azimuth are the squadron's (H116); the elevation limit
below the glidepath is 0.5°, the lower safe limit of Order 8200.1D (H141, ADR 0123); no tolerance below DA." Add `0123` to
its ADR column.

Briefing (PAR panel lines): "azimuth in degrees (ADR 0123); elevation limits +1° / −0.5°".

## Defaults taken

1. Setting keys `parTolElHigh` / `parTolElLow` (new names rather than reusing `parTolEl` as the upper), migrated once in
   `settings.js` beside the other one-time settings migrations (H6, H70), as the briefing asked ("take it as the upper").
2. Azimuth window cap ±15° (our PAR's `coverage.azimuthHalfDeg`, AN/FPN-68A) rather than the research's ±10° (8200.1D, older
   sets): a plot inside our coverage is never clamped by the cap alone.
3. Readout to 0.1° (the briefing's `0.4° L`). A plot at 1.04° reads `1.0° R` while red; only at the line. Recorded in ADR 0123.
4. Plot and trail past the window's edge drawn at the edge (the briefing's "clamped"), everywhere, not only below DA:
   vanishing off the scope would hide the very aircraft that is far off.
5. Mockup rev 5 keeps the track-style comparison bar (history); its terminal buttons are now the four FAA steps.

## Tests

- `tests/par-panel.test.mjs` 18 (was 15): "safety (ADR 0123)": −0.7° and −0.9° red, −0.4° and −0.5° not, +0.7° not, −0.7°
  below DA not, a widened upper limit leaves the lower; the migration; axis labels / clamp; a source check that
  `par-panel.js` has no feet conversion; readout `0.2° L`, `0.4° R`, `0.0°`, `—`, no `ft`; autoscale and zoom in degrees;
  the Settings tab's five fields.
- `e2e/par-panel.spec.js` (E2E_LANE=8): 01 gains 0.7° below red / 0.4° below grey, the lower line about half the upper
  gap, azimuth axis labels in ° with no ft, window `±2°`, straight `tol-left` / `tol-right` / `course`, readouts
  `0.9° L`, `1.3° R`, `1.3° L`; 03 checks `azMaxDeg`; 04 the two elevation fields (`1`, `0.5`). 7/7 green.

## Findings for other lanes

- The guide's PAR coverage ("15° either side") matches `config/par.json`; the research's ±10° is 8200.1D's older sets.
- `par-panel.js` `renderParPanel` reads `Date.now()` for the no-plot age (pre-existing, a display duration; not touched).
