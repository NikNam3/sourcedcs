# TOLD: handoff (2026-11-12, plan 3 merged)

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

**Step 1 plan 4: deployment.** The Docker image (build-and-push in `perf-docker.yml` on `main`, `dev` and `v*` tags),
nginx serving `/f16/` from `web/` and `/f16/data/` from `data/` (as `scripts/serve.ts` does locally), and `deploy.yml`
listening to the workflow. The domain `perf.sourcedcs.page` resolves to the prod server and its Let's Encrypt certificate is issued
(12 Nov 2026, `/etc/letsencrypt/live/perf.sourcedcs.page/` in the `certbot-certs` volume, renewed by the `certbot`
container). The infra commit (`PERF_DOMAIN`, compose, nginx, `deploy.yml`) is still its own final commit. When it is deployed, TOLD.md 1.5's last box ("Deployed;
data version visible; perf/README.md current") closes step 1.

How plan 3 ran, for reuse: one lane worktree per task (`../sourcedcs-told-p3-t<N>` on `lane/told-p3-t<N>` off
`perf-told-p3`), at most 4 agents at once, all on Opus, a task review after each lane. Lanes ran only their own test
files; the supervisor ran the full gates (`nice -n 19`) and merged. The session ledger, task reports, reviews and the final review in
`.superpowers/sdd/TOLD-STEP1-P3/` are uncommitted scratch, kept for the morning review; what matters from them is copied into the plan and
TOLD.md.
