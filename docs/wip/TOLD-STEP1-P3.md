# TOLD step 1 plan 3: UI and state

**Goal:** the three pages a pilot uses (`/f16/`, `/f16/figure.html#…`, Limitations), with the inputs in the URL hash
and localStorage, the figure view drawing the exact paths, print on one page, and one Playwright smoke spec.

**Spec:** `docs/wip/TOLD.md` 1.8 (this plan argues from it; where they differ, 1.8 wins), with 1.2 items 4 and 5,
section 10, the decisions of 29 Oct 2026 and the approved mockups `docs/mockups/perf-told.html` and
`perf-limitations.html`.

**Branch:** `perf-told-p3` off `perf-told` (12 Nov 2026). Decided overnight by the supervisor at the human's request;
the rulings are marked (S) in 1.8 and listed in the ledger at the end.

**Tech:** TypeScript, `tsc` only (`src/` → `web/js/`), native ES modules in the browser, no framework, no bundler;
`node --test` for unit tests; Playwright 1.63 (Chromium) for the smoke spec.

## Global constraints

- Every page is plain HTML under `perf/web/`, loading `css/tokens.css`, `css/perf.css`, its own page CSS and
  `css/print.css` (media print), and one `<script type="module" src="js/web/<page>/main.js">`.
- Colours only through the five tokens (`tests/design-tokens.test.ts` scans every stylesheet). Times New Roman, one
  type scale (TOLD 10.1).
- `src/web/` imports `src/core/`, never the reverse. Only `src/web/load.ts` calls `fetch` (lint enforces it).
- Data URLs are relative to the page: `data/f16c-f110-129/<file>` (served at `/f16/data/` by nginx in plan 4 and by
  `scripts/serve.ts` locally).
- One job per file, each under about 300 lines. No god files.
- Numbers are never tested for truthiness (lint). Units in names.
- Lanes run only their own test files (`nice -n 19 node --test tests/<file>.test.ts`), plus `npx tsc --noEmit`,
  `npx eslint <their files>` and `npx prettier --check <their files>`. The supervisor runs the full gates.

## Review focus

1. A hash from someone else's machine (another data version, a hand-edited link): never a throw, always a page.
2. Typing a half-finished value ("37,", "230 / 0"): the page must not throw on any keystroke.
3. Dark mode and print: no colour outside the tokens, one page in print.
4. A figure link for a cell that did not compute: the figure page still loads and says why the path stops.
5. Storage disabled (private mode): the page still works.

## Tasks

| Task | Content | After |
| --- | --- | --- |
| 1 | Core: `PathMark`, `ctx.mark`, marks in every figure function, `tracePaths` | — |
| 2 | Web foundation: `load`, `format`, `scale`, `reasons`, `rule-lines`, `version`, `state/*`, `scripts/serve.ts` | — |
| 3 | Drag index builder view: `told/dragindex-view.ts`, `told/store-menu.ts`, builder CSS | — |
| 4 | TOLD page: `index.html`, `told/inputs-view.ts`, `told/tables.ts`, `told/main.ts`, `told.css`, print | 2, 3 |
| 5 | Figure page: `figure.html`, `figure/*.ts`, `figure.css` | 1, 2 |
| 6 | Limitations page | 2 |
| 7 | Smoke spec, CI, README, handoff, screenshots for the review | 4, 5, 6 |

Wave 1: Tasks 1, 2, 3. Wave 2: Tasks 4, 5, 6. Then 7.

### Task 1: path marks in the core

**Files:** create `src/core/path/mark.ts`, `src/core/path/trace.ts`, `tests/path.test.ts`; modify `src/core/ctx.ts`
(the `Ctx` interface and `execute`'s ctx get `mark`, a no-op there), every file in `src/core/figures/`, and any test
helper or test that builds a `Ctx` by hand.

**Interfaces (produces):**

```ts
// mark.ts
interface MarkBase { readonly figure: string; readonly panel: string }
export type PathMark =
  | (MarkBase & { readonly kind: 'curve_family'; readonly input: number; readonly param: number; readonly output: number })
  | (MarkBase & { readonly kind: 'single_curve'; readonly input: number; readonly output: number })
  | (MarkBase & { readonly kind: 'scale_pair'; readonly from: number; readonly to: number })
  | (MarkBase & { readonly kind: 'guideline_panel'; readonly family: string; readonly baseline: number;
      readonly entry: number; readonly target: number; readonly exit: number });
// trace.ts
export interface PathTrace<K extends string, S> { readonly run: ChainRun<K, S>; readonly marks: readonly PathMark[] }
export function tracePaths<K extends string, S>(chain: Chain<K, S>): PathTrace<K, S>;
```

- Values are in the panel's chart units, exactly the numbers passed to and returned from the `read/` block (for
  B2-3 `gw`: input = takeoff factor, param = GW in 1000 lb, output = distance in 1000 ft). `figure` is `fig.id`.
- A mark is made only for a read that returned ok, after it. A guideline panel skipped for a zero target is not
  marked. A table read (`tableCell`) is not a chart path and is not marked.
- `tracePaths` runs the chain once as the exact pass does (inputs at `exact`, nothing rounded) with a ctx that
  records marks; it must give the same outputs as `runExact`.
- Steps: tests first (`tests/path.test.ts`): for the B2-3 sample, the marks are `gw`, `cg`, `di`, `slope`, `wind`
  in order with the values the figure function computed; for the takeoff chain (MIL) the figure sequence is B2-1,
  B2-2, B2-3, B2-4, B2-5 sheets; for a landing chain B7-1, B7-2.sh1, B7-2.sh2; a chain stopped out of chart has no
  mark after the stop; `tracePaths` outputs equal `runExact`'s; `evaluate` results unchanged (existing tests). Keep
  100 % line coverage on `src/core/`.

### Task 2: web foundation

**Files:** create `src/web/load.ts`, `format.ts`, `scale.ts`, `reasons.ts`, `rule-lines.ts`, `version.ts`,
`state/hash.ts`, `state/storage.ts`, `state/initial.ts`; `scripts/serve.ts`; tests `tests/web-format.test.ts`,
`tests/web-reasons.test.ts`, `tests/web-rule-lines.test.ts`, `tests/web-hash.test.ts`, `tests/web-initial.test.ts`,
`tests/web-version.test.ts`; `package.json` script `"serve": "node scripts/serve.ts"`.

**Interfaces (produces):**

```ts
// load.ts — the only fetch
export interface AppData { readonly manifest: Manifest; readonly figures: FigureSet }
export function loadData(base?: string): Promise<AppData>;          // base default 'data/f16c-f110-129/'
export function pageImageUrl(fig: FigureFile, base?: string): string; // base + fig.image.file
// format.ts
export const DASH = '—';
export function formatSpeed(r: Read<number>, which: 'exact' | 'conservative'): string;    // 172.5 / 174
export function formatDistance(r: Read<number>, which: 'exact' | 'conservative'): string; // 5,752 / 5,960
export function formatPercent(value: number): string;                                      // 97.5
export function formatThousands(value: number, decimals?: number): string;                 // en-US grouping, '−' minus
export function figureLabel(figureId: string): string;                                    // 'B2-6.sh2' → 'B2-6 sh. 2'
// scale.ts
export function fitPage(page: HTMLElement, widthPx?: number): () => void; // 1280; sets --page-scale on resize; page CSS applies zoom: var(--page-scale, 1), print resets it; returns dispose
// reasons.ts
export interface Signs { readonly headwindKt: number | null; readonly slopePct: number | null }
export function reasonText(reason: Reason, figures: FigureSet, signs: Signs): { figure: string; text: string };
//   figure: figureLabel(reason.error.figure); text after "<figure>: "
// rule-lines.ts
export type ColumnName = 'MIL' | 'MAX AB' | 'normal dry' | 'normal wet' | 'heavyweight dry' | 'heavyweight wet';
export function ruleLine(mark: RuleMark, column: ColumnName | null, rcr: number | null, figures: FigureSet): string; // rcr: for landing-rcr-10 only; roll rules use mark.percent
// version.ts
export const APP_VERSION = '0.1.0';
// state/hash.ts
export interface AppState { readonly inputs: Inputs; readonly loadout: Loadout }
export type Decoded =
  | { readonly kind: 'none' }                                   // no hash or no v
  | { readonly kind: 'refused' }                                // v is not '1'
  | { readonly kind: 'ok'; readonly state: AppState; readonly droppedRows: number };
export function encodeState(s: AppState): string;  // without '#', starts 'v=1&'
export function decodeState(text: string): Decoded; // accepts with or without '#'; never throws
// state/storage.ts
export const STORAGE_KEY = 'perf.f16.v1';
export function readStored(storage: Pick<Storage, 'getItem'> | null): string | null;   // null on throw
export function writeStored(storage: Pick<Storage, 'setItem'> | null, text: string): void; // swallows throws
// state/initial.ts
export interface Initial { readonly state: AppState; readonly notes: readonly string[] }
export function initialState(hash: string, stored: string | null): Initial;
```

- Exact strings (copy verbatim): the refused note "This link is from another version of the calculator and was not
  loaded."; the dropped-rows note "Part of the loadout in this link could not be read."; `DASH` is U+2014.
- Hash keys and loadout encoding exactly as 1.8 "State". A decoded `v=1` hash with a key missing takes that field's
  `DEFAULT_INPUTS` value; an unknown key is ignored. Loadout absent → `DEFAULT_LOADOUT`. A row decodes only if: 4
  parts, stations each a `Station` and joined by `-`, count an integer from 1 to 3 × the row's station count; else it is dropped and counted.
- `initialState`: hash `ok` → its state (note if rows dropped); `refused` → the refused note, then the stored state
  (decoded the same way; a bad stored string is ignored silently); `none` → stored, else defaults.
- `reasonText`: name = quantity name with `_` → space, looked up on the figure's panels (input, output, param,
  from, to, columns) to find the unit; `1000 lb` → ×1000 shown in lb, `1000 ft` → ×1000 in ft, otherwise the unit as
  given (`deg`, `°C`, `KIAS`, `kt`, `%`). Wind and slope quantities (`wind`, `headwind`, `tailwind`, `slope`): use
  `signs` to name the side ("tailwind 20 kt", "uphill slope 2.1 %"); a `null` sign keeps the data's name. A
  conservative reason gets "conservative " before the name. Range "outside the drawn range 20,000–48,000 lb"
  (en dash); `drawnRange` null → "outside the drawn chart"; `value` NaN → "not in the table". Check the real data
  for the exact quantity names before writing the table (`grep '"name"' data/f16c-f110-129/*.json | sort -u`).
- `ruleLine` texts exactly as 1.8 "Rule lines"; `b7-2-limit` takes the limit line's `label` from B7-2.sh1's
  `limit_line` panels (read the RuleMark type in `src/core/told/rules.ts` for which line it names).
- `scripts/serve.ts`: `node:http`, port from `PORT` (default 8080), `/` → 302 `/f16/`, `/f16/data/…` → `data/…`,
  `/f16/…` → `web/…` (`/f16/` → `index.html`), MIME by extension (html, js, css, json, png, svg), 404 otherwise,
  refuses paths with `..`. Not under coverage; exercised by the smoke spec.
- Tests: the round trip of every Inputs field (including empty strings and text with `&`, `=`, `#`, spaces) and a
  loadout with a split 3/7 pair, a `noTipMissile` row and a null suspension; `v=2` and `v=` refused; garbage rows
  dropped and counted; unknown store key kept; `decodeState` never throws on 200 random strings; every reason form
  in 1.8; every rule line; `APP_VERSION` equals `package.json` version.

### Task 3: drag index builder view

**Files:** create `src/web/told/dragindex-view.ts`, `src/web/told/store-menu.ts`, `src/web/told/loadout-edit.ts`
(pure: split, join, set store, set suspension, set count on a `Loadout`), `web/css/told.css` (builder part only, from
the mockup's proposed CSS), `tests/web-loadout-edit.test.ts`.

**Interfaces (produces):**

```ts
// loadout-edit.ts (pure)
export function setStore(l: Loadout, row: number, storeKey: string | 'noTipMissile' | null): Loadout; // resets suspension, count = stations
export function setSuspension(l: Loadout, row: number, name: string | null): Loadout;
export function setCount(l: Loadout, row: number, count: number): Loadout;
export function split(l: Loadout, row: number): Loadout; // a pair row → two single-station rows, same store
export function join(l: Loadout, row: number): Loadout;  // the first of two split rows → the pair again
// dragindex-view.ts
export interface DragIndexView { update(loadout: Loadout, drag: DragIndex, additionalOk: boolean): void }
export function mountDragIndex(table: HTMLTableElement, notes: HTMLElement, cat: Catalogue,
  onChange: (next: Loadout) => void): DragIndexView;
```

- Behaviour exactly as the 29 Oct decisions and the mockup's builder (`docs/mockups/perf-told.html`; its script is
  a stand-in, not the implementation): rows per station pair then 5, 5L, 5R; the store menu lists only
  `storesFor(cat, stations)` grouped under their headings with rack and drag index as printed, filtered by typing,
  arrow keys and Enter, Escape closes; display drops the line-break hyphen; suspension list from
  `suspensionsFor`; count limited by `capacity`; "split"/"join" links; the 1/9 row offers "no tip missile".
- Problems: a row named by a `LoadoutProblem` gets the dotted underline (class `unparsed`) on its store and the
  problem text in `notes`. Total: `drag.exact` (and " / conservative" when they differ); "—" while
  `additionalOk` is false or `drag.ok` is false.
- The view never computes the drag index itself: `told/main.ts` (Task 4) calls `computeTold` and then `update`.
- Tests: the pure edits (split/join round trip, setStore resets suspension, count clamps to 0..3). The view itself
  is covered by the smoke spec; keep DOM code thin.

### Task 4: the TOLD page

**Files:** create `web/index.html`, `src/web/told/inputs-view.ts`, `src/web/told/field-text.ts` (pure: "37,240" →
"37240", "230 / 08 G15" → "230/08G15", RCR "23 / 18" split with defaults), `src/web/told/tables.ts`,
`src/web/told/main.ts`, tests `tests/web-field-text.test.ts`; extend `web/css/told.css` and `web/css/print.css`.

- Markup and classes from the approved mockup (`docs/mockups/perf-told.html`): sections I, II, III, the field
  labels, the takeoff and landing tables, the derived line. Move the mockup's "proposed" CSS into `told.css` (and
  its print part into `print.css`). Drop the mockup's script.
- `main.ts`: `loadData()`, `initialState(location.hash, readStored(localStorage))`, render notes under the title
  (grey), then on every `input` (and builder change): build `Inputs` with `field-text.ts`, `computeTold`, render,
  `encodeState` → `history.replaceState` and `writeStored`. `hashchange` reloads the state. A data load failure
  shows one grey line "The chart data could not be loaded." and nothing else.
- `inputs-view.ts`: reads and writes the fields; marks a filled field that `deriveInputs` rejects (or
  `parseNumber` for the additional drag index) with class `unparsed`; marks the RCR field red (`alert`) for a
  `landing-rcr-10` mark; writes the derived line.
- `tables.ts`: cells, red marks, reason lines (`reasonText`, the figure a link), rule lines (`ruleLine`, one per
  distinct rule and column; `landing-rcr-10` once, under the landing table), the acceleration check label and the
  conservative-distance line (1.8), the "Fig." links with the current state, the landing subheadings "Normal ·
  28,000 lb" and "Heavyweight · 37,240 lb" (weight as typed, formatted; "—" if it does not parse).
- Print: inputs as plain values (the `input` borders off), empty builder rows hidden, `.alert` boxed, footer
  "Data version 8 · App version 0.1.0 · 12 Nov 2026" filled by `main.ts` (date `en-GB`, day month year).
- Tests: `field-text.ts` table. The rest is the smoke spec (Task 7).

### Task 5: the figure page

**Files:** create `web/figure.html`, `src/web/figure/geometry.ts` (pure), `src/web/figure/views.ts` (pure),
`src/web/figure/letters.ts`, `src/web/figure/main.ts`, `web/css/figure.css`, tests `tests/web-geometry.test.ts`,
`tests/web-views.test.ts`.

**Interfaces:**

```ts
// views.ts (pure): which chains, figure files and line styles one view draws
export type View = 'takeoff' | 'normal' | 'heavy';
export interface ViewPath { readonly style: 'solid' | 'dashed'; readonly label: string; readonly marks: readonly PathMark[] }
export function viewPaths(figures: FigureSet, state: AppState, fig: string, view: View): {
  readonly sheets: readonly string[];   // figure file ids of `fig` the paths cross, in chain order
  readonly paths: readonly ViewPath[];  // takeoff: MIL solid, MAX AB dashed; landing: dry solid, wet dashed
  readonly reasons: readonly Reason[];  // exact reasons of the drawn columns that name `fig`
};
// geometry.ts (pure)
export type Px = readonly [number, number];
export function toPx(fig: FigureFile, panelId: string, x: number, y: number): Px; // via the panel's axes, clipPt, pxPerPt
export function markPolyline(fig: FigureFile, marks: readonly PathMark[]): Px[][]; // one polyline per connected run
```

- `viewPaths` rebuilds the same chain values `computeTold` uses (derive the inputs, the drag index, then
  `takeoffChain`/`landingChain`) and runs `tracePaths`; read `src/core/told/told.ts` and reuse its pieces; if that
  needs an export from core, add a small exported helper there (e.g. `chainValues`) rather than copying logic.
- Geometry: read how the extractor writes `axes` (`extraction/` and `0.2` in TOLD.md; a Transform maps a chart
  value to a PDF point: `page coordinate = a * value + b` on its `page` axis; check `unscaled`) and how `image.clipPt`
  and `pxPerPt` place the PNG. A curve mark is drawn from its input on the panel's input axis edge to the curve
  point, then to the next mark; a guideline mark from (baseline, entry) along the bracketing guide lines to
  (target, exit), sampled at 20 points. Verify on the real images: render the B2-3 sample problem and look at it.
- The page: `#v=1&…&fig=B2-3&view=takeoff`. Title block as the TOLD page, the figure title and sheet, each sheet's
  image (`pageImageUrl`) with an SVG overlay at the image's pixel size, paths in `--ink`, MIL/dry solid 1.8,
  AB/wet dashed 1.6 (5 3), circled letters Ⓐ… at each panel entry (radius 5 pt, scaled), a key below listing letter,
  quantity and value per path, reason lines for a stopped path, a "Back to TOLD" link with the same state. An
  input that comes from another figure (Ⓐ takeoff factor from B2-1) links to that figure's view. Unknown `fig` or
  `view`: one grey line "No such figure view." and the back link.
- The old board `docs/mockups/perf-figure.html` is deleted (the real page replaces it; 1.8).
- Dark mode: the page image is inverted on screen in dark mode (`filter: invert(1)`), never in print.
- Tests: `toPx` against a hand-computed point of B2-3's transform; `viewPaths` gives B2-5.sh1 for a dry RCR 23
  view and B2-5.sh1 + sh3 for RCR 12; landing normal draws B7-2 sh1 and sh2 with a dry and a wet path.

### Task 6: the Limitations page

**Files:** create `web/limitations.html`, `src/web/limitations/main.ts`, extend `told.css` only if needed (prefer
`perf.css` classes as in the mockup).

- Content from the approved mockup `docs/mockups/perf-limitations.html`, extended with every note in TOLD.md 1.2
  "Notes carried from step 0 / plan 1 / plan 2" that a pilot needs, in plain sentences, grouped by numbered
  topic as the mockup does. Leave out developer-only notes (ids, file names, tests).
- `main.ts` fills the data version (manifest, via `loadData`) and app version (`APP_VERSION`); a load failure
  leaves "unknown".
- A link back to the TOLD page keeping the hash. The TOLD page links here from its header (Task 4 adds the link:
  `limitations.html` + current hash).

### Task 7: smoke spec, CI, docs, review screenshots

**Files:** create `e2e/smoke.spec.ts`, `playwright.config.ts`; modify `package.json` (`"e2e": "playwright test"`),
`.github/workflows/perf-docker.yml`, `perf/README.md`, `docs/wip/TOLD.md` 1.5 and 1.8 status,
`docs/wip/TOLD-HANDOFF.md`, `perf/CHANGELOG.md`.

- Config: `webServer` runs `node scripts/serve.ts` on port 8199 after `npm run build`; Chromium only, workers 1.
- Spec: as 1.8 "Testing and CI": load; enter the B2-3 sample's inputs and check the MIL takeoff distance cell; a
  bad field gets `.unparsed`; reload keeps the state; a `#v=2&…` link shows the refused note; a "Fig." link opens
  the figure page with an SVG path; `page.pdf({ format: 'A4' })` and `'Letter'` each have exactly one page (count
  `/Type /Page` objects, not `/Pages`); `colorScheme: 'dark'` loads without errors; no console errors anywhere.
- CI: after the unit tests, `npx playwright install --with-deps chromium` and `npm run e2e` in `perf/`.
- Screenshots for the morning review into `/home/nklx/dev/perf-p3-review/` (not committed): TOLD page light and
  dark with the sample, the figure page for B2-3 takeoff, B2-5 takeoff and B7-2 normal, light and dark, the
  Limitations page, and the two PDFs.

## Ledger: supervisor rulings

Taken by the supervisor during execution (12 and 13 Nov 2026), for the human's review with the (S) rulings in 1.8.

- **R1, a loadout row's count.** A row's count is over all its stations: valid 1 to 3 × stations (a pair on TERs
  carries 6); 0 is `badCount` in the core. The hash decode accepts an integer 1 to 3 × stations, else the row is
  dropped. 1.8 and this plan were corrected (the old "0 to 3" was a plan error). Cost if wrong: a link loses a row.
- **R2, the Additional field.** `DragIndexView` gains `additionalInput`: the Additional drag index field sits in the
  builder table, as in the mockup; Task 4 wires it.
- **R3, problem values in print.** Print shows problem values in ink, boxed: 1.2 item 4 ("always black on white")
  wins over the mockup's red on paper.
- **R4, panel frames.** The panel frames are copied from the extraction specs into `src/web/figure/frames.ts`, with
  a parity test against the YAML. Moving them into the data (an extractor change and a human re-run) is left for
  later. Cost if wrong: a second source to keep in sync, guarded by the test.
- **R5, refusal on wet.** The B2-5 and B2-6 takeoff views include sheet 2 (the wet refusal links there).
- **R6, the interpolation note.** The figure page's note for a reading between two sheets is worded by the
  supervisor (Task 5 review round 1).

Parked findings (reviews' minors not fixed, for later):

- Task 1: comment width; more value assertions in the path tests; the float join tolerance (left as a Task 5 note).
- Task 3: the builder restates some core rules in its own code; the store menu's active option is not marked for
  ARIA.
- Task 5: the figure page's circled letters are our own (one per reading, in chain order), not the manual's printed
  sample letters.

Found in Task 7:

- The figure page passed the typed state to the chains, so a link from the TOLD page with "33,000", a spaced wind or
  an empty defaulted field (CG, RCR) drew no path. Fixed in Task 7 (`figure/main.ts` gives the chains
  `computeInputs`' copy, as the TOLD page does); the smoke spec's "Fig." test covers it.
