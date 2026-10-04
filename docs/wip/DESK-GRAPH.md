# DESK-GRAPH (phase 3, structure; client lane, E2E_LANE 6)

Branch `lane/DESK-GRAPH-desk-graph`, commits `f58b0209..HEAD` (cut from the tree holding every phase-3 merge).

## Result

| | before | after |
|---|---|---|
| Largest strongly connected component (`app/public/js`, from `main.js`) | 59 of 106 modules | 39 of 114 modules |
| Modules importing `app.js` for state | 22 | 0 (only `main.js` imports `startApp`) |
| Custom `window.*` names read by production | `getLatestTrack`, `getAllTracks` (5 modules) | none (`tests/no-window-globals.test.mjs`) |
| `bay-view.js` re-exports | 48 names | 0 |
| Hand-kept renderer lists in `efsp-messages.js` | 12 `renderAllOpenEfspBays`, 6 `refreshEfspPanel`, 6 `updateMap`, ... | `markEfspChanged(topic)` (the bus) |
| crc-desktop `npm test` | 1174 | see report |

## What was done

1. Leaf modules: `settings.js` (DEFAULTS, `settings`, load/save), `map-handle.js` (`map`, `mapReady`, drag/measure, `updateZoomLimits`),
   `picture.js` (`latestFromServer`, `tracks`, `history`, coverage, `missionData`, `getBullseye`, `getLatestTrack`, `getAllTracks`),
   `view-state.js` (link status, selected contact/airfield, bullseye pick, blink phase, each behind a setter), `scope-constants.js`
   (colours, label geometry, scale helpers). `app.js` keeps the socket, the fade beat and `applySnapshot`/`applyCoverage`; it writes the leaves.
   `applyScale` moved into `geojson.js` (it needs `updateMap`). e2e `modules.js` gained `mapHandle`, `settings`, `picture`.
2. `window.getLatestTrack` / `getAllTracks`: imports from `picture.js`. Unit tests that stubbed them now fill `latestFromServer`.
   `tests/no-window-globals.test.mjs` fails on any `window.<name>`, `window[...] =` or `globalThis.x =` that is not a browser API or the
   preload bridge (`crcLinks`, `crcUpdate`).
3. `bay-view.js` no longer re-exports; importers import from `bay/**`. `formatZuluHhmm` -> leaf `format.js`; `carrierFinalDistanceText` ->
   `panels/efsp/carrier-final-distance.js` (not `carrier-state.js`: that module is imported by `efsp-state.js`, so adding the reverse import would make a cycle).
4. `panels/efsp/efsp-change-bus.js` (leaf): `markEfspChanged(...topics)`, `onEfspChanged(topics, fn, {order})`, `batchEfspChanges(fn)`.
   `dispatchEfspMessage` and `redrawEfspStore` run the handler in a batch, so the flush is once per frame, after state is applied.
   Topics: snapshot, board, ack, panel, positions, correlations, marsa, alerts, sfa, bays, map. Orders: RESOLVE (the three highlights)
   -> PANEL -> BAYS -> VIEW (map, track panel, airspace, runway-status). Unknown topics throw. Nine low-module direct calls of
   `renderAllOpenEfspBays` became `markEfspChanged('bays')`; `correlation-highlight.js` no longer imports `geojson.js`.
   `efsp-messages.js` no longer imports bay-view, geojson, track-panel, airspace-panel, runway-status-panel, the highlights.
5. `tests/module-graph.test.mjs` test 9: largest cycle <= 39, and the leaves and rule modules are in no cycle.

## Defaults taken

- Flush is synchronous at the end of the handler (the Bay renderer already coalesces on rAF), not a new rAF.
- Snapshot now resolves the correlation ring BEFORE the Bays (it ran after; the delta path always ran before). Highlight is a class read while a Strip is built, so the result is the same.
- `efsp-correlation-ack` now also refreshes the panel chrome and `efsp-correlation-delta` runs panel before Bays (cheap, idempotent). `efsp-sfa-*` still touch only the Bays.
- `efsp-positions-ack` still calls `renderPositionControls`/`renderPositionWarnings` directly (they take the ack's warnings as data, not a topic).
- The 164 underscore exports and `efspFlightDataList` rename were not done (they rewrite imports in files other lanes just finished; no behaviour).

## Left (next steps)

- Remaining cycle (39): `bay-view.js` <-> `strip-view.js`/`strip-element.js`/popovers (they import `selectEfspStripById`, `_dispatch*`, `_stripRenderSignature` from `bay-view.js`);
  `panels/*` <-> `geojson.js`/`map-setup.js`/`dock.js` (`updateMap` is imported by topbar, settings-panel, airport-selector, aprt-panel, track-panel: give it a `'map'`-style topic or move to a leaf).
  Two 2-cycles: `strip-template.js` <-> `strip-fields.js` (`mtrLostCommsAdvisory`/`BLOCK_MAPS`) and one more.
  Lower `LARGEST_CYCLE_MAX` as these go.
- God-file splits (item 6) not started: `efsp-state.js`, `airspace-panel.js`, `strip-view.js`, `airspace-editor.js`, `map-setup.js`.
- `popover-portal.js` no longer imports `bay-view.js`; `scramble.js` still imports panel setters from `efsp-panel.js`.

## Findings

- e2e `runway-status.spec.js` "reload mid-suspension" failed once in a 26-spec run (dockview `addPanel` error) and passed alone (15 s): load, not the change.
