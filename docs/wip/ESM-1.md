# ESM-1: the CRC client becomes native ES modules

## Report

**Branch** `lane/ESM-1-client-modules`, base `165a517`. Own commits (first-parent):
914474c step 0 · 829d1d5 codemod · **77cf674 sources converted** · 8470f6e inert imports + client-env/fresh-graph (S-ESM1b) ·
16fb7a1 test seams + bridge history (S-ESM1c) · 35006fa, f6d9cad, 8203df3 setters for T lanes · c346f30 metrics hooks via imports
(S-ESM1d) · 3b25e44 packaging assertion · 05e3095 docs/README · merges 8a33e76 (Ta), b3c2bed (Tb), 3ad0ddb (Tc), 47be9ae and
8f0186d (efsp-wp5-correlation) · afbeb67 efsp-scenario-resync to modules · 395ebd0 + 06d1d84 bridge `history` fix.
**Counts.** crc-desktop 866 (865 pass, 1 todo) → 872 (870 pass, 2 todo, 0 fail): −4 client-global-surface (its todo
included), +9 module-graph (7 + 2 finding todos), +1 packaging-config. Every other file is the same, one for one
(e2e-spec-hygiene is 34 at base and in the unit). crc-sync 2083 at base → 2146 on the merged unit: 2144 pass, 1 todo, 1 fail
(the fail is efsp-ato-tokenize's timing test under load ~80; it passes alone). Freeze goldens 47/47 identical, no
behaviour commits. No selfcheck or soak needed (no crc-sync/src touched).
**Playwright (E2E_LANE=1, load avg 35-90):** smoke, l2-block-editing, l22-stars-scope and marsa-popover pass (24/25, then marsa-popover
3/3 alone). l15-metrics:28 fails on the verdict timeout with the classic integration client too, so it is not ESM.
**Bridge fix found in step 9:** shadowing `window.history` (S-ESM1c) made every Playwright click wait out its timeout for a
"scheduled navigation" (8.6-10.7 s vs 3.5-5 s). That was the l2 F-201 and marsa-popover timeouts. `history` is now
the real History with app.js's Map methods forwarded (Proxy). Bridge: 668 names, SKIPPED [] (fixture).
**Structure fixtures:** client-global-surface.json removed; module-graph-exports.json new (56 modules).
**Outside "Owns"** (all ruled or forced): crc-sync/tests/efsp-scenario-resync.test.mjs (a 4th client-reading test);
the merge resolution of crc-desktop/tests/ws-message-contract.test.mjs; tests/helpers/module-body.mjs (W1-T-7).
**Defaults taken:** bridge details (setters for 7 senders only, console.error on an unexpected skip, not a throw);
imports after the 'use strict' prologue; app.js's wrapped boot statements not re-indented.
**Queue item 3:** `_callsignOfFdr` only. carrier-panel.js now imports efsp-panel.js's version (fallback ''), which already won before.
**Packaging:** pack:linux built the AppImage, and its asar holds js/package.json, main.js and the bridge. Not launched (default endpoint is production).
**Findings:** latent ReferenceErrors in tools-panel.js:33-34 and geojson.js:651-652 (test.todo); stale header comments on
the removed guards (L20); 336 always-true `typeof` guards on imports (ESM-2/L20); window.getLatestTrack/getAllTracks are
still app-published globals; the integration bugs reported in step 9 (ws-hub broadcasts, airspace-config) are fixed upstream.
**For the supervisor:** the e2e spec migration plus bridge removal (queued); l15-metrics:28 on the integration branch.


## Step 0: code as found (base 165a517)

**Base counts.** crc-sync `npm test`: 2083 tests, 2083 pass. crc-desktop `npm test`: 866 tests, 865 pass, 1 todo
(the client-global-surface duplicate-name todo). Freeze goldens (`node --test tests/freeze/freeze-*.test.mjs`): 47/47.

**Briefing references, re-found by symbol.**
- `index.html` script block: `/js/config.js` at :919, local scripts :920–980 (55 scripts, sync.js first,
  srs-radio.js last), the load-order comment :898–918, the EFSP load-order comment :940–945. CDN scripts at :7
  (maplibre-gl 3.6.2) and :12 (dockview-core 5.1.0).
- `crc-desktop/main.js:140`: `win.loadURL(\`http://localhost:${config.wsPort}\`)` (modules get an origin).
- `app/server.js:37` `MIME` map, `'.js': 'application/javascript'` at :39. `/js/config.js` generated at :69–77
  (four `var`s: CRC_SYNC_URL, CASDOOR_CLIENT_ID, CASDOOR_ENDPOINT, MAPTILER_KEY).
- `crc-desktop/package.json:10` test script `node --test 'tests/*.test.js'`.
- crc-sync tests reading client files: `theater-context.test.mjs:18` (`require` of magnetic.js),
  `wire-payload-contract.test.mjs` (text scan of app.js / efsp-state.js), `efsp-time-chains.test.mjs:47-48` (byte compare).
- 34 scripts carry a guarded `module.exports` (plus atc-scope.js:471, a `typeof module` guard around `setInterval(atcTick, 500)`).

**Scope map** (scratchpad `analyze.js`, acorn + eslint-scope, scope-accurate rather than the column-0 regex of
`client-global-surface.test.js`): 55 scripts, 1,250 top-level names, 914 of them read by another script.
Per file: top-level names / names other scripts read (to export) / scripts it reads from:

| script | decls | read by others | reads from |
|---|---|---|---|
| sync.js | 19 | 15 | 1 |
| geo.js | 7 | 7 | 2 |
| magnetic.js | 9 | 8 | 2 |
| iff.js | 11 | 8 | 3 |
| track-label.js | 31 | 27 | 2 |
| atc-scope.js | 36 | 23 | 8 |
| geojson.js | 42 | 36 | 15 |
| icons.js | 12 | 12 | 2 |
| map-setup.js | 4 | 4 | 11 |
| elevation.js | 20 | 13 | 2 |
| los.js | 14 | 8 | 3 |
| dock.js | 46 | 27 | 11 |
| panels/topbar.js | 29 | 15 | 5 |
| panels/settings-panel.js | 8 | 7 | 7 |
| panels/radar-panel.js | 14 | 10 | 6 |
| panels/los-panel.js | 6 | 4 | 3 |
| panels/airport-selector.js | 10 | 8 | 6 |
| panels/track-panel.js | 13 | 9 | 9 |
| panels/tools-panel.js | 1 | 1 | 1 |
| panels/aprt-panel.js | 20 | 15 | 6 |
| panels/efsp/efsp-state.js | 78 | 56 | 3 |
| panels/efsp/efsp-arrivals.js | 20 | 16 | 1 |
| panels/efsp/time-chains.js | 7 | 5 | 1 |
| panels/efsp/strip-template.js | 39 | 24 | 7 |
| panels/efsp/strip-drag.js | 6 | 5 | 1 |
| panels/efsp/efsp-nla.js | 25 | 10 | 1 |
| panels/efsp/carrier-state.js | 14 | 13 | 1 |
| panels/efsp/sfa-state.js | 13 | 10 | 1 |
| panels/efsp/efsp-gestures.js | 4 | 4 | 1 |
| panels/efsp/dot-command.js | 2 | 1 | 1 |
| panels/efsp/annotation-editor.js | 1 | 1 | 1 |
| panels/efsp/efsp-ws.js | 24 | 20 | 3 |
| panels/efsp/efsp-metrics-client.js | 15 | 10 | 6 |
| panels/efsp/correlation-highlight.js | 10 | 9 | 5 |
| panels/efsp/marsa-badge.js | 9 | 8 | 3 |
| panels/efsp/pattern-board.js | 13 | 5 | 1 |
| panels/efsp/final-panel.js | 17 | 10 | 1 |
| panels/efsp/ordnance-advisory.js | 6 | 5 | 2 |
| panels/efsp/strip-fields.js | 14 | 7 | 2 |
| panels/efsp/carrier-panel.js | 22 | 16 | 7 |
| panels/efsp/bay-views.js | 30 | 20 | 11 |
| panels/efsp/bay-view.js | 160 | 124 | 21 |
| panels/efsp/strip-view.js | 37 | 30 | 21 |
| panels/efsp/efsp-flight-plan-lookup.js | 4 | 2 | 2 |
| panels/efsp/efsp-stereo-routes.js | 6 | 4 | 3 |
| panels/efsp/scramble.js | 17 | 14 | 5 |
| panels/efsp/efsp-panel.js | 95 | 60 | 14 |
| panels/efsp/ato-strip.js | 15 | 14 | 3 |
| panels/efsp/ato-import.js | 35 | 23 | 3 |
| panels/efsp/airspace-panel.js | 9 | 7 | 4 |
| panels/efsp/field-state-rules.js | 24 | 19 | 2 |
| panels/efsp/field-state-panel.js | 18 | 15 | 7 |
| panels/metrics-panel.js | 38 | 31 | 4 |
| app.js | 72 | 59 | 31 |
| srs-radio.js | 0 | 0 | 0 |

**Duplicates.** Only `_callsignOfFdr` is still declared twice (carrier-panel.js, efsp-panel.js; efsp-panel.js wins
today). `_el` is now declared only in metrics-panel.js (merge4 removed the pattern-board/final-panel copies) and
`finite` once.

**Cross-file binding writes** (an import binding is read-only, so each needs a setter in the declaring module):
`map` (map-setup.js:7), `_drag` (:514, :642), `_measure` (:653, :661), `mapReady` (:666), all declared in app.js;
`bullseyePickTarget` (settings-panel.js:140, :154, app.js); `selectedApt` (airport-selector.js:43),
`approachRwyCourse` (:107, app.js); `_pendingConvertStripId` (strip-view.js:727, :731, declared in bay-view.js);
`_activePositionTab`, `_activeBayId` (scramble.js:156-157, efsp-panel.js).

**Implicit globals.** sync.js:72-74 assigns config.js's `CRC_SYNC_URL`, `CASDOOR_ENDPOINT`, `CASDOOR_CLIENT_ID`;
they exist as global `var`s (config.js loads first), so strict-mode assignment still resolves. No top-level `this`.

**Reads of names nobody declares** (latent ReferenceErrors today, unchanged by the conversion, see Findings):
tools-panel.js:33-34 `_pressureAtAlt`, `ISA_L`, `ISA_INV`, `T_REF_ALT`; geojson.js:651-652 `trueHeading`.

**window/globalThis writes.** app.js:59-60 `window.getAllTracks` / `window.getLatestTrack` (read through `window.` by
track-panel, bay-view, bay-views, carrier-panel, correlation-highlight). No `globalThis.X =` in the client.
CDN globals read: `maplibregl` (map-setup.js), `dockview` (dock.js). config.js's four `var`s are read as globals.

**Top-level statements that are not declarations** (step 4 checks each): sync.js:215 `applyConnOverrides()`;
settings-panel.js:178 keydown listener; track-panel.js:177 IIFE `initFiledRouteButton`; strip-view.js:444-451
`INDICATOR_ORDER.splice` / `ALERT_SLOT_KEYS.add` (own consts); efsp-metrics-client.js:313 beforeunload listener;
atc-scope.js:471 `setInterval(atcTick, 500)`; app.js:59-60 window writes, :271, :846, :851 `setInterval`s and the boot
section :867-881 (`loadSettings()` … `connect()`); srs-radio.js:6 self-contained IIFE (DOM by id). Declarations with
calls at top level: DOM lookups in topbar.js / settings-panel.js, dock.js `_loadJSON`/`_loadPinnedPanels` (own
functions), carrier-panel.js:23 `Object.keys(CARRIER_CAPABILITIES)` (own), aprt-panel.js:43 `crypto.randomUUID()`,
and many `new Map()`/`new Set()`.

**How the UI starts.** app.js's boot section (last provider script) calls `initDock()` (dock.js) and the panel inits
directly at script-execution time; dock.js mounts panels lazily. srs-radio.js runs after it.

**The e2e suite reads client globals.** 31 Playwright specs call client functions by bare or `window.` name inside
`page.evaluate` (about 70 names: `getAllEfspStrips`, `getEfspFdr`, `sendEfspMutation`, `toggleDockPanel`, `dock`, `map`,
`efspStrips`, `efspFdrs`, `history`, ...), and four places **replace** a sender to intercept it
(`window.sendToSync = …` l15-metrics; `window.sendEfspMutation = …` l2-block-editing; helpers/app.js
`expectDoesSomething` wraps six `sendEfsp*`). Modules have no global scope, so this needs a bridge (see Defaults).

## Step 1: the codemod

Scratchpad scripts (not committed): `analyze.js` (step-0 map) and `codemod.js`, both acorn + eslint-scope. In
script mode, eslint-scope leaves every global-scope reference unresolved (`through`), including a file's own names.
The first codemod run tripped on that, so the scripts drop a file's own top-level names from its `through` set. The
codemod, in short:

```js
// for each script in index.html tag order (config.js excluded):
//   declared = top-level names (eslint-scope globalScope.variables with defs)
//   through  = globalScope.through names minus declared            // what it reads from elsewhere
//   guard    = top-level `if (typeof module …) { module.exports = {…} }` blocks (shorthand or `a: b` properties)
// winner(name) = the LAST script in tag order that declares it        // it won the shared global scope
// exports(file) = names other scripts read from it ∪ names its guard published
// edits: `export ` before each top-level declaration of an exported name; guard blocks removed (`a: b` aliases become
//        `export { b as a }`); one `import { … } from './rel.js'` per source file after the 'use strict' prologue
// the output is re-parsed as a module (sourceType 'module') before it is written
```

Output commit `829d1d5` (54 files). Every hand edit after it is listed under "Fixes forced by module semantics".

## Fixes forced by module semantics

- **Cross-file binding writes** (an import is read-only): setters in the declaring module, with the writer calling
  them. app.js `_setMap`, `_setMapReady`, `_setDrag`, `_setMeasure` (map-setup.js), `_setBullseyePickTarget`
  (settings-panel.js), `_setSelectedApt`, `_setApproachRwyCourse` (airport-selector.js); bay-view.js
  `_setPendingConvertStripId` (strip-view.js); efsp-panel.js `_setActivePositionTab`, `_setActiveBayId` (scramble.js).
- **Duplicate `_callsignOfFdr`**: carrier-panel.js's copy (fallback `fdrId`) is deleted, and it imports efsp-panel.js's
  (fallback `''`), which won the global scope for everyone before (S-ARCH2(3), queue item 3). `_el` is no longer
  duplicated (metrics-panel.js only).
- **Start-up calls** moved behind `main.js` (S-ESM1a, S-ESM1b): see step 4.
- **efsp-metrics-client.js `_efspMetrics()`** read its hooks through `typeof globalThis[name]`. It now reads the
  imported bindings (S-ESM1d). That was the only string-keyed global lookup of a module export.
- **Unexported names other code reached**: the e2e specs and unit tests used names that only their own file read
  (`efspStrips`, `efspFdrs`, `efspAirspaces`, `_ws`, `_metricsPollTick`, `_moveStrip`, `applySnapshot`, `buildDots`,
  `_buildStripEl`, …). They are now exported (commits 16fb7a1, 35006fa).

## Setters and test seams (each reassigns the module binding, so every importer sees the replacement)

sync.js `setSendToSync`, `setIsSyncOpen`, `_setSyncSocket` (already existed); efsp-ws.js `setEfspSender(name, fn)`
(sendEfspMutation, sendEfspCreateStrip, sendEfspSetPositions, sendEfspAirspaceMutation, sendEfspCorrelationMutation,
sendEfspMarsaMutation, sendEfspFieldStateMutation, sendEfspSfaMutation, sendEfspCarrierMutation, _sendEfsp);
geojson.js `_setUpdateMapForTest`; bay-view.js `_setRenderAllOpenEfspBaysForTest`, `_setSelectEfspStripByIdForTest`,
`_setRenderBayForTest`, `_setExpandedStripId`, `_setSelectedStripIdForTest`; los-panel.js `_setShowLosProfileForTest`;
app.js `_setSettingsForTest`, `_setCoverageRadars`, `_setCoverageDatalink`, `_setCoverageHeldPositions`;
efsp-panel.js `_setCurrentRefusalForTest`, `_setBayContentElForTest`; efsp-metrics-client.js
`_setEfspMetricsClientForTest` (null restores lazy creation).

## Test helpers (tests/helpers, ESM-1)

- `client-env.mjs`: import it first in a client test (sibling imports evaluate in order), or preload it with
  `node --import`. It defines only the globals that are missing: `window` is `globalThis` (as in the old vm sandboxes,
  so `globalThis.getLatestTrack = …` reaches `window.getLatestTrack`), `document` (`getElementById` → null),
  in-memory `localStorage`/`sessionStorage`, rAF, `WebSocket` with `OPEN = 1`, permissive `maplibregl`/`dockview`,
  and config.js's four vars. It also exports `permissive()` and `memoryStorage()`.
- `fresh-graph.mjs` (+ `fresh-graph-hooks.mjs`): `const g = freshGraph(); await g.import('panels/efsp/efsp-state.js')`.
  Every freshGraph() is a new generation of every client module, shared within the generation. A
  `module.register` resolve hook carries `?gen=N` from a client parent to every client import (Node 22.22). Globals
  are not per generation.
- `module-body.mjs`: `moduleBody(src)` / `exportedNames(src)` for the two time-chains byte-compare tests (W1-T-7).

## Step 4: evaluation order

Evaluation order from main.js (DFS post-order, the same in the browser and in Node): sync.js → geo.js → magnetic.js → track-label.js → icons.js → elevation.js → panels/topbar.js → los.js → panels/los-panel.js → panels/tools-panel.js → panels/settings-panel.js → panels/airport-selector.js → panels/efsp/carrier-state.js → panels/efsp/sfa-state.js → panels/efsp/efsp-state.js → panels/efsp/efsp-ws.js → panels/radar-panel.js → panels/aprt-panel.js → panels/efsp/efsp-arrivals.js → panels/efsp/time-chains.js → panels/efsp/strip-fields.js → panels/efsp/efsp-nla.js → panels/efsp/carrier-panel.js → panels/efsp/strip-drag.js → panels/efsp/efsp-gestures.js → panels/efsp/efsp-metrics-client.js → panels/efsp/correlation-highlight.js → panels/efsp/marsa-badge.js → panels/efsp/pattern-board.js → panels/efsp/final-panel.js → panels/efsp/field-state-rules.js → panels/efsp/bay-views.js → panels/efsp/ordnance-advisory.js → panels/efsp/scramble.js → panels/efsp/ato-strip.js → panels/efsp/strip-view.js → panels/efsp/efsp-flight-plan-lookup.js → panels/efsp/bay-view.js → panels/efsp/efsp-stereo-routes.js → panels/efsp/strip-template.js → panels/efsp/dot-command.js → panels/efsp/ato-import.js → panels/efsp/efsp-panel.js → panels/efsp/airspace-panel.js → panels/efsp/field-state-panel.js → panels/metrics-panel.js → dock.js → panels/track-panel.js → map-setup.js → atc-scope.js → geojson.js → app.js → iff.js → panels/efsp/annotation-editor.js → classic-globals-bridge.js → main.js → srs-radio.js.

Top-level statements that are not declarations, and why their order no longer matters:
- sync.js `applyConnOverrides()`: needs only config.js's globals, which a classic script defines before any module.
  sync.js is still the first module evaluated, as it was the first script.
- settings-panel.js keydown listener, track-panel.js `initFiledRouteButton` IIFE, efsp-metrics-client.js
  `beforeunload` listener: they register callbacks and query the DOM (complete, since modules are deferred). They
  call nothing from another module synchronously.
- strip-view.js `INDICATOR_ORDER.splice` / `ALERT_SLOT_KEYS.add`: the file's own constants.
- Declarations with calls (`new Map()`, own `_loadJSON`, DOM lookups, `Object.keys(CARRIER_CAPABILITIES)` in its
  own file, `crypto.randomUUID()`): none reads an imported binding. A static scan of every module-scope reference
  (scratchpad `order.js`) finds no read of an imported binding outside a function, except main.js's own calls.
- **Moved** (they ran at script load before; now main.js makes them after the whole graph): atc-scope.js
  `setInterval(atcTick, 500)` → main.js, first; app.js `window.getAllTracks`/`getLatestTrack` writes and its three
  `setInterval`s (track fade, stale check, emergency pulse) → wrapped where they stood (`_publishTrackAccessors`,
  `_startTrackFadeBeat`, `_startMaintenanceBeats`) and called first by `startApp()`; the boot section
  (`loadSettings()` … `connect()`) → `startApp()`, called by main.js after the atc beat; srs-radio.js →
  `await import('./srs-radio.js')` after `startApp()`, as it was the last script.

## Step 5: cycles and TDZ

One strongly connected component of 33 modules (app.js and almost every panel; module-graph.test.mjs prints it).
No module reads a cycle partner's binding at top level (step 4 scan). module-graph.test.mjs also evaluates every
module as its own entry in a fresh graph, so a TDZ that one entry order would hide shows up in the test.

## Step 6: duplicates

One case left: `_callsignOfFdr` (carrier-panel.js imports efsp-panel.js's variant, fallback `''`). Queue item 3.

## Step 7: module-graph test

`tests/module-graph.test.mjs` (7 tests + 2 finding todos) replaces `client-global-surface.test.js` (4 tests, 1 of
them a todo). Structure fixture: `tests/fixtures/module-graph-exports.json` (56 modules; bridge names frozen).

## Step 8: packaging

`packaging-config.test.js` asserts that `build.files` packs `app/public/js/package.json`. `npm run pack:linux` built
`CRC-1.0.1.AppImage`, and its `app.asar` holds `app/public/js/package.json`, `main.js`, `classic-globals-bridge.js` and
`index.html`. **The AppImage was not launched:** its default endpoint is the production crc-sync. The same `app/`
tree boots in the Playwright smoke.

## Sweep of global lookups (S-ESM1d part 2)

- 336 `typeof X === 'function' | 'undefined'` guards in 29 files name 176 imported bindings. All are imports since the
  codemod (the token check in module-graph.test.mjs proves no other module's export is read without an import). They
  stay in place as always-true guards: removing them is a body change, left to ESM-2/L20.
- No `globalThis.X` / `globalThis[…]` lookup is left (efsp-metrics-client.js was the only one).
- `window.X` reads left: browser APIs (`addEventListener`, `innerWidth`, `location`, `prompt`, `open`, `crypto`),
  the Electron preload's `window.crcUpdate`, the CDN global `window['dockview-core']`, and **app.js's published
  `window.getLatestTrack`/`getAllTracks`** (16 + 3 reads). These two are not module exports: app.js assigns them in
  `startApp()`. They are kept, because the unit tests stub them through `globalThis`. Converting them is a follow-up
  if wanted.

## Defaults taken (P2)

- The classic-globals bridge (S-ESM1a, S-ESM1c): its own file, imported last by main.js. Live getters cover every
  export. Setters exist only for the 7 senders the specs replace (e2e writes: l15-metrics.spec.js:122,
  l2-block-editing.spec.js:175/195, helpers/app.js:151; the other e2e writes go to `window.__*` scratch names and to
  `window.WebSocket`); any other write throws. `history` is bridged on purpose; any other name already on window is
  skipped and reported with `console.error` (not a throw, since a throw in the bridge would abort main.js before
  `startApp()`).
- Imports are placed right after the `'use strict'` prologue (before the header comment) where a file has one.
- app.js's wrapped boot statements are not re-indented, which keeps the diff to the wrapper lines.

## Findings

- tools-panel.js:33-34 reads `_pressureAtAlt`, `ISA_L`, `ISA_INV`, `T_REF_ALT`, and geojson.js:651-652 reads
  `trueHeading`. No file declares any of them: latent ReferenceErrors when called, same as before. Neither runs at
  module top level. `test.todo` in module-graph.test.mjs.
- Header comments in efsp-state.js, carrier-state.js, field-state-rules.js, atc-scope.js and sfa-state.js still
  describe the removed `module.exports` guard (and strip-view.js:18 "Loaded after bay-view.js"). Comments move
  verbatim, so they are left for L20.
- l22-stars-scope.spec.js:84 (`history.set`) is the reason `history` is bridged. The spec migration should drop it.
- W1-T-2(c) (questioner): app.js's shared state (`settings`, `tracks`, `map`, …) is imported by 17 modules. An
  `app-state.js` would remove the composition root from the cycle (ESM-2 material).
