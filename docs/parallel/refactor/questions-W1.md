# Questioner, wave W1: points for R0, ESM-1, ESM-1T and the W2 lanes that depend on R0

Bases read: R0 `3dbb46a` (step 0), ESM-1 `914474c` (step 0), `829d1d5` (codemod) and `77cf674` (sources converted),
and the integration base `165a517`. Each point carries a **recommended answer** the lane can take as its default (P2).
Owner tags: `lane` means the lane settles it, `supervisor` means the supervisor rules, `human` means the human decides.
Nothing here needs the human.

## R0

**W1-R0-1 A peer+MARSA Mutation is reachable, so use a hub trace, not the stub (`lane`).**
Evidence: `board-store.js` `_retireStrip` (`:2085-2130`) computes `marsaChanged = _releaseFdrIfLastStrip(...)` first,
then, only for a Strip with `coordination.mintedForCoordination`, calls `peer.receiveCoordinationPeerGone(...)`. That
call returns `{ok, strip}` while the peer's link is PROPOSED or ACTIVE, even when the peer Strip is DROPPED (`:2449`).
`_applyDropStrip` refuses only a PROPOSED link (`:2061`). `liveStripsForFdr` (`index.js:226`) counts non-DROPPED Strips
across all Facilities. A recipe from the code (reasoned, not run): (1) PROPOSE coordination to the peer Facility,
(2) ACCEPT it (the link becomes ACTIVE), (3) create a MARSA relation on that fdr, (4) drop the **proposer's** Strip. Its
link is not `mintedForCoordination`, so nothing reaches the peer, and the replica is still live, so there is no MARSA
retire. (5) Drop the **replica**. Now `liveStripsForFdr` is 0, so `marsaChanged` is set, and the proposer's ACTIVE link
answers `ok`, so `peerStrip` is set. One frame then carries broadcast, peer and MARSA (and carrier too, for a
MARSHAL/FINAL/PATTERN Role). Why it matters: after WIRE, the order is built inside `efsp-ws.js`'s skeleton
(`broadcasts: [primary, peer, marsa, carrier, sfa]`) and `ws-hub.js` only loops over it. A stub fed to
`WsHub._onMessage` then tests the stub's own order, so it passes no matter what the skeleton does. M17 (WIRE's
version, "swap two entries of the list") would then be caught only by a real trace. **Recommended:** build the hub
trace through steps 1-5. Fall back to the stub only if a step is refused, and in that case see W1-W2-1.

**W1-R0-2 Seam rule 1 forbids what BOARD-1 must do (`lane`, tell BOARD-1).** Evidence: R0 step 7(1) lets only
`board/ops/*` require `board/strip-util.js`. But `_recordAudit` (`:584`) and `_recordPeer` (`:347`) call `deepClone`,
and BOARD-1's briefing moves `deepClone` into `strip-util.js` and the audit methods into `board/audit.js`. The plan's
own rule (§2.3.1) forbids requiring "board-store.js or a sibling **collaborator**". `strip-util` holds pure functions
and is not a collaborator. **Recommended:** any `board/**` file may require `board/strip-util.js` (and
`board/ops/index.js` its op files). `strip-util.js` itself may require nothing under `board/`. Add one good snippet
for this to the self-test.

**W1-R0-3 Rule 2 has to catch chained private reads (`lane`).** A naive `(\w+)\._x` scan matches `this._state` in
`this._state._strips` and then misses `._strips`, because the receiver's characters are already used up (checked with
perl on board-store: today every `._` read in the file has `this` as its receiver). That chain is exactly the
violation BOARD-1's collaborators are most likely to commit (W1-W2-3). **Recommended:** scan every `._name` and flag it
unless the receiver token right before it is exactly `this`. Add `this._state._strips` and `deps.state._log` as bad
snippets, and `this._rules.x` as a good one.

**W1-R0-4 The selfcheck runner never runs the tests that M14 and the seam test live in (`lane`).** Evidence:
`freeze-selfcheck.mjs` `runSuite` runs only `tests/freeze/freeze-*.test.mjs`, and `detect` names are those basenames.
After step 6 retargets M14 to `tests/clock-policy.test.mjs`, the mutation applies and no detector runs, so it reports
"NOT CAUGHT". **Recommended:** the runner also runs `tests/clock-policy.test.mjs` and `tests/board-seam.test.mjs`, with
`detect: ['clock-policy']`. Document the existing filter (`npm run freeze:selfcheck -- M3 M4 M7`) in the per-lane
retarget paragraph. S-TEST asks for the cheapest proof, and a filtered run costs the baseline plus three mutations
instead of about 5 minutes.

**W1-R0-5 The step-0 clock count is wrong, and the allow-list needs a key that survives defaults and duplicates
(`lane`).** Evidence: R0.md says "17 sites in 10 files", but its own list sums to 14 in 7, the same as
`guard-wall-clock.json`. The extra three are comment lines (`usmtf-time.js:11`, `carrier-store.js:29`, `nla.js:179`).
Five sites are default parameters (`wallNow = () => Date.now()` in `mutation-log.js:54`, `archiver.js:44`,
`traffic-count.js:342`, `metrics.js:161`, `metrics.js:757`), and `index.js:666` is a template literal. No parser is
installed (no acorn under crc-sync or crc-desktop `node_modules`). **Recommended:** key each entry on
`{file, function, count}`. A default parameter belongs to the function that owns the parameter list (`constructor` for
a class), and module level is `<module>`. Strip comments, strings and template-literal text before counting, keep
`Date\.now\b` (references, not only calls), and put a self-test on the enclosing-function finder.

**W1-R0-6 Lanes would not see a clock-policy or seam break until the end (`supervisor`).** The README's per-commit
gate is `node --test tests/freeze/freeze-*.test.mjs`. Both new tests sit outside that glob, so a BOARD lane that moves a
`Date.now()` site finds out only in the final `npm test`. **Recommended:** the per-commit gate becomes
`node --test tests/freeze/freeze-*.test.mjs tests/clock-policy.test.mjs tests/board-seam.test.mjs` (well under a second
more). One line in the README.

**W1-R0-7 The ADR question for the E2EH reset hook is assigned to R0, which cannot answer it (`supervisor`).** S-M-merge4
says "E2EH's reset hook has no ADR (0093 is taken; decide in R0)". R0 is tests-only and its briefing has no ADR.
**Recommended:** move it to L20 or to a post-window docs lane, and say so in decisions.md so R0 does not stall on it.

## W2 lanes that depend on R0's harness

**W1-W2-1 The stub order test has no W2 owner (`supervisor`, only if R0 falls back).** If R0 writes
`tests/freeze/freeze-hub-order.test.mjs`, WIRE's `broadcasts[]` change breaks it, because the stub returns named keys,
and it is not in WIRE's Owns. **Recommended:** add it to WIRE's Owns. WIRE then moves the order assertion to the
skeleton level (the test calls `handleMessage` on a stub family that yields all five broadcasts) so that M17 still has
a detector.

**W1-W2-2 M6 moves with BOARD-1's Placement, but BOARD-1 does not own it (`supervisor`).** M6's `find`
(``detail: `no such Bay here: ${bayId}` ``) is at `board-store.js:1180`, inside `_requireKnownBay`, which BOARD-1's
briefing moves to `board/placement.js`. BOARD-1 owns M3, M4 and M7 only, and the plan gives M6 to BOARD-3. After
BOARD-1, M6 reports "MUTATION DID NOT APPLY" and `freeze:selfcheck` fails. **Recommended:** add M6 to BOARD-1's Owns.
Before cutting BOARD-1, also check every M-file's `find` against the methods BOARD-1 moves (M1 and M2 sit in op paths,
so they stay with BOARD-3).

**W1-W2-3 BoardState's underscored fields conflict with seam rule 2 (`lane`: BOARD-1).** BOARD-1's design keeps
`_log`, `_seq`, `_epoch`, `_touchedSinceDrain` and `_cidSeq` on `BoardState`, and Placement needs the Strip map
(`this._strips` appears 22 times in board-store today). Reading `this._state._strips` from a collaborator breaks
rule 2. **Recommended:** BoardState exposes public members (`strips`, `get(id)`, `log`) for collaborators. Only the
facade keeps the `_strips`/`_log`/`_cidSeq` getters for tools and tests, as the briefing already says.

**W1-W2-4 R0 delivers what W2 assumes on every other count.** Checked: guard 1 already reads `boardSources()`
(board-store plus `board/**`), the folder layout lets lanes edit only their own M-files, `uncarried` is written only
by `freeze-world.mjs` `_record` (R0 edits it in W1 and APP edits it later in W2, in sequence), and WIRE owns M17.
Nothing to ask.

## ESM-1T pre-check (partitions a/b/c)

**W1-T-1 The partitions are complete and disjoint.** All 53 `crc-desktop/tests/*.test.js` land in exactly one place:
a 10, b 16, c 22, and 5 in ESM-1's or the CommonJS keep-list. `e2e-spec-hygiene` (c) loads no client file, so it can
stay `.js` unless the lane wants it uniform. The brace glob `node --test 'tests/*.test.{js,mjs}'` works on Node
22.22.1 (verified).

**W1-T-2 Almost every client test now evaluates `app.js`, which cannot load in Node (`supervisor`, blocks cutting
the T lanes).** Evidence at `77cf674`: 17 modules import from `./app.js`. These include `track-label.js`
(`settings`, `aircraftTypes`), `iff.js`, `strip-view.js` (`settings`, so all of bay-view and the EFSP panels),
`bay-views.js` and `atc-scope.js`. `app.js` still runs at module top level: `window.getAllTracks`/`getLatestTrack =`
(`:106-107`, a ReferenceError without `window`) and three `setInterval`s (`:327`, `:902`, `:907`), which keep a test
process alive. Through the cycle, `app.js` imports 31 more modules with top-level browser reads:
`dock.js` `window['dockview-core']`, `topbar.js` and `settings-panel.js` DOM lookups and listeners, `srs-radio.js`'s
IIFE, and `efsp-metrics-client.js`'s `beforeunload`. **Recommended:** (a) move `app.js`'s two window writes and three
`setInterval`s into `startApp()`. Ruling S-ESM1a(1) says "boot sequence", which should include them (see W1-ESM-2).
(b) Ship one `tests/helpers/client-env.mjs` in ESM-1 (it owns `tests/helpers/**`). It installs `window` (=
`globalThis`), `document` (dom-stub), `localStorage`, `requestAnimationFrame`, `WebSocket`, `fetch`, `maplibregl`,
`window['dockview-core']` and config.js's four vars. Every converted test imports it **first**: sibling imports
evaluate in order, so a plain static `import './helpers/client-env.mjs'` on line 1 is enough. Without it, three lanes
write three slightly different env stubs. (c) Optional, for later: moving `app.js`'s shared state (`settings`,
`tracks`, `history`, `map`, `mapReady`, `coverage*`, ...) into an `app-state.js` would cut 17 edges into the
composition root. That is beyond a syntax-only change, so it is not for W1.

**W1-T-3 A fresh sandbox per test becomes one shared module instance (`lane`, with a helper from ESM-1).** 17 vm tests
build their context inside a per-test function (`efsp-ui-reachability`, `efsp-stereo-panel`, `efsp-refusal-banner`,
`efsp-metrics-hooks`, `efsp-mission-line-panel`, `efsp-ato-first-filing`, `efsp-ordnance-client`,
`efsp-field-state-client`, `metrics-panel`, ...). Only five reset hooks exist (`atc-scope`, `carrier-state`,
`efsp-arrivals`, `efsp-state`, `sfa-state`), and none for `efsp-panel`, `bay-view`, `metrics-panel` or the other
panels, whose `init*()` would register listeners twice. **Recommended:** ESM-1 adds `tests/helpers/fresh-graph.mjs`, a
`module.register()` resolve hook that copies `?gen=N` from the parent URL onto every `app/public/js/` import, plus
`freshImport(rel)`. I prototyped it in the scratchpad on Node 22.22.1: two `freshImport`s give two independent graphs,
dependencies included. Per-test isolation stays as it is today, with no reset hooks added to panel code.

**W1-T-4 Names the tests read or write that are not exported (`lane`: ESM-1 adds the exports, T lanes ask for
nothing).** The codemod exported every name another **source** file reads, and every old `module.exports` name
(checked: none missing). Names only tests reach are still private at `77cf674`:
- a: `efsp-ui-reachability`: `_buildStripEl`, `_stripElNeedsRebuild`, `_isProtectedStripEl`, `_stripHasOpenPopover`,
  `_stripRenderSignature`, `TOFI_ANSWERED_BY` (bay-view), and it **writes** `_expandedStripId`.
  `efsp-coordination-client`: `CONVERT_TO_ARRIVAL_POSITIONS` (bay-view).
- c: `efsp-ato-strip`: `_buildStripEl`, `ALERT_SLOT_KEYS` (strip-view), and it writes `_expandedStripId`.
  `efsp-field-state-client` and `efsp-ordnance-client`: `_buildStripEl`. `efsp-metrics-hooks`: `flushEfspMetricsNow`
  (efsp-metrics-client), `_runEfspSearch` (efsp-panel), `_selectStrip`, `_buildStripEl`. `efsp-mission-line-panel`:
  `_dispatchDotCommand` (efsp-panel). `coverage-panel`: `renderCoverageList` (radar-panel).

  **Recommended:** export these, add `_setExpandedStripId(v)` in the existing `_set…` style, and record them in the
  exports fixture as test-only.

**W1-T-5 Stub injections, per partition, with the seam each one needs (`lane`).** "Real" means: feed the real module
through its existing setters (`applyEfspSnapshot`, `applyEfspDelta`, `_reset*ForTest`). Reading a stub through
`globalThis` no longer reaches a module. `setEfspSender` and `setSendToSync` already exist.

| Partition | Stubbed name (tests) | Seam |
|---|---|---|
| a, b, c | `getEfspStrip/Fdr/Rack/Bays/FieldState/CorrelationForStrip`, `getAllEfspStrips`, `marsaForStrip`, `marsaParticipantStripIds`, `activeMarsaForFdr`, `correlatedTrackIdForStrip`, `stripIdsForTrackId`, `liveStripsForCallsign` (bay-views, marsa, correlation, scramble, field-state, strip-template, ato-first-filing, stereo, mission-line) | real: `applyEfspSnapshot`/`applyEfspDelta` |
| a, b, c | `getActingPositions` (13 sandbox sites, 3 globalThis) | real: `sendEfspSetPositions(facility, held)` with `setEfspSender('sendEfspSetPositions', …)` or `setSendToSync` capturing the frame |
| a, b, c | `sendEfspMutation`, `sendEfspCreateStrip`, `sendEfspAirspace/Correlation/MarsaMutation` | `setEfspSender` (exists) |
| b `efsp-bay-views`, c `efsp-field-state-client` | `sendEfspSfaMutation`, `sendEfspFieldStateMutation` | **missing**: add both to `setEfspSender`'s switch (it throws for them today) |
| c `efsp-ato-import`, `efsp-metrics-hooks`, `metrics-panel` | `_sendEfsp`, `isSyncOpen` | `setSendToSync` covers the send. `isSyncOpen` reads `_syncSocket.readyState === WebSocket.OPEN`, so stub `globalThis.WebSocket` plus a socket, or **add** `setSyncOpenForTest` |
| b `efsp-refusal-banner` (counts rerenders), a/c (no-ops) | `renderAllOpenEfspBays` | counted: **add** a live-binding setter like the senders'. No-op uses: a `requestAnimationFrame` stub that never fires (the function is rAF-coalesced, `bay-view.js:3099`) |
| b `efsp-correlation-client` (counts), many no-ops | `updateMap` | same: setter where counted, rAF stub elsewhere (`geojson.js:905`) |
| b `efsp-correlation-client`, c `efsp-scramble-client` | `selectEfspStripById`, `getSelectedEfspStripId`, `getOpenEfspBayIds` | real bay-view state through `setOpenEfspBays` (exists) and `_selectStrip` (export, W1-T-4). Counted selects: **add** a setter |
| c | `lookupFlightPlanClient`, `listStereoRoutesClient`, `cachedStereoRoutesClient` (a, b) | stub `globalThis.fetch`. Both read `opts.fetch` or the global, and the cache fills from `listStereoRoutesClient` |
| c `atc-scope`, `track-label` | `settings`, `coverageRadars`, `coverageDatalink` (app.js `let`s) | **add** `_setSettingsForTest` / `_setCoverageForTest` in app.js, or feed `applyCoverage(msg)`, which is exported |
| c `coverage-panel` | `getActiveRadars`, `coverageHeldPositions`, `showLosProfile`, `sendEfspSetPositions`, `updateTopbarUI`, `isPanelPinned` | real via `applyCoverage` + `setEfspSender`. `showLosProfile` (counted): **add** a setter |
| b `efsp-ui-a`, `efsp-bay-views`, `efsp-carrier-client`, `efsp-correlation-client` | `Object.assign(globalThis, require(...))`, which exposed dependencies as globals | delete it, because imports do this now |
| c `efsp-carrier-client` | `projectPos` | real (`geo.js`, pure) |

The list of setters ESM-1 should add up front to save a round trip: `setEfspSender` cases `sendEfspSfaMutation` and
`sendEfspFieldStateMutation`; `setSyncOpenForTest`; live-binding setters for `renderAllOpenEfspBays`, `updateMap`,
`selectEfspStripById` and `showLosProfile`; `_setSettingsForTest` and `_setCoverageForTest`; `_setExpandedStripId`; and
the exports in W1-T-4. An alternative to the UI setters is `node:test` `mock.module`. It works on 22.22.1 only with
`--experimental-test-module-mocks` (verified: TypeError without the flag), so I advise against it.

**W1-T-6 `helpers/mirror-source.js` has two owners and now breaks (`supervisor`).** ESM-1 owns `tests/helpers/**`, and
the ESM-1T partition table gives `helpers/mirror-source.js` to a. Its `constLiteral` regex is
`^(?:const|let)\s+NAME`. At `77cf674`, `HAND_BACK_TO` (`bay-view.js:1724`) and `AIRSPACE_ENTRY_POSITIONS` (`:1931`) are
`export const`, so `client-mirror-parity` throws "renamed or moved". **Recommended:** ESM-1 owns it, changes the regex
to `^(?:export\s+)?(?:const|let)` now, and T-a leaves the helper as CommonJS.

**W1-T-7 There are two byte-compare tests for `time-chains.js`, and they must strip the trailer the same way
(`lane`).** crc-desktop `efsp-time-chains.test.js:23-27` (T-a) compares the whole client file with crc-sync's, and so
does crc-sync's `efsp-time-chains.test.mjs` (ESM-1). **Recommended:** ESM-1 puts the normaliser (bodies only, export
trailer dropped) in one shared helper, and both tests use it.

## ESM-1 (step 0 at `914474c`, converted sources at `77cf674`; S-ESM1a (1) and (2) are not re-opened, only their details)

**W1-ESM-1 The bridge skips `history`, and a spec writes to it (`lane`).** The bridge skips any name `in window`, so
`history` lands in `SKIPPED`. But `e2e/l22-stars-scope.spec.js:84` runs `history.set(t.id, pts)` inside
`page.evaluate`. Under the bridge that call resolves to the History API and throws "history.set is not a function". The
note "history shadows window.history, but only if no code uses the History API" describes the opposite of what the
code does. I checked that nothing uses the History API: there is no `pushState`, `replaceState`, `back`,
`window.history` or MapLibre `hash:` option in `app/public/**`. **Recommended:** bridge `history` explicitly (a
named exception to the `in window` skip, with the comment). Fail if `SKIPPED` is not empty, unless the name is listed,
so a future collision is loud. The only other collision is `map`, which is safe because the `#map` element
(`dock.js:610`) is created later, in `initDock()` inside `startApp()`.

**W1-ESM-2 "Boot sequence" has to include `app.js`'s other top-level side effects (`supervisor`, a detail of
S-ESM1a(1)).** At `77cf674`, `startApp()` (`app.js:925`) holds `loadSettings()…connect()`. The window writes
(`:106-107`) and the three `setInterval`s (`:327`, `:902`, `:907`) are still module-level. In the page this is harmless.
But `app.js` now evaluates early: `sync.js` comes first in `main.js` and reaches `app.js` through the cycle, so its
intervals start before the panels evaluate, where before they started last. In Node, it breaks every test (W1-T-2).
**Recommended:** move all five statements into `startApp()`, keeping their order. Timer phase is not behaviour, by
the same rule as APP's default.

**W1-ESM-3 TDZ: no top-level reads found, but the entry point changes the order (`lane`).** I scanned the single-line
top-level statements of every module at `77cf674`. None reads an imported binding, apart from `main.js`'s
`setInterval(atcTick)` and `startApp()`, which run after all imports. So `startApp()`-called code has no TDZ exposure:
every binding is initialised by then. Multi-line top-level initialisers were not scanned. Two residual risks remain.
(a) Cycle evaluation order depends on which module is the entry. A unit test that imports `bay-view.js` directly
evaluates the cycle in a different order from `main.js`, so a TDZ that never fires in the app can fire in a test, or
the other way round. (b) `typeof X` does not protect a TDZ binding: the many `typeof settings !== 'undefined'` guards
(`iff.js:77-81`, `track-label.js:24`, `atc-scope.js:329`) throw if they ever run during evaluation. **Recommended:**
`module-graph.test.mjs` also imports each module as its own entry (fresh graph per module, the W1-T-3 hook) under the
env helper and asserts no throw. That costs about 55 small graphs and closes (a) cheaply.

**W1-ESM-4 The 10 cross-file binding writes: count confirmed, and the e2e side is clean (`lane`).** An independent
scan at `165a517` found the same 10 names (`map`, `_drag`, `_measure`, `mapReady`, `bullseyePickTarget`, `selectedApt`,
`approachRwyCourse`, `_pendingConvertStripId`, `_activePositionTab`, `_activeBayId`). Each has a `_set…` at `77cf674`
(`app.js:141-147`, `bay-view.js:1929`, `efsp-panel.js:51-52`). E2e writes to bridged names are exactly the 7 senders
(`l15-metrics.spec.js:122`, `l2-block-editing.spec.js:175,195`, `helpers/app.js:151`). The other e2e writes go to
`window.__*` scratch names and to `window.WebSocket` (`ui-b-resync.spec.js:52`), a true global that `connect()` reads at
call time, so it is unaffected. The wrap pattern `orig = window.sendEfspMutation; window.sendEfspMutation = (...a) =>
orig(...a)` does not recurse, because `setEfspSender` rebinds the function declaration itself and `orig` is the
original function. **Recommended:** none. Add the e2e-writes check to the wip so the bridge's throwing setter has a
recorded basis.

**W1-ESM-5 `typeof X === 'undefined'` checks in specs before boot are safe (`lane`, no action).** Readiness waits use
`typeof getEfspFieldState === 'function'` (`helpers/app.js:294`, `field-state.spec.js:396`), `typeof dock !==
'undefined' && dock !== null` (`helpers/app.js:64`), `typeof mapReady !== 'undefined' && mapReady` (`l22:103`) and
others. Before the module graph has evaluated, the names are absent and the waits keep polling. After, the bridge's
getters return initialised bindings, because the bridge evaluates last and nothing imports it, so no getter can hit a
TDZ. `dock` stays `null` until `startApp()`→`initDock()`, which is the same readiness signal as before. One thing to
keep: the bridge must stay a pure consumer. If any module ever imports it, a getter could throw inside
`waitForFunction` and fail the wait instead of retrying. Add that to the module-graph test as an assertion ("nothing
imports classic-globals-bridge.js").

**W1-ESM-6 A missed import behind a `typeof` guard fails silently (`lane`).** About 170 distinct cross-file names are
read behind `typeof X === 'function'` or `!== 'undefined'` (46 files at base). If the codemod misses one, the module
reads an absent global, the guard is false and the feature switches off: no throw, no module-graph failure, and no
error a boot smoke would see. ESM-1 used scope analysis (acorn plus eslint-scope), which should be complete.
**Recommended:** make that permanent cheaply. `module-graph.test.mjs` asserts that no identifier token in a module
equals another module's export (from the frozen exports fixture) unless the module imports or declares it locally
(object keys and `.prop` excluded, with an allow-list for intentional shadows). That also catches a future guarded
reference added after ESM-1.

**W1-ESM-7 The Playwright gate conflicts with S-TEST (`supervisor`).** ESM-1's acceptance says "The full Playwright
suite on `E2E_LANE=1`", and the README's E2E section says "the unit's full run is ESM-1's". S-TEST says lanes never
run the full suite and the supervisor runs it sharded after the ESM merge. **Recommended:** S-TEST wins. ESM-1 runs
the boot smoke plus the specs that use the bridge's senders (`l2-block-editing`, `l15-metrics`, `l22-stars-scope`, and
one spec through `helpers/app.js` `expectDoesSomething`). The supervisor's sharded run on the merged unit is the full
gate. Fix the two lines.

**W1-ESM-8 Queue item 3 is now one case only (`lane`, note only).** ESM-1 step 0 shows `_el` declared only in
`metrics-panel.js` after merge4. Only `_callsignOfFdr` (`carrier-panel.js`, `efsp-panel.js`; efsp-panel's wins) remains.
S-ARCH2(3) already settled "keep as is". **Recommended:** list just that one case in the report.

**W1-ESM-9 Two latent ReferenceErrors found by ESM-1 are findings, not fixes (`lane`).** `tools-panel.js:33-34`
(`_pressureAtAlt`, `ISA_L`, `ISA_INV`, `T_REF_ALT`) and `geojson.js:651-652` (`trueHeading`). In a module these stay
ReferenceErrors when called, the same as today. **Recommended:** list them under Findings with a `test.todo`, and leave
them unfixed (README: no fixes on the side). Confirm that neither runs at module top level, otherwise the module graph
throws.
