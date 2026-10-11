# Lane PAR-2 (2026-10-11): the PAR panel

Branch `lane/PAR-2`. Client only (no crc-sync change, wire unchanged). Briefing: `docs/parallel/next/CARRIER-PANELS.md` §6.
Rulings: H115, H116, H122 (H123 read; S-ARCH-44 for the sample). Mockup `docs/mockups/par-panel.html` revision 4. The sample is
PAR-1's (`docs/wip/PAR-1.md` "The sample", ADR 0112).

## What was built

| File | What |
|---|---|
| `crc-desktop/app/public/js/panels/efsp/par-model.js` | Pure model, a leaf (in `NEVER_IN_A_CYCLE`): glidepath in use, replot against the controller's angle, DA range, tolerance per axis above DA, no-plot age, flight name (H122), which flight the scopes show, autoscale window, zoom, the trail filter for a runway change, header/readout text, the terminal ops. |
| `crc-desktop/app/public/js/panels/efsp/par-panel.js` | The dockable PAR panel (`#par-panel`, dock id `par`, title `PAR`, in the PANELS list): approach header, flight row, range to TD, elevation and azimuth scopes (SVG), deviations line, amber NO PLOT box, the two terminal buttons. Registers the **PAR** Settings tab. Redraws on change-bus `par`, `snapshot`, `board`, and every 500 ms while mounted (the no-plot age grows between frames). |
| `crc-desktop/app/public/css/par-panel.css` | Its styles, efsp-panel.css tokens, app font. |
| `bay-views.js` (`view: 'final'`) | **Replaces `final-panel.js`** (deleted, with its cadence bar and call prompts): one line per flight on the final — its name (a button: shows it in the PAR panel and opens the panel), its range to touchdown from the sample, and FINAL's two terminal buttons with their ops unchanged. The list is rebuilt only when its flights change; a sample rewrites the text in place (a rebuild at 2 Hz detached the buttons under a click: the l18 spec caught it). |
| tests | `tests/par-panel.test.mjs` (15, the model + the settings tab); `efsp-bay-views.test.mjs` final tests rewritten (row model, PAR mount, carrier mount); `efsp-final-panel.test.mjs` → `efsp-pattern-board.test.mjs` (FINAL half removed); module-graph fixture re-recorded. |
| e2e | `e2e/par-panel.spec.js` (7 tests); `l18-incirlik.spec.js` on the flight line; `e2e/helpers/modules.js` gains `par`, `parSamples`, `changeBus`. |

## The panel (as built)

- **Header**: `RWY 05 · LTAG` (carrier: the hull label, `CVN-72`), GPA (the angle in use, 2 decimals), TCH, DA (MSL), FAC (`051M`; hidden
  when the sample has no course display, as on the carrier); on the right `EL INOP` / `AZ INOP` flags in orange-red with the reason as tooltip.
- **Flight row**: name (side number on a carrier lane once typed, else the callsign; the callsign at Incirlik), aircraft type, BCN
  (assigned beacon, hidden when none), GS, VS (signed, `−770`), and the range to touchdown large on the right ("NM to TD"; negative past it).
- **Scopes**: elevation (height above TDZE against range) and azimuth (cross-track ft, right up, as the pilot sees it) against range
  from touchdown; TD fixed bottom-left / left edge; wheel = range of both, Shift+wheel = this scope's vertical; no pan; window label
  `0–10.0 NM · 0–3562 ft · AUTO` (`AUTO paused (double-click)` after a manual zoom). Glidepath / course solid `#5f6b76`, tolerance lines
  dashed `#46505a` **from the DA range outwards** in both scopes, DA tick on the glidepath. Track style E: magenta `#e58bff` diamond with
  a `#0b0e11` halo, the trail (up to 12) magenta with rising opacity; red (`#ff5c5c`) plot and trail when that axis is outside tolerance;
  a hollow amber diamond when there is no plot for 3 s. An INOP scope is blanked: `NO ELEVATION DATA` / `NO AZIMUTH DATA` and the reason, orange-red.
- **Deviations**: `EL +12 ft`, `AZ 55 ft L`, `ALT 1,373 ft` (TDZE + height); an axis outside tolerance reads red with `OUTSIDE TOLERANCE` (the mockup's wording).
- **Amber**: only `NO PLOT n s` (plot age = `plotAgeMs` + time since the frame arrived ≥ 3 s), or `NO PLOT` when a flight's sample has had
  no plot for 3 s since it first came. Never when both scopes are INOP (the failure explains it).
- **Buttons**: plain, grey: `Landing assured` / `Missed approach` at a runway; `Ball` / `Waveoff` on a carrier lane (the ops the FINAL view
  had: SetState BALL / BOLTER_WAVEOFF; Ball is the recorded FINAL_TO_LSO handoff). Acts only when the Strip's owner is signed on here.
- **Several flights**: a row of name buttons above the header (only when more than one is sent); see Defaults 3.

## Defaults taken (P2)

1. **The PAR panel is a separate dockable panel; the FINAL Bay keeps a one-line flight list.** "Replaces the FINAL Bay view's rendering":
   the talk-down component is gone; the Bay at Incirlik hides its racks (`replacesRacks`), so without a line the controller would have no
   handle on the Strip there. The line carries name, range and the two terminal buttons (same ops), so the Bay still works with the
   PAR panel closed. The panel opens with the left cluster like CARRIER MAP (a tab in that group); the controller places it.
2. **Carrier lanes keep `Ball` / `Waveoff`**, not "Landing assured / Missed approach": the ops differ (Ball is a recorded handoff), and the
   briefing says "the existing terminal ops". The labels follow the approach kind.
3. **Which flight the scopes show** (several finals sent to this controller: a carrier lane holds more than one; a controller holding
   CV_APP1 and CV_APP2): the controller's pick holds while that flight is still sent; otherwise the one **nearest touchdown** (no plot =
   farthest; ties by Strip id). Picked by the name buttons in the panel or the name in the FINAL Bay. It never switches by itself while
   the picked flight is on the final. A new flight shown resumes autoscale.
4. **"Below DA" = the plot's range is inside the range where the glidepath reaches DA** ((DH − TCH)/tan GPA), as the mockup did; not "height
   below DA" (an aircraft far below the glidepath 2 NM out is below DA height and must stay red).
5. **Azimuth tolerance is the angle from touchdown** (the sample's `azDeg`), the elevation tolerance the angle off the glidepath
   (`elevDevDeg`, recomputed with the controller's angle when `gpaPublished` is false).
6. **Settings** (tab `PAR`, keys `parAutoscale` true, `parGpa` 3.06 (2–4, 0.01), `parTolEl` 1 (0.1–3), `parTolAz` 1 (0.1–5)), the mockup's ranges.
7. **Autoscale off + double-click** resets to the default window (10 NM, 3,500 ft, ±1,200 ft), as the mockup did.
8. **Runway change**: the trail plots present when `approach.id` changes, and the plot then on screen (the server re-measures only on a
   new DCS fix, so it joins the trail later), are left out until they have aged out; the server is unchanged.
9. **BCN** shown (the mockup has it) from `identity.beaconAssigned`; hidden when none.
10. The panel's empty state reads `No aircraft on your final.`

## Usage-guide wording (for `docs/efsp-usage-guide.md`, the PAR / carrier final sections)

- "Open the **PAR** panel from PANELS, or click the aircraft's name in your FINAL Bay. It shows the approach (runway or deck, glidepath
  angle, TCH, DA, final approach course), the aircraft (its callsign; on the carrier its side number), its ground speed, vertical speed and
  range to touchdown, and two scopes: elevation and azimuth against range from touchdown. Touchdown is always in the bottom-left corner."
- "Wheel zooms the range of both scopes; Shift+wheel zooms the height (elevation) or the lateral offset (azimuth) of the scope under the
  pointer. There is no panning. With **Autoscale** on (Settings → PAR) the window follows the aircraft until it is 10 NM wide; any zoom
  pauses it, a double-click resumes it."
- "The panel is grey while the approach is normal. The aircraft is the magenta diamond. Red means outside your tolerance (±1° by default,
  Settings → PAR) above DA; below DA nothing is coloured. Amber `NO PLOT` means no new radar plot for 3 seconds. An orange-red scope with
  `NO ELEVATION DATA` or `NO AZIMUTH DATA` has failed; the reason is under it."
- "If the approach publishes no glidepath angle, your default glideslope (Settings → PAR, 3.06°) is used."
- "With more than one aircraft on your finals, their names appear above the header; click one to watch it. Your choice stays until it
  leaves the final."
- "Landing assured and Missed approach (on the carrier: Ball and Waveoff) are in the panel and on the aircraft's line in the FINAL Bay."

## Walks

Done (e2e `par-panel.spec.js`, samples injected over the real server's frames, the real Board):
- **Missed approach mid-run** (05): the PAR panel's button → `par-missed`; the server's next frame is empty → the panel empties.
- **A second aircraft joining the final** (05): the picks appear, the scopes stay on the first (nearest), a click switches, the pick holds
  while the other is nearer, falls back when it leaves.
- **The sample stopping** (06): Landing assured → empty; then the controller signs off: the server's one empty frame clears the panel.
  Finding: signing off **PAR alone** does not stop it when the same controller holds AP (AP takes PAR's hat, ADR 0110, and is sent the same
  sample) — correct by ADR 0110, so the spec signs off everything.
- **The landing runway changing** (05): `LTAG-05` → `LTAG-23` mid-approach: header and FAC change, the trail is cleared.
- Also: on/above/below/left/right, inside "slightly off" grey, below DA uncoloured with the dashed lines from DA, no plot 3 s amber and
  cleared by a fresh plot, EL INOP, autoscale golden-ratio / 10 NM floor / manual pause / Shift vertical / double-click resume / setting off,
  own glideslope vs published, the Settings tab, a carrier lane by side number with Ball/Waveoff (Waveoff sent).

Not walked: a live DCS (real plots, timing of fixes vs the 500 ms frame); a controller holding both CV_APP1 and CV_APP2 with live
samples on both (the picks are tested with an injected second sample); the panel at very small sizes (the scopes have a 90 px floor and
the panel scrolls).

## Findings

1. **`docs/efsp-briefing.md` still describes `final-panel.js`** (lines ~98, ~967–1011: the FINAL component, its 18 tests, the cadence
   bar). Shared doc, not edited: it should say the FINAL Bay is a flight list and the picture is the PAR panel (`par-panel.js`, `par-model.js`).
2. **A Bay view redrawn at 2 Hz must update in place**: rebuilding the FINAL view per sample detached its buttons under a click (Playwright
   retried for 60 s; a person's click would be lost the same way). Anything else that subscribes to `par` and rebuilds DOM should do the same.
3. **Signing off PAR while holding AP keeps the sample** (ADR 0110 hat): expected, but worth a line in the guide.
4. The FINAL Bay's flight line and the carrier Strip's DIST Block both show the range on a carrier lane (the Strip stays under the line).
   Harmless; the supervisor may prefer the line without range on the carrier.
5. PAR-1 open point (b) (PriFly/Marshal see no DIST) is unchanged: the PAR panel shows only samples sent to this session.

## Gates

| Gate | Before | After |
|---|---|---|
| crc-desktop `npm test` | 1247 | see report |
| crc-sync `npm test` | 2643 (1 timing flake in the grpc client's abandon test under load) | see report |
| module-graph fixture | | re-recorded: `final-panel.js` gone; `par-model.js`, `par-panel.js` added; `bay-views.js` exports `finalKindOf`, `finalRowModel` instead of `finalSampleFor`, `finalTerminalOp` |
| no-cycle / no-window-globals / html-sinks | | green (`par-model.js` added to `NEVER_IN_A_CYCLE`) |
| Playwright (E2E_LANE=3, each file alone) | | `par-panel` 7/7, `l18-incirlik` 3/3, `l17-carrier` 6/6, `side-swap` 2/2, `settings-tabs` 1/1, `smoke` 1/1 |
