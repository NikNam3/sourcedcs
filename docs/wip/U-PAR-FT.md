# U-PAR-FT: PAR after the final test (H164) — lane note

ADR 0139. Branch `lane/U-PAR-FT`, cut from 931d5687.

## What was built

1. **No conformance once the final Position holds the flight** (FT-Q8). `crc-sync/src/efsp/final-position.js`
   (`flightsHeldOnFinal`): a FINAL Strip in ON_FINAL/BALL owned by a Position that owns a `view: 'final'` Bay of its
   Facility. `monitors.js`'s `finals` uses it (the `'CARRIER'` literal is gone); `conformance.js` then checks no heading
   and no altitude at all. Missed approach: checked again (BOLTER_WAVEOFF / the conversion back to AP are not "on a final").
2. **GLIDESLOPE** (`evaluateGlidepath`): after Begin descent, above DA, outside +1°/−0.5° for 2 s
   (`alerting.json` `glidepathAboveDeg` / `glidepathBelowDeg` / `glidepathPersistSec`), from `ParMonitor#glidepathOf`
   (fresh plot ≤ 3 s, elevation not INOP). Client: EL row `BELOW/ABOVE GLIDEPATH` in red, Strip chip `GP ↓/↑` (red,
   `efsp-conf-glidepath`).
3. **Azimuth autoscale removed** (FT-Q7 c): fixed ±3° (`DEFAULT_VIEW.azMaxDeg`); Shift+wheel on azimuth zooms without
   pausing autoscale (`zoomPausesAutoscale`); double-click resets it to ±3°.
4. **Final heading + current heading** (FT-Q5): PAR sample `headings { needed, current, windFrom, windKt }` (magnetic);
   `par.neededHeading` (course + WCA, TAS from ground vector − wind); field wind from `airport-weather.js` (moved before
   `buildMonitors` in `app.js`). Panel: `FIN HDG 049  HDG 054` on the deviation row, a heading tick scale at the top
   middle of the azimuth scope.
5. **APRT centreline** (S-ARCH-93): runway-status record carries `airportIcao`; `panels/aprt-runway.js`
   `facilityRunwayTrueDeg` gives the end's `endHeadingsTrue`; fallback number × 10 magnetic for fields with no Facility.

## Defaults taken (P2)

- "PAR has the flight" = the FINAL Strip owned by a final-Bay Position in ON_FINAL/BALL (role from Facility data). A
  pending (unaccepted) handoff still counts as AP's.
- The glidepath alert limits are server-wide and equal the panel's *default* tolerances; a controller's own panel
  tolerance setting does not move the alert (only the drawn lines and the instant red). Persistence 2 s (ours).
- Glidepath alert only after Begin descent is recorded and only above DA (H116); none on the carrier (no PAR).
- The heading readout label is `FIN HDG` (not "NEED"/"REQ": the spec and H115 keep "need" and required calls off the panel).
- "A tick on the azimuth scope" was read as a small ±10° heading scale at the top middle of the azimuth scope (needed
  heading grey and labelled, current heading magenta, hollow at the edge). Ours; the supervisor may want another form.
- Azimuth default window ±3° as the briefing said. **No pan added**: none existed ("no pan", H115); the human's "move"
  is served by zoom. Supervisor: ask if a pan is wanted.
- APRT centreline still starts at the airfield reference point, not the threshold.
- No needed heading without a field wind (shown "—"), never the bare course.

## Gates

See the report. Specs run on E2E_LANE=7: `par-panel` 9/9 (01 updated for ±3°, new 09), `u-panels` and `smoke`.
No spec named `aprt*` exists; the APRT change is covered by `tests/aprt-runway.test.mjs` and `u-panels`.

## For the guide/briefing (docs pass)

- §8L PAR: "From the handoff to PAR nothing of the clearance alerts; after Begin descent the only alert is GLIDESLOPE
  (outside +1°/−0.5° of the glidepath for 2 s, above DA), on the EL row and the Strip's `GP` chip." Replace the old
  "altitude checked until Begin descent".
- PAR panel: `FIN HDG` (the heading that holds the final course in the field wind) and `HDG`, and the heading tick; the
  azimuth window is fixed at ±3° (Shift+wheel to zoom, double-click to reset).
- APRT: the extended centreline follows the runway's true heading where a Facility describes the field.
- Stale comment: `surveillance/par-monitor.js` header still says nothing of the glidepath alert (fine), `par-final.js`
  BEGIN_DESCENT note "altitude conformance has nothing to check" is now moot (nothing is checked on the final anyway).

## Findings for other lanes

- U-FT-SMALL (conformance.js heading grace): my edit is the on-final gating in `tick()` plus the header block and a new
  `evaluateGlidepath`; expect a small merge in the header comment.
- `par-final.js`'s `CARRIER_FACILITY = 'CARRIER'` literal (used by `conversionFor` and `final-call.js`) is pre-existing
  and still there (H160 item 1, U-ROLE-POSITIONS); not touched beyond conformance.
- The e2e fixture `APPROACH_05.courseTrueDeg: 56` in `par-panel.spec.js` is the pre-U-LTAG-COURSE value (harmless:
  injected data).
- `tracks.js` stores `heading: unitData.heading || 0`, so a unit with no heading reads 000; the PAR `HDG` would show 360
  then. Not changed.
