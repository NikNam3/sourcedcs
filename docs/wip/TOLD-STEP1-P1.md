# TOLD Step 1, Plan 1: Data and Figure Functions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Figures B2-4, B2-5 and B2-6 (sheets 1 to 3), B7-1 and B7-2 (sheets 1 and 2) extracted into checked data, each with a figure function in `src/core/figures/` that reproduces the manual's samples and the hand-read checkpoints.

**Architecture:** As step 0: hand-written spec YAML → `perf/extraction/` (Python, run on this machine) → `perf/data/f16c-f110-129/` → `src/core/figures/` (pure TS, every rounding point through `ctx.read`). Two additions: an **unscaled axis** for the line a pilot carries from one panel into the next (B2-5, B2-6, B7-2 sheet 1), and a **`limit_line`** panel type for B7-2 sheet 1's three limit lines.

**Tech Stack:** unchanged from step 0 (TypeScript via tsc, `node --test` on `.ts`, Ajv, json-schema-to-typescript, `yaml`; Python 3 with PyMuPDF, PyYAML, Pillow from `flake.nix`).

**Spec:** `docs/wip/TOLD.md` section **1.6** (this plan's spec), with 0.6 (samples), 1.1, 1.2 item 3 (the limit-line rule) and 5.2. The step 0 plan `docs/wip/TOLD-STEP0.md` holds the data contract, the chart spec format and rulings R1 to R14, all still in force.

## Global Constraints

- Every constraint of `TOLD-STEP0.md` "Global Constraints" holds (worktree and branch, `nice -n 19`, Node ≥ 22.18, the tsconfig and ESLint rules, `src/core/` purity, units in names, `OutOfChart` instead of extrapolation or throwing, `python3 -I` inside `nix develop`, `perf/data/` written only by the extractor, the commit trailer).
- `PERF_PDF=/home/nklx/dev/other/HAF-F16-Supplement.pdf`. The extractor refuses any other SHA-256.
- Lane worktrees: `../sourcedcs-told-p1-t<N>` on `lane/told-p1-t<N>` off `perf-told`.
- An extraction lane runs `cd perf && nix develop .. -c python3 -I extraction/extract.py "$PERF_PDF" <its ids>`; the close-out runs it with no ids.
- A conflict in `perf/data/f16c-f110-129/manifest.json` is resolved by re-running the extractor on the merged tree, never by hand. Commit order: extractor change, re-run, data.
- `perf/extraction/checkpoints/*.yaml` are written by Task 2 only. No other lane edits them, whatever a test says.
- Speeds are KIAS and in `STEPS.speedKt` (1 kt); distances in ft and `STEPS.distanceFt` (10 ft).
- Slope and wind are signed at the function boundary (`slopePct > 0` uphill, `headwindKt > 0` headwind); panels hold magnitudes and the sign picks the family (R8).

## Review Focus

1. **Tailwind and downhill on the refusal charts:** a 10 kt tailwind or 1 % downhill must read the tailwind or downhill family and *lower* the refusal speed versus calm, level. Pinned in Task 4.
2. **Icy sheets where GW curves converge:** at RCR 4 the heavy and light GW curves nearly meet (the manual: refusal speed can even rise with GW). The extractor must not assert a GW order there, and GW 18,000 and 48,000 lb must both read. Pinned in Task 4.
3. **A carried position the next panel does not draw:** a takeoff factor and GW whose carried line misses the runway-length curves must give an `OutOfChart` that names a pilot input (`gross_weight`), never the unscaled axis. Pinned in Task 4 (and B7-2's `temperature` in Task 6).
4. **A point exactly on a limit line** is not beyond it; a point outside the line's drawn input range is not judged (`null`). Pinned in Task 1.
5. **A check distance between two printed distance curves** on B2-4 (1,750 ft between 1,500 and 2,000) interpolates; 500 ft below the first curve is `OutOfChart` on `distance`. Pinned in Task 3.

## Execution notes for the supervisor

- Waves (at most 4 agents at once: implementers plus the questioner; every subagent on Opus 5.5): **A** Tasks 1, 2 · **A2** Task 1b (after the questioner's rulings) · **B** Tasks 3, 4, 6 · **C** Task 5 · **D** Task 7. Task 5 needs Task 4's `refusal-speed.ts`; Tasks 3 to 6 need Task 1; Tasks 4 and 5 need Task 2's checkpoints merged.
- `tests/helpers/sample-runners.ts`, `tests/helpers/checkpoints.ts`'s runner map and the pinned id list in `tests/sample-problems.test.ts` take an entry from every figure task: append-only conflicts, resolved by the supervisor keeping both sides.
- Task 2's reader must not see `perf/data/`, `perf/extraction/out/`, any spec under `perf/extraction/specs/` for B2-5 or B2-6, or PyMuPDF's vector data. Brief it with the page indexes and this plan's checkpoint contract only.

## Questioner rulings (2026-10-29)

The questioner read every plan 1 page (evidence: `docs/wip/TOLD-STEP1-P1-EVIDENCE.md`, copied there from the
session's scratch at close-out). The supervisor took every recommended default. They override the
task text where they differ.

- **P1 curve joining (Q1; Task 1b).** `curve_family` gains optional `filter` keys, opt-in so step 0 data stays
  byte-identical: `join: true` builds the panel's lines with the guideline code's monotone pieces and dash joining
  along the input (`min_span_pt` applied after joining), `max_gap_pt` (default 9.0), and `min_chain_pt` /
  `max_chain_pt` (keep only chains at least / at most this long before joining, to split a solid from a dashed
  family). Specs: the knocked-out GW panels of B2-5 sh1, sh2, sh3 snow and B2-6 sh1 `filter: {join: true}`; B7-2 sh1
  `gw` `{join: true, max_gap_pt: 3, min_span_pt: 30}`; B7-2 sh2 `rcr_dry` `{join: true, min_chain_pt: 30}`, `rcr_wet`
  `{join: true, max_chain_pt: 14, min_span_pt: 30}`.
- **P2 B7-2 sheet 2 is two RCR families (Q2; Task 6; contract change).** Panels `rcr_dry` (RCR 4, 8, 16, 23) and
  `rcr_wet` (10, 12, 18), as Part 7 interpolates them. `groundRollCorrected(ctx, fig, i: {uncorrectedFt, rcr, wet:
  boolean, headwindKt, slopePct})`; runner input flag `wet` (like `pitch_8deg`); an RCR outside the chosen family's
  drawn range is `OutOfChart` on `rcr`; the rounding id stays `b7-2.sh2.rcr`. Plan 2's inputs carry `wet`.
- **P3 `single_curve` anchor (Q3; Task 1b).** Optional `anchor: [x, y]`: the chain within the label tolerance of the
  anchor, unique, is the curve; others in the clip are ignored, and an optional `count_in_clip` asserts how many there
  are. B7-1 uses it for `final_approach` and `touchdown`.
- **P4 guideline robustness (Q4; Task 1b).** (i) `to_points` drops a point whose step along the input is exactly 0 and
  whose other-axis step is under 0.5 pt; (ii) `check_monotonic` accepts a wrong-way step up to `MONO_TOL_PT = 0.5`
  page pt, converted per panel (the family is still chosen by the end-to-end rise); (iii) optional `filter.max_gap_pt`
  (default 9.0) on `guideline_panel`: B2-4 `gw` 12, B2-5 sh2 `wind` 6.
- **P5 one curve, two values (Q5; Task 1b, Task 4).** Optional `param.shared: [[18, 20]]`: one anchor labels both
  values, the curve is written once per value, and `order` skips declared pairs (B2-5 sh3 icy).
- **P6 label tolerance per panel (Q6; Task 1b, Task 4).** Optional `label_tol_pt` (default 3); 1.0 on the GW panels of
  B2-5 sh2 and sh3 snow, anchors read off a 6x render at the leader arrow tips.
- **P7 limit-line tests (Q7; Task 6).** The rule stands (outside a line's drawn input range nothing is judged). Tests:
  the sheet 1 sample gives `{brakeEnergy: false, mlgTire: null, nlgTire: null}`; 8,000 ft / 40 °C / 46,000 lb is beyond
  all three; 6,000 ft / 40 °C / 44,000 lb is beyond the brake energy line only; 8,000 ft / 50 °C / 46,000 lb is the
  carried-line `OutOfChart` naming `temperature`. Task 7 rewords TOLD.md 1.6 Validation 4 to match.
- **P8 second B7-2 sh2 sample (Q8; Task 6).** `{uncorrected_ft: 3902, rcr: 4, wet: false, headwind_kt: 10,
  slope_pct: 1} → {ground_roll_ft: 8000}` (p388), plus its TOLD.md 0.6 row.
- **P9 B2-4 DI panel starts at 60 kt (Q9; Task 3).** Strict, as R11: a check speed under 60 KIAS with DI > 0 is
  `OutOfChart`; Limitations note "acceleration check speeds under 60 KIAS with a drag index are not computed".
- **P10 order checks where GW curves cross (Q10; Tasks 4, 5).** B2-5 sh3 icy `{output: falls, check_at: [2.5, 3.5]}`;
  B2-6 sh3 snow `{falls, [1.5, 2.5, 3.0]}`; B2-6 sh3 icy `{rises, [1.5, 2.5, 3.5]}`; B2-6 sh1 `check_at` from 1.5;
  B2-5 sh3 snow at TOF 5 or below. Each spec comments its crossing TOF; the figure tests pin one point above a crossing
  where 48,000 lb reads higher than 18,000 lb.
- **P11 drawn takeoff factor ranges (Q11; Tasks 3 to 5).** Strict `OutOfChart` outside B2-5's TOF [2.11, 6.79],
  B2-6's [1.20, 3.87] and B2-4's [1.09, 6.0]; one test and one Limitations note each.
- **P12 corrections wording (Q12; Tasks 4, 5).** `"RCR 16 (dry): refusal speed -4 KIAS, all GW"`, `"RCR 12 (wet):
  refusal speed -9 KIAS, all GW"` (B2-6: -5, -10); the printed note in `must_contain`; sheet 3 `corrections: []`.
- **P13 B7-1 engine (Q13; Task 6).** `engine: F110-GE-129` with a comment; no engine in `must_contain`.
- **P14 erratum (Q14; Task 4).** B2-5 sheet 3's note names "FIGURE B2-10" for the maximum brake application speed;
  correct "FIGURE B2-12"; `affects: null`, committed with the B2-5 specs.
- **P15 entry outside the wind or slope lines (Q15; Tasks 4, 5).** Named `refusal_speed`, as R11's `distance`.
- **P16 page facts (Q16; Task 6)** as in the evidence: B7-2 sh1 `gw` clip to y ≈ 386, `temp` `min_span_pt` 100,
  limit lines `max_dash_pt` ≈ 14 and `min_span_pt` 40; B7-2 sh2 `check_at` dry [2, 4], wet [2, 4, 5], anchors for
  23 and 16 below 9.0.

## Supervisor rulings during execution (2026-10-29 and 30)

Taken while the lanes ran, recorded in the session ledger and copied here at close-out (Task 7).

- **Task 1b** (extractor robustness, P1 and P3 to P6) ran alone before wave B, since Tasks 3, 4 and 6 all needed it.
- **Order check on an unscaled input axis:** tolerance 0.005 × the panel frame's extent along that axis's page
  direction (an unscaled axis has no ticks; the frame is its span).
- **Monotonic checks** (P4 ii): `MONO_TOL_PT` is measured from the extreme so far, not per step, so a slow drift
  fails; assert only, data unchanged.
- **Checkpoints reuse `SAMPLE_RUNNERS`**: one runner per spec serves samples and checkpoints.
- **Icy GW panels keep the required `order` key**, with `check_at` only where the curves are visibly apart.
- **`data:check` and negative guideline params:** a negative param is a problem only beyond `EDGE_TOLERANCE` × the
  panel's param span (caf22f5a). The extractor's rounding of the baseline gives first points of −0.0001 to −0.0067;
  no extractor snap.
- **B2-4's check distance `OutOfChart`** names the panel param `check_distance` (Review Focus 5's `distance` was
  loose wording).
- **B7-2 limits stay in `groundRollUncorrected`** (the contract); TOLD.md 1.6 was reworded to match.
- **The carried-line `OutOfChart` on `gross_weight`** keeps its value in chart units (1000 lb), as B2-3's GW panel
  does; plan 3's UI converts by the quantity's unit.
- **Limitations wording:** B2-5's takeoff factor range is the measured [2.10, 6.78]; B2-6's is stated inward-rounded
  1.20 to 3.86 (measured [1.196, 3.866]); a general note covers a refusal entry outside the drawn wind or slope lines.
- **B2-6 sheet 1 `gw` `label_tol_pt: 1.0`**, the same evidence class as P6 (leader tips 2.1 and 2.7 pt from the next
  curve).
- **Manifest conflicts in a merge:** take perf-told's own pre-merge manifest (`--ours`), commit the merge, then re-run
  the extractor on the clean merged tree and commit the manifest separately. Re-running before the merge commit stamps
  `-dirty`; starting from the lane's manifest can leave `dataVersion` unchanged although the data changed.

---

## Interface contract (read by every task)

**Schema additions (Task 1).** `Transform` gains an optional `unscaled: true`; such an axis has `unit: "pt"`, `a: 1`, `b: 0`. A new panel:

```ts
interface LimitLine { id: string; type: 'limit_line'; label: string; input: Quantity; output: Quantity;
  beyond: 'above' | 'below';             // the side of the line where the limit is exceeded, in output terms
  points: Pt[];                           // sorted by input, ascending
  axes: Record<string, Transform> }
type Panel = CurveFamily | SingleCurve | GuidelinePanel | ScalePair | Table | LimitLine;
```

**Spec additions (Task 1).** An axis `{unit: pt, page: x | y, unscaled: true}` has no `label_band`, `range`, `ticks`, `title` or `edge`. A `limit_line` panel spec: required `id, type, clip, frame, input, output, label, beyond, max_dash_pt`, optional `filter` (`min_span_pt`, `stroke_width`).

**Checkpoint files (Task 2), `perf/extraction/checkpoints/<spec id>.yaml`:**

```yaml
- inputs: {takeoff_factor: 3.0, gross_weight_lb: 30000, runway_ft: 8000, headwind_kt: 0, slope_pct: 0}
  expected: {refusal_rcr23_kias: 131}
  tolerance_kias: 2
  source: hand
  read_by: plan 1 task 2 reviewer
  date: 2026-10-30
```

Input and output keys are the sample-runner keys below. (TOLD.md 1.6 placed checkpoints in the spec YAML; they get their own files so the lane that writes the spec cannot edit them. Task 7 updates 1.6's wording.)

**Figure functions and runner keys:**

| File | Function | Rounding ids | Runner inputs → outputs |
| --- | --- | --- | --- |
| `figures/b2-4.ts` | `accelCheckSpeed(ctx, fig, i: {takeoffFactor, checkDistanceFt, grossWeightLb, dragIndex, headwindKt, slopePct}): {accelCheckKias: Read<number>}` | `b2-4.distance`, `b2-4.gw`, `b2-4.di`, `b2-4.wind`, `b2-4.slope` | `takeoff_factor, check_distance_ft, gross_weight_lb, drag_index, headwind_kt, slope_pct` → `accel_check_kias` |
| `figures/refusal-speed.ts` | `refusalSpeed(ctx, fig, prefix: string, chart: '' \| 'snow' \| 'icy', i: RefusalInputs): Read<number>` with `RefusalInputs = {takeoffFactor, grossWeightLb, runwayFt, headwindKt, slopePct}` | `<prefix>.runway`, `<prefix>.wind`, `<prefix>.slope` (the carried position is not read) | — |
| `figures/b2-5.ts`, `figures/b2-6.ts` | `refusalNonAb…` / `refusalAb…`: `…Dry(ctx, fig, i): {rcr23Kias, rcr16Kias}`, `…Wet(ctx, fig, i): {rcr18Kias, rcr12Kias}`, `…SnowIcy(ctx, fig, i): {rcr8Kias, rcr4Kias}`, all `Read<number>` | prefix `b2-5.sh1` … `b2-6.sh3`; sheet 3 `<prefix>.snow` / `<prefix>.icy` | `takeoff_factor, gross_weight_lb, runway_ft, headwind_kt, slope_pct` → `refusal_rcr23_kias, refusal_rcr16_kias` (sh1), `…rcr18…, …rcr12…` (sh2), `…rcr8…, …rcr4…` (sh3) |
| `figures/b7-1.ts` | `landingSpeed(ctx, fig, i: {grossWeightLb}): {finalApproachKias, touchdownKias}` | `b7-1.final`, `b7-1.touchdown` | `gross_weight_lb` → `final_approach_kias, touchdown_kias` |
| `figures/b7-2.ts` | `groundRollUncorrected(ctx, fig, i: {paFt, tempC, grossWeightLb}): {rollFt: Read<number>; limits: LimitVerdicts \| null}` and `groundRollCorrected(ctx, fig, i: {uncorrectedFt, rcr, headwindKt, slopePct}): {rollFt: Read<number>}` | `b7-2.sh1.roll`; `b7-2.sh2.rcr`, `b7-2.sh2.wind`, `b7-2.sh2.slope` | sh1 `pa_ft, temp_c, gross_weight_lb` → `ground_roll_ft`; sh2 `uncorrected_ft, rcr, headwind_kt, slope_pct` → `ground_roll_ft` |

`LimitVerdicts = Readonly<Record<'brakeEnergy' | 'mlgTire' | 'nlgTire', boolean | null>>`, computed from the run's own carried position and roll (so the exact and the conservative pass each get their own); `null` for the whole record when the roll is out of chart.

The printed decrements are constants in the sheet functions: B2-5 RCR 16 −4, RCR 12 −9; B2-6 RCR 16 −5, RCR 12 −10 (KIAS, all GW). They are corrections, not rounding points.

---

### Task 1: Unscaled axis, `limit_line`, checkpoint loader

**Files:**
- Modify: `perf/schema/charts.schema.json`, `perf/src/core/data/types.ts` (generated), `perf/extraction/extract.py`, `perf/extraction/panels.py`, `perf/extraction/output.py`, `perf/tests/helpers/specs.ts`
- Create: `perf/src/core/read/limit-line.ts`, `perf/tests/helpers/checkpoints.ts`, `perf/tests/checkpoints.test.ts`, `perf/tests/fixtures/data-ok-limit/` (one `X1-4.json` with an unscaled axis and a `limit_line`, its page PNG and manifest), `perf/tests/fixtures/checkpoints/X1-2.yaml`
- Test: `perf/tests/read.test.ts`, `perf/tests/data-check.test.ts`, `perf/tests/checkpoints.test.ts`

**Interfaces:**
- Produces: `beyondLimit(p: LimitLine, input: number, output: number): boolean | null` (`read/limit-line.ts`); `loadCheckpoints(dir?: string): Map<string, Checkpoint[]>` and `interface Checkpoint { inputs: Record<string, number>; expected: Record<string, number>; tolerance_kias: number; source: 'hand'; read_by: string; date: string }` (`tests/helpers/checkpoints.ts`); the schema and spec keys in the interface contract.

- [ ] **Step 1: Write the failing tests**
  - `read.test.ts`, `describe('beyondLimit')` on a synthetic line `[[0, 10], [10, 20]]`, `beyond: 'above'`: `(5, 16)` → `true`; `(5, 14)` → `false`; `(5, 15)` → `false` (on the line is not beyond); `(10 + EDGE_TOLERANCE * 10 / 2, 25)` → `true` (clamped end); `(11, 25)` → `null`; the same line with `beyond: 'below'` gives `(5, 14)` → `true`.
  - `data-check.test.ts`: `data-ok-limit` passes; a copy with `unscaled: false` fails on the schema.
  - `checkpoints.test.ts`: `loadCheckpoints(fixture)` returns the fixture's one checkpoint for `X1-2`; a checkpoint with a key outside the format, a non-finite value or `source` other than `hand` throws naming the file. Then `describe('hand-read checkpoints')` loops `loadCheckpoints()` over `SAMPLE_RUNNERS` and asserts each expected value within `tolerance_kias`. A checkpoint whose spec has no data file in `perf/data/f16c-f110-129/` yet is reported with `t.todo` ("not extracted yet"); once the data file exists, a missing runner fails.
- [ ] **Step 2: Run** `cd perf && nice -n 19 node --test tests/read.test.ts tests/data-check.test.ts tests/checkpoints.test.ts`. Expected: FAIL (`beyondLimit` and `loadCheckpoints` not defined, `limit_line` unknown to the schema).
- [ ] **Step 3: Schema and types.** Add `unscaled` (`{"const": true}`) to `Transform` and the `LimitLine` definition to `Panel`'s `oneOf`; `npm run types:gen`.
- [ ] **Step 4: `beyondLimit`** with `interpWithin` and `edgeTolerance(drawnRange(points))` from `read/interp.ts`; strict comparison.
- [ ] **Step 5: `loadCheckpoints`**, resolving `perf/extraction/checkpoints/` from `import.meta.url` (R14), files sorted by name, the spec id taken from the file name.
- [ ] **Step 6: Run** the three test files. Expected: PASS.
- [ ] **Step 7: Extractor.** In `extract.py` an axis with `unscaled: true` takes `{unit, page, unscaled}` only and gets `{'a': 1.0, 'b': 0.0, 'resid': 0.0}` without `fit_axis`; `check_titles` skips it; `output.figure_json`'s transforms carry `unscaled: true`. In `panels.py` register `limit_line` in `TYPES` and `KEYS` (contract keys; `NESTED` unchanged): keep only segments of length ≤ `max_dash_pt` inside the clip, chain, `mono_pieces` along the input, `join_dashes`, drop lines shorter than `min_span_pt` (default `GUIDE_MIN_SPAN_PT`); assert exactly one line, one way along the input, inside the frame. `output.overlay_png` draws a limit line in red.
- [ ] **Step 8: Regression check.** Run the extractor with no ids. Expected: exit 0 and `git status --short perf/data` empty (step 0 data byte-identical).
- [ ] **Step 9: Commit** `feat(perf): unscaled axis, limit_line panel type and hand-read checkpoint loader`.

### Task 1b: Extractor robustness for the plan 1 pages (rulings P1, P3 to P6)

**Files:**
- Modify: `perf/extraction/panels.py`, `perf/extraction/geom.py` (only if the joining helpers move there), `perf/README.md` (the new spec keys)

**Interfaces:**
- Produces: the spec keys of P1, P3, P4 (iii), P5, P6; the behaviour of P4 (i), (ii). All opt-in except P4 (i) and (ii), which only relax asserts that fail today.

- [ ] **Step 1: Implement** P1, P3, P4, P5, P6 in `panels.py`, reusing `mono_pieces` and `join_dashes`; register the new keys in `KEYS` / `NESTED`.
- [ ] **Step 2: Prove each on its real page** with uncommitted scratch specs (the evidence's what-if settings): B2-5 sh1 `gw` 9 curves; B7-2 sh1 `gw` 11 curves; B7-2 sh2 `rcr_dry` 4 and `rcr_wet` 3; B7-1 two anchored single curves; B2-5 sh3 icy with `shared`; B2-5 sh2 `gw` with `label_tol_pt: 1.0`; B2-4 `gw` with `max_gap_pt: 12`; B2-5 sh2 `wind` with `max_gap_pt: 6`. Record counts in the report.
- [ ] **Step 3: Regression.** No-id extraction: exit 0, `git status --short perf/data` empty.
- [ ] **Step 4: Commit** `feat(perf): curve joining, anchored single curves, shared labels and per-panel tolerances in the extractor`.

### Task 2: Hand-read checkpoints

**Files:**
- Create: `perf/extraction/checkpoints/B2-5.sh1.yaml`, `B2-5.sh2.yaml`, `B2-5.sh3.yaml`, `B2-6.sh2.yaml`, `B2-6.sh3.yaml`

**Interfaces:**
- Consumes: the checkpoint format and the runner keys of the interface contract.
- Produces: 15 checkpoints: B2-5 sh1, B2-5 sh2, B2-6 sh2 three each (`refusal_rcr23_kias` / `refusal_rcr18_kias`), B2-5 sh3 and B2-6 sh3 two `refusal_rcr8_kias` and one `refusal_rcr4_kias` each.

- [ ] **Step 1: Render** page indexes 287, 288, 289, 291 and 292 at 300 dpi to PNGs in the scratchpad (`pymupdf` `get_pixmap(dpi=300)` only; no `get_drawings`, no text extraction beyond what the page shows).
- [ ] **Step 2: Choose inputs** per chart: values on printed grid lines where possible, inside every panel's drawn range, and across the set at least one checkpoint per sheet with non-zero wind and one with non-zero slope, one tailwind or downhill among them. GW from the printed curves (no interpolation between GW curves needed for the read).
- [ ] **Step 3: Read** each value along the manual's procedure (Part 2: "Enter appropriate chart with takeoff factor (A). Proceed horizontally left to GW (B) and then vertically up to runway length (C)…"), measuring pixel positions on the render against the grid; record the reading to the nearest 1 KIAS.
- [ ] **Step 4: Write** the five files in the contract format, `read_by: plan 1 task 2 reviewer`, `date` the day of the reading, `tolerance_kias: 2`.
- [ ] **Step 5: Verify** `cd perf && nice -n 19 node --test tests/checkpoints.test.ts`. Expected: PASS; the loader accepts every file and all 15 cases report todo "not extracted yet".
- [ ] **Step 6: Commit** `test(perf): 15 hand-read refusal speed checkpoints (B2-5, B2-6 sheets without a sample)`.

### Task 3: Figure B2-4, Acceleration Check Speed

**Files:**
- Create: `perf/extraction/specs/B2-4.yaml`, `perf/src/core/figures/b2-4.ts`, `perf/tests/figure-b2-4.test.ts`, data `perf/data/f16c-f110-129/B2-4.json` and `pages/B2-4.png` (extractor)
- Modify: `perf/tests/helpers/sample-runners.ts`, `perf/tests/sample-problems.test.ts` (pinned list)

**Interfaces:**
- Consumes: Task 1's extractor (no new types needed here).
- Produces: `accelCheckSpeed` (contract).

- [ ] **Step 1: Spec.** Page index 286, printed page B2-10. Panels in reading order: `distance` (`curve_family`, input `takeoff_factor` on page y, output `accel_check_speed` on page x, param `check_distance` in ft, the printed distance lines, labels read off a 6× render), then `guideline_panel`s `gw`, `di`, `wind` (`headwind`/`tailwind`), `slope` (`uphill`/`downhill`), each with its printed BASELINE value and exact `count` per family. Sample: `{takeoff_factor: 1.85, check_distance_ft: 1500, gross_weight_lb: 33000, drag_index: 150, headwind_kt: 10, slope_pct: 1}` → `{accel_check_kias: 129}`.
- [ ] **Step 2: Extract** `B2-4`. Expected: exit 0; the overlay's lines lie on the printed ones.
- [ ] **Step 3: Write the failing tests** in `figure-b2-4.test.ts`: the rounding ids are exactly `['b2-4.distance', 'b2-4.gw', 'b2-4.di', 'b2-4.wind', 'b2-4.slope']` in that order; check distance 1,750 ft reads between the 1,500 and 2,000 ft results; 500 ft below the first curve gives `OutOfChart` with `input` `check_distance`; a GW above the panel's drawn range gives `OutOfChart` on `gross_weight`; wind 0 and slope 0 read their ids with the value unchanged; for every panel input (GW, DI, wind, slope) a value below and above its drawn range gives `OutOfChart` naming that input, a headwind beyond the drawn magnitude and a tailwind beyond the drawn tailwind lines included.
- [ ] **Step 4: Run** `nice -n 19 node --test tests/figure-b2-4.test.ts`. Expected: FAIL (`accelCheckSpeed` not defined).
- [ ] **Step 5: Implement `accelCheckSpeed`** following `b2-3.ts` (steps table, first `OutOfChart` stops, sign picks the family); add the `B2-4` runner and pin `B2-4` in `sample-problems.test.ts`.
- [ ] **Step 6: Run** `nice -n 19 node --test tests/figure-b2-4.test.ts tests/sample-problems.test.ts`. Expected: PASS, the sample within 2 %.
- [ ] **Step 7: Commit** the spec, then the data, then the figure function and tests (three commits, the step 0 order).

### Task 4: Figure B2-5, Refusal Speed (Non-AB), and the shared refusal reader

**Files:**
- Create: `perf/extraction/specs/B2-5.sh1.yaml`, `B2-5.sh2.yaml`, `B2-5.sh3.yaml`, `perf/src/core/figures/refusal-speed.ts`, `perf/src/core/figures/b2-5.ts`, `perf/tests/figure-refusal.test.ts`, data for the three sheets (extractor)
- Modify: `perf/tests/helpers/sample-runners.ts`

**Interfaces:**
- Consumes: Task 1's unscaled axis; Task 2's checkpoint files.
- Produces: `refusalSpeed` and `RefusalInputs` (contract), `refusalNonAbDry`, `refusalNonAbWet`, `refusalNonAbSnowIcy`.

- [ ] **Step 1: Specs.** Page indexes 287, 288, 289 (printed B2-11 to B2-13). Axes: `takeoff_factor` (page y, the right-hand scale of the lower panel), `refusal_speed` (page y, the right-hand scale beside the slope panel), `wind`, `slope` (page x), and the unscaled `carry` (page x; on sheet 3 `carry_snow` and `carry_icy`). Panels: `gw` (`curve_family`, input `takeoff_factor`, output `carry`, param `gross_weight` 1000 lb), `runway` (`curve_family`, input `carry`, output `refusal_speed`, param `runway_length` in ft), `wind` (`headwind` / `tailwind`), `slope` (`uphill` / `downhill`); sheet 3 has `gw_snow`, `runway_snow`, `gw_icy`, `runway_icy` and shared `wind`, `slope`. On the icy GW panel declare no `order` check points where the curves meet (Review Focus 2); `corrections` carry the printed decrement text.
- [ ] **Step 2: Extract** `B2-5.sh1 B2-5.sh2 B2-5.sh3`. Expected: exit 0.
- [ ] **Step 3: Write the failing tests** in `figure-refusal.test.ts` for B2-5: ids per sheet exactly `['b2-5.sh1.runway', 'b2-5.sh1.wind', 'b2-5.sh1.slope']` (sheet 3: the `.snow` and `.icy` sets); `rcr16Kias` = `rcr23Kias` − 4 and `rcr12Kias` = `rcr18Kias` − 9 in `runExact`; a 10 kt tailwind and a 1 % downhill each give a lower speed than calm and level (Review Focus 1); icy GW 18,000 and 48,000 lb both read (Review Focus 2); a takeoff factor and GW whose carried line misses the runway curves give `OutOfChart` with `input` `gross_weight` and `drawnRange` null (Review Focus 3); runway 1,000 ft and 25,000 ft give `OutOfChart` on `runway_length`; takeoff factor, wind and slope below and above their drawn ranges give `OutOfChart` naming them.
- [ ] **Step 4: Run** `nice -n 19 node --test tests/figure-refusal.test.ts`. Expected: FAIL.
- [ ] **Step 5: Implement** `refusalSpeed` (an `OutOfChart` from the `runway` panel whose `input` is the carried axis is rewritten to `gross_weight` with `drawnRange: null`; the carried value never goes through `ctx.read`) and the three `b2-5.ts` sheet functions with the decrements; add the `B2-5.sh1/2/3` runners.
- [ ] **Step 6: Run** `nice -n 19 node --test tests/figure-refusal.test.ts tests/checkpoints.test.ts`. Expected: PASS; the B2-5 checkpoints within ±2 KIAS. A failing checkpoint goes to the supervisor with the page position of the reading and of the extraction, not into an edited file.
- [ ] **Step 7: Commit** specs, data, then code and tests.

### Task 5: Figure B2-6, Refusal Speed (AB)

**Files:**
- Create: `perf/extraction/specs/B2-6.sh1.yaml`, `B2-6.sh2.yaml`, `B2-6.sh3.yaml`, `perf/src/core/figures/b2-6.ts`, data for the three sheets (extractor)
- Modify: `perf/tests/figure-refusal.test.ts`, `perf/tests/helpers/sample-runners.ts`, `perf/tests/sample-problems.test.ts`

**Interfaces:**
- Consumes: Task 4's `refusalSpeed` and `RefusalInputs`.
- Produces: `refusalAbDry`, `refusalAbWet`, `refusalAbSnowIcy`.

- [ ] **Step 1: Specs** for page indexes 290, 291, 292, the same shape as Task 4's. Sheet 1's sample: `{takeoff_factor: 1.85, gross_weight_lb: 33000, runway_ft: 6000, headwind_kt: 10, slope_pct: 1}` → `{refusal_rcr23_kias: 153}`.
- [ ] **Step 2: Extract** `B2-6.sh1 B2-6.sh2 B2-6.sh3`. Expected: exit 0.
- [ ] **Step 3: Write the failing tests** (B2-6 block in `figure-refusal.test.ts`): ids per sheet; `rcr16Kias` = `rcr23Kias` − 5, `rcr12Kias` = `rcr18Kias` − 10; tailwind and downhill lower the speed.
- [ ] **Step 4: Run** `nice -n 19 node --test tests/figure-refusal.test.ts`. Expected: FAIL.
- [ ] **Step 5: Implement** the three `b2-6.ts` functions on `refusalSpeed`; add the runners; pin `B2-6.sh1` in `sample-problems.test.ts`.
- [ ] **Step 6: Run** `nice -n 19 node --test tests/figure-refusal.test.ts tests/sample-problems.test.ts tests/checkpoints.test.ts`. Expected: PASS; 153 KIAS within 2 %, the B2-6 checkpoints within ±2 KIAS.
- [ ] **Step 7: Commit** specs, data, then code and tests.

### Task 6: Figures B7-1 and B7-2 (sheets 1 and 2)

**Files:**
- Create: `perf/extraction/specs/B7-1.yaml`, `B7-2.sh1.yaml`, `B7-2.sh2.yaml`, `perf/src/core/figures/b7-1.ts`, `perf/src/core/figures/b7-2.ts`, `perf/tests/figure-landing.test.ts`, data (extractor)
- Modify: `perf/tests/helpers/sample-runners.ts`, `perf/tests/sample-problems.test.ts`

**Interfaces:**
- Consumes: Task 1's unscaled axis, `limit_line` and `beyondLimit`.
- Produces: `landingSpeed`, `groundRollUncorrected`, `groundRollCorrected`, `LimitVerdicts` (contract).

- [ ] **Step 1: Specs.**
  - `B7-1` (index 389, B7-3): two `single_curve` panels `final_approach` and `touchdown` over `gross_weight` (their order is a test in Step 3). Sample `{gross_weight_lb: 20000}` → `{final_approach_kias: 136, touchdown_kias: 125}`.
  - `B7-2.sh1` (index 390, B7-4): `temp` (`curve_family`, input `altitude` on page y, output unscaled `carry` on page x, param `temperature` °C), `gw` (`curve_family`, input `carry`, output `ground_roll` 1000 ft on page y, param `gross_weight`), and three `limit_line`s in `gw`'s axes: `brake_energy` ("MAXIMUM BRAKE ENERGY LIMIT LINE"), `mlg_tire` ("MLG TIRE LIMIT SPEED (225 KTS — NO WIND)"), `nlg_tire` ("NLG TIRE LIMIT SPEED (217 KTS — NO WIND)"), each `beyond: above`. Sample `{pa_ft: 2000, temp_c: 40, gross_weight_lb: 28000}` → `{ground_roll_ft: 3902}`.
  - `B7-2.sh2` (index 391, B7-5): `rcr` (`curve_family`, input `uncorrected_roll` on page y, output `ground_roll` on page x, param `rcr`), `wind`, `slope` guideline panels. Sample `{uncorrected_ft: 3902, rcr: 16, headwind_kt: 10, slope_pct: 1}` → `{ground_roll_ft: 3375}` (the erratum on file concerns its text only).
- [ ] **Step 2: Extract** `B7-1 B7-2.sh1 B7-2.sh2`. Expected: exit 0; each limit line found once.
- [ ] **Step 3: Write the failing tests** in `figure-landing.test.ts`: ids exactly `['b7-1.final', 'b7-1.touchdown']`, `['b7-2.sh1.roll']`, `['b7-2.sh2.rcr', 'b7-2.sh2.wind', 'b7-2.sh2.slope']`; the sheet 1 sample's `limits` all `false`; per limit line one input beyond it (`true`, e.g. GW 46,000 lb at 8,000 ft and 50 °C for the tire lines) and one outside its drawn range (`null`); a temperature beyond the drawn curves gives `OutOfChart` on `temperature`, and a carried position the `gw` panel does not draw gives `OutOfChart` naming `temperature` with `drawnRange` null; RCR between two printed curves interpolates; for every panel input (GW, altitude, temperature, uncorrected roll, RCR, wind, slope) a value below and above its drawn range gives `OutOfChart` naming that input; B7-1's final approach is above its touchdown at every GW from the shorter curve's first to last drawn 1,000 lb.
- [ ] **Step 4: Run** `nice -n 19 node --test tests/figure-landing.test.ts`. Expected: FAIL.
- [ ] **Step 5: Implement** `b7-1.ts` and `b7-2.ts` (the carried position never through `ctx.read`; `limits` from `beyondLimit` on that run's carried position and roll in chart units); add the three runners and pin `B7-1`, `B7-2.sh1`, `B7-2.sh2` in `sample-problems.test.ts`.
- [ ] **Step 6: Run** `nice -n 19 node --test tests/figure-landing.test.ts tests/sample-problems.test.ts`. Expected: PASS, all four samples within 2 %.
- [ ] **Step 7: Commit** specs, data, then code and tests.

### Task 7: Plan 1 close-out

**Files:**
- Modify: `docs/wip/TOLD.md` (1.1 status column, 0.6 prototype column, 1.6 item 3's checkpoint location), `perf/README.md` (unscaled axes, `limit_line`, checkpoints), `docs/wip/TOLD-HANDOFF.md`

- [ ] **Step 1: Re-extract everything** (no ids). Expected: exit 0, `git status --short perf/data` empty.
- [ ] **Step 2: Gates** in `perf/`, each `nice -n 19`: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run types:check`, `npm run data:check`, `npm run build`. Expected: all pass, line coverage on `src/core/` ≥ 90 %.
- [ ] **Step 3: Docs.** TOLD.md 1.1: B2-4 to B7-2 "Extracted, sample passes" or "Extracted, checkpoints pass"; 0.6: each sample's computed value; 1.6 item 3: checkpoints in `perf/extraction/checkpoints/`. README and handoff (state, what waits on the human, next: plan 2).
- [ ] **Step 4: Commit** `docs(perf): step 1 plan 1 done` and open the PR `perf-told` → `main` (merge commit).
