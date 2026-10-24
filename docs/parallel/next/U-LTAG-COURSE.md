# Briefing: U-LTAG-COURSE (investigation first): the LTAG final reads 046/047° here, 049.6° in DCS

Written 2026-10-24 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-LTAG-COURSE`, branch `lane/U-LTAG-COURSE`, `E2E_LANE=6`). No ADR number until the
supervisor gives one (the cause decides whether ADR 0085 needs a successor). Read H163 in `decisions.md`.

## The finding (human, final test 2026-10-24)

"LTAG final course line off by a few degrees compared to the DCS map. There are waypoints on the extended final that
come from DCS. On our map they line up along magnetic 046/047°; in DCS they are on 049.6° magnetic." Both maps show
the **same DCS points**, so the error is in how we turn positions into a magnetic bearing (or in how we draw the
final-course line), not in the data. 2.5–3.5° is the size to explain.

## Phase 1: find the cause (report before fixing anything big)

Measure each candidate with numbers, at LTAG (≈ N37°00′ E035°25′), on the mission date the human flies:

1. **Magnetic variation.** We use the World Magnetic Model at the mission date (`crc-sync/src/magnetic.js`, ADR 0085,
   `config/theaters.json` override, none shipped). DCS has its own model, and DCS-gRPC exposes it:
   `CustomService.GetMagneticDeclination` (`crc-sync/protos/dcs/custom/v0/custom.proto:35`). Compare our value at LTAG
   with what DCS would give (find what model/epoch DCS uses; from DCS-gRPC source or docs). Do **not** call the shared
   DCS server yourself: if a live number is needed, write a one-line command the human runs (as `terrain:validate`
   does) and say so in the report.
2. **Grid convergence / projection.** DCS x/z is a Transverse Mercator grid (Syria central meridian in
   `config/theaters.json`); at LTAG convergence is about −2°. Check every place a bearing is computed: from lat/lon
   (true) or from x/z (grid)? A grid bearing labelled true, or a true bearing corrected twice, gives exactly this size.
   Check the DCS→lat/lon conversion of the waypoints too.
3. **The measurement itself.** Find what the human read as "046/047" on our map (the ruler/measure line in
   `crc-desktop/app/public/js/panels/topbar.js` `updateMeasureLine`, the final-course line from the facility file's
   course, or the runway drawing) and how it converts true → magnetic (client mirror of the variation?). Find what
   DCS's F10 ruler reports (true, magnetic, grid?) from DCS docs/forums.
4. **The final-course line.** Where the facility file's LTAG final course and threshold come from (ADR 0130 values,
   `efsp-facility-incirlik.json`) and whether they are true or magnetic; compare with the runway's real 05/23 true
   heading.

Write the numbers in `docs/wip/U-LTAG-COURSE.md` (each candidate, its size at LTAG, verdict). If the cause is a clear
code bug (a wrong conversion), fix it with a unit test that pins the LTAG numbers, commit, and report. If the cause is
"DCS uses a different magnetic model than WMM", **do not** change the model: report it with the options (follow DCS's
declination from gRPC, a per-theater offset, keep WMM) and a recommendation; the human decides (H15/H69 are theirs).

## Gates

Unit tests for what you touch, both unit suites once before the report (`nice -n 19`). No Playwright unless you
change the client drawing (then the specs of that panel only, `E2E_LANE=6`). Final message per rule 8.
