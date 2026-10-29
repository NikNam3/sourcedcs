<!-- Exported from the planning doc on 2026-10-27. Source of truth from here on: this file. -->
# F-16 Performance Calculator — Implementation Plan

Oct 27, 2026 · @NikNam3 · revised Oct 28, 2026 after the step 0 design review (see "Decisions of 28 Oct 2026" at the end)

## Goal and principles

The calculator outputs, as exactly as possible, what a pilot working the charts of T.O. GR1F-16CJ-1-1 by hand would get. It is part of the SOURCE tool suite and is used for DCS mission planning; TOLD values are copied by hand onto the mission data card (MDC).

1. **The manual's procedure is the spec.** Where the calculator could be smarter than the manual, it does what the manual says: slope as end-to-end elevation difference, RCR interpolation as written, fixed corrections as printed, no extrapolation outside a chart.
2. **Two values for every result.** *Exact* = interpolated from the chart curves without rounding. *Conservative* = every input and intermediate value rounded to its step in the worse direction (section 5).
3. **Only manual data.** Stores not in Fig. B1-1 are not estimated; the pilot enters their drag index as an additional value. Gross weight is entered by hand, read off DCS by the pilot, in this and every later version; it is never imported.
4. **Geometry is automatic, meaning is declared.** Curves are extracted from the PDF's vector data; which axis is which, and what each curve stands for, comes from a hand-written chart spec.
5. **Automatic checks, not manual sign-off.** Every chart passes the extractor's geometric asserts, and every figure with a sample problem passes it as a test. Overlay images are generated for a person to look at when something seems off; no per-chart review is required.
6. **Problems are marked, everything else is quiet.** Red appears only for a cited rule (AFMAN 11-2F-16V3 runway criteria, chart limits).
7. **Clean wiring.** Each concern lives in one module with a documented interface, so an agent can understand and change it quickly (for example during the later data consolidation).

## Step overview

Five steps, each usable on its own. Step 1 is the first thing pilots use: a full TOLD for the MDC.

| Step | Delivers | Manual parts | Gate to next step |
| --- | --- | --- | --- |
| 0. Foundations | Repo, extraction pipeline, chart spec format, test harness, CI, design tokens | Appendix B Part 1 (B1-1 tables) | Pipeline extracts B2-1 to B2-3 and passes their sample problems (met 29 Oct 2026) |
| 1. TOLD | Takeoff and landing data per AFMAN 11-2F-16V3 para. 2.5.1, exact and conservative, figure view, Limitations page, deployed | Parts 1, 2, 7 | Definition of done (1.5) met |
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

The calculator is a new top-level app `perf/` in the SOURCE repo, next to `atobrief/`, `sourcedcs-web/` and `crc-sync/`. It is a separate project: it touches nothing of crc-sync or crc-desktop and only reads `crc-sync/src/altimetry.js` in one parity test. It is developed in its own worktree (`../sourcedcs-perf`, branch `perf-told`) so it never changes the branch under a crc session. Where the repo has a convention (CLAUDE.md, the Docker deploy, `flake.nix` for tooling), perf follows it; the absence of a tool elsewhere in the repo is not a reason against it here.

**Language and toolchain:** TypeScript for `src/` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`); `tsc` is the only build tool and emits native ES modules, no bundler, no framework. `node --test` runs the `.ts` tests directly (type stripping, Node ≥ 22.18). ESLint with typescript-eslint `strictTypeChecked` (for `strict-boolean-expressions`: 0 kt, 0 % and DI 0 are valid values) and Prettier. `extraction/` is plain Python run by hand: no type checker, no lint, no test suite, only its built-in asserts. One JSON Schema (`perf/schema/charts.schema.json`) is the contract between extraction and core; the TypeScript data types are generated from it.

Layout:

```
perf/                      new app, own package.json and Dockerfile like the others
  package.json             type: module; build, test, lint, typecheck, format:check, data:check
  tsconfig.json  eslint.config.js
  README.md  CHANGELOG.md
  extraction/              Python, run by hand: PDF -> chart JSON + page images
    specs/                 one hand-written YAML spec per figure
    manual-errata.yaml     known misprints, read by the tests
    out/                   overlay PNGs, gitignored
  schema/charts.schema.json
  data/f16c-f110-129/      per aircraft and engine: one JSON per figure, pages/<figure>.png, manifest.json
  src/core/                no DOM, no fetch, no I/O; chart data is passed in
    read/                  building blocks: interp, curveFamily, guidelinePanel, scalePair, table
    ctx.ts                 rounding points, exact and conservative passes
    figures/               one file per figure (b2-1.ts ...)
    told/                  takeoff.ts, landing.ts: the manual's chains
    inputs/                pressure altitude, slope, wind components, drag index builder
    rules/                 AFMAN 11-2F-16V3 checks, each with its paragraph
    data/types.ts          generated from the schema
  src/airfields/           airfield schema + loader (step 3); only place that reads airfield data
  src/web/                 UI code; tsc emits it to web/js/ (gitignored)
  web/                     index.html, figure.html, limitations.html, CSS with the design tokens, print stylesheet
  tests/                   core tests, sample problems as golden tests, one Playwright smoke spec
  Dockerfile               node:22-alpine stage (tsc) -> nginx:alpine serving web/ + data/
docs/wip/TOLD.md           this plan
docs/mockups/perf-*.html   approved mockup boards
docs/adr/                  one ADR per decision listed below
infra/                     compose service + nginx template for the perf. subdomain
```

Rules:

- **Data flows one way:** PDF → `extraction/` → `data/` → `src/core/` → `src/web/`. No module reads a source it does not own; only `src/web/` fetches the data files.
- **`src/core/` has no UI and no I/O.** Other SOURCE tools can import it later.
- **Data per aircraft and engine** from step 0 (`data/f16c-f110-129/`), so Appendix A/C and other aircraft are new folders, not a rewrite.
- **`src/airfields/` hides where airfield data comes from.** Version 1 reads a JSON file; the later consolidation swaps only this folder.
- **Units in names** (`lengthFt`, `thresholdElevFt`, `windKt`).
- **State in the URL hash** (`#v=1&…`) for sharing a computed TOLD, so inputs never reach an access log; last inputs kept in localStorage as a convenience only (step 1.2 item 5).
- **Data version shown in the app** (Limitations page).
- **The manual PDF is not committed** (12.6 MB, distribution restriction). Extraction takes its path as an argument and refuses any file whose SHA-256 is not `7954f2391a66bffc79d77027cdb5063a332ba31a693dba1e42f0a67b276c791b` (HAF supplement, Change 8, 722 pages).
- **Pressure altitude** is the pilot's hand calculation (section 5.3), not a model of the DCS altimeter. A parity test pins the ISA constants it shares with `crc-sync/src/altimetry.js` (P0, the exponent); the two compute different things otherwise.
- **The manual PDF lives only on the maintainer's machine.** CI never extracts; it checks the committed data (schema, manifest hashes) and runs the tests.
- **Reuse later:** `tools/miztoyaml` (.miz parsing) and `data/weaponsdata.json` for a possible future store import (never gross weight).

Decisions to record as ADRs (next free numbers in `docs/adr/`, 0148 onward):

1. perf replicates the manual's procedure; the manual's text is the spec. Example recorded in it: pressure altitude is field elevation plus the altimeter-setting correction, as a pilot works it, not what the DCS altimeter at 29.92 shows on a non-standard day.
2. Every result has an exact and a conservative value; conservative rounds toward the worse result at every step.
3. Only Figure B1-1 stores are selectable; any other store enters as an additional drag index.
4. perf is public, without login.
5. Normal landing is the manual's short-field landing (aerodynamic braking to 100 KIAS, then maximum braking); speeds at 13° AOA as the manual states.
6. TypeScript, the toolchain above, and the JSON Schema as the contract between extraction and core.

The work key `TOLD` is used for `docs/wip/` because `U-PERF.md` already exists there.

## Step 0: Foundations

Step 0 turns the prototype's throwaway scripts into a repeatable pipeline: one command extracts every specified figure, checks it, and writes versioned JSON, the figure-view page images and overlay images for a person to look at.

### 0.1 Repository and tooling

- [x] Create perf/ (layout above; its Dockerfile and later-step folders come with steps 1 and 3) following the repo's conventions; add it to the root CLAUDE.md.
- [x] TypeScript toolchain as in "Language and toolchain": `tsconfig.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`), `eslint.config.js` (typescript-eslint `strictTypeChecked` with `strict-boolean-expressions`, `switch-exhaustiveness-check`, `no-unnecessary-condition`), Prettier. npm scripts: `build`, `test`, `lint`, `typecheck`, `format:check`, `data:check`.
- [x] `perf/schema/charts.schema.json`, and `src/core/data/types.ts` generated from it with `json-schema-to-typescript` (a script, committed output; CI fails if regenerating changes it).
- [x] `data:check`: validates every file in `data/<aircraft-engine>/` against the schema and its SHA-256 against `manifest.json`. The manifest holds the data version, the PDF's SHA-256, the extractor's git commit and one hash per data file and page image. The Python side does not validate on write; `data:check` is the only gate.
- [x] Python dependencies for `extraction/` (PyMuPDF, PyYAML, Pillow) added to `flake.nix`. No mypy, pytest or lint for `extraction/`.
- [x] perf/README.md and the ADRs 0148–0153 written before the first feature.
- [x] CI (`.github/workflows/perf-docker.yml`, see Deployment): lint, format check, type check, `data:check`, core tests with the coverage floor. CI never runs the extractor.
- [ ] CI: the Playwright smoke spec and the pressure-altitude parity test (step 1).
- [x] `.gitignore`: `perf/extraction/out/` and `perf/web/js/`.

### 0.2 Chart spec format

One YAML file per figure, written by hand from the rendered page. It declares meaning; the extractor only measures.

- Figure id, page index, engine, title text that must appear on the page.
- Panels in reading order, each with: clip rectangle, panel type (curve family, guideline panel, single curve, linear scale pair, lookup table), axis titles and the edge they must appear on, tick labels expected, units.
- Curve families: parameter name, expected values in order, physics direction (for example distance rises with GW).
- Guideline panels: baseline value, families split by direction (uphill/downhill, headwind/tailwind) and their physical meaning.
- Fixed corrections printed on the chart (for example 0.8 kt per 1 % CG, ×1.18 at 8° pitch).
- Sample problems from the text: inputs and documented answers. The tests read them from the spec.

The spec has no sign-off field and no drawn-path entry: the drawn example paths are not extracted in the MVP (see Validation).

### 0.3 Extractor and checks

Generalised from the prototype, which already passes B2-1 to B2-3. One command, run by hand on the maintainer's machine:

```
python3 -I extraction/extract.py <pdf> [figure ...]     # no figures given: every spec in extraction/specs/
```

It refuses a PDF whose SHA-256 is not the pinned one, and stops at the first failed assert with the figure, panel and reason.

- [x] Tick calibration snapped to grid lines; fails if any label is more than 0.6 pt off the fitted line.
- [x] Curve chaining, y-monotonic splitting, dash joining; fails on unlabelled curves or leftover labels.
- [x] Order check (curve parameters monotonic in space) and physics direction check per family.
- [x] Axis-title check: the declared title must sit on the declared edge, otherwise stop.
- [x] Outputs per figure:
  - `data/f16c-f110-129/<figure>.json`: curves in chart units, plus each panel's axis transform (chart units ↔ page points) for the figure view;
  - `data/f16c-f110-129/pages/<figure>.png`: the chart page as a greyscale image, committed, the figure view's background;
  - `extraction/out/overlay-<figure>.png`: extracted curves in red over the page, gitignored, for a person to look at when something seems off. No sign-off.
  - `manifest.json` rewritten: data version, PDF SHA-256, extractor commit, per-file hashes.
- [x] Tables (Fig. B1-1) read by word position with the column boundaries declared in the spec; the row and column counts are asserted, and the table is printed back as text for one comparison by a person against the page. No second automatic reading.
- [x] Known errors in the manual listed in `extraction/manual-errata.yaml` (figure, field, printed value, correct value, reason), never patched silently. The sample-problem tests read it. First entry: B7-2 sh. 2 labels its 3,902 ft entry "SEC" (section 0.6).

### 0.4 Design foundation

- [x] Design tokens and components from section 10 as one stylesheet and component set in `perf/web`.

### 0.5 Worked example: spec for Figure B2-3

The prototype's extraction of B2-3 written as a spec, `perf/extraction/specs/B2-3.yaml`. Page coordinates are PDF points; they come from the prototype and were checked by overlay. Every spec follows this shape: axes are named and calibrated once, and each panel names its input and output axis (a scale pair its `from` and `to`). Every axis has a `title` and the `edge` of the panel frame it must sit beyond; the axis-title check uses the frame of every panel that uses the axis. Specs B2-1 and B2-2 are in the same directory. The printed curve labels are vector glyphs, not text, so `labels` gives each value's position; the extractor assigns values to curves by these anchors (nearest curve within 3 pt and unique, one anchor per curve) and only then checks `order`. An unknown or missing spec key stops the run. Spec text is written with normal hyphens: the manual encodes hyphens as `\x06` and spaces as `\x05`/`\x03`, which the extractor maps.

```yaml
id: B2-3                        # data file name: the figure, or figure and sheet (B1-1.sh1)
figure: B2-3
sheet: null
dataset: f16c-f110-129
title: Takeoff Distance
engine: F110-GE-129
page_index: 285                 # 0-based index in the PDF
printed_page: B2-9
must_contain: ["Takeoff Distance", "F110"]
image_clip: [62, 120, 560, 712] # the figure view's page image, rendered at 2 px/pt
axes:                           # each calibrated once from its tick labels (page: the page coordinate it maps to)
  distance:       {unit: 1000 ft, page: x, label_band: [690, 697], range: [95, 545], ticks: [0, 2, 4, 6, 8, 10, 12], title: TAKEOFF DISTANCE, edge: bottom}
  takeoff_factor: {unit: "", page: y, label_band: [90, 100], range: [130, 360], ticks: [1, 2, 3, 4, 5, 6, 7], title: TAKEOFF FACTOR, edge: left}
  cg:             {unit: "% MAC", page: y, label_band: [88, 100], range: [360.3, 438.4], ticks: [30, 35, 40], title: CG, edge: left}
  drag_index:     {unit: "", page: y, label_band: [88, 100], range: [443.4, 521.5], ticks: [0, 200, 400], title: DRAG INDEX, edge: left}
  slope:          {unit: "%", page: y, label_band: [88, 100], range: [526.4, 604.5], ticks: [0, 1, 2], title: SLOPE, edge: left}
  wind:           {unit: kt, page: y, label_band: [88, 100], range: [609.4, 687.5], ticks: [0, 20, 40], title: WIND, edge: left}
  # snap: false where tick labels do not sit on grid lines (B2-1's MAX AB scale)
panels:                         # reading order
  - id: gw
    type: curve_family
    clip: [104.5, 135, 536.7, 353]
    frame: {x: [104.0, 536.2], y: [136.3, 352.4]}    # frame lines dropped
    input: takeoff_factor
    output: distance
    param: {name: gross_weight, unit: 1000 lb, values: [20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48]}
    labels: [[x, y], ...]       # one page point per value, in values order: a point on that curve beside its printed label
    order: {output: rises, check_at: [1.2, 1.5, 2, 2.5]}   # output rises with param at each input
    monotonic: rises            # optional: each curve's output along its input
    filter: {min_points: 5}     # keys: min_points, min_span_pt (extent along the input axis), stroke_width
  - id: cg
    type: guideline_panel
    clip: [104.3, 362.8, 536.7, 435.9]
    frame: {x: [104.0, 536.2], y: [363.3, 435.4]}
    input: cg
    output: distance
    baseline: 35
    families: {all: falls}      # rises | falls | any (any: the sole family); a line matching no family fails
    count: {all: 12}            # exact lines per family
  - id: di
    type: guideline_panel
    clip: [104.3, 445.9, 536.7, 519.0]
    frame: {x: [104.0, 536.2], y: [446.4, 518.5]}
    input: drag_index
    output: distance
    baseline: 0
    families: {all: rises}      # distance never falls as drag_index rises
    count: {all: 11}
  - id: slope
    type: guideline_panel
    clip: [104.3, 528.9, 536.7, 602.0]
    frame: {x: [104.0, 536.2], y: [529.4, 601.5]}
    input: slope
    output: distance
    baseline: 0
    families: {uphill: rises, downhill: falls}      # split by direction, not line style; params are magnitudes
    count: {uphill: 11, downhill: 12}
  - id: wind
    type: guideline_panel
    clip: [104.3, 611.9, 536.7, 685.0]
    frame: {x: [104.0, 536.2], y: [612.4, 684.5]}
    input: wind
    output: distance
    baseline: 0
    families: {tailwind: rises, headwind: falls}    # tailwind drawn to 20 kt; params are magnitudes
    count: {tailwind: 11, headwind: 12}
  # single_curve: input, output, monotonic: rises | falls, filter (B2-2)
  # scale_pair: from: <axis>, to: <axis>, scale_line (a clip holding the drawn to scale line: its ends are the range),
  #   frame (for the title check only); to = a * from + b (B2-1)
  # table: column boundaries, row and column counts (B1-1)
corrections: ["8 deg pitch attitude: distance x 1.18"]
sample_problems:
  - inputs: {takeoff_factor: 3.16, gross_weight_lb: 33000, cg_pct: 37, drag_index: 150, slope_pct: 1, headwind_kt: 10}
    expected: {distance_ft: 4243}
  - inputs: {takeoff_factor: 1.85, gross_weight_lb: 33000, cg_pct: 37, drag_index: 150, slope_pct: 1, headwind_kt: 10}
    expected: {distance_ft: 2384}
  - inputs: {takeoff_factor: 3.16, gross_weight_lb: 33000, cg_pct: 37, drag_index: 150, slope_pct: 1, headwind_kt: 10, pitch_8deg: true}
    expected: {distance_ft: 5007}
  - inputs: {takeoff_factor: 1.85, gross_weight_lb: 33000, cg_pct: 37, drag_index: 150, slope_pct: 1, headwind_kt: 10, pitch_8deg: true}
    expected: {distance_ft: 2813}
```

The guideline panels' clips, label ranges and families are the prototype's. Once `perf/extraction/specs/B2-3.yaml` exists, it is the authority, checked by its overlay.

### 0.6 Sample problems as golden tests

From the Appendix B text. Prototype values show the accuracy reached so far. Tolerance 2 % of the manual's value, for every sample problem (speeds included); a documented erratum replaces the printed value it corrects.

| Figure | Inputs | Manual | Prototype |
| --- | --- | --- | --- |
| B2-1 | 40 °C, 2,000 ft | MIL 3.16, AB 1.85 | 3.162, 1.847 |
| B2-2 | 33,000 lb, CG 37 % | 170 KIAS at 35 %, 168 at 37 %; rotation 158 non-AB, 153 AB; 181 at 8° pitch, rotation 171 non-AB, 166 AB | 170.4, 168.8; 158.8, 153.8; 182.3 |
| B2-3 | TOF 3.16, 33,000 lb, CG 37 %, DI 150, 1 % uphill, 10 kt headwind | 4,243 ft; 2,384 ft with AB TOF 1.85; 5,007 ft at 8°; 2,813 ft AB at 8° | 4,224; 2,382; 4,985 |
| B7-1 | 20,000 lb | Touchdown 125 KIAS, final approach 136 KIAS | not yet extracted |
| B7-2 sh. 1 | 2,000 ft, 40 °C, 28,000 lb | 3,902 ft PRI; SEC 4,058 ft (×1.04) | not yet extracted |
| B7-2 sh. 2 | from 3,902 ft, RCR 16, 10 kt headwind, 1 % uphill | 3,375 ft | not yet extracted |

B7-2 sh. 2's text labels its 3,902 ft entry "SEC" although 3,902 ft is the PRI value: the first entry for `manual-errata.yaml`. Samples for B2-4 to B2-6 are read from the Part 2 text when those figures are specified.

## Calculation core and conservative rounding

The core is a set of pure functions, one small TypeScript file per figure (`figures/`), chained in the order the manual's text prescribes (`told/`). Chart data is passed in; the core never fetches.

### 5.1 Building blocks

The building blocks in `read/` return typed results: a value, or `OutOfChart {figure, input, value, drawnRange}`. They never throw for an input outside a chart and never extrapolate.

- **Curve family:** evaluate every curve at the input, then interpolate linearly between the two neighbouring parameter values. This is what a pilot does by eye.
- **Guideline panel:** find the two guidelines bracketing the entry point on the baseline, follow both to the target value, interpolate with the same fraction.
- **Linear scale pair:** a second scale on the same axis (MIL and MAX AB takeoff factor) is a linear map.
- **Table:** lookup in an extracted table (Fig. B1-1), exact key match; no interpolation unless the manual says so.
- **Fixed corrections:** applied exactly as printed (CG 0.8 kt per 1 %, 8° pitch ×1.08 speed and ×1.18 distance, RCR decrements, roll trim 2 kt per dot).
- **Out of chart:** an input outside the chart's drawn range gives `OutOfChart` with the figure and input named. Never extrapolated.

### 5.2 Conservative value and the read context

Every chart read in a figure file goes through one call, `ctx.read(id, value, step)`, where `id` names the rounding point (for example `b2-3.gw`). The chain is run in two kinds of pass:

- **Exact pass:** `ctx.read` returns the value unchanged and records the path points for the figure view.
- **Conservative pass:** every input and every intermediate value read off a chart is a rounding point; inputs are rounding points like any other. Each rounding point is tested on its own: the chain is run with that point rounded down to its step and again rounded up, every other point exact, and for each output the direction that makes it worse is that point's direction for that output. Then one final run per output rounds every point in its own direction for that output. If the final run reads a point the single-point runs never saw (a branch inside a procedure switched, for example the acceleration check at 1,000 ft or 2,000 ft depending on the rounded takeoff roll), that point is tested the same way, with the other points in their chosen directions, and the final run is repeated. A value already on its step needs no test. The conservative value is the worst of the final run and every single-point run.

This takes about two runs per rounding point plus one per output: step 1's takeoff chain, about 45 rounding points, needs about 100 runs, well under a millisecond. Trying every combination instead (2^n runs) would need about 3·10^13 runs there. This is the pilot's procedure and it defines the conservative value: each point rounded in its own worse direction, every later reading taken from the rounded earlier values. The maximum over every combination is a different, more pessimistic number: it can round an earlier value the better way so that a later reading crosses a step boundary and rounds up a whole step, which no pilot does. The two can differ. One rounding the better way can push several later readings across a step at once, so a single step is not a bound when the readings are strongly coupled, as on real charts. The exhaustive search is kept as a test oracle, not in the app. Where the two definitions coincide (the output is monotone in every reading, or the readings do not feed each other) the tests require equality; B2-3 is on this side. On other chains they require the conservative value to be no better than the exact one and within the sum over the rounding points of each point's own one-step effect on the output, |o(up) − o(down)|, of the exhaustive one. That sum is the tests' criterion, not a proven bound for branching chains (decided 28 Oct 2026; the per-point definition decided by the supervisor after the Task 4 review, as principle 2 states it; the human was told on 29 Oct 2026 and may reverse it).

One evaluation covers all outputs of a chain and keeps, **per output**, the worst value found (`WORSE[outputKind]`, the table below). A test pins the list of rounding point ids per chain, so adding or losing a read is a visible change.

**Out of chart in the conservative pass:** if a rounding step leaves the drawn data (the exact value is inside, the step up or down is not), the conservative cell shows "—" with the figure and input named, and the exact cell is still shown. If the exact value itself is out of chart, the whole cell (exact and conservative) is rejected.

Why automatic and not a hand-set direction per quantity: the right direction is not always obvious, and the manual itself warns that refusal speed can rise with gross weight at low RCR. Trying both directions at every point is never wrong.

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

- **Pressure altitude** is the pilot's hand calculation: field elevation plus the altimeter-setting correction from the standard-atmosphere relation (inHg). It is not a model of the DCS altimeter: DCS (`crc-sync/src/altimetry.js`, reference temperature 288.97 K, temperature error) reads about 150 ft different on a 40 °C day at 2,000 ft. A parity test pins only the ISA constants the two share: P0 (`ISA_P0` 101,325 Pa = 29.921 inHg) and the exponent (`ISA_INV` = 0.190263); the hot-day difference is stated on the Limitations page.

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
| B1-1 sh. 1 to 7 | Drag indexes and weights | Drag index builder | Extracted as tables; a person's comparison against the page pending |
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

1. **Data:** specs and extraction for every figure in 1.1, passing the extractor's asserts; sample problems as tests; B1-1 tables extracted, counts asserted and compared once by a person against the printed-back text. No overlay sign-off.
2. **Core:** chains for takeoff (factor → speed → distance, acceleration check, refusal speed dry/wet for MIL and MAX AB) and landing (speeds, uncorrected distance → corrected for RCR, wind, slope), each for normal landing weight and heavyweight (takeoff GW), dry and wet. Conservative chains per section 5.
3. **Rules:** runway criteria as checks with their paragraph: MIL roll over 50 % (afterburner required, 3.6.6), any takeoff roll over 80 % (3.6.3), landing roll over 80 % (3.18), RCR below 10 at the landing field (3.18). The exact and the conservative cell are each checked against the rule and marked red on their own, so a conservative value can be red while the exact one is not.
4. **UI:** three pages, no framework: `/f16/` (the TOLD page as in the approved mockup: inputs I and II, TOLD tables in MDC order with exact and conservative columns), `/f16/figure.html#…` (figure view with the computed path for every value, over the committed page image) and the Limitations page (notes, data version, app version, the hot-day pressure altitude note). One `Inputs` object; every change recomputes everything. An input that does not parse gets a grey dotted underline and its dependent cells show "—". A rejected cell shows "—", and one grey reason line under its table per distinct reason names the figure and input (for example "B2-3: gross weight 52,000 lb outside the drawn range 20,000–48,000 lb"). Red only for cited rules. Page 1280 px wide, scaled to the window; dark mode via `prefers-color-scheme`; a print stylesheet for a paper copy through the browser's print dialog: exactly one A4 or Letter page, always black on white, inputs as plain values, no controls, data version, app version and date in the footer. No PDF library.
5. **State:** the inputs live in the URL **hash** (`#v=1&…`), so a computed TOLD can be shared and the inputs never reach a server's access log; `v` is the format version, and a hash with any other `v` (older or unknown) is refused with a grey note, and loading continues as if there were no hash. The last inputs are kept in localStorage. Precedence on load: URL hash, then storage, then defaults (CG 35 % MAC, RCR dry 23, RCR wet 18).
6. **Deployment:** static Docker image behind the nginx reverse proxy (see Deployment and operations).
7. **Validation:** the MVP layers in Validation and testing. The pilot hand-check is a later layer, not part of step 1's definition of done.

Notes carried from step 0 (questioner, 28 Oct 2026):

- Every B2-3 guideline panel's lowest line starts at 1,000 ft. A GW-panel distance under 1,000 ft (a light, low-fuel AB takeoff) is out of chart at the next panel that moves it. With CG 35, DI 0, no slope and no wind no panel moves it, and the value is returned (drawn data). The Limitations page states both cases (not "AB takeoffs under 1,000 ft are not computed"). Counting the left frame as a zero guideline would be a separate decision.
- The drag index builder's golden test: the Part 1 worked example (p254–255: 4 AIM-9L on LAU-129/A, 2 MK 84, 2 × 370 gal; store DI 142, total DI 146). The B1-1 data keeps slash values (`13/8`, subsonic/supersonic) and footnote markers (`4*`, `2**`) as strings; the builder interprets them, with tests.
- Chains that call one figure twice (MIL and AB through B2-3) give its reads an id prefix, because `ctx.read` refuses a repeated id in one run.
- B1-1 data: brace labels sit on one row only ("(SUU-30 H/B)" on CBU-58/B only, though printed against three CBUs; "JP-8" is the note of the 300-gallon row only, though it covers all fuel rows). Sheet 5 group texts keep the line-break hyphen ("ROCKET LAUNCHER- WITH:"). Sheet 7's "A(V)1A" is the manual's own text. The builder's display handles these; the data stays verbatim.
- Errata match a spec by exact figure and sheet. Decide when B7-2 is extracted: one spec per sheet, or fail loudly on another convention.
- Print: red alone is lost on a mono printer, so `.alert` gets a second, non-colour cue in print (step 1 mockup). The component specimen prints on two pages; the real page must be one (already in the DoD). Print `zoom` needs Firefox ≥ 126.
- Inputs are rounding points. The figure functions do not read their inputs; every `told/` chain reads each input through `ctx.read`, as figures.test.ts does with `input.*` ids.
- Edge tolerance at an output-edge end: R1 clamps within 0.002 of every drawn end, including curve ends on the frame's output edge (B2-3 GW 38–48 end at 12,000 ft). A reading up to about 40 ft past such an end returns 12,000 ft instead of "—". Decide in step 1 whether only input-edge ends are tolerated.
- `ctx` caps the final-run loop at `MAX_FINAL_ROUNDS = 64` per output. B2-3 pins exact agreement with the exhaustive oracle as the direction regression check.
- The B2-2 CG correction has no CG range check; the step 1 inputs limit CG.
- `tableCell`: a key matching several rows throws (a data defect). Every key cell is a string, so callers pass stations as strings.

### 1.3 Inputs

- Aircraft: takeoff GW (from DCS), landing GW, CG (default 35 % MAC, the charts' reference), stores per station from Fig. B1-1, additional drag index.
- Field: runway designator, magnetic heading, length available, both threshold elevations, altimeter (inHg), temperature (°C), wind with gust, RCR dry (default 23) and RCR wet (default 18, the manual's value for wet concrete when RCR is unknown).

### 1.4 Outputs, in MDC order

- Takeoff (MIL and MAX AB): rotation speed, takeoff speed, takeoff distance, runway used, acceleration check speed, refusal speed dry and wet.
- Landing (dry and wet), normal and heavyweight: final approach speed, touchdown speed, landing distance, runway used.

### 1.5 Definition of done

- [ ] All figures in 1.1 extracted and passing the extractor's asserts; their JSON passes `data:check` (schema and manifest hashes).
- [ ] Every sample problem in Appendix B Parts 2 and 7 for these figures passes within 2 % (documented errata applied).
- [ ] Core tests green, with the coverage floor of 90 % lines on `src/core/` (Node's built-in coverage).
- [ ] Mockup approved; page matches it in light and dark.
- [ ] Playwright smoke spec green, including print to PDF giving exactly one page on A4 and on Letter.
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

- The subsonic cruise data is printed as tables, not nomograms: table extraction (0.3: declared columns, counts asserted, printed back for one comparison by a person) is the main data work.
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

Layers of checks, each catching a different kind of error: automatic checks catch extraction mistakes, the manual's own examples catch chain mistakes, and (later) pilots catch everything a machine would read differently from a person. The MVP (step 1) runs the first three and the code tests; the rest are added later, each by its own decision.

| Layer | What | Catches | When | MVP |
| --- | --- | --- | --- | --- |
| Extraction checks | Tick fit, curve count, order, physics direction, axis titles, table counts (0.3) | Swapped axes, wrong labels, merged curves | Every extraction run (by hand; CI never extracts) | yes |
| Data check | `data:check`: schema and manifest hashes of every committed data file | Hand-edited or stale data, schema drift | CI | yes |
| Sample problems | Manual's worked examples as golden tests, tolerance 2 %, errata applied | Wrong chain order, wrong corrections | CI | yes |
| Overlay images | Extracted curves in red over the page, gitignored | Anything the checks miss, when someone looks | On demand, no sign-off | images only |
| Drawn example path | Each panel's intermediate point vs. the engine | Which panel is wrong | CI | later |
| Analytic charts | Standard atmosphere, airspeed conversion, turn conversion, crosswind components vs. formula | Extractor accuracy itself | Once | later |
| Pilot hand-check | Fighter pilots work prepared scenarios from the paper charts, ±2 kt and ±3 % | Differences between machine reading and a human | Before a release, format decided later | later |
| DCS comparison | A few reference takeoffs and landings in the sim | Sim vs. manual difference (documented, not corrected) | Once | later |

Code tests (CI, all MVP):

- Building blocks: edges of the drawn range, exactly on a curve, between curves, `OutOfChart` on both sides.
- `ctx`: exact and conservative passes on small synthetic chains, including one with a branch, so the single-point test, the branch re-test and per-output worst values are tested without chart data, and compared with the exhaustive oracle; the pinned rounding-point list per real chain.
- Inputs: pressure altitude, slope, wind components, drag index builder; the PA parity test against `crc-sync/src/altimetry.js`.
- Rules: every threshold just below, at and above.
- State: URL hash round trip; a hash with another `v` refused.
- Coverage floor: 90 % of lines in `src/core/`, Node's built-in coverage.
- One Playwright smoke spec: load, enter a sample problem, check a cell, open a figure, print to PDF on A4 and on Letter and assert exactly one page each.

A failed sample problem is not automatically an extraction error: the manual has misprints, which go into `manual-errata.yaml`.

## Deployment and operations

The app is a static build in its own Docker container (nginx serving the files), placed behind the existing nginx reverse proxy on the perf. subdomain, one path per aircraft (/f16, later /fa18), and public, with no login. No database and no API in step 1.

- **CI:** `.github/workflows/perf-docker.yml`. The test job (lint, format check, type check, `data:check`, core tests with the coverage floor, the Playwright smoke spec) runs on every push touching `perf/**` or `crc-sync/src/altimetry.js` (the parity test). Building and pushing `ghcr.io/niknam3/sourcedcs/perf` happens only on `main`, `dev` and `v*` tags, like the other docker-image services.
- **Image:** two stages. `node:22-alpine` runs `tsc`; `nginx:alpine` serves `web/` and `data/` under `/f16/`, redirects `/` to `/f16/`, and sends `Cache-Control: no-cache` with ETags, so a new data version is picked up on the next load without stale mixes of code and data.
- **Infra:** a `perf` service in `infra/docker-compose.yml` on the `web` network; a `PERF_DOMAIN` server block in `infra/nginx/templates/default.conf.template` (added to the substituted-variables list in the template's header comment, to the nginx service's `environment` in compose, which is what envsubst actually substitutes, and to `.env.example`), sending `X-Forwarded-For` like the other upstreams; `infra/tests/nginx-render.test.js` extended to cover it. `deploy.yml` listens to the perf workflow too and adds `perf` to both `docker compose pull` lines.
- **Rollout order (trap):** nginx refuses its whole config when a certificate it names is missing, which takes every site down. So, written into `infra/RUNBOOK.md`: DNS record for `PERF_DOMAIN` → `certbot certonly --webroot` on the server (as `infra/setup.sh` does it) → only then merge the infra commit. The infra changes are their own final commit, kept out of the perf-told merge until the domain and certificate exist (not set up yet).
- **Access:** public, no login (decided 27 Oct 2026). The manual's cover carries a distribution restriction; the app ships data extracted from it and shows its pages in the figure view.
- **Versions:** app version and data version shown on the Limitations page; a changelog in the repo.
- **Airfield data (step 3):** a JSON file in the repo, no new API; the later consolidation replaces `perf/src/airfields/`.
- **Saved loadouts or shared state:** not before step 3; if needed then, a small service added, with a login only for what writes data.

## Open questions

None for now: every question was answered on 27 Oct 2026. Validation details are deferred by decision.

### My own follow-up (no answer needed)

- Done 27 Oct 2026: AFMAN 11-2F-16V3 para. 2.5.1, 3.6.3, 3.6.6 and 3.18 checked word for word; the field list and runway rules match, and 3.18's RCR-below-10 rule was added.

## Decisions of 28 Oct 2026

The step 0 design review, all approved by the human. The sections above already carry them; this is the summary.

- **MVP = step 1**, the full TOLD from about 20 figures.
- **MVP validation:** the extractor's geometric asserts plus the sample problems as golden tests. Overlay PNGs are generated (gitignored) without per-chart sign-off. Dropped for now: drawn-path extraction, analytic-chart calibration, pilot hand-check, DCS comparison. The spec format has no `drawn_path` and no `reviewed`.
- **Extraction is throwaway-grade tooling:** plain Python run by hand, only its asserts. The PDF lives only on the maintainer's machine; CI never extracts.
- **Production data is checked:** one JSON Schema, TS types generated from it, CI `data:check` against the schema and `manifest.json` (data version, PDF SHA-256, extractor commit, per-file hashes). Python does not validate on write.
- **Extractor outputs per figure:** chart JSON with axis transforms, a committed greyscale page image, a gitignored overlay. One command, refuses a wrong SHA-256. B1-1 tables by word position and declared columns, counts asserted, printed back for one comparison by a person. `manual-errata.yaml` read by the tests.
- **Pressure altitude:** the pilot's hand calculation, not the DCS altimeter; the parity test pins only P0 and the exponent; the hot-day note is on the Limitations page; recorded as the example in ADR 0148.
- **Conservative step leaving the drawn data:** conservative cell "—" with figure and input named, exact still shown; exact out of chart rejects the whole cell.
- **Gross weight:** entered by hand, now and in every future version; never imported.
- **TypeScript** for `src/`, `tsc` the only build tool, native ESM, no bundler or framework, `node --test` on `.ts` directly, ESLint `strictTypeChecked` plus Prettier (ADR 0153).
- **Core structure:** typed results with `OutOfChart` from `read/`, one file per figure, chains in `told/`, every read through `ctx.read(id, value, step)`, conservative value by a single-point down/up test per rounding point (linear, not 2^n) with the worst value per output and the exhaustive search as a test oracle, rounding points pinned per chain.
- **Rules per cell:** exact and conservative each checked and marked on their own.
- **UI and state:** `/f16/`, `/f16/figure.html#…`, Limitations; one `Inputs` object; URL hash `#v=1&…` > localStorage > defaults; grey dotted underline for unparseable input; "—" plus one grey reason line per reason under its table; dark mode via `prefers-color-scheme`; print to exactly one A4 or Letter page.
- **Tests and CI:** golden samples at 2 %, building-block edges, `ctx` on synthetic chains with a branch, inputs, PA parity, rule thresholds, URL round trip, 90 % line coverage on `src/core/`, one Playwright smoke spec with the one-page print check; `perf-docker.yml` tests on `perf/**` and `altimetry.js` pushes, builds only on `main`/`dev`/`v*`.
- **Deployment:** node → nginx image, `/f16/`, `no-cache` with ETags, `perf` compose service, `PERF_DOMAIN` vhost, `deploy.yml` extended; DNS → certificate → infra merge, the infra commit kept separate until the domain exists.
- **ADRs 0148–0153:** the six listed under Architecture.
- **Worktree:** perf lives in `../sourcedcs-perf`, branch `perf-told`.
