# Changelog

## Unreleased

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
- ADRs 0148 to 0153, this README, and the CI test workflow `perf-docker.yml`.
