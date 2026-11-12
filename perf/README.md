# perf

The F-16 performance calculator of the SOURCE tool suite. Step 1 is TOLD: takeoff and landing data for the F-16C with the F110-GE-129, as a pilot working the charts of T.O. GR1F-16CJ-1-1 (HAF supplement, Appendix B) by hand would get it. Every result has an exact and a conservative value. The values are copied by hand onto the mission data card.

perf is a static app: all calculation runs in the browser, the server only serves files. It is public, without login. The plan is `docs/wip/TOLD.md`; the decisions are ADRs 0148 to 0153 in `docs/adr/`.

Status: step 0 (foundations) is done. Step 1 (TOLD) is cut into four plans (`docs/wip/TOLD.md` 1.6); plan 1, the data and one figure function per chart for B2-4, B2-5, B2-6, B7-1 and B7-2 sheets 1 and 2, is done. Plan 2, the core (`computeTold`: the chains, runway rules, drag index builder and input parsing; `docs/wip/TOLD.md` 1.7), is done. Plan 3, the UI and state (the three pages, the URL hash and localStorage, the figure paths and the Playwright smoke spec; `docs/wip/TOLD.md` 1.8), is built on branch `perf-told-p3` and awaits the human's review. Plan 4 (deployment) is next.

## Data flow

Data flows one way:

```
manual PDF -> extraction/ -> data/f16c-f110-129/ -> src/core/ -> src/web/
              Python, by     chart JSON, page      pure          UI (step 1)
              hand           images, manifest      functions
```

- `extraction/` reads the PDF's vector data, guided by one hand-written YAML spec per figure, and writes the chart data. It is the only code that touches the PDF.
- `data/f16c-f110-129/` (one folder per aircraft and engine): `<id>.json` per figure sheet (`B2-3`, `B1-1.sh1`), `pages/<id>.png` (the greyscale page, the figure view's background) and `manifest.json` (data version, the PDF's SHA-256, the extractor commit, one SHA-256 per file). Committed. Written only by the extractor: never edit these files by hand.
- `schema/charts.schema.json` is the contract between extraction and core. `src/core/data/types.ts` is generated from it.
- `src/core/` has no DOM, no `fetch`, no `node:` imports and no I/O. Chart data is passed in. Building blocks in `src/core/read/` never extrapolate and never throw for an input outside a chart: they return `OutOfChart`. Every chart read goes through `ctx.read(id, value, step)` (`src/core/ctx.ts`), which gives the exact and the conservative value (ADR 0149).
- `src/core/figures/` has one file per figure (`b2-1.ts` to `b7-2.ts`; `refusal-speed.ts` is the reader B2-5 and B2-6 share). Each function reads its panels in the manual's order, with its rounding point ids pinned by a test. A line carried from one panel into the next is passed on as is, never through `ctx.read`. `groundRollUncorrected` (B7-2 sheet 1) also returns the limit-line verdicts for its run: `true`, `false`, or `null` where the line is not drawn.
- `src/core/ctx.ts` runs a chain once exact and in the conservative runs (`evaluate`). A chain returns its outputs and per-run side data; each cell keeps the side data of the run that decided it. `ctx.input` takes an input with an exact and a conservative value (the drag index).
- `src/core/data/figure-set.ts`: `FigureSet`, the figure files a computation reads, keyed by figure id (`B2-3`, `B2-5.sh1`), and `figure()`, which throws on a missing id. The app loads the set; core never does.
- `src/core/inputs/`: `inputs.ts` (the `Inputs` type, every field as typed, and the defaults), `parse.ts` (numbers and the `ddd/ssGgg` wind), `derive.ts` (pressure altitude from the near-end threshold and the altimeter, slope, wind components, the physical limits). A derived value that does not compute names the fields that did not parse.
- `src/core/dragindex/`: the drag index builder on Fig. B1-1. `catalogue.ts` (stores and suspensions from the data), `racks.ts` (which suspension carries which rack string, and its capacity), `tip.ts` and `tank.ts` (the tip rules and the tank variants), `check.ts` (`checkLoadout`), `loadout-row.ts` (the `Loadout` type), `loadout.ts` (`dragIndex`, exact and conservative; an invalid loadout gives its problems, never a throw).
- `src/core/told/`: one chain per TOLD column, `takeoff.ts` (MIL, MAX AB) and `landing.ts` (normal weight and heavyweight, dry and wet); `rcr.ts` (refusal speed at the column's RCR); `rules.ts` (the runway rules with their paragraphs); `column.ts` (a column's cells, marks, reasons and exact trace); `told.ts` (`computeTold(figures, inputs, loadout)`, the one object plan 3's page renders).
- `src/core/path/`: `mark.ts` (`PathMark`, where the exact path entered and left one panel, in the panel's chart units; every figure function calls `ctx.mark` once per panel it read) and `trace.ts` (`tracePaths`, the exact pass of a chain once, with its marks in order). The figure page draws them.
- `src/web/` is the UI (below). `tsc` emits it to `web/js/` (gitignored).

## The web pages

Three plain HTML pages in `web/`, each loading `css/tokens.css`, `css/perf.css`, its own page CSS and `css/print.css` (media print), and one ES module from `web/js/web/<page>/main.js`. No framework, no bundler. Served at `/f16/`, with the data at `/f16/data/`.

- `index.html`, the TOLD page: I. Aircraft (gross weights, CG, the drag index builder), II. Fields, III. TOLD (takeoff MIL and MAX AB, landing normal and heavyweight, dry and wet, exact and conservative). Every input recomputes everything.
- `figure.html#<state>&fig=B2-3&view=takeoff`: one figure view (`view` is `takeoff`, `normal` or `heavy`), the greyscale page image with the exact paths drawn over it in SVG and the circled letters with their key. The TOLD page's "Fig." links open it.
- `limitations.html`: the notes and caveats, with the data and app versions.
- `components.html`: the component specimen of `css/perf.css` (not linked from the pages).

The state is the inputs as typed and the loadout, in the URL hash (`#v=1&…`, so a link carries it) and under `perf.f16.v1` in localStorage; a hash from another version is refused with a grey note (TOLD.md 1.8 "State"). The TOLD and figure pages print on one A4 or Letter page, black on white.

`src/web/` layout, one job per file:

```
load.ts             the only fetch: the manifest, then every figure file it lists
format.ts           numbers, units, "—"
scale.ts            fit the 1280 px page to the window (--page-scale)
reasons.ts          OutOfChart -> reason line
rule-lines.ts       RuleMark -> rule line
version.ts          APP_VERSION (a test keeps it equal to package.json)
state/              hash.ts (state <-> hash), loadout-code.ts (the loadout part), storage.ts, initial.ts (load order)
told/               main.ts (the page), inputs-view.ts, field-text.ts (typed text -> Inputs), field-check.ts
                    (underlines), derived-line.ts, tables.ts, table-cells.ts, table-lines.ts, links.ts,
                    dragindex-view.ts, dragindex-rows.ts, dragindex-text.ts, loadout-edit.ts, store-menu.ts
figure/             main.ts (the page), views.ts (which paths a view draws), geometry.ts (marks -> page polylines),
                    letters.ts, sheet.ts (one sheet in SVG), frames.ts and edges.ts (panel frames, copied from the
                    extraction specs under a parity test), dom.ts
limitations/        main.ts (versions and the back link)
```

Dependencies run one way: `src/web/` imports `src/core/`, never the reverse, and only `load.ts` fetches (lint enforces both). The pure modules (`format`, `reasons`, `rule-lines`, `state/*`, the `told/` models, `figure/geometry`, `figure/views`, `figure/letters`) have node unit tests; the views are covered by the smoke spec.

## npm scripts

Node 22.18 or later. Run them in `perf/` after `npm ci`.

- `npm run build`: `tsc -p tsconfig.build.json`, `src/` to `web/js/`.
- `npm run serve`: `scripts/serve.ts`, a local static server: `/f16/` from `web/`, `/f16/data/` from `data/`. Port from `PORT` (default 8080). Run `npm run build` first.
- `npm run e2e`: the Playwright smoke spec `e2e/smoke.spec.ts` (`e2e/playwright.config.ts`: Chromium only, one worker), which builds and starts `scripts/serve.ts` on port 8199 itself. Needs Chromium once: `npx playwright install chromium`.
- `npm run typecheck`: `tsc --noEmit` over `src/`, `tests/`, `scripts/` and `e2e/`.
- `npm run lint`: ESLint, typescript-eslint `strictTypeChecked`.
- `npm run format:check`: Prettier. `data/`, `web/js/`, `extraction/`, `test-results/` and `playwright-report/` are not formatted.
- `npm test`: `node --test` on `tests/**/*.test.ts`, run directly from TypeScript, with a 90 % line-coverage floor on `src/core/`.
- `npm run data:check`: every file in `data/<aircraft-engine>/` against the schema, and its SHA-256 against `manifest.json`; the manifest's `pdfSha256` against the pinned manual.
- `npm run types:gen`: writes `src/core/data/types.ts` from `schema/charts.schema.json` (json-schema-to-typescript).
- `npm run types:check`: fails if regenerating `types.ts` would change it.

## Extraction

The manual PDF is never committed. It lives only on the maintainer's machine; `PERF_PDF` holds its path. The extractor refuses any file whose SHA-256 is not `7954f2391a66bffc79d77027cdb5063a332ba31a693dba1e42f0a67b276c791b` (HAF supplement, Change 8, 722 pages).

```
cd perf && nix develop .. -c python3 -I extraction/extract.py "$PERF_PDF" [id ...]
```

With no ids it extracts every spec in `extraction/specs/`. It stops at the first failed assert, naming the figure, panel and reason. `nix develop` provides PyMuPDF, PyYAML and Pillow (`flake.nix`).

- Specs: `extraction/specs/<id>.yaml`, one per data file, hand-written. The spec declares meaning (axes, panels, parameters, expected order, corrections, sample problems); the extractor only measures. The format is in `docs/wip/TOLD.md` 0.2; 0.5 is a worked example. Optional panel keys added in step 1 (rulings P1, P3 to P6 of `docs/wip/TOLD-STEP1-P1.md`). Without them a spec extracts as before:
  - `curve_family` `filter.join: true`: builds the curves as guide lines are built. Chains are split into pieces monotonic along the input, and pieces are joined across gaps (label-leader knockouts, dashes). `min_span_pt` (default 5 with join) and `min_points` then apply to the joined lines. With join only: `filter.max_gap_pt` (default 9, the widest gap along the input that is joined), `filter.min_chain_pt` / `filter.max_chain_pt` (keep only chains at least / at most this long before joining, to take a solid or a dashed family from one clip).
  - `guideline_panel` `filter.max_gap_pt` (default 9): the same join gap, per panel.
  - `curve_family` `label_tol_pt` (default 3): how near its curve a label anchor must be, and how far the next curve must be.
  - `curve_family` `param.shared: [[18, 20]]`: one printed curve labelled with several consecutive values ("18/20"). It takes one anchor in `labels`, at its first value's place. The curve is written once per value, and `order` is not checked between the values of a group.
  - `single_curve` `anchor: [x, y]`: the curve is the one chain within the label tolerance of this page point, and the other chains in the clip are ignored. `count_in_clip` asserts how many chains the clip holds, and `label_tol_pt` sets the tolerance. Both work only with `anchor`.
  - Two relaxations that need no key: a point exactly level with the previous one along the input and under 0.5 pt from it is dropped (a micro-segment on a grid line). A monotonic check allows 0.5 page pt against its direction, measured from the extreme so far, so jitter passes and a drift fails.
  - Unscaled axis `{unit: pt, page: x | y, unscaled: true}`: the unlabelled line a pilot carries from one panel into the next (B2-5, B2-6, B7-2 sheet 1). It takes no `label_band`, `range`, `ticks`, `title` or `edge` (the extractor refuses them) and gets the identity transform, so its values are page points. An `order` check on it uses 0.5 % of the panel frame's extent as its tolerance.
  - `limit_line` panel (B7-2 sheet 1): required `id`, `type`, `clip`, `frame`, `input`, `output` (the axes of the panel it lies over), `label` (the printed text), `beyond: above | below` (the side where the limit is exceeded, in output terms) and `max_dash_pt` (the longest segment kept as a dash); optional `filter.min_span_pt` (default 5; set it above the longest curve stub in the clip) and `filter.stroke_width`. The extractor joins the dashes and asserts exactly one line, one way along the input, inside the frame. Core judges a point only inside the line's drawn input range (`beyondLimit`, `src/core/read/limit-line.ts`); on the line is not beyond it.
- Data: `data/f16c-f110-129/` (`<id>.json`, `pages/<id>.png`, `manifest.json`). `dataVersion` goes up only when a file hash changes; a re-run with nothing changed is byte-identical.
- Overlays: `extraction/out/overlay-<id>.png`, the extracted curves in red over the page, gitignored. For a person to look at when something seems off; no sign-off.
- Errata: `extraction/manual-errata.yaml` lists known misprints in the manual (figure, where, printed, correct, reason). The sample-problem tests read it. Misprints are never patched silently.
- Hand-read checkpoints: `extraction/checkpoints/<id>.yaml`, for the charts the manual gives no sample problem for (B2-5 sheets 1 to 3, B2-6 sheets 2 and 3; 15 in all). Each entry has `inputs` and `expected` (the sample runners' keys, numbers only), `tolerance_kias`, `source: hand`, `read_by` and `date`. They were read off 300 dpi renders of the page before the spec existed, by a reader who saw no extracted data. `tests/checkpoints.test.ts` runs them through `SAMPLE_RUNNERS` (`tests/helpers/sample-runners.ts`), as `tests/sample-problems.test.ts` does the specs' `sample_problems`. They are kept apart from the specs so the lane that writes a spec does not edit them; a failing checkpoint is investigated on both sides.

`extraction/` is plain Python run by hand: no type checker, no lint, no tests, only its asserts (ADR 0153).

### Commit order

The manifest records the commit that last produced the data (`git rev-parse --short HEAD` at that run, with `-dirty` when `extraction/` had uncommitted changes). A re-run that changes no file keeps the recorded commit, so it is not simply the current HEAD. So:

1. Commit the extractor or spec change.
2. Re-run the extractor.
3. Commit the data.

## CI

`.github/workflows/perf-docker.yml` runs on every push touching `perf/**` or `crc-sync/src/altimetry.js`: `npm ci`, then `lint`, `format:check`, `typecheck`, `build`, `types:check`, `data:check` and `test`, then `npx playwright install --with-deps chromium` and `npm run e2e`. CI never extracts: it has no PDF, and it checks the committed data instead. Plan 4 adds the Docker image build and the deploy.
