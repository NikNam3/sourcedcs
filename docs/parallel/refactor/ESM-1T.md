# ESM-1T (a, b, c): convert the client test files to ES modules

> Read `README.md` and `ESM-1.md` in this folder first. Three lanes run this same briefing, each on its own
> partition. The supervisor tells you your letter.

| | |
|---|---|
| Wave | W1, after ESM-1's "sources converted" commit (ESM-1 step 3). You are **cut from ESM-1's branch at that commit**, not from the integration branch |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-ESM-1T<x>` on `lane/ESM-1T<x>-tests` |
| ADR / E2E | none / none (ESM-1 runs the unit's Playwright) |
| Size / model | 0.5 lane each / Sonnet 5.5 |

## Goal

Every test file in your partition becomes `crc-desktop/tests/<name>.test.mjs`. It imports the client modules directly
and passes, with the same assertions. No assertion is weakened or deleted.

## Partitions (list your exact files at step 0; a file matching none goes to c)

| Lane | Files (`crc-desktop/tests/`) |
|---|---|
| **a**: parity, contracts, mirrors | `client-mirror-parity`, `ws-message-contract`, `bay-descriptor-parity`, `efsp-block-map-parity`, `efsp-nla-client`, `efsp-coordination-client`, `efsp-ui-reachability`, `efsp-strip-template`, `efsp-time-chains`, `overflight-shared-state-names`, `helpers/mirror-source.js` |
| **b**: Board, Strips, Bays, state | `efsp-bay-views`, `efsp-strip-fields`, `efsp-gestures`, `efsp-refusal-banner`, `efsp-ui-a`, `efsp-dot-command`, `efsp-annotation-model`, `efsp-arrivals`, `efsp-state`, `efsp-state-archive`, `efsp-order-key-insertion`, `efsp-panel-drop-targets`, `efsp-marsa-client`, `efsp-correlation-client`, `efsp-sfa-client`, and merge4's `efsp-resync-state` |
| **c**: panels, map, the rest | `efsp-field-state-client`, `efsp-ato-first-filing`, `efsp-ato-import`, `efsp-ato-strip`, `efsp-scramble-client`, `efsp-ordnance-client`, `efsp-metrics-client`, `efsp-metrics-hooks`, `metrics-panel`, `efsp-stereo-panel`, `efsp-stereo-routes-client`, `efsp-mission-line-panel`, `efsp-carrier-client`, `efsp-final-panel`, `efsp-airspace-panel`, `efsp-flight-plan-lookup-client`, `coverage-panel`, `atc-scope`, `los-math`, `magnetic-display`, `track-label`, merge4's `e2e-spec-hygiene` |

`packaging-config`, `client-global-surface` and the new `module-graph` are ESM-1's. `lxsrs-setup`, `patch-notes` and
`server-proxy-routes` test the Electron main process and the local server, which stay CommonJS. Leave them as
`.test.js`.

## Owns / frozen

Owns: your partition's test files (renamed to `.mjs`) and test-only helper files that only your partition uses (list
them). Frozen: `crc-desktop/app/**` (if a test needs a source change, such as an explicit setter instead of a
`globalThis` stub, SendMessage "main" with the exact change; ESM-1 makes it), other partitions' files, and
`tests/helpers/dom-stub.js` (shared: ask before editing).

## Steps

1. `require(...)` of a client file becomes `import`. `require` of crc-sync CommonJS modules stays possible through
   `createRequire(import.meta.url)`, or `import x from '…cjs'`.
2. `vm.runInContext(fs.readFileSync(src))` loaders: import the module instead. Where the test evaluated a script for
   its side effects on a sandbox, import it after setting the DOM stub globals (`document`, `window`), and use dynamic
   `await import()` if the order matters.
3. **`globalThis` stub injection no longer reaches a module** (it reads its imports, not globals). Feed the real state
   module through its setters (`applyEfspSnapshot`, `_resetEfspStateForTest`, and the like), or use the explicit setter
   ESM-1 added. `document`, `window` and other true browser globals can still be stubbed on `globalThis`.
4. Keep test names identical, so the counts compare one for one. Note any test that becomes two, or two that become one.

## Acceptance

- Your partition: every test passes, with the same test count as before your conversion (state both).
- `grep -n "runInContext\|runInNewContext\|runInThisContext\|require(" <your files>` shows only crc-sync CommonJS
  requires through `createRequire`.
- Report: your file list, the setters you asked ESM-1 for, any test you could not convert as-is and why.
