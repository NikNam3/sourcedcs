# ESM-2a: bay-view.js split into bay/**

## Report
**Branch** `lane/ESM-2a-bay-view-split`, base 115ff24. bay-view.js 3,115 -> 721 lines; 12 new modules under `js/panels/efsp/bay/**`.
**Counts.** crc-desktop 882 -> 882 (880 pass, 2 todo, 0 fail). crc-sync 2153 -> 2153: the two failures seen under load (grpc-client-stream retry timing,
ato-tokenize timing) are timing flakes; the grpc one passes alone (no crc-sync file touched). Freeze goldens 48/48 at base; no crc-sync change, not re-run.
**Playwright (E2E_LANE=2, load 40-65):** smoke, l4-drag, l4-chain, marsa-popover, l1-nla-clearance-chain: 15 pass, 2 fail on 3 s click timeouts
(l1-nla-clearance-chain:124, marsa-popover:80); both re-run alone: 7/7 pass.
**Structure fixture:** module-graph-exports.json gains 12 bay/** entries; bay-view.js's export set unchanged; bridge names unchanged.
**Outside Owns (approved by S-ESM2-q):** client-mirror-parity, efsp-coordination-client, bay-descriptor-parity, overflight-shared-state-names (my entries only).
**S-ESM2-q answers:** (1) client-mirror-parity reads the six tables from bay/authority-mirror.js and TOFI_ACCEPT_REGIMES from bay/popovers/tofi.js;
(2) overflight allow-list: bay-view.js entry replaced by bay/popovers/airspace-entry.js; (3) bay-descriptor-parity walks panels/efsp recursively, floor 30 files;
(4) selection and dispatch stayed in bay-view.js (cost: bay-view.js <-> bay/** import cycle, function-level only).

## Code as found (base 115ff24)
- `bay-view.js`: 3,115 lines, 160 top-level names (124 read by other scripts), 16 `let`s. Cross-file `let` writes found by a scope
  analysis (acorn + eslint-scope): only three (`_openBlockEdit` from the refusal seeder, `_restoredEditInThisStrip` from `_buildStripEl`,
  `_expandedStripId` from `_onStripKeydown`). No top-level statement other than declarations; no cross-file read at top level.
- Base counts: crc-desktop 882 tests (880 pass, 2 todo); crc-sync 2153 (2152 pass, 1 todo); freeze goldens 48/48.
- Tests that read bay-view.js source text or names: `client-mirror-parity` (six authority tables + `TOFI_ACCEPT_REGIMES`),
  `efsp-coordination-client` (`constLiteral` on the tables), `bay-descriptor-parity` (`bay.X` scan), `overflight-shared-state-names`
  (allow-list entry), `efsp-ui-reachability` / `efsp-ato-strip` / `efsp-metrics-hooks` / `efsp-field-state-client` / `efsp-ordnance-client`
  / `efsp-scramble-client` / `efsp-correlation-client` / `efsp-marsa-client` (import names through the bay-view.js namespace, all still exported).

## Cluster map (names per new file; everything not listed stays in bay-view.js)
- `bay-view.js` (722 lines): _selectedStripId, getSelectedEfspStripId, _lastAdvancingPressAt, _swallowRepeatAdvance, _dispatchMarsa, _dispatchCorrelation, _selectStrip, selectEfspStripById, _afterSelectionChanged, _onRackHeaderClick, _onStripKeydown, _keyTargetIsStripControl, _resolveActingPositionId, _invokeNla, _moveStrip, _transferStrip, _handBackBayFor, _dispatchHandBack, STRIP_CONTROL_SELECTOR, _dispatchGesture, _defaultBayFor, _defaultRackFor, renderBay, _buildRackShell, _isProtectedStripEl, _stripRenderSignature, _stripElNeedsRebuild, _reconcileRackStrips, _renderScheduled, renderAllOpenEfspBays, _setRenderAllOpenEfspBaysForTest, _setSelectEfspStripByIdForTest, _setSelectedStripIdForTest, _setRenderBayForTest
- `bay/block-edit.js` (449 lines): _refusalForStrip, _seededRefusalAt, _maybeSeedRefusedBlockEdit, _blockLabel, _buildBlockCell, _shouldRestoreBlockEdit, ENUM_SELECT_NAV_KEYS, _buildEnumSelectCell, _buildBooleanToggleCell, _openBlockEdit, _restoredEditInThisStrip, _closeOpenBlockEdit, _startBlockEdit
- `bay/strip-element.js` (415 lines): _pendingDropStripId, _dropDisarmTimer, DROP_ARM_MS, _canDropStrip, _appendDropButton, CHIP_HISTORY_LIMIT, _appendAnnotationHistory, _expandedStripId, _appendExpandButton, _expandedBlockIdsFor, _appendExpandedView, _buildStripEl, _setExpandedStripId
- `bay/popover-portal.js` (206 lines): _openPopovers, POPOVER_Z_INDEX, POPOVER_VIEWPORT_MARGIN, _popoverTracking, _postPopoverRenderTimer, _popoverRoot, _placePopover, _mountPopover, _unmountPopover, _stripHasOpenPopover, _closeAllPopovers, _startPopoverTracking, _stopPopoverTracking, _onPopoverViewportChange, _onDocKeydownClosePopover, _requestPostPopoverRender
- `bay/popovers/bind.js` (77 lines): _openBindPopoverEl, _closeBindPopover, _onDocPointerDownCloseBindPopover, _openBindPopover
- `bay/popovers/marsa.js` (222 lines): _openMarsaPopoverEl, _closeMarsaPopover, _onDocPointerDownCloseMarsaPopover, _openMarsaPopover, _marsaCandidates, _marsaCandidateSelect, _buildMarsaDeclareForm, _buildMarsaAddForm
- `bay/open-bays.js` (26 lines): _stripElById, getOpenEfspBayIds, _isPseudoBayId, _openBayContainers, setOpenEfspBays
- `bay/authority-mirror.js` (58 lines): COORDINATION_TARGETS, TOFI_COUNTERPARTS, HAND_BACK_TO, TOFI_ANSWERED_BY, AIRSPACE_ENTRY_POSITIONS, CONVERT_TO_ARRIVAL_POSITIONS
- `bay/popovers/coordination.js` (236 lines): _isPendingCoordinationReplica, _canProposeCoordination, _dispatchCoordination, COORDINATION_PRIMITIVE_LABELS, _coordinationIsReplica, _isRejectedCoordinationReplica, _coordinationProposerOf, _coordinationStateWord, _buildCoordinationNoteEl, _buildCoordinationReasonEl, _openCoordinatePopoverEl, _closeCoordinatePopover, _onDocPointerDownCloseCoordinatePopover, _openCoordinatePopover
- `bay/popovers/tofi.js` (200 lines): _canProposeTofiEntry, _canProposeTofiExit, _isPendingTofiReplica, _canTransferTofiComms, TOFI_ACCEPT_REGIMES, _tofiRegimeChoice, _tofiActingPositionId, _dispatchTofi, _openTofiPopoverEl, _closeTofiPopover, _onDocPointerDownCloseTofiPopover, _openTofiEntryPopover, _tofiProposerOf, _tofiExitPrecondition
- `bay/popovers/airspace-entry.js` (104 lines): _pendingConvertStripId, _setPendingConvertStripId, _canConvertToArrival, _canApproveAirspaceEntry, _openAirspacePopoverEl, _closeAirspacePopover, _onDocPointerDownCloseAirspacePopover, _openAirspaceEntryPopover
- `bay/popovers/highlight.js` (69 lines): HIGHLIGHT_SWATCHES, _nextHighlightColor, _cycleHighlight, _openHighlightPopoverEl, _closeHighlightPopover, _onDocPointerDownCloseHighlightPopover, _openHighlightPopover
- `bay/drag.js` (359 lines): _efspDrag, _scrollParentOfRack, _scrollTopOf, _cacheRackRects, _onStripPointerDown, _capturePointer, _findDropTargetAt, _findRackAt, DRAG_AUTOSCROLL_EDGE_PX, DRAG_AUTOSCROLL_MAX_PX, _dragAutoscrollFrame, _dragAutoscrollStep, _requestDragAutoscroll, _onStripPointerMove, _finishDrag, _onStripPointerUp, _onStripPointerCancel
- `bay/ops-cards.js` (114 lines): _opsFiledPlans, _opsFiledFetchedAt, _opsFiledFetching, _opsFiledUsedPlanIds, OPS_FILED_REFRESH_MS, _renderOpsFiledCards, _refreshOpsFiledIfStale

Names that bay-view.js exported before are re-exported from it (`import ... from './bay/x.js'; export { ... }`: a plain `export ... from`
is invisible to module-graph's import regex). `bay-view.js` export set is unchanged in `module-graph-exports.json`.

## Non-verbatim lines (everything else is a verbatim move, comments included; checked by a line-multiset diff against the base)
1. `strip-element.js` `_buildStripEl`: `_restoredEditInThisStrip = false;` is now `_setRestoredEditInThisStrip(false);` (import bindings are read-only; the binding lives in block-edit.js).
2. `block-edit.js`: new `export function _setRestoredEditInThisStrip(v)` (2 comment lines + 1 line) for (1).
3. `bay-view.js` `_onStripKeydown`: `_expandedStripId = null;` is now `_setExpandedStripId(null);` (the binding is in strip-element.js; the setter already existed).
4. `bay-view.js`: one `export { ... }` block (the re-exports) plus its comment line; every other changed line is an `import`/`export` line or the `'use strict';` prologue of the new files.

## Decisions and defaults taken (P2)
- Supervisor ruling S-ESM2-q (4): selection (`_selectedStripId`, `_selectStrip`, `selectEfspStripById`, `_onRackHeaderClick`, `_onStripKeydown`,
  the repeat-advance guard) and dispatch (`_resolveActingPositionId`, `_invokeNla`, `_moveStrip`, `_transferStrip`, `_dispatchMarsa/Correlation/Gesture`,
  `_dispatchHandBack`, `_handBackBayFor`, `_defaultBayFor/RackFor`) stay in bay-view.js. My first cut had `bay/selection.js` and `bay/dispatch.js`;
  merged back. Cost: bay/** modules import dispatch and selection helpers from bay-view.js, so bay-view.js and bay/** form one import cycle
  (function-level reads only; module-graph tests 5-8 pass, including every module as its own entry). bay-view.js is 721 lines (target "under about 700").
- Refusal seeding (`_refusalForStrip`, `_seededRefusalAt`, `_maybeSeedRefusedBlockEdit`) is in `bay/block-edit.js`, not selection: it writes `_openBlockEdit`.
- `TOFI_ACCEPT_REGIMES` is not one of the six authority tables; it stays with the TOFI popover in `bay/popovers/tofi.js` and `client-mirror-parity` reads it there.
- `bay/open-bays.js` (not in the briefing): `_openBayContainers`, `setOpenEfspBays`, `getOpenEfspBayIds`, `_stripElById`, `_isPseudoBayId`; lowest-level, used by render, drag and selection.
- `bay-descriptor-parity`: scans `panels/efsp/` recursively with a floor of 30 files. Files outside the old five and `bay/**` read optional descriptor fields
  (bay-views.js's `bay.view`), so for them the check is "some Bay carries it"; the old five plus `bay/**` stay strict (every Bay).
- `overflight-shared-state-names` allow-list: only my entry changed (`bay-view.js` out, `bay/popovers/airspace-entry.js` in). BACKCOMPAT's removal of overflight-migration.js is the supervisor's merge.

## Findings
- None new. (`ops-cards.js` keeps its `Date.now()` for the refresh throttle; a UI-side wall clock, untouched.)
