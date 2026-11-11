# TOLD Step 1, Plan 2: Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `computeTold(figures, inputs)` in `src/core/` gives every MDC TOLD cell of the approved mockup (takeoff MIL
and MAX AB, landing normal and heavyweight, dry and wet), exact and conservative, with side data, runway rule marks
and out-of-chart reasons, plus the drag index builder on Fig. B1-1.

**Architecture:** Six chains in `src/core/told/`, one per TOLD column, each run through `evaluate` (`ctx.ts`), which
gains side data per deciding run and two-valued inputs. Inputs are parsed and derived in `src/core/inputs/`; the drag
index comes from `src/core/dragindex/`. The data's quantity names and units are aligned first (re-extraction), and the
readers lose the edge tolerance at ends that are not on the input axis.

**Tech Stack:** unchanged (TypeScript via tsc, `node --test` on `.ts`, Ajv, `yaml`; Python 3 with PyMuPDF, PyYAML,
Pillow from `flake.nix` for Task 1's re-extraction).

**Spec:** `docs/wip/TOLD.md` section **1.7** (this plan's spec, rulings 1 to 4 of 11 Nov 2026), with 1.2 item 3,
1.3, 1.4, 5.2, 5.3 and the decisions of 29 Oct 2026 (drag index builder). `docs/wip/TOLD-STEP0.md` (R1 to R14) and
`docs/wip/TOLD-STEP1-P1.md` (P1 to P16) stay in force.

## Global Constraints

- Every constraint of `TOLD-STEP0.md` and `TOLD-STEP1-P1.md` "Global Constraints" holds (worktree and branch,
  `nice -n 19` on every test run, Node ≥ 22.18, `src/core/` purity, units in names, `OutOfChart` instead of
  extrapolation or throwing, `python3 -I` inside `nix develop`, `perf/data/` written only by the extractor, the
  commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Lane worktrees: `../sourcedcs-told-p2-t<N>` on `lane/told-p2-t<N>` off `perf-told`.
- Lanes run only their own test files (`cd perf && nice -n 19 node --test tests/<file>.test.ts`); the supervisor runs
  the full gates (`npm test`, `typecheck`, `lint`, `format:check`, `types:check`, `data:check`, `build`).
- One job per file, each under about 300 lines; no central manager object.
- Dependencies run one way: `inputs/` and `dragindex/` → `told/` → `figures/` → `read/`. `told/` never imports
  `src/web/`; nothing in `src/core/` fetches or reads files.
- The figure functions keep their signatures and ids; only Task 5 and Task 6 may touch `figures/` (the deferred
  minors named there).
- Speeds KIAS, `STEPS.speedKt`; distances ft, `STEPS.distanceFt`. Wind and slope signed at every function boundary
  (`headwindKt > 0`, `slopePct > 0` uphill, R8).
- "Over" a rule threshold is strictly greater. `null` (not judged) never counts as within a limit.

## Review Focus

1. **A takeoff distance at or near 2,500 ft:** exactly 2,500 ft checks at 2,000 ft (the 1,000 ft check is for a roll
   *under* 2,500); a conservative run that crosses 2,500 must carry its own check distance in `conservativeSide`.
   Pinned in Task 5.
2. **Wind across the 360/0 wrap and from behind:** wind 360/10 on heading 001 is a 10 kt headwind (within float), wind
   180/10 on heading 360 a 10 kt tailwind (`headwindKt` −10), and a gust-only difference changes the crosswind and
   not the headwind. Pinned in Task 3.
3. **A clean aircraft with no tip missiles:** basic 4 minus 2 × 4 gives an exact drag index of −4 and a conservative
   one of 4. The exact cell must not silently read a negative drag index off a chart that starts at 0; it is the
   questioner's Q1, and Task 5 pins the ruling.
4. **Fields that do not parse affect only their chains:** an empty landing GW leaves the normal landing columns
   unparsed and every takeoff and heavyweight cell computed. Pinned in Task 7.
5. **RCR typed with a decimal and RCR on a printed value:** dry RCR 16 reads sheet 1 alone, 8 sheet 3 alone,
   17.5 interpolates between 16 and 23; a landing column's RCR 9.5 is below 10 (3.18). Pinned in Tasks 5 and 7.

## Execution notes for the supervisor

- Waves (at most 4 agents at once: implementers plus the questioner; every subagent on Opus 5.5): **A** Tasks 1, 2,
  3 and the questioner · **B** Tasks 4, 5, 6 (after A is merged and the questioner's rulings are in this file) ·
  **C** Task 7 · **D** Task 8.
- Task 1 rewrites `manifest.json`. A conflict there follows plan 1's procedure: take `perf-told`'s pre-merge
  manifest, commit the merge, re-run the extractor on the clean merged tree, commit the manifest separately.
- `tests/helpers/bound.ts` and `tests/helpers/exhaustive.ts` change in Task 2 (the new `Chain` shape); Tasks 5 and 6
  use them as Task 2 leaves them.
- The questioner reads 1.7, this plan, `src/core/ctx.ts`, `src/core/read/`, the B1-1 data and pages p254–255, and
  rules on Q1 to Q4 below, each with a recommended default the supervisor may take. The rulings are written into
  this file as "Questioner rulings" before wave B starts; they override task text where they differ.

### Questions for the questioner

- **Q1 (Review Focus 3): a negative exact drag index.** B2-3's and B2-4's DI panels start at 0. Default: the exact
  cell is `OutOfChart` on `drag_index` as any off-chart input, *but* a cell whose exact pass is out of chart only
  because the exact drag index is below 0 keeps its conservative value (the manual itself prescribes 0 there as the
  conservative reading); the reason line names the exact drag index. Rule on the default or an alternative.
- **Q2: identifying an input-axis end (ruling 4).** The data has no frame extents. Default (Task 2): a line's end
  gets the tolerance only when it lies within the tolerance of its own family's drawn input span end (curve family:
  all its curves; guideline panel: that family's lines; single curve and limit line: their own range). Check against
  every sample and checkpoint and every panel's ends; name any end the default gets wrong.
- **Q3: the B1-1 racks table.** Confirm the mapping from every B1-1 rack string to the sheet 2 items, as the
  mockup's `suspensionsFor` does it, and the capacities (TER 16S1750, TER 66J45517, LAU-88/A, LAU-88 A/A: 3; every
  other item: 1). Name any rack string the mockup handles wrongly.
- **Q4: the worked example's lines.** Read p254–255 and give the per-station drag index lines that sum to 142, so
  Task 4's golden test checks each line, not only the total.

## Questioner rulings (2026-11-11)

- **Q1, negative exact drag index: take the default, implemented in `ctx.ts`, not in the chain.** The rule is
  general: *an exact error rejects the whole cell only when the baseline run (every `input` at its conservative
  value, nothing rounded) errors too; when the baseline is in chart, the exact cell is the exact `OutOfChart` and the
  conservative cell is searched and decided as usual.* With single-valued inputs the baseline is the exact pass, so
  this changes nothing else. A negative exact drag index comes only from removed tip missiles (−4 each exact, 0
  conservative), so the conservative drag index is never below 0 (lowest: two tip pods on 16S210, 4 − 2 − 2 = 0).
  Only `distance` and `accelCheck` are affected (B2-3 and B2-4 `di`); rotation, takeoff speed and both refusal speeds
  do not read the drag index and stay computed. The reason line is the exact pass's `OutOfChart` on `drag_index`
  (value −4, the panel's drawn range), tagged `exact`. This is an exception to 5.2's "if the exact value itself is
  out of chart, the whole cell is rejected": Task 8 adds it to 5.2 and to the Limitations page. Task 5 may change
  `cellOf` in `ctx.ts`, and pins the rule there with a synthetic two-valued chain as well as with the takeoff chain
  (Review Focus 3: clean, no tip missiles, exact `OutOfChart` on `drag_index` at −4, conservative computed at DI 4).
  Do not read a negative drag index at 0 in the exact cell: that would be a reading at a drag index the aircraft
  does not have, labelled exact.
- **Q2, input-axis ends: take the default, plus one amendment: the baseline.** In a guideline panel an end within
  the tolerance of the panel's **baseline** also keeps the tolerance. Without it the default drops two lines that
  their own data draws to the baseline, both read by the manual's own samples: B2-3 `cg` line 11 starts at 35.003
  (baseline 35, distance 12.0 there) and B2-4 `gw` line 0 ends at 42.9999 (baseline 43, 40 KIAS there). The samples
  still pass without them, but B2-3 entries between 11.0 and 12.0 (×1000 ft) at any CG other than 35, and B2-4
  entries between 40 and 50 KIAS at any GW other than 43, would become `OutOfChart` on the output. The existing
  test "a line drawn a hair short of the baseline is usable within the tolerance (R1)" stays as it is. The existing
  test "the tolerance is taken from the union of all curves, not the bracketing pair" (the param 2 curve stopping at
  5 inside a 0 to 10 span, read at 5.01) *must* flip to `OutOfChart`: that is ruling 4 working, not a regression.
  The guideline span is per family (as the default says), which replaces R1's "all families together": with all
  families, the B2-3 tailwind ends at 19.989 kt would count as inside the 0 to 40 kt span and lose the tolerance.
  Every other end the default strips is an output-edge end (see Evidence), and no sample or checkpoint reads past
  one. One end keeps a tolerance it should not have: B7-2 sheet 2 `rcr_wet`, RCR 18 ends at 6.9066 on the 12.0 top
  edge, and that end *is* the wet family's span end, because every wet curve leaves through the top. Accept it: it
  covers 0.0135 (13.5 ft of uncorrected roll) at a 12,000 ft roll, and no data says where the frame is. Put it in
  the Task 8 Limitations note on ruling 4. Ruling 4's named case should read "B2-3 GW **36** to 48": GW 36 also ends
  on the 12.0 edge, at TOF 6.636.
- **Q3, racks: take the default capacities and the table below. The mockup's `suspensionsFor` maps every rack string
  correctly** (each of the 11 strings run at each of its stations). The explicit table lists the items; the station
  filter in `suspensionsFor` does the rest. `PYLON` names three items, one per station class, and at **5L it leaves
  none**: the LANTIRN navigation pod's `32*` is "*WITH PYLON" (sheet 4), so it carries no suspension line. The
  table must keep sheet 7's `A(V)1A` string as its own key (the manual's misprint, TOLD.md 1.2). When two items tie
  on capacity, the default is the first in sheet 2 order (tip: AIM-9 LAUNCHER (16S210), DI 0, the basic aircraft's
  own; LAU-88: LAU-88/A). ADAPTER (16S301) alone is carried by no rack string, which is right: the both-ways test
  only checks that the names in the table are sheet 2 rows.

  | Rack string (sheets 3 to 7) | Sheet 2 items | Capacity |
  | --- | --- | --- |
  | `LAUNCHER` | AIM-9 LAUNCHER (16S210); LAU-129/A LAUNCHER | 1, 1 |
  | `LAUNCHER + ADAPTER` | AIM-9 LAUNCHER (16S210) + ADAPTER (16S301); LAU-129/A LAUNCHER + ADAPTER (16S301) | 1, 1 |
  | `PYLON` | WEAPON PYLON* (16S1700) (3, 4, 6, 7); CENTERLINE PYLON* (16S951) (5); LANTIRN TARGETING POD PYLON (16S1150) (5R); none at 5L | 1 each |
  | `PYLON/TER` | WEAPON PYLON* (16S1700); CENTERLINE PYLON* (16S951) (only the travel pod at 5); TER (16S1750) + WEAPON PYLON*; TER (66J45517) + WEAPON PYLON* | 1, 1, 3, 3 |
  | `TER` | TER (16S1750) + WEAPON PYLON*; TER (66J45517) + WEAPON PYLON* | 3, 3 |
  | `LAU-88/A, A/A, -117/A, A(V)1/A, A(V)3/A` | LAU-88/A + WEAPON PYLON*; LAU-88 A/A + WEAPON PYLON*; LAU-117/A, A(V)1/A, A(V)3/A + WEAPON PYLON* | 3, 3, 1 |
  | `LAU-88/A, A/A, -117/A, A(V)1A, A(V)3/A` (sheet 7, TGM-65) | the same three | 3, 3, 1 |
  | `LAU-117/A, A(V)1/A, A(V)3/A` | LAU-117/A, A(V)1/A, A(V)3/A + WEAPON PYLON* | 1 |
  | `LAU-118(V)4/A` | LAU-118(V)4/A + WEAPON PYLON* | 1 |
  | `PYLON (NJETT)` | NONJETTISON (NJETT) FUEL PYLON* | 1 |
  | `NONE` | (none) | — |

- **Q4, worked example (printed p. B1-2/B1-3, PDF index 254 to 255): take the four station lines below.** The
  golden test checks each station's total and its store/suspension split, exact and conservative alike (no tip
  rule differs here), then 142 and 146.

  | Stations | Store, count, each | Suspension, count, each | Line DI |
  | --- | --- | --- | --- |
  | 1/9 | AIM-9L, M, S (`4*`, in the basic aircraft): 2 × 0 = 0 | LAU-129/A LAUNCHER: 2 × 1 = 2 | **2** |
  | 2/8 | AIM-9L, M, S: 2 × 5 = 10 | LAU-129/A LAUNCHER + ADAPTER (16S301): 2 × 6 = 12 | **22** |
  | 3/7 | MK 84 LDGP: 2 × 9 = 18 | WEAPON PYLON* (16S1700): 2 × 15 = 30 | **48** |
  | 4/6 | 370-GALLON TANK, "SINGLE RACKS OR STORES AT 3 OR 7": 2 × 35 = 70 | none (rack `NONE`) | **70** |
  | | | Store loading | **142** |
  | | | + basic aircraft (sheet 1, F-16C `4/2`, subsonic) | 4 |
  | | | Total | **146** |

  The manual states the 1/9 line as one number ("the drag index is 1 for a tip missile on a LAU-129/A missile
  launcher"); the builder's 0 + 1 split gives the same 2. Configuration weight (not built in plan 2) is 390 + 616 +
  4,518 + 6,012 = 11,536 lb; the page also cites 142 and 11,520 lb from T.O. GR1F16CJ-12 for the same loading.

- **Extra 1 (Task 4): the `*` marker is not one rule.** `4*` on sheet 3 means "in the basic aircraft" only on the tip
  rows (stations `1 OR 9`); `32*` (LANTIRN NAVIGATION, 5L, sheet 4) means "*WITH PYLON" and adds 32. Key the tip rules
  on a sheet 3 row whose stations are `1 OR 9`, not on `DragValue.note` alone: `*` adds 0, `**` adds value − 4, with
  the 4 taken from the tip AIM-9 row (`4*`), not a literal. Pin it: LANTIRN NAVIGATION at 5L adds 32 and has no
  suspension line.
- **Extra 2 (Task 4): 300-gallon tank with only one of 4 and 6 loaded.** The manual prints "NO STORES AT 4 OR 6" (15)
  and "STORES AT 4 AND 6" (18); one side only is printed nowhere, and the mockup's 15 there is the less safe value.
  Ruling: one side loaded gives 18, exact and conservative, with a builder note. Change the Task 4 test to "15 with
  neither, 18 with one or both".
- **Extra 3 (Tasks 3 and 7): the additional drag index has no unparsed path.** `DerivedInputs` (Task 3 as built) has no
  drag index field, so `TAKEOFF_FIELDS` cannot name `additionalDragIndex`, and "a field that does not parse marks that
  chain's cells" fails for it. Ruling: Task 7 parses it (`parseNumber`, any sign) beside the loadout; it does not
  parse → both takeoff columns `unparsed` with `fields: ['additionalDragIndex']`, landing unaffected. Add that case to
  the Review Focus 4 test.
- **Extra 4 (Task 4): `StoreRow.key` for a tank.** A tank group is one store, but the key formula uses `name`, which
  for a tank row is a variant. Ruling: a tank store's key is `` `${sheet}|${group}||${stations text}` `` (empty name),
  and the variant is not part of a `Loadout`.
- **Extra 5 (Task 2, in flight): the GW 48 test's expected value.** B2-3 GW 48 ends at (3.5762, 12.0016), not 12.0:
  "reads 12.0 within 1e-9" fails. Expect the drawn end's value, 12.0016 (×1000 ft), within 1e-9.

## Supervisor rulings during execution

- **Q1 lands in Task 2, not Task 5.** Task 2 still owned `ctx.ts` when the ruling came in, so the `cellOf` exception
  (an exact error rejects the whole cell only when the baseline run errors too) is built and pinned there; Task 5
  pins it through the takeoff chain only.
- **Q2's baseline amendment** was reached independently by Task 2's implementer and taken before the questioner
  reported; the two agree.
- **B1-1 sheet 1's drag index columns** are `drag_index_f16c` and `drag_index_f16d` (Task 1: the weight tables keep
  `f16c`/`f16d` in lb). Task 4 reads these names. `wind` stays in `kt` (a wind speed, not an airspeed).
- Every questioner ruling and extra is taken as written above.

---

### Task 1: Quantity names and units aligned (ruling 3)

**Files:**
- Modify: `perf/extraction/specs/B2-1.yaml` (`temperature` unit `deg C` → `°C`), `B7-2.sh1.yaml` (axis and panel
  input `altitude` → `pressure_altitude`), `B2-5.sh1.yaml`, `B2-5.sh2.yaml`, `B2-5.sh3.yaml`, `B2-6.sh1.yaml`,
  `B2-6.sh2.yaml`, `B2-6.sh3.yaml` (`refusal_speed` unit `kt` → `KIAS`), and any further conflict the new test lists
- Modify: `perf/scripts/data-check.ts` (the quantity check)
- Regenerate: `perf/data/f16c-f110-129/*.json`, `manifest.json` (by the extractor only)
- Modify: tests that pin the old names (`tests/figure-landing.test.ts` and any other that names `altitude`)
- Test: `perf/tests/data-check.test.ts`

**Interfaces:**
- Produces: every quantity (`input`, `output`, `param`, axis) has one name with one unit across every figure in
  `perf/data/`. `pressure_altitude` in ft, temperature `°C`, every speed `KIAS`. B7-2 sheet 1's `OutOfChart` on
  altitude now names `pressure_altitude`. `dataVersion` 8.

- [ ] **Step 1: Write the failing test** `quantity names have one unit across every figure` in
  `tests/data-check.test.ts`: collect `(name, unit)` from every axis and panel quantity of every data file; assert
  each name has exactly one unit, the message listing `name: unit (files) / unit (files)`. Also
  `the renamed quantities`: `B7-2.sh1` has no quantity named `altitude`; `B2-5.sh1` `refusal_speed` is `KIAS`;
  `B2-1` `temperature` is `°C`.
- [ ] **Step 2: Run it** — `nice -n 19 node --test tests/data-check.test.ts`. Expected: FAIL listing at least the
  three conflicts above. Fix every conflict it lists in the specs (the more common unit and name win; `KIAS` for
  speeds).
- [ ] **Step 3: Add the same check to `scripts/data-check.ts`** as one more problem class, so CI's `data:check`
  carries it.
- [ ] **Step 4: Re-extract the changed specs** — `cd perf && nix develop .. -c python3 -I extraction/extract.py
  "$PERF_PDF" B2-1 B2-5.sh1 B2-5.sh2 B2-5.sh3 B2-6.sh1 B2-6.sh2 B2-6.sh3 B7-2.sh1` (plus any other spec Step 2
  changed). Expected: every assert passes, manifest `dataVersion 8`.
- [ ] **Step 5: Check only names and units changed** — a one-off comparison (not committed) of each regenerated JSON
  against `git show HEAD:<file>` with every `name` and `unit` value dropped: identical. Page images byte-identical.
- [ ] **Step 6: Run** `nice -n 19 node --test tests/data-check.test.ts tests/sample-problems.test.ts
  tests/checkpoints.test.ts tests/figure-landing.test.ts tests/figure-refusal.test.ts` and
  `nice -n 19 npm run data:check`. Expected: PASS, 0 problems. Update any test that pinned an old name.
- [ ] **Step 7: Commit** in plan 1's order: specs and `data-check.ts` and tests first, then the regenerated data and
  manifest. `git commit -m "fix(perf): one name and one unit per quantity across figures (TOLD 1.7 ruling 3)"`, then
  `"data(perf): re-extract with aligned quantity names (dataVersion 8)"`.

### Task 2: `ctx.ts` side data, two-valued inputs, baseline run; edge tolerance on input-axis ends (ruling 4)

**Files:**
- Modify: `perf/src/core/ctx.ts`
- Modify: `perf/src/core/read/interp.ts`, `curve-family.ts`, `guideline-panel.ts` (single curve and limit line keep
  their own range, Q2)
- Create: `perf/src/core/data/figure-set.ts`
- Modify: `perf/tests/helpers/bound.ts`, `perf/tests/helpers/exhaustive.ts`, every test that builds a `Chain`
  (`tests/ctx.test.ts`, `tests/figures.test.ts`, …)
- Test: `perf/tests/ctx.test.ts`, `perf/tests/read.test.ts`

**Interfaces:**
- Produces (`ctx.ts`):
  ```ts
  export interface Ctx {
    read(id: string, value: number, step: number): number;
    /** Exact pass: `value.exact`; every conservative run starts from `value.conservative`. */
    input(id: string, value: { readonly exact: number; readonly conservative: number }, step: number): number;
  }
  export interface ChainRun<K extends string, S> {
    readonly outputs: Readonly<Record<K, Read<number>>>;
    readonly side: S;
  }
  export type Chain<K extends string, S = null> = (ctx: Ctx) => ChainRun<K, S>;
  export interface Cell<S = null> {
    readonly exact: Read<number>;
    readonly conservative: Read<number>;
    readonly exactSide: S;
    /** The side of the run that decided `conservative` (the worst run, or the first that errored). */
    readonly conservativeSide: S;
  }
  export interface Evaluation<K extends string, S = null> { readonly cells: Readonly<Record<K, Cell<S>>>; /* trace, roundingPoints, runs as now */ }
  export function evaluate<K extends string, S>(chain: Chain<K, S>, kinds: Readonly<Record<K, OutputKind>>): Evaluation<K, S>;
  export function runExact<K extends string, S>(chain: Chain<K, S>): { run: ChainRun<K, S>; trace: … };
  ```
  `input` ids are rounding points like `read` ids (same repeated-id, step and finiteness checks; pinned with them).
  The conservative search starts from a **baseline run** (every `input` at its conservative value, nothing rounded):
  its reads give the off-step ids for the single-point tests, and it is the first conservative run in `cellOf`'s run
  order. `trace` stays the exact pass. `runs` counts the baseline.
- Produces (`data/figure-set.ts`): `export type FigureSet = Readonly<Record<string, FigureFile>>;`
  `export function figure(set: FigureSet, id: string): FigureFile` (a missing id throws: a data defect).
- Produces (`read/interp.ts`): `interpWithin(points, x, tolerance, span)`: the tolerance applies at an end of
  `points` only when that end lies within `tolerance` of the same end of `span` (Q2's default); `span` is the
  family's drawn input span the caller already computes.

- [ ] **Step 1: Write the failing `ctx` tests** in `tests/ctx.test.ts`:
  - `side data follows the deciding run`: a synthetic chain whose side is `{ branch: x < 2.5 ? 'low' : 'high' }` with
    `x = ctx.read('x', 2.46, 0.1)` and output `distance = x * 1000`: `exactSide.branch === 'low'`,
    `conservativeSide.branch === 'high'` (x rounded up to 2.5).
  - `side of an errored conservative run`: the run that errored is the side returned.
  - `input reads exact in the exact pass and conservative in every other`: chain `d = ctx.input('di', {exact: -4,
    conservative: 4}, 1)`, output `distance = 100 + d`: exact 96, conservative 104; `roundingPoints` contains `di`.
  - `baseline run without off-step points`: the same chain with every value on its step: `runs === 1`, conservative
    104.
  - `input twice in one run throws` (chain defect message as for `read`).
- [ ] **Step 2: Write the failing `read` tests** in `tests/read.test.ts`:
  - `an output-edge end gets no tolerance`: B2-3 `gw` panel, GW 48, a takeoff factor 0.001 × span past the GW 48
    curve's last drawn input: `OutOfChart` on `takeoff_factor`; the same at the last drawn input reads 12.0 (×1000 ft)
    within 1e-9.
  - `an input-axis end keeps the tolerance`: B2-1 at −39.9996 °C reads as before; a guideline line ending at
    19.989 kt reads at 20 kt.
  - `a short line inside its family gets no tolerance`: B2-6 sheet 3's tailwind line from 60 KIAS (ends 18.75 kt):
    an entry on it at 18.76 kt is `OutOfChart`.
- [ ] **Step 3: Run** `nice -n 19 node --test tests/ctx.test.ts tests/read.test.ts`. Expected: FAIL (new API, new
  edge rule).
- [ ] **Step 4: Implement** the `ctx.ts` changes, `figure-set.ts` and the `read/` change. `cellOf` returns the index
  of the deciding run so the side is that run's. Update `bound.ts` (`planCtx` gains `input`, reading
  `conservative`), `exhaustive.ts` (same; side of the deciding combination) and every existing chain in the tests to
  the `{ outputs, side: null }` shape.
- [ ] **Step 5: Run** `nice -n 19 node --test tests/ctx.test.ts tests/read.test.ts tests/figures.test.ts
  tests/sample-problems.test.ts tests/checkpoints.test.ts tests/figure-b2-4.test.ts tests/figure-refusal.test.ts
  tests/figure-landing.test.ts`. Expected: PASS. A sample or checkpoint that fails under the new edge rule is not
  fixed by loosening it: stop and report the panel and end to the supervisor (Q2).
- [ ] **Step 6: Commit** — `git commit -m "feat(perf): ctx side data, two-valued inputs, baseline run; edge tolerance on input-axis ends only (TOLD 1.7)"`.

### Task 3: Inputs (`inputs/`)

**Files:**
- Create: `perf/src/core/inputs/inputs.ts`, `perf/src/core/inputs/parse.ts`, `perf/src/core/inputs/derive.ts`
- Test: `perf/tests/inputs.test.ts`, `perf/tests/pressure-altitude-parity.test.ts`

**Interfaces:**
- Produces (`inputs.ts`):
  ```ts
  export interface Inputs {               // every field as typed
    takeoffGwLb: string; landingGwLb: string; cgPct: string; additionalDragIndex: string;
    runway: string; headingDeg: string; lengthFt: string; nearElevFt: string; farElevFt: string;
    altimeterInHg: string; tempC: string; wind: string; rcrDry: string; rcrWet: string;
  }
  export type InputField = keyof Inputs;
  export const DEFAULT_INPUTS: Inputs;   // cgPct '35', rcrDry '23', rcrWet '18', additionalDragIndex '0', the rest ''
  ```
  The loadout is not in `Inputs`; it is Task 4's `Loadout`, passed beside it.
- Produces (`parse.ts`):
  ```ts
  export type Field<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };
  export interface Wind { readonly directionDeg: number; readonly speedKt: number; readonly gustKt: number | null }
  export function parseNumber(text: string): Field<number>;   // "37,240", "-12", "29.92"; thousands commas, no units
  export function parseWind(text: string): Field<Wind>;       // "230/08", "230/08G15", "230 / 08 G15"
  ```
  Limits (1.7): length > 0, heading 1–360, altimeter > 0, wind direction 1–360, gust ≥ steady speed. Nothing else.
- Produces (`derive.ts`):
  ```ts
  export type Derived<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly fields: readonly InputField[] };
  export interface DerivedInputs {
    paFt: Derived<number>; tempC: Derived<number>; takeoffGwLb: Derived<number>; landingGwLb: Derived<number>;
    cgPct: Derived<number>; headwindKt: Derived<number>; crosswindKt: Derived<number>; gustKt: Derived<number | null>;
    slopePct: Derived<number>; runwayFt: Derived<number>; rcrDry: Derived<number>; rcrWet: Derived<number>;
  }
  export function pressureAltitudeFt(fieldElevFt: number, altimeterInHg: number): number;
  export function slopePercent(nearElevFt: number, farElevFt: number, lengthFt: number): number;
  export function windComponents(wind: Wind, headingDeg: number): { headwindKt: number; crosswindKt: number };
  export function deriveInputs(inputs: Inputs): DerivedInputs;
  ```
  `pressureAltitudeFt` = `fieldElevFt + 145442 * (1 - (altimeterInHg / 29.921) ** 0.190263)`, with the constants
  as named exports `ISA_P0_INHG = 29.921` and `ISA_INV = 0.190263`; inHg lives only in this function. PA uses the
  near-end threshold. `crosswindKt` is signed (> 0 from the right) and uses the gust when there is one; `headwindKt`
  the steady wind. A derived field that does not compute lists the input fields it needs.

- [ ] **Step 1: Write the failing tests** in `tests/inputs.test.ts`:
  - `parseNumber`: `"37,240"` → 37240, `" 29.92 "` → 29.92, `"-12"` → −12; `""`, `"abc"`, `"1.2.3"`, `"12ft"` → not ok.
  - `parseWind`: `"230/08"` → {230, 8, null}; `"230 / 08 G15"` → {230, 8, 15}; `"230/15G08"` (gust below), `"000/05"`,
    `"361/05"`, `"230"`, `"230/"` → not ok.
  - `pressureAltitudeFt(2000, 29.921)` → 2000 (within 1e-6); `(0, 30.92)` → −912 ± 2 (hand-worked); `(5000, 28.92)`
    → 5939 ± 2 (hand-worked).
  - `slopePercent(1000, 1040, 5000)` → 0.8; downhill negative.
  - `windComponents` (Review Focus 2): `{360,10,null}` on heading 1 → headwind 10 ± 0.01; `{180,10,null}` on 360 →
    headwind −10; `{90,10,null}` on 360 → headwind 0 ± 1e-9, crosswind +10 (from the right); `{270,10,null}` on
    360 → crosswind −10; `{230,8,15}` on 220 → headwind 8·cos 10° and crosswind
    15·sin 10°.
  - `deriveInputs` on an empty `landingGwLb`: `landingGwLb` not ok with `fields: ['landingGwLb']`, every other ok;
    an unparseable `altimeterInHg`: `paFt` not ok listing `altimeterInHg`.
- [ ] **Step 2: Write** `tests/pressure-altitude-parity.test.ts`: `createRequire` loads `crc-sync/src/altimetry.js`;
  `ISA_P0 / 3386.389` equals `ISA_P0_INHG` within 0.001 and `ISA_INV` equals `ISA_INV` within 1e-6.
- [ ] **Step 3: Run** both files. Expected: FAIL (modules missing).
- [ ] **Step 4: Implement** `inputs.ts`, `parse.ts`, `derive.ts`.
- [ ] **Step 5: Run** both files. Expected: PASS.
- [ ] **Step 6: Commit** — `git commit -m "feat(perf): TOLD inputs: parsing, pressure altitude, slope, wind components (TOLD 1.7)"`.

### Task 4: Drag index builder (`dragindex/`)

**Files:**
- Create: `perf/src/core/dragindex/catalogue.ts`, `perf/src/core/dragindex/racks.ts`,
  `perf/src/core/dragindex/loadout.ts`
- Test: `perf/tests/dragindex.test.ts`

**Interfaces:**
- Consumes: Task 2's `FigureSet`; `tableCell` / table panels of `B1-1.sh1` to `B1-1.sh7`.
- Produces (`catalogue.ts`):
  ```ts
  export type Station = '1' | '2' | '3' | '4' | '5' | '5L' | '5R' | '6' | '7' | '8' | '9';
  export interface DragValue { readonly subsonic: number; readonly supersonic: number | null; readonly note: '' | '*' | '**'; readonly printed: string }
  export interface StoreRow { readonly key: string; readonly sheet: number; readonly group: string | null; readonly name: string;
    readonly stations: readonly Station[]; readonly rack: string; readonly drag: DragValue }
  export interface SuspensionRow { readonly name: string; readonly stations: readonly Station[]; readonly drag: DragValue }
  export interface Catalogue { readonly basic: DragValue; readonly stores: readonly StoreRow[]; readonly suspensions: readonly SuspensionRow[] }
  export function parseStations(text: string): Station[];      // "2,3,7, OR 8" → ['2','3','7','8']
  export function parseDrag(cell: string | number): DragValue; // 4, "13/8", "4*", "2**", "4/2"; anything else throws
  export function buildCatalogue(figures: FigureSet): Catalogue;
  export function storesFor(cat: Catalogue, stations: readonly Station[]): StoreRow[];       // rows allowed on every station
  export function suspensionsFor(cat: Catalogue, store: StoreRow, stations: readonly Station[]): SuspensionRow[];
  ```
  `StoreRow.key` is stable across data versions: `` `${sheet}|${group ?? ''}|${name}|${stations text}` ``. A tank
  group (`… TANK (EMPTY/FULL):`) is one store whose variant `loadout.ts` picks.
- Produces (`racks.ts`): `RACK_SUSPENSIONS: Readonly<Record<string, readonly string[]>>` (every B1-1 rack string → the
  sheet 2 item names that carry it; `NONE` → `[]`) and `capacity(suspensionName: string): number` (Q3).
- Produces (`loadout.ts`):
  ```ts
  export interface LoadoutRow { readonly stations: readonly Station[]; readonly storeKey: string | 'noTipMissile' | null;
    readonly suspension: string | null; readonly count: number }
  export type Loadout = readonly LoadoutRow[];   // default: pairs 1/9, 2/8, 3/7, 4/6, then 5, 5L, 5R, all empty
  export interface DragLine { readonly row: LoadoutRow; readonly count: number; readonly eachExact: number; readonly eachConservative: number;
    readonly suspension: SuspensionRow | null; readonly notes: readonly string[] }
  export function dragIndex(cat: Catalogue, loadout: Loadout, additional: number):
    { readonly exact: number; readonly conservative: number; readonly lines: readonly DragLine[] };
  ```
  Rules as the decisions of 29 Oct 2026 and the mockup's script: subsonic value; tip AIM-9 (`4*`) adds 0; tip pod
  (`2**`) is its value minus 4; `noTipMissile` −4 each exact, 0 conservative; a tank variant from the store inboard
  (4 from 3, 6 from 7: none, AIM-9s, single, multiple; centreline from 4 and 6 both loaded); suspension default the
  smallest that carries the count, count capped at capacity × stations; one suspension per station.

- [ ] **Step 1: Write the failing tests** in `tests/dragindex.test.ts`:
  - `every B1-1 row parses` (stations and drag of every store and suspension row).
  - `parseDrag`: `"13/8"` → {13, 8, ''}; `"4*"` → {4, null, '*'}; `"2**"` → {2, null, '**'}; `"x"` throws.
  - `racks table both ways`: every rack string in sheets 3 to 7 is a key of `RACK_SUSPENSIONS`; every name in it is a
    sheet 2 row.
  - `worked example`: 1/9 AIM-9L, M, S on LAU-129/A LAUNCHER; 2/8 AIM-9L, M, S (2,3,7, OR 8) on LAU-129/A LAUNCHER +
    ADAPTER (16S301); 3/7 MK 84 LDGP on WEAPON PYLON* (16S1700); 4/6 370-GALLON TANK: store lines sum 142, total
    146 exact and conservative; each line as the questioner's Q4 gives it.
  - `no tip missile`: 1/9 `noTipMissile`, nothing else: exact −4 (4 − 8), conservative 4.
  - `tank variants`: 370 at 4/6 with nothing at 3/7 → 27 each; AIM-9s at 3/7 → 27; one MK 84 per station → 35; a TER
    with three → 39; 300-gallon at 5 with 4 and 6 loaded → 18, else 15.
  - `count capped by capacity`: 4 MK 82 at 3/7 on a WEAPON PYLON is capped at 2; on a TER the default suspension
    for 6 is the TER.
- [ ] **Step 2: Run** `nice -n 19 node --test tests/dragindex.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `catalogue.ts`, `racks.ts`, `loadout.ts`.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(perf): drag index builder on Fig. B1-1 (TOLD 1.7)"`.

### Task 5: Refusal speed by RCR and the takeoff chain

**Files:**
- Create: `perf/src/core/told/rcr.ts`, `perf/src/core/told/takeoff.ts`
- Modify: `perf/src/core/figures/b2-5.ts`, `b2-6.ts` (`decreased()` moves to one place, `refusal-speed.ts`);
  `perf/src/core/figures/b2-4.ts` (its out-of-chart loop never adds 0 ft)
- Test: `perf/tests/told-rcr.test.ts`, `perf/tests/told-takeoff.test.ts`

**Interfaces:**
- Consumes: Task 2's `Chain`, `evaluate`, `FigureSet`, `figure`; Task 1's names; the figure functions as they are.
- Produces (`rcr.ts`):
  ```ts
  export function refusalByRcr(ctx: Ctx, figures: FigureSet, mode: 'mil' | 'ab', surface: 'dry' | 'wet',
    rcr: number, i: RefusalInputs): Read<number>;
  ```
  MIL reads B2-5, MAX AB B2-6. Dry: printed 23 and 16 (sheet 1), 8 and 4 (sheet 3); wet: 18 and 12 (sheet 2). On a
  printed value only that sheet is read; between two, linear in RCR over the bracketing pair, then
  `ctx.read('<b2-5|b2-6>.<dry|wet>', v, STEPS.speedKt)` (always read, on a printed value too). Outside the family
  (ruling 1): `outOfChart(<the sheet's figure id>, 'rcr', rcr, [lo, hi])` with [4, 23] dry, [12, 18] wet.
- Produces (`takeoff.ts`):
  ```ts
  export type TakeoffKey = 'rotation' | 'takeoffSpeed' | 'distance' | 'accelCheck' | 'refusalDry' | 'refusalWet';
  export const TAKEOFF_KINDS: Readonly<Record<TakeoffKey, OutputKind>>;  // speed, speed, distance, accelCheckSpeed, refusalSpeed ×2
  export interface TakeoffValues { paFt: number; tempC: number; grossWeightLb: number; cgPct: number;
    dragIndex: { exact: number; conservative: number }; headwindKt: number; slopePct: number; runwayFt: number; rcrDry: number; rcrWet: number }
  export interface TakeoffSide { readonly checkDistanceFt: 1000 | 2000 | null }
  export const TAKEOFF_FIELDS: readonly (keyof DerivedInputs)[];  // what the chain needs (Task 7 uses it)
  export function takeoffChain(figures: FigureSet, v: TakeoffValues, mode: 'mil' | 'ab'): Chain<TakeoffKey, TakeoffSide>;
  ```
  Reads first `input.pa`, `input.temp`, `input.gw`, `input.cg`, `input.di` (`ctx.input`), `input.wind`,
  `input.slope`, `input.rcr_dry`, `input.rcr_wet` (1.7's `input.rcr` split in two: a takeoff column reads both RCRs), then B2-1 → B2-2 → B2-3 → B2-4 → refusal dry → refusal wet.
  MIL uses `tofMil` and `vrMilKias`, MAX AB `tofAb` and `vrAbKias`; `pitch8: false`. A CG outside B2-3's `cg` panel
  drawn range (computed from the data, 30 to 40) makes `rotation` and `takeoffSpeed` `outOfChart('B2-2', 'cg', cg,
  range)`. Check distance: 1,000 ft when this run's `distance` is under 2,500 ft, else 2,000; a distance out of chart
  makes `accelCheck` that error and `checkDistanceFt` null. Refusal `runwayFt` is the length available.

- [ ] **Step 1: Write the failing `rcr` tests** in `tests/told-rcr.test.ts` (B2-5 and B2-6, inputs of the B2-6
  sheet 1 sample):
  - at RCR 23, 16, 18, 12, 8, 4 each equals the sheet function's value; RCR 16 reads no `sh3` id, RCR 8 no `sh1` id.
  - dry 17.5 = linear between 16 and 23; dry 12 = midway between sheet 1's RCR 16 and sheet 3's snow RCR 8.
  - wet 11, wet 19, dry 24, dry 3.5 → `OutOfChart` on `rcr` with [12, 18] or [4, 23].
- [ ] **Step 2: Write the failing takeoff tests** in `tests/told-takeoff.test.ts`:
  - `rounding points pinned`: the exact pass's ids for MIL and for MAX AB, each a literal list.
  - `samples through the chain`: inputs of the B2-3 sample give its distance within 2 %, B2-4's 129 KIAS within 2 %,
    B2-6 sheet 1's 153 KIAS (MAX AB) within 2 %, each where the sample's own inputs fit the chain.
  - `conservative no better than exact` for every output, and within the 5.2 criterion (`singlePointBound`) of
    `evaluateExhaustive` on a reduced chain where that is feasible.
  - `check distance branch` (Review Focus 1): inputs whose exact distance is just under 2,500 ft whose conservative
    run crosses it: on the `accelCheck` cell, `exactSide.checkDistanceFt === 1000`, `conservativeSide.checkDistanceFt === 2000`; exactly
    2,500 ft gives 2,000.
  - `CG 41` → rotation and takeoffSpeed `OutOfChart` on `cg` naming B2-2 with range [30, 40] (± tolerance of the data).
  - `negative exact drag index` (Review Focus 3): as the questioner's Q1 rules.
  - `B2-4 out of chart adds nothing` (deferred minor): the out-of-chart path returns the panel's error, no `+ 0`.
- [ ] **Step 3: Run** both files. Expected: FAIL.
- [ ] **Step 4: Implement** `rcr.ts`, `takeoff.ts`; move `decreased()` into `refusal-speed.ts` as an export used by
  `b2-5.ts` and `b2-6.ts`; the B2-4 loop fix.
- [ ] **Step 5: Run** both files plus `tests/figure-refusal.test.ts tests/figure-b2-4.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** — `git commit -m "feat(perf): takeoff chain and refusal speed by RCR (TOLD 1.7 ruling 1)"`.

### Task 6: The landing chain

**Files:**
- Create: `perf/src/core/told/landing.ts`
- Test: `perf/tests/told-landing.test.ts`, `perf/tests/figure-landing.test.ts` (the deferred B7-2 sheet 2 test)

**Interfaces:**
- Consumes: Task 2's `Chain`, `evaluate`, `FigureSet`; `landingSpeed`, `groundRollUncorrected`,
  `groundRollCorrected`, `LimitVerdicts`.
- Produces:
  ```ts
  export type LandingKey = 'finalApproach' | 'touchdown' | 'distance';
  export const LANDING_KINDS: Readonly<Record<LandingKey, OutputKind>>;   // speed, speed, distance
  export interface LandingValues { paFt: number; tempC: number; grossWeightLb: number; headwindKt: number; slopePct: number; rcr: number }
  export interface LandingSide { readonly limits: LimitVerdicts | null }
  export const LANDING_FIELDS: Readonly<Record<'normal' | 'heavy', Readonly<Record<'dry' | 'wet', readonly (keyof DerivedInputs)[]>>>>;
  export function landingChain(figures: FigureSet, v: LandingValues, surface: 'dry' | 'wet'): Chain<LandingKey, LandingSide>;
  ```
  The weight (normal: landing GW, heavy: takeoff GW) and the RCR (dry or wet input) are chosen by the caller (Task 7)
  into `LandingValues`. Reads `input.pa`, `input.temp`, `input.gw`, `input.rcr`, `input.wind`, `input.slope`, then
  B7-1, B7-2 sheet 1 (`limits` into side), B7-2 sheet 2 with `wet: surface === 'wet'`.

- [ ] **Step 1: Write the failing tests** in `tests/told-landing.test.ts`:
  - `rounding points pinned` (literal list, dry and wet).
  - `samples through the chain`: B7-1 136 / 125 KIAS and B7-2 3,375 ft (RCR 16, dry) within 2 % with the samples'
    inputs.
  - `exhaustive oracle`: for the dry and the wet chain on two input sets, `evaluate` equals `evaluateExhaustive` per
    output, or lies within the 5.2 criterion where they differ (say which in the test name).
  - `limits per run`: 6,000 ft / 40 °C / 44,000 lb gives `exactSide.limits.brakeEnergy === true`; the sheet 1 sample
    (2,000 ft, 40 °C, 28,000 lb) gives brake energy `false` and both tire lines `null`; a case near a line where the
    conservative run is beyond and the exact is not: `exactSide` false, `conservativeSide` true.
  - `wet RCR 9` → `distance` `OutOfChart` on `rcr` (wet family 10 to 18).
- [ ] **Step 2: Add the deferred test** in `tests/figure-landing.test.ts`: a B7-2 sheet 2 roll above 11,000 ft with a
  tailwind gives `OutOfChart` on the wind panel's output; the same with a downhill slope on the slope panel's.
- [ ] **Step 3: Run** both files. Expected: FAIL (`landing.ts` missing).
- [ ] **Step 4: Implement** `landing.ts`.
- [ ] **Step 5: Run** both files. Expected: PASS.
- [ ] **Step 6: Commit** — `git commit -m "feat(perf): landing chain with limit verdicts per run (TOLD 1.7 ruling 2)"`.

### Task 7: Rules and `computeTold`

**Files:**
- Create: `perf/src/core/told/rules.ts`, `perf/src/core/told/told.ts`
- Test: `perf/tests/told-rules.test.ts`, `perf/tests/told.test.ts`

**Interfaces:**
- Consumes: Tasks 3 to 6 (`deriveInputs`, `DerivedInputs`, `buildCatalogue`, `dragIndex`, `Loadout`,
  `takeoffChain`, `landingChain`, their `*_KINDS` and `*_FIELDS`).
- Produces (`rules.ts`):
  ```ts
  export type RuleId = 'mil-roll-50' | 'takeoff-roll-80' | 'landing-roll-80' | 'landing-rcr-10' | 'b7-2-limit';
  export interface RuleMark { readonly rule: RuleId; readonly paragraph: string; readonly cell: 'exact' | 'conservative';
    readonly percent?: number; readonly line?: keyof LimitVerdicts }
  export const RULES: readonly { id: RuleId; paragraph: string }[];   // '3.6.6', '3.6.3', '3.18', '3.18', 'Fig. B7-2 sh. 1'
  export function runwayUsedPct(distanceFt: number, runwayFt: number): number;
  export function takeoffMarks(mode: 'mil' | 'ab', cell: Cell<TakeoffSide>, runwayFt: number): RuleMark[];
  export function landingMarks(cell: Cell<LandingSide>, runwayFt: number, rcr: number): RuleMark[];
  ```
- Produces (`told.ts`):
  ```ts
  export type ToldCell<S> = { readonly kind: 'computed'; readonly cell: Cell<S>; readonly marks: readonly RuleMark[] }
    | { readonly kind: 'unparsed'; readonly fields: readonly InputField[] };
  export interface ToldColumn<K extends string, S> { readonly cells: Readonly<Record<K, ToldCell<S>>>;
    readonly trace: Evaluation<K, S>['trace']; readonly reasons: readonly { cell: 'exact' | 'conservative'; error: OutOfChart }[] }
  export interface Told {
    readonly dragIndex: ReturnType<typeof dragIndex>;
    readonly takeoff: Readonly<Record<'mil' | 'ab', ToldColumn<TakeoffKey, TakeoffSide>>>;
    readonly landing: Readonly<Record<'normal' | 'heavy', Readonly<Record<'dry' | 'wet', ToldColumn<LandingKey, LandingSide>>>>>;
    readonly rcrMarks: readonly RuleMark[];   // 3.18 RCR below 10, on the input
  }
  export function computeTold(figures: FigureSet, inputs: Inputs, loadout: Loadout): Told;
  ```
  `reasons` holds one entry per distinct `(figure, input, value, drawnRange, cell)` in a column; plan 3 groups them
  per table. Runway used % is not a rounding point. The marks of 1.7's rule table, each on exact and conservative
  separately; `percent` is the runway used the mark cites.

- [ ] **Step 1: Write the failing rules tests** in `tests/told-rules.test.ts`:
  - thresholds: MIL 50.0 % no mark, 50.01 % `mil-roll-50` (3.6.6); AB 50.01 % none; any takeoff 80.0 % none,
    80.01 % `takeoff-roll-80`; landing 80.0 % none, 80.01 % `landing-roll-80`.
  - exact under and conservative over: one mark, `cell: 'conservative'`.
  - `landing-rcr-10`: RCR 9.5 marks, 10 does not.
  - `b7-2-limit`: a `true` verdict in `conservativeSide` marks only the conservative cell; `null` marks nothing.
- [ ] **Step 2: Write the failing `computeTold` tests** in `tests/told.test.ts`:
  - the mockup's field (runway 5,900 ft, thresholds 2,000 / 2,047 ft, 29.92 inHg, 38 °C, `230/08G15`, heading 210,
    takeoff GW 37,240, landing GW 28,000, the worked example loadout): every cell computed or `OutOfChart` with a
    reason, no exception; takeoff MIL distance > 50 % gives `mil-roll-50`.
  - Review Focus 4: `landingGwLb: ''` → both normal columns `unparsed` with `fields: ['landingGwLb']`; every other
    column computed.
  - Review Focus 5: RCR dry `'9.5'` → `rcrMarks` holds `landing-rcr-10`.
  - `reasons` has no duplicates when exact and conservative fail for the same reason in two cells of one column.
- [ ] **Step 3: Run** both files. Expected: FAIL.
- [ ] **Step 4: Implement** `rules.ts`, `told.ts`.
- [ ] **Step 5: Run** both files. Expected: PASS.
- [ ] **Step 6: Commit** — `git commit -m "feat(perf): runway rules and computeTold (TOLD 1.7)"`.

### Task 8: Close-out

**Files:**
- Modify: `docs/wip/TOLD.md` (1.1 status, 1.5 the core box, 1.7 "Status: built"), `perf/README.md` (layout of
  `inputs/`, `told/`, `dragindex/`; the new commands if any), `docs/wip/TOLD-HANDOFF.md`, this plan (rulings and
  supervisor rulings during execution)
- Regenerate: nothing unless the full re-extraction changes a file

- [ ] **Step 1: Full re-extraction** with no ids. Expected: byte-identical to the merged data (`dataVersion` 8).
- [ ] **Step 2: All gates** (`nice -n 19`): `npm test` (expect 100 % lines on `src/core/`), `typecheck`, `lint`,
  `format:check`, `types:check`, `data:check` (0 problems), `build`. Record the test count.
- [ ] **Step 3: Docs**: 1.7 status and anything the build changed from the spec; the Limitations notes plan 2 adds
  (ruling 1's wet RCR range, ruling 4's output-edge ends, Q1's ruling); the handoff with plan 3 as next.
- [ ] **Step 4: Trial merge** of the tip into `main` (no commit). Expected: clean.
- [ ] **Step 5: Commit** — `git commit -m "docs(perf): step 1 plan 2 done"`.
