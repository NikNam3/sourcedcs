# ESM-2b: efsp-panel.js split

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
