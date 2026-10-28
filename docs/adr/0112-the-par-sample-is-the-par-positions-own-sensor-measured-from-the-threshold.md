# 0112: The PAR sample is the PAR Position's own sensor, measured from the threshold or the moving touchdown point

**Status.** Built (lane PAR-1, 2026-10-11). Rulings: decisions.md **H115** (the PAR panel design), **H116** (default glideslope
3.06°, an approach's published angle wins; ±1° tolerances, none below DA; per-controller settings). Briefing:
`docs/parallel/next/CARRIER-PANELS.md` §5. Research: `docs/wip/PANELS-DESIGN.md` (its findings about the code; its panel designs
are superseded by the mockup `docs/mockups/par-panel.html` rev 4). Builds on ADR 0059 (a controller is told what its own sensors
know), 0075/0093 (the FINAL Bays and their view), 0096 (wall clock for durations, mission clock for facts), 0103 (wire
protocol), 0110 (taking the hat), 0113 (the carrier's state). Lane notes: `docs/wip/PAR-1.md`.

## Context

The FINAL Bay view (`final-panel.js`, `bay-views.js finalSampleFor`) measured an aircraft on final in the client from two things
the client had: the contact's position and altitude on the wire, and a reference point. For PAR the reference was the approach
radar's site (the DCS airfield reference point) and the glidepath was measured from its elevation plus the radar's 15 m antenna
height; for the carrier it was the ship's DCS position, from the last banner. All three are wrong for a precision approach:

- range was to the airfield reference point, not the threshold (off by the ARP-to-threshold distance, about 0.8 NM at Incirlik),
  and on the carrier to the ship's centre, not the touchdown point;
- the wire altitude is SSR Mode C, rounded to 100 ft (`presentation.js`), about 0.9° of glidepath at 1 NM: "slightly" and "well"
  cannot be told apart;
- the carrier banner's position is republished only on a whole-degree BRC step (`shipStateChanged`), so for a ship steaming
  straight it can be minutes old;
- there was no azimuth at all, and no plot history.

A PAR is a sensor that measures the aircraft itself, in range, azimuth and elevation, under a second (AN/FPN-68A: "update period
under one second", PANELS-DESIGN S5). The panel the human approved draws elevation and azimuth scopes against range from
touchdown, with a trail (H115). That needs exact numbers only the server has.

## What the sources say (the part we use)

- **FAA JO 7110.65 5-12-4** (PAR, terminal): the controller gives "elevation and azimuth information" with reference to the
  glidepath and the course ("SLIGHTLY/WELL ABOVE/BELOW GLIDEPATH", "SLIGHTLY/WELL LEFT/RIGHT OF COURSE") and range "at least once
  each mile" from touchdown (5-12-5); 5-12-10: the elevation part may fail and the approach continue on azimuth only ("NO GLIDEPATH
  INFORMATION AVAILABLE"). So the sample carries elevation and azimuth separately, each able to fail on its own.
- **AIM 4-5-4** (PAR): "two antennas … one scanning a vertical plane, and the other scanning horizontally"; "the range is limited
  to 10 miles, azimuth to 20 degrees, and elevation to 7 degrees". **AN/FPN-68A** (PANELS-DESIGN S5): range 20 NM clear, azimuth
  30°, elevation −1° to +7°, update under 1 s. Our coverage volume is the newer system's.
- **FAA Order 8260.3B** (PANELS-DESIGN S6): a PAR's obstacle criteria follow ILS for glidepath angle, threshold crossing height and
  DA. So an approach is described by threshold, course, TDZE, TCH, GPA and decision height, as an ILS is.
- **The carrier** (PANELS-DESIGN §1.3, S10): the CCA final controller's Mode III is the carrier's PAR; the optical glideslope is
  nominally 3.5°.

## Decisions

1. **The sample is computed on the server** (`crc-sync/src/surveillance/par.js`, pure; `par-monitor.js`, stateful) from DCS
   ground truth, never from the wire picture. Exact to the foot, 0.01 NM and 0.01°: a PAR measures height itself, the 100 ft
   rounding is SSR Mode C's and is not applied.
2. **Geometry: a reference point, a course and a glidepath.** Range is measured **along the final approach course** from the
   reference point (positive on the approach side), azimuth deviation is the cross-track distance (positive right of course as
   the pilot sees it), height is above TDZE, and the glidepath passes over the reference point at TCH at the GPA: deviation in
   feet = height − (TCH + range × tan GPA), elevation angle = atan((height − TCH) / range), deviation in degrees = that − GPA. That
   is the mockup's model (`gpHeight(r) = TCH + r·tan(GPA)`) and 5-12's words. Measured on the azimuthal equidistant projection
   centred on the reference point (great-circle distance along the initial bearing), which is how a radar at that point would
   see it.
   - **A runway** (Incirlik): the reference point is the **landing threshold**. Facility config gains an optional
     `parApproaches`, keyed by runway end (each must be an end of the Facility's `runwayStatus`): `label`, `thresholdLat`,
     `thresholdLon`, `courseTrueDeg`, `tdzeFt` (null: the DCS airfield elevation, what aircraft fly over in DCS), `tchFt`,
     `decisionHeightFt` (HAT; DA = TDZE + it), `glideslopeDeg` (null: none published). Validated with the rest of the file
     (`validateParApproaches`); every shipped value is `[SOURCE-DEFINED]` until someone copies the LTAG PAR plate. The approach a
     Strip is on is the runway end it lands on, resolved as every runway question is (`resolveRunwayForStrip`: the flight's
     assigned landing runway, else the active runway).
   - **A carrier lane**: the reference point is the **touchdown point on the angled deck**, worked out each tick from the **live**
     ship track (matched as the carrier tick matches it) and a new, required hull config key `approach`
     (`touchdownAftM`, `touchdownPortM` along the ship's heading, `deckHeightFt` = TDZE, `tchFt` 0, `decisionHeightFt` 200,
     `glideslopeDeg` 3.5, all `[SOURCE-DEFINED]`, 3.5° to be confirmed). The course is the landing area's centreline: the ship's
     live true heading less `angledDeckDeg`. It is not the final bearing in force (ADR 0113), which may be typed: the PAR
     measures against the deck where it is, and the two agree when the ship steers its BRC. So the touchdown point moves with the
     ship and the course turns with it.
3. **The glideslope.** An approach's published angle wins (H116); with none, `config/par.json`'s `defaultGlideslopeDeg` 3.06
   is used and the sample says `gpaPublished: false`, so a client whose controller set another default recomputes the elevation
   deviation from `heightFt`, `rangeNm` and `tchFt` (they are all in the sample). Tolerances, colours and "below DA" are the
   client's (H116); the server sends the same sample above and below DA.
4. **One sample per aircraft on a final.** On a final means a FINAL Strip in state ON_FINAL in a Bay whose descriptor says
   `view: 'final'` (`par-final`, `cv-app1-final`, `cv-app2-final`). A missed approach, Landing assured, Ball or Waveoff moves the
   Strip out of that state, so the sample ends with the op that ended the talk-down, and a Strip that comes back starts a fresh
   trail. A second aircraft on the same final (the carrier lanes have no capacity of one) gets its own sample. **The flight is
   identified by `stripId`** (and `facilityId`, `positionId`): the client already holds the Strip and its flight data, so it shows
   the side number on a carrier lane and the callsign at Incirlik from what it has (H122), and nothing about the flight's
   identity is repeated in the sample.
5. **A plot** is taken when DCS has moved the aircraft since the last one **and** it is inside the PAR's volume (an antenna at TDZE
   0.5 NM beyond the reference point; 20 NM, ±15°, −1° to +7°, `config/par.json`). Otherwise the sample keeps its last plot and
   `plotAgeMs` grows (a duration, on the injected wall clock, ADR 0096); the client's amber "NO PLOT" after 3 s reads it. The last
   12 earlier plots ride along (`trail`, oldest first, each as it was measured, so a carrier turn does not redraw history), so a
   controller who signs on mid-approach sees the trend at once.
6. **Each scope can be INOP on its own**, with a reason: `NO_APPROACH` (no PAR approach for the runway, or none resolvable: both),
   `NO_SHIP` (the hull is not found: both), `NO_COURSE` (no ship heading: both), `NO_TDZE` (no TDZE in the config and none from
   DCS: elevation only; the azimuth still works, as 5-12-10 allows).
7. **Delivery: a `par-sample` frame, not a field on an existing frame and not an EFSP frame.** `WsHub#sendParSamples`, run by the
   named ticker `par` every `sampleMs` (500 ms, under the 1 s H115 asks for), sends each session one frame
   `{ version: 1, type: 'par-sample', at, samples }` with only the samples whose Position (the Strip's owner) that session is
   signed on to, Primary or Observer; a session that had samples and has none now gets one empty frame, and a session that never
   had any gets nothing. `at` is the mission clock.
   - **Why its own frame:** the track `delta` is per-sweep and per-contact for everyone with a radar, and the PAR sample is per
     Strip, for one Position, twice a second; folding it into the delta would put Strip ids into the radar picture and make every
     delta carry a field only one controller reads. A field on an EFSP delta would make it sequenced state.
   - **Why not an EFSP frame** (`wire/frames.js`, `deliverEfsp`): it is a sensor's output like the track delta, not a store
     change. It has no seq or epoch, nothing to resync (the next tick replaces it) and nothing to audit, and `deliverEfsp`'s
     post-change hook would re-run the obligation check twice a second for nothing. The ADR 0095 rule "every EFSP frame through
     `deliverEfsp`" stands: this is not one.
   - **Who may see it** (ADR 0059, 0080): the PAR is the Position's own sensor, so the sample goes only to the Position that works
     the final, and the read scope is satisfied by construction (a session signed on to a Strip's owning Position can read that
     Strip). If the PAR controller signs off mid-approach the Strip stays PAR's (ADR 0110), the panel clears, and whoever takes PAR's
     hat (signs on to PAR) gets the same sample, trail and all, on the next tick.
8. **The FINAL range bug is fixed everywhere it was used.** The client's FINAL view now takes its range, height, glidepath
   deviation and DA from the PAR sample (`par-samples.js`, a leaf module), and measures nothing from the approach radar's site;
   the carrier FINAL Strip's DIST Block shows the PAR's range to the touchdown point, or nothing for a session that is not sent
   the sample (it used to measure from the ship's centre on a possibly minutes-old banner). The rest of the PAR panel is PAR-2's.
9. **Wire.** `par-sample` joins the server-to-client types; `tools/wire-surface.js` records the frame's keys and the sample's
   entry, approach, plot and trail keys and the INOP reasons (`par.js` exports the lists). The hull view gains `hull.approach`.
   `WIRE_PROTOCOL` stays 2 (already ahead of the last release, 1).

## Consequences

- The PAR panel (PAR-2) draws from `par-sample` alone: scopes against `rangeNm`, `heightFt` / `elevDevFt` / `azDevFt`, the trail,
  `approach` for the header (label, GPA, TCH, DA, course magnetic), `sensor` for EL/AZ INOP, `plotAgeMs` for NO PLOT.
- `config/efsp-carriers.json` must carry `approach` on every hull: a hull without one stops start-up, naming it (no fallback, as
  for `angledDeckDeg`). A `state/efsp-carriers.json` copy made before this change must gain it.
- `config/par.json` is a new tuning file (read once, never written; a `state/` copy layers over it, unknown keys refused).
- Every geometry value is `[SOURCE-DEFINED]`: the Incirlik thresholds are worked out from the airfield reference point and an
  assumed 10,000 ft runway centred on it, the carrier touchdown offsets and deck height are estimates for a Nimitz-class hull. The
  squadron owes the LTAG PAR plate and a check of the touchdown point on the DCS model.
- A carrier DIST Block seen by anyone but the lane's controller is blank. If PriFly or the Marshal need it, the touchdown point
  belongs in the carrier view with a live position, which today's banner does not have.
