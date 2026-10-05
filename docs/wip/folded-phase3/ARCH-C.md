# ARCH-C: architecture check of the crc-desktop client (H103)

Lane ARCH-C, read-only. Worktree `sourcedcs-ARCH-C`, branch `lane/ARCH-C-check`, cut from `efsp-wp5-correlation` at
`1d058ca6` (2026-10-03). The baseline for "grew back" is `c6a48f85` (S-REFACTOR-DONE). Sibling reports:
`docs/wip/ARCH-W.md` (web, infra, seams, tests) and `docs/wip/ARCH-S.md` (crc-sync). This report links to their
findings and does not repeat them. TOFI-C (`lane/TOFI-C-regime-ui`, merged into `efsp-wp5-correlation` at `a57a3336`
after this lane was cut) was read as `git diff 1d058ca6...lane/TOFI-C-regime-ui` and is included.

**What was run:** `npm ci` in `crc-desktop` and `crc-desktop/app`, then `npm test` (1106/1106 pass, 66 s). It left 24
`lxsrs-setup-test-*`/`patch-notes-test-*` dirs in `/tmp`, which were removed (ARCH-W §5.1 has the fix). Read-only
scripts in the session scratchpad covered the import graph (Tarjan SCC), dead exports, and two render-signature probes
that import the client modules under `tests/helpers/client-env.mjs`. No Playwright was run: lane 7's app port is
:3117, which this lane must not touch. No code was changed.

Paths are relative to `crc-desktop/app/public/js/` unless they start with `crc-desktop/`, `crc-sync/` or `docs/`.
**Effort:** S is under half a day, M is one lane, L is several lanes. **Risk** is the risk of making the fix.
**BUG** marks a real defect, not just a smell.

## Top 10, ranked by cost

Cost means the harm of leaving it in place: a controller misled or blocked, then lanes slowed by the structure.

| # | Finding | § | Effort | Kind |
|---|---|---|---|---|
| 1 | **A reconnect silently signs the controller off.** crc-sync signs a session off every Position on close. The client keeps its own claimed set and never declares it again. The Acting-As checkboxes stay ticked, actions are offered and then refused, and the radar coverage empties. The client also ignores `efsp-positions-ack.signedOn` and cannot tell Primary from Observer (the GCLC finding). | 1.1 | M | **BUG** |
| 2 | **Strip chips go stale while a Bay is open.** The render signature is a hand-kept list of inputs. Two chips are missing from it: the SCRAMBLE chip on *other* Strips' ground traffic, and TOFI-C's new `tofiRegime` chip. Both were confirmed by probe: the chip's input changes and the signature does not, so the Strip is not rebuilt. | 3.1 | S | **BUG** ×2 |
| 3 | **The SRS PTT can stick open.** Keyboard PTT re-sends `/ptt/start` every 400 ms until a `keyup`. A `keyup` is ignored while focus is in an input, and it never arrives after an alt-tab. lxsrs has no timeout. | 3.4 | S | **BUG** |
| 4 | **Re-renders destroy what the user is doing.** The Undo button is rebuilt every 250 ms, so a mouse click whose press spans a tick is lost. The airspace panel rebuilds every card on any airspace delta, calendar frame or ack, and the Delay note's typed text is lost. Behind both: each message handler calls its own hand list of renderers. | 3.1 | M | **BUG** ×2 + structure |
| 5 | **One import cycle holds 59 of the 101 modules.** 22 modules import `app.js` for `settings`/`map`/`missionData`. `bay-view.js` re-exports 50 names, and `strip-view.js` imports 101 names (40 of them through `bay-view.js`). Pure rule modules join the cycle through a formatter that lives in a panel. `window.getLatestTrack` is read by 5 production modules, although the README says nothing puts names on `window`. | 1.2 | M–L | structure |
| 6 | **Five ways to track an ack, plus refusals parsed as prose.** The five are: pending Strip mutations, the undo slot, CreateStrip, the ATO import and the airspace views. CR-C's attestation regex-parses a server sentence. Warnings are one mixed code/prose field (the client half of ARCH-S #8). The refusal table misses 7 server codes. A popover closes on send, so its typed input is lost on a refusal. | 1.3 | M | structure, BUG (low) |
| 7 | **Sync bookkeeping exists twice.** The Board-per-Facility and store cursors each have their own heartbeat-gap function, in-flight map and trigger path: explicit calls for one, a registry observer for the other. Store resync re-dispatches synthetic `{type}` frames. A legacy `efspBoardSeq` has no production reader. | 1.4 | S–M | duplication |
| 8 | **Facility topology is copied three times, and four client rule tables have no parity test.** Hard-coded `'INCIRLIK'`/`'TACTICAL'` defaults sit in four more places. | 1.5 | S | mirrors |
| 9 | **God files grew back.** `efsp-state.js` grew +158 (to 712), `airspace-panel.js` +306 (to 547) and `strip-view.js` +53 (to 977). `airspace-editor.js` is new at 671. `map-setup.js` is one 690-line `initMap`. | 2 | M | size |
| 10 | **Tests: the e2e helpers check the client's own claim, not the server.** `openPanel` waits on client-local state, not the ack. The airspace specs stub the sender, so create/edit/delete/geometry never reach crc-sync. 12 specs read raw state Maps. A TOFI-C spec writes a screenshot into a session scratchpad path. 41 setter seams and 11 dead exports remain. | 5 | S–M | tests |

**What is fine** (details in each section):
- The message registry is a leaf module that throws on a duplicate type.
- The popover portal is a well-argued single mechanism.
- Refusal attribution (F-103/F-207) is solid.
- The Bay reconciler is keyed and protects a Strip that has an open edit or popover.
- The EFSP tree builds its DOM with `textContent` throughout.
- No production code reads `window.crc`.
- `efsp-panel.js` stayed at 99 lines and `bay-view.js` at 720.
- `dock.js`, `geojson.js` and `srs-radio.js` have not grown since the refactor.
- The pre-W7 vocabulary is almost gone from identifiers.
- The local server's static and `/data/` path checks are correct.
- The create-strip selects keep their value across rebuilds.

---

## 1. Wiring

### 1.1 Who is signed on: the client keeps its own claim (**BUG**)

- **What is wrong.**
  - `efsp-ws.js:103-106` `sendEfspSetPositions` writes `_actingPositionsByFacility` *before* anything is sent. `_sendEfsp` drops the message when the socket is closed (`:36-41`), and the claimed set remains.
  - Every gate reads that claim: `getActingPositions()` is called from 34 sites (`bay-view.js:270,608`, `strip-view.js:581,772`, `airspace-panel.js:222-455`, `create-strip.js:138,513`, `scramble.js:155`, ...). The checkboxes render from it too (`panels/radar-panel.js:237,266`).
  - On a WebSocket close, crc-sync calls `efsp.onDisconnect` (`crc-sync/src/ws-hub.js:577-580`). That calls `PositionStore#onDisconnect` (`crc-sync/src/efsp/position-store.js:233-237`), which signs the controller off everywhere.
  - On reconnect (`app.js:522-669`) nothing sends `efsp-set-positions` again. The `efsp-positions-ack` handler (`panels/efsp/efsp-messages.js:137-142`) logs `msg.signedOn` and never adopts it.
  - **Effect:** after any reconnect (a crc-sync deploy, a network blip), the controller looks signed on and is not. Every action is refused with `NOT_HOLDING_POSITION` and coverage goes empty. Meanwhile auto-promotion may have handed the Positions to an Observer.
  - `crc-desktop/e2e/ui-b-resync.spec.js:29` covers the Board half of a reconnect and never checks sign-on.
- **The Primary/Observer half (GCLC finding, `docs/wip/GCLC.md:59`).**
  - The client has no notion of its own `controllerId` and does not know whether it is Primary. `coverageSignedOnPositions[].isPrimary` (`app.js:138`) is received and never read.
  - An Observer is therefore offered every action.
  - `panel/arrivals.js:71-76` infers "my controller ids" as *the Primary of each Position I claim*. An Observer adopts the other controller's id, so the arrival edge is attributed to the wrong person.
- **Fix.**
  - Make the server the source: `getActingPositions(f)` = the snapshot's `positions` where `primary.controllerId === me`, plus Observer rows marked as such.
  - `me` comes from a `you: { controllerId }` field on the snapshot (or the token's `sub`).
  - Keep the user's *declared* set separately, and send it again on every `efsp-snapshot` that follows a connect.
  - Adopt `ack.signedOn`.
  - Gate actions on `isPrimaryAt(positionId)` and show Observer rows read-only.
  - Add an e2e step to `ui-b-resync`: after the reconnect, CD is Primary again.
- **Effort** M. **Risk** medium: the gates read a different source, and it needs one wire field. Run `wire:record`.

### 1.2 The import graph: one cycle, three hubs, two `window` globals

Measured over `app/public/js` (101 modules), by Tarjan's algorithm:
- **One strongly connected component holds 59 modules.** It includes `track-label.js`, `icons.js`, `iff.js`, `strip-template.js` and `control-release-rules.js`.
- Cutting the imports of `app.js` still leaves 46. Cutting `bay-view.js` as well leaves 27.

| Hub | Why it pulls everything in |
|---|---|
| `app.js` (fan-in 22) | `settings`, `saveSettings`, `map`, `mapReady`, `missionData`, `tracks`/`history`, `coverage*` all live in the boot module, which itself imports the panels. |
| `bay-view.js` (fan-in 28, fan-out 28) | `:87-100` re-exports 50 names from `bay/**` "so every old name is still exported" (ESM-2a). `strip-view.js:39-51` imports 40 of them through it, and `bay-view` imports `strip-view` back. |
| `geojson.js` `updateMap`, `bay-view.js` `renderAllOpenEfspBays`, `efsp-panel.js` `refreshEfspPanel` | Low modules call these renderers directly (`correlation-highlight.js:3,7`, `scramble.js:4-6`, `popover-portal.js:2`). Every render target becomes an import edge. |

- **How rule modules join the cycle.** `control-release-rules.js:5` imports `formatZuluHhmm` from `strip-template.js`, and `strip-template.js:6` imports `carrierFinalDistanceText` from `carrier-panel.js`, a DOM panel. `scramble.js:5-6` imports panel setters from `efsp-panel.js`.
- **`window` globals in production.** `app.js:84-87` puts `getAllTracks`/`getLatestTrack` on `window`, read by `bay-view.js:572`, `bay-views.js:236`, `carrier-panel.js:365`, `correlation-highlight.js:134` and `track-panel.js:87,100,262,318`. That is the one channel the module-graph test cannot see, and it contradicts `crc-desktop/README.md` "Client modules".
- **Fix, in order, each step S.**
  1. Extract leaf modules: `settings.js` (DEFAULTS, load/save/migrations), `map-handle.js` (`map`, `mapReady` and their setters), `picture.js` (`latestFromServer`, `tracks`, `history`, coverage, `getLatestTrack`) and `format.js` (`formatZuluHhmm`, `NM_M`, `_pad3`...). Retarget the imports, then delete the `window` globals.
  2. Move `carrierFinalDistanceText` into `carrier-state.js`.
  3. Have `strip-view.js` import from `bay/**` directly, and delete `bay-view.js`'s re-export block.
  4. Add a small change bus (`onEfspChanged(kinds, fn)`, §3.1). Low modules then announce a change instead of importing a renderer.
  5. Add a module-graph assertion that the SCC shrinks, then that `panels/efsp/*-rules.js`, `*-state.js` and `format.js` are outside any cycle.
- **Effort** M–L overall. **Risk** low: the moves are mechanical, and the module-graph fixture re-records.

### 1.3 Acks, refusals and warnings: five trackers, two of them parse text

| Mechanism | Where | What it does |
|---|---|---|
| Pending Strip mutations | `efsp-state.js:41,495-510,537-543` | Replay on reconnect, plus refusal context |
| Undo's own ack | `panel/undo-slot.js:19,67-97` `_pendingUndoId` | Not registered as pending (`efsp-ws.js:69-86`), so it is lost silently on a disconnect |
| CreateStrip's ack | `panel/create-strip.js` `_pendingCreateStripMutationId`, consumed in `panel/refusal.js:273-280` | The form's message |
| ATO import | `ato-import.js:188` `_atoPendingImportId` | The dialog |
| Airspace forms | `airspace-panel.js:524-545` `view.handleAck` per open view | Inline errors |
| Correlation/MARSA/SFA/carrier/runway acks | `efsp-messages.js:161-221`, `carrier-panel.js:421`, `runway-status-panel.js:282` | Banner only, no cmid match |

- **Text-driven flows.**
  - CR-C's attestation (`control-release-rules.js:205-210`) regex-parses the *sentence* in a `VALIDATION_ERROR` detail (`crc-sync/src/efsp/board/handoff-control.js:392`). A source-text test guards it (`crc-desktop/tests/efsp-control-release-client.test.mjs:97-99`), but L20-STR-style wording passes now have a hidden consumer.
  - `notifyEfspMutationAck` (`panel/refusal.js:265-272`) routes the attestation first, then the red banner, then the amber warning.
- **The single `warning` field.**
  - `_showMutationWarning` (`panel/refusal.js:237-242`) maps codes (`DUPLICATE_IGNORED_WARNING`, `LUAW_WHILE_COMBINED`, TOFI-C's `NOT_IN_ACTIVE_AIRSPACE`) and otherwise shows the raw string. JoinFormation's prose ("mixed formation: type stays F16; ...") and the airspace panel's composed sentences (`airspace-panel.js:268,270,543`) also pass through it.
  - It has no state and no element fallback: unlike the refusal, a warning raised before the panel was opened is dropped (`:238`). It clears after 6 s with no dismiss.
  - The server half (one field, LUAW overwriting the op's warning) is ARCH-S #8.
- **Refusal code table.**
  - `MUTATION_ERROR_MESSAGES` (`panel/refusal.js:44-56`) is "enumerated from crc-sync" by hand. Its test (`crc-desktop/tests/efsp-refusal-banner.test.mjs:169-180`) checks a hand list too.
  - The server also returns `BAY_FULL`, `EXISTS`, `INTERNAL_ERROR`, `CRASH_BEFORE_PERSIST`, `NOT_PERSISTED`, `UNDO_BLOCKED` and `UNDO_UNAVAILABLE` (the last two are handled by the undo slot). The other five reach the controller as raw codes.
- **BUG (low): popover input lost on refusal.** Every popover closes on *send* (`bay/popovers/*.js`: `coordination.js:249`, `tofi.js:167`, `formation.js:125`, `control-release.js:122`, `marsa.js:89`). A refused coordination note, release form or MARSA declaration is lost, and only a SetBlock value is recovered (F-207).
- **Fix.**
  - In `efsp-ws.js`, add one `send(msg, { pending?: bool, onAck?: fn })`. It keeps a single cmid→continuation map, cleared with "orphaned" on a snapshot after a connect. Undo, CreateStrip, ATO, airspace forms and attestation then become `onAck` continuations.
  - On the server, return a structured refusal for the attestation, `{ reason: 'ATTESTATION_REQUIRED', needs, with }`, and `warnings: [{ code, text }]`. The client shows `text` and keys on `code`.
  - Generate the code list from a server scan in the test.
  - Keep the popover open until the ack, closing it on `ok`.
- **Effort** M (client) plus S (server fields, wire change). **Risk** medium.

### 1.4 Resync logic: the Board and the stores do the same job twice

- **Twin code.**
  - `efsp-state.js:420-470` (Board: `_boardSyncOf`, `_adoptBoardSeq`, `efspHeartbeatGapOf`, `_heartbeatBehind`) is the twin of `:162-252` (stores: `efspStoreGapOf`, `efspStoreHeartbeatGapOf`, `_storeBehind`).
  - `efsp-ws.js:239-301` has twin in-flight maps (`_resyncInFlight`, `_storeResyncInFlight`) with the same 10-beat retry.
- **Two trigger styles.** The Board's checks are explicit calls inside handlers (`efsp-messages.js:97,121` `noteEfspBoardMessageForSync`). The stores' check is the registry's only observer (`efsp-ws.js:292-296`), and it also runs for synthetic frames.
- **Synthetic frames.** After a store slice, `efsp-messages.js:79-90` re-dispatches `{ type: deltaType }` so the family's handler redraws. Each handler must therefore tolerate an empty frame: an untested contract.
- **Legacy and divergent state.**
  - `efspBoardSeq`/`getEfspBoardSeq` (`efsp-state.js:19,113,433,552`) is kept "for the existing readers". Only `crc-desktop/e2e/ui-b-resync.spec.js:41` reads it.
  - `_resetEfspStateForTest` (`:642-667`) does not reset carrier or SFA state, which `STORE_SYNC` replaces (`:167-168`).
- **Fix.**
  - Add one `SyncCursor` (`seq`, `epoch`, `behind`, `inFlight`, `gapFromDeltas`), keyed `board:<facilityId>` and `store:<key>`, with one `heartbeatGaps(msg)` and one `noteFrame(msg)`. Run it as the registry observer for both.
  - Give each store a `redraw()` hook instead of the synthetic dispatch.
  - Delete `efspBoardSeq`.
- **Effort** S–M. **Risk** low: `efsp-resync-state` and `efsp-store-resync` cover it.

### 1.5 Copies of server tables and topology

ARCH-W §1.3 has the mirror inventory and its parity tests. These copies are not in that table:

- **The Facility→Position topology, three times:**
  - `panels/efsp/airspace-capabilities.js:17-22` `FACILITY_POSITIONS`;
  - `panels/radar-panel.js:177-196` `EFSP_FACILITY_POSITIONS`;
  - `panels/efsp/efsp-ws.js:22-23` `DEFAULT_EFSP_FACILITY_ID = 'INCIRLIK'` and `_actingPositionsByFacility`'s keys.

  Each one is parity-tested. The snapshot already carries every Position with its `facilityId`, and `efspFacility` (`efsp-state.js:112`) already names the default Facility (ADR 0104).
- **More hard-coded Facility ids:** `metrics-panel.js:344,546` (`'INCIRLIK'` fallback), `ato-import.js:188` (`facilityId: 'TACTICAL'`), `bay-views.js:218` (`'CARRIER'`).
- **Unguarded client copies of authority rules:**
  - `efsp-state.js:626` `LINES_WITH_OTHERS = { TAC_C2: ['AIC','JTAC'] }` (ADR 0080's answer-for rule);
  - `combination-rules.js:8-9` `LOCAL_POSITION`/`NON_LOCAL_TOWER` (the server has `combination.NON_LOCAL_TOWER`, `crc-sync/src/efsp/efsp-ws.js:324`);
  - `control-release-rules.js:109-136` `handoffSteps` (behaviour-tested only);
  - TOFI-C's `_canMarkTofiEntered` (`bay/popovers/tofi.js`, on the branch).
- **Fix.**
  - Add one `facility-topology.js`: the static table as the before-first-snapshot fallback, and the snapshot's `positions` after it.
  - Delete the other two copies, and use `getEfspFacility()` instead of `'INCIRLIK'`.
  - Add `LINES_WITH_OTHERS` and `NON_LOCAL_TOWER` to `client-mirror-parity`.
- **Effort** S. **Risk** low.

### 1.6 State spread

- **218 module-level mutable bindings** (`let` or a top-level `Map`/`Set`). The largest holders are `app.js` 26, `efsp-state.js` 24, `panel/state.js` 21, `ato-import.js` 10 and `panel/undo-slot.js` 9.
- **`panel/state.js` exists only because an imported binding is read-only.** It holds 19 cached elements plus two pieces of UI state, each with a setter. Each feature could instead own its elements (look them up in its own `init`), which removes the file.
- **Squadron-wide server state is written into the per-user localStorage settings.** `app.js:609-627` copies `apt-config` (ATIS frequency, runway and manual weather for every airport) into `settings` and calls `saveSettings()`. A stale copy is then read before the next `apt-config` arrives, and `settings` mixes three owners: the user, the theater (`transitionAltFt`, `:594`) and the server. Fix: keep server state in `picture.js`/a store, not in `settings`. S.
- **Client-local views live in `efsp-state.js`.** These are the search Bay helpers, the "WITH AIC/JTAC" pseudo-Bay (`:621-638`) and the airspace edit log (`:54-68`). Move them to the panel layer that shows them. S.

### 1.7 Setter seams and dead exports

- **41 exported setters**, 16 of them named `…ForTest`. The ones that replace *functions*, not data, exist only because low modules call renderers directly:
  - `_setRenderAllOpenEfspBaysForTest`, `_setRenderBayForTest`, `_setSelectEfspStripByIdForTest` (`bay-view.js:717-720`);
  - `_setUpdateMapForTest` (`geojson.js`);
  - `setEfspSender`, an 11-case switch (`efsp-ws.js:335-350`);
  - `setSendToSync`/`setIsSyncOpen` (`sync.js`).

  With the change bus (§3.1) and one transport object (`efspTransport.send`) a single seam would do. `setEfspSender` has no production caller; e2e uses it in 3 specs.
- **11 exports with no reader anywhere:**
  - `airspace-draw.js` `isDrawing`
  - `airspace-layer-menu.js` `OVERRIDE_VALUES`
  - `app.js` `_setSettingsForTest`
  - `airspace-calendar.js` `getAirspaceCalendar`
  - `ato-strip.js` `getArHighlightStripIds`
  - `carrier-state.js` `isCarrierDerivedBlock`
  - `efsp-arrivals.js` `efspArrivalsVersion`
  - `panel/combination.js` `_resetCombinationForTest`
  - `topbar.js` `$aptDisplay`
  - `track-label.js` `isSea`, `isGround`
- **Test-only leftovers of retired designs:** `efsp-nla.js:214,229` `UNDO_WINDOW_MS`/`isUndoAvailable`, an old client undo window that the server-driven undo slot replaced; `efsp-state.js` `getEfspBoardSeq`; `runway-status-rules.js:151` `runwayStatusReasonFor`; `strip-template.js:676` `requiredBlocksFor`; `carrier-panel.js` `CARRIER_POSITION_IDS`.
- **Fix:** delete them and re-record `module-graph-exports.json`. S, no risk.

## 2. God files

Sizes in lines, at S-REFACTOR-DONE (`c6a48f85`) → now (`1d058ca6`). Client total: 21,848 → 26,733 (+22%).

| File | Then → now | What it mixes | Split |
|---|---|---|---|
| `panels/efsp/strip-view.js` | 924 → 977 (+45 TOFI-C) | Layout; five exchange rows (coordination, TOFI, MARSA, track, handoff); alert aggregation (`_stripAlerts` `:469`); indicator slots; the ⋯ menu with its own open/close lifecycle (`:684-905`, 220 lines); the waiting ticker. 24 imports, 101 names. | `strip/exchanges.js`, `strip/alerts.js` (also feeds the render signature, §3.1), `strip/menu.js` (on the portal, §3.3) |
| `geojson.js` | 940 → 940 | Every map layer's feature builder plus `updateMap` | Not regrown. Later, the builder per feature module |
| `map-setup.js` | 820 → 872 | **One function**, `initMap` (`:56-745`): 36 `addLayer`s, ~40 sources, 10 map handlers, the basemap notice. AIRSP-2P-B had to register its layers here (`b8c317b6`). | A declarative `map-layers.js` table, each feature module contributing its `{ sources, layers }`; `map-interactions.js` for the handlers. M, low risk |
| `panels/efsp/strip-template.js` | 858 → 860 | Block Map mirror tables, value resolution, formatting, annotation history, an import of a panel (`carrier-panel.js`) | Formatting to `format.js` (§1.2) |
| `app.js` | 723 → 741 | Constants, settings and their migrations, picture state, fade beat, WS connect/reconnect, the non-EFSP message switch, zoom limits, the coalition button, `apt-config`→settings | §1.2's leaf modules. `app.js` becomes boot plus the socket. M |
| `panels/efsp/efsp-state.js` | 554 → 712 (+7 TOFI-C) | The Board mirror; four stores inline (airspace, correlation, MARSA, runway) while carrier and SFA are delegated; Board sync; store sync; pending mutations; five alert maps from one frame (conformance, conflicts, hints, obligations, `tofiRegime`); airspace edit log; queries; client-local pseudo-Bays | `board-mirror.js`, one `*-state.js` per store (as carrier/SFA already are), `sync-cursor.js` (§1.4), `alerts-state.js`, `pending.js`. M, low risk |
| `panels/efsp/airspace-editor.js` | new, 671 | A pure model (`draftFromDefinition`, `buildPatch`, `validateDraft`, `conflictModel`, `impactNote`: all exported, unit-tested) plus the DOM form. Import cycle with `airspace-geometry-editor.js`. | `airspace-editor-model.js` plus the DOM. Break the cycle with a callback. S |
| `panels/efsp/airspace-panel.js` | 241 → 547 | Card list, filter persistence, ⋯ menu, delay form, view registry, three wire handlers, whole-list rebuild (§3.1) | Card into `airspace-card.js`, keyed update. S–M |
| `panels/efsp/bay-views.js` | 363 → 356 | Bay descriptors, pattern board, final view with its own timer, SFA header. Imports `app.js` for radars. | Fine in size. Fix the `app.js` import (§1.2) |
| `panels/efsp/efsp-ws.js` | 297 → 350 | 10 sender functions with the same envelope; Board and store resync scheduling | One `send(type, fields, opts)` (§1.3); resync to `sync-cursor.js` |
| `panels/efsp/bay-view.js` | 721 → 720 | Selection, dispatch, render signature, reconciler, re-export hub | Delete the re-export (§1.2) |
| `panels/efsp/efsp-panel.js` | 94 → 99 | Init and re-exports | Fine |
| `dock.js` / `srs-radio.js` / `metrics-panel.js` | 767 / 660 / 655 → unchanged | | Not regrown. `srs-radio.js` has the §3.4 bug |

## 3. Bad paradigms

### 3.1 Rendering: a hand-kept signature, hand-kept render lists, whole-list rebuilds

- **BUG ×2: stale Strip chips.**
  - `bay-view.js:532-612` `_stripRenderSignature` lists, by hand, every non-`rev` input a Strip renders. A chip whose input is not on the list is not redrawn while the Bay stays open. This is F-305's class again.
  - **SCRAMBLE on ground traffic.** `scramble.js:118-138` lights HAWK31's chip when *another* flight's 14E becomes SCRAMBLE. Probe: after VIPER11 goes SCRAMBLE, `scrambleAlertsFor(HAWK31)` goes 0 → 1 while HAWK31's signature is unchanged. `crc-desktop/e2e/alert-scramble.spec.js:147` passes only because it switches Bays (a fresh build) before it looks. The chip also stays after the scramble ends.
  - **TOFI-C's `tofiRegime` chip.** It was added to `_stripAlerts` (TOFI-C diff, `strip-view.js` `_stripAlerts`), but `alr:` (`bay-view.js:601`) still hashes only conformance and conflicts. Probe on the TOFI-C tree: `applyEfspAlerts({ tofiRegime: [...] })` leaves the signature unchanged. TOFI-C's unit test calls `_buildStripEl` directly, and its e2e does not assert the chip.
  - **Fix:** put the rendered alert list into the signature, `'alr:' + _stripAlerts(strip).map(a => a.key + '/' + a.tone + '/' + a.text)`, which replaces the hand list. Add a unit test that, for each `ALERT_SLOT_KEYS` entry, changes its input and asserts that the signature moves. S, low risk.
- **BUG: the Undo button cannot reliably be clicked with a mouse.** `panel/undo-slot.js:144-149` re-runs `_render()` every 250 ms while a slot is live. `:158` calls `replaceChildren()` and creates a new `<button>` each time. A press that spans a tick has its `mousedown` and `mouseup` on different elements, and `click` does not reach the listener. At a typical 80–120 ms press that is roughly a third to a half of clicks; Ctrl+Z and `.undo` still work. Playwright's instant click hides it. **Fix:** build the button once and update only its text in the tick. S.
- **BUG (low): the airspace Delay note loses its text.** `airspace-panel.js:451-490` empties the list (`:465`) and rebuilds every card on every airspace delta, calendar frame, ack, snapshot or filter click. Focus is restored only inside `.airspace-editor` (`:459`). The Delay form (`:410-420`) is rebuilt empty. The runway-status panel does the same with its runway-change `<select>` (`runway-status-panel.js:257,91`). **Fix:** keyed cards updated in place, like the Bay reconciler, or at least keep form drafts in module state. S–M.
- **The render web.**
  - Each handler in `efsp-messages.js` calls its own hand list of renderers (`renderAllOpenEfspBays`, `refreshEfspPanel`, `updateMap`, `refreshCorrelatedHighlight`, `renderAirspacePanel`, ...). The lists differ for no stated reason: `efsp-sfa-delta` refreshes neither the panel nor the map, and `efsp-marsa-delta` does not update the map.
  - A new feature must find every handler that changes its input. That is how the two BUGs above happened.
  - **Fix:** `markEfspChanged(kind)` plus one rAF flush that calls subscribed views (`onEfspChanged(['board','alerts'], render)`). This replaces the lists and most render imports (§1.2). M, medium risk (ordering: see `panel/refusal.js:213`'s ordering guarantee, which becomes "state before flush").

### 3.2 String-built HTML

- **The EFSP tree is clean:** `textContent` and `createElement` throughout. The only `innerHTML` writes there are clears and one fixed literal.
- **Eight sinks interpolate data without escaping:**
  - `panels/airport-selector.js:44-46` (mission airport `icao`/`name`);
  - `:149` (`d.error` from crc-sync);
  - `:155-158` (numbers);
  - `panels/aprt-panel.js:115-118,407-409` (cloud labels, airport names);
  - `srs-radio.js:180-196,274` (numbers and fixed labels).
- **Escaped by hand:** `sync.js:136-141` escapes only `"`, and `topbar.js:113` escapes notes but not `version`.
- **No CSP.** `index.html` has no Content-Security-Policy. The renderer has the preload's `crcUpdate`/`crcLinks`, so an injected script could reach them (ARCH-W §1.5).
- **Fix:** `textContent` for the three data sinks, plus a CSP meta (`script-src 'self' cdnjs…`; inline styles allowed). S, low risk (check the CDN list).

### 3.3 Popovers and menus

- **The pattern is copied nine times.** Each popover module (`bay/popovers/*.js`, eight files) and the Strip ⋯ menu (`strip-view.js:835-905`) has its own `_openXEl`, `_closeX` and `_onDocPointerDownCloseX`, plus a `setTimeout(() => document.addEventListener('pointerdown', …, true), 0)`. Only Escape is central (`bay/popover-portal.js:176-181`).
- **Opening one popover closes only its own kind**, so two popovers can be open at once. The airspace ⋯ menu (`airspace-panel.js:275`), the layer menu (`airspace-layer-menu.js`) and the track-panel prompt (`track-panel.js:310-348`) are each a fourth pattern.
- **Fix:** `openPopover({ anchor, strip, build }) → handle` in the portal. It owns outside-click, Escape, one-open-at-a-time and the post-close render, and the nine copies shrink to their `build`. S–M, low risk (Playwright popover specs).
- **The four stacked step buttons (CR-C, `docs/wip/CR-C.md:37`).** `control-release-rules.js:109-136` yields up to five steps (Comms, Control, Release…, Unable, Withdraw). In the 176 px tab column (`.efsp-x-buttons` is `flex-wrap`, `crc-desktop/app/public/css/efsp-panel.css:1426`) they wrap into four rows and overflow a 186 px Bay. TOFI-C adds an "Entered" step to the TOFI row. **Fix:** show the next step only, in the tab (the layout rule at `strip-view.js:11-15` already says "tab bottom: the one next step"), and list the rest in the ⋯ menu. S, UI review needed.

### 3.4 Timers

- **BUG: PTT can stick on.** `srs-radio.js:386-392` starts `setInterval(_post('/ptt/start'), 400)`. `:418-425`: `keyup` is ignored when `_isTyping()`, and a key held during an alt-tab never delivers `keyup`. Nothing listens for `blur`, `visibilitychange` or `pointercancel`. `lxsrs_v2/lxsrs_v2/api.py:99-102` has no PTT timeout. The result is an open mic on the squadron frequency until the key is pressed again. **Fix:** `window` `blur` plus `visibilitychange` call `_pttUp`; the `keyup` for the PTT key always releases. Add a server-side 1 s keep-alive expiry in lxsrs as a backstop. S.
- **`_finalTimer` never stops.** `bay-views.js:259-267` runs every `FINAL_REFRESH_MS` forever once a final view has been shown, iterating an empty set. Clear it when `_finalMounts` empties. S.
- **Fine:** `app.js`'s fade and maintenance beats, `main.js:65`, `dock.js:155`, `srs-radio.js:651-652` and `topbar.js:218` run for the app's lifetime by design. `los-panel.js`, `metrics-panel.js`, `staleness.js` and the strip waiting ticker (`strip-view.js:127-135`) clear themselves.

### 3.5 Other

- **`window.crc`:** no production reader. It is set only by `crc-desktop/e2e/helpers/modules.js`. Fine. The `window` globals that do exist are in §1.2.
- **Primary/Observer:** §1.1.
- **Client authority copies:** §1.5 and ARCH-W §1.3.
- **The button that dies on press:** `runway-status-panel.js:81-83` disables the button "until the next render". `_sendEfsp` drops silently when the socket is closed (`efsp-ws.js:36-41`), so no ack arrives and the button stays dead until another frame happens to re-render. It is part of §1.3's `send` result.

## 4. Naming

- **Post-W7 drift is small (identifiers only; comments were L20's):**
  - `app.js:741` `_setCoverageHeldPositions`;
  - `control-release-rules.js:79-81` chip key `held` and CSS `.efsp-handoff-held` (`crc-desktop/app/public/css/efsp-panel.css:1929`), which mean "mine";
  - `efsp-metrics-client.js:117` `'not-held'`;
  - `panel/undo-slot.js:36,48,57` doc examples with `APP`/`TWR`;
  - `runway-status-rules.js:231` "is not held" in controller-facing prose.

  `GND`/`TWR` in `combination-rules.js:12,17` are radio-frequency labels and are correct.
- **One concept, several names:**
  - The Positions this controller works: `getActingPositions`, `coverageSignedOnPositions`, the ack's `signedOn`, radar-panel's `signedOn`, and "Acting-As" in the UI. After §1.1, call it `signedOnPositions()` with `isPrimaryAt()`.
  - `efspFlightDataList` is a `Map`; call it `efspFlightData`.
  - `NM_M` (`bay-views.js:44`), `M_PER_NM` (`airspace-geometry-model.js:16`), `CORRIDOR_NM_M` (`airspace-layer.js:12`) and 14 inline uses of `1852` (2P-B's `NM_M` clash): export `NM_M` from `geo.js`.
- **Underscore exports:** 164 of about 1,010 exported names start with `_`, the "private" marker, yet are imported across modules: `_showMutationError` by 6 modules, `_mountPopover` by 10, and the 40-odd `_can…`/`_dispatch…` that `strip-view.js` imports. Drop the underscore on anything another module imports, and keep it for `…ForTest`. S, mechanical; the fixture re-records.
- **CSS:**
  - The prefixes are mostly consistent (`efsp-` 346 rules, `airspace-` 72, `runway-` 45, `aprt-`, `srs-`, `tp-`). Airspace alone has four (`airspace-`, `asg-`, `aslm-`, `asd-`).
  - Of the airspace rules, 13 sit in `efsp-panel.css`, and `.airspace-card-header` is defined in both files. The `carrier-*`/`runway-*`/`panel-ctrl-*` rules also live in `efsp-panel.css` (1,938 of 3,669 CSS lines).
  - Generic classes shared across files: `.active` (4 files), `.open` (3), `.light` (3), `.disabled`, `.visible`, `.dot`, `.connected`/`.disconnected`/`.reconnecting` (topbar and SRS; the SRS ones are ID-scoped).
  - **Fix:** move each panel's rules to its own CSS file, and prefix-scope the generic state classes (`is-open`, under the panel root). S, low risk.
- **User-visible ADR references:** TOFI-C's `NOT_IN_ACTIVE_AIRSPACE` text (`panel/refusal.js`, on the branch) ends with "(crc-sync docs/adr/0102)" in a controller-facing warning. Keep ADR numbers in `title`, not in the text.

## 5. Tests

- **The e2e helper checks the client's own claim.** `crc-desktop/e2e/helpers/app.js:42-49`'s comment says "the ack is what actually makes the Positions held". The wait, though, polls `getActingPositions(f)`, which is set synchronously on send (§1.1), so it never waits. **Fix:** wait for `crc.state.getEfspPosition(id).primary` (or the ack). S. It would also have exposed §1.1.
- **Specs injecting frames instead of driving the server:** 11 of 40 specs. The airspace ones matter most:
  - `airspace-panel.spec.js:41-62` and `airspace-geometry.spec.js:48-59,165` replace `sendEfspAirspaceMutation` and inject the deltas and acks themselves. Create, edit, delete and geometry save therefore never reach crc-sync in e2e. Client/server validation agreement rests on the unit parity test alone.
  - `efsp-undo.spec.js:59` and `gclc-combine.spec.js:25` inject `efsp-undo-voided`/offer frames (UNDO-C noted the first).
  - `l19`, `l22`, `l4-badges`, `l5-arrivals` and `store-resync` call `applyEfsp*` directly.

  **Fix:** one real round trip per airspace op (S each). Keep injection for frames the harness cannot provoke, and say so in the spec header.
- **Specs coupled to state internals:** 12 specs and helpers read `crc.state.efspStrips` (28×) and `crc.state.efspFlightDataList` (38×) as raw Maps, with 282 `page.evaluate`s in specs. Any §2 split of `efsp-state.js` breaks them. **Fix:** a small `e2e/helpers/state.js` (`stripOf(cs)`, `flightDataOf(cs)`) as the one place that knows the Map names. S.
- **Fragile selectors:**
  - 8 bare `locator('select')`, 51 `.nth`/`.first()`, 0 `data-testid`, 7 `dispatchEvent('click')` (which skips actionability, so it hides an overflowing or covered button: see §3.3), and 3 `force: true`.
  - `seedStrip` (`helpers/app.js:83,94`) waits for the *global* `.efsp-strip` count +1, which another controller's Strip also satisfies.
  - The popover `select` rule and hooks are in ARCH-W §5.3 item 5.
- **TOFI-C leftover.** `crc-desktop/e2e/tofi-regime.spec.js:60` (on `efsp-wp5-correlation`) writes `b.screenshot({ path: '/tmp/claude-1000/…/scratchpad/tofi-c.png' })`, a session-specific absolute path. Delete it, or use `test.info().outputPath`. S.
- **Unit gaps on new modules.** No test file names `airspace-geometry-editor.js` (374), `airspace-draw.js` (226), `bay/popover-portal.js` (205) or `srs-radio.js` (660). `airspace-geometry-model.js` is tested; the editor's DOM is covered only by the stubbed e2e above. Add a portal test (placement flip, outside-close, Escape) with the §3.3 refactor, and a PTT test with §3.4.
- **Fine:**
  - `module-graph.test.mjs` (every module evaluates as an entry, frozen exports) caught every ESM regression.
  - `client-mirror-parity` and the airspace parity tests are strong.
  - `efsp-ui-reachability` renders real Strips under the DOM stub.
- **Suggested addition:** a module-graph assertion on the SCC size (§1.2), and a unit test that `_stripRenderSignature` moves for every alert key (§3.1).

## Proposed fix lanes (for the supervisor)

1. **DESK-SIGNON** (M, client plus one wire field): §1.1 and the helper wait in §5. Highest cost.
2. **DESK-RENDER-BUGS** (S): the signature from `_stripAlerts` with its test, the Undo button, the PTT release, the airspace Delay form, and the `_finalTimer` (§3.1, §3.4).
3. **DESK-GRAPH** (M): the leaf modules, the end of the `window` globals and of `bay-view`'s re-exports, then the change bus (§1.2, §3.1). It unblocks the §2 splits.
4. **DESK-ACKS** (M plus server S): `send(msg, {onAck})`, the structured attestation and warnings, the refusal code scan, popovers closing on ack (§1.3, ARCH-S #8).
5. **DESK-SYNC** (S–M): `SyncCursor`, store `redraw()`, delete `efspBoardSeq` (§1.4).
6. **DESK-TIDY** (S): topology module and parity additions (§1.5), dead exports (§1.7), naming and CSS (§4), the `innerHTML` sinks and CSP (§3.2), popover `openPopover` (§3.3), the TOFI-C screenshot line, and real-server airspace e2e (§5).
