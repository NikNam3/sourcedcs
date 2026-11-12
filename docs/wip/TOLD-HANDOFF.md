# TOLD: handoff (2026-11-12, step 1 deployed)

Work in the worktree `/home/nklx/dev/personal/sourcedcs-perf`. Never switch the branch of the main checkout
`/home/nklx/dev/personal/sourcedcs` (a crc session works there on `main`).

## State

- **Step 0 (Foundations)** is merged into `main` (PR #146).
- **Step 1 plans 1 (data and figure functions) and 2 (core)** are merged into `main` by PR #147 (merge commit
  1d7205e7, 12 Nov 2026).
- **Step 1 plan 3 (UI and state)** was approved by the human on 12 Nov 2026 and merged into `perf-told`, then into
  `main` by a PR with a real merge commit.
  - Core: `src/core/path/` (`PathMark`, `ctx.mark` in every figure function, `tracePaths`).
  - Web: `src/web/` (layout in `perf/README.md`), the pages `web/index.html` (TOLD), `web/figure.html` (one figure
    view with the exact paths) and `web/limitations.html`, `css/told.css`, `figure.css`, `limitations.css`, print.
  - State in the URL hash (`#v=1&…`) and localStorage (`perf.f16.v1`); `scripts/serve.ts` (`npm run serve`).
  - The Playwright smoke spec `e2e/smoke.spec.ts` (`npm run e2e`, 7 tests, Chromium, one worker), also in CI
    (`.github/workflows/perf-docker.yml`).
  - App version 0.1.0 (`perf/CHANGELOG.md`).
- **Where things are:**
  - Spec: `docs/wip/TOLD.md` 1.8 (plan 3's spec, with its status line). 1.7 and 1.6 are plans 2 and 1.
  - Plan: `docs/wip/TOLD-STEP1-P3.md`, with the supervisor's rulings R1 to R6 and the parked review findings in its
    "Ledger: supervisor rulings" section.
  - Commands and layout: `perf/README.md`.
- The manual PDF is at `/home/nklx/dev/other/HAF-F16-Supplement.pdf` (SHA-256 verified against the pin). Export it as
  `PERF_PDF`; Python runs inside `nix develop` from the worktree root.

## Next

**Step 1 is done** (12 Nov 2026). Plan 4 merged by PR #150 (96e8cc6a) and deployed: `https://perf.sourcedcs.page/f16/`
serves the app with data version 8, and the Playwright smoke spec passes against production. The server's `infra/.env`
carries `PERF_DOMAIN` (the human edits that file, never an agent). Next is step 2 in `docs/wip/TOLD.md`.
