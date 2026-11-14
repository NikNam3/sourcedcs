# Changelog

## 0.1.0 (12 Nov 2026)

Step 1 (`docs/wip/TOLD.md` 1.6 to 1.8 and "Deployment and operations"): the TOLD calculator, deployed at `https://perf.sourcedcs.page/f16/`.

- Data for Figures B2-4, B2-5 sheets 1 to 3, B2-6 sheets 1 to 3, B7-1 and B7-2 sheets 1 and 2, with one figure function per chart and hand-read checkpoints for the charts without a sample problem (plan 1). Data version 8.
- Core: `computeTold(figures, inputs, loadout)`, every MDC TOLD cell exact and conservative (takeoff MIL and MAX AB, landing normal and heavyweight, dry and wet) with rule marks, out-of-chart reasons and the exact trace; input parsing and derived values; the drag index builder on Fig. B1-1 (plan 2).
- Path marks in the core: `PathMark`, `ctx.mark` in every figure function, `tracePaths` (plan 3).
- The TOLD page `web/index.html`: inputs as typed (thousands separators, "230 / 08 G15" wind, "dry / wet" RCR, defaults as placeholders), the drag index builder with its store menu, the TOLD tables with "Fig." links, rule lines and reason lines, the derived line.
- The figure page `web/figure.html`: one view per figure and takeoff or landing weight, the exact paths over the page image in SVG, circled letters and their key, stacked sheets, reason lines where a path stops.
- The Limitations page `web/limitations.html`, with the data and app versions.
- State in the URL hash (`#v=1&…`) and localStorage (`perf.f16.v1`); a link from another version is refused with a note.
- Print on one A4 or Letter page, black on white, problem values boxed; dark mode through the tokens.
- `scripts/serve.ts` (`npm run serve`), the Playwright smoke spec `e2e/smoke.spec.ts` (`npm run e2e`), and the smoke spec in CI.
- The Docker image (`Dockerfile`, `nginx/default.conf`) built and pushed by `perf-docker.yml` on `main`, `dev` and `v*` tags, and the `perf` service with its `PERF_DOMAIN` vhost in `infra/` (plan 4).

## Step 0 (foundations, before 0.1.0)

Step 0: foundations (`docs/wip/TOLD.md`).

- Package scaffold: TypeScript with `tsc` as the only build tool, native ES modules, `node --test` on `.ts`, ESLint `strictTypeChecked`, Prettier.
- JSON Schema `schema/charts.schema.json` as the contract between extraction and core; `src/core/data/types.ts` generated from it; `data:check` against the schema and the manifest hashes.
- Building blocks in `src/core/read/` (interpolation, curve family, guideline panel, scale pair, table) returning a value or `OutOfChart`.
- Read context `src/core/ctx.ts`: exact pass and conservative value by a single-point test per rounding point, with the exhaustive search as a test oracle.
- Manual errata file `extraction/manual-errata.yaml` and its loader; first entry B7-2 sh. 2.
- Spec-driven extractor: one YAML spec per figure, PDF SHA-256 pin, geometric asserts, chart JSON with axis transforms, greyscale page images, overlays, manifest.
- Data for Figures B1-1 (tables), B2-1, B2-2 and B2-3 of the F110-GE-129.
- Figures B2-1 to B2-3 in `src/core/figures/` and the manual's sample problems as golden tests (2 %).
- Design tokens, component stylesheet and print stylesheet in `web/css/`.
- ADRs 0148 to 0153, `README.md`, and the CI test workflow `perf-docker.yml`.
- Step 0 done: B2-1 to B2-3 extracted and their sample problems passing (the step 0 gate). The planning prototype `perf/prototype/` is removed (b3fb1202); comments that came from it name `git show b3fb1202^:perf/prototype/…`.
