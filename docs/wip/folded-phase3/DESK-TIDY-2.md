# DESK-TIDY-2 (phase 3, client lane, E2E_LANE 6)

## Done

1. **`openPopover`** (`panels/efsp/bay/popover-portal.js`): `openPopover({ el, anchor, strip, onClose, focus }) -> { el, close }`. It owns
   position, one open at a time (opening closes whichever is open, so two popovers can no longer coexist), the outside-`pointerdown`
   close (one document listener in the portal, armed a tick after opening), Escape (already central), the `pointerdown` stop inside the
   popover, the optional first focus and the deferred post-close render. The eight popover modules (`bind`, `highlight`, `coordination`,
   `tofi`, `marsa`, `airspace-entry`, `formation` x3 forms, `control-release`) and the Strip menu in `strip-view.js` lost their
   `_openXEl` / `_closeX` / `_onDocPointerDownCloseX` / `setTimeout(addEventListener)` copies: each keeps a one-line `_closeX` over its handle.
   `_sendFromPopover` is unchanged (close on accepted ack, stay open on refusal). `bay-view.js` re-exports `openPopover` instead of
   `_mountPopover` / `_unmountPopover` (50 names -> 49 there). `tests/efsp-open-popover.test.mjs` (6 tests): one-at-a-time, outside click
   armed/inside/before arming, Escape, idempotent close, focus, pointerdown stop.
2. **`innerHTML` sinks** (ARCH-C 3.2). `js/html-escape.js` (`escapeHtml`, a leaf) is the one escaper. Converted: airport-selector
   dropdown rows (DOM), its weather panel (`label`, `d.error`, numbers), APRT airport rows and cloud rows (DOM), the connection
   widget's field rows (`escapeHtml` for label/id/value, which only escaped `"`), the patch-notes modal (`version`, notes), `update-required.js`
   (its private `esc`), SRS slot rows. `tests/html-sinks.test.mjs` is a source scan with a small JS scanner (strings, templates,
   brackets, ternaries, `&&`, `+`): every dynamic part of an `innerHTML`/`outerHTML`/`insertAdjacentHTML` right-hand side must be
   `escapeHtml(...)`, a literal, or on a short reviewed allow-list (`_connFieldRow(`, `link`/`BTN*` in update-required, `modBadge`,
   `sketchSvg(` which is numbers only). It also self-tests the checker and asserts `index.html` has no inline handler attribute.
3. **Dead exports.** Deleted (no reader anywhere): `isDrawing`, `OVERRIDE_VALUES`, `_setSettingsForTest`, `getAirspaceCalendar`,
   `getArHighlightStripIds`, `isCarrierDerivedBlock`, `efspArrivalsVersion` (and its counter), `_resetCombinationForTest`, `isSea`,
   `isGround`; the retired client undo window `UNDO_WINDOW_MS` / `isUndoAvailable` (and their tests and the server-window parity
   assert); `CARRIER_POSITION_IDS` (the test reads `CARRIER_CAPABILITIES`). `$aptDisplay` is NOT dead (airport-selector imports it): ARCH-C was wrong.
   Fixture re-recorded. Not deleted, on purpose: `runwayStatusReasonFor` and `requiredBlocksFor` have no production reader but are the
   oracles of real client/server parity tests; kept, listed below. `getEfspBoardSeq` lives in `efsp-state.js` (DESK-SYNC's): finding.
4. **Naming and CSS.** `NM_M` exported from `geo.js`, replacing `NM_M` (bay-views), `M_PER_NM`, `CORRIDOR_NM_M` and every inline `1852`
   in the client; the handoff chip key `held` and `.efsp-handoff-held` are `mine`; `_setCoverageHeldPositions` is
   `_setCoverageSignedOnPositions`; metrics `'not-held'` warn key is `'not-signed-on'`; undo-slot doc examples use FAA Position names;
   the airspace board's 13 rules moved from `efsp-panel.css` to `airspace-panel.css`, and the double `.airspace-card-header` is one rule.
5. **Small ones.** `create-strip.js`'s origin table lost its hand-written `facilityId` (`_sendCreateStrip` defaults it to
   `facilityOfPosition(actingPositionId)`; `dot-commands.js` stopped passing `origin.facilityId`). Every spec screenshot now goes to
   `test.info().outputPath(...)` (L1b, L2, L12-L17, L22, L23, L28, CR-C, AIRSP-2P-B, gclc-combine, efsp-undo); `e2e-spec-hygiene.test.mjs`
   fails on any other screenshot path or any `docs/wip` in a spec's code (comments excepted; the headers now say "test output directory").
   `runway-status-panel.js`: the reason for Close / Reject is an inline input row (Enter sends, Escape/Cancel abandons, the button
   toggles it); the draft is module state so the per-frame rebuild keeps the typed text. Unit test and `runway-status.spec.js`
   (`pressWithReason`) updated; the stub `window.prompt` now throws.

## Defaults taken

- The airspace card's ⋯ menu (`airspace-panel.js`), the layer menu and the ground-label popup (`track-panel.js`) were NOT moved onto
  `openPopover`: the first is an in-flow card section that re-renders with the list, the second is a docked panel, the third is a static
  element in `index.html` positioned by the click. None is portalled; forcing them through the Strip-popover portal would change their
  behaviour. A later `openPopover({ el, anchor })` call fits the third if wanted.
- `openPopover` closes every open popover, not only its own kind. A Strip-menu item that opens a popover therefore closes the menu
  through the portal (it did through the click handler before).
- No CSP meta added (finding below): the app has inline styles and event wiring in `sync.js`/`update-required.js` and CDN scripts from
  unpkg; a CSP needs the CDN list and a pass over every inline `style=`, which is its own lane.
- The 164 underscore exports and `efspFlightDataList` -> `efspFlightData`: not done (every one rewrites import lines across files DESK-SYNC
  and DESK-GRAPH are editing; `efspFlightDataList` is in `efsp-state.js`). Left to DESK-GRAPH, which rewrites those import lines anyway.
- The generic CSS state classes (`.active`, `.open`, ...) and the `carrier-*` / `runway-*` / `panel-ctrl-*` rules in `efsp-panel.css`
  were not scoped or moved; moving them means new `<link>`s in `index.html` and the packaging test, for no behaviour change.
- The reason form refocuses its input only when it first opens, not after every rebuild (a rebuild keeps the typed text but not the caret).
- `runway-status-rules.js:231` "Landing is an observation and is not held." is "held" as in held back, not signed-on, so unchanged.

## Findings

- For DESK-SYNC: `efsp-state.js` `getEfspBoardSeq()` has no production reader (tests and two specs read it); `efspFlightDataList` should be
  `efspFlightData` when `efsp-state.js` is split.
- For DESK-GRAPH: `popover-portal.js` still imports `renderAllOpenEfspBays` from `bay-view.js` (the render target as an import edge, ARCH-C 1.2);
  `strip-view.js` now takes `openPopover` through the `bay-view.js` re-export, like its other 49 names. The `NM_M` imports add
  `geo.js` (imports only `sync.js`, no cycle) to `airspace-layer.js`, `airspace-geometry-model.js`, `radar-panel.js`, `carrier-panel.js`,
  `geojson.js`, `topbar.js`, `bay-views.js`, `app.js`. `html-escape.js` is a leaf.
- Setter seams that tests genuinely need and stay (47 after this lane): `_set*` in `app.js` (11: `_setApproachRwyCourse`, `_setBullseyePickTarget`,
  `_setCoverageDatalink`, `_setCoverageRadars`, `_setCoverageSignedOnPositions`, `_setDrag`, `_setMap`, `_setMapReady`, `_setMeasure`,
  `_setSelectedApt`, plus `settings`), `setSendToSync` / `setIsSyncOpen` / `_setSyncSocket` (`sync.js`), `setEfspSender` (`efsp-ws.js`, 11-case switch),
  `_setRenderAllOpenEfspBaysForTest` / `_setRenderBayForTest` / `_setSelectedStripIdForTest` / `_setSelectEfspStripByIdForTest` (`bay-view.js`),
  `_setUpdateMapForTest` (`geojson.js`), `_setShowLosProfileForTest`, `_setAprtRunwayForTest`, `_setEfspMetricsClientForTest`,
  `_setUndoClockForTest`, `_setCurrentRefusalForTest`, `_setBayContentElForTest`, six `_reset*ForTest`, and the plain state setters
  `_setActiveBayId`, `_setActivePositionTab`, `_setExpandedStripId`, `_setPendingConvertStripId`, `_setCreateStripMsg`,
  `_setPendingDuplicateCallsign`, `_setRestoredEditInThisStrip`, `setOpenEfspBays`. The function-replacing ones disappear only with the change bus
  / one transport (ARCH-C 3.1, 1.7); none was removable now.
- Test-only exports kept: `runwayStatusReasonFor` (parity oracle against the server's wording), `requiredBlocksFor` (parity against the
  server's required sets).
- CSP opportunity: `index.html` has none. Inline `style=` strings in `sync.js`, `update-required.js` and the SRS markup need
  `style-src 'unsafe-inline'`; scripts are `'self'` plus unpkg/cdnjs, and the preload's `crcUpdate`/`crcLinks` are what an injected script could reach.
  With the sinks escaped and scanned, a `script-src 'self' https://unpkg.com https://cdnjs.cloudflare.com` meta is now low-risk; the CDN list and
  the map-tile origins (`connect-src`, `img-src`, `worker-src blob:` for maplibre) need checking against a real boot first.
- `tests/efsp-ui-reachability.test.mjs` and the full `npm test` are slow under machine load (the module-graph and reachability suites took
  ~170 s while three lanes ran).
- Playwright specs still rewrite nothing tracked after this lane; the tracked PNGs under `docs/wip/*/` are now frozen references.

## Tests

See the report (crc-desktop `npm test` and the Playwright runs on E2E_LANE=6).
