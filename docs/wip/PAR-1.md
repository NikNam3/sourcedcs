# Lane PAR-1 (2026-10-11): the PAR sample and approach geometry

Branch `lane/PAR-1`. ADR **0112**. Briefing: `docs/parallel/next/CARRIER-PANELS.md` §5. Rulings: H115, H116 (H118/H119/H122 read;
H122 decides how the client names the flight). What was built: approach geometry per runway end (Facility config) and per hull
(hull config), a server-side PAR sample per aircraft on a final (`crc-sync/src/surveillance/par.js`, `par-monitor.js`), a
`par-sample` frame to the Position working that final only, and the FINAL range bug fixed in the client (FINAL view and the
carrier DIST Block read the sample). The PAR panel itself is PAR-2's.

## Sources cited (and what each was used for)

| Source | Used for |
|---|---|
| FAA JO 7110.65 5-12-4, 5-12-5 (via PANELS-DESIGN S1) | elevation and azimuth both, deviations from glidepath and course, range "from touchdown" each mile |
| FAA JO 7110.65 5-12-10 | the elevation part can fail alone and the approach continue on azimuth: separate `sensor.elevation` / `sensor.azimuth` |
| AIM 4-5-4 (S4) | two antennas, two scopes; the older coverage (10 NM, 20°, 7°) noted beside ours |
| AN/FPN-68A / PAR-2020 sell sheet (S5) | coverage 20 NM, azimuth 30° (±15), elevation −1° to +7°; update under 1 s (our 500 ms) |
| FAA Order 8260.3B 10.1.3 (S6) | PAR follows ILS for GPA, TCH, DA: the geometry's fields; HAT 100 ft possible for DoD (we take 200) |
| CV NATOPS via PANELS-DESIGN §1.3, S7, S10 | the carrier's Mode III is its PAR; 200-½ minimum (DH 200); optical glideslope nominally 3.5° |
| H116 | default 3.06°, a published angle wins, no tolerance below DA (client) |

## Geometry values: ours vs real

| Value | Ours (shipped) | Real / to confirm |
|---|---|---|
| LTAG RWY 05 threshold | 36.99444 N, 35.41157 E | worked out: ARP 37.0021 N 35.4258 E (crc-desktop's map centre) moved 1,524 m on 236°T, i.e. assumes a 10,000 ft runway centred on the ARP. Copy from the plate / DCS map |
| LTAG RWY 23 threshold | 37.00976 N, 35.44003 E | same, moved on 056°T |
| Final approach course | 056°T / 236°T (the facility's `endHeadingsTrue`), shown 051M / 231M at 5° E | plate |
| TDZE | `null` = the DCS airfield elevation (what aircraft fly over in DCS) | real LTAG 238 ft; DCS terrain may differ, so DCS's number is used until someone types the plate's |
| TCH | 50 ft | plate |
| Decision height | 200 ft HAT (DA = TDZE + 200; mockup showed DA 440 / HAT 202) | plate (DoD can go to 100) |
| GPA | `null` (none published): 3.06° default (H116), the controller's own default may replace it | plate |
| CVN-72 touchdown point | 90 m aft, 10 m port of the DCS unit position, along the ship's heading | **estimate**: measure the target wire on the DCS model |
| CVN-72 deck height (TDZE) | 66 ft | estimate (CARRIER-STATE used 20 m for the wind) |
| CVN-72 TCH | 0 ft (the glideslope meets the deck at the touchdown point) | ours |
| CVN-72 DH | 200 ft | CV NATOPS 200-½ |
| CVN-72 glideslope | 3.5° (published: the controller's default does not apply) | **to confirm** (S10: 3.5°, up to 4° in heavy seas) |
| PAR coverage | 20 NM, ±15°, −1° to +7°, antenna 0.5 NM beyond the reference point at TDZE | AN/FPN-68A; the 0.5 NM is ours |

## The sample (for PAR-2)

One frame per session per tick (500 ms) while the session works a final; one empty frame when that ends; nothing otherwise.
Registered client-side in `efsp-messages.js` (`par-sample`), stored in the leaf `panels/efsp/par-samples.js`
(`parSampleFor(stripId)`, `parSamples()`, `parSampleTimes()`), change-bus topic **`par`** (marked on every frame: subscribe to it).
The store is cleared on every `efsp-snapshot`.

```json
{ "version": 1, "type": "par-sample", "at": 1791717600000, "samples": [ {
  "stripId": "strip-7", "facilityId": "INCIRLIK", "positionId": "PAR",
  "approach": { "id": "LTAG-05", "kind": "RUNWAY", "label": "PAR RWY 05", "runwayEnd": "05", "airportIcao": "LTAG", "hullId": null,
    "gpaDeg": 3.06, "gpaPublished": false, "tchFt": 50, "tdzeFt": 238, "dhFt": 200, "daFt": 438,
    "courseTrueDeg": 56, "courseDisplay": { "value": 51, "ref": "M" } },
  "sensor": { "elevation": "OK", "azimuth": "OK", "reason": null },
  "plot": { "rangeNm": 3.36, "heightFt": 1135, "elevDeg": 3.04, "elevDevDeg": -0.02, "elevDevFt": -6,
    "azDeg": -0.15, "azDevFt": -55, "gsKt": 142, "vsFpm": -770 },
  "plotAgeMs": 500,
  "trail": [ { "rangeNm": 3.4, "heightFt": 1150, "elevDeg": 3.05, "elevDevDeg": -0.01, "elevDevFt": -4, "azDeg": -0.17, "azDevFt": -60 } ]
} ] }
```

- **Identify the flight** by `stripId` (the client holds the Strip and its flight data): side number on a carrier lane, callsign at
  Incirlik (H122). `approach.kind` is `RUNWAY` or `CARRIER`.
- **Range** `rangeNm`: along the final approach course from the threshold (runway) or the touchdown point (carrier); negative past
  it. This is the scopes' x-axis and the header's "NM to TD".
- **Elevation**: `heightFt` above TDZE (exact); `elevDeg` the angle from the glidepath origin (atan((h − TCH)/range));
  `elevDevDeg`/`elevDevFt` against `approach.gpaDeg`. **If `gpaPublished` is false and the controller's default differs from
  `gpaDeg`**, recompute: `elevDevDeg = elevDeg − ownGpa`, `elevDevFt = heightFt − (tchFt + rangeNm·6076.12·tan ownGpa)` (same for
  each trail entry). Angles are null at range ≤ 0. ALT readout = `tdzeFt + heightFt`.
- **Azimuth**: `azDevFt` cross-track, **positive right of course as the pilot sees it**; `azDeg` = atan(azDevFt / range).
- **DA**: `approach.daFt` (MSL) / `dhFt` (HAT). The glidepath reaches DA at range (dhFt − tchFt)/tan(GPA); below it no tolerance
  applies (H116) — the server sends the same sample either way.
- **NO PLOT**: `plotAgeMs` is the plot's age when the frame left; add the time since `parSampleTimes().receivedAt`. Amber at 3 s
  (H115). `plot` is null until the first plot (no contact, no correlation, out of coverage, or a scope INOP with no reference).
- **INOP**: `sensor.elevation` / `sensor.azimuth` are `OK` or `INOP`, `sensor.reason` one of `NO_APPROACH` (both; `approach` is
  null), `NO_SHIP` (both), `NO_COURSE` (both), `NO_TDZE` (elevation only). An INOP scope's fields in `plot` are null.
- **Trail**: up to 12 earlier plots, oldest first, each as measured at its time (a carrier turn does not redraw them).
- `gsKt` ground speed (not closure on a moving deck); `vsFpm` to 10 fpm.

## Defaults taken (P2)

1. **Delivery is a `par-sample` frame**, not a field on the track `delta` or an EFSP delta, and not through `deliverEfsp` (ADR 0112
   §7 says why: a sensor output, no seq/resync/audit, and the post-change hook would re-run obligations twice a second). The
   briefing offered `efsp-par-sample`; the `efsp-` prefix is kept for sequenced EFSP families, so the frame is `par-sample`.
2. **Recipient = the Strip's owning Position**, Primary and Observers alike; consolidation is ADR 0110's: whoever takes PAR's hat
   (signs on to PAR) gets it.
3. **Approach per runway end** resolved like every runway question (assigned landing runway, else active runway); none →
   `NO_APPROACH`.
4. **TDZE `null` = DCS airfield elevation.** DCS terrain is what aircraft fly over; the real 238 ft could be tens of feet off the DCS
   ground and make every height wrong. Typing a number in the config overrides it.
5. **DA as decision height (HAT) in config**, DA worked out from TDZE, so it follows the DCS TDZE.
6. **Carrier course = live heading − angled deck**, not the final bearing in force (ADR 0113 lets it be typed). The PAR measures the
   deck where it is.
7. **Carrier touchdown offsets, deck height, TCH 0, 3.5°**: estimates, `[SOURCE-DEFINED]`, the glideslope "to confirm".
8. **Coverage = AN/FPN-68A's** (20 NM, ±15°, −1..+7°), antenna 0.5 NM beyond the reference point (ours). A missed approach that
   climbs out above 7° stops plotting before anyone presses Missed approach; the plot then ages (amber at 3 s).
9. **Sample period 500 ms** (the hub's own tick rate; DCS moves aircraft once a second, so a fresh plot about every second).
10. **Plots only on a DCS fix change.** No per-track telemetry time exists in `tracks.js`; "DCS moved it" is the honest test.
11. **The carrier DIST Block is blank for a session with no PAR sample** (PriFly, the Marshal). The old figure measured from the
    ship's centre on a banner the server republishes only on a whole-degree BRC step, minutes old for a ship steaming straight.
12. **The hull `approach` is required** (like `angledDeckDeg`): a hull without one stops start-up naming it.
13. The FINAL view (`final-panel.js`) keeps its rendering until PAR-2 replaces it; only its sample changed (range from the
    threshold/touchdown, exact height, the PAR's glidepath deviation, the approach's DA, which the carrier now has too).

## Usage-guide wording (for `docs/efsp-usage-guide.md`, the PAR and carrier final sections)

- "The PAR is your Position's own sensor. While you are signed on to PAR (or a carrier approach lane) and an aircraft is on your
  final, crc-sync measures it twice a second: range from the runway threshold (on the carrier, from the touchdown point on the
  angled deck, which moves with the ship), its height above the touchdown zone to the foot, how far above or below the glidepath
  and left or right of the course it is, its ground speed and vertical speed. Nobody else is sent these numbers. If you sign off,
  the next controller to sign on to your Position sees the same approach, with its trail."
- "Range is measured along the final approach course. Left and right are as the pilot sees them."
- "If DCS has not moved the aircraft, or it is outside the PAR's coverage (20 NM, 15° either side, up to 7° up), there is no new
  plot; the last one stays and the panel says how old it is."
- "On the carrier, the FINAL Strip's DIST is the PAR's range to touchdown; it shows only to the lane's controller."
- "Every approach figure (threshold, TDZE, TCH, DA, glidepath angle, the carrier's touchdown point) is a placeholder until the
  squadron copies the real plate: see `config/efsp-facility-incirlik.json` `parApproaches` and `config/efsp-carriers.json`."

## Walks

Done, as tests (`crc-sync/tests/par-monitor.test.mjs`, `ws-hub-par-sample.test.mjs`, `par-geometry.test.mjs`):

- **Missed approach mid-sample** (PAR's Missed approach moves the Strip to `par-missed` / BOLTER_WAVEOFF): the sample ends with the
  op; back on final, a fresh trail. Also an aircraft **going around before the button**: it climbs out of the volume, no new plot,
  `plotAgeMs` grows.
- **A second aircraft on the same final** (carrier lane, no capacity of one): two samples, separate trails. (PAR at Incirlik holds
  one: `par-final` capacity 1, refused by the Board as before.)
- **The PAR controller signing off mid-approach** (real EFSP: AP → SFA → rotation to PAR): one empty frame clears their panel, AP
  gets nothing, the Strip stays PAR's (ADR 0110); AP takes PAR's hat and gets the same sample on the next tick.
- **The carrier turning**: course 351 → 001 with the ship; an aircraft that flew the old line shows about 4,200 ft right of the new
  centreline at 4 NM; the trail keeps the earlier plot as measured.
- **Below DA**: the sample continues, height to the foot, azimuth unchanged; nothing on the server changes at DA.
- **No radar contact for 3 s**: last plot kept, `plotAgeMs` 3000; contact gone altogether, still the last plot, older; the next
  fix is a fresh plot and the old one joins the trail.
- Also: assigned landing runway beats the active one; no runway → `NO_APPROACH`; no TDZE → elevation INOP, azimuth measured; no
  ship → both INOP; an uncorrelated Strip → a sample with no plot.

Not walked: a live DCS (the touchdown offsets and the DCS Incirlik elevation are unverified); a flight on PAR whose assigned
landing runway changes mid-approach (the approach switches on the next tick, the trail is kept across the switch: the plots in it
were measured against the old threshold. Small, but PAR-2 may want to clear the trail when `approach.id` changes); the client's
own default glideslope recompute (PAR-2's).

## Findings

1. **The carrier banner's ship position is stale by design** (`shipStateChanged` republishes on a whole-degree BRC step, speed,
   altimeter, stale/found; `CarrierStore#setShipState` also keeps the old state when unchanged). Anything client-side that
   measures from `shipState.lat/lon` (the carrier map, CARRIER-MAP's lane?) is measuring from where the ship was. The PAR monitor
   matches the ship itself each tick. Worth a look by whoever owns the carrier map.
2. **No telemetry timestamp on tracks** (`tracks.js` keeps `Date.now()` only in a private map). The PAR uses "the fix changed".
3. The FINAL view's prompts (`final-panel.js`) now run on the PAR's glidepath deviation (0.3° tolerance, unchanged); PAR-2 replaces
   them with the H116 tolerances.
4. `wire:record` reported `WIRE_PROTOCOL stays 2`; the scan now includes `par-sample`'s frame keys and the sample's key lists. The
   hull view's new `hull.approach` is not scanned (view keys are scanned, `hull` contents are not).

## Gates

| Gate | Before | After |
|---|---|---|
| crc-sync `npm test` | 2616 | 2643 (all pass) |
| crc-desktop `npm test` | 1245 | 1247 (all pass) |
| `npm run freeze` | 56 | 56 (goldens re-recorded once, hash-only: the hull row in every connect frame, the Incirlik facility unit; separate commit) |
| `npm run walk` | | 23/23 |
| `npm run soak:selfcheck` | | PASS (6/6 detectors) |
| `npm run wire:record` | | surface recorded, protocol stays 2 |
| module-graph fixture | | re-recorded: `par-samples.js` (new leaf, in NEVER_IN_A_CYCLE), `bay-views.js` loses `FINAL_GLIDEPATH_NOMINAL_DEG`, `FINAL_DECISION_HEIGHT_FT` |
| Playwright (E2E_LANE=3, each alone) | | `l18-incirlik.spec.js` 3/3, `l17-carrier.spec.js` 6/6 |
