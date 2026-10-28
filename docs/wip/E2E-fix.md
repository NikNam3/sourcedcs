# E2E-fix — the 13 consistent Playwright failures (lane 9)

Result: full suite `E2E_LANE=9 npx playwright test` on `lane/E2E-fix`: **115 passed, 0 failed** (12.0 min).
Before: 99 passed, 13 failed, 3 did not run (same tree, first run of this lane).

## Causes and fixes

| Failure | Kind | Fix |
|---|---|---|
| ordnance-hung "CLEAN clears it" | stale test | deleted `standInFieldState`; the real L1b client renders the pad name, so the first walk asserts "Hung ordnance. SOURCE practice: after landing, taxi to Hot cargo pad" |
| alert-scramble wording | stale test | shipped placeholder is "ALERT ACCESS TAXIWAY" (facility-config.js); assertions use it |
| l16-picker-and-times | harness | `playwright.config.js` installs `e2e/fixtures/l16-stereo-routes.json` by default; `E2E_STEREO_ROUTES=none` gives an empty table and the spec skips |
| l4-chain / l4-drag / l5-arrivals (4) | cross-file state leak | alert-scramble and field-state failed mid-walk, leaving a scramble / a suspended runway 05/23. Root failures fixed; plus `helpers/test.js` `_freshField` auto fixture: on the first test of each spec file a throwaway controller holding TWR/OPS/APP walks INCIRLIK back to OPEN (pending request, change, works, inspection, closure). alert-scramble also retires its Strips in `afterEach` |
| field-state Phase 3 duplicate `.efsp-alert-reason` | leak, not a product bug | the non-empty line was alert-scramble's "VIPER11 is scrambling..." reason, left on the Board when that spec failed at the wording assertion. field-state alone and after a passing alert-scramble is green. (The rwy alert's `reason: null` still renders an empty `.efsp-alert-reason` div; harmless, the spec uses `:not(:empty)`.) |
| l14-ato-import | leak (two causes) | l1-touch-targets left a live VIPER11, so the plan saw two candidates and said CREATE, not BIND: it now retires it (`dropStrips` in helpers/app.js). l1-popovers leaves random `L####` MISSION Strips, so l14 counts only the ATO's five callsigns |
| l4-badges 30 > 28 px | **product regression** | `.efsp-strip .efsp-ind` uses `all: unset` (content-box) with `height:22px` plus a 1px border: every chip was 24px, first indicator row 24 + 6 gap = 30. Added `box-sizing: border-box` in efsp-panel.css. Budget untouched |
| l15-metrics `= 0 flights` | stale assumption, newly exposed | alert-scramble now runs to completion (flights airborne) so the run's traffic count is not 0. Asserts the partition reconciles instead |
| CDN hiccups | harness | `dockview-core@5.1.0` and `maplibre-gl@3.6.2` are devDependencies of crc-desktop, served from `node_modules` by `page.route` on every context (`helpers/test.js`; all specs now import `./helpers/test` instead of `@playwright/test`) |

Also: `settleCorrelation` wait 10 s -> 20 s (l1-popovers flaked once at load).

## Notes for other lanes / the briefing

- New specs must `require('./helpers/test')`, not `@playwright/test`, or they load from the CDNs.
- The Board and crc-sync live for the whole run. A spec that leaves a Strip behind is visible to every later
  file (l1-touch-targets/VIPER11, l1-popovers/L####, alert-scramble/scramble). Retire what you create.
- A run killed by `timeout` leaves the lane's webServers listening (ports 3019/3119); stop by PID.
- Not touched: L23-owned crc-sync files (permission.js, board-store.js coordination paths).
- Remaining fragility: l15's traffic count and l1-popovers' correlation redraw are load-sensitive; none seen in the final run.
