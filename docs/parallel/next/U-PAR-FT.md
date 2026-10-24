# Briefing: U-PAR-FT (server + client): PAR after the final test (H164)

Written 2026-10-24 by the supervisor. One agent, Opus 5.5. `docs/parallel/lane-rules.md` binds (worktree
`/home/nklx/dev/personal/sourcedcs-U-PAR-FT`, branch `lane/U-PAR-FT`, `E2E_LANE=7`). **ADR 0139** (yours). Read H164,
S-ARCH-93, H134 LT-RQ8/RQ9, ADR 0117 and ADR 0130 in `decisions.md`/`docs/adr/`. H160 binds (no literal Position ids,
design for N finals/airfields). This tip has the corrected LTAG course (U-LTAG-COURSE): judge the PAR display on it.

**Beside you:** U-FT-SMALL edits `crc-sync/src/efsp/conformance.js` (the heading grace, outside the final) and
`strip-fields.js`; U-LABEL-MENU edits the map track label; U-PERF edits metrics. In `conformance.js` touch only the
on-final gating; expect a small merge.

## Items

1. **No conformance alerts once PAR has the flight** (FT-Q8, supersedes H134 LT-RQ8 for the PAR final). Today altitude is
   checked until "Begin descent", so PAR's own intermediate "descend and maintain 3,000" raises a bust. New rule: from the
   moment the PAR (final) Position holds the flight, no HEADING, no LEVEL_BUST, no wrong-way; a missed approach keeps
   today's re-check of the climb-out (¶5-10-12, H137) — say in the ADR whether that still holds and why. Find where "on
   final" is decided (`conformance.js` ~334 `onFinal`) and widen it to "held by the final Position", by role/Facility
   data, not an id.
2. **Glideslope warning.** The only alert on a PAR final: the track leaves the glidepath (outside the elevation
   tolerances PAR already draws, `tolElHighDeg`/`tolElLowDeg`, ADR 0130), after Begin descent; above and below, with a
   short persistence. Check first whether anything already raises it (`par-monitor.js`); dark cockpit: shown on the PAR
   panel row and the Strip, no new colour beyond the existing alert style.
3. **Azimuth autoscale removed** (FT-Q7 c): the azimuth window no longer grows with the track (`par-model.js`
   `autoscaleView`); a fixed default width (±3° unless the code suggests a better one), the controller keeps wheel/Shift
   zoom and pan. Range and elevation autoscale unchanged.
4. **Needed final heading + current heading** (FT-Q5 a + note): for the PAR-selected flight, the magnetic heading that
   holds the final course (course + wind correction from the field wind and the track's groundspeed/TAS), as a readout
   and a tick on the azimuth scope; the track's current heading beside it. Source the wind the same way ATIS/tower does
   (magnetic, H76).
5. **APRT extended centreline 3° off** (S-ARCH-93): `geojson.js` / `aprt-panel.js` draw it from the runway number × 10
   as magnetic. Use the runway end's true heading from the facility data (add the airfield id to the runway-status view
   if needed; that is a record-content change: `npm run wire:record -- --bump` only if the script needs it, protocol is
   already ahead of the release).

## Gates
Unit tests per item; both unit suites before the report; `npm run walk`, `npm run freeze` (goldens: `freeze:update`,
own commit, explain); `soak:selfcheck` if you touch `ws-hub.js`/`wire/**`; specs `par-panel*`, `aprt*`, smoke on
`E2E_LANE=7`. `nice -n 19` always. Output `docs/wip/U-PAR-FT.md`, ADR 0139; report per rule 8.
