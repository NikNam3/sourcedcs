# ESM-2b: efsp-panel.js split (report)

Branch lane/ESM-2b-efsp-panel-split, base 115ff24. Commits: 33c2b9e (split, 7 clusters in one commit), b51e0d9 (original `_xxxEl` names kept, wip), plus the wip/report commit on top.
efsp-panel.js 1,626 -> 94 lines; panel/ = 1,588 lines in 7 files. Every name efsp-panel.js exported is re-exported.
Tests: crc-desktop 882 (879 pass, 2 todo, 1 fail) vs base +0 new; the 1 fail is bay-descriptor-parity "every field the client reads off a bay":
it text-scans efsp-panel.js for `bay.x` and those reads moved to panel/tabs.js. ESM-2a owns that fix (line 17 is at base here, verified
`git diff 115ff24 -- crc-desktop/tests/bay-descriptor-parity.test.mjs` empty); green once ESM-2a merges. crc-sync 2153 pass (one run showed 1 timing fail, passes on re-run).
module-graph: green; fixture +7 `panels/efsp/panel/*.js` entries only, efsp-panel.js entry unchanged.
Playwright E2E_LANE=3 (load avg 35-56): smoke, ui-a, l5-arrivals, l2-block-editing, tactical-positions, ui-b-resync all pass; l5-arrivals failed once
under load in two different tests (:50, :100) and passed 5/5 alone; l2-block-editing :292/:304/:330 are the spec's expected-fail (test.fail) cases.
Files outside Owns: none. Defaults taken: none needed.

## Cluster map (what went to which file)
- panel/state.js: `_activePositionTab`, `_activeBayId` + `_setActivePositionTab/_setActiveBayId`; the 15 cached `_xxxEl` elements (live exports);
  `_cachePanelElements()` (initEfspPanel's getElementById lines); `_setBayContentElForTest`.
- panel/staleness.js: `noteEfspHeartbeat`, `_checkEfspStaleness`, `_lastEfspHeartbeatAt`, `_staleCheckInterval`, new `startEfspStalenessCheck`.
- panel/tabs.js: `_searchQuery`, `_searchBayId`, `_positionsWithBays`, `HOLDS_ONLY_NO_DROP_TABS`, `computePositionTabs`, `_runEfspSearch`,
  `getActiveEfspSearchQuery`, `_renderPositionTabs`, `_renderBayTabs`, `_fillTabLabel`, `_liveStrips`, `_stripCountForBay/Position`,
  `_refreshPositionTabMarks`, `_isEfspPanelShowing`, `efspVisibleBayId`.
- panel/arrivals.js: `_arrivalsLineEl`, `_renderArrivalsLine`, `_arrivalExpiryTimer`, `_scheduleArrivalExpiry`, `noteEfspBoardArrivals`, `noteEfspArrivalShown`.
- panel/create-strip.js: the create-Strip latches, `_stereoRoutes` and loader, `reloadEfspStereoRoutes`, origins (`CREATE_STRIP_ORIGINS`, `_availableCreateStripOrigins`,
  `_createStripOrigin`), mission-bind and ATO-first pickers, `_refreshCreateStripAvailability`, `convertStripToArrival`, `_submitCreateStrip`,
  `createStripFromFiledPlan`, `_wireCreateStrip`, `_setCreateStripMsg`.
- panel/refusal.js: `MUTATION_ERROR_VISIBLE_MS/MESSAGES`, `_refusalSentence`, `_callsignOfFdr`, `_refusalSubject`, `_currentRefusal`, `_showMutationError`,
  `dismissEfspRefusal`, `getCurrentEfspRefusal`, warning, `notifyEfspOrphanedMutation`, `notifyEfspMutationAck`, `_setCurrentRefusalForTest`, the two banner timers.
- panel/dot-commands.js: `_fragMissionLine` (with its two stacked doc comments), `_dispatchDotCommand`, MARSA verbs and dispatcher, `_fileStereoByName`,
  `_dotCommandErrorShown`, `_showDotCommandError`, `_wireDotCommand`.
- efsp-panel.js: module comment, `refreshEfspPanel`, `_renderCorrelationRate`, `initEfspPanel`, the re-exports.

## Lines that are not verbatim (beyond import/export lines)
1. `_activePositionTab = x;` / `_activeBayId = x;` -> `_setActivePositionTab(x);` / `_setActiveBayId(x);` (tabs.js x6, arrivals.js x2): a module cannot assign an imported binding.
2. `_pendingCreateStripMutationId = x;` and `_pendingDuplicateCallsign = x;` -> `_setPending...(x);` in dot-commands.js and refusal.js (assigned from another module; create-strip.js keeps the originals).
3. initEfspPanel's 15 `getElementById` lines -> one `_cachePanelElements();` call; the lines themselves moved verbatim into state.js.
4. initEfspPanel's `if (!_staleCheckInterval) _staleCheckInterval = setInterval(...)` -> `startEfspStalenessCheck();` (same lines, with their comment, in staleness.js).
5. `export let` on the state variables; `let _mutationErrorClearTimer/_mutationWarningClearTimer` declarations moved next to `_currentRefusal` (refusal.js) from the old top block.
6. New setter/helper functions: the two `_setPending...` in create-strip.js, `startEfspStalenessCheck`, `_cachePanelElements`.
7. Dropped: the 3-line stale "Node-only export" comment at the file end.

## Code as found (base 115ff24)
`crc-desktop/app/public/js/panels/efsp/efsp-panel.js`: 1,626 lines, one module. Clusters by symbol:
- shared state: `_activePositionTab`/`_activeBayId` (live `export let` + ESM-1 setters), 15 cached `_xxxEl` elements, test seam `_setBayContentElForTest`
- staleness: `noteEfspHeartbeat`, `_checkEfspStaleness`, the 1 s interval
- tabs and search: `_positionsWithBays`, `computePositionTabs`, `_runEfspSearch`, `_renderPositionTabs`, `_renderBayTabs`, `_fillTabLabel`, counts, `efspVisibleBayId`
- arrivals line: `_renderArrivalsLine`, `noteEfspBoardArrivals`, `noteEfspArrivalShown`, expiry timer
- create Strip: origins, stereo routes, bind and ATO-first pickers, `_submitCreateStrip`, `convertStripToArrival`, `createStripFromFiledPlan`
- refusal banner and warning: `MUTATION_ERROR_*`, `_callsignOfFdr`, `_showMutationError`, `getCurrentEfspRefusal`, `notifyEfsp*Mutation*`
- dot commands: `_dispatchDotCommand`, MARSA verbs, `.stereo`, `.mission`
- init: `initEfspPanel`, `refreshEfspPanel`, `_renderCorrelationRate`

## Result
Layout `js/panels/efsp/panel/{state,staleness,tabs,arrivals,create-strip,refusal,dot-commands}.js`; efsp-panel.js is 1,626 -> ~112 lines
(init, refresh, correlation rate, re-exports of every name it exported). Moved code is byte-identical apart from import lines, `export`
keywords, and the few assignments of another module's binding (`_activePositionTab = x` -> `_setActivePositionTab(x)`,
`_activeBayId`, and `_pendingCreateStripMutationId`/`_pendingDuplicateCallsign` outside create-strip.js -> their setters).
`_xxxEl` names are kept (live exports of state.js; `_cachePanelElements()` holds initEfspPanel's lookups verbatim).
Import cycles among panel modules and with bay-view/carrier-panel are function-only (module-graph test green).
The stale "Node-only export" trailing comment (3 lines) was not carried.

## Gates
crc-desktop npm test: 882 tests, 879 pass, 2 todo, 1 fail = bay-descriptor-parity "every field the client reads off a bay": it scans
efsp-panel.js's source for `bay.x`, which moved to panel/tabs.js. ESM-2a owns that fix (scan the whole efsp dir); not edited here.
module-graph fixture: +7 `panels/efsp/panel/*.js` entries only; efsp-panel.js entry unchanged. crc-sync 2153 pass.
