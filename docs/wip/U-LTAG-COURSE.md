# U-LTAG-COURSE: the LTAG final reads 046/047° here and 049.6° in DCS

Lane U-LTAG-COURSE (H163, S-ARCH-91). Branch `lane/U-LTAG-COURSE`.

## The numbers at LTAG

Source data: the squadron mission `STT_v21.0.3_DAY_CAVOK.miz` (theatre Syria, date **2026-08-27**). Its blue
nav points include the thresholds `RW05`/`RW23` and the RWY 05 final fixes `3IN05`, `4IN05`, `7IN05`, `9IN05`
(also `GECEG`, `GOMSE`, `JAKUP`; 23 side `WUNSO`, `HABIM`, `JAYBY`, `3IN23`…`9IN23`). crc-sync turns them into
lat/lon with DCS's own `coord.LOtoLL` (`grpc-client.js` `_getNavpoints`), so both maps show the same points. I
reproduced the conversion offline with the Syria Transverse Mercator (`tools/miztoyaml/projection.py`).

| Quantity | Value |
|---|---|
| RW05 → RW23 in DCS x/z (grid bearing) | **055.00°** (length 3,026 m) |
| Every final fix → RW05 in DCS x/z | **054.99–055.00°**: the mission maker laid them on the grid line |
| The same, as a geodesic (TRUE) bearing from lat/lon | **052.6–052.7°** (runway 052.72°) |
| The real runway (aeronautical database) | 052.9° true; thresholds 36.9937 N 35.4122 E / 37.0103 N 35.4395 E, about 35 m from DCS's |
| Grid convergence γ at LTAG (`convergenceAt`, lon0 = 39) | **−2.15°** (true = grid + γ) |
| WMM2025 variation at LTAG, 2026-08-27 (`variationAt`) | **5.74° E** |
| Our display of the final: 052.7 − 5.74 | **046.9 → "047"** (a fix-to-fix measure reads 046 or 047) |
| DCS's reading | **049.6°** |
| Variation DCS would need for 049.6 from the grid bearing: 055.0 − 049.6 | 5.4° (0.34° under WMM2025) |
| Variation DCS would need for 049.6 from the true bearing: 052.7 − 049.6 | 3.1° (no model gives that for Syria in 2026) |

## Candidates

1. **Magnetic variation (the model).** WMM2025 gives 5.74° E. DCS-gRPC's `GetMagneticDeclination` does not
   read DCS: it evaluates IGRF (the Rust `igrf` 0.2 crate) at the scenario start date, and its own proto
   comment says it "is not always exactly the same as what DCS seem to use" (`src/rpc/custom.rs`,
   DCS-gRPC/rust-server main). It also negates the crate's value (`.neg()`), so check the sign before using it.
   IGRF and WMM usually agree to a tenth of a degree or two. **Size: at most about 0.3° (5.74 vs the 5.4 that
   DCS's reading implies). Verdict: not the cause.** I did not ask the live server (rule: no shared DCS calls).
2. **Grid convergence / projection.** We compute every scope bearing from lat/lon (great circle, TRUE:
   `geo.js` `bearingDeg`, the measure line, the BRA, the track heading), and turn it into magnetic once
   (`magnetic.js` `magneticText`). Nothing corrects a true bearing twice. The waypoint lat/lon is DCS's own
   conversion, and it matches the real runway to about 35 m and 0.2°. **Our numbers are right.** DCS's 049.6
   fits a bearing measured from **grid north** and then corrected by DCS's variation: 055.0 − 5.4 = 049.6.
   It does not fit a true bearing (that would need a 3.1° variation). **Size: 2.15° of the 2.7–3.1° gap.
   Verdict: the cause.** DCS's F10 and Mission Editor ruler measure on DCS's flat x/z map, which is grid. ED
   forum users report the same thing. One example: at Batumi (Caucasus, γ ≈ +5.7°) the ruler read 126 for a runway
   the HSI showed as 120, when DCS did not yet model variation there. That is 126 − 5.7 ≈ 120: ruler = grid,
   HSI = true.
3. **The measurement on our map.** `topbar.js` `updateMeasureLine` measures a true geodesic bearing and shows
   it magnetic at the line's start through the variation grid crc-sync sends (bilinear, within 0.05° of the
   server). 052.7 − 5.74 = 046.9, so the label reads 046 or 047, depending on which two points are clicked
   and on rounding. **Verdict: correct.**
4. **The final-course lines we draw.** These had real errors (one is fixed here):
   - **The shipped Incirlik facility said 056/236 true** (`endHeadingsTrue`, PAR `courseTrueDeg`). That was the
     runway number read as magnetic (050 + 5.7). The DCS runway is 052.7/232.7, so the PAR centreline was
     **3.3° off the pavement**: 0.58 nm (about 3,500 ft) at 10 nm. The PAR thresholds also came from the airfield
     reference point moved along that wrong heading, which put them about 110 m off the DCS runway ends.
     **Fixed** (commit `34d5b6b5`): 52.7/232.7, and the thresholds are DCS's RW05/RW23. The PAR panel
     now reads the final as 047 instead of 050. This is likely part of H163's "PAR azimuth: cannot judge
     centreline" (for U-PAR-FT).
   - **The APRT extended centreline** (`geojson.js` `buildExtendedCenterline`, `aprt-panel.js`
     `_updateAprtRwyHeading`) is drawn from the typed runway **designator × 10** as magnetic. "05" becomes
     050 M = 055.7 true, so the line is **3.0° off the runway** and off the DCS final fixes on our own map.
     A designator is a number rounded to 10°, not a course. **Not fixed** (see "Findings for other lanes"): the
     client has no runway course for an airfield. The runway-status record it receives carries
     `endHeadingsTrue` but no `airportIcao`, so a fix changes the record contents (`wire:record -- --bump`)
     and touches client map code beside U-SURFACE.
   - The topbar approach vector draws whatever course the controller types, converted on the server. It is
     correct when the typed course is correct.

## Cause

On our map the final fixes lie on 052.7° true, which is 047° magnetic with WMM2025 on 2026-08-27. That is the
real-world answer: the real runway is 052.9° true. DCS's 049.6° is the same line measured from DCS's **grid
north** (055.0°) less about 5.4° of DCS variation. So the 2.7–3.1° gap is **grid convergence (−2.15°) plus
about 0.3–0.5° of model difference and rounding**. It is not a conversion bug on our side. Separately, two of
the lines we draw were 3° off the runway: the PAR course (fixed) and the APRT centreline (open).

## Checks for the human (one each, not run by me)

1. **Cockpit check (decides the options below).** Line up an aircraft on LTAG RWY 05 and read the HSI/HUD
   magnetic heading. Our model predicts **047**, and our track panel should show the same. If the cockpit
   reads about 047, the scope agrees with the aircraft and only DCS's ruler is off. If it reads about 050, DCS
   cockpits are grid-referenced too (contrary to the forum evidence).
2. **Ruler check.** On the F10 map, measure RW05 → RW23. The prediction is 049–050 (grid 055 less DCS variation).
3. **DCS-gRPC's declination**, if wanted (IGRF, not DCS's internal value; check the sign):
   `grpcurl -plaintext -import-path crc-sync/protos -proto dcs/custom/v0/custom.proto -d '{"lat":37.0021,"lon":35.4259,"alt":0}' "$CRCSYNC_DCS_GRPC_HOST" dcs.custom.v0.CustomService/GetMagneticDeclination`

## Options for the human (H15/H69 are yours). No model change made

- **A. Keep WMM2025 on true bearings (recommended).** It matches real charts (real RWY 05 is 047 M in 2026)
  and, by the forum evidence, the cockpit HSI. Controllers vector by what the aircraft flies, so the
  cockpit is the reference. DCS's F10/ME ruler stays about 2–3° off at LTAG, which is a DCS quirk and can go in
  the usage guide ("the DCS ruler measures from grid north").
- **B. Match DCS's ruler:** show grid bearing less variation, which adds convergence to every display. The scope
  would agree with the F10 ruler but disagree with the cockpit and the real world. The difference is 2.15° at
  LTAG, 0 on the 39° E meridian, and larger toward the map edges. Only worth it if check 1 shows grid-referenced
  cockpits.
- **C. Take DCS-gRPC's `GetMagneticDeclination`.** It is IGRF, not DCS's own value, and is within a few tenths
  of WMM2025. It would not close the gap (convergence is the gap) and adds a DCS round trip. Not recommended.
- **D. A Syria `offsetDeg` (−2.4).** This is wrong away from LTAG, because convergence changes with longitude
  (−2.15 at LTAG, about 0 at 39° E, +2 at 42° E). Not recommended.

## Defaults taken

- The DCS runway geometry is the mission's RW05/RW23 nav points (DCS `coord.LOtoLL` of them), not the airfield
  reference point. Both are DCS data, and the nav points match the real thresholds to about 35 m.
- `endHeadingsTrue` and `courseTrueDeg` use one decimal (52.7/232.7). The schema accepts it, and rounding
  to 53 would leave 0.3°.

## Findings for other lanes

- **U-PAR-FT:** the PAR course was 3.3° off the runway until `34d5b6b5`. Re-judge "cannot judge centreline"
  and the azimuth autoscale on this tip before changing the scale.
- **APRT centreline (a client lane, wire bump):** draw it from the runway's true course, not designator × 10.
  Proposal: add `airportIcao` to the runway-status view (`runway-status-store.js` `getRunwayStatus`; record
  contents need `npm run wire:record -- --bump`). The APRT panel then uses `endHeadingsTrue[end]` when its
  airfield's ICAO and the typed end match a runway record, and falls back to the designator elsewhere, with
  a hint that the line is approximate. Ideally anchor it at the threshold, not the reference point.
- **Usage guide:** the DCS F10/ME ruler measures from grid north. At LTAG it reads about 2–3° more than our
  magnetic bearings for the same two points.
