# ESM-1: the CRC client becomes native ES modules

(Report goes here at the end.)

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
