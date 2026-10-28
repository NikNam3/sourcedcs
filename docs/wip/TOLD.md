<!-- Exported from the planning doc on 2026-10-27. Source of truth from here on: this file. -->
# F-16 Performance Calculator — Implementation Plan

Oct 27, 2026 · @NikNam3

## Goal and principles

The calculator outputs, as exactly as possible, what a pilot working the charts of T.O. GR1F-16CJ-1-1 by hand would get. It is part of the SOURCE tool suite and is used for DCS mission planning; TOLD values are copied by hand onto the mission data card (MDC).

1. **The manual's procedure is the spec.** Where the calculator could be smarter than the manual, it does what the manual says: slope as end-to-end elevation difference, RCR interpolation as written, fixed corrections as printed, no extrapolation outside a chart.
2. **Two values for every result.** *Exact* = interpolated from the chart curves without rounding. *Conservative* = every input and intermediate value rounded to its step in the worse direction (section 5).
3. **Only manual data.** Stores not in Fig. B1-1 are not estimated; the pilot enters their drag index as an additional value. Gross weight is read from DCS.
4. **Geometry is automatic, meaning is declared.** Curves are extracted from the PDF's vector data; which axis is which, and what each curve stands for, comes from a hand-checked chart spec.
5. **Nothing passes unchecked.** Every chart passes geometric self-checks, the manual's sample problems and an overlay review before it is used.
6. **Problems are marked, everything else is quiet.** Red appears only for a cited rule (AFMAN 11-2F-16V3 runway criteria, chart limits).
7. **Clean wiring.** Each concern lives in one module with a documented interface, so an agent can understand and change it quickly (for example during the later data consolidation).

## Step overview

Five steps, each usable on its own. Step 1 is the first thing pilots use: a full TOLD for the MDC.

| Step | Delivers | Manual parts | Gate to next step |
| --- | --- | --- | --- |
| 0. Foundations | Repo, extraction pipeline, chart spec format, test harness, CI, design tokens | Appendix B Part 1 (B1-1 tables) | Pipeline extracts B2-1 to B2-3 and passes their sample problems |
| 1. TOLD | Takeoff and landing data per AFMAN 11-2F-16V3 para. 2.5.1, exact and conservative, figure view, Limitations page, deployed | Parts 1, 2, 7 | Definition of done (section 6) met |
| 2. Performance | Single calculations: ceilings, optimum altitude, climb, cruise, descent, diversion | Parts 3, 4, 6 | Sample problems pass; design check passed |
| 3. Flight plan and fuel | Leg chain with weight updates, store drops, joker/bingo; recovery and alternate fields; airfield profiles; landing GW from the plan | Parts 3 to 7 combined | Hand-check of one complete mission |
| 4. Combat | Turn performance, accelerations, combat ceilings, fuel flow, E-M style plots | Part 8 | Sample problems pass |
| Later | Engine selection (Appendix A, C), F-16C/D, configuration options (SEC, drag chute), hPa, other aircraft | Appendix A, C | Separate decision each |

Each step starts with a mockup on the design canvas, then builds; see section 10.

## Architecture and repository

All calculation runs in the browser; the server only serves static files. Chart data is small (about 30 kB per appendix part as JSON), so no calculation API is needed.

```
Manual PDF  ->  extraction/  ->  perf/data  ->  perf/src/core  ->  perf/web
(HAF supp.)     Python,          chart JSON,    pure functions,    static UI,
 App. B         offline,         versioned      chains, rounding   in browser
                specs+checks                          ^                 |
                                                      |                 v
                                            src/airfields         nginx reverse
                                            (step 3, swapped      proxy, public
                                             at consolidation)
```

Only the extraction step touches the PDF; the browser never does anything but read versioned JSON and compute.

The calculator is a new top-level app `perf/` in the SOURCE repo, next to `atobrief/`, `sourcedcs-web/` and `crc-sync/`. **The repo's root CLAUDE.md and the existing apps set the conventions** (language, module style, test runner, Python tooling via `flake.nix`); where they differ from a technical choice in this plan, they win. Layout:

```
perf/                      new app, own package.json and Dockerfile like the others
  README.md                what it is, how to run it, how the data is made
  extraction/              Python, offline: PDF -> chart JSON (tested like tools/)
    specs/                 one hand-checked YAML spec per figure
    tests/
  data/                    generated chart JSON + store tables, committed, versioned
  src/core/                pure functions: interpolation, chart chains, rounding
  src/airfields/           airfield schema + loader (step 3); only place that reads airfield data
  web/                     static page (no build step unless the repo convention has one)
  tests/                   core tests, sample problems as golden tests
  Dockerfile               nginx:alpine serving web/ + data/
docs/wip/TOLD.md           this plan
docs/mockups/perf-*.html   approved mockup boards
docs/adr/                  one ADR per decision listed below
infra/                     compose service + nginx template for the perf. subdomain
```

Rules:

- **Data flows one way:** PDF → `extraction/` → `data/` → `src/core/` → `web/`. No module reads a source it does not own.
- **`src/core/` has no UI and no I/O.** Other SOURCE tools can import it later.
- **`src/airfields/` hides where airfield data comes from.** Version 1 reads a JSON file; the later consolidation swaps only this folder.
- **Units in names** (`lengthFt`, `thresholdElevFt`, `windKt`).
- **State in the URL** for sharing a computed TOLD; last inputs kept in browser storage as a convenience only.
- **Data version shown in the app** (Limitations page).
- **The manual PDF is not committed** (12.6 MB, distribution restriction). Extraction takes its path as an argument and refuses any file whose SHA-256 is not `7954f2391a66bffc79d77027cdb5063a332ba31a693dba1e42f0a67b276c791b` (HAF supplement, Change 8, 722 pages).
- **Pressure altitude** must agree with `crc-sync/src/altimetry.js`; a parity test like the repo's other `*-parity` tests guards it.
- **Reuse later:** `tools/miztoyaml` (.miz parsing) and `data/weaponsdata.json` for a future loadout import.

Decisions to record as ADRs (next free numbers in `docs/adr/`):

1. perf replicates the manual's procedure; the manual's text is the spec.
2. Every result has an exact and a conservative value; conservative rounds toward the worse result at every step.
3. Only Figure B1-1 stores are selectable; any other store enters as an additional drag index.
4. perf is public, without login.
5. Normal landing is the manual's short-field landing (aerodynamic braking to 100 KIAS, then maximum braking); speeds at 13° AOA as the manual states.

The work key `TOLD` is used for `docs/wip/` because `U-PERF.md` already exists there.

## Step 0: Foundations

Step 0 turns the prototype's throwaway scripts into a repeatable pipeline: one command extracts every specified figure, checks it, and writes versioned JSON plus overlay images for review.

### 0.1 Repository and tooling

- [ ] Create perf/ (section 3) following the repo's conventions; add it to the root CLAUDE.md.
- [ ] Python dependencies for `extraction/` (PyMuPDF, PyYAML, Pillow) added to `flake.nix`.
- [ ] perf/README.md and the ADRs from section 3 written before the first feature.
- [ ] CI: lint, type check, core tests, extraction checks, schema check of data files.

### 0.2 Chart spec format

One YAML file per figure, written by hand from the rendered page. It declares meaning; the extractor only measures.

- Figure id, page index, engine, title text that must appear on the page.
- Panels in reading order, each with: clip rectangle, panel type (curve family, guideline panel, single curve, linear scale pair, lookup table), axis titles and the edge they must appear on, tick labels expected, units.
- Curve families: parameter name, expected values in order, physics direction (for example distance rises with GW).
- Guideline panels: baseline value, families split by direction (uphill/downhill, headwind/tailwind) and their physical meaning.
- Fixed corrections printed on the chart (for example 0.8 kt per 1 % CG, ×1.18 at 8° pitch).
- Sample problem from the text: inputs, documented answers, and the drawn example path to extract.

### 0.3 Extractor and checks

Generalised from the prototype, which already passes B2-1 to B2-3:

- [ ] Tick calibration snapped to grid lines; fails if any label is more than 0.6 pt off the fitted line.
- [ ] Curve chaining, y-monotonic splitting, dash joining; fails on unlabelled curves or leftover labels.
- [ ] Order check (curve parameters monotonic in space) and physics direction check per family.
- [ ] Axis-title check: the declared title must sit on the declared edge, otherwise stop.
- [ ] Drawn example path extracted and compared panel by panel with the engine.
- [ ] Overlay PNG per figure (extracted curves in red over the page) for human review; review is recorded in the spec (`reviewed: <name, date>`).
- [ ] Tables (Fig. B1-1) read by word position with declared column boundaries, cross-checked against a second reading of the rendered page; every disagreement goes to a person.
- [ ] Known errors in the manual (for example the SEC value in the B7-2 sample) listed in a `manual-errata.yaml`, never patched silently.

### 0.4 Design foundation

- [ ] Design tokens and components from section 10 as one stylesheet and component set in `perf/web`.

### 0.5 Worked example: spec for Figure B2-3

The prototype's extraction of B2-3 written as a spec. Page coordinates are PDF points; they come from the prototype and were checked by overlay. Every spec follows this shape.

```yaml
figure: B2-3
title: Takeoff Distance
engine: F110-GE-129
page_index: 285            # 0-based index in the PDF; printed page B2-9
must_contain: ["Takeoff Distance", "F110"]
x_axis:                     # shared by all panels
  name: takeoff_distance
  unit: 1000 ft
  label_band_y: [690, 697]
  ticks: [0, 2, 4, 6, 8, 10, 12]
  frame_x: [104.0, 536.2]
panels:
  - id: gw
    type: curve_family
    y: {name: takeoff_factor, title: TAKEOFF FACTOR, edge: left, label_band_x: [90, 100], ticks: [1, 2, 3, 4, 5, 6, 7]}
    frame_y: [136.3, 352.4]
    param: {name: gross_weight, unit: 1000 lb, values: [20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48]}
    order: distance at a given takeoff factor rises with gross_weight
  - id: cg
    type: guideline_panel
    y: {name: cg, unit: "% MAC", title: CG, edge: left, ticks: [30, 35, 40]}
    frame_y: [363.3, 435.4]
    baseline: 35
    min_lines: 12
  - id: di
    type: guideline_panel
    y: {name: drag_index, title: DRAG INDEX, edge: left, ticks: [0, 200, 400]}
    frame_y: [446.4, 518.5]
    baseline: 0
    physics: distance never falls as drag_index rises
  - id: slope
    type: guideline_panel
    y: {name: slope, unit: "%", title: SLOPE, edge: left, ticks: [0, 1, 2]}
    frame_y: [529.4, 601.5]
    baseline: 0
    families: {uphill: distance rises, downhill: distance falls}   # split by direction, not line style
  - id: wind
    type: guideline_panel
    y: {name: wind, unit: kt, title: WIND, edge: left, ticks: [0, 20, 40]}
    frame_y: [612.4, 684.5]
    baseline: 0
    families: {tailwind: distance rises (drawn to 20 kt), headwind: distance falls}
corrections:
  - 8 deg pitch attitude: distance x 1.18
sample_problems:
  - inputs: {takeoff_factor: 3.16, gross_weight_lb: 33000, cg_pct: 37, drag_index: 150, slope_pct: 1, headwind_kt: 10}
    expected: {distance_ft: 4243}
  - inputs: {takeoff_factor: 1.85, gross_weight_lb: 33000, cg_pct: 37, drag_index: 150, slope_pct: 1, headwind_kt: 10}
    expected: {distance_ft: 2384}
drawn_path: extract          # dashed A to G path on the page, checked panel by panel
reviewed: null               # name and date after overlay review
```

### 0.6 Sample problems as golden tests

From the Appendix B text. Prototype values show the accuracy reached so far; tolerance 2 %.

| Figure | Inputs | Manual | Prototype |
| --- | --- | --- | --- |
| B2-1 | 40 °C, 2,000 ft | MIL 3.16, AB 1.85 | 3.162, 1.847 |
| B2-2 | 33,000 lb, CG 37 % | 170 KIAS at 35 %, 168 at 37 %; rotation 158 non-AB, 153 AB; 181 at 8° pitch | 170.4, 168.8; 158.8, 153.8; 182.3 |
| B2-3 | TOF 3.16, 33,000 lb, CG 37 %, DI 150, 1 % uphill, 10 kt headwind | 4,243 ft; 2,384 ft with AB TOF 1.85; 5,007 ft at 8° | 4,224; 2,382; 4,985 |
| B7-1 | 20,000 lb | Touchdown 125 KIAS, final approach 136 KIAS | not yet extracted |
| B7-2 sh. 1 | 2,000 ft, 40 °C, 28,000 lb | 3,902 ft PRI; SEC 4,058 ft (×1.04) | not yet extracted |
| B7-2 sh. 2 | from 3,902 ft, RCR 16, 10 kt headwind, 1 % uphill | 3,375 ft | not yet extracted |

B7-2 sh. 2's text labels its 3,902 ft entry "SEC" although 3,902 ft is the PRI value: the first entry for `manual-errata.yaml`. Samples for B2-4 to B2-6 are read from the Part 2 text when those figures are specified.

## Calculation core and conservative rounding

The core is a set of pure functions, one per figure, chained in the order the manual's text prescribes. Each returns its value, the warnings it raised, and the path points for the figure view.

### 5.1 Building blocks

- **Curve family:** evaluate every curve at the input, then interpolate linearly between the two neighbouring parameter values. This is what a pilot does by eye.
- **Guideline panel:** find the two guidelines bracketing the entry point on the baseline, follow both to the target value, interpolate with the same fraction.
- **Linear scale pair:** a second scale on the same axis (MIL and MAX AB takeoff factor) is a linear map.
- **Fixed corrections:** applied exactly as printed (CG 0.8 kt per 1 %, 8° pitch ×1.08 speed and ×1.18 distance, RCR decrements, roll trim 2 kt per dot).
- **Out of range:** an input outside the chart's drawn range is rejected with the figure and input named. Never extrapolated.

### 5.2 Conservative value

Every input and every intermediate value read off a chart is a rounding point. At each point the core evaluates both directions (down to the step, up to the step) and keeps the one that makes the final output worse. With about ten rounding points per chain that is at most 1,024 evaluations, which takes milliseconds in a browser.

Why automatic and not a hand-set direction per quantity: the right direction is not always obvious, and the manual itself warns that refusal speed can rise with gross weight at low RCR. Trying both directions is never wrong.

"Worse" per output:

| Output | Worse means |
| --- | --- |
| Takeoff distance, landing distance, runway used | longer |
| Refusal speed | lower |
| Rotation, takeoff, final approach, touchdown speed | higher |
| Acceleration check speed | higher (a check computed too low hides a real problem) |

Steps:

| Quantity | Step |
| --- | --- |
| Pressure altitude | 100 ft |
| Temperature | 1 °C |
| Gross weight | 100 lb |
| Drag index | 1 |
| CG | 0.5 % MAC |
| Wind, gust | 1 kt |
| Slope | 0.1 % |
| RCR | 1 |
| Takeoff factor | 0.01 |
| Speeds | 1 kt |
| Distances | 10 ft |

Each output is computed with its own worst chain; two outputs sharing an intermediate (takeoff factor feeds distance, acceleration check and refusal speed) may use different rounded values of it. The rule is the project's own and is stated on the Limitations page.

### 5.3 Inputs derived before the charts

- **Pressure altitude** from field elevation and altimeter setting (inHg) with the standard-atmosphere relation, matching what the altimeter shows at 29.92:

```latex
PA = h_{\text{field}} + 145442\,\text{ft} \cdot \left[1 - \left(\frac{QNH}{29.921}\right)^{0.190263}\right]
```

- **Slope** = (far-end threshold elevation − near-end threshold elevation) / runway length × 100, as defined in Part 2. Uphill positive.
- **Wind:** one field, magnetic, `230/08G15`. Headwind from the steady wind, crosswind from the gust (Fig. B2-11 instruction). Runway heading also magnetic.
- **Drag index** = basic aircraft + Fig. B1-1 stores per station (tank values depend on what is at 3/7, tip values are deltas to the AIM-9 baseline) + the pilot's additional drag index.
- **Units:** inHg only for now; the conversion sits in one function so hPa is a small change.

## Step 1: TOLD

Step 1 delivers every MDC TOLD field required by AFMAN 11-2F-16V3 para. 2.5.1 for the F-16C with F110-GE-129, from about 20 figures, deployed publicly.

### 1.1 Chart inventory

| Figure | Content | Used for | Status |
| --- | --- | --- | --- |
| B1-1 sh. 1 to 7 | Drag indexes and weights | Drag index builder | Read visually for prototype; needs table extraction |
| B2-1 | Takeoff factor | All takeoff charts | Extracted, sample passes |
| B2-2 | Takeoff speed | Rotation, takeoff speed | Extracted, sample passes |
| B2-3 | Takeoff distance | Takeoff distance, runway used | Extracted, sample passes |
| B2-4 | Acceleration check speed | Check at 2,000 ft (1,000 ft if roll under 2,500 ft) | To do |
| B2-5 sh. 1 to 3 | Refusal speed, non-AB (dry, wet, snow/icy) | Refusal speed dry/wet, MIL | To do |
| B2-6 sh. 1 to 3 | Refusal speed, AB | Refusal speed dry/wet, MAX AB | To do |
| B7-1 | Landing speed (13° AOA) | Final approach and touchdown speed | To do |
| B7-2 sh. 1 to 2 | Short field landing distance, uncorrected and corrected (RCR, wind, slope) | Landing distance dry/wet | To do |

Deferred to later steps: B2-7/B2-8 and B7-2 sh. 4 to 6 (drag chute), B7-2 SEC sheet, B2-9 (AB blowout speed), B2-10 (asymmetric roll trim), B2-12/B2-13 (brake energy), B2-11 (crosswind limits).

### 1.2 Work packages, in order

1. **Data:** specs and extraction for every figure in 1.1; overlay review; sample problems as tests; B1-1 tables extracted and cross-checked.
2. **Core:** chains for takeoff (factor → speed → distance, acceleration check, refusal speed dry/wet for MIL and MAX AB) and landing (speeds, uncorrected distance → corrected for RCR, wind, slope), each for normal landing weight and heavyweight (takeoff GW), dry and wet. Conservative chains per section 5.
3. **Rules:** runway criteria as checks with their paragraph: MIL roll over 50 % (afterburner required, 3.6.6), any takeoff roll over 80 % (3.6.3), landing roll over 80 % (3.18), RCR below 10 at the landing field (3.18).
4. **UI:** the TOLD page as in the approved mockup (inputs I and II, TOLD tables in MDC order with exact and conservative columns), figure view with drawn path for every value, Limitations page, dark mode, fit-to-width scaling, and a print stylesheet for a paper copy through the browser's print dialog: one A4 or Letter page, always black on white, inputs as plain values, no controls, data version, app version and date in the footer. No PDF library.
5. **State:** shareable URL, last inputs restored from browser storage.
6. **Deployment:** static Docker image behind the nginx reverse proxy (section 12).
7. **Validation:** pilot hand-check scenarios (section 11).

### 1.3 Inputs

- Aircraft: takeoff GW (from DCS), landing GW, CG (default 35 % MAC, the charts' reference), stores per station from Fig. B1-1, additional drag index.
- Field: runway designator, magnetic heading, length available, both threshold elevations, altimeter (inHg), temperature (°C), wind with gust, RCR dry (default 23) and RCR wet (default 18, the manual's value for wet concrete when RCR is unknown).

### 1.4 Outputs, in MDC order

- Takeoff (MIL and MAX AB): rotation speed, takeoff speed, takeoff distance, runway used, acceleration check speed, refusal speed dry and wet.
- Landing (dry and wet), normal and heavyweight: final approach speed, touchdown speed, landing distance, runway used.

### 1.5 Definition of done

- [ ] All figures in 1.1 extracted, overlay-reviewed and signed off in their spec.
- [ ] Every sample problem in Appendix B Parts 2 and 7 for these figures passes within 2 % (documented errata excepted).
- [ ] Drawn example paths match the engine panel by panel.
- [ ] Pilot hand-check passed within ±2 kt and ±3 % (format decided later).
- [ ] Mockup approved; page matches it in light and dark, and prints on one A4 or Letter page.
- [ ] Deployed; data version visible; perf/README.md current.

## Step 2: Performance

Step 2 adds stand-alone calculations from Parts 3 to 6, each answering one planning question with the aircraft from section I.

| Calculation | Figures | Answers |
| --- | --- | --- |
| Ground operation fuel | Part 3 text (25 lb/min) | Fuel to taxi |
| Climbout fuel, time, distance | B3-1 (MIL), B3-2 (MAX AB) | Brake release to climb speed |
| Cruise ceilings, optimum cruise altitude | B3-3 | Optimum altitude, MIL cruise and service ceiling |
| Climb fuel, time, distance | B3-4 (MIL), B3-5 (MAX AB) | Climb between two altitudes |
| Optimum cruise | B4-1 | Optimum Mach and altitude |
| Subsonic cruise | B4-3 (11 altitude tables, bank angle sheet) | Fuel flow and specific range at an altitude and Mach |
| Diversion decision | B4-4 (divert, loiter) | Divert or hold |
| Best cruise altitude, short range | B4-5 | Altitude for short legs |
| Descent | B6-1 (max range idle), B6-2 (penetration), B6-3 (inoperative engine) | Fuel, time, distance in descent |

Notes:

- The subsonic cruise data is printed as tables, not nomograms: table extraction (0.3) with a second-reading cross-check is the main data work.
- **New component:** a compact "question → answer" block (inputs on top, result table below, figure link), in the same table style as the TOLD page.
- **Navigation:** with section IV added the content no longer fits one page; a tech-order style table of contents appears, and TOLD stays its own page.
- **Conservative values:** fuel used and distance worse = higher, ceilings worse = lower. Optimum altitude and Mach are shown exact only (no meaningful worse direction).

## Step 3: Flight plan, fuel and airfields

Step 3 chains the step 2 calculations into a mission and fills the landing block from the plan instead of typed values. Appendix B has no Part 9 mission planning charts (deleted in Change 7), so the chain is built from Parts 3 to 7 the way Part 9 of Appendix A describes it.

### 3.1 Flight plan

- Leg table: start-up and taxi, takeoff, climb, cruise legs, combat allowance, descent, landing; one row per leg.
- Gross weight and drag index carried from leg to leg; store events at a waypoint (tank drop, weapon release) change both.
- Each leg's fuel depends on its start weight, so legs are computed in order.
- Landing GW at the recovery field comes from the plan and replaces the typed value.

### 3.2 Fuel

- Joker and bingo for the recovery field and the alternate.
- Conservative value: fuel burn rounded up, fuel remaining rounded down.

### 3.3 Airfields

- Section II gets three field blocks: Departure, Recovery, Alternate. Heavyweight landing stays tied to Departure.
- **Airfield profiles** fill a block from a list: runway ends with designator, magnetic heading, length available, threshold elevation of both ends, surface (concrete or asphalt, for the wet RCR default). Weather, RCR and altimeter are never stored.
- Version 1: one JSON file in `perf/src/airfields/`, maintained by an admin through git; personal additions in browser storage. The later SOURCE data consolidation replaces only that package.

### 3.4 Design additions

- Wide leg table: on narrow windows it scrolls inside its own box.
- Profile selector at the top of each field block (existing input component).

## Step 4 and later extensions

### 4.1 Combat (Part 8, about 80 pages)

- Combat ceilings and optimum cruise altitude (B8-1), level flight combat speeds and altitudes (B8-2, B8-3), fuel flow MIL and MAX AB (B8-4).
- Accelerations, MIL at sea level to 30,000 ft and MAX AB to 40,000 ft (B8-5 to B8-13).
- Turn performance by altitude (B8-14 onward).
- **New component:** monochrome plots (doghouse, E-M style), drawn with line style and labels instead of colour, like the figure view.
- Values shown exact only unless a clear worse direction exists.

### 4.2 Later, each a separate decision

- **Engine selection:** Appendix A (F100-PW-229) and C (F100-PW-229 with CFTs) use the same chart layouts, so the step 0 pipeline extracts them with new specs only. Chart data is stored per engine from step 0, never hard-coded.
- **F-16C or D:** different basic weight and drag index (Fig. B1-1 sheet 1).
- **Configuration options:** 8° liftoff pitch, SEC engine control (landing ×1.04), drag chute (refusal speed and landing sheets), asymmetric loads (roll trim B2-10), brake energy (B2-12, B2-13), AB blowout speed (B2-9).
- **hPa altimeter setting.**
- **Other aircraft (F/A-18):** a separate manual, chart set and core per aircraft; the architecture allows it, but each aircraft is its own project.

## Design system and UI

The look is a printed tech-order page: black on white, white on black in dark mode, Times New Roman, red only for a problem with a cited rule. The approved mockup is the reference: `docs/mockups/perf-told.html`, `perf-figure.html`, `perf-limitations.html`.

### 10.1 Fixed from step 1

- **Colours:** ink, paper, one grey for secondary text and rules, red for problems. Nothing else, ever.
- **Type:** Times New Roman, one type scale, tabular figures.
- **Components:** section heading (small caps, Roman numeral), underlined input field, data table with exact/cons. column pairs, italic subheading row, red problem marking, figure view (MIL solid, MAX AB dashed, circled letters Ⓐ to Ⓖ), link to a subpage.
- **Layout:** fixed paper width, scaled to the window like a PDF viewer; works on half of a 14-inch laptop screen; prints on A4 or Letter, always black on white.
- **Notes and caveats** live on the Limitations subpage, never on the working page.

Tokens, taken from the approved mockup:

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| paper | #ffffff | #000000 | Background |
| ink | #000000 | #ffffff | Text, rules under headings, chart paths |
| grey | #555555 | #a8a8a8 | Secondary text, figure references, placeholders |
| rule | #bbbbbb | #444444 | Separators between table groups |
| alert | #b00000 | #ff6b6b | Problem values only |

| Element | Size and style |
| --- | --- |
| Font | 'Times New Roman', Times, 'Liberation Serif', serif; tabular figures |
| Page | 1280 px wide, padding 56 px top and bottom, 80 px sides; scaled to the window |
| Page title | 30 px bold small caps, letter-spacing 0.04em, centred |
| Section heading | 18 px bold small caps, letter-spacing 0.05em, 1 px ink rule below |
| Body and tables | 17 px, line-height 1.4; drag index table 16 px |
| Secondary text | 14 to 15 px, grey |
| Inputs | bold value, right-aligned, 1 px underline, no box |
| Conservative column | bold; exact column regular |
| Figure path | MIL solid 1.8, MAX AB dashed 1.6 (5 3), circled letters radius 5 (PDF points) |

### 10.2 Section numbering, final now

| Section | Content | Arrives in |
| --- | --- | --- |
| I. Aircraft | GW, CG, drag index | 1 |
| II. Fields | Departure; then Recovery, Alternate | 1, 3 |
| III. TOLD | Takeoff, landing | 1, 3 |
| IV. Performance | Single calculations | 2 |
| V. Flight Plan | Leg table, store events | 3 |
| VI. Fuel | Joker, bingo | 3 |
| VII. Combat | Turn, acceleration, ceilings | 4 |
| Subpages | Limitations, Figures | grow each step |

### 10.3 Process per step

1. Mockup the new parts on the design canvas, next to the existing boards.
2. Update any existing board the step changes, so the canvas always shows the current state.
3. Design check: no new colours or fonts; every red marking has a rule; every value has exact and conservative, or is deliberately single; figure reference present; dark mode checked.
4. Approval, then build.
5. Extend the Limitations page.

## Validation and testing

Seven layers of checks, each catching a different kind of error: automatic checks catch extraction mistakes, the manual's own examples catch chain mistakes, and pilots catch everything a machine would read differently from a person.

| Layer | What | Catches | When |
| --- | --- | --- | --- |
| Extraction checks | Tick fit, curve count, order, physics direction, axis titles (0.3) | Swapped axes, wrong labels, merged curves | Every extraction run, CI |
| Overlay review | Extracted curves in red over the page, signed off in the spec | Anything the checks miss | Once per figure, and after every re-extraction |
| Sample problems | Manual's worked examples as unit tests, tolerance 2 % | Wrong chain order, wrong corrections | CI |
| Drawn example path | Each panel's intermediate point vs. the engine | Which panel is wrong | CI |
| Analytic charts | Standard atmosphere, airspeed conversion, turn conversion, crosswind components vs. formula | Extractor accuracy itself | Once, step 0 |
| Pilot hand-check | Fighter pilots work prepared scenarios from the paper charts | Differences between machine reading and a human | Before each step's release |
| DCS comparison | A few reference takeoffs and landings in the sim | Sim vs. manual difference (documented, not corrected) | Step 1 release |

Pilot hand-check: format and scheduling are decided later. Agreed tolerance: ±2 kt for speeds, ±3 % for distances.

- A failed sample problem is not automatically an extraction error: the manual has misprints, which go into `manual-errata.yaml`.

## Deployment and operations

The app is a static build in its own Docker container (nginx serving the files), placed behind the existing nginx reverse proxy on the perf. subdomain, one path per aircraft (/f16, later /fa18), and public, with no login. No database and no API in step 1.

- **Repository and CI:** GitHub; GitHub Actions runs lint, type check, core tests, extraction checks and the schema check, then builds the image.
- **Image:** `nginx:alpine` serving `perf/web` and `perf/data`; a build stage only if the repo convention uses one.
- **Infra:** a `perf` service in `infra/docker-compose.yml`, an nginx template for the `perf.` subdomain in `infra/nginx/templates/`, and the nginx render tests in `infra/tests/` extended to cover it.
- **Access:** public, no login (decided 27 Oct 2026). The manual's cover carries a distribution restriction; the app ships data extracted from it and shows its pages in the figure view.
- **Versions:** app version and data version shown on the Limitations page; a changelog in the repo.
- **Airfield data (step 3):** a JSON file in the repo, no new API; the later consolidation replaces `perf/src/airfields/`.
- **Saved loadouts or shared state:** not before step 3; if needed then, a small service added, with a login only for what writes data.

## Open questions

None for now: every question was answered on 27 Oct 2026. Validation details are deferred by decision.

### My own follow-up (no answer needed)

- Done 27 Oct 2026: AFMAN 11-2F-16V3 para. 2.5.1, 3.6.3, 3.6.6 and 3.18 checked word for word; the field list and runway rules match, and 3.18's RCR-below-10 rule was added.
