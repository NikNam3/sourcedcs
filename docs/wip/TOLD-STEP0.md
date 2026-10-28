# TOLD Step 0: Foundations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `perf/` app's foundations: a spec-driven extractor that turns Figures B1-1 and B2-1 to B2-3 of the manual into checked, versioned JSON, a TypeScript core whose building blocks and read context reproduce the manual's sample problems, the design stylesheet, CI, and the ADRs.

**Architecture:** One-way data flow PDF → `perf/extraction/` (Python, run by hand) → `perf/data/f16c-f110-129/` (JSON + page PNGs + manifest, committed) → `perf/src/core/` (pure TS) → `perf/src/web/` (step 1). A JSON Schema is the contract between the Python and TS halves; CI checks the committed data against it and never extracts.

**Tech Stack:** TypeScript (tsc only, native ESM), Node ≥ 22.18 `node --test` on `.ts`, ESLint typescript-eslint `strictTypeChecked`, Prettier, Ajv (draft-07), json-schema-to-typescript, `yaml`; Python 3 with PyMuPDF, PyYAML, Pillow from `flake.nix`.

**Spec:** `docs/wip/TOLD.md` (the source of truth; this plan argues from it). Read it before your task, at least "Architecture and repository", "Step 0", "Calculation core and conservative rounding", "Design system and UI" and "Validation and testing".

## Global Constraints

- Work only in `/home/nklx/dev/personal/sourcedcs-perf` on branch `perf-told`. Never change the branch of `/home/nklx/dev/personal/sourcedcs` (a crc session works there on `main`).
- Every test run is `nice -n 19`. Lanes run only the test file of their task; the supervisor runs the full gates.
- Node ≥ 22.18 (this machine: 22.22). `node --test` runs `.ts` directly; no bundler, no framework, no `ts-node`/`tsx`.
- tsconfig: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `module`/`moduleResolution` `nodenext`, `rewriteRelativeImportExtensions`, `allowImportingTsExtensions`. Relative imports carry the `.ts` extension.
- ESLint: typescript-eslint `strictTypeChecked` with `strict-boolean-expressions`, `switch-exhaustiveness-check`, `no-unnecessary-condition` as errors. 0 kt, 0 %, DI 0 are valid values: never test a number for truthiness.
- `src/core/` has no DOM, no `fetch`, no `node:` imports, no I/O. Chart data is passed in.
- Units in names (`lengthFt`, `windKt`, `grossWeightLb`).
- Building blocks never extrapolate and never throw for an input outside a chart: they return `OutOfChart {figure, input, value, drawnRange}`.
- The manual PDF is never committed (`perf/**/*.pdf` is already gitignored). Its path is the env var `PERF_PDF`. SHA-256 pin: `7954f2391a66bffc79d77027cdb5063a332ba31a693dba1e42f0a67b276c791b`.
- Python runs as `python3 -I`, inside `nix develop` from the worktree root. `extraction/` gets no type checker, lint or pytest: only its asserts.
- Files in `perf/data/` are written only by the extractor. Never hand-edit them; re-run the extractor.
- ADR numbers 0148–0153 are claimed by this work. Before perf-told merges, renumber if `main` has taken any of them.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A value exactly on a drawn boundary** (GW exactly 48,000 lb, PA exactly 10,000 ft, TOF exactly 7) is inside the chart and must read, not give `OutOfChart`. Pinned in Task 3.
2. **Float steps:** 3.16 rounded down to 0.01 must stay 3.16, not 3.15 (3.16 / 0.01 = 315.99999…). Pinned in Task 4.
3. **Negative and signed inputs:** PA −1,000 ft and −10 °C on B2-1 read normally; a tailwind (negative `headwindKt`) uses the tailwind family and lengthens the distance. Pinned in Tasks 3 and 9.
4. **Zero inputs skip their panel:** slope 0, wind 0 leave the distance unchanged; DI 0 and CG 35 are the baselines and read back the entry value. Pinned in Task 9.
5. **Re-running the extractor with nothing changed** gives byte-identical data files and the same `dataVersion`. Pinned in Task 6.

## Execution notes for the supervisor

- **Before Task 6:** the human puts the manual PDF on this machine outside the repo (suggested `/home/nklx/dev/manuals/`) and gives the path; export it as `PERF_PDF` for every extraction lane.
- **Task 8 ends at a human checkpoint:** the human compares the printed-back B1-1 tables against the pages once.
- Batches (≤ 4 agents at once: three implementers plus the questioner; every subagent on Opus 5.5): **A** Tasks 1, 6, 11 · **B** Tasks 2, 7, 10 · **C** Tasks 3, 4, 5 · **D** Tasks 8, 9 · **E** Task 12. Task 3 needs Task 2's types; Task 9 needs Tasks 3, 4, 5 and the data of 6 and 7; Task 8 needs only Task 6; Task 2's test validates Task 6's data.
- Step 0 has no UI, so the Playwright smoke spec and the pressure-altitude parity test (TOLD.md 0.1 CI list) arrive in step 1 with `inputs/` and the pages; the workflow's path filter already names `crc-sync/src/altimetry.js`.

---

## Data contract (read by Tasks 2, 4, 6, 7, 8, 9)

One file per figure sheet: `perf/data/f16c-f110-129/<id>.json`, where `<id>` is the figure (`B2-3`) or figure and sheet (`B1-1.sh1`). TypeScript-style shape; Task 2 writes it as JSON Schema draft-07 with `additionalProperties: false` everywhere.

```ts
type Pt = [number, number];                       // [input, output], both in chart units
interface Quantity { name: string; unit: string }  // unit "" when dimensionless
interface Transform { page: 'x' | 'y'; a: number; b: number }   // pagePt = a * value + b

interface FigureFile {
  schemaVersion: 1;
  id: string;  figure: string;  sheet: number | null;
  title: string;  engine: string;
  pageIndex: number;  printedPage: string;
  image: { file: string; clipPt: [number, number, number, number]; pxPerPt: number };  // file: "pages/<id>.png"
  corrections: string[];          // printed corrections, verbatim from the spec, for the figure view
  panels: Panel[];                // reading order
}
type Panel = CurveFamily | SingleCurve | GuidelinePanel | ScalePair | Table;
interface CurveFamily { id: string; type: 'curve_family'; input: Quantity; output: Quantity; param: Quantity;
  curves: { param: number; points: Pt[] }[];      // sorted by param; points sorted by input, ascending
  axes: Record<string, Transform> }                // keyed by quantity name
interface SingleCurve { id: string; type: 'single_curve'; input: Quantity; output: Quantity; points: Pt[]; axes: Record<string, Transform> }
interface GuidelinePanel { id: string; type: 'guideline_panel'; input: Quantity; output: Quantity; baseline: number;
  families: Record<string, Pt[][]>;                // e.g. {all}, {uphill, downhill}, {headwind, tailwind}; each line [param, output], sorted by param
  axes: Record<string, Transform> }
interface ScalePair { id: string; type: 'scale_pair'; from: Quantity; to: Quantity; a: number; b: number; axes: Record<string, Transform> }  // to = a * from + b
interface Table { id: string; type: 'table'; columns: Quantity[]; rows: (number | string | null)[][] }
```

`perf/data/f16c-f110-129/manifest.json`:

```ts
interface Manifest { schemaVersion: 1; dataset: string; dataVersion: number; pdfSha256: string;
  extractorCommit: string;              // the commit that last produced the data: `git rev-parse --short HEAD`, suffix "-dirty" if perf/extraction/ has uncommitted changes; kept unchanged by a re-run that changes no file hash
  files: Record<string, string> }       // path relative to the dataset dir -> sha256 hex, every .json (not the manifest) and pages/*.png
```

`dataVersion` starts at 1 and the extractor increments it only when any file hash differs from the previous manifest.

**Curve labels (curve_family):** the printed parameter labels are vector glyphs, not text, so a spec declares each value's position instead (`labels`). The extractor assigns values to curves by these anchors: each anchor's nearest curve (distance to its polyline) must be within 3 pt and unique, every curve must get exactly one anchor, and only then is `order` checked, now against geometry it did not produce. An anchor matching no curve or two curves fails as a leftover label; a curve with no anchor fails as unlabelled (spec 0.3). Spec keys are checked: an unknown key at any level stops the run.

Numbers are rounded by the extractor: page transforms to 6 decimals, chart values to 4. JSON is written with sorted keys and `separators=(',', ':')` plus a trailing newline, so a re-run with nothing changed is byte-identical. `perf/data/` is in `.prettierignore`.

## Chart spec format (read by Tasks 6, 7, 8, 9)

One YAML file per data file, `perf/extraction/specs/<id>.yaml`. This replaces the `x_axis` + per-panel `y` shape of the TOLD.md 0.5 example: axes are named once and panels say which axis is their input and which their output (Task 6 updates the 0.5 example to this shape). All coordinates for B2-1 to B2-3 come from `perf/prototype/extraction/extract.py` and `imgs.py`.

```yaml
id: B2-3
figure: B2-3
sheet: null
dataset: f16c-f110-129
title: Takeoff Distance
engine: F110-GE-129
page_index: 285                 # 0-based
printed_page: B2-9
must_contain: ["Takeoff Distance", "F110"]
image_clip: [62, 120, 560, 712]
axes:                           # each calibrated once from its tick labels
  distance:       {unit: 1000 ft, page: x, label_band: [690, 697], range: [95, 545], ticks: [0, 2, 4, 6, 8, 10, 12], title: TAKEOFF DISTANCE, edge: bottom}
  takeoff_factor: {unit: "", page: y, label_band: [90, 100], range: [130, 360], ticks: [1, 2, 3, 4, 5, 6, 7], title: TAKEOFF FACTOR, edge: left}
  # snap: false where the prototype used it (B2-1's AB scale)
panels:
  - id: gw
    type: curve_family
    clip: [104.5, 135, 536.7, 353]
    frame: {x: [104.0, 536.2], y: [136.3, 352.4]}    # frame lines dropped
    input: takeoff_factor
    output: distance
    param: {name: gross_weight, unit: 1000 lb, values: [20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48]}
    labels: [[x, y], ...]      # one page point per value, in values order: a point on that curve beside its printed label, read off the render
    order: {output: rises, check_at: [1.2, 1.5, 2, 2.5]}   # output rises with param at each input
    monotonic: rises           # optional: each curve's output along its input
    filter: {min_points: 5}                                # prototype filters as keys: min_points, min_span_pt, stroke_width
  - id: slope
    type: guideline_panel
    clip: [...]
    frame: {...}
    input: slope
    output: distance
    baseline: 0
    families: {uphill: rises, downhill: falls}    # rises | falls | any; a line matching no family fails
    min_lines: 20
  # single_curve: input, output, monotonic: rises | falls
  # scale_pair: from: <axis>, to: <axis>
  # table: see Task 8
corrections: ["8 deg pitch attitude: distance x 1.18"]
sample_problems:
  - inputs: {takeoff_factor: 3.16, gross_weight_lb: 33000, cg_pct: 37, drag_index: 150, slope_pct: 1, headwind_kt: 10}
    expected: {distance_ft: 4243}
```

`perf/extraction/manual-errata.yaml`, a list:

```yaml
- figure: B7-2
  sheet: 2
  where: sample problem text
  printed: SEC 3,902 ft
  correct: PRI 3,902 ft
  reason: 3,902 ft is sheet 1's PRI distance; the SEC distance is 4,058 ft (x1.04)
  affects: null       # or {spec: <id>, sample: <index>, key: <expected key>, value: <number>} when it changes an expected value
```

---

### Task 1: perf package scaffold

**Files:**
- Create: `perf/package.json`, `perf/package-lock.json`, `perf/tsconfig.json`, `perf/tsconfig.build.json`, `perf/eslint.config.js`, `perf/.prettierrc.json`, `perf/.prettierignore`, `perf/src/core/result.ts`
- Modify: `.gitignore` (append `perf/extraction/out/`, `perf/web/js/`, `perf/node_modules/`)
- Test: `perf/tests/result.test.ts`

**Interfaces:**
- Produces (`src/core/result.ts`):
  ```ts
  export interface OutOfChart { readonly kind: 'outOfChart'; readonly figure: string; readonly input: string; readonly value: number; readonly drawnRange: readonly [number, number] | null }
  export type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: OutOfChart };
  export function ok<T>(value: T): Read<T>;
  export function outOfChart(figure: string, input: string, value: number, drawnRange: readonly [number, number] | null): Read<never>;   // null: no range, e.g. a table key not found
  ```
- Produces npm scripts: `build` (`tsc -p tsconfig.build.json`, `src/` → `web/js/`), `typecheck` (`tsc --noEmit`, covers `src/`, `tests/`, `scripts/`), `lint` (`eslint .`), `format:check` (`prettier --check .`), `test` (`node --test --experimental-test-coverage --test-coverage-include='src/core/**' --test-coverage-lines=90 'tests/**/*.test.ts'`). Task 2 adds `data:check`, `types:gen`, `types:check`.

- [ ] **Step 1:** `package.json` with `"type": "module"`, `"private": true`, `"engines": {"node": ">=22.18"}`; dev dependencies `typescript` (≥ 5.8), `@types/node`, `eslint`, `typescript-eslint`, `prettier`. `npm install` in `perf/`.
- [ ] **Step 2:** Write `tests/result.test.ts`: `ok(3)` equals `{ok: true, value: 3}`; `outOfChart('B2-3', 'gross_weight', 52, [20, 48])` equals `{ok: false, error: {kind: 'outOfChart', figure: 'B2-3', input: 'gross_weight', value: 52, drawnRange: [20, 48]}}`. Run `cd perf && nice -n 19 node --test tests/result.test.ts`: FAIL (module missing).
- [ ] **Step 3:** Write `src/core/result.ts`, the configs per Global Constraints. `.prettierignore`: `data/`, `web/js/`, `extraction/`, `package-lock.json`.
- [ ] **Step 4:** Run `cd perf && nice -n 19 npm test && npm run typecheck && npm run lint && npm run format:check`: all pass.
- [ ] **Step 5:** Commit `feat(perf): package scaffold, toolchain and Read/OutOfChart`.

### Task 2: JSON Schema, generated types, data:check

**Files:**
- Create: `perf/schema/charts.schema.json` (definitions `FigureFile`, `Manifest` and the panel types from the Data contract), `perf/scripts/gen-types.ts`, `perf/scripts/data-check.ts`, `perf/src/core/data/types.ts` (generated), `perf/tests/fixtures/data-ok/`, `perf/tests/fixtures/data-bad-*/`
- Modify: `perf/package.json` (dev deps `ajv`, `json-schema-to-typescript`; scripts)
- Test: `perf/tests/data-check.test.ts`

**Interfaces:**
- Consumes: Task 1's scaffold.
- Produces: `src/core/data/types.ts` exporting `FigureFile`, `Manifest`, `Panel`, `CurveFamily`, `SingleCurve`, `GuidelinePanel`, `ScalePair`, `Table`, `Quantity`, `Transform` exactly as the Data contract names them (set `title` in the schema so the generator emits these names). `scripts/data-check.ts` exports `checkDataset(dir: string): string[]` (problems, empty when clean) and runs it on every dataset under `data/` when executed, exiting 1 on any problem. npm scripts `types:gen` (`node scripts/gen-types.ts`), `types:check` (`node scripts/gen-types.ts --check`, exit 1 if the output differs from the committed file), `data:check` (`node scripts/data-check.ts`).

- [ ] **Step 1:** Write `tests/data-check.test.ts` with these cases, each a small fixture dataset:
  - `data-ok` (one `single_curve` figure, its page PNG, a matching manifest) → `[]`;
  - a figure with an unknown key → one problem naming the file and the key;
  - a figure hash differing from the manifest → one problem naming the file;
  - a data file missing from the manifest, and a manifest entry with no file → one problem each;
  - `types:check` on the committed `types.ts` → exit 0.
  Run it: FAIL.
- [ ] **Step 2:** Write the schema, `gen-types.ts`, `data-check.ts` (Ajv draft-07, `allErrors`); run `npm run types:gen`.
- [ ] **Step 3:** Run `cd perf && nice -n 19 node --test tests/data-check.test.ts`: PASS. If Task 6 has landed, also `npm run data:check` against the real data: no problems (a problem here is a Task 6 defect: report it, do not change the schema to fit).
- [ ] **Step 4:** Commit `feat(perf): chart data JSON Schema, generated types, data:check`.

### Task 3: Building blocks in `read/`

**Files:**
- Create: `perf/src/core/read/interp.ts`, `curve-family.ts`, `single-curve.ts`, `guideline-panel.ts`, `scale-pair.ts`, `table.ts`, `perf/src/core/data/panel.ts`
- Test: `perf/tests/read.test.ts`, `perf/tests/core-purity.test.ts`

**Interfaces:**
- Consumes: `Read`, `ok`, `outOfChart` (Task 1); panel types (Task 2).
- Produces:
  ```ts
  // interp.ts — linear; undefined outside [first input, last input]; points sorted by input
  export function interp(points: readonly (readonly [number, number])[], x: number): number | undefined;
  export function drawnRange(points: readonly (readonly [number, number])[]): [number, number];
  // panel.ts — throws Error (a data defect, not an input problem) when the id is missing or the type differs
  export function panel<T extends Panel['type']>(fig: FigureFile, id: string, type: T): Extract<Panel, { type: T }>;
  export function curveFamily(p: CurveFamily, figure: string, input: number, param: number): Read<number>;
  export function singleCurve(p: SingleCurve, figure: string, input: number): Read<number>;
  export function guidelinePanel(p: GuidelinePanel, figure: string, family: string, entry: number, target: number): Read<number>;
  export function scalePair(p: ScalePair, from: number): number;
  export function tableCell(p: Table, figure: string, key: Readonly<Record<string, string | number>>, column: string): Read<number | string>;
  ```
- Rules:
  - **curveFamily:** param outside `[first, last]` → `OutOfChart` on the param's name. Otherwise only the two bracketing curves (the last pair when param equals the last value) must cover `input`; else `OutOfChart` on the input, with their common range. Interpolate linearly in param.
  - **guidelinePanel:** a line is usable when it covers both baseline and target, within a tolerance of `BASELINE_TOLERANCE = 0.02` times the panel's param span (the prototype's value, for lines drawn a hair short of the baseline). Sort usable lines by their output at the baseline. An `entry` outside the outermost two → `OutOfChart` on `output.name`; fewer than two usable lines → `OutOfChart` on `input.name`. Otherwise follow the two bracketing lines to the target with the same fraction.
  - **tableCell:** exact match of every key column; no match or a null cell → `OutOfChart` on the column, `drawnRange` `null`.

- [ ] **Step 1:** Write `tests/read.test.ts` on synthetic panels built in the test:
  - `interp` at both endpoints returns the endpoint values; just outside returns `undefined`;
  - `curveFamily`: a param exactly equal to the last value reads (Review Focus 1); a negative param between −2 and 0 reads; outside gives `OutOfChart` with the right `input` and `drawnRange`; an input outside a non-bracketing curve but inside both bracketing ones reads;
  - `guidelinePanel`: entry exactly on a guideline at the baseline follows that line; entry between two lines interpolates; target equal to baseline returns entry; entry outside the outermost lines → `OutOfChart`; target beyond every line → `OutOfChart`;
  - `scalePair(p, 2)` with a=0.5, b=0.1 → 1.1;
  - `tableCell` hit, miss, null cell.
  Write `tests/core-purity.test.ts`: no file under `src/core/` contains `from 'node:`, `document`, `window`, `fetch(`, `localStorage`; and the test dynamically imports every `.ts` file under `src/core/`, so a module no test exercises still counts against the 90 % coverage floor (Node only counts loaded files). Also add an ESLint block in `eslint.config.js` for `files: ['src/core/**']`: `no-restricted-imports` with pattern `node:*`, and `no-restricted-globals` for `fetch`, `document`, `window`, `localStorage`, `process`, so lint catches what typecheck cannot (the shared tsconfig has Node types).
- [ ] **Step 2:** Run `cd perf && nice -n 19 node --test tests/read.test.ts tests/core-purity.test.ts`: FAIL.
- [ ] **Step 3:** Implement the files.
- [ ] **Step 4:** Run the same command: PASS. Commit `feat(perf): chart reading building blocks with OutOfChart`.

### Task 4: Read context, exact and conservative passes

**Files:**
- Create: `perf/src/core/ctx.ts`, `perf/tests/helpers/exhaustive.ts` (the exhaustive search, a test oracle only, never imported by `src/`)
- Test: `perf/tests/ctx.test.ts`

**Interfaces:**
- Consumes: `Read`, `OutOfChart` (Task 1).
- Produces:
  ```ts
  export interface Ctx { read(id: string, value: number, step: number): number }
  export type OutputKind = 'distance' | 'speed' | 'refusalSpeed' | 'accelCheckSpeed';
  export const WORSE: Readonly<Record<OutputKind, 'higher' | 'lower'>>;   // distance higher, speed higher, refusalSpeed lower, accelCheckSpeed higher
  export const STEPS: Readonly<{ pressureAltitudeFt: 100; temperatureC: 1; grossWeightLb: 100; dragIndex: 1; cgPct: 0.5;
    windKt: 1; slopePct: 0.1; rcr: 1; takeoffFactor: 0.01; speedKt: 1; distanceFt: 10 }>;
  export type Chain<K extends string> = (ctx: Ctx) => Readonly<Record<K, Read<number>>>;
  export interface Cell { readonly exact: Read<number>; readonly conservative: Read<number> }
  export interface Evaluation<K extends string> {
    readonly cells: Readonly<Record<K, Cell>>;
    readonly trace: readonly { readonly id: string; readonly value: number }[];   // exact pass, in read order
    readonly roundingPoints: readonly string[];                                  // ids of the exact pass, in order
    readonly runs: number;                                                       // conservative runs made (the exact pass not counted)
  }
  export function roundTo(value: number, step: number, dir: 'down' | 'up'): number;
  export function runExact<K extends string>(chain: Chain<K>): { outputs: Readonly<Record<K, Read<number>>>; trace: Evaluation<K>['trace'] };
  export function evaluate<K extends string>(chain: Chain<K>, kinds: Readonly<Record<K, OutputKind>>): Evaluation<K>;
  // tests/helpers/exhaustive.ts — same signature and result shape, every combination
  export function evaluateExhaustive<K extends string>(chain: Chain<K>, kinds: Readonly<Record<K, OutputKind>>): Evaluation<K>;
  ```
- **roundTo:** `q = value / step`; snap `q` to `Math.round(q)` when within 1e-9 of it; floor or ceil; multiply back; strip float noise with `Number(x.toFixed(10))`.
- **evaluate**, the single-point test (spec 5.2, decided 28 Oct 2026; linear in the number of rounding points, never 2^n). A ctx in a run is told, per id, `exact`, `down` or `up`; an id it was told nothing about is read exact.
  ```
  exact = run(all exact)                       // trace, roundingPoints, exact outputs
  for each id p read in the exact pass whose value is not on its step:
    lo = run({p: down}); hi = run({p: up}); runs += 2
    for each output k: dir[k][p] = the worse of lo, hi for k per WORSE[kinds[k]] ('down' on a tie)
  for each output k:
    loop:
      f = run({every p with dir[k][p]: dir[k][p]}); runs++
      new = ids f read that have no dir[k] and are not on their step
      if new is empty: break
      for each q in new: test q down and up with the others as in f; runs += 2; set dir[k][q]
    conservative[k] = the worst of f and every single-point run, for k
  ```
  An id's value is "on its step" when `roundTo(v, step, 'down') === roundTo(v, step, 'up')`.
- **evaluateExhaustive** (test oracle): backtracking over every combination. Keep a stack of choice prefixes, starting with `[[]]`. Run the chain with read i using `prefix[i]` when there is one, else `down`; record the choices made. Push `choices[0..j-1] + ['up']` for every j ≥ prefix length whose read was not on its step. Keep the worst value per output over all runs.
- **Cells**, both functions: exact error → the cell's conservative is that same error (the whole cell is rejected). Exact ok but some run errored for `k` → conservative is the first such error. Otherwise conservative is the worst value.

- [ ] **Step 1:** Write `tests/ctx.test.ts`:
  - `roundTo(3.16, 0.01, 'down') === 3.16` and `'up'` → 3.16 (Review Focus 2); `roundTo(3.161, 0.01, 'up') === 3.17`; `roundTo(-1050, 100, 'down') === -1100`;
  - `runExact` returns unrounded values and the trace in read order;
  - one synthetic chain `d = 2 * read('a', 1.23, 0.1)` with kind `distance` → conservative 2.6; as `refusalSpeed` → 2.4;
  - a branch chain: `r = read('roll', x, 10); if (r < 2500) use read('check1000', …) else read('check2000', …)`, x = 2495 and `check2000` the worse branch: the final run reads `check2000`, which the exact pass never read; it gets its own test, and the conservative value is `evaluateExhaustive`'s;
  - two outputs sharing one read, one `distance` and one `refusalSpeed`: each takes its own worst direction (spec 5.2);
  - an output that is `OutOfChart` only when one point is rounded up → exact ok, conservative the error; an exact error → both the error;
  - 10 reads, none on its step, one output → `runs === 21`; 45 reads, three outputs → `runs === 93` and `evaluate` completes in under 20 ms;
  - all 10 reads already on their step → `runs === 1`;
  - **oracle agreement:** 200 seeded random chains (`mulberry32` or similar, seed fixed in the test) of 3 to 8 reads, each a smooth monotone function of the earlier reads (sums, products, `Math.sqrt`, one `if` on a read): for every output, `evaluate`'s conservative equals `evaluateExhaustive`'s within 1e-9.
- [ ] **Step 2:** Run `cd perf && nice -n 19 node --test tests/ctx.test.ts`: FAIL.
- [ ] **Step 3:** Implement `src/core/ctx.ts` and `tests/helpers/exhaustive.ts`.
- [ ] **Step 4:** Run: PASS. Commit `feat(perf): read context with the single-point conservative test`.

### Task 5: Errata file and loader

**Files:**
- Create: `perf/extraction/manual-errata.yaml` (the B7-2 entry from the Chart spec format), `perf/tests/helpers/errata.ts`, `perf/tests/helpers/specs.ts`
- Modify: `perf/package.json` (dev dep `yaml`)
- Test: `perf/tests/errata.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // specs.ts
  export interface SampleProblem { inputs: Record<string, number | boolean>; expected: Record<string, number> }
  export interface ChartSpec { id: string; figure: string; sheet: number | null; sample_problems?: SampleProblem[] }   // other keys ignored by tests
  export function loadSpecs(): ChartSpec[];                     // every perf/extraction/specs/*.yaml
  // errata.ts
  export interface Erratum { figure: string; sheet: number | null; where: string; printed: string; correct: string; reason: string;
    affects: { spec: string; sample: number; key: string; value: number } | null }
  export function loadErrata(): Erratum[];
  export function applyErrata(spec: ChartSpec, errata: readonly Erratum[]): SampleProblem[];   // copies, with affected expected values replaced
  ```
- [ ] **Step 1:** Write `tests/errata.test.ts`: the file parses; it holds the B7-2 sh. 2 entry; every entry has the seven keys and non-empty strings; `applyErrata` on a synthetic spec replaces exactly the named `expected` value and leaves the input spec unchanged; an `affects` naming a missing sample throws.
- [ ] **Step 2:** Run `cd perf && nice -n 19 node --test tests/errata.test.ts`: FAIL. Implement. Run: PASS.
- [ ] **Step 3:** Commit `feat(perf): manual errata list and loader`.

### Task 6: Extractor framework, B2-1 and B2-2

**Files:**
- Create: `perf/extraction/extract.py` (CLI), `perf/extraction/geom.py` (segments, chaining, grid lines, axis fit; from prototype `vec.py` and `extract.py`), `perf/extraction/panels.py` (one function per panel type), `perf/extraction/output.py` (data JSON, page PNG, overlay, manifest), `perf/extraction/specs/B2-1.yaml`, `perf/extraction/specs/B2-2.yaml`; data files `perf/data/f16c-f110-129/{B2-1,B2-2}.json`, `pages/{B2-1,B2-2}.png`, `manifest.json`
- Modify: `flake.nix` (add `ps.pymupdf`, `ps.pillow` to `pythonEnv`), `docs/wip/TOLD.md` (0.5 example in the Chart spec format shape)

**Interfaces:**
- Consumes: the Data contract and Chart spec format above.
- Produces: `python3 -I extraction/extract.py <pdf> [id ...]` (run in `perf/`, paths resolved from the script's own directory; no ids = every spec). Python functions Tasks 7 and 8 extend: `panels.extract_panel(page, spec, panel_spec, axes) -> dict` dispatching on `type`, and `geom.fit_axis(page, axis_spec) -> {'a', 'b', 'resid'}`.

Behaviour:
- Refuse a PDF whose SHA-256 differs from the pin, before opening it.
- Per spec: assert every `must_contain` string is on the page; fit every axis (assert labels found == `ticks`, residual < 0.6 pt); axis-title check (the `title` words' centre lies beyond the panel frame on `edge`, else stop); extract each panel; run its asserts (curve count == param values, `order`, `monotonic`, `families`, `min_lines`, no leftover or unlabelled curves); then write outputs.
- A failed assert stops the run with `<id> panel <panel>: <reason>`; nothing is written for that id.
- Outputs per the Data contract: the JSON, `pages/<id>.png` (the `image_clip` at 2 px/pt, greyscale, quantized to 16 colours, `optimize=True`), `extraction/out/overlay-<id>.png` (extracted lines in red over the page, the second family of a guideline panel in blue), and the manifest rewritten over every file in the dataset.
- `scale_pair` is computed from the two fitted axes: `a = from.a / to.a`, `b = (from.b - to.b) / to.a`, so that to = a·from + b. B2-1's AB scale is `snap: false`, like the prototype.

- [ ] **Step 1:** Add PyMuPDF and Pillow to `flake.nix`. Run `cd /home/nklx/dev/personal/sourcedcs-perf && nix develop -c python3 -I -c 'import pymupdf, yaml, PIL; print("ok")'`: prints `ok`.
- [ ] **Step 2:** Write the two specs from the prototype's coordinates. B2-1: axes `tof_mil`, `tof_ab`, `temperature`; panel `pa` (curve_family, param `pressure_altitude` ft [-2000, 0, 2000, 4000, 6000, 8000, 10000], `order: {output: rises, check_at: [-40, -30, …, 50]}`, filter `min_span_pt: 300`), panel `ab` (scale_pair `tof_mil` → `tof_ab`); sample `{temp_c: 40, pa_ft: 2000}` → `{tof_mil: 3.16, tof_ab: 1.85}`. B2-2: panel `speed` (single_curve, input `gross_weight` 1000 lb, output `takeoff_speed` KIAS, `monotonic: rises`, filter `min_points: 21`); corrections `["0.8 kt per 1 % CG from 35 %", "rotation: takeoff speed - 10 kt non-AB, - 15 kt AB", "8 deg pitch attitude: speed x 1.08"]`; samples `{gross_weight_lb: 33000, cg_pct: 37}` → `{vto_35_kias: 170, vto_kias: 168, vr_mil_kias: 158, vr_ab_kias: 153}` and the same with `pitch_8deg: true` → `{vto_kias: 181}`. Read `printed_page` and the axis titles off the rendered page.
- [ ] **Step 3:** Implement. Run `cd perf && nix develop .. -c python3 -I extraction/extract.py "$PERF_PDF" B2-1 B2-2`: exits 0. Look at both overlay PNGs: the red lines lie on the printed curves.
- [ ] **Step 4:** The refusal: a copy of any other PDF (or the manual with one byte appended, in the scratchpad) → exit non-zero, message names the SHA mismatch, nothing written.
- [ ] **Step 5 (Review Focus 5):** Run the extractor again; `git status --short perf/data` shows no change after the first committed run, and `dataVersion` is unchanged.
- [ ] **Step 6:** Commit the extractor and specs first (`feat(perf): spec-driven extractor, B2-1 and B2-2 specs`), re-run so `extractorCommit` has no `-dirty`, then commit the data (`data(perf): extract B2-1 and B2-2`).

### Task 7: Guideline panels and B2-3

**Files:**
- Modify: `perf/extraction/panels.py` (guideline_panel; `mono_pieces` and `join_dashes` from the prototype), `perf/extraction/geom.py` if needed
- Create: `perf/extraction/specs/B2-3.yaml`; data `B2-3.json`, `pages/B2-3.png`, manifest

**Interfaces:**
- Consumes: Task 6's `extract_panel` dispatch and `fit_axis`.
- Produces: `B2-3.json` with panels `gw` (curve_family), `cg` (`families: {all: any}`, `min_lines: 12`), `di` (`{all: rises}`, `min_lines: 11`), `slope` (`{uphill: rises, downhill: falls}`, `min_lines: 20`), `wind` (`{tailwind: rises, headwind: falls}`, `min_lines: 20`), in that order. Every line kept crosses its baseline (within the 2 % tolerance).

- [ ] **Step 1:** Write `B2-3.yaml` in the Chart spec format from the prototype and TOLD.md 0.5; samples: the two from 0.5 plus `{…MIL inputs…, pitch_8deg: true}` → `{distance_ft: 5007}`.
- [ ] **Step 2:** Implement guideline extraction. Run `cd perf && nix develop .. -c python3 -I extraction/extract.py "$PERF_PDF" B2-3`: exits 0. In the overlay, uphill and tailwind lines are red, downhill and headwind blue, and every printed guideline is covered.
- [ ] **Step 3:** Break the spec on purpose (swap `families` to `{uphill: falls, downhill: rises}`): the run stops naming panel `slope`; restore.
- [ ] **Step 4:** Commit extractor change, re-run, commit data, as in Task 6 Step 6.

### Task 8: Tables, Figure B1-1

**Files:**
- Modify: `perf/extraction/panels.py` (table)
- Create: `perf/extraction/specs/B1-1.sh1.yaml` … `B1-1.sh7.yaml`; data `B1-1.sh1.json` … and their pages

**Interfaces:**
- Consumes: Task 6's dispatch.
- Produces: one `table` panel per table on a sheet. Table spec keys:
  ```yaml
  - id: stores
    type: table
    clip: [x0, y0, x1, y1]
    row_band: [y0, y1]                   # the data rows, headers excluded
    rows: 23                             # asserted
    key: [store]                         # columns that may never be null
    columns: [{name: store, unit: "", x: [x0, x1]}, {name: drag_index, unit: "", x: [x0, x1]}]
  ```
  Words go to the column whose `x` range holds their centre, and to rows by y clustering (2 pt). A cell's words are joined by one space; a cell matching `-?\d+(\.\d+)?` (after `–`/`−` → `-`) becomes a number, an empty cell `null`. Assert the row count, the column count, no word inside `clip` outside every column, and no null key cell. After writing, print every table as aligned text to stdout.

- [ ] **Step 1:** Find the seven sheets: `nix develop .. -c python3 -I -c 'import pymupdf,sys; d=pymupdf.open(sys.argv[1]); print([i for i,p in enumerate(d) if "B1-1" in p.get_text()])' "$PERF_PDF"`. Render each to a PNG in the scratchpad and read it.
- [ ] **Step 2:** Write the seven specs. If a sheet does not fit the format (merged cells, a header spanning columns that changes a value's meaning, footnote markers inside numbers), stop and ask through the questioner. Do not invent a format extension.
- [ ] **Step 3:** Implement, run `… extract.py "$PERF_PDF" B1-1.sh1 … B1-1.sh7`: exits 0; save the printed tables to `extraction/out/B1-1-tables.txt`.
- [ ] **Step 4:** Commit, re-run, commit data (as Task 6 Step 6).
- [ ] **Step 5 (HUMAN checkpoint):** The human compares `extraction/out/B1-1-tables.txt` with the seven pages once. A mismatch is fixed in the spec and re-extracted, never in the data.

### Task 9: Figures B2-1 to B2-3 and the golden sample-problem tests

**Files:**
- Create: `perf/src/core/figures/b2-1.ts`, `b2-2.ts`, `b2-3.ts`, `perf/tests/helpers/data.ts`, `perf/tests/helpers/sample-runners.ts`
- Test: `perf/tests/sample-problems.test.ts`, `perf/tests/figures.test.ts`

**Interfaces:**
- Consumes: `panel`, `curveFamily`, `singleCurve`, `guidelinePanel`, `scalePair` (Task 3); `Ctx`, `STEPS`, `runExact`, `evaluate`, `evaluateExhaustive` (Task 4); `loadSpecs`, `loadErrata`, `applyErrata` (Task 5); data from Tasks 6 and 7.
- Produces:
  ```ts
  // b2-1.ts
  export function takeoffFactor(ctx: Ctx, fig: FigureFile, i: { tempC: number; paFt: number }): { tofMil: Read<number>; tofAb: Read<number> };
  // b2-2.ts
  export function takeoffSpeed(ctx: Ctx, fig: FigureFile, i: { grossWeightLb: number; cgPct: number; pitch8: boolean }):
    { vto35Kias: Read<number>; vtoKias: Read<number>; vrMilKias: Read<number>; vrAbKias: Read<number> };
  // b2-3.ts — headwindKt negative = tailwind; slopePct negative = downhill
  export function takeoffDistance(ctx: Ctx, fig: FigureFile, i: { takeoffFactor: number; grossWeightLb: number; cgPct: number;
    dragIndex: number; slopePct: number; headwindKt: number; pitch8: boolean }): { distanceFt: Read<number> };
  // tests/helpers/data.ts
  export function loadFigure(id: string): FigureFile;    // perf/data/f16c-f110-129/<id>.json
  // tests/helpers/sample-runners.ts — maps a spec's snake_case sample inputs to the figure call and its outputs to the expected keys
  export const SAMPLE_RUNNERS: Readonly<Record<string, (inputs: SampleProblem['inputs']) => Record<string, Read<number>>>>;
  ```
- Reads (each through `ctx.read`, ids exactly these, chart units converted to the named unit first):
  - B2-1: `b2-1.tofMil` (STEPS.takeoffFactor); `b2-1.tofAb` = `scalePair` of the **unrounded** MIL reading, read separately.
  - B2-2: `b2-2.vto35` (STEPS.speedKt). Then the corrections, not rounding points: vto = vto35 − 0.8 × (cg − 35); × 1.08 at 8°; vrMil = vto − 10; vrAb = vto − 15.
  - B2-3: `b2-3.gw`, `b2-3.cg`, `b2-3.di`, `b2-3.slope`, `b2-3.wind` (each the distance after that panel, STEPS.distanceFt, in ft). A zero slope or wind skips that guideline panel but still reads its id; × 1.18 at 8° is a correction, not a rounding point.
  - An `OutOfChart` stops the figure; every output that depends on it returns it.

- [ ] **Step 1:** Write `tests/sample-problems.test.ts`: for every spec with `sample_problems`, after `applyErrata`, run `SAMPLE_RUNNERS[spec.id]` in `runExact`; each expected key is `ok` and within 2 % of the expected value. A spec with samples but no runner fails the test. Expected values (TOLD.md 0.6): B2-1 3.16 / 1.85; B2-2 170, 168, 158, 153, 181; B2-3 4,243, 2,384, 5,007.
- [ ] **Step 2:** Write `tests/figures.test.ts`:
  - B2-1 at PA −1,000 ft and −10 °C reads, between the −2,000 and 0 ft values (Review Focus 3); PA 10,000 ft reads; PA 10,100 ft → `OutOfChart` on `pressure_altitude`;
  - B2-3 with `slopePct: 0, headwindKt: 0` equals the `b2-3.di` trace value; `dragIndex: 0, cgPct: 35` gives `b2-3.di` equal to `b2-3.gw` (Review Focus 4);
  - a 5 kt tailwind gives a longer distance than calm, a 5 kt headwind a shorter one; 1 % downhill shorter than level (Review Focus 3);
  - `runExact` on B2-3's MIL sample yields the trace ids `['b2-3.gw', 'b2-3.cg', 'b2-3.di', 'b2-3.slope', 'b2-3.wind']`;
  - GW 52,000 lb → `distanceFt` is `OutOfChart` with input `gross_weight`.
  - **oracle agreement on real data:** a test chain that reads B2-3's six inputs through `ctx.read` (steps from `STEPS`) and calls `takeoffDistance`; for 50 seeded input sets inside the drawn ranges (both wind and slope signs), `evaluate`'s conservative distance equals `evaluateExhaustive`'s within 0.5 ft.
- [ ] **Step 3:** Run `cd perf && nice -n 19 node --test tests/sample-problems.test.ts tests/figures.test.ts`: FAIL. Implement. Run: PASS. If a sample misses 2 % by a figure the prototype passed, the defect is in the port, not the data: compare with `perf/prototype/engine/engine.js`.
- [ ] **Step 4:** Commit `feat(perf): figures B2-1 to B2-3 and golden sample problems`.

### Task 10: Design foundation

**Files:**
- Create: `perf/web/css/tokens.css`, `perf/web/css/perf.css`, `perf/web/css/print.css`, `perf/web/components.html` (a static specimen of every component, no script)
- Test: `perf/tests/design-tokens.test.ts`

**Interfaces:**
- Produces CSS custom properties `--paper`, `--ink`, `--grey`, `--rule`, `--alert` with the light and dark values of TOLD.md 10.1 (dark under `@media (prefers-color-scheme: dark)`; `print.css` forces light); classes for the components of 10.1 plus step 1's two: `.reason` (grey reason line under a table) and `.unparsed` (grey dotted underline). Take the CSS from `docs/mockups/perf-told.html` where it exists; the type scale and sizes are TOLD.md's 10.1 table.

- [ ] **Step 1:** Write `tests/design-tokens.test.ts`: `tokens.css` defines exactly the five properties, in light and in dark, with the 10.1 hex values; no colour literal (`#…`, `rgb(`, `hsl(`, a named colour other than `transparent`/`currentColor`) appears in any other CSS file or in `components.html`; the font stack is `'Times New Roman', Times, 'Liberation Serif', serif` everywhere a `font-family` is set. Run it: FAIL.
- [ ] **Step 2:** Write the CSS and the specimen. Run `cd perf && nice -n 19 node --test tests/design-tokens.test.ts`: PASS. Open `components.html` in a browser in light and dark (Playwright MCP is fine) and compare it with the mockup.
- [ ] **Step 3:** Commit `feat(perf): design tokens, component stylesheet, print stylesheet`.

### Task 11: ADRs, README, CLAUDE.md, CI

**Files:**
- Create: `docs/adr/0148-perf-replicates-the-manuals-procedure.md`, `0149-every-perf-result-has-an-exact-and-a-conservative-value.md`, `0150-only-figure-b1-1-stores-other-stores-enter-as-additional-drag-index.md`, `0151-perf-is-public-without-login.md`, `0152-normal-landing-is-the-manuals-short-field-landing.md`, `0153-perf-typescript-toolchain-and-the-json-schema-contract.md`, `perf/README.md`, `perf/CHANGELOG.md`, `.github/workflows/perf-docker.yml`
- Modify: `CLAUDE.md` (perf in Repository Overview, Commands and Architecture)

**Interfaces:**
- Consumes: the decisions in TOLD.md ("Architecture and repository" ADR list, "Decisions of 28 Oct 2026"). ADR shape like `docs/adr/0147-*.md`: title line, **Status** (Accepted, 2026-10-28, TOLD step 0 design review), Context, Decision, Consequences. 0148 carries the pressure-altitude example; 0153 the toolchain, the schema contract, `data:check` and why extraction is throwaway-grade.
- Produces: workflow named `Build and Push perf Docker Image` (step 1 adds the build job; `deploy.yml` will listen to this name). Trigger `push` with `paths: ['perf/**', 'crc-sync/src/altimetry.js', '.github/workflows/perf-docker.yml']`, plus `workflow_dispatch`. One job `test`: checkout v5, setup-node v5 with `node-version: 22`, `npm ci`, then `lint`, `format:check`, `typecheck`, `types:check`, `data:check`, `test`, all with `working-directory: perf`.
- `perf/README.md`: what perf is, the data flow, every npm script, the extraction command with `PERF_PDF` and `nix develop`, the commit order (extractor, re-run, data), and that CI never extracts.

- [ ] **Step 1:** Write the six ADRs, README, CHANGELOG (`## Unreleased` with step 0's items), the CLAUDE.md section (commands as in Task 1/2 scripts; architecture: the data flow, `src/core` rules, the spec format pointer, the PDF rule).
- [ ] **Step 2:** Write the workflow. Check with `actionlint .github/workflows/perf-docker.yml` if installed, else `python3 -c 'import yaml,sys; yaml.safe_load(open(sys.argv[1]))' .github/workflows/perf-docker.yml`.
- [ ] **Step 3:** Commit `docs(perf): ADRs 0148-0153, README, CLAUDE.md, CI test workflow`.

### Task 12: Step 0 gate and prototype removal

**Files:**
- Delete: `perf/prototype/`
- Modify: `docs/wip/TOLD.md` (tick 0.1 to 0.4; step 0's gate row), `perf/CHANGELOG.md`

- [ ] **Step 1:** Run every gate: `cd perf && nice -n 19 sh -c 'npm run lint && npm run format:check && npm run typecheck && npm run types:check && npm run data:check && npm test'`: all pass, coverage on `src/core/` ≥ 90 % lines.
- [ ] **Step 2:** Re-extract everything: `nix develop .. -c python3 -I extraction/extract.py "$PERF_PDF"`: exits 0, `git status --short perf/data` empty.
- [ ] **Step 3:** The step 0 gate (TOLD.md step overview): B2-1 to B2-3 extracted and their sample problems passing are both shown by Steps 1 and 2. Delete `perf/prototype/` (its engine is ported and its coordinates live in the specs), tick TOLD.md 0.1–0.4, run Step 1 again.
- [ ] **Step 4:** Commit `chore(perf): step 0 done, prototype removed`.
