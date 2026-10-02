# ESM-GUARDS

## Code as found (step 0)
`docs/wip/ESM-GUARDS/scan.mjs` (named, default and namespace imports; `typeof window.X`/`globalThis.X` for exported names;
reports non-import `typeof` targets for review). At `6ffc6b8`: **334 guards on imported bindings in 45 files**
(efsp-messages 45, strip-view 35, bay-view 29, atc-scope 27, bay-views 17, geojson 11, strip-element 11 ...).
No `typeof globalThis[name]` sites remain (ESM-1 converted `_efspMetrics()`). Namespace-import guards: none.
Also 7 always-true guards on same-file function declarations (`renderAirspacePanel`, `renderCarrierBanner`,
`renderRunwayStatusPanel`, `onEfspMetrics`) were removed.

Keep list: `typeof window/document` (Node tests), `maplibregl`/`dockview` (CDN), `window.getLatestTrack`/`getAllTracks`
(assigned by app.js, not imported), `CRCSYNC_URL`/`CASDOOR_*` (config.js classic globals), `setInterval`,
`cancelAnimationFrame`, `crypto`, `queueMicrotask`, `performance` (true globals).
Kept because the value, not the binding, is tested: `typeof map` (atc-scope 466, dock 639, geojson 666): `export let map;` is undefined
until map init.
Frozen for other lanes (still guarded): app.js `connect()` lines 583/584/586/587/595/615 (VERSION), map-setup.js 592
(MAPKEY). One-line follow-up after those merge.

Tests: no unit test depended on an else branch (ESM modules cannot be stubbed per import); crc-desktop suite unchanged.

## Result
Scan now: 10 (the frozen/kept above). Client lines 21862 -> see report. No else branch did real work (nothing stopped).
Removed now-unused imports: scramble.js (`_activeBayId`, `_activePositionTab`), carrier-panel.js (`getEfspFlightData`),
strip-view.js (`nlaLabelFor`).

## Behaviour fixes
- tools-panel altitude calculator: new `js/altimetry.js` (hand copy of crc-sync `src/altimetry.js`, ARCH-D7) +
  `tests/altimetry-parity.test.mjs`.
- extended centreline ticks: `trueHeading` -> `_aprtRwyTrueDeg`. Exports `buildExtendedCenterline` and
  `_setAprtRunwayForTest` for `tests/esm-latent-refs.test.mjs`. Both tests failed before the fix (ReferenceError).

## Defaults taken
- Step 5 (export getLatestTrack/getAllTracks) skipped: optional, and it touches BRIDGE's names.txt.
- Test seams added (`_setAprtRunwayForTest`) rather than clicking through the APRT panel.

## Findings
- crc-sync `grpc-client.js` has a second ISA copy (DATA-3).
- The extended centreline was never drawn on any tick-bearing zoom since ESM-1 (the throw skipped setData).

## Release note
Fixed: the Tools tab altitude calculator and the extended runway centreline (with its range ticks) work again.

## Tests
- crc-desktop `npm test`: 884 tests (882 pass, 2 todo) before; after: +4 tests (altimetry parity 2, latent refs 2), the 2 todos gone.
- crc-sync `npm test`: 2116/2118 + 1 todo; one failure seen once under machine load and gone on rerun.
- E2E lane 2: smoke, l22-stars-scope (5/5), l4-badges (4/4), l17-carrier (5/5), runway-status walk 2 (passes on rerun),
  l1-popovers (20/21 while the machine was loaded; base had 5 fails in the same conditions, load flakes).
  No spec covers the Tools tab or the extended centreline; both are covered by the unit tests. No screenshot taken.
