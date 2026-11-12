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

From the Appendix B text. Tolerance 2 % of the manual's value, for every sample problem (speeds included); a documented erratum replaces the printed value it corrects. "Computed" is the figure function on the committed data in an exact pass (`tests/sample-problems.test.ts`, 30 Oct 2026, after plan 1); every sample passes, the largest difference is 0.77 % (B2-2 rotation AB at 8°).

| Figure | Inputs | Manual | Computed |
| --- | --- | --- | --- |
| B2-1 | 40 °C, 2,000 ft | MIL 3.16, AB 1.85 | 3.162, 1.847 |
| B2-2 | 33,000 lb, CG 37 % | 170 KIAS at 35 %, 168 at 37 %; rotation 158 non-AB, 153 AB; 181 at 8° pitch, rotation 171 non-AB, 166 AB | 170.4, 168.8; 158.8, 153.8; 182.3, 172.3, 167.3 |
| B2-3 | TOF 3.16, 33,000 lb, CG 37 %, DI 150, 1 % uphill, 10 kt headwind | 4,243 ft; 2,384 ft with AB TOF 1.85; 5,007 ft at 8°; 2,813 ft AB at 8° | 4,224; 2,382; 4,985; 2,810 |
| B2-4 | AB TOF 1.85, 1,500 ft from brake release, 33,000 lb, DI 150, 10 kt headwind, 1 % uphill | 129 KIAS | 128.96 |
| B2-6 sh. 1 | AB TOF 1.85, 33,000 lb, 6,000 ft runway, 10 kt headwind, 1 % uphill | 153 KIAS (RCR 23) | 152.48 |
| B7-1 | 20,000 lb | Touchdown 125 KIAS, final approach 136 KIAS | 125.35, 136.05 |
| B7-2 sh. 1 | 2,000 ft, 40 °C, 28,000 lb | 3,902 ft PRI; SEC 4,058 ft (×1.04) | 3,901.9; SEC not built (deferred, 1.1) |
| B7-2 sh. 2 | from 3,902 ft, RCR 16 (dry), 10 kt headwind, 1 % uphill | 3,375 ft | 3,375.1 |
| B7-2 sh. 2 | from 3,902 ft, RCR 4 (icy, dry family), 10 kt headwind, 1 % uphill (p388) | 8,000 ft | 8,006.1 |

B7-2 sh. 2's text labels its 3,902 ft entry "SEC" although 3,902 ft is the PRI value: the first entry for `manual-errata.yaml`. The Part 2 text has no sample for B2-5 (any sheet) or for B2-6 sheets 2 and 3; those sheets get hand-read checkpoints instead (1.6). All 15 pass within ±2 KIAS; the largest difference is 0.52 KIAS (B2-5 sh. 2, TOF 2.6, 24,000 lb, 5,000 ft, 10 kt tailwind, 1 % downhill: 84.48 against 85).

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

**Out of chart in the conservative pass:** if a rounding step leaves the drawn data (the exact value is inside, the step up or down is not), the conservative cell shows "—" with the figure and input named, and the exact cell is still shown. If the exact value itself is out of chart, the whole cell (exact and conservative) is rejected. One exception (Q1 of plan 2, 1.7): with a two-valued input, the whole cell is rejected only when the baseline run (every input at its conservative value, nothing rounded) is out of chart too; when the baseline is in chart, the exact cell shows "—" and the conservative cell is computed as usual. The case today is a loadout whose exact drag index is negative, only through removed tip missiles (−4 each exact, 0 conservative; a clean aircraft without them is 4 − 8 = −4), out of chart on B2-3 and B2-4.

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

**An input with two values (decided 29 Oct 2026):** the drag index can have an exact and a conservative value of its own, before any rounding. Removing the wingtip AIM-9s subtracts 4 per missile in the exact value (Fig. B1-1 sheet 3, note *) and nothing in the conservative one (the manual: zero "gives slightly conservative results"). The exact pass reads the exact drag index; the conservative pass starts from the conservative drag index and rounds it like any other input.

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
| B1-1 sh. 1 to 7 | Drag indexes and weights | Drag index builder | Extracted as tables; compared against the page by the human (29 Oct 2026) |
| B2-1 | Takeoff factor | All takeoff charts | Extracted, sample passes |
| B2-2 | Takeoff speed | Rotation, takeoff speed | Extracted, sample passes |
| B2-3 | Takeoff distance | Takeoff distance, runway used | Extracted, sample passes |
| B2-4 | Acceleration check speed | Check at 2,000 ft (1,000 ft if roll under 2,500 ft) | Extracted, sample passes |
| B2-5 sh. 1 to 3 | Refusal speed, non-AB (dry, wet, snow/icy) | Refusal speed dry/wet, MIL | Extracted, checkpoints pass |
| B2-6 sh. 1 to 3 | Refusal speed, AB | Refusal speed dry/wet, MAX AB | Extracted; sample passes (sh. 1), checkpoints pass (sh. 2, 3) |
| B7-1 | Landing speed (13° AOA) | Final approach and touchdown speed | Extracted, sample passes |
| B7-2 sh. 1 to 2 | Short field landing distance, uncorrected and corrected (RCR, wind, slope) | Landing distance dry/wet | Extracted, samples pass |

Deferred to later steps: B2-7/B2-8 and B7-2 sh. 4 to 6 (drag chute), B7-2 SEC sheet, B2-9 (AB blowout speed), B2-10 (asymmetric roll trim), B2-12/B2-13 (brake energy), B2-11 (crosswind limits).

### 1.2 Work packages, in order

1. **Data:** specs and extraction for every figure in 1.1, passing the extractor's asserts; sample problems as tests; B1-1 tables extracted, counts asserted and compared once by a person against the printed-back text. No overlay sign-off.
2. **Core:** chains for takeoff (factor → speed → distance, acceleration check, refusal speed dry/wet for MIL and MAX AB) and landing (speeds, uncorrected distance → corrected for RCR, wind, slope), each for normal landing weight and heavyweight (takeoff GW), dry and wet. Conservative chains per section 5.
3. **Rules:** runway criteria as checks with their paragraph: MIL roll over 50 % (afterburner required, 3.6.6), any takeoff roll over 80 % (3.6.3), landing roll over 80 % (3.18), RCR below 10 at the landing field (3.18), and a landing beyond one of Fig. B7-2 sheet 1's limit lines (maximum brake energy, MLG tire limit speed 225 kt, NLG tire limit speed 217 kt, both "no wind"), cited to the figure (decided 29 Oct 2026; with a headwind the tire lines warn more than needed, on the safe side). The exact and the conservative cell are each checked against the rule and marked red on their own, so a conservative value can be red while the exact one is not.
4. **UI:** three pages, no framework: `/f16/` (the TOLD page as in the approved mockup: inputs I and II, TOLD tables in MDC order with exact and conservative columns), `/f16/figure.html#…` (figure view with the computed path for every value, over the committed page image) and the Limitations page (notes, data version, app version, the hot-day pressure altitude note). One `Inputs` object; every change recomputes everything. An input that does not parse gets a grey dotted underline and its dependent cells show "—". A rejected cell shows "—", and one grey reason line under its table per distinct reason names the figure and input (for example "B2-3: gross weight 52,000 lb outside the drawn range 20,000–48,000 lb"). Red only for cited rules. Page 1280 px wide, scaled to the window; dark mode via `prefers-color-scheme`; a print stylesheet for a paper copy through the browser's print dialog: exactly one A4 or Letter page, always black on white, inputs as plain values, no controls, data version, app version and date in the footer. No PDF library.
5. **State:** the inputs live in the URL **hash** (`#v=1&…`), so a computed TOLD can be shared and the inputs never reach a server's access log; `v` is the format version, and a hash with any other `v` (older or unknown) is refused with a grey note, and loading continues as if there were no hash. The last inputs are kept in localStorage. Precedence on load: URL hash, then storage, then defaults (CG 35 % MAC, RCR dry 23, RCR wet 18).
6. **Deployment:** static Docker image behind the nginx reverse proxy (see Deployment and operations).
7. **Validation:** the MVP layers in Validation and testing. The pilot hand-check is a later layer, not part of step 1's definition of done.

Notes carried from step 0 (questioner, 28 Oct 2026):

- Every B2-3 guideline panel's lowest line starts at 1,000 ft. A GW-panel distance under 1,000 ft (a light, low-fuel AB takeoff) is out of chart at the next panel that moves it. With CG 35, DI 0, no slope and no wind no panel moves it, and the value is returned (drawn data). The Limitations page states both cases (not "AB takeoffs under 1,000 ft are not computed"). Counting the left frame as a zero guideline would be a separate decision.
- The drag index builder's golden test: the Part 1 worked example (p254–255: 4 AIM-9L on LAU-129/A, 2 MK 84, 2 × 370 gal; store DI 142, total DI 146). The B1-1 data keeps slash values (`13/8`, subsonic/supersonic) and footnote markers (`4*`, `2**`) as strings; the builder interprets them, with tests.
- Chains that call one figure twice (MIL and AB through B2-3) give its reads an id prefix, because `ctx.read` refuses a repeated id in one run.
- B1-1 data: brace labels sit on one row only ("(SUU-30 H/B)" on CBU-58/B only, though printed against three CBUs; "JP-8" is the note of the 300-gallon row only, though it covers all fuel rows). Sheet 5 group texts keep the line-break hyphen ("ROCKET LAUNCHER- WITH:"). Sheet 7's "A(V)1A" is the manual's own text. The builder's display handles these; the data stays verbatim.
- Errata match a spec by exact figure and sheet. Decide when B7-2 is extracted: one spec per sheet, or fail loudly on another convention. Settled in plan 1: one spec per sheet (1.6).
- Print: red alone is lost on a mono printer, so `.alert` gets a second, non-colour cue in print (step 1 mockup). The component specimen prints on two pages; the real page must be one (already in the DoD). Print `zoom` needs Firefox ≥ 126.
- Inputs are rounding points. The figure functions do not read their inputs; every `told/` chain reads each input through `ctx.read`, as figures.test.ts does with `input.*` ids.
- Edge tolerance at an output-edge end: R1 clamps within 0.002 of every drawn end, including curve ends on the frame's output edge (B2-3 GW 38–48 end at 12,000 ft). A reading up to about 40 ft past such an end returns 12,000 ft instead of "—". Decide in step 1 whether only input-edge ends are tolerated. Closed by ruling 4 of 1.7: only input-axis ends keep the tolerance.
- `ctx` caps the final-run loop at `MAX_FINAL_ROUNDS = 64` per output. B2-3 pins exact agreement with the exhaustive oracle as the direction regression check.
- The B2-2 CG correction has no CG range check; the step 1 inputs limit CG.
- `tableCell`: a key matching several rows throws (a data defect). Every key cell is a string, so callers pass stations as strings.

Notes carried from plan 1 (30 Oct 2026). For the Limitations page, in addition to the list in "Decisions of 29 Oct
2026":

- **B2-4 under 60 KIAS with a drag index** (P9): the DI panel's lowest line starts at 60 kt, so an acceleration check
  speed under 60 KIAS with a drag index above 0 is not computed (`OutOfChart` on `accel_check_speed` after
  `b2-4.gw`).
- **Drawn takeoff factor ranges** (P11, measured): B2-4 [1.09, 6.00] on the 1,000 to 2,000 ft curves the chain uses
  (the 500 ft curve runs 1.18 to 5.13, the curves from 2,500 ft up start higher); B2-5 2.10 to 6.78; B2-6 1.20 to
  3.86. Outside them the speed is not computed (`OutOfChart` on `takeoff_factor`), never extrapolated.
- **An entry outside the drawn wind or slope guidelines is not computed, on any chart** (P15; `OutOfChart` on the
  panel's output, for example `refusal_speed`). The guidelines do not start at every entry and do not all reach the
  panel's edge:
  - B2-4: the tailwind and uphill lines start at 60 KIAS, so a tailwind or an uphill slope with a lower entry is not
    computed.
  - B2-5 and B2-6: at low speeds the tailwind lines end below 20 kt. On B2-6 sheet 3 the line from 60 KIAS stops at
    18.75 kt, so a 20 kt tailwind needs an entry of about 80 KIAS or more (B2-5 sheet 3: 19.81 kt). On every refusal
    sheet the 160 and 180 KIAS headwind lines stop short of 40 kt.
  - B7-2 sheet 2: there is no tailwind or downhill line from 12,000 ft (those families run 1,000 to 11,000 ft), so a
    roll entering the wind or slope panel above 11,000 ft with a tailwind or a downhill slope is not computed.
- **Limit lines are judged only where they are drawn** (P7): a landing whose carried position lies outside a line's
  drawn range is not checked against that line. The B7-2 sample itself (2,000 ft, 40 °C, 28,000 lb) is not judged
  against either tire line.
- **B7-1's CG note**: the page says the actual approach speed may differ by ±5 kt with CG; it is not a correction
  rule and is not applied.

For plan 2 (core); decided in 1.7, which wins where they differ:

- **`wet` flag** (P2): `groundRollCorrected(ctx, fig, {uncorrectedFt, rcr, wet, headwindKt, slopePct})`. `wet` picks
  the RCR family: dry 4, 8, 16, 23 or wet 10, 12, 18. An RCR outside the chosen family's curves is `OutOfChart` on
  `rcr`; between two curves it interpolates. Plan 2's inputs carry `wet` for the landing dry and wet rows.
- **Refusal speed by RCR:** the sheet functions return the speed at the printed RCRs only, `refusal…Dry` RCR 23 and
  16, `…Wet` 18 and 12, `…SnowIcy` 8 and 4 (B2-5 `refusalNonAb…` for MIL, B2-6 `refusalAb…` for MAX AB). RCR 16 and
  12 are the read speed minus the printed decrement (B2-5 4 and 9 KIAS, B2-6 5 and 10), not rounding points; an
  `OutOfChart` at RCR 23 or 18 passes through to 16 or 12. Plan 2 interpolates between them by the Part 2 rule
  (1.6, Scope): wet between 18 and 12, dry between 23, 16, 8 and 4, so an RCR between 16 and 8 needs sheets 1 and 3.
  On snow and icy the GW curves cross: refusal speed can rise with GW, as the manual warns.
- **`limits` null semantics:** `limits` is null for the whole record when the roll is out of chart; a single verdict
  is null when the carried position lies outside that line's drawn range (not judged). Only `true` is a rule
  violation (1.2 item 3); `null` must not read as "within the limit".
- **`OutOfChart` values are in chart units:** `value` and `drawnRange` are in the panel's own unit (gross weight in
  1000 lb, the B7-2 rolls in 1000 ft) and wind and slope are magnitudes (R8, the sign is not restored). The carried
  line's `OutOfChart` (`gross_weight` on B2-5 and B2-6, `temperature` on B7-2 sheet 1) has `drawnRange: null`. The
  result carries no unit; plan 3's reason line takes it from the panel's input quantity.
- **Rounding ids are fixed per figure.** The refusal sheet functions hard-code their prefix too (`b2-5.sh1`, …,
  sheet 3 `b2-6.sh3` with chart `snow` or `icy`, giving `b2-6.sh3.snow.runway`); only `refusalSpeed` itself takes one.
  No id-prefix mechanism exists yet. A chain that calls one figure twice (MIL and AB through B2-3 and B2-4; normal
  landing weight and heavyweight through B7-1 and B7-2; dry and wet through B7-2 sheet 2) reads the same id twice,
  which `ctx` throws on as a chain defect, so it needs one (the step 0 note above). The cheap mechanism: a `ctx`
  wrapper that prefixes every id before passing the read on (`withPrefix(ctx, 'mil')` reads `mil.b2-3.gw`), with no
  change to any figure function.
- **B2-4's check distance** reads 500 to 11,000 ft (`OutOfChart` on `check_distance` outside); the chain picks 2,000
  or 1,000 ft from the takeoff roll, a branch the conservative pass re-tests (5.2).
- **Deferred minors that touch plan 2's files:** `decreased()` is duplicated in `b2-5.ts` and `b2-6.ts`; the refusal
  panel ids `gw`, `runway` (`_snow`, `_icy`), `wind`, `slope` (now in the plan's contract table) are a convention no
  code checks; `figure-refusal.test.ts` exempts icy by matching
  the sheet name string; no test yet for a B7-2 sheet 2 entry outside the wind or slope lines; B2-4's out-of-chart
  loop could add 0 ft; checkpoint inputs are numbers only (runners also take boolean flags). The step 0 note on the
  edge tolerance at an output-edge end is closed by ruling 4 of 1.7.
- **Conservative limit verdicts are not reachable yet** (final review of plan 1). 1.2 item 3 checks the conservative
  cell against the B7-2 limit lines as well as the exact one. `groundRollUncorrected` computes `limits` in every run,
  but a `Chain<K>` (`ctx.ts`) returns only `Read<number>` outputs, and `evaluate` keeps neither the run that decided a
  conservative cell nor the per-output direction map, so its side outputs are lost. Plan 2 cannot get conservative
  `limits` without changing `ctx.ts`. Two options, plan 2 decides:
  - `evaluate` returns the deciding run per output (or its direction map), so a chain can re-run it and read that
    run's `limits`;
  - the verdicts become numeric chain outputs with their own `OutputKind` (for example the roll's margin past each
    line, worse = higher), so `evaluate` rounds them like any other cell; a `null` verdict still needs a form there.

  Resolved in 1.7 (ruling 2, option A): each cell keeps the side data of the run that decided it.
- **Quantity names and units differ across figures** in the data: `refusal_speed` has unit `kt` on B2-5 and B2-6,
  every other speed `KIAS`; temperature is `deg C` on B2-1 and `°C` on B7-2 sheet 1; pressure altitude is
  `pressure_altitude` on B2-1 and `altitude` on B7-2 sheet 1. Either align them in plan 2 (spec edit and re-extract)
  or map them for plan 3's reason lines, which take the name and unit from the panel's input quantity. Resolved in
  1.7 (ruling 3): aligned at the source, `dataVersion` 8.
- **Flake watch:** one full `npm test` run after the B2-4 merge failed once and was never identified. Every full run
  since passed 318/318 (5 runs, the last 4 on the plan 1 head): not reproduced in 5 runs; keep watching. Plan 2: the
  `ctx` timing test failed once under the full suite with coverage, its bound was raised from 20 to 200 ms, and the
  full run on the plan 2 tip passed 450/450; very likely the same flake.

### 1.3 Inputs

- Aircraft: takeoff GW (from DCS), landing GW, CG (default 35 % MAC, the charts' reference), stores per station from Fig. B1-1, additional drag index.
- Field: runway designator, magnetic heading, length available, both threshold elevations, altimeter (inHg), temperature (°C), wind with gust, RCR dry (default 23) and RCR wet (default 18, the manual's value for wet concrete when RCR is unknown).

### 1.4 Outputs, in MDC order

- Takeoff (MIL and MAX AB): rotation speed, takeoff speed, takeoff distance, runway used, acceleration check speed, refusal speed dry and wet.
- Landing (dry and wet), normal and heavyweight: final approach speed, touchdown speed, landing distance, runway used.

### 1.5 Definition of done

- [x] All figures in 1.1 extracted and passing the extractor's asserts; their JSON passes `data:check` (schema and manifest hashes). Done by plan 1 (30 Oct 2026).
- [x] Every sample problem in Appendix B Parts 2 and 7 for these figures passes within 2 % (documented errata applied). Done by plan 1 (0.6); B7-2's SEC value belongs to the deferred SEC option.
- [x] Core tests green, with the coverage floor of 90 % lines on `src/core/` (Node's built-in coverage). Done by plan 2 (12 Nov 2026): 450 tests, 100 % lines.
- [x] Mockup approved; page matches it in light and dark. Built on `perf-told-p3` by plan 3 (13 Nov 2026); approved by the human from the screenshots (12 Nov 2026).
- [x] Playwright smoke spec green, including print to PDF giving exactly one page on A4 and on Letter. Done by plan 3 (13 Nov 2026): `e2e/smoke.spec.ts`, 6 tests, in CI.
- [ ] Deployed; data version visible; perf/README.md current.

### 1.6 Plan 1: data and figure functions (design of 29 Oct 2026)

Step 1 is cut into four plans, each with its own implementation plan and review, in this order: **1 data and figure
functions**, 2 core (chains, rules, drag index builder, input parsing; may start on B2-1 to B2-3 while plan 1 runs),
3 UI and state (the figure board first, then the three pages, URL hash, localStorage, the Playwright smoke spec), 4
deployment (waits on the domain and certificate). This section is plan 1's spec.

**Status: built** (merged on `perf-told` 30 Oct 2026, 318 tests, 100 % lines on `src/core/`). The text below is brought
in line with the build. The plan, with the questioner's rulings P1 to P16 (which override its task text) and the
supervisor's rulings during execution, is `docs/wip/TOLD-STEP1-P1.md`; the page evidence behind the rulings is
`docs/wip/TOLD-STEP1-P1-EVIDENCE.md`.

**Scope.** One spec per data file; sheet ids as for B1-1.

| Spec | Page index (0-based) | Content | Check |
| --- | --- | --- | --- |
| `B2-4` | 286 | Takeoff factor → distance-from-brake-release curves → GW, DI, wind, slope guideline panels → acceleration check speed | Sample 129 KIAS |
| `B2-5.sh1` | 287 | Non-AB refusal speed, RCR 23; correction text "RCR 16: −4 KIAS" | 3 hand reads |
| `B2-5.sh2` | 288 | Non-AB, RCR 18; "RCR 12: −9 KIAS" | 3 hand reads |
| `B2-5.sh3` | 289 | Non-AB, snow RCR 8 and icy RCR 4: two chart pairs, shared wind and slope panels | 2 + 1 hand reads |
| `B2-6.sh1` | 290 | AB refusal speed, RCR 23; "RCR 16: −5 KIAS" | Sample 153 KIAS |
| `B2-6.sh2` | 291 | AB, RCR 18; "RCR 12: −10 KIAS" | 3 hand reads |
| `B2-6.sh3` | 292 | AB, snow and icy | 2 + 1 hand reads |
| `B7-1` | 389 | Landing speed: final approach and touchdown over GW | Sample 136 / 125 KIAS |
| `B7-2.sh1` | 390 | Uncorrected roll: altitude → temperature → carried line → GW → roll; the three limit lines | Sample 3,902 ft |
| `B7-2.sh2` | 391 | Corrected roll: two RCR families, dry (4, 8, 16, 23) and wet (10, 12, 18), chosen by a `wet` flag (P2); wind and slope panels | Samples 3,375 ft (RCR 16) and 8,000 ft (RCR 4, P8); erratum on file |

Out of plan 1, as in 1.1: B7-2 sheets 3 to 6 (SEC, drag chute), B2-7 to B2-13. The RCR rule for values between the
sheets ("For wet runways, interpolate between wet concrete (RCR = 18) and wet (RCR = 12). For runways with no liquid
water present, interpolate between dry concrete (RCR = 23), dry (RCR = 16), snow (RCR = 8), and icy (RCR = 4)",
Part 2) is plan 2's.

**Extractor and schema.**

1. **Unscaled axis.** B2-5, B2-6 (every sheet) and B7-2 sheet 1 carry an unlabelled line from one panel into the
   next. A spec axis may say `unscaled: true` (unit `pt`): no ticks and no label band (the extractor refuses either),
   the identity transform, so its value is the page position in PDF points. The schema carries the flag. The panels
   on either side are ordinary curve families or guideline panels. Rejected: a combined "turn" panel type (a new
   reader with its own edge rules, and a different shape on B7-2), and giving the carried line a scale (a number the
   manual does not print, ADR 0148).
2. **`limit_line` panel type:** id, the printed label, input and output quantities in the panel's own axes, one
   polyline, and `beyond: above | below`. The extractor finds the (dashed) line in the declared clip, joins its dashes
   (the guideline code) and asserts exactly one line, one way along the input, inside the frame. Core judges a point
   only inside the line's drawn input range; outside it nothing is judged.
3. **B7-1** is two `single_curve` panels, final approach and touchdown. The curves share every clip, so each panel
   takes its curve by an `anchor` with `count_in_clip: 2` (P3). Final approach above touchdown is a test
   (`figure-landing.test.ts`, every whole 1,000 lb from 17 to 48), not an extractor assert.
4. **Sheet 3 of B2-5 and B2-6** declares two carried axes (`carry_snow`, `carry_icy`); its four snow and icy panels
   feed the shared wind and slope panels.
5. **The printed RCR 16 and RCR 12 decrements** are `corrections` strings, as B2-3's 8° pitch correction. The figure
   functions apply them, as `b2-3.ts` applies its correction: sheet 1 returns the refusal speed at RCR 23 and at
   RCR 16, sheet 2 at RCR 18 and at 12, sheet 3 at 8 and at 4. Plan 2 interpolates between these.
6. `types:gen` regenerates `src/core/data/types.ts`; `types:check` pins it. Errata already match by exact figure and
   sheet (the B7-2 question from step 0 is settled: one spec per sheet). A full re-extraction leaves every step 0 file
   byte-identical: the extractor change's own regression check.

**Validation.**

1. **Figure functions are in plan 1:** `src/core/figures/b2-4.ts`, `b2-5.ts`, `b2-6.ts`, `b7-1.ts`, `b7-2.ts`, like
   `b2-3.ts`. Every rounding point through `ctx.read` with an id (ids pinned per figure); the carried position is
   passed on without `ctx.read` (a pilot does not read or round a line carried across); out of chart returns
   `OutOfChart` naming the figure and the input. The limit lines come with the roll, not from a separate function:
   `groundRollUncorrected` returns `{rollFt, limits}`, where `limits` (`LimitVerdicts`, brake energy, MLG tire, NLG
   tire) judges that run's carried position and read roll, so a verdict is computable for every run, the conservative
   ones included; `ctx`'s `evaluate` does not surface a conservative run's verdicts yet (see "For plan 2").
   `limits` is null when the roll is out of chart. `groundRollCorrected` takes `wet: boolean` (P2), which picks the
   RCR family. Plan 2 builds chains on these.
2. **Golden tests:** the manual's samples within 2 %; the 15 hand-read checkpoints within ±2 kt.
3. **Hand-read checkpoints** are read off 300 dpi renders of the page by a reviewer agent before that sheet's
   extraction lane runs; the reader sees no extracted JSON and no overlay. They live in their own files,
   `perf/extraction/checkpoints/<spec id>.yaml` (`inputs`, `expected`, `tolerance_kias`, `source: hand`, `read_by`,
   `date`; the keys are the sample runners'), not in the spec YAML, so the lane that writes a spec cannot edit them.
   `tests/checkpoints.test.ts` runs them through the same runners as `sample_problems`; the data files and the schema
   do not change. A failing checkpoint is investigated on both sides; neither the reading nor the extraction wins by
   default. Spread: B2-5 sh. 1, B2-5 sh. 2 and B2-6 sh. 2 three each (the dry and wet defaults), B2-5 sh. 3 and B2-6
   sh. 3 two snow and one icy each.
4. **Limit lines** (P7): a line is judged only inside its own drawn input range; outside it the verdict is `null`
   (not judged). The sheet 1 sample (2,000 ft, 40 °C, 28,000 lb) gives brake energy `false` and both tire lines
   `null`, since its carried position lies outside their drawn range; 8,000 ft / 40 °C / 46,000 lb is beyond all
   three; 6,000 ft / 40 °C / 44,000 lb is beyond the brake energy line only; 8,000 ft / 50 °C / 46,000 lb is the
   carried-line `OutOfChart` on `temperature`, with `limits` null.
5. **Out of chart:** per figure, below and above every panel's drawn range gives `OutOfChart` naming that input,
   including wind and slope panels drawn only to a magnitude.
6. As in step 0: the extractor's asserts per spec, `data:check`, gitignored overlays without sign-off, 90 % line
   coverage on `src/core/`.

**Process.** The lanes run the extraction on this machine (`PERF_PDF=/home/nklx/dev/other/HAF-F16-Supplement.pdf`,
`nix develop`), as in step 0.

| Task | Content | After |
| --- | --- | --- |
| 1 | Extractor and schema: unscaled axis, `limit_line`, types, fixture tests; step 0 data byte-identical | — |
| 1b | Extractor robustness for the plan 1 pages (P1, P3 to P6: curve joining, anchored single curves, guideline gaps, shared labels, per-panel label tolerance); step 0 data byte-identical | 1, questioner |
| 2 | The 15 hand-read checkpoints | — |
| 3 | B2-4 | 1b |
| 4 | B2-5 sheets 1 to 3 | 1b, 2 |
| 5 | B2-6 sheets 1 to 3 | 4 |
| 6 | B7-1, B7-2 sheets 1 and 2 with the limit lines | 1b |
| 7 | Close-out: full re-extraction, all gates, 1.1 status, `perf/README.md`, handoff | 3 to 6 |

One lane worktree per task (`../sourcedcs-told-p1-t<N>` on `lane/told-p1-t<N>` off `perf-told`), at most 4 agents at
once including a questioner, all on Opus, a task review after each lane, lanes run only their own test file, the
supervisor runs the gates (`nice -n 19`) and merges. The order as run: Tasks 1 and 2 together, then 1b (after the
questioner's rulings), then 3, 4 and 6 together, then 5 (it needs Task 4's `refusal-speed.ts`), then 7. Every
extraction rewrites `manifest.json`, which is never edited by hand: a conflict there takes `perf-told`'s own
pre-merge manifest, the merge is committed first, then the extractor is re-run on the clean merged tree and the
manifest committed separately (the plan's "Supervisor rulings during execution": re-running before the merge commit
stamps `-dirty`). Plan 1 lands on `perf-told` as a PR into `main` with a merge commit.

### 1.7 Plan 2: core (design of 11 Nov 2026)

This section is plan 2's spec: the chains, the runway rules, the drag index builder and the inputs, in
`src/core/`. It takes over the "For plan 2" notes under 1.2 and decides them; where the two differ, this section
wins. Plan 3 (UI and state) renders what `computeTold` returns; plan 2 has no DOM and no page.

**Status: built** (merged on `perf-told` 12 Nov 2026, 450 tests, 100 % lines on `src/core/`). The text below is brought
in line with the build. The plan, with the questioner's rulings Q1 to Q4 and Extras 1 to 5 (which override its task
text) and the supervisor's rulings during execution, is `docs/wip/TOLD-STEP1-P2.md`.

**Rulings of 11 Nov 2026 (the human).**

1. **RCR, strict.** Refusal speed interpolates only as Part 2 writes it: dry between 23, 16, 8 and 4 (sheets 1 and
   3), wet between 18 and 12 (sheet 2). A wet RCR outside 12 to 18 (wet 10, 11, 19) and a dry RCR outside 4 to 23
   give `OutOfChart` on `rcr`; the wet refusal cell shows "—" with a reason line and a Limitations note. A wet runway
   never borrows the dry family's sheet 3. A wet RCR below 10 is also the 3.18 rule at the landing field.
2. **Conservative side data: option A.** A cell keeps the side data of the run that decided it (below, `ctx.ts`).
   The conservative landing distance is judged against the B7-2 limit lines on the same rounded run that produced
   it.
3. **Quantity names and units are aligned at the source.** Spec edits and a re-extraction, not a mapping in code:
   `pressure_altitude` (B7-2 sheet 1's `altitude`), `°C` (B2-1's `deg C`) and `KIAS` for every speed (B2-5 and B2-6
   `refusal_speed` in `kt`): every airspeed is KIAS, and wind stays `kt` (a wind speed, not an airspeed). B1-1
   sheet 1's drag index columns became `drag_index_f16c` and `drag_index_f16d` (the weight columns keep `f16c` and
   `f16d`, in lb). `dataVersion` goes to 8. A `data:check` test then requires one name to have one unit
   across every figure, so a later figure cannot drift.
4. **Edge tolerance on input-axis ends only.** `EDGE_TOLERANCE` (0.002 of the drawn span, R1) still clamps a value
   just past an end on the input axis (float noise from the previous read). A curve end on the frame's output edge
   gets no tolerance: past its last drawn point the reading is `OutOfChart`. B2-3 GW 36 to 48 past 12,000 ft is the
   named case (GW 36 also ends on the 12.0 edge, at TOF 6.636). This closes the step 0 note on the output-edge end.
   As built (Q2): an end is an input-axis end when it lies within the tolerance of the same end of its family's drawn
   input span (per family, replacing R1's "all families together"), or, in a guideline panel, of the panel's
   baseline. The baseline anchor keeps two lines their data draws to it: B2-3 `cg` line 11 (starts at 35.003) and
   B2-4 `gw` line 0 (ends at 42.9999). `interpWithin(points, x, tolerance, span, anchors)` in `read/interp.ts`.

**Chains: one per TOLD column.** Six chains, each evaluated on its own: takeoff MIL and MAX AB
(`takeoffChain(figures, values, 'mil' | 'ab')`), and landing for normal weight and heavyweight, each dry and wet
(`landingChain(figures, values, 'dry' | 'wet')`). Each chain takes plain numbers (`TakeoffValues`, `LandingValues`),
not `DerivedInputs`; for landing the caller picks the weight and the RCR. Normal landing reads landing GW,
heavyweight takeoff GW.

- **A chain calls each figure at most once.** If it would call one twice, it is split. This replaces the planned
  `withPrefix` wrapper, which is not built; `ctx` keeps throwing on a repeated id, which enforces the rule. The ids
  stay the figures' own (`b2-3.gw`) plus `input.*`.
- **Takeoff:** B2-1 (factor), B2-2 (rotation and takeoff speed), B2-3 (distance), B2-4 (acceleration check at
  2,000 ft, or 1,000 ft when this chain's takeoff distance is under 2,500 ft: a branch the conservative pass
  re-tests), refusal speed dry and wet (`told/rcr.ts`; MIL on B2-5, MAX AB on B2-6). Outputs (`TakeoffKey`):
  `rotation`, `takeoffSpeed`, `distance`, `accelCheck`, `refusalDry`, `refusalWet`. The check distance is side data
  (`checkDistanceFt`, null when the takeoff distance is out of chart), per cell: the exact and the conservative cell
  can use 1,000 and 2,000 ft.
- **Landing:** B7-1 (final approach and touchdown), B7-2 sheet 1 (uncorrected roll and `limits`), B7-2 sheet 2
  (corrected roll; `wet` picks the family, the column's RCR). Outputs: `finalApproach`, `touchdown`, `distance`.
  `limits` is side data. The speeds are the same dry and wet; each chain computes them anyway.
- **Refusal speed by RCR (`told/rcr.ts`):** linear in RCR between the two printed RCRs that bracket the column's
  RCR (dry input for the dry row, wet input for the wet row). Dry 16 to 23 reads sheet 1 only, dry 8 to 16 sheet 1's
  RCR 16 and sheet 3's snow RCR 8, dry 4 to 8 sheet 3; wet 12 to 18 sheet 2. An RCR on a printed value reads that
  value. Ruling 1 for the rest. The duplicated `decreased()` of `b2-5.ts` and `b2-6.ts` moves into one place (as
  built, `figures/refusal-speed.ts`, beside the reader both sheets share).
- 8° pitch is not an input in step 1; every chain passes `pitch8: false`.

**`ctx.ts`.**

- **Side data.** A chain returns `{ outputs, side }`; `side` is any per-run record (landing `limits`, takeoff check
  distance). Each `Cell` gains `exactSide` and `conservativeSide`, the side record of the run that decided it: the
  exact pass, and the run `cellOf` picks (the worst run, or the first that errored). So a conservative check
  distance or a conservative limit verdict can differ from the exact one, and the UI shows each with its own cell.
- **Two-valued inputs.** `ctx.input(id, { exact, conservative }, step)` returns `exact` in the exact pass and starts
  from `conservative` in every conservative run, rounded like any other point. It is how the drag index enters
  (5.2): no tip missile is −4 per missile exact and 0 conservative. `ctx.read` stays as it is for every other point;
  an `input` id counts as a rounding point like a `read` id and is pinned with them.
- **Baseline run.** The conservative cell starts from one run on the conservative values with nothing rounded,
  instead of falling back to the exact pass when no point is off its step. With single-valued inputs the baseline
  equals the exact pass.
- **An exact error rejects the whole cell only when the baseline errors too** (Q1, `cellOf`). When the baseline is
  in chart, the exact cell is the exact `OutOfChart` and the conservative cell is searched as usual. The one case
  today: removed tip missiles can make the exact drag index negative (clean, 4 − 8 = −4; out of chart on B2-3 and
  B2-4 `di`) while the conservative one is never below 0, so `distance` and `accelCheck` show "—" exact with a
  computed conservative value. A negative drag index is never read at 0 in the exact cell. This is the exception to
  5.2's whole-cell rejection.

**Inputs (`inputs/`).**

- `inputs.ts`: the `Inputs` type (every field as typed, the additional drag index among them) and the defaults (CG
  35 % MAC, RCR dry 23, RCR wet 18). The loadout is not in `Inputs`; it is passed beside them.
- `parse.ts`: each field to a number or "does not parse" (`parseNumber`, `parseWind`). Only syntax and physical
  limits: wind `ddd/ss` with optional `Gss`, direction 1 to 360 (calm is `000/00` or `360/00`; 000 only as calm), gust not below the steady
  wind. The other physical limits (length above 0, heading 1 to 360, altimeter above 0) are applied in
  `deriveInputs`. Every other range is the charts'. Each chain declares the fields it needs; a field that does not
  parse marks that chain's cells as unparsed (plan 3: "—" and the dotted underline), and the other chains still
  compute.
- **CG range.** B2-2's CG correction has no drawn range of its own, so a CG outside B2-3's drawn CG range (30 to
  40 % MAC) is `OutOfChart` on B2-2 `cg` with that range. The other CG readers check their own.
- `derive.ts` (5.3): pressure altitude from the near-end threshold elevation (where the roll starts) and the
  altimeter, inHg in one function; slope = (far − near) / length × 100, uphill positive; headwind from the steady
  wind, crosswind from the gust, both against the magnetic runway heading. Crosswind is shown only (B2-11 is
  deferred).
- Rounding points: `input.pa`, `input.temp`, `input.gw`, `input.cg`, `input.di` (two-valued), `input.wind`
  (headwind), `input.slope`; the RCR is `input.rcr_dry` and `input.rcr_wet` on takeoff (both refusal rows), `input.rcr`
  on landing. Landing reads no `input.cg` or `input.di`. Runway length is not rounded.

**Rules (`told/rules.ts`).** One entry per rule in `RULES`, `{ id, paragraph }`; `takeoffMarks` and `landingMarks`
check the exact and the conservative cell separately; "over" is strictly greater. Runway used % = distance / length
× 100, from each cell, not a rounding point. A `RuleMark` sits on the distance cell and carries the percent it cites
(or the limit line); the 3.18 RCR rule also gives `Told.rcrMarks`, one per RCR input below 10.

| Rule | Check | Marks |
| --- | --- | --- |
| 3.6.6 | MIL takeoff distance over 50 % of the runway (afterburner required) | MIL distance and runway used |
| 3.6.3 | Any takeoff distance over 80 % | That column's distance and runway used |
| 3.18 | Landing distance over 80 % | That landing column's distance and runway used |
| 3.18 | RCR below 10 at the landing field (the RCR the column uses) | The RCR input |
| Fig. B7-2 sh. 1 | A limit line's verdict `true` in the cell's side data (brake energy, MLG tire 225 kt, NLG tire 217 kt, no wind) | That landing distance |

`null` (not judged, P7) marks nothing and never reads as within the limit. A rejected cell carries its `OutOfChart`
tagged `exact` or `conservative`; `computeTold` keeps one per distinct reason per table, and plan 3 formats the
sentence from the panel's quantity name and unit (ruling 3).

**`told/told.ts`.** `computeTold(figures, inputs, loadout)` (the loadout passed beside the inputs) parses and derives the inputs, builds the drag index,
runs the six evaluations and the rules, and returns a `Told`: the drag index, per column (`told/column.ts`) its cells
(with side data and rule marks), reasons and the exact trace (for plan 3's figure view), and `rcrMarks`. Figure data
is passed in as a `FigureSet` keyed by figure id (`data/figure-set.ts`); `src/web/` stays the only code that fetches.
A takeoff column also needs the additional drag index (`parseNumber`, any sign; Extra 3) and a loadout the builder
computes: an invalid loadout or an additional drag index that does not parse makes both takeoff columns unparsed,
on `'loadout'` or `'additionalDragIndex'`; landing is unaffected.

**Drag index builder (`dragindex/`)**, on B1-1 and the decisions of 29 Oct 2026.

- `catalogue.ts`: sheets 2 to 7 to stores and suspension items. Station strings to sets (`2,3,7, OR 8`); a drag
  index cell is a number, `a/b` (subsonic `a`, II.3) or a footnote marker (`4*`, `2**`); an unknown format throws (a
  data defect), and a test parses every row. Queries for plan 3's menus: stores allowed on a station group,
  suspensions that carry a store.
- `racks.ts`: which sheet 2 items carry which B1-1 rack string, and each item's capacity (three on a TER or LAU-88,
  one otherwise, II.4). An explicit table, not the mockup's regular expressions. Fig. B1-1 prints neither, so both are
  the project's own (Limitations II.4). A test checks both ways: every rack string in B1-1 has an entry, and every
  item the table names is a sheet 2 row; a new store with a new rack fails loudly.
- `loadout.ts`: a loadout (one row per station pair or split station: store, suspension, count; plus the additional
  drag index) to `{ exact, conservative }`. Basic aircraft; tip AIM-9 0 (note *), tip pod 2 less than the missile
  (note **), no tip missile −4 exact and 0 conservative; tank variant from the store at 3/7 (none, AIM-9s, single
  or multiple; a TER or LAU-88 there is multiple; the centreline tank from 4 and 6); the suspension defaults to the
  smallest that carries the count (a tie: the highest drag index, then sheet 2 order), and the count is capped by capacity. Golden test: the Part 1 worked example gives 146.
- As built: `dragIndex(cat, loadout, additional)` returns `{ ok: true, exact, conservative, lines }` or
  `{ ok: false, problems }` from `checkLoadout` (`check.ts`); it never throws for a loadout, which is user input that
  plan 3 restores from the URL and localStorage (a throw is a data defect). The tip rules are in `tip.ts` (Extra 1:
  keyed on a sheet 3 row at stations 1 or 9, not on the `*` alone), the tank variants in `tank.ts`, the `Loadout`
  type and `DEFAULT_LOADOUT` in `loadout-row.ts`.

**Module layout.** One job per file, each well under 300 lines. Dependencies run one way: `inputs/` and
`dragindex/` to `told/` to `figures/` to `read/`.

```
src/core/
  ctx.ts            side data, ctx.input, baseline run
  read/             edge tolerance on input-axis ends only
  data/             figure-set.ts (the FigureSet type and its lookup)
  inputs/           inputs.ts, parse.ts, derive.ts
  told/             takeoff.ts, landing.ts, rcr.ts, rules.ts, column.ts, told.ts
  dragindex/        catalogue.ts, racks.ts, tank.ts, tip.ts, check.ts, loadout-row.ts, loadout.ts
```

**Validation.** The coverage stays at 100 % lines on `src/core/` (floor 90 %).

1. `ctx`: synthetic chains with side data, where a branch flip in a conservative run changes `conservativeSide` and
   not `exactSide`; `ctx.input`'s two values; the baseline run.
2. `read/`: per reader, past an output-edge end is `OutOfChart`, within the tolerance of an input-axis end is on the
   curve; B2-3 GW 36 to 48 past 12,000 ft.
3. Data: the one-name-one-unit test; a full re-extraction changes only the renamed names and units (compared
   against the old files with those fields ignored); every sample and checkpoint still passes.
4. Inputs: parse tables (bad wind strings, a gust below the steady wind); pressure altitude against hand-worked
   values; the parity test pinning `ISA_P0` and `ISA_INV` against `crc-sync/src/altimetry.js`; wind components at
   0°, 90° and 180°.
5. RCR: each printed RCR gives the sheet's value; between them interpolates; dry 12 reads sheet 1's RCR 16 and sheet
   3's RCR 8; wet 11, wet 19 and dry 24 are `OutOfChart` on `rcr`.
6. Chains: rounding point ids pinned per chain; the manual's samples through a chain where their inputs fit one;
   the acceleration check branch (a roll near 2,500 ft whose exact side reads 1,000 ft and conservative side
   2,000 ft); landing against the exhaustive oracle; takeoff by the 5.2 criterion (no better than exact, within the
   sum of each point's one-step effect of the exhaustive value).
7. Rules: exactly 50.0 % and 80.0 % are not red, just over is; exact and conservative marked independently; a
   `null` verdict marks nothing.
8. Drag index: the golden 146; each tip rule and tank variant; the racks table both ways; every B1-1 row parses.
9. Deferred minors folded in: `decreased()` in one place (Task 5), a B7-2 sheet 2 entry outside its wind or slope
   lines (Task 6), B2-4's out-of-chart loop adding 0 ft (Task 5).

**Process.** As plan 1 ran: one lane worktree per task (`../sourcedcs-told-p2-t<N>` on `lane/told-p2-t<N>` off
`perf-told`), at most 4 agents at once including a questioner, all on Opus, a task review after each lane, lanes run
only their own test files, the supervisor runs the gates (`nice -n 19`) and merges. Task 1 re-extracts on this
machine (`PERF_PDF`, `nix develop`); the manifest conflict procedure of 1.6 applies.

| Task | Content | After |
| --- | --- | --- |
| 1 | Data alignment (ruling 3): spec edits, re-extraction, the quantity test | — |
| 2 | `ctx.ts` side data, `ctx.input`, baseline run; `read/` edge tolerance (ruling 4) | — |
| 3 | `inputs/`, with the pressure altitude parity test | — |
| 4 | `dragindex/` | questioner |
| 5 | `told/rcr.ts`, `told/takeoff.ts` | 1, 2, 3 |
| 6 | `told/landing.ts` | 1, 2, 3 |
| 7 | `told/rules.ts`, `told/told.ts` | 4, 5, 6 |
| 8 | Close-out: full re-extraction, all gates, 1.1 and 1.5, `perf/README.md`, handoff | 7 |

Wave 1: Tasks 1, 2 and 3 with the questioner, who rules on what this section leaves open before Task 4 starts. Wave
2: Tasks 4, 5 and 6. Then 7 and 8. The plan, with the questioner's rulings, is `docs/wip/TOLD-STEP1-P2.md`.

Notes carried from plan 2 (12 Nov 2026). For the Limitations page:

- **Refusal speed by RCR is strict** (ruling 1): wet only 12 to 18 (wet 10, 11 and 19 give "—" on the wet refusal
  row), dry only 4 to 23. A wet runway never reads the dry family's sheet 3. Landing's wet family runs 10 to 18.
- **Output-edge ends get no tolerance** (ruling 4): past a curve's last drawn point on the frame's output edge the
  reading is "—" (B2-3 GW 36 to 48 past 12,000 ft). One end keeps it: B7-2 sheet 2 wet RCR 18 at the top edge, about
  13.5 ft of uncorrected roll at 12,000 ft (Q2).
- **No tip missiles** (Q1): an exact drag index below 0 (a clean aircraft without its tip AIM-9s, 4 − 8 = −4) is
  out of chart on B2-3 and B2-4, so the exact takeoff distance and acceleration check show "—"; the conservative
  cells are computed at the conservative drag index (never below 0).
- **300-gallon tank with only one of 4 and 6 loaded** uses the "STORES AT 4 AND 6" value, 18 (Extra 2; printed
  nowhere, the safer value).
- **An odd count on the pair beside a wing tank** (3 stores on 3/7) gives the MULTIPLE variant on both tanks: the
  row does not say which side carries the extra store.
- **CATM-9 and the other training rounds count as single stores at 3/7**, not as AIM-9s (the higher tank value).
- **The acceleration check distance is per cell:** the exact and the conservative cell can use 1,000 and 2,000 ft,
  with a large speed jump between them (106 against 147 KIAS at 33,700 lb in a Task 5 test). Each cell shows its own.
- **PA below sea level** (supervisor ruling): B7-2 sheet 1 draws pressure altitude from 0 ft, so the exact landing
  distance shows "—" and the conservative one is read at 0 ft.
- **Calm wind `000/00` is accepted** (ruling): direction 000 parses only with speed 0 and no gust.
- **A default suspension tie takes the highest drag index**, then sheet 2 order (ruling): tip AIM-9s untouched sit on
  the LAU-129/A, DI 1, not the AIM-9 LAUNCHER (16S210), DI 0.
- **A multiple-carriage rack at 3/7 gives the MULTIPLE wing tank variant** (ruling): a TER or LAU-88 there counts as
  multiple even with one store per station.

For plan 3 (UI and state), from the deferred minors:

- The physical limits (length, heading, altimeter) live in `deriveInputs`, so the UI must not validate a field with
  `parseNumber` alone.
- `Told.dragIndex` leaves out an additional drag index that does not parse; do not show its total as the aircraft's
  then.
- `landing-rcr-10` is in `rcrMarks` and on the landing distance cells; show it once.
- A limit verdict `true` marks a landing distance cell even when that cell shows "—" (sheet 1 judged, sheet 2 out
  of chart).

### 1.8 Plan 3: UI and state (design of 12 Nov 2026)

This section is plan 3's spec: the three pages, the figure paths, the URL hash and localStorage, the smoke spec. It
renders what `computeTold` returns and adds one thing to the core, the path marks. The plan is
`docs/wip/TOLD-STEP1-P3.md`.

**Status:** built on branch `perf-told-p3` (13 Nov 2026): tasks 1 to 7 merged, the smoke spec green; awaiting the
human's review of the (S) rulings below, the plan's ledger rulings and the screenshots in
`/home/nklx/dev/perf-p3-review/`. Deployment is plan 4.

**How it was decided.** Part 1 (paths, module layout, order) was approved by the human on 12 Nov 2026, with two
rulings: the figure view draws **exact paths only**, and landing has **one figure view per weight**, dry solid and
wet dashed. Parts 2 and 3 (state, page behaviour, wording, testing, CI) were decided by the supervisor overnight at
the human's request ("answer all questions yourself in a separate branch"), on branch `perf-told-p3`; every one of
those decisions is marked **(S)** below for the morning review.

**Path geometry (part 1).**

- `Ctx` gains `mark(m: PathMark): void`. Every figure function calls it once per panel it reads, after the read,
  with the panel's entry and exit in chart units; ids and signatures are unchanged. `evaluate` ignores marks.
- `PathMark` (`src/core/path/mark.ts`) is a union on the panel type, every value in the panel's own chart units
  (the numbers its `axes` transforms take), with `figure` (the figure file id, `B2-5.sh1`) and `panel` (the panel
  id): `curve_family` `{ input, param, output }`; `single_curve` `{ input, output }`; `scale_pair` `{ from, to }`;
  `guideline_panel` `{ family, baseline, entry, target, exit }`. The figure page lays out each kind (geometry is not
  the core's job). A panel that returned `OutOfChart` is not marked: the path stops at the last panel it crossed,
  and the reason line says why. A skipped guideline panel (zero wind or slope) is not marked either.
- `tracePaths(chain)` (`src/core/path/trace.ts`) runs the exact pass once with a recording ctx and returns the
  marks in order with the chain's outputs. Exact only (ruling of 12 Nov).
- The figure page turns marks into polylines in page-image pixels with each axis transform (`page`, `a`, `b`) and
  the image's `clipPt` and `pxPerPt`. A guideline mark is drawn along the bracketing lines, sampled between
  baseline and target, the way `guidelinePanel` interpolates them.

**Module layout (part 1).** One job per file, each well under 300 lines. The block below is the part-1 design;
`perf/README.md` ("src/web/ layout") lists the files that exist.

```
src/core/path/      mark.ts (PathMark), trace.ts (tracePaths)
src/web/            load.ts (the only fetch: manifest, figures, page images)
                    format.ts (numbers, units, "—"), scale.ts (fit the 1280 px page to the window)
                    reasons.ts (OutOfChart → reason line), rule-lines.ts (RuleMark → rule line), version.ts
                    state/hash.ts (Inputs + Loadout ↔ hash), state/storage.ts, state/initial.ts (load order)
                    told/inputs-view.ts, told/dragindex-view.ts, told/store-menu.ts, told/tables.ts, told/main.ts
                    figure/geometry.ts (marks → page polylines), figure/letters.ts, figure/views.ts, figure/main.ts
                    limitations/main.ts
web/                index.html, figure.html, limitations.html, css/ (tokens, perf, print; told.css, figure.css)
scripts/serve.ts    local static server: /f16/ → web/, /f16/data/ → data/
e2e/                smoke.spec.ts, playwright.config.ts
```

Dependencies run one way: `src/web/` imports `src/core/`, never the reverse; only `load.ts` fetches; the pure web
modules (`format`, `reasons`, `rule-lines`, `state/*`, `figure/geometry`, `figure/views`) have no DOM and get node
unit tests; the views are covered by the smoke spec.

**State (S).**

- **Hash:** `#v=1&` then every Inputs field as typed, short keys: `tgw` takeoffGwLb, `lgw` landingGwLb, `cg`,
  `adi` additionalDragIndex, `rwy`, `hdg`, `len`, `ne` nearElevFt, `fe` farElevFt, `alt`, `t`, `w`, `rd`, `rw`;
  then `lo`, the loadout. Every key is written, empty ones too, so a cleared field stays cleared. Built and read
  with `URLSearchParams`.
- **Loadout encoding:** rows joined by `;`, each `stations:storeKey:suspension:count` with stations joined by `-`,
  each part through `encodeURIComponent`, a null store or suspension as an empty part (`3-7:<key>::2`). A
  `noTipMissile` row is an ordinary four-part row with the literal `noTipMissile` as its store part
  (`1-9:noTipMissile::2`), so it keeps its stations and count. Rows are kept in order, so a split pair round-trips.
  Every station no decoded row covers gets its default empty row from `DEFAULT_LOADOUT`, in the default order (a
  pair with one half covered gets the other half as a single row next to it), and `lo=` is the default loadout:
  the builder cannot add a station row back (final review I2).
- **Refusal:** a hash whose `v` is not `1` is refused with the grey note "This link is from another version of the
  calculator and was not loaded." under the title, and loading continues from storage. A hash with `v=1` but a row
  that does not decode (wrong part count, a count that is not an integer from 1 to 3 per station of the row (a pair on TERs carries 6), an unknown station) drops that
  row, with a grey note "Part of the loadout in this link could not be read."; an unknown store key is kept and
  shows as a loadout problem in the builder (`checkLoadout`), so a link from an older data version says what is
  wrong instead of silently changing the loadout.
- **Storage:** the same string, without `#`, under `perf.f16.v1` in localStorage. Every change rewrites both, the
  hash with `history.replaceState` (typing does not fill the history). Storage that throws (private mode) is
  ignored.
- **Load order:** hash, then storage, then `DEFAULT_INPUTS` and `DEFAULT_LOADOUT`. A `hashchange` (a pasted link)
  reloads the state.

**The TOLD page (S).**

- Every `input` event recomputes everything (`computeTold` takes milliseconds; no debounce).
- **Fields with a default** (CG 35, additional drag index 0, RCR 23 / 18) show it as the placeholder; an empty field
  means the default. Every other empty field shows its placeholder (none), no underline, and its dependent cells
  show "—" with no reason line: empty is not an error. Instead one grey line under each table names the empty
  fields its columns wait for, in page order: "Fill in to compute: far-end elevation, temperature" (`told/
  missing-line.ts`; added 12 Nov 2026 after the human's first try left only the far-end elevation empty and got
  a page of "—" with no hint why). A filled field that does not parse is not named; it is underlined.
- **RCR** is one field, "dry / wet", as in the mockup: split at `/`, each part trimmed; an empty part takes its
  default. It writes `rcrDry` and `rcrWet` (two hash keys).
- **Wind** is typed "230 / 08 G15" (mockup); the page normalises it to the core's `230/08G15` (spaces removed) before
  parsing, and stores it as typed.
- **Thousands separators** in a typed number are accepted ("37,240" means 37240): the page strips `,` before
  `parseNumber`. Stored as typed.
- **A filled field that does not parse**, or fails a physical limit in `deriveInputs`, gets the grey dotted
  underline. The page decides this from `deriveInputs`' result for the field (never `parseNumber` alone).
- **The derived line** under section II: pressure altitude, slope, headwind or tailwind, crosswind, and the gust,
  as in the mockup; a value that does not compute is left out.
- **Cells:** exact regular, conservative bold. Speeds exact with one decimal, conservative whole; distances whole
  with thousands separators; runway used % with one decimal, from the cell's distance and the runway length. A
  cell that does not compute shows "—". A rule mark makes that cell red (exact and conservative on their own) and
  boxes it in print.
- **Rule lines:** one grey line per distinct (rule, column) under its table, texts in `rule-lines.ts`:
  - `mil-roll-50`: "MIL roll 97.5 % of runway: over 50 %, afterburner takeoff required (para. 3.6.6)"
  - `takeoff-roll-80`: "MAX AB roll 84.2 % of runway: over 80 % (para. 3.6.3)"
  - `landing-roll-80`: "Landing roll, heavyweight wet, 83.0 % of runway: over 80 % (para. 3.18)"
  - `landing-rcr-10`: "RCR 8 at the landing field: below 10 (para. 3.18)", shown once, and the RCR input red.
  - `b7-2-limit`: "Landing, heavyweight dry: beyond the maximum brake energy limit (Fig. B7-2 sh. 1)", with the
    line's label from the data.
  A conservative-only mark says "conservative" after the column name. The percentage is the exact one when the
  exact cell is marked, else the conservative one.
- **Reason lines:** one per distinct reason per table (`Reason` from the column), the figure name a link to its
  view:
  - "B2-3: gross weight 52,000 lb outside the drawn range 20,000–48,000 lb"
  - "B2-6 sh. 2: conservative gross weight 37,300 lb outside the drawn range 20,000–37,250 lb"
  - "B7-2 sh. 1: temperature 50 °C outside the drawn chart" (`drawnRange` null)
  - "B2-6 sh. 3: tailwind 20 kt outside the drawn range 0–18.75 kt": wind and slope get their side back from the
    inputs (headwind/tailwind, uphill/downhill), since the core gives magnitudes.
  Names come from the panel quantity's `name` with `_` as a space; values in 1000 lb or 1000 ft are shown in lb or
  ft; a quantity the table does not know is shown with its own name and unit. An unparsed cell gives no reason
  line (its field is underlined). Units: `°C`, `KIAS`, `kt`, `%`, `ft`, `lb`.
- **Acceleration check label** from the exact cells' `checkDistanceFt`: "at 2,000 ft", or "at 2,000 / 1,000 ft" when
  MIL and MAX AB differ. A conservative cell checked at the other distance adds a grey line under the table: "MAX
  AB conservative: checked at 2,000 ft".
- **The drag index builder** follows the 29 Oct decisions and the approved mockup (menu of allowed stores grouped by
  heading, filtered by typing, arrow keys and Enter; suspension list; count limited by capacity; split and join).
  A row with a loadout problem gets the dotted underline on its store and a grey line naming the problem. The total
  shows "—" while the additional drag index does not parse; with no tip missiles it shows both values ("142 / 150").
- **"Fig." links** go to `figure.html#<state>&fig=<figure>&view=<view>`, `fig` the figure without its sheet
  (`B2-5`), `view` one of `takeoff` (MIL and MAX AB together), `normal`, `heavy`.

**The figure page (S).** One view per figure and takeoff or landing weight: the page image (greyscale PNG) with the
exact paths drawn over it in SVG, MIL solid 1.8, MAX AB dashed 1.6 (5 3); landing dry solid, wet dashed. Circled
letters Ⓐ to Ⓖ mark each panel's entry in chain order, with a key listing each letter's quantity and value. A figure
with several sheets in a chain (B7-2 sh. 1 above sh. 2; refusal B2-5 sh. 1 above sh. 3 for a dry RCR between 8 and
16) stacks them in chain order. An input from another figure (Ⓐ takeoff factor from B2-1) links to that figure's
view. A path that stopped shows the reason line under the image. A drawn column that did not compute because of
its inputs gets one grey line under the first sheet, "No path: <the TOLD page's field names> not entered or not
readable.", or for a loadout problem "No path: the loadout has a problem (see the drag index builder)." A refused
link (another `v`) shows its note and the back link only, no view. The figure page has the same title block, a link
back to the TOLD page with the same state, and prints on one page. The old board (`perf-figure.html`, deleted) is
replaced by the real page `perf/web/figure.html`, which the human approves from screenshots (light and dark) in place
of a separate board.

**The Limitations page (S).** Static HTML: the notes listed under "Notes carried" in 1.2 (step 0, plan 1, plan 2),
the 29 Oct list (per-point rounding, the conservative step leaving the chart, B2-3 under 1,000 ft, hot-day pressure
altitude, RCR below 10, II.3 to II.5), in plain sentences for a pilot, numbered I, II, III by topic. Data version
from the manifest and app version from `version.ts` (a test keeps it equal to `package.json`, which goes to 0.1.0).

**Print (S).** `print.css`: one A4 or Letter page, black on white, inputs as plain values, no controls, empty
stations hidden, problem values boxed; the footer carries data version, app version and the date.

**Testing and CI (S).**

- Node unit tests for `path/` (marks per figure match the trace; tracePaths on each chain), `state/hash.ts` (round
  trip of every field and a loadout with a split pair; `v=2` refused; bad rows dropped; unknown store kept),
  `format.ts`, `reasons.ts` and `rule-lines.ts` (every rule and the four reason forms), `figure/geometry.ts`
  (a mark through a known transform lands on the right pixel), `version.ts` against `package.json`.
- One Playwright spec, `e2e/smoke.spec.ts`, against `scripts/serve.ts`: load, enter the B2-3 sample problem, check
  a cell, a bad field's underline, reload keeps the state, a `v=2` link's note, open a figure, print to PDF on A4
  and Letter and assert one page each, light and dark load. Chromium only, one worker. `npm run e2e`.
- CI: the test job gains `npx playwright install --with-deps chromium` and `npm run e2e`. The image build and the
  deploy stay plan 4.
- The coverage floor stays on `src/core/` (90 % lines); `src/core/path/` is held at 100 % like the rest.

**Process (S).** Lanes in `../sourcedcs-told-p3-t<N>` worktrees off `perf-told-p3`, all on Opus, at most 4 agents at
once, a task review per lane, lanes run only their own test files, the supervisor runs the gates (`nice -n 19`) and
merges. The supervisor answers the questions a questioner would (the human asked for it); each ruling is written
into the plan's ledger section.

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

The look is a printed tech-order page: black on white, white on black in dark mode, Times New Roman, red only for a problem with a cited rule. The approved mockup is the reference: `docs/mockups/perf-told.html` and `perf-limitations.html`; the figure view's reference is the real page `perf/web/figure.html` (its board `perf-figure.html` was deleted in plan 3, 1.8).

### 10.1 Fixed from step 1

- **Colours:** ink, paper, one grey for secondary text and rules, red for problems. Nothing else, ever.
- **Type:** Times New Roman, one type scale, tabular figures.
- **Components:** section heading (small caps, Roman numeral), underlined input field, data table with exact/cons. column pairs, italic subheading row, red problem marking, figure view (MIL solid, MAX AB dashed, circled letters Ⓐ to Ⓖ), link to a subpage. Step 1 adds (approved board, 29 Oct 2026): the figure column, the drag index builder's pickers and store menu, the refused-link note under the title, and the boxed problem value in print.
- **Bold and underlined means typed.** A value the pilot picks (store, suspension, count) is plain text, underlined only on hover or focus.
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

## Decisions of 29 Oct 2026 (step 1 mockup)

The step 1 board (`docs/mockups/perf-told.html`, `perf-limitations.html`) was approved by the human. The boards link
`perf/web/css/` directly; the CSS in the TOLD board's own `<style>` block, marked "proposed", moves into `perf.css` and
`print.css` in step 1. The board's script is a stand-in for the drag index builder, not its implementation.

- **Figure references:** a grey "Fig." column names each row's figure and links to the figure view, which draws the
  row's paths. The numbers themselves are not links (one link per row; a number link added nothing). The refusal rows
  link B2-5 (MIL) and B2-6 (MAX AB) separately.
- **Rule lines:** a red value gets one grey line under its table citing the rule, for example "MIL roll 97.5 % of
  runway: over 50 %, afterburner takeoff required (para. 3.6.6)", next to the reason lines for rejected cells.
- **Print:** a problem value is also boxed (1 px ink outline), so it survives a mono printer. Empty stations, pickers'
  underlines, focus rings and the split/join links do not print; the picked stores print as their values.
- **Acceleration check:** when the MIL and AB rolls fall on both sides of 2,500 ft, the row label names both distances
  ("at 2,000 / 1,000 ft").
- **RCR below 10 at the landing field** (para. 3.18) marks the RCR input itself red, with a rule line.
- **Wind** is entered with its gust as "230 / 08 G15"; the derived line shows the gust.
- **Drag index builder** (ADR 0150), on the B1-1 data:
  - One row per station pair (1/9, 2/8, 3/7, 4/6), then 5, 5L, 5R, as in the manual's worked example (p. B1-2/B1-3).
  - The store line opens a menu of only the B1-1 stores allowed on that station, grouped under the manual's headings,
    each with its rack and its drag index as printed, filtered by typing, chosen with the arrow keys and Enter.
    Store names are shown as printed (capitals); the display drops the line-break hyphen ("LAUNCHER- WITH").
  - A suspension line lists only the sheet 2 items that fit the store's rack. Untouched, it is the smallest one that
    carries the count.
  - The count is limited by the suspension's capacity: three per station on a TER or LAU-88, one otherwise. Fig. B1-1
    gives no capacities; the limit is the project's own (Limitations II.4).
  - A tank's variant is picked from the store inboard of it (4 from 3, 6 from 7; the centreline tank from 4 and 6).
  - Asymmetric loads: a grey "split" beside a loaded pair's station label splits it into two single-station rows;
    "join" on the first of them joins it again.
  - Where B1-1 gives two values (subsonic/supersonic, confirmed by the column heading on sheet 1), the subsonic one is
    used (Limitations II.3).
  - A tip AIM-9 adds 0 (it is in the basic aircraft, note *); a tip pod is 2 less than the missile (note **); no tip
    missile is −4 each exact and 0 conservative (section 5.2), and the total then shows both values.
  - Golden test: the manual's worked example gives 146 on the board.
- **Limitations page:** dark mode, per-point rounding wording (ADR 0149), the conservative step leaving the chart, the
  B2-3 under-1,000 ft cases (R11), the hot-day pressure altitude note, RCR below 10, data and app versions, and the
  drag index notes II.3 to II.5.
- **Still to update:** the figure board (`perf-figure.html`) is on inline styles and shows only the exact MIL key. (Superseded: plan 3 deleted the board; the real page `perf/web/figure.html` replaces it, 1.8.)

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
