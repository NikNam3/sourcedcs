# Are MTRs airspace? Research for R3-80 and the AIRSP registry

Question (R3-80): should Military Training Routes (IR/VR/SR) be one kind of airspace in the new AIRSP
registry and panel, or stay a separate concept? Facts marked [web] were read from the cited page on
2026-10-01; facts marked (code) were read from this repo; anything else is marked [unverified].

## Short answer

- **In FAA terms an MTR is airspace, but not Special Use Airspace.** It is a charted, defined-dimension
  volume (centreline, width, altitude per segment) that is published, and activity on it is scheduled.
  It is none of the SUA types, and it is not "controlled" by an ATC facility the way a MOA or restricted
  area is. [web]
- **In the military ACO sense it is an airspace control means (ACM) of the route family.** The ATP-3.3.5 / JP 3-52
  list holds AIRRTE, TR, TC, MRR, TMRR, LLTR, SAAFR and SC next to the area ACMs (ROZ, AARA, ...). [web]
  (IR/VR/SR are FAA civil-military constructs, not ACM codes; a DCS squadron's "MTR" maps onto LLTR/TR/AIRRTE.)
- **Recommendation: one registry, `kind = AREA | ROUTE`.** A route shares the ownership, schedule/activation
  state machine, audit, wire and panel with areas. It differs in geometry (centreline + width, per-segment
  altitude) and in what "occupied" means. Do not build a second parallel store.

## Evidence

### FAA: MTRs are published routes, SUA is a closed list

- JO 7610.4 was reissued as **JO 7610.14** (now 7610.14A); its chapter 6 is "Military Training Routes (MTR)".
  Search result pages: https://www.faa.gov/air_traffic/publications/atpubs/so_html/chap6_section_1.html
  (`..._section_4` IR definition, `_5` IR coordination, `_6` IR use, `_7`-`_9` VR).
- **Width:** "Widths of route segments are determined by the military. The route width will be sufficient to
  contain all planned activities." (6-4-1). VR standard width for charting is 5 NM (6-7-1). Routes are
  "depicted by lines defining the route widths" on FAA Form 7110-4 (6-5-1).
- **Altitude:** "Altitudes must be established for each route segment ... singly, in blocks, or a range from
  which ATC assignment may be made"; a block is written `low B high`, a range `low-high` (6-4-3). Each segment
  carries an IFR altitude for failure cases. All altitudes are military-set. Altitude is per **segment**.
- **Scheduling:** "Each IR route must have a designated military unit responsible for scheduling all military
  flights" and "IRs must not be used for military training unless scheduled" (6-6-1, 6-6-2). The scheduling
  agency "must confirm the planned utilization of the route with the appropriate ATC facility(ies) at least
  2 hours prior to use" unless an LOA says otherwise, and cancels requests when the route will not be used.
  VR is the same (6-9-1), with the worked schedule example `VR101 0900-1000 2/F-14 0915-1000 SFC B-50 MSL`:
  time window, count/type, entry-exit time, altitude block. The scheduler keeps a record of the year's
  operations (6-1-5). An LOA between the scheduling activity and the ARTCC carries the special procedures (6-6-2).
- **Who edits what:** the *definition* (route, width, altitudes) is changed through FAA Form 7110-4, published
  on an AIRAC date (6-5-1..6-5-3). The *use* is scheduled day to day by the military scheduler. Two cadences.
- **ATC cannot refuse use**: "ATC facilities should not deny the use of IRs. ATC delays may be imposed" (6-6-5).
  That is unlike a MOA/restricted area, where the controlling agency releases and takes back the block.
- **No hot/cold state in FAA text.** I found none in 7610.14A or AIM. "Hot/cold" is squadron slang for
  scheduled-and-active versus not; the FAA record is "scheduled / confirmed with ATC / cancelled". [unverified for DoD FLIP AP/1B]
- **Not SUA:** JO 7400.2R 21-1: "The types of SUA areas are Prohibited Area, Restricted Area, MOA, Warning Area,
  Alert Area, CFA and NSA" (MTR absent). https://www.faa.gov/air_traffic/publications/atpubs/pham_html/chap21_section_1.html
  AIM 3-4-1 defines SUA as airspace "wherein activities must be confined" and lists the same types
  (https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap3_section_4.html). The two orders meet at
  7610.14 6-1-4: the sectional "will depict all areas of military training activities; i.e., IRs and VRs ...
  MOAs, restricted, prohibited, warning, and alert areas", which treats MTRs as a sibling category of
  "training activity area", not a subtype of SUA. I did not find a sentence in 7400.2 that calls an MTR
  "airspace" explicitly; the answer is by the definitions above.
- **AIM 3-5-2** (https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap3_section_5.html): "MTRs are
  mutually developed for use by the military for the purpose of conducting low-altitude, high-speed
  training" (generally below 10,000 ft MSL, over 250 kt). IR = IFR regardless of weather; VR = VFR with 5 mi
  visibility and 3,000 ft ceiling. Designators: `IR`/`VR` + 3 digits if any segment is above 1,500 ft AGL,
  4 digits if none; letter suffix for alternates (IR008A). SR (slow routes, glider/UAS-style) are
  DoD FLIP/AP/1B usage and are not in these FAA pages. [unverified]

### ACO: routes are ACMs, with the same attributes as areas

- ATP-3.3.5 Annex B (AJP-3.3.5 Ed B) lists AIRRTE ("navigable airspace between two points ... bi-directional"),
  TR, TC, TMRR, SC, SAAFR, LLTR ("A temporary corridor of defined ..."), "AIRRTE is an ACM", "TR is an ACM".
  https://assets.publishing.service.gov.uk/media/65eb0ff562ff489bab87b366/AJP_3_3_5_EdC_Airspace.pdf (B-4, Table B-1)
- JP 3-52 codes, same family: AIRCOR, AIRRTE, MRR ("temporary corridor ... minimum known hazards"), SAAFR, TC, TR, APPCOR.
  https://niem.github.io/model/4.2/jp3-52/AirspaceCoordinatingMeasureUsageCodeSimpleType/index.html
- ACMs are requested with an ACMREQ, promulgated, activated and deactivated in the ACO by the airspace control
  authority, and "within the bounds of a specified ACM ... further deconfliction by time and/or" altitude is
  possible (AJP-3.3.5 paras on ACO/ACMREQ). ACM relative priority is explicit: "transit route vs ROZ" (para ~2147).
  So the military model has **one ACM concept, route and area alike**, one request/activate/deactivate cycle.
- ACO USMTF carries an ACM as `ACMID` set(s) (an ACO set, per `docs/parallel/research/usmtf-ato.md`, section on ACO); the
  field layout of route ACMs (points + width + altitude + time) I did not verify. [unverified]
- Contrast: the FAA SUA model has a *controlling agency* and a *using agency* with joint-use release; the route
  model has only a *scheduling agency* and an LOA. The ACM model has an owner (the requester) and the ACA.

### Current MTR code (code)

- There is **no MTR entity**. Per ADR 0062 (`docs/adr/0062-mtr-fields-and-where-they-sit-on-the-strip.md`) an MTR is six
  free-text FDR leaves `fdr.military.mtr.{designator, entryFix, entryTimeUtc, exitFix, exitEstimateUtc,
  requestedAltitudeAfterExit}` (Blocks `9G-*`, `9H-*`, `fdr-store.js` `normalizeMtrValue`, `block-map.js` L121-126).
  Decision H23: the route list "arrives later", so no format rule on designators or fixes.
- **No activation, no altitude block, no width, no owner**: the designator is a string on a flight. Who edits: any ATC
  Role through `setField()`; the Strip shows the group only when a field has a value.
- A written lost-comms advisory (ADR 0062) reads the last clearance altitude, never route data.
- MARSA has `MTR_ENTRY` / `MTR_COMPLETE` as start/end events (`marsa-store.js` L56-57), by string, not linked to a route.
- Airspaces today (`docs/wip/AIRSP.md`, `airspace-store.js`): SCHEDULED/ACTIVE/RELEASED/RETURNED, per-airspace
  controlling/using Position authority, `type` MOA|RANGE|DANGER|RESTRICTED|PROHIBITED|WARNING, `altLowerFt/altUpperFt`,
  **no geometry**, `occupancyFor` counts Strips holding `airspaceEntry{airspaceId}`. Config ships `[]`.
  `stereo-routes.js` (ADR 0050) is a different thing: canned filing routes (PACK 1), not training routes.

## Recommendation for the AIRSP registry

1. **One registry, one store, one panel, one wire.** Add `kind: 'AREA' | 'ROUTE'` (default `AREA`). Keep `type`
   descriptive. Add ROUTE types `IR`, `VR`, `SR`, `LLTR` (descriptive, like the existing types, D14).
2. **Shared:** `airspaceId` (the designator `IR206`/`VR1207`), `name`, ownership Positions, optimistic `rev`,
   audit, `SCHEDULED -> ACTIVE -> RELEASED/RETURNED` states and the window, `ScheduleAirspace`.
3. **Route geometry** (AIRSP v1 is geometry-free, so store these as data, not as a map feature yet):
   `segments: [{ fix, altLowerFt, altUpperFt, widthNm? }]` plus `defaultWidthNm` (5 for VR, per 6-7-1). Altitude
   is per segment; keep `altLowerFt/altUpperFt` on the record as the envelope (min of lows, max of highs) so the
   existing "block must fit" rule still has one meaning.
4. **Authority differs, and the registry should encode it as data, not branching code:** for a ROUTE the
   *scheduler* (a using/owning Position) schedules and cancels; the controlling facility **cannot deny**, it may
   only **delay** (6-6-5). So the ROUTE activation path is `ScheduleAirspace -> ACTIVE` with the ATC side
   *acknowledging* ("confirm utilization", the 2-hour confirmation) instead of `ApproveActivation/DenyActivation`.
   Suggest a per-kind `activation: 'APPROVE' | 'CONFIRM'` flag; for `CONFIRM`, deny is not offered, delay is a note.
5. **Occupancy differs.** A MOA/range with 3 flights is "busy"; a route with several flights is normal
   ("to accommodate the maximum number of users", 6-2-1; schedule example shows 4/F-14). Do not raise the same
   "occupied" warning for a ROUTE. Warn only on an activation conflict (an active route crossing another
   active area is out of scope for v1) and show a count, not a block.
6. **Definition vs use cadence (two edit rights):** editing route shape is rare (AIRAC, Form 7110-4); schedule
   edits are daily. Reuse AIRSP's definition-edit capability for shape (CTR/APP), and the existing schedule op for use.
7. **Do not model hot/cold as a separate field.** It is `ACTIVE` vs not; the label can read "HOT/COLD" in the UI.

## What changes in the MTR code

- **Nothing breaks.** ADR 0062's six free-text leaves stay valid; the designator becomes a *reference*.
  When `military.mtr.designator` equals a registry `airspaceId` (after the same normalisation), the Strip may show the
  route's active state and the exit-altitude hint; an unknown designator stays free text (H23 still holds).
- **New:** a `designator -> airspaceId` lookup in `fdr-store.js` (read-only, no refusal on a miss), and the MTR group
  could show a grey "route not scheduled" note (not amber, per ADR 0058: only wrong things are amber) when the
  designator resolves to a route that is not ACTIVE.
- **MARSA `MTR_ENTRY/MTR_COMPLETE`:** unchanged; optionally record the `airspaceId` once resolved.
- **Do not reuse `airspaceEntry`** on the Strip for MTR flights: that is an approval-at-entry copy for a controlled
  block (frequency + altitude block). A route flight keeps its `military.mtr` group; join by designator.
- **Lost-comms advisory (ADR 0062)** could, later, name the route's per-segment IFR altitudes once segments exist; the guide
  rule needs "minimum IFR altitude for each remaining segment", the one input the system has never had.
- Feed the new ADR with R3-80's answer: "MTRs are airspace in the ACM sense and not SUA in the FAA sense; one registry,
  `kind=ROUTE`, shared schedule/audit, route-specific activation (confirm, not approve) and occupancy (count, not block)".

## Sources

- JO 7610.14A ch. 6 (successor to JO 7610.4): https://www.faa.gov/air_traffic/publications/atpubs/so_html/chap6_section_1.html (also `_4`, `_6`, `_7`, `_9`)
- JO 7400.2R ch. 21: https://www.faa.gov/air_traffic/publications/atpubs/pham_html/chap21_section_1.html
- AIM 3-4-1: https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap3_section_4.html
- AIM 3-5-2: https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap3_section_5.html
- AJP-3.3.5 (ATP-3.3.5) Annex B: https://assets.publishing.service.gov.uk/media/65eb0ff562ff489bab87b366/AJP_3_3_5_EdC_Airspace.pdf
- JP 3-52 ACM usage codes (NIEM): https://niem.github.io/model/4.2/jp3-52/AirspaceCoordinatingMeasureUsageCodeSimpleType/index.html
- Repo: ADR 0062, ADR 0050, `docs/wip/AIRSP.md`, `crc-sync/src/efsp/{fdr-store,block-map,marsa-store,airspace-config,stereo-routes}.js`
