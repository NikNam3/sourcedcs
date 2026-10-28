# perf

The F-16 performance calculator of the SOURCE tool suite. Step 1 is TOLD: takeoff and landing data for the F-16C with the F110-GE-129, as a pilot working the charts of T.O. GR1F-16CJ-1-1 (HAF supplement, Appendix B) by hand would get it. Every result has an exact and a conservative value. The values are copied by hand onto the mission data card.

perf is a static app: all calculation runs in the browser, the server only serves files. It is public, without login. The plan is `docs/wip/TOLD.md`; the decisions are ADRs 0148 to 0153 in `docs/adr/`.

Status: step 0 (foundations). There is no UI yet.

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
- `src/web/` is the only code that fetches the data files. `tsc` emits it to `web/js/` (gitignored).

## npm scripts

Node 22.18 or later. Run them in `perf/` after `npm ci`.

- `npm run build`: `tsc -p tsconfig.build.json`, `src/` to `web/js/`.
- `npm run typecheck`: `tsc --noEmit` over `src/`, `tests/` and `scripts/`.
- `npm run lint`: ESLint, typescript-eslint `strictTypeChecked`.
- `npm run format:check`: Prettier. `data/`, `web/js/` and `extraction/` are not formatted.
- `npm test`: `node --test` on `tests/**/*.test.ts`, run directly from TypeScript, with a 90 % line-coverage floor on `src/core/`.
- `npm run data:check`: every file in `data/<aircraft-engine>/` against the schema, and its SHA-256 against `manifest.json`.
- `npm run types:gen`: writes `src/core/data/types.ts` from `schema/charts.schema.json` (json-schema-to-typescript).
- `npm run types:check`: fails if regenerating `types.ts` would change it.

## Extraction

The manual PDF is never committed. It lives only on the maintainer's machine; `PERF_PDF` holds its path. The extractor refuses any file whose SHA-256 is not `7954f2391a66bffc79d77027cdb5063a332ba31a693dba1e42f0a67b276c791b` (HAF supplement, Change 8, 722 pages).

```
cd perf && nix develop .. -c python3 -I extraction/extract.py "$PERF_PDF" [id ...]
```

With no ids it extracts every spec in `extraction/specs/`. It stops at the first failed assert, naming the figure, panel and reason. `nix develop` provides PyMuPDF, PyYAML and Pillow (`flake.nix`).

- Specs: `extraction/specs/<id>.yaml`, one per data file, hand-written. The spec declares meaning (axes, panels, parameters, expected order, corrections, sample problems); the extractor only measures. The format is in `docs/wip/TOLD.md` 0.2; 0.5 is a worked example.
- Data: `data/f16c-f110-129/` (`<id>.json`, `pages/<id>.png`, `manifest.json`). `dataVersion` goes up only when a file hash changes; a re-run with nothing changed is byte-identical.
- Overlays: `extraction/out/overlay-<id>.png`, the extracted curves in red over the page, gitignored. For a person to look at when something seems off; no sign-off.
- Errata: `extraction/manual-errata.yaml` lists known misprints in the manual (figure, where, printed, correct, reason). The sample-problem tests read it. Misprints are never patched silently.

`extraction/` is plain Python run by hand: no type checker, no lint, no tests, only its asserts (ADR 0153).

### Commit order

The manifest records the extractor's commit (`git rev-parse --short HEAD`, with `-dirty` when `extraction/` has uncommitted changes). So:

1. Commit the extractor or spec change.
2. Re-run the extractor.
3. Commit the data.

## CI

`.github/workflows/perf-docker.yml` runs on every push touching `perf/**` or `crc-sync/src/altimetry.js`: `npm ci`, then `lint`, `format:check`, `typecheck`, `types:check`, `data:check` and `test`. CI never extracts: it has no PDF, and it checks the committed data instead. Step 1 adds the Docker image build and the Playwright smoke spec.
