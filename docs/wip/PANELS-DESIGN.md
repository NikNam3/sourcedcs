# PANELS-DESIGN: a PAR panel and a Marshal stack panel

Lane PANELS-DESIGN, 2026-10-05. Research and mockups only; no production code. Mockups: `docs/mockups/index.html`,
`docs/mockups/par-panel.html`, `docs/mockups/marshal-stack-panel.html` (open them in a browser, no network needed
except Google Fonts).

The human's request: "PAR needs the actual PAR panel, and the marshal stack should also have its own marshal stack
panel, the strip bay shouldn't have to order them, that's not really what it's for."

Vocabulary is `docs/glossary.md`'s (Position, staffed, signed on, strip type, flight data, handoff). Anything I could
not source is marked `[SOURCE-DEFINED]`, the repo's convention. Sources were read on 2026-10-05.

## Sources

| Id | Source | URL |
|---|---|---|
| S1 | FAA JO 7110.65BB, Chapter 5 Section 12, PAR Approaches - Terminal (5-12-1 to 5-12-11) | https://www.faa.gov/air_traffic/publications/atpubs/atc_html/chap5_section_12.html |
| S2 | FAA JO 7110.65BB, Chapter 5 Section 10, Radar Approaches - Terminal (5-10-1 to 5-10-15) | https://www.faa.gov/air_traffic/publications/atpubs/atc_html/chap5_section_10.html |
| S3 | FAA AIM 5-4-11, Radar Approaches (b. Precision Approach (PAR)) | https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap5_section_4.html |
| S4 | FAA AIM 4-5-4, Precision Approach Radar (PAR) | https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap4_section_5.html |
| S5 | L3Harris PAR-2020 / AN/FPN-68A sell sheet (2022) | https://www.l3harris.com/sites/default/files/2022-04/PAR-2020_Sell%20Sheet.pdf |
| S6 | FAA Order 8260.3B (TERPS) Chg 1-26, Vol 3 ch 1 (GPA definition) and 10.1.3 (PAR final segment) | https://www.faa.gov/documentLibrary/media/Order/8260.3B_Chgs_1-26_rev.pdf |
| S7 | NAVAIR 00-80T-105 CV NATOPS Manual (31 July 2009 edition; public copy) | https://info.publicintelligence.net/CV-NATOPS-JUL09.pdf |
| S8 | LCDR Joe Ruzicka, "How to land a fighter on an aircraft carrier on a stormy night", The War Zone (upd. 2020-07-02) | https://www.twz.com/3559/how-to-land-a-fighter-on-an-aircraft-carrier-on-a-stormy-night |
| S9 | Wikipedia, Precision approach radar (systems list, 10 to 20 mile coverage) | https://en.wikipedia.org/wiki/Precision_approach_radar |
| S10 | Wikipedia, Optical landing system (carrier glideslope "3.5 degrees", up to 4 in heavy seas) | https://en.wikipedia.org/wiki/Optical_landing_system |
| S11 | AF Manual 51-37 ¶6-17 via code7700 summary of PAR (pilot's view; same slightly/well wording) | https://code7700.com/par.htm |

S7 carries Distribution Statement C on its cover; it is cited because it is publicly hosted, and only its procedural
text is used. **Not found publicly:** the CV ATC NATOPS (NAVAIR 00-80T-114 / CATCC procedures), any PAR controller
training manual that puts numbers on "slightly", "well" or the safety limits, the AN/FPN-63 or AN/TPN-22 display
specification, and the published Incirlik (LTAG) PAR minima. Each gap is `[SOURCE-DEFINED]` below.

## 1. PAR research

### 1.1 The display

- **Two scopes, both against range.** "Two antennas are used in the PAR array, one scanning a vertical plane, and
  the other scanning horizontally ... Each scope is divided into two parts. The upper half presents altitude and
  distance information, and the lower half presents azimuth and distance" (S4). So: **elevation over range on top,
  azimuth over range below**, sharing the range axis.
- **Coverage.** "The range is limited to 10 miles, azimuth to 20 degrees, and elevation to 7 degrees, only the final
  approach area is covered" (S4). A current system, the AN/FPN-68A (PAR-2020), quotes azimuth 30°, elevation -1° to
  +7°, range 20 nmi clear / 15 nmi rain, **update period under one second**, a 100-foot CAT II decision height and
  0.25 nmi minimum (S5). Military PARs "can provide precision guidance from a distance of 10 to 20 miles down to the
  runway threshold"; systems in service include AN/FPN-63, AN/MPN and AN/TPN-22 (S9).
- **What is drawn.** The glidepath on the elevation scope and the runway centreline (course) on the azimuth scope;
  the controller compares the target's plots to them (S9, S3). The scopes carry **safety limits**: "If an aircraft is
  observed by the controller to proceed outside of specified safety zone limits in azimuth and/or elevation and
  continue to operate outside these prescribed limits, the pilot will be directed to execute a missed approach"
  (S3). **Where the safety lines sit, and the numbers behind "slightly" and "well", are not in any public source I
  found: `[SOURCE-DEFINED]`.** (A 1950s RAF GCA meter read "200 ft above and 300 ft below the desired glide path";
  that is the only figure found and it is not a modern display.)
- **Range marks** are implied by the once-a-mile range call (S1 5-12-5); every mile is marked in the mockup.
- **Decision altitude.** PAR obstacle criteria follow ILS for glidepath angle, threshold crossing height and DA;
  "the minimum HAT may be 100 feet for DoD-only approaches when the OCS is clear" (S6 10.1.3b). The glidepath angle is
  "published on approach charts (e.g., 3.00 degrees, 3.20 degrees, etc.)" (S6 vol 3 1-1d).

### 1.2 What the PAR controller says, and when (JO 7110.65 ch 5 §10, §12)

| When | Call | Para |
|---|---|---|
| First contact with final | "(callsign), (facility) FINAL CONTROLLER. HOW DO YOU HEAR ME?" | 5-10-9 |
| Established on final | "DO NOT ACKNOWLEDGE FURTHER TRANSMISSIONS." | 5-10-10 |
| IFR weather on the approach | lost-comms instruction: no transmission for **5 seconds on a PAR final** (1 min on vectors, 15 s on a surveillance final) | 5-10-4 |
| Before final descent, IFR | "YOUR MISSED APPROACH PROCEDURE IS ..." | 5-10-11 |
| 10 to 30 s before final descent | "APPROACHING GLIDEPATH." | 5-12-1 |
| At the descent point | "BEGIN DESCENT." | 5-12-3 |
| Pilot asks | "DECISION ALTITUDE (number of feet)." | 5-12-2 |
| Continuously, **about every 5 seconds** | "HEADING (heading). ON GLIDEPATH. ON COURSE," or "SLIGHTLY/WELL ABOVE/BELOW GLIDEPATH. SLIGHTLY/WELL LEFT/RIGHT OF COURSE." | 5-12-4 |
| As corrections are issued | trend: "Going above/below glidepath", "Going right/left of course", "Above/below glidepath and coming down/up", "... and holding", "Left/right of course and holding/correcting"; may add "RAPIDLY" or "SLOWLY" | 5-12-4 |
| At least once each mile | "(number) MILES FROM TOUCHDOWN." | 5-12-5 |
| Reaching the DA | "AT DECISION ALTITUDE." Guidance below DA is advisory only. | 5-12-6, 5-12-7 |
| Over the lights / threshold | "OVER APPROACH LIGHTS." "OVER LANDING THRESHOLD, (position with respect to course)." | 5-12-7 |
| Tower | obtain landing clearance; issue clearance and surface wind | 5-10-13 |
| Safety limits exceeded, radical deviation, identity in doubt, **radar contact lost** (not after DA) | "(reason) IF RUNWAY/APPROACH LIGHTS NOT IN SIGHT, EXECUTE MISSED APPROACH" (e.g. "Too high/low for safe approach", "Too far right/left for safe approach", "Radar contact lost") | 5-10-14 |
| Elevation part fails | "NO GLIDEPATH INFORMATION AVAILABLE ..."; may continue as a surveillance approach on the PAR azimuth, mileages from touchdown | 5-12-10 |
| Guidance ends | pilot request, safe approach questionable, over threshold, or pilot proceeding visually: "(distance) MILE(S) FROM TOUCHDOWN, PROCEED VISUALLY" | 5-12-8 |
| Roll-out | "CONTACT (terminal function) AFTER LANDING." | 5-12-9 |
| Single-frequency approach (Incirlik's SFA) | no frequency change once begun, except landing completed, VFR by day, pilot request, emergency, visual approach, IFR cancelled | 5-10-15 |

AIM 5-4-11 is the pilot's side of the same: "slightly" or "well", trend "rapidly"/"slowly" ("well above glidepath,
coming down rapidly"), range at least once each mile, guidance to DA then advisory to the threshold (S3).

### 1.3 The carrier's precision approach (CCA final controller)

From CV NATOPS 6.4.7 (S7):

- **Mode I** is automatic to touchdown by AN/SPN-42/46; **Mode IA** automatic to 200 ft and ½ nm; **Mode II** shows the
  SPN-46 error in the cockpit (needles); **Mode III** is the voice talk-down: "a pilot is supplied position guidance
  information from the AN/SPN-42 or AN/SPN-46 by a final controller". **ICLS** is the AN/SPN-41 + ILM (bullseye),
  pilot-interpreted. Mode III **is the carrier's PAR**, and it is what our CV_APP lanes do.
- Jets pass the **6-mile DME fix at 1,200 ft**, 150 KIAS, landing configuration, and hold 1,200 ft to the glidepath
  "approximately 3 miles, dependent upon glideslope angle utilized". The controller provides "glideslope, azimuth, and
  range information" and "shall advise the pilot when at minimums unless the LSO has previously assumed
  responsibility. The pilot shall respond with a ball report" (6.4.7.8).
- **Lock-on** between 3.5 and 8 miles ("201 lock-on, 5 miles. Say needles."), "approaching tipover" for the
  glidepath, "range each mile" (6.4.7.4 to 6.4.7.7). Heading corrections after lock-on are "soft" ("301, right five")
  and altitudes are spoken as angels ("1.2") (6.4.13.2).
- **Minimums** (fig 6-6): jet ICLS 300-¾, ICLS/ILM with SPN-42/46 monitor 200-½, Mode IA/II/III 200-½.
- **Missed approach / waveoff / bolter**: climb straight ahead on the extended final bearing to 1,200 ft (6.4.8).
- **Glideslope**: the carrier's optical glideslope is nominally **3.5°**, up to 4° in heavy seas (S10).

### 1.4 What crc-sync knows about an aircraft on final today

| Fact | Where | On the wire? |
|---|---|---|
| lat/lon | `tracks.js` from DCS-gRPC | yes, per sweep of a session radar that sees it (`presentation.js`) |
| true MSL altitude (m) | `tracks.js` `alt` | **no**: only an *indicated* altitude **rounded to 100 ft**, and only from SSR/height/datalink (`presentation.js:124-130`) |
| ground speed (m/s), course (grid), vertical speed (m/s) | `tracks.js` `groundSpeed`, `course`, `verticalSpeed` (ADR 0058) | **no** (`WIRE_KEYS` has none of them) |
| heading (grid) | `tracks.js` `heading` | no |
| update rate | DCS-gRPC poll 1 s (`DCS_GRPC_POLL_RATE`); a contact is sent when a session radar sweeps it: approach radar `sweepMs` **3000** (`config/sensor-specs.json`) | 500 ms hub tick, but positions change per sweep |
| airfield | DCS `GetAirbases`: reference point lat/lon and elevation (`grpc-client.js:495`) | radar list |
| runway | `efsp-facility-incirlik.json` `runwayStatus.runways`: ends `05`/`23` and `endHeadingsTrue` (05: 56°, 23: 236°) | Facility config |
| runway threshold position, TDZE, TCH, glidepath angle, DA | **nowhere** | - |
| ship (carrier) | ship state: position, BRC, final bearing (BRC - angled deck), speed (`carrier/ship-state.js`) | carrier view |

**Glidepath angle.** DCS gives none. Default **3.0°** for Incirlik: it is the commonest published GPA (S6 gives 3.00 as
its example) and today's client already assumes it (`FINAL_GLIDEPATH_NOMINAL_DEG`); `[SOURCE-DEFINED]` until the
squadron copies LTAG's PAR plate. **Carrier: 3.5°** (S10). TCH 50 ft and DA = TDZE + 200 ft (the current
`FINAL_DECISION_HEIGHT_FT`, and the 200-½ carrier minimum of S7) are `[SOURCE-DEFINED]`.

**Runway threshold.** Two buildable sources: (a) Facility config (`thresholdLat/Lon`, `tdzeFt` per runway end, typed
once by the squadron from the DCS map), or (b) DCS itself: the mission scripting `Airbase.getByName(...):getRunways()`
returns each runway's centre position, course, length and width, so crc-sync can compute both thresholds through the
existing `Eval` channel it already uses for nav points (`grpc-client.js` `_getNavpoints`). The exact Lua return shape
must be verified against a live server `[SOURCE-DEFINED]`; (a) is the safe first build and (b) a later refinement.

### 1.5 What today's FINAL panel shows, and what it lacks

`final-panel.js` + `bay-views.js` `finalSampleFor` (ADR 0075, mounted in `par-final` and the carrier final Bays):
callsign; runway; decision altitude; distance "to touchdown"; one glidepath figure ("ON (+0.1°)" / "ABOVE 0.6°"); a
5-second cadence bar; one prompt (mile, glidepath intercept, decision altitude, trend) held 4 s; two terminal buttons.

What it lacks, and why it cannot be fixed in the client:

1. **No scopes.** No elevation or azimuth picture, no history, no safety lines: the controller cannot see trend, which
   is half of every call (S1 5-12-4).
2. **No azimuth at all.** Course guidance ("left/right of course", "HEADING ...") is the other half of the talk-down.
3. **The wrong reference point.** "Touchdown" is the approach radar's site, which is the DCS airfield reference point,
   and the glidepath is measured from that point's elevation **plus the radar's 15 m antenna height**
   (`radars.js:172`, `bay-views.js:204`). Distance is off by the ARP-to-threshold distance and the glidepath by about
   49 ft.
4. **The altitude is too coarse.** The wire altitude is rounded to 100 ft. At 1 NM, 100 ft is about 0.9° of
   glidepath; "slightly" and "well" cannot be told apart.
5. **The update rate is the approach radar's 3 s sweep**, not a PAR's sub-second one (S5); the 5 s call rhythm of S1
   needs at least a fresh plot per call.
6. **No slightly/well bands, no safety limit, no "too low for safe approach", no lost-contact call**, no "approaching
   glidepath"/"begin descent", no "over threshold".
7. On the carrier, "touchdown" is the ship's DCS position (its centre), the glideslope is 3° not 3.5°, and the final
   bearing is not used for azimuth.

What it gets right and keeps: **nothing to type** (guide §7.10), the mission-clock cadence, the two terminal buttons.

## 2. Marshal stack research

### 2.1 How CATCC runs the stack (CV NATOPS ch 6, S7)

- **Check-in.** The flight leader gives position, altitude, **fuel state ("low state in flight")**, number of aircraft,
  type approach requested, other pertinent information (6.1.2). Fuel is spoken in thousands of pounds ("3.5")
  (6.4.13.2). Air ops asks for "update state" about **every ten minutes** (S8).
- **Case I** (ceiling 3,000 ft, 5 miles): Marshal gives Case, expected BRC, altimeter and expected Charlie time
  (6.2). Port holding: left-hand, tangent to BRC, ship at 3 o'clock, max 5 nm diameter, **minimum 2,000 ft MSL, 1,000 ft
  between altitudes**, recovery order and altitudes "as promulgated by ship/air wing doctrine"; the lowest flight
  descends to make its ramp time (6.2.1). No timed pushes. Switched to tower at 10 nm after "see you".
- **Case II** (1,000 ft and 5 miles at the ship): Case III procedures outside 10 nm, tower inside 10 nm with the ship in
  sight; max six in the pattern (6.3).
- **Case III** (below Case II, and night from ½ hour after sunset to ½ hour before sunrise): single aircraft (6.4).
  **Marshal fix: the 180° radial relative to the expected final bearing, at 1 mile per 1,000 ft plus 15 (angels +
  15)**; left-hand 6-minute racetrack; **base altitude never below 6,000 ft** (6.4.1.1). Emergency marshal: the 150°
  relative radial, angels + 15, at least 30° from the primary (6.4.1.3). 1,000 ft vertical separation (800 inside 12 nm)
  (6.4.1.7). Max four aircraft at one altitude, two in IMC (6.4.1.6).
- **Marshal instructions** before entering marshal: 1 Case, 2 type approach, 3 expected final bearing, 4 altimeter,
  5 holding instructions, 6 **expected approach time**, 7 expected approach button, 8 time check, 9 vector, 10 multiple
  stack info (6.4.2). Example: "101, expect CV-1 recovery Case III approach, altimeter 29.92, marshal on the 240
  radial, 21, angels six, expected push time 22" (S8).
- **EAT** "the future time at which an aircraft is cleared to depart inbound ... Aircraft depart and commence approach
  at assigned time if no further instructions are received" (glossary). Each pilot adjusts holding "to depart marshal
  at the assigned EAT"; early or late departure is reported (6.4.4). **Departures from marshal "normally separated by 1
  minute"** (6.4.5). Overhead marshal used as emergency marshal: EEATs every other minute (6.4.1.4).
- **"Commencing"** is the pilot's report leaving marshal, with fuel state and altimeter (6.4.13.1). Platform
  (5,000 ft), 10 miles, then lock-on / final (6.4.7).
- **Delta.** Fouled deck or too many bolters: "the CCA Officer shall issue via marshal control a signal Delta",
  in even minutes, never less than four. In marshal: keep holding and await a new EAT. Commenced aircraft above 7,000
  ft level at the next lower odd altitude and hold at angels + 15. **New EATs are issued "from the latest to the
  earliest (i.e., top of the holding pattern to the bottom)"** so no two aircraft share one (6.4.9).
- **Status boards.** Check "all status boards for accuracy and completeness" (3.2.2 item 13); "record data as required
  on status boards" after launch (5.13). Air ops' two boards show "fuel states, aircraft mission, pilot names, aircraft
  side numbers, landing attempts and any miscellaneous information" (S8). Departure control tracks "the location of
  low-state aircraft and their fuel requirements" (glossary). **The board's column layout is not public:
  `[SOURCE-DEFINED]`.**
- **Handoff to approach/final.** Marshal control provides control "until handed off to another controlling agency";
  final control works the aircraft "until transfer of control to the LSO or the aircraft reaches approach weather
  minimums" (glossary). That is ADR 0064's Commence and Radar contact.

### 2.2 What we already model (ADR 0064, 0074)

- **The stack is one integer per flight** (`stackIndex`); angels (6 + index), DME (angels + 15), push time (Charlie +
  index minutes) and radial (final bearing + 180, or Marshal's) are derived on the server (`carrier/marshal-stack.js`).
  This matches 6.4.1.1 and 6.4.5 exactly.
- Ops: `InsertAt`, `Append`, `Move`, `Remove`, `CloseUp`, `MarkPushed`, `SetCharlieTime`, `SetCaseIAngels`,
  `SetMarshalRadial`. Insert ripples up to the first vacancy; push never renumbers; remove leaves a gap.
- **Case** is PriFly's, ship-wide (`recovery-case.js`); Case I is an altitude list (angels ≥ 2), no push, no DME.
- **Ship banner** (BRC, final bearing, speed, altimeter) from DCS (`ship-state.js`).
- **The flight's carrier fields** (`flightData.military.carrier`): EEAT, approach type, button, bingo field, bingo
  fuel, low state.
- **Lanes**: pushes alternate CV_APP1 / CV_APP2 by push ordinal (`assignLanes`).
- The wire view carries the record, banner, **derived stack, slot previews** and consistency findings (ADR 0074).
- `marshalMessage()` builds §9.12's sixteen marshal-message fields in order; **it is not on the wire**.

### 2.3 Why the Strip Bay is the wrong tool

The human's point, with the code behind it: a Bay holds Strips and their next actions. Today the `cv-marshal-stack`
Bay is made to be a sequencing display twice over: `carrierOrderRack` re-sorts its rack by stack index
(`carrier-panel.js:161`, called from `bay-view.js:197`), and `renderCarrierStackBoard` inserts a slot board above the
rack. Consequences: the stack is shown twice (board rows and Strips, in the same order, in the same scroll area); a
Strip's place in the Bay is not the controller's to choose; the board competes with the Strips for height, so a stack
of eight pushes the Strips (where Commence lives) out of view; there is no place for time (the next push, a countdown),
fuel against bingo, the re-clearance a move causes, or the commenced flights, because those are not Strip things. A
stack is a **time-and-altitude ladder**, which wants its own surface.

## 3. Proposed panels

### 3.1 PAR panel (dock panel `par`)

A dockview panel like `runwayStatus` (`dock.js` `createComponent`), opened from Panels → PAR, docked beside the
EFSP Strip panel by default. It shows **the one aircraft on final for the controller's signed-on PAR (or CV_APP)
Position** (the `par-final` / `cv-appN-final` Bay's single Strip). With none, "No aircraft on final".

- **Header**: approach (PAR RWY 05 LTAG, or CVN-72 Mode III), GPA, TCH, DA (HAT), final approach course (magnetic,
  from the server), radar status (AZ / EL), flight (callsign, type, beacon).
- **Elevation scope** (top): range from touchdown 0 to 10 NM on x (touchdown at left), height above TDZE on y,
  vertically exaggerated. Glidepath line, "slightly" band, lower safety limit line, the DA mark, every-mile range
  marks, the target with its last 12 plots (1 s apart) as a fading trail.
- **Azimuth scope** (bottom): same range axis; course centreline, "slightly" band, the course safety-limit wedge,
  target and trail. Both scopes share the range axis so a vertical cursor at the target lines up.
- **Readouts**: range (NM, 0.1), elevation deviation (ft and °, with ON/SLIGHTLY/WELL and trend), azimuth deviation
  (ft and °, with band and trend), ground speed, vertical speed (with the rate the glidepath needs at this ground speed:
  GS × 101.3 × tan(GPA) ft/min), heading to fly suggestion (course ± correction, magnetic).
- **Suggested call** (the panel's main element): the 5-12-4 sentence for the current sample, with trend, e.g. "SLIGHTLY
  ABOVE GLIDEPATH, COMING DOWN. SLIGHTLY LEFT OF COURSE, CORRECTING. HEADING ZERO FIVE ZERO." It updates every plot and
  is **advice for the voice, never sent anywhere**. The 5-second cadence bar stays.
- **Required-call checklist** (left rail): Comm check, Do not acknowledge, Lost comms, Missed approach procedure,
  Approaching glidepath, Begin descent, each mile (10 ... 1), At decision altitude, Over approach lights, Over threshold.
  Event calls light up when due (computed from the sample) and grey out once passed; the controller never ticks them
  (nothing to type, §7.10).
- **Alarms**: below the lower safety limit or outside the course wedge (before DA) → red "TOO LOW / TOO FAR RIGHT FOR
  SAFE APPROACH. IF RUNWAY OR APPROACH LIGHTS NOT IN SIGHT, EXECUTE MISSED APPROACH" (5-10-14). **No plot for 3 s**
  `[SOURCE-DEFINED]` → hollow last plot, a "NO PLOT 4 s" timer, and the "RADAR CONTACT LOST" call. Elevation data
  missing → "NO GLIDEPATH INFORMATION AVAILABLE" (5-12-10), azimuth continues.
- **Terminals**: Landing assured / Missed approach (PAR), Ball / Waveoff (carrier), unchanged from ADR 0075.

**Deviation bands** (angular, about the glidepath apex, so they narrow towards touchdown as a real PAR's do), all
`[SOURCE-DEFINED]`, in a new tuning file read once at startup (P5):

| | ON | SLIGHTLY | WELL | safety limit (missed approach) |
|---|---|---|---|---|
| elevation | within ±0.2° | 0.2° to 0.5° | over 0.5° | 0.7° below the glidepath ("too low"); above: no limit, WELL only |
| azimuth | within ±0.5° | 0.5° to 1.5° | over 1.5° | ±2.5° ("too far left/right") |
| trend | change of the deviation over the last 3 s: "going/coming", "holding" under 0.05°/3 s, "rapidly" over 0.3°/3 s | | | |

These replace `FINAL_GLIDEPATH_TOL_DEG` 0.3 and `FINAL_TREND_STEP_DEG` 0.1 (today's client constants).

### 3.2 Marshal stack panel (dock panel `marshal`)

A dock panel for CV_MARSHAL (read-only for the other carrier Positions), beside the Strip panel.

- **Header**: hull, Case (PriFly's, read-only here), BRC, final bearing, marshal radial (settable), Charlie
  (settable), altimeter, mission clock, **next push in m:ss**.
- **The ladder**: one row per slot, **highest slot at the top** (it is a stack). Columns: slot, angels, DME, EAT/push
  (Zulu), callsign + type, state (lb, age of the report) against bingo, approach + button, lane (APP1/APP2 from
  `assignLanes`), status (HOLDING, PUSH in 0:12, PUSHED 2041 → APP2). Vacant slots show the server's preview faintly
  and a **Close up** control.
- **Gestures** (each is the existing op; the panel adds none): drag a row to a slot = `Move`; drag a Strip from the Bay
  onto a slot = `Move`/`InsertAt`; Close up = `CloseUp`; Remove = `Remove`; **Commence** on the bottom holding row =
  the Strip's own `MARSHAL_TO_APPROACH` handoff (the same op the Strip's button sends); Charlie and radial inputs.
  A drag shows **what will change before the drop**: "Moving RAVEN 205 to slot 2 re-clears 4 flights: VICTORY 105 A8
  → A9, 23 → 24 DME, 2042 → 2043 ...".
- **Re-clear list**: after any op that changes holding flights' angels/DME/EAT, a checklist of the flights to re-clear,
  **top of the stack first** (6.4.9's rule for EATs), each with its new clearance read-out; the controller taps each as
  read back. Client-only state (it is a memory aid, not a record).
- **Marshal instructions** for the selected flight: the 6.4.2 items in order, ready to read, from the existing
  derived values and flight fields.
- **Advisories**, never refusals: state within 1,000 lb `[SOURCE-DEFINED]` of bingo → amber "LOW STATE"; a state older
  than 10 min (S8) → "update state"; base angels below 6 can't happen (derived); four at one altitude can't happen
  (one flight per slot).
- **Commenced** list (below the ladder): pushed flights until Radar contact, with lane and time since push; then
  they leave the panel (FINAL is the PAR panel's).
- **Case I**: the ladder becomes the port-holding altitude list (angels typed per flight, ≥ 2, 1,000 ft apart), no
  DME/push columns, a "Charlie (expected)" field only.
- **Case change**: a banner "CASE III set by CV_PRIFLY 1931Z: 8 flights now have DME and EAT. Re-clear top-down" and
  the re-clear list fills with every flight.

### 3.3 Relation to what exists

- **FINAL panel**: the PAR panel **replaces** `final-panel.js`'s rendering for PAR and the carrier lanes. The model
  half (`finalCallsDue`, cadence, terminals) is reused and grown. The `final` Bay view shrinks to one line ("On final:
  VIPER 21, 4.0 NM. PAR panel") so the Bay is a Bay again; `par-final` keeps `capacity: 1`.
- **`cv-marshal-stack` Bay**: **stays** (it holds the IN_STACK Strips, and Commence / See you live on them), but
  **stops ordering** (`carrierOrderRack` goes) and **loses the slot board** (`renderCarrierStackBoard` moves into the
  panel). Its Strips sit in the ordinary Bay order.
- **Pattern board** (RSU / PriFly): unchanged. It is already a Bay view of legs and fits its Bay. The marshal panel
  ends where PriFly's pattern board begins (Case I "To pattern", Case II "See you").

## 4. Data each panel needs

### PAR

| Need | Exists | New |
|---|---|---|
| precise altitude, GS, VS, course of the contact | server (`tracks.js`) | **server computes the PAR sample** (below); never put raw truth on the wire |
| a PAR sensor that "sees" final | approach radar (3 s sweep, no height) | radar kind **`par`** per configured approach: `sweepMs` 1000 (S5: < 1 s), `caps.height: true` (it measures elevation itself), coverage 10 NM, ±10° az, -1° to +7° el (S4, S5); `[SOURCE-DEFINED]` figures in `sensor-specs.json` |
| runway end geometry | headings in Facility config | `parApproaches` in `efsp-facility-incirlik.json`: per end `thresholdLat/Lon`, `tdzeFt`, `gpaDeg` 3.0, `tchFt` 50, `daFt`, `facMagOverride?` (later: from DCS `getRunways`) |
| carrier touchdown | ship position, final bearing | hull config `touchdownOffsetM` (aft and port of the DCS unit origin) and `glideslopeDeg` 3.5 `[SOURCE-DEFINED]` |
| the sample | - | `surveillance/par.js` (pure): `{ stripId, at, rangeNm, heightFt, elevDevFt, elevDevDeg, azDevFt, azDevDeg, gsKt, vsFpm, trackMag, elevBand, azBand, elevTrend, azTrend, belowSafety, outsideCourse, plotAgeS, elevationAvailable }`, plus a short history (last 12) |
| delivery | - | wire message `efsp-par-sample`, 1 Hz, **only** to sessions signed on to the owning Position, only while its PAR radar sees the contact (the ADR 0059 rule: a session is told what its own sensors know). **Wire protocol bump** (ADR 0103, `npm run wire:record`) |
| tuning | client constants | `config/par.json` bands, trend thresholds, no-plot timeout, read once (P5) |

### Marshal

| Need | Exists | New |
|---|---|---|
| derived stack, slots, Case, banner, consistency | carrier view (ADR 0074) | - |
| fuel, bingo, approach, button, EEAT | `flightData.military.carrier` | **`lowStateAt`** (mission clock) set when `lowStateLb` is written, for "update state" age |
| push time of a pushed flight | derived from Charlie + index, so a later `SetCharlieTime` rewrites it | **`pushedAt`** stored by `MarkPushed` (mission clock); derivation shows it for PUSHED entries. Fixes a drift the Delta button would otherwise cause |
| lane | `assignLanes` (server, for the NLA) | `lane` on each derived entry in the view |
| Delta | `SetCharlieTime` | **`Delta`** stack op: Charlie + N min (N even, ≥ 4, per 6.4.9) for HOLDING entries; the panel fills the re-clear list top-down |
| marshal instructions | `marshalMessage()` server-side | send it in the view per entry (keeps formatting of bearings on the server), or format client-side from fields already there; recommend the view |
| dock panel | `dock.js` | `marshal` component, `PANEL_TITLES` entry, Panels menu item |

## 5. Build plan

| Lane | Contents | Size |
|---|---|---|
| **PAR-1 (server)** | `parApproaches` Facility config + schema; hull `touchdownOffsetM`/`glideslopeDeg`; `par` radar kind in `radars.js`/`sensor-specs.json`; `surveillance/par.js` pure sample (geometry, bands, trend, safety, plot age) with tests; hub delivery `efsp-par-sample` gated by Position + sensor; `config/par.json`; wire protocol record; ADR | one Sonnet lane, ~700 lines + ~500 test lines |
| **PAR-2 (client)** | `par` dock panel; `panels/par/par-scopes.js` (SVG elevation/azimuth, trail, bands, DA, range marks); `par-calls.js` (suggested sentence + required-call checklist, from `finalCallsDue` grown); alarms; terminals reused; `final` Bay view reduced to one line; Playwright spec for the panel | one Sonnet lane, ~900 lines + tests |
| **MARSHAL (server + client)** | `pushedAt`, `lowStateAt`, `lane` and marshal message in the view, `Delta` op (small server half, ~200 lines + tests); `marshal` dock panel (ladder, drag with change preview, re-clear list, instructions, commenced list, Case I list); remove `carrierOrderRack` and the Bay slot board | one Sonnet lane, ~250 server + ~800 client lines + tests |

PAR-1 and MARSHAL can run in parallel (they touch different files apart from the wire-protocol record, which the
second to merge re-records). PAR-2 follows PAR-1. If PAR must be one lane, it is a long one: server first, client second.

## 6. Questions only the squadron can answer

| # | Question | Recommended answer |
|---|---|---|
| Q-P1 | LTAG PAR RWY 05 and 23: published glidepath angle, TCH, DA, final approach course? (DoD FLIP; not public) | 3.0°, TCH 50 ft, DA = TDZE + 200 ft, course = runway true heading shown magnetic, until someone copies the plate |
| Q-P2 | What do "slightly" and "well" and the safety limits mean in numbers for us? | The angular table in §3.1, in `config/par.json` so it can be tuned after a few sessions |
| Q-P3 | Thresholds from config typed off the DCS map, or computed from DCS `getRunways()`? | Config first (deterministic, testable); DCS later as a check |
| Q-P4 | Do the carrier lanes (CV_APP1/2) get the same PAR panel (Mode III talk-down, 3.5°, moving touchdown)? | Yes, one panel, kind CARRIER |
| Q-P5 | Should the panel read the suggested call aloud (TTS) or only show it? | Show only. The controller's voice is the procedure |
| Q-M1 | Keep the `cv-marshal-stack` Bay at all? | Keep it unordered: the Strips and their Commence / See you buttons need a home |
| Q-M2 | Who issues Delta? NATOPS: the CCA Officer via marshal control. We have no CCA Officer Position | CV_MARSHAL, with PriFly able to as well |
| Q-M3 | Low-state advisory margin above bingo, and "update state" age? | 1,000 lb `[SOURCE-DEFINED]`; 10 min (S8) |
| Q-M4 | Should re-clear acknowledgements be recorded on the server (audit) or stay a client memory aid? | Client only in v1 |
| Q-M5 | Emergency marshal (150° relative, EEAT) as a second stack? | Not now (one stack, H29); EEAT stays a field |

## Defaults taken

- PAR deviation bands and safety limits: the §3.1 table, `[SOURCE-DEFINED]`.
- Incirlik RWY 05 sample: TDZE 238 ft, GPA 3.0°, TCH 50 ft, DA 440 ft (HAT 200), course 051°M. TDZE and course are
  **sample values for the mockup**, not verified data; the course assumes about 5° east variation `[SOURCE-DEFINED]`.
- No-plot timeout 3 s, trail 12 plots at 1 s.
- Carrier sample: CVN-72, BRC 360°M, angled deck 9° (ADR 0064), final bearing 351°M, marshal radial 171°M,
  Charlie 2040Z.

## Findings for other lanes

1. **FINAL's reference point is wrong** (approach radar site + 15 m antenna, not the threshold): distance and glidepath
   are off today, independent of these panels (`bay-views.js:204`, `radars.js:172`).
2. **Wire altitude is rounded to 100 ft**, so any client-side glidepath computation is meaningless inside about 3 NM.
3. **A pushed flight's push time is derived, not stored**: `SetCharlieTime` after a push rewrites the push time shown
   for flights that already left (`marshal-stack.js` `setCharlieTime`, `deriveEntry`).
4. `marshalMessage()` is built and tested but never sent.
