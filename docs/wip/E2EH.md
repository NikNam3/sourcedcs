# E2EH — Playwright isolation (lane E2E-harden)

Branch `lane/E2E-harden`, cut from `integ/wave3-dry` (0935ee5). Lane 0 only.

## What exists now

- **Reset hook (product, test-only).** `crc-sync/src/test-reset.js`, mounted by one line in `server.js` before the static
  middleware. It mounts nothing unless `CRCSYNC_TEST_RESET` is exactly `1`; with `NODE_ENV=production` it throws at boot;
  its routes answer loopback peers only. `GET /__test/boot` returns a per-process `bootId`; `POST /__test/reset` answers and
  exits with code 75. It does NOT try to clear stores in process (every store, monitor, replay cache and ring would have to
  be listed, and the next one added would silently be missing): a new process is a known Board by construction (~0.8 s boot).
- **Supervisor (harness).** `crc-desktop/e2e/helpers/sync-supervisor.js` is the webServer command for crc-sync in
  `playwright.config.js`. On exit 75 it wipes the throwaway state dir (snapshot, Mutation log, metrics, traffic count, terrain)
  and starts crc-sync again; any other exit ends it.
- **Fixture.** `helpers/test.js` auto fixture `_freshSync`: first test of each spec file calls `resetSync(file)` (boot id
  before, POST, poll until the boot id changes). A marker file `<tmp>/crc-e2e-laneN-fresh-for` (`bootId|file`) stops a worker
  restart after a failed test from wiping the rest of the same file. Replaces the old `resetFieldState` walk.
- **Proof it cannot run in the image.** `crc-sync/tests/test-reset.test.mjs` (6 tests): nothing mounts for unset/`0`/`true`/` 1`;
  mounting under `NODE_ENV=production` throws; routes are loopback-only; Dockerfile, `infra/docker-compose.yml` and
  `.env.example` never mention the variable; the REAL `server.js` without the variable answers 404 to both routes and survives
  the POST; with it, reset exits 75.
- **Hygiene check.** `crc-desktop/tests/e2e-spec-hygiene.test.js` (part of `npm test`): every `e2e/*.spec.js` requires
  `./helpers/test` and not `@playwright/test`; the config uses the supervisor. `tactical-positions.spec.js` was the one spec
  that did not (so it got neither the CDN vendoring nor a reset).
- **Order tool.** `crc-desktop/e2e/tools/run-order.js`: `--alone` (each file its own run and servers), `--shuffle --seed N`
  (every file once, shuffled, one shared server pair started by the tool; Playwright always runs files in name order within
  one invocation, so this is one invocation per file with `E2E_REUSE_SERVERS=1`), `--order a,b`, `--only a,b`. Writes
  `test-results/run-order-*.json`.

## Fixes to specs

| Spec | Problem | Fix |
|---|---|---|
| ordnance-hung "pilot walks" | asserted "Runway 05/23 (05) assigned"; a fresh crc-sync has no active runway (the harness has no mission wind), an earlier spec set it | `ensureActiveRunway(page, '05')` in `helpers/app.js` (self-coordinated change by one TWR+OPS+APP controller) |
| tactical-positions 06 (19-21 s of 20 s) | whole-test ceiling, every wait inside is already on state | `describe.configure({timeout: 90000})`, and global per-test timeout 20 s -> 60 s in `playwright.config.js` (waits keep their own 5-10 s) |
| l1-nla-clearance-chain, l1-popovers (4 tests) | hit the 20 s test ceiling on a loaded machine | same 60 s ceiling |
| l15-metrics | asserted staleness "not instrumented (L19)"; L19 has since declared the source | expects NO DATA / "nothing in this window" |
| (all) | `finite` declared twice | see finding 1 |

## Results

Machine was shared with ~10 other lanes' Playwright runs (timings are inflated and noisy; not a benchmark).
Seconds are whole-invocation (include ~5 s Playwright start; "alone" includes starting both servers).

| spec file | tests | alone | shuffled seed 11 | runtime alone / shuffled |
|---|---|---|---|---|
| alert-scramble | 1 | pass | pass | 82 s / 33 s |
| field-state | 4 | pass | pass | 190 s / 90 s |
| l1-marsa | 5 | pass | pass | 80 s / 28 s |
| l1-nla-clearance-chain | 4 | pass (after 60 s ceiling; failed once at 20 s) | pass | 22 s / 22 s |
| l1-overlays | 2 | pass | pass | 15 s / 8 s |
| l1-popovers | 21 | pass (after 60 s ceiling; 4 failed at 20 s) | pass | 172 s / 180 s |
| l1-touch-targets | 1 | pass | pass | 17 s / 9 s |
| l14-ato-import | 1 | pass | pass | 30 s / 11 s |
| l15-metrics | 2 | pass (after assertion fix) | pass | 21 s / 18 s |
| l16-picker-and-times | 2 | pass | pass | 68 s / 14 s |
| l17-carrier | 5 | pass | pass | 210 s / 46 s |
| l19-surveillance-hints | 2 | pass | pass | 33 s / 42 s |
| l2-block-editing | 16 | pass | pass | 137 s / 93 s |
| l22-stars-scope | 5 | pass | pass | 79 s / 41 s |
| l3-coordination | 15 | pass | pass | 251 s / 219 s |
| l4-badges | 4 | pass | pass | 29 s / 16 s |
| l4-chain | 4 | pass | pass | 114 s / 117 s |
| l4-density | 2 | pass | pass | 19 s / 14 s |
| l4-drag | 5 | pass | pass | 88 s / 65 s |
| l5-arrivals | 5 | pass | pass | 77 s / 45 s |
| marsa-popover | 3 | pass | pass | 41 s / 19 s |
| mtr-fields | 7 | pass | pass | 99 s / 107 s |
| mtr-pilot-walk | 1 | pass | pass | 43 s / 42 s |
| obligation-retract | 2 | pass | pass | 17 s / 21 s |
| ordnance-hung | 2 | pass | pass | 42 s / 38 s |
| smoke | 1 | pass | pass | 8 s / 4 s |
| tactical-positions | 5 | pass | pass | 59 s / 51 s |
| u6-block-altitude | 1 | pass | pass | 12 s / 11 s |
| ui-a | 6 | pass | pass | 49 s / 72 s |

Seed 11 order: alert-scramble, tactical-positions, l1-touch-targets, l15-metrics, marsa-popover, l4-drag, u6-block-altitude,
mtr-pilot-walk, l1-popovers, ordnance-hung, l1-overlays, l1-nla-clearance-chain, l22-stars-scope, l1-marsa, l4-density,
l17-carrier, l14-ato-import, smoke, l5-arrivals, l16, obligation-retract, l19, field-state, l2-block-editing, mtr-fields,
l4-badges, l4-chain, ui-a, l3-coordination: **29/29 green, 1476 s.**

Alone: the first pass had 26/29 (the three above); the three were fixed and re-run alone green (l1-nla 22 s, l15 21 s,
l1-popovers 172 s). The alone column is therefore from two runs on the same tree except for those three files' fixes.

### Not finished (session ended)

- **Second shuffled run (seed 29) was interrupted at file 14/29** (mtr-fields, l4-drag, l1-nla, marsa-popover, field-state,
  l4-badges, u6, l1-marsa, l22, mtr-pilot-walk, l4-chain, l4-density, ordnance-hung, smoke ran). Two FAILs in it are NOT
  trustworthy: `l4-chain` took **2781 s** (the machine was stalled/suspended; its failing test saw 0 Strips after 10 s) and
  `ordnance-hung` right after failed on `net::ERR_INTERNET_DISCONNECTED` fetching `unpkg.com/maplibre-gl` (the network was
  down; a request that the `page.route` vendoring did not catch, see finding 3). Neither reproduced in the other 29-file
  shuffle or alone. **Re-run `node e2e/tools/run-order.js --shuffle --seed 29` and the one-full-suite-alone-style run;**
  the lane's brief asks for two shuffled full runs, one is done.
- `--repeat-each` was not used.
- Q3-16 (permanent pilot-request specs) not started. Q3-15 (vendor CDN into the product) not done: it is a product change
  and a HUMAN question.
- `docs/adr/0093` for the reset hook (Q3-29 option (a) reserves 0093 for E2E) not written.
- crc-sync / crc-desktop `npm test` suites were not re-run in full after the changes (only `tests/test-reset.test.mjs`,
  `tests/e2e-spec-hygiene.test.js` and `tests/efsp-final-panel.test.js`).

## Findings for other lanes

1. **Product bug on the merged tree (fixed here, own commit, droppable):** `final-panel.js` and `pattern-board.js` (both L18)
   each declare a top-level `const finite`; classic scripts share one global scope, so the second throws
   `SyntaxError: Identifier 'finite' has already been declared` on every page load and `final-panel.js` never runs. This is
   what failed `ordnance-hung` on a fresh server (it asserts no script errors). Fix: rename in `final-panel.js` to `finiteNum`
   (unit tests pass). The same collision class is invisible to the node tests (modules are evaluated separately); a test that
   concatenates index.html's script list into one scope would catch it. L18/L20/L28 branches still carry the duplicate.
2. A fresh crc-sync has no active runway; any spec or product text that names the runway needs `ensureActiveRunway`.
3. `helpers/test.js` vendors only the three CDN URLs `index.html` names; maplibre fetched `https://unpkg.com/maplibre-gl...`
   something else during the network outage (see seed 29 log). Likely a worker/sourcemap request; confirm when re-running.
4. The worker process re-evaluates `playwright.config.js`, so each worker creates another `mkdtemp` state dir (pre-existing
   leak under `/tmp/crc-e2e-lane0-*`); only the main process's directory is used by the servers.
5. Screenshots written by specs regenerate tracked PNGs in `docs/wip/`; revert with `git checkout -- docs/wip` before committing.

## Defaults taken

- Q3-14: (a) test reset, but implemented as exit-and-restart under a harness supervisor instead of in-process clearing (above).
- Product edit beyond the hook: one rename (finding 1), in its own commit.
- 60 s test ceiling globally (was 20 s) instead of per-spec tweaks.
