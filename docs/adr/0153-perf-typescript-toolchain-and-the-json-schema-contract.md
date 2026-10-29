# 0153: perf's TypeScript toolchain and the JSON Schema contract

**Status.** Accepted (TOLD step 0 design review, 2026-10-28). Spec: `docs/wip/TOLD.md`, "Architecture and repository"
("Language and toolchain") and section 0.1.

## Context

perf is a new app with two halves: a Python extractor that turns the manual's charts into JSON, and a pure calculation
core that reads that JSON in the browser. The other Node services in the repo are plain JavaScript with no build step.
For perf that is no argument: the absence of a tool elsewhere in the repo is not a reason against it here (TOLD.md,
"Architecture and repository").

The core is a chain of chart reads where 0 kt, 0 % and DI 0 are valid values, and where a wrong field name in the chart
data gives a wrong number, not an error. The extractor runs only on the maintainer's machine, because the manual PDF
lives only there.

## Decision

1. **TypeScript for `perf/src/`.** `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
   `erasableSyntaxOnly`, `verbatimModuleSyntax`, `module`/`moduleResolution` `nodenext`,
   `rewriteRelativeImportExtensions`, `allowImportingTsExtensions`. Relative imports carry the `.ts` extension.
2. **`tsc` is the only build tool.** `npm run build` (`tsc -p tsconfig.build.json`) emits native ES modules from `src/`
   to `web/js/` (gitignored). No bundler, no framework.
3. **`node --test` runs the `.ts` tests directly** (type stripping, Node ≥ 22.18): no `ts-node`, no `tsx`. Hence
   `erasableSyntaxOnly`: no enums, namespaces or parameter properties. The coverage floor is 90 % of lines in
   `src/core/`, Node's built-in coverage.
4. **ESLint** with typescript-eslint `strictTypeChecked`, and `strict-boolean-expressions`,
   `switch-exhaustiveness-check` and `no-unnecessary-condition` as errors: a number is never tested for truthiness.
   **Prettier** for formatting.
5. **One JSON Schema is the contract** between extraction and core: `perf/schema/charts.schema.json` (draft-07,
   `additionalProperties: false` everywhere; the figure files, their panel types and the manifest).
   `src/core/data/types.ts` is generated from it by `json-schema-to-typescript` (`npm run types:gen`) and committed;
   `npm run types:check` fails when regenerating would change it.
6. **`data:check` is the only gate on the data.** It validates every file in `perf/data/<aircraft-engine>/` against the
   schema (Ajv) and its SHA-256 against `manifest.json`, which holds the data version, the PDF's SHA-256, the
   extractor's git commit and one hash per data file and page image. A file missing from the manifest, or a manifest
   entry with no file, is a problem. The Python side does not validate on write.
7. **Extraction is throwaway-grade tooling.** `perf/extraction/` is plain Python (PyMuPDF, PyYAML, Pillow from
   `flake.nix`), run by hand as `python3 -I` inside `nix develop`. It gets no type checker, no lint and no test suite,
   only its built-in asserts, which stop at the first failure with the figure, panel and reason. Its output is what
   matters, and that is checked twice: by `data:check` (shape and hashes) and by the sample problems as golden tests
   (values). Code that one person runs a few times per figure, on a file CI cannot have, gains little from a second
   tool chain.

## Consequences

- CI (`.github/workflows/perf-docker.yml`) runs `lint`, `format:check`, `typecheck`, `types:check`, `data:check` and
  `test` in `perf/`. CI never runs the extractor and never sees the PDF.
- A schema change is one edit in `charts.schema.json`, then `types:gen`, then a re-run of the extractor; the type
  checker shows every core reader the change touches.
- Files in `perf/data/` are written only by the extractor. A hand edit fails `data:check` on its hash.
- The data's provenance is in the manifest: the extractor commit (`-dirty` when `perf/extraction/` had uncommitted
  changes) and the PDF hash. So an extractor change is committed before the re-run, and the data after it.
- `src/core/` has no DOM, no `fetch`, no `node:` imports and no I/O, so other SOURCE tools can import it later.
